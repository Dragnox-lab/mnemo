'use strict';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const FC_CONSTANTS = {
  EASY_INTERVAL_DAYS:        4,
  DEFAULT_LEARNING_STEPS:    [1, 10],
  DEFAULT_RELEARNING_STEPS:  [10],
  FALLBACK_DECK:             { name: 'Uncategorized', color: '#7B6EF6' },
  TIMER_INTERVAL_MS:         1000,
  DROPDOWN_DEBOUNCE_MS:      150,
};

// ─── CRAM EXPLICIT FLAG ───────────────────────────────────────────────────────
//
// This is the ONLY source of truth for "did the user intentionally activate
// cram mode right now."
//
// Set TRUE only in two places:
//   1. _fcScheduleAutoReload — user just picked 'cram' from the dropdown.
//   2. startCramSession      — called directly from the ⚡ Cram button.
//
// Set FALSE in _cramExitSession so a stale 'cram' value in the dropdown can
// never accidentally re-trigger cram on the next "Study this deck" click.

let _cramModeExplicit = false;

// ─── SHUFFLE / TODAYDONE HELPERS ─────────────────────────────────────────────

function fcFisherYatesShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── TODAYDONE SET ────────────────────────────────────────────────────────────
// state.todayDone stays an Array for persistence / serialisation.
// _todayDoneSet mirrors it for O(1) has/add/delete.
// Any code that REPLACES state.todayDone (e.g. resetTodayReviews) must call
// window._invalidateTodayDoneSet() so the set is rebuilt on next access.

let _todayDoneSet = null;

function _ensureTodayDoneSet() {
  if (!_todayDoneSet) _todayDoneSet = new Set(state.todayDone || []);
  return _todayDoneSet;
}

function _invalidateTodayDoneSet() { _todayDoneSet = null; }
window._invalidateTodayDoneSet = _invalidateTodayDoneSet;

function addToTodayDone(cardId) {
  if (!cardId) return;
  if (!Array.isArray(state.todayDone)) state.todayDone = [];
  const s = _ensureTodayDoneSet();
  if (!s.has(cardId)) {
    state.todayDone.push(cardId);
    s.add(cardId);
    if (typeof saveImmediate === 'function') saveImmediate();
  }
}

function removeFromTodayDone(cardId) {
  if (!cardId || !Array.isArray(state.todayDone)) return;
  const s = _ensureTodayDoneSet();
  if (!s.has(cardId)) return; // fast-exit — not present
  state.todayDone = state.todayDone.filter(id => id !== cardId);
  s.delete(cardId);
  if (typeof saveImmediate === 'function') saveImmediate();
}

// ─── LOCAL UTILITIES ──────────────────────────────────────────────────────────

function ensureCardState() {
  if (!state.sm2)  state.sm2  = {};
  if (!state.fsrs) state.fsrs = {};
}

function fcParseStartDateToMs(startDate) {
  if (!startDate || typeof startDate !== 'string') return null;
  const parsed = typeof parseD === 'function' ? parseD(startDate) : new Date(startDate);
  const ms     = parsed instanceof Date ? parsed.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function fcGetNextReviewAtMs(card) {
  const raw = card?.nextReviewAt;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) return asNum;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function fcIsDueByTimestampNow(card, now = Date.now()) {
  const nextMs = fcGetNextReviewAtMs(card);
  if (nextMs === null) {
    if (card && card.id !== undefined) {
      console.warn('[flashcards] card missing nextReviewAt; treating as not due', card.id);
    }
    return false;
  }
  return nextMs <= now;
}

function fcGetReviewRetentionPercent(card) {
  try {
    if (typeof getRetention === 'function') return getRetention(card);
    if (typeof window._fsrs?.forgettingCurve === 'function' &&
        card?.state?.stability && card?.lastReviewedAt) {
      const elapsedDays = Math.max(0, (Date.now() - Number(card.lastReviewedAt)) / 86_400_000);
      return Math.round(window._fsrs.forgettingCurve(elapsedDays, card.state.stability) * 100);
    }
    return 100;
  } catch { return 100; }
}

function fcGetLearningStepMinutes(card) {
  const isRelearning = card?.pile === 'relearning';
  const steps        = isRelearning
    ? (window.SCHEDULER_CONFIG?.RELEARNING_STEPS || FC_CONSTANTS.DEFAULT_RELEARNING_STEPS)
    : (window.SCHEDULER_CONFIG?.LEARNING_STEPS   || FC_CONSTANTS.DEFAULT_LEARNING_STEPS);
  const stepIndex    = Number.isInteger(card?.stepIndex) ? card.stepIndex : 0;
  const safeIdx      = Math.max(0, Math.min(stepIndex, steps.length - 1));
  return Number(steps[safeIdx]) || 0;
}

function fcTag(topic, meta = {}) {
  return { ...topic, __queueMeta: { ...meta } };
}

function getCard(tid) {
  return state.sm2?.[tid] || null;
}

function ensureCard(tid) {
  ensureCardState();
  if (!state.sm2[tid]) {
    state.sm2[tid] = fsrsInit(tid);
  }
  return state.sm2[tid];
}

function updateFcActionToolbar(topic) {
  const fcCard = el('fcCard');
  if (!fcCard || !topic) return;
  fcCard.dataset.tid = topic.id || '';
  fcCard.dataset.flag = topic.flag || '';
  fcCard.dataset.suspended = topic.suspended ? 'true' : 'false';
  renderFcCardFlagDisplay(topic.flag);
  fcMoreMenu.setActiveFlag(topic.flag);
}

const FC_FLAG_COLORS = {
  red: '#ef4444',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6'
};

const fcMoreMenu = {
  menuEl: document.querySelector('.fc-more-menu-inline'),
  flagPanelEl: document.getElementById('fcFlagPanel'),
  flagToggleBtn: document.querySelector('[data-action="flag-toggle"]'),

  triggerEl: document.getElementById('more'),

  open() {
    this.menuEl?.classList.remove('hidden');
    this.triggerEl?.setAttribute('aria-expanded', 'true');
  },

  close() {
    this.menuEl?.classList.add('hidden');
    this.closeFlagPanel();
    this.triggerEl?.setAttribute('aria-expanded', 'false');
  },

  toggle() {
    if (!this.menuEl) return;
    if (this.menuEl.classList.contains('hidden')) {
      this.open();
    } else {
      this.close();
    }
  },

  openFlagPanel() {
    this.flagPanelEl?.classList.add('active');
    this.flagToggleBtn?.setAttribute('aria-expanded', 'true');
    this.flagPanelEl?.setAttribute('aria-hidden', 'false');
  },

  closeFlagPanel() {
    this.flagPanelEl?.classList.remove('active');
    this.flagToggleBtn?.setAttribute('aria-expanded', 'false');
    this.flagPanelEl?.setAttribute('aria-hidden', 'true');
  },

  toggleFlagPanel() {
    if (!this.flagPanelEl) return;
    const isActive = this.flagPanelEl.classList.toggle('active');
    this.flagToggleBtn?.setAttribute('aria-expanded', String(isActive));
    this.flagPanelEl?.setAttribute('aria-hidden', String(!isActive));
  },

  setActiveFlag(flagValue) {
    const value = flagValue || '';
    const buttons = Array.from(this.menuEl?.querySelectorAll('.fc-flag-icon-btn') || []);
    buttons.forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.flagValue || '') === value);
    });
  }
};

document.addEventListener('click', e => {
  if (!e.target.closest('.fc-more-wrap')) {
    fcMoreMenu.close();
  }
});

const fcMoreInlineMenu = document.querySelector('.fc-more-menu-inline');
if (fcMoreInlineMenu) {
  fcMoreInlineMenu.addEventListener('click', e => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    e.stopPropagation();

    const action = actionBtn.dataset.action;
    const tid = el('fcCard')?.dataset?.tid;
    if (!tid) return;

    if (action === 'flag-toggle') {
      fcMoreMenu.toggleFlagPanel();
      return;
    }
    if (action === 'bury') {
      if (typeof buryCard === 'function') buryCard(tid);
      fcMoreMenu.close();
      return;
    }
    if (action === 'suspend') {
      if (typeof toggleTopicSuspend === 'function') toggleTopicSuspend(tid);
      fcMoreMenu.close();
      return;
    }
    if (action === 'flag') {
      const value = actionBtn.dataset.flagValue || '';
      const current = el('fcCard')?.dataset.flag || '';
      setFlag(tid, current === value ? '' : value);
      return;
    }
  });
}

function renderFcCardFlagDisplay(flagValue) {
  const display = el('fcCardFlagDisplay');
  if (!display) return;
  const flag = flagValue || '';
  if (!flag) {
    display.innerHTML = '';
    return;
  }
  const color = FC_FLAG_COLORS[flag] || '#ef4444';
  display.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 4v16"/>
      <path d="M5 4c4 0 6 2 10 2s6-2 10-2v8c-4 0-6 2-10 2s-6-2-10-2z"/>
    </svg>
  `;
}

function flashcardActionHandler(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const fcCard = el('fcCard');
  const tid = fcCard?.dataset?.tid;
  if (!tid) return;

  if (action === 'suspend') {
    toggleTopicSuspend(tid);
    return;
  }
  if (action === 'bury') {
    buryCard(tid);
    return;
  }
  if (action === 'flag') {
    const flagValue = btn.dataset.flagValue || '';
    setTopicFlag(tid, flagValue);
    return;
  }
}

function toggleTopicSuspend(tid, options = {}) {
  const topic = state.topics.find(t => t.id === _getOrigId(tid));
  if (!topic) return;
  topic.suspended = !topic.suspended;
  if (topic.suspended) topic.buriedUntil = null;
  saveImmediate();
  if (typeof renderDecks === 'function') renderDecks();
  if (typeof renderDeckDetailContent === 'function' && T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
  if (typeof updateBrowserTable === 'function') updateBrowserTable();
  if (!options.skipAdvance && typeof advanceFcCard === 'function') advanceFcCard();

  if (topic.suspended) {
    showUndoToast?.('Card paused — won\'t appear in reviews', () => {
      topic.suspended = false;
      saveImmediate();
      if (typeof renderDecks === 'function') renderDecks();
      if (typeof renderDeckDetailContent === 'function' && T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
      if (typeof updateBrowserTable === 'function') updateBrowserTable();
    }, 8000);
  } else {
    const cardRow = document.querySelector(`[data-topic-id="${tid}"]`);
    if (cardRow) {
      cardRow.classList.add('border-glow');
      setTimeout(() => cardRow.classList.remove('border-glow'), 900);
    }
    showUndoToast?.('Card resumed — back in reviews', null, 3000);
  }
}

function buryCard(tid, options = {}) {
  const topic = state.topics.find(t => t.id === _getOrigId(tid));
  if (!topic) return;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  topic.buriedUntil = tomorrow.getTime();
  saveImmediate();
  if (typeof renderDecks === 'function') renderDecks();
  if (typeof renderDeckDetailContent === 'function' && T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
  if (typeof updateBrowserTable === 'function') updateBrowserTable();
  if (!options.skipAdvance && typeof advanceFcCard === 'function') advanceFcCard();

  showUndoToast?.('Card buried — see you tomorrow', () => {
    topic.buriedUntil = null;
    saveImmediate();
    if (typeof renderDecks === 'function') renderDecks();
    if (typeof renderDeckDetailContent === 'function' && T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
    if (typeof updateBrowserTable === 'function') updateBrowserTable();
  }, 8000);
}

function setFlag(tid, flagValue) {
  const topic = state.topics.find(t => t.id === _getOrigId(tid));
  if (!topic) return;
  topic.flag = flagValue || null;
  saveImmediate();
  if (typeof renderDecks === 'function') renderDecks();
  if (typeof renderDeckDetailContent === 'function' && T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
  if (typeof updateBrowserTable === 'function') updateBrowserTable();
  updateFcActionToolbar(topic);
}

// ─── DECK FILTER HELPER ───────────────────────────────────────────────────────

function _buildFilterDeckIdSet(deckFilter) {
  if (deckFilter === 'all') return null;

  const result = new Set([deckFilter]);

  if (typeof getSubDeckIds === 'function') {
    try {
      const ids = getSubDeckIds(deckFilter);
      if (Array.isArray(ids) && ids.length > 0) {
        ids.forEach(id => result.add(id));
        return result;
      }
    } catch (e) {
      console.warn('[FC] getSubDeckIds threw, falling back to manual walk:', e);
    }
  }

  const collect = (pid) => {
    (state.decks || [])
      .filter(d => d.parentId === pid)
      .forEach(child => { result.add(child.id); collect(child.id); });
  };
  collect(deckFilter);
  return result;
}

// ─── QUEUE BUILDER ────────────────────────────────────────────────────────────

// Get original topic ID if composite virtual ID
function _getOrigId(id) {
  return id && typeof id === 'string' && id.includes('_') ? id.split('_')[0] : id;
}

// Expand occlusion topics into per-shape virtual cards
function _expandTopics(topics) {
  const expanded = [];
  for (const topic of topics || []) {
    if (!topic?.id || !topic?.title) continue;
    if (topic.type === 'occlusion') {
      try {
        const shapes = JSON.parse(topic.content || '[]');
        if (shapes.length) {
          shapes.forEach((shape, i) => {
            expanded.push({
              ...topic,
              id: topic.id + '_' + shape.id,
              _occShape: shape,
              _occIndex: i,
              _occTotal: shapes.length,
              _origId: topic.id
            });
          });
          continue;
        }
      } catch (e) {
        console.warn('[FC] failed to parse occlusion content', topic.id, e);
      }
    }
    expanded.push(topic);
  }
  return expanded;
}

function buildFlashcardPriorityQueue(deckFilter = 'all', typeFilter = 'all') {
  const now         = Date.now();
  const today       = typeof DateUtils !== 'undefined' ? DateUtils.today() : todayStr();
  const doneIds     = new Set(state.todayDone || []);
  const validDeckIds = new Set((state.decks || []).map(d => d.id));

  let dailyNewLimit;
  if (typeof getEffectiveNewLimit === 'function') {
    dailyNewLimit = getEffectiveNewLimit(deckFilter);
  } else {
    const rawLimit = state.settings?.newCardsPerDay;
    dailyNewLimit = (rawLimit === null || rawLimit === undefined || rawLimit === 0) ? 20 : Math.max(0, Number(rawLimit));
  }

  // Compute how many new cards have already been studied today.
  //
  // getStudiedNewTodayInDeck(id) only counts cards directly in one deck.
  // Passing deckFilter ('all' or a parent deck id) produces wrong results:
  //   • 'all'        → no deck has that id → always returns 0 → limit never enforced
  //   • parent deck  → ignores sub-decks   → under-counts  → limit enforced too late
  //
  // Correct approach (mirrors getTreeNewBudget / buildTodayPriorityQueue):
  //   • 'all' / filtered: iterate every real deck and sum
  //   • specific deck:    walk up to the root, collect the full tree, sum per node
  //     (the daily-new limit is owned by the root and shared across the whole tree)
  const _sumStudiedNew = () => {
    if (typeof getStudiedNewTodayInDeck === 'function') {
      if (deckFilter === 'all' ||
          (typeof deckFilter === 'string' && deckFilter.startsWith('filtered:'))) {
        // Global / virtual-filtered session: aggregate every real deck.
        return (state.decks || []).reduce(
          (sum, d) => sum + getStudiedNewTodayInDeck(d.id), 0
        );
      }
      // Specific deck: walk up to the root so the whole tree's studied count
      // is measured against the root's single daily limit.
      let rootId = deckFilter;
      let safety = 0;
      while (rootId && safety++ < 10) {
        const d = (state.decks || []).find(d => d.id === rootId);
        if (!d || !d.parentId) break;
        rootId = d.parentId;
      }
      const treeIds = [rootId];
      const _collectTree = (pid) => {
        (state.decks || []).filter(d => d.parentId === pid).forEach(child => {
          treeIds.push(child.id);
          _collectTree(child.id);
        });
      };
      _collectTree(rootId);
      return treeIds.reduce((sum, id) => sum + getStudiedNewTodayInDeck(id), 0);
    }

    // ── Fallback (getStudiedNewTodayInDeck not available) ───────────────────
    // Count cards whose firstSeenAt was stamped today.  firstSeenAt is set the
    // first time a new card is rated (see fcRate).  The previous fallback used
    // c.log.length === 1 which was never populated, so studiedNewToday was
    // always 0 and the daily limit was never enforced.
    const todaySeenIds = new Set(
      Object.entries(state.sm2 || {})
        .filter(([, c]) => {
          if (!c.firstSeenAt) return false;
          const seenDate = typeof DateUtils !== 'undefined'
            ? DateUtils.tsToDate(c.firstSeenAt)
            : new Date(c.firstSeenAt).toISOString().slice(0, 10);
          return seenDate === today;
        })
        .map(([id]) => id)
    );
    if (deckFilter === 'all' ||
        (typeof deckFilter === 'string' && deckFilter.startsWith('filtered:'))) {
      return todaySeenIds.size;
    }
    // Specific deck: only count topics that belong to this deck's tree.
    const deckTreeIds = new Set([deckFilter]);
    const _collectDeckTree = (pid) => {
      (state.decks || []).filter(d => d.parentId === pid).forEach(child => {
        deckTreeIds.add(child.id);
        _collectDeckTree(child.id);
      });
    };
    _collectDeckTree(deckFilter);
    return Array.from(todaySeenIds).filter(id => {
      const t = state.topics.find(x => x.id === id || (id.includes('_') && x.id === id.split('_')[0]));
      return t && deckTreeIds.has(t.deckId);
    }).length;
  };
  const studiedNewToday = _sumStudiedNew();

  const remainingNewAllowed = Math.max(0, dailyNewLimit - studiedNewToday);
  let filterDeckIdSet = null;
  let filteredDeck = null;

  if (typeof deckFilter === 'string' && deckFilter.startsWith('filtered:')) {
    const filteredId = deckFilter.slice(9);
    if (typeof getFilteredDeckById === 'function') {
      filteredDeck = getFilteredDeckById(filteredId);
      // Static snapshot — see browser.js getFilteredDeckSnapshot()
      filterDeckIdSet = filteredDeck
        ? (typeof getFilteredDeckSnapshot === 'function'
            ? getFilteredDeckSnapshot(filteredDeck)
            : new Set(filteredDeck.cardIds || []))
        : new Set();
    } else {
      filterDeckIdSet = new Set();
    }
  } else {
    filterDeckIdSet = _buildFilterDeckIdSet(deckFilter);
  }

  // Filtered decks have NO daily new-card limit of their own and do NOT
  // share the global/root budget. Every new card present in the snapshot
  // is included; nothing is bumped to overflow because of a daily cap.
  const effectiveNewAllowed = filteredDeck
    ? Number.POSITIVE_INFINITY
    : remainingNewAllowed;

  const relearningPile = [];
  const reviewPile     = [];
  const learningPile   = [];
  const newPile        = [];
  const viewOnlyPile   = [];

  for (const topic of _expandTopics(state.topics || [])) {
    if (!topic?.id || !topic?.title)                               continue;
    if (isTopicHidden(topic))                                       continue;
    if (!topic.deckId || !validDeckIds.has(topic.deckId))          continue;
    const checkId = topic._origId || topic.id;
    if (filterDeckIdSet && !filterDeckIdSet.has(filteredDeck ? checkId : topic.deckId)) continue;

    const startMs = fcParseStartDateToMs(topic.startDate);
    if (startMs !== null && startMs > now)                         continue;

    let card = getCard(topic.id);
    if (!card) {
      ensureCardState();
      card = fsrsInit(topic.id);
      state.sm2[topic.id] = card;
      console.warn('[flashcards] persisted missing card during queue build', topic.id);
      if (typeof saveImmediate === 'function') saveImmediate();
    }

    if (card.pile === 'relearning') {
      if (fcIsDueByTimestampNow(card, now)) {
        relearningPile.push(fcTag(topic, { group: 'relearning', viewOnly: false }));
      }
      continue;
    }

    if (card.pile === 'learning') {
      if (fcIsDueByTimestampNow(card, now)) {
        const stepIndex   = Number.isInteger(card.stepIndex) ? card.stepIndex : 0;
        const stepMinutes = fcGetLearningStepMinutes(card);
        learningPile.push(fcTag(topic, { group: 'learning', viewOnly: false, stepIndex, stepMinutes }));
      }
      continue;
    }

    if ((!card.pile || card.pile === 'new') && !card.lastReviewedAt) {
      newPile.push(fcTag(topic, { group: 'new', viewOnly: false }));
      continue;
    }

    if (doneIds.has(topic.id)) {
      viewOnlyPile.push(fcTag(topic, { group: 'viewOnly', viewOnly: true }));
      continue;
    }

    if (card.pile === 'review') {
      if (!fcIsDueByTimestampNow(card, now)) continue;
      const retention = fcGetReviewRetentionPercent(card);
      reviewPile.push(fcTag(topic, { group: 'review', viewOnly: false, retention }));
      continue;
    }
  }

  reviewPile.sort((a, b) =>
    (a.__queueMeta?.retention ?? 100) - (b.__queueMeta?.retention ?? 100));
  learningPile.sort((a, b) =>
    (a.__queueMeta?.stepIndex ?? 0) - (b.__queueMeta?.stepIndex ?? 0));

  const shuffledNew = [...newPile];

  const newLimited  = shuffledNew.slice(0, effectiveNewAllowed);
  // Always include all new cards past the daily limit — but mark them as
  // view-only so they can be seen without being ratable. Previously they were
  // silently excluded (causing "cards after selected position not showing" and
  // the incorrect "Reviewed Today" fallback badge).
  const newOverflow = shuffledNew
    .slice(effectiveNewAllowed)
    .map(t => {
      const isDeckPreview = typeof isDeckPreviewUpcomingEnabled === 'function'
        ? isDeckPreviewUpcomingEnabled(t.deckId)
        : false;
      // 'newOverflow' = deck preview enabled (shows "Preview Mode" label)
      // 'newViewOnly' = past daily limit (shows "New · View Only" label)
      const overflowGroup = isDeckPreview ? 'newOverflow' : 'newViewOnly';
      return fcTag(t, { ...(t.__queueMeta || {}), group: overflowGroup, viewOnly: true });
    });

  viewOnlyPile.sort((a, b) => {
    const ca = getCard(b.id);
    const cb = getCard(a.id);
    return (ca?.lastReviewedAt || 0) - (cb?.lastReviewedAt || 0);
  });

  const dueCount = relearningPile.length + reviewPile.length + learningPile.length;
  const newCount = newLimited.length;

  if (typeFilter === 'due') {
    return {
      queue: [...relearningPile, ...reviewPile, ...learningPile, ...newLimited],
      dueCount,
      newCount,
      previewCount: 0,
    };
  }

  // 'all' (Auto mode) includes due cards + cards reviewed today, but NOT newOverflow
  if (typeFilter === 'all') {
    return {
      queue: [
        ...relearningPile,
        ...reviewPile,
        ...learningPile,
        ...newLimited,
        ...viewOnlyPile,
      ],
      dueCount,
      newCount,
      previewCount: viewOnlyPile.length,
    };
  }

  // Fallback for any other filter value
  return {
    queue: [
      ...relearningPile,
      ...reviewPile,
      ...learningPile,
      ...newLimited,
      ...viewOnlyPile,
    ],
    dueCount,
    newCount,
    previewCount: viewOnlyPile.length,
  };
}

// ─── GLOBAL STATE ─────────────────────────────────────────────────────────────

if (typeof window.T === 'undefined') window.T = {};

Object.assign(window.T, {
  fcQueue:              window.T.fcQueue             || [],
  fcIdx:                window.T.fcIdx               || 0,
  fcAnswerShown:        window.T.fcAnswerShown        || false,
  fcResults:            window.T.fcResults            || { again: 0, hard: 0, good: 0, easy: 0 },
  fcHistory:            window.T.fcHistory            || [],
  fcRedoStack:          window.T.fcRedoStack          || [],
  fcSeconds:            window.T.fcSeconds            || 0,
  fcTimerInterval:      window.T.fcTimerInterval      || null,
  manualDateCallback:   window.T.manualDateCallback   || null,
  fcHotkeysBound:       window.T.fcHotkeysBound       || false,
  fcViewOnlyMode:       false,
  fcDueCount:           0,
  fcNewCount:           0,
  fcPreviewCount:       0,
  studyReturnDeckId:    window.T.studyReturnDeckId    || null,
  fcSessionRatedIds:    window.T.fcSessionRatedIds    || [],
  fcSessionRatedSet:    window.T.fcSessionRatedSet    || new Set(),
  fcHistoryMap:         window.T.fcHistoryMap         || new Map(),
  _fcRating:            false,
  _fcNavigating:        false,
  _fcJustShownAnswer:   false,
  _fcNavGuard:          false,
  _cramNavGuard:        false,
});

// ─── SNAPSHOT / RESTORE ───────────────────────────────────────────────────────

function fcSnapshot(tid) {
  ensureCardState();
  const data = state.sm2[tid] || {};
  return JSON.parse(JSON.stringify(data));
}

function fcRestore(tid, snap) {
  ensureCardState();
  state.sm2[tid] = JSON.parse(JSON.stringify(snap));
}

// ─── RENDER FC IDLE (dropdown) ────────────────────────────────────────────────

function renderFC() {
  if (typeof refreshAllDeckSelects === 'function') refreshAllDeckSelects();

  const deckSel = el('fcDeckFilter');
  const typeSel = el('fcTypeFilter');
  if (!deckSel) return;

  deckSel.innerHTML = '<option value="all">Auto</option>';

  const allIds = new Set(state.decks.map(d => d.id));
  const roots  = state.decks.filter(d => !d.parentId || !allIds.has(d.parentId));

  function addOptions(parentId, depth) {
    state.decks
      .filter(d => d.parentId === parentId)
      .forEach(deck => {
        const opt       = document.createElement('option');
        opt.value       = deck.id;
        opt.textContent = '\u00a0'.repeat(depth * 3) + '\u2514 ' + deck.name;
        deckSel.appendChild(opt);
        addOptions(deck.id, depth + 1);
      });
  }

  roots.forEach(deck => {
    const opt       = document.createElement('option');
    opt.value       = deck.id;
    opt.textContent = deck.name;
    deckSel.appendChild(opt);
    addOptions(deck.id, 1);
  });

  if (Array.isArray(state.filteredDecks) && state.filteredDecks.length) {
    const group = document.createElement('optgroup');
    group.label = 'Filtered decks';
    state.filteredDecks.forEach(fd => {
      const opt = document.createElement('option');
      opt.value = `filtered:${fd.id}`;
      opt.textContent = fd.name || 'Filtered deck';
      group.appendChild(opt);
    });
    deckSel.appendChild(group);
  }

  if (!deckSel._fcAutoReloadBound) {
    deckSel.addEventListener('change', () => {
      // Picking a specific deck from the dropdown should always load that
      // deck's cards regardless of a previously-imposed type filter (e.g.
      // 'due', which Today's Start Session sets). Without this reset the
      // queue stays narrowed and the user sees nothing for the new deck.
      const typeSelEl = el('fcTypeFilter');
      if (typeSelEl && deckSel.value !== 'all') typeSelEl.value = 'all';
      _fcScheduleAutoReload();
    });
    deckSel._fcAutoReloadBound = true;
  }
  if (typeSel && !typeSel._fcAutoReloadBound) {
    typeSel.addEventListener('change', _fcScheduleAutoReload);
    typeSel._fcAutoReloadBound = true;
  }
  // Mode dropdown — picking 'cram' / 'normal' / etc. must reload the session
  // from the start in the chosen mode. Without this binding the dropdown is
  // visually changed but loadFlashcards is never called.
  const modeSel = el('fcModeFilter');
  if (modeSel && !modeSel._fcAutoReloadBound) {
    modeSel.addEventListener('change', _fcScheduleAutoReload);
    modeSel._fcAutoReloadBound = true;
  }
}

let _fcAutoReloadTimer = null;

function _fcScheduleAutoReload() {
  if (_fcAutoReloadTimer) clearTimeout(_fcAutoReloadTimer);
  _fcAutoReloadTimer = setTimeout(() => {
    _fcAutoReloadTimer = null;

    // Only mark cram as explicit when the user actually picks it from the
    // dropdown right now. Any other selection clears the flag.
    const dropdownMode = el('fcModeFilter')?.value || 'normal';
    if (dropdownMode === 'cram') {
      _cramModeExplicit = true;
    } else {
      _cramModeExplicit = false;
    }

    loadFlashcards();
  }, FC_CONSTANTS.DROPDOWN_DEBOUNCE_MS);
}

// ─── LOAD FLASHCARDS ──────────────────────────────────────────────────────────
//
// forcedMode: 'normal' | 'cram' | null
//   'normal' — always load the normal FSRS queue regardless of dropdown.
//   'cram'   — always start cram regardless of dropdown.
//   null     — read the dropdown, but only honour 'cram' if _cramModeExplicit
//              is true (i.e. the user just picked it, not a stale leftover).

function loadFlashcards(deckId = null, forcedMode = null) {
  if (T.fcTimerInterval) {
    clearInterval(T.fcTimerInterval);
    T.fcTimerInterval = null;
  }

  const deckFilter = deckId || el('fcDeckFilter')?.value || 'all';

  // "Study this deck" passes a deckId with no forcedMode. Lock the type
  // filter to 'all' (Auto mode) so the queue contains due cards plus cards reviewed today.
  // openFlashcardTopic overrides this back to 'all' before calling
  // loadFlashcards, so full-deck navigation from a card link still works.
  if (deckId && forcedMode === null) {
    const typeSelEl = el('fcTypeFilter');
    if (typeSelEl) typeSelEl.value = 'all';
  }

  const typeFilter = el('fcTypeFilter')?.value || 'all';

  // Resolve the effective mode:
  //   • forcedMode supplied by caller → trust it completely.
  //   • No forcedMode → read dropdown, but only treat 'cram' as active when
  //     _cramModeExplicit is true. A stale 'cram' in the dropdown is ignored
  //     and treated as 'normal'.
  let effectiveMode;
  if (forcedMode !== null) {
    effectiveMode = forcedMode;
    // If caller forces a mode, update the explicit flag to match.
    _cramModeExplicit = (forcedMode === 'cram');
  } else if (deckId) {
    // "Study this deck" passes a deckId with no forcedMode. That button must
    // never silently inherit a stale cram state from a previous session the
    // user navigated away from. Treat it as an explicit normal load.
    effectiveMode = 'normal';
    _cramModeExplicit = false;
  } else {
    const dropdownMode = el('fcModeFilter')?.value || 'normal';
    if (dropdownMode === 'cram' && _cramModeExplicit) {
      effectiveMode = 'cram';
    } else {
      effectiveMode = 'normal';
    }
  }

  // Sync the dropdown to reflect the effective mode so the user always sees
  // what is actually running.
  const modeFilterEl = el('fcModeFilter');
  if (modeFilterEl && modeFilterEl.value !== effectiveMode) {
    modeFilterEl.value = effectiveMode;
  }

  if (effectiveMode === 'cram') {
    startCramSession({ deckId: deckFilter, typeFilter });
    return;
  }

  // Resolved to normal. Tear down any lingering cram state in case the user
  // left a previous cram session by navigating away (which bypasses
  // _cramExitSession). This guarantees CRAM.active, the explicit flag, the
  // injected end button, and the hidden rating buttons can never leak into
  // a normal session.
  if (CRAM.active || _cramModeExplicit) {
    CRAM.active         = false;
    CRAM.deckId         = null;
    CRAM.sessionCardIds = [];
    CRAM.cardsById      = {};
    CRAM.currentIndex   = 0;
    CRAM.reviewedIds    = null;
    CRAM.missedIds      = null;
    if (T.cramScope) T.cramScope = null;
    _cramModeExplicit = false;
    if (typeof _cramRemoveEndButton === 'function')      _cramRemoveEndButton();
    if (typeof _cramRestoreNormalButtons === 'function') _cramRestoreNormalButtons();
  }

  const { queue, dueCount, newCount, previewCount } =
    buildFlashcardPriorityQueue(deckFilter, typeFilter);

  const deckSel = el('fcDeckFilter');
  if (deckSel && deckFilter !== 'all') deckSel.value = deckFilter;

  if (!queue.length) {
    T.fcQueue            = [];
    T.fcDueCount         = 0;
    T.fcNewCount         = 0;
    T.fcPreviewCount     = 0;
    T.fcIdx              = 0;
    T.fcAnswerShown      = false;
    T.fcViewOnlyMode     = false;
    T.fcSessionRatedIds  = [];
    T.fcSessionRatedSet  = new Set();
    T.fcHistoryMap       = new Map();

    const idle = el('fcIdle');
    if (idle) {
      idle.classList.remove('hidden');
      const msg = idle.querySelector('.fc-idle-msg');
      if (msg) msg.textContent = 'No cards match these filters.';
    }
    el('fcSession')?.classList.add('hidden');
    el('fcDone')?.classList.add('hidden');
    return;
  }

  T.fcQueue            = queue;
  T.fcDueCount         = dueCount;
  T.fcNewCount         = newCount;
  T.fcPreviewCount     = previewCount;
  T.fcIdx              = 0;
  T.fcAnswerShown      = false;
  T.fcViewOnlyMode     = false;
  T.fcResults          = { again: 0, hard: 0, good: 0, easy: 0 };
  T.fcHistory          = [];
  T.fcRedoStack        = [];
  T.fcSeconds          = 0;
  T.fcSessionRatedIds  = [];
  T.fcSessionRatedSet  = new Set();
  T.fcHistoryMap       = new Map();

  console.log(`[FC] Due:${dueCount} New:${newCount} Preview:${previewCount} Total:${queue.length}`);

  T.fcTimerInterval = setInterval(() => {
    T.fcSeconds++;
    const timer = el('fcTimer');
    if (timer) timer.textContent =
      `${Math.floor(T.fcSeconds / 60)}:${p2(T.fcSeconds % 60)}`;
  }, FC_CONSTANTS.TIMER_INTERVAL_MS);

  el('fcIdle')?.classList.add('hidden');
  el('fcDone')?.classList.add('hidden');
  el('fcSession')?.classList.remove('hidden');

  updateUndoRedoBtns();
  renderFcCard();
}

// ─── OPEN SPECIFIC TOPIC ──────────────────────────────────────────────────────

function openFlashcardTopic(topicId, options = {}) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return false;

  switchSection('flashcards');

  const deckFilterEl = el('fcDeckFilter');
  const dateFilterEl = el('fcDateFilter');
  if (deckFilterEl) deckFilterEl.value = options.deckFilter || 'all';
  if (dateFilterEl) dateFilterEl.value = options.dateFilter || 'all';

  // Always open in normal mode from a topic link — clear cram flag too.
  const modeFilterEl = el('fcModeFilter');
  if (modeFilterEl) modeFilterEl.value = 'normal';
  _cramModeExplicit = false;

  // Reset type filter to 'all' so the full queue is built (not just 'due').
  // Start Session sets typeFilter='due', which would exclude cards past the
  // daily limit from the queue — causing "cards after selected position not
  // showing" and incorrect fallback badges when clicking from Today/Decks.
  const typeFilterEl = el('fcTypeFilter');
  if (typeFilterEl) typeFilterEl.value = 'all';

  if (typeof renderFC === 'function') renderFC();

  loadFlashcards(null, 'normal');

  let idx = T.fcQueue.findIndex(c => c.id === topicId);

  if (idx === -1 && options.dateFilter && options.dateFilter !== 'all') {
    if (dateFilterEl) dateFilterEl.value = 'all';
    loadFlashcards(null, 'normal');
    idx = T.fcQueue.findIndex(c => c.id === topicId);
  }

  if (idx === -1) {
    const fallback = state.topics.find(t => t.id === topicId);
    if (!fallback) return false;

    // Determine why the card isn't in the queue: is it a never-reviewed new card
    // (past the daily limit), or a card already reviewed today?
    const _fallbackCard = (typeof getCard === 'function' ? getCard(fallback.id) : null)
                       || (state.sm2 && state.sm2[fallback.id]) || {};
    const _isNewCard = (!_fallbackCard.pile || _fallbackCard.pile === 'new') && !_fallbackCard.lastReviewedAt;
    const _fallbackGroup = _isNewCard ? 'newViewOnly' : 'viewOnly';

    T.fcQueue.push(fcTag(fallback, { group: _fallbackGroup, viewOnly: true }));
    T.fcPreviewCount = (T.fcPreviewCount || 0) + 1;
    idx = T.fcQueue.length - 1;

    if (!T.fcTimerInterval) {
      T.fcSeconds = 0;
      T.fcTimerInterval = setInterval(() => {
        T.fcSeconds++;
        const timer = el('fcTimer');
        if (timer) timer.textContent =
          `${Math.floor(T.fcSeconds / 60)}:${p2(T.fcSeconds % 60)}`;
      }, FC_CONSTANTS.TIMER_INTERVAL_MS);
    }

    el('fcIdle')?.classList.add('hidden');
    el('fcDone')?.classList.add('hidden');
    el('fcSession')?.classList.remove('hidden');
  }

  if (idx === -1) return false;

  T.fcIdx         = idx;
  T.fcAnswerShown = false;
  renderFcCard();
  return true;
}

// Resolve occlusion card image placeholders
function fcResolveOcclusionImages(container) {
  if (!container) return;
  const imgs = container.querySelectorAll('img[data-img-ref]');
  imgs.forEach(async img => {
    const ref = img.dataset.imgRef;
    if (ref && !ref.startsWith('data:')) {
      try {
        if (window.MnemoAudio?.createAudioURL) {
          const url = await window.MnemoAudio.createAudioURL(ref);
          if (url) img.src = url;
        }
      } catch (e) {
        console.warn('[FC] failed to resolve occlusion image url', ref, e);
      }
    }
  });
}

// ─── RENDER CURRENT CARD ──────────────────────────────────────────────────────

function renderFcCard() {
  const q = T.fcQueue[T.fcIdx];
  if (!q) return;

  const deck      = state.decks.find(d => d.id === q.deckId) || FC_CONSTANTS.FALLBACK_DECK;
  const card      = ensureCard(q.id);
  const meta      = q.__queueMeta || {};
  const isPreview = Boolean(meta.viewOnly);

  T.fcViewOnlyMode = isPreview;

  const pb = el('fcPileBadge');
  if (pb) {
    pb.className = 'fc-pile-badge';
    if (isPreview) {
      if (meta.group === 'newOverflow') {
        pb.textContent = 'View Only · Preview (ratings disabled)';
      } else if (meta.group === 'newViewOnly') {
        pb.textContent = '🆕 New · View Only (daily limit reached)';
        pb.classList.add('pile-new-viewonly');
      } else {
        pb.textContent = 'View Only · Reviewed Today';
      }
      if (meta.group !== 'newViewOnly') pb.classList.add('pile-preview');
    } else if (meta.group === 'relearning') {
      pb.textContent = 'Relearning';
      pb.classList.add('pile-learning');
    } else if (meta.group === 'review') {
      pb.textContent = `Review · ${Math.round(meta.retention ?? fcGetReviewRetentionPercent(card))}%`;
      pb.classList.add('pile-review');
    } else if (meta.group === 'learning') {
      pb.textContent = `Learning · ${Math.round(meta.stepMinutes ?? fcGetLearningStepMinutes(card))}m`;
      pb.classList.add('pile-learning');
    } else if (meta.group === 'new' || !card.pile || card.pile === 'new') {
      pb.textContent = 'New';
      pb.classList.add('pile-new');
    } else {
      const stab = card.state ? Math.round(card.state.stability) : 0;
      const ret  = Math.round(fcGetReviewRetentionPercent(card));
      pb.textContent = `Review · ${ret}% · S:${stab}d`;
      pb.classList.add('pile-review');
    }
  }

  const dt = el('fcDeckTag');
  if (dt) {
    dt.textContent = deck.name;
    dt.style.setProperty('--deck-color', deck.color);
    dt.classList.add('deck-tag');
  }

  const prog = el('fcProg');
  if (prog) prog.textContent = `${T.fcIdx + 1} / ${T.fcQueue.length}`;

  const pbFill = el('fcPbFill');
  if (pbFill) pbFill.style.width = `${(T.fcIdx / T.fcQueue.length) * 100}%`;

  const fcQ     = el('fcQ');
  const fcA     = el('fcA');
  const fcCard  = el('fcCard');
  const qTitle  = q.title   || q.question || '';
  const qAnswer = q.content || q.answer   || '';

  if (fcCard) {
    fcCard.dataset.tid = q.id;
    fcCard.dataset.flag = String(q.flag || 0);
    fcCard.dataset.suspended = q.suspended ? 'true' : 'false';
  }

  updateFcActionToolbar(q);

  const moreBtn = document.getElementById('more');
  if (moreBtn) {
    moreBtn.onclick = function (e) {
      e.stopPropagation();
      fcMoreMenu.toggle();
    };
    moreBtn.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fcMoreMenu.toggle();
      }
    };
  }

  if (q.type === 'occlusion' && q._occShape && window.OcclusionEditor) {
    if (fcQ) fcQ.innerHTML = OcclusionEditor.buildReviewHTML(q, q._occShape.id, 'question');
    if (fcA) fcA.innerHTML = OcclusionEditor.buildReviewHTML(q, q._occShape.id, 'answer')
      + `<p class="oc-label">${(q._occShape.label || '?').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')} <span style="color:var(--ink3);font-size:.8em;">(${q._occIndex+1}/${q._occTotal})</span></p>`;
    fcResolveOcclusionImages(fcQ);
    fcResolveOcclusionImages(fcA);
  } else if (q.type === 'cloze') {
    if (fcQ) fcQ.innerHTML = typeof renderClozeQ === 'function'
      ? renderClozeQ(qTitle) : qTitle;
    if (fcA) fcA.innerHTML = typeof renderClozeA === 'function'
      ? renderClozeA(qTitle) : qTitle;
  } else {
    if (fcQ) fcQ.textContent = qTitle;
    if (fcA) fcA.textContent = qAnswer || '— No additional notes —';
  }

  // Replace ⟦IMG::filename⟧ placeholders with <img> elements from IndexedDB,
  // then render any LaTeX (\(...\) and \[...\]) on the card container.
  if (q.type !== 'occlusion') {
    fcEnhanceCardEl(fcQ);
    fcEnhanceCardEl(fcA);
  }

  const fcImg = el('fcCardImage');
  if (fcImg) {
    if (q.image && q.type !== 'occlusion') {
      fcImg.src = q.image;
      fcImg.classList.remove('hidden');
    } else {
      fcImg.classList.add('hidden');
    }
  }

  if (window.MnemoAudio) {
    const frontRefs = q.audioRefsFront || (q.audioRefs && !q.audioRefsBack ? q.audioRefs : []);
    const backRefs  = q.audioRefsBack  || [];
    let frontWrap = document.getElementById('fcAudioFront');
    if (fcQ && !frontWrap) {
      frontWrap = document.createElement('div');
      frontWrap.id = 'fcAudioFront';
      frontWrap.className = 'mnemo-audio-row';
      fcQ.parentNode?.insertBefore(frontWrap, fcQ.nextSibling);
    }
    if (frontWrap) {
      frontWrap.innerHTML = window.MnemoAudio.buildAudioButtons(frontRefs)
        + (window.MnemoAudio.buildTTSButton ? window.MnemoAudio.buildTTSButton(qTitle) : '');
    }
    let backWrap = document.getElementById('fcAudioBack');
    if (fcA && !backWrap) {
      backWrap = document.createElement('div');
      backWrap.id = 'fcAudioBack';
      backWrap.className = 'mnemo-audio-row';
      fcA.parentNode?.insertBefore(backWrap, fcA.nextSibling);
    }
    if (backWrap) {
      backWrap.innerHTML = window.MnemoAudio.buildAudioButtons(backRefs)
        + (window.MnemoAudio.buildTTSButton ? window.MnemoAudio.buildTTSButton(qAnswer || '') : '');
    }
  }

  fcResetCardUI();
  updateUndoRedoBtns();
  if (!isPreview) updateRatingButtonIntervals();
  bindRatingButtons();
  if (typeof fcApplyHideQuestionSetting === 'function') fcApplyHideQuestionSetting();
  if (typeof applyFcFontScale === 'function') applyFcFontScale(state.settings?.fcFontScale || 1);
  fcApplyRatedState();
  ensureFlashcardButtonsVisible();
}

function fcResetCardUI() {
  fcMoreMenu.close();
  T.fcAnswerShown = false;
  el('fcQ')?.classList.remove('hidden');
  el('fcAnswerArea')?.classList.add('hidden');
  el('fcShowRow')?.classList.remove('hidden');
  el('fcNextRow')?.classList.add('hidden');
  el('fcRatingRow')?.classList.add('hidden');
  el('fcSession')?.classList.remove('hidden');
  el('fcDone')?.classList.add('hidden');
  // Show End-session button in normal mode (cram mode injects its own).
  if (typeof CRAM === 'undefined' || !CRAM.active) {
    _normalInjectEndButton();
  }
}

// ─── RICH CARD ENHANCEMENT (images + KaTeX) ──────────────────────────────────
// Scans an already-rendered card element for ⟦IMG::filename⟧ placeholders,
// swaps them for <img> elements loaded from IndexedDB, then runs KaTeX on
// the container so \(...\) and \[...\] delimiters get typeset.
function fcEnhanceCardEl(node) {
  if (!node) return;
  const renderMath = () => {
    if (typeof window.renderMathInElement !== 'function') return;
    try {
      window.renderMathInElement(node, {
        delimiters: [
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) {
      console.warn('[Mnemo] KaTeX render failed', e);
    }
  };
  const html = node.innerHTML || '';
  if (html.indexOf('⟦IMG::') !== -1 && window.MnemoAudio?.buildImageElements) {
    const names = [];
    html.replace(/⟦IMG::([^⟧]+)⟧/g, (_, n) => { names.push(n); return ''; });
    window.MnemoAudio.buildImageElements(names).then(map => {
      node.innerHTML = node.innerHTML.replace(/⟦IMG::([^⟧]+)⟧/g, (_, n) => {
        const img = map.get(n);
        return img ? img.outerHTML : '';
      });
      renderMath();
    }).catch(err => {
      console.warn('[Mnemo] image render failed', err);
      renderMath();
    });
  } else {
    renderMath();
  }
}

// ─── RATING BUTTON LABELS ─────────────────────────────────────────────────────


function updateRatingButtonIntervals() {
  const q = T.fcQueue[T.fcIdx];
  if (!q) return;
  // If this card has already been rated this session, use the pre-rating snapshot
  // so interval labels reflect the state before rating, not the already-advanced state.
  // This prevents Previous navigation from showing mutated intervals.
  const histEntry = T.fcHistoryMap?.get(q.id) ?? (T.fcHistory || []).find(h => T.fcQueue[h.idx]?.id === q.id);
  const card = histEntry ? histEntry.snapshot : ensureCard(q.id);

  let labels;
  if (typeof getButtonLabels === 'function') {
    labels = getButtonLabels(card);
  } else {
    const isRelearning = card.pile === 'relearning';
    const steps        = isRelearning
      ? FC_CONSTANTS.DEFAULT_RELEARNING_STEPS
      : FC_CONSTANTS.DEFAULT_LEARNING_STEPS;
    const stepIdx      = card.stepIndex || 0;

    const fmtMins = m => m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
    const fmtDays = d =>
      d < 7   ? `${d}d` :
      d < 30  ? `${Math.round(d / 7)}w` :
      d < 365 ? `${Math.round(d / 30)}mo` : `${Math.round(d / 365)}y`;

    const pile = card.pile || 'new';

    if (pile === 'learning' || pile === 'relearning') {
      const clamped = Math.min(stepIdx, steps.length - 1);
      const cur     = steps[clamped];
      const next    = steps[clamped + 1] || cur;
      labels = {
        again: fmtMins(steps[0]),
        hard:  fmtMins(Math.round((cur + next) / 2)),
        good:  stepIdx + 1 >= steps.length ? fmtDays(1) : fmtMins(steps[stepIdx + 1]),
        easy:  fmtDays(FC_CONSTANTS.EASY_INTERVAL_DAYS),
      };
    } else if (pile === 'new') {
      const cur  = steps[0];
      const next = steps[1] || steps[0];
      labels = {
        again: fmtMins(cur),
        hard:  fmtMins(Math.round((cur + next) / 2)),
        good:  steps.length > 1 ? fmtMins(steps[1]) : fmtDays(1),
        easy:  fmtDays(FC_CONSTANTS.EASY_INTERVAL_DAYS),
      };
    } else {
      labels = {
        again: fmtMins(FC_CONSTANTS.DEFAULT_RELEARNING_STEPS[0]),
        hard: '~1d', good: '~2d', easy: '~4d',
      };
    }
  }

  document.querySelectorAll('.fc-rating-row .rate-btn').forEach(btn => {
    let rating = 'again';
    if (btn.classList.contains('r-hard')) rating = 'hard';
    else if (btn.classList.contains('r-good')) rating = 'good';
    else if (btn.classList.contains('r-easy')) rating = 'easy';
    const span = btn.querySelector('span');
    if (span && labels[rating]) span.textContent = labels[rating];
  });
}

// ─── SHOW ANSWER ──────────────────────────────────────────────────────────────

function fcShowAnswer() {
  window.MnemoAudio?.stopSpeech();
  if (!T.fcQueue.length || T.fcIdx < 0 || T.fcIdx >= T.fcQueue.length) {
    console.warn('[FC] No valid card to show answer for');
    return;
  }

  const q = T.fcQueue[T.fcIdx];
  if (!q) return;

  el('fcQ')?.classList.add('hidden');
  el('fcAnswerArea')?.classList.remove('hidden');
  el('fcShowRow')?.classList.add('hidden');
  // Keep the main navigation next button in the toolbar; do not show the inline Next row.
  el('fcNextRow')?.classList.add('hidden');

  const qPreview = el('fcQPreview');
  if (qPreview) {
    const qText = (q.title || q.question || '').replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, '$1').trim();
    const truncated = qText.length > 30 ? qText.slice(0, 30) + '...' : qText;
    qPreview.textContent = truncated;
  }

  const deck = state.decks.find(d => d.id === q.deckId);

  if (deck?.scheduleMode === 'manual') {
    el('fcRatingRow')?.classList.add('hidden');
    T.manualDateCallback = date => {
      if (!date) return;
      const snapshot = fcSnapshot(q.id);
      const card     = ensureCard(q.id);

      if (!card.firstSeenAt) card.firstSeenAt = Date.now();

      const manualNextReviewAt = new Date(date).getTime();
      card.nextReviewAt        = manualNextReviewAt;
      card.lastReviewedAt      = Date.now();
      card.pile                = 'review';

      const _manualHistItem = {
        idx:               T.fcIdx,
        snapshot,
        rating:            'manual',
        manualNextReviewAt,
        resultsBefore:     { ...T.fcResults },
      };
      T.fcHistory.push(_manualHistItem);
      T.fcHistoryMap?.set(q.id, _manualHistItem);
      T.fcRedoStack = [];
      T.fcResults.good++;

      if (!T.fcSessionRatedSet.has(q.id)) { T.fcSessionRatedIds.push(q.id); T.fcSessionRatedSet.add(q.id); }
      addToTodayDone(q.id);
      if (window.IndexManager?.scheduleRebuild) window.IndexManager.scheduleRebuild();
      if (typeof recordReview === 'function') recordReview();
      if (typeof saveImmediate === 'function') saveImmediate();
      advanceFcCard();
    };
    openModal('manualDateModal');
    const nextDate = el('manualNextDate');
    if (nextDate) nextDate.value = addDays(todayStr(), 1);
  } else {
    if (!T.fcViewOnlyMode) el('fcRatingRow')?.classList.remove('hidden');
  }

  T.fcAnswerShown = true;
  ensureFlashcardButtonsVisible();
}

function ensureFlashcardButtonsVisible() {
  const target = el('fcRatingRow')?.classList.contains('hidden')
    ? el('fcShowRow')
    : el('fcRatingRow');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── RATE CARD ────────────────────────────────────────────────────────────────

function fcRate(rating) {
  if (CRAM.active) {
    if (rating !== 'again' && rating !== 'easy') return;
    const cur = T.fcQueue[T.fcIdx];
    if (!cur) return;
    _cramRecordRating(cur.id, rating === 'easy');
    _cramAdvance();
    return;
  }

  if (T._fcRating) return;
  T._fcRating = true;
  setTimeout(() => { T._fcRating = false; }, 0);

  const currentCard = T.fcQueue[T.fcIdx];
  const isViewOnly  = currentCard?.__queueMeta?.viewOnly ?? T.fcViewOnlyMode;

  if (isViewOnly) {
    if (typeof showToast === 'function') showToast('View-only mode — ratings disabled.', 'info');
    return;
  }

  const q = T.fcQueue[T.fcIdx];
  if (!q) return;

  const snapshot = fcSnapshot(q.id);
  const card     = ensureCard(q.id);

  // Capture firstSeenAt intent BEFORE updateCard(), which may replace
  // state.sm2[q.id] with a brand-new object (FSRS recomputes the full
  // card state), wiping any fields we set on the old reference.
  const _wasNew         = (!card.pile || card.pile === 'new') && !card.lastReviewedAt;
  const _firstSeenStamp = _wasNew ? (card.firstSeenAt || Date.now()) : undefined;
  if (_wasNew && !card.firstSeenAt) card.firstSeenAt = _firstSeenStamp;

  const gradeMap = { again: 0, hard: 1, good: 2, easy: 3 };
  const grade    = gradeMap[rating] ?? 2;

  // ── Reset-Today snapshot (one per card per day; first review wins so
  //    a reset always restores the pre-session state).
  // IMPORTANT: use `snapshot` (captured at the very top of fcRate, before
  // any mutations including firstSeenAt) — NOT state.sm2[q.id] which has
  // already been mutated. Using the mutated copy causes reset to restore
  // a state with firstSeenAt set, which makes getStudiedNewTodayInDeck /
  // rawNewCount believe the daily new-card budget is already spent, so new
  // cards are pushed to overflow and disappear from the Today list.
  if (!state.todayUndo) state.todayUndo = {};
  if (!state.todayUndo[q.id]) {
    state.todayUndo[q.id] = {
      sm2:                 JSON.parse(JSON.stringify(snapshot)),
      wasInTodayDone:      Array.isArray(state.todayDone) && state.todayDone.includes(q.id),
      ratedAt:             Date.now(),
    };
  }

  try {
    updateCard(q.id, grade, state.sm2);
    T.fcResults[rating]++;
  } catch (err) {
    console.warn('[FC] Rating update failed:', err);
  }

  // Re-apply firstSeenAt after updateCard() in case it replaced the card
  // object. Without this, _firstSeenTodaySet never includes the card, so
  // _studied() always returns 0, the daily budget never decrements, and
  // new cards keep refilling after the limit is reached.
  if (_wasNew) {
    const _updatedCard = ensureCard(q.id);
    if (!_updatedCard.firstSeenAt) _updatedCard.firstSeenAt = _firstSeenStamp;
  }

  // ── Calendar review log: append every rating event keyed by date.
  if (!state.reviewLog || typeof state.reviewLog !== 'object') state.reviewLog = {};
  const _today = todayStr();
  if (!Array.isArray(state.reviewLog[_today])) state.reviewLog[_today] = [];
  state.reviewLog[_today].push({ cardId: q.id, ratedAt: Date.now(), grade });
  // Bound per-day entries to avoid unbounded growth
  if (state.reviewLog[_today].length > 1000) {
    state.reviewLog[_today] = state.reviewLog[_today].slice(-1000);
  }

  const _rateHistItem = {
    idx:           T.fcIdx,
    snapshot,
    rating,
    resultsBefore: { ...T.fcResults, [rating]: T.fcResults[rating] - 1 },
  };
  T.fcHistory.push(_rateHistItem);
  T.fcHistoryMap?.set(q.id, _rateHistItem);
  T.fcRedoStack = [];

  if (!T.fcSessionRatedSet.has(q.id)) { T.fcSessionRatedIds.push(q.id); T.fcSessionRatedSet.add(q.id); }
  addToTodayDone(q.id);
  if (window.IndexManager?.scheduleRebuild) window.IndexManager.scheduleRebuild();
  if (typeof recordReview  === 'function') recordReview();
  if (typeof saveImmediate === 'function') saveImmediate();
  advanceFcCard();
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────

function navigateFcCard(delta) {
  window.MnemoAudio?.stopSpeech();
  if (CRAM.active) {
    if (delta < 0) { _cramPrev(); return; }
    if (CRAM.currentIndex < CRAM.sessionCardIds.length - 1) {
      CRAM.currentIndex++;
      _cramRenderCurrent();
    } else {
      _cramShowEndScreen();
    }
    return;
  }

  if (T._fcJustShownAnswer) return;
  if (T._fcNavigating) return;
  T._fcNavigating = true;
  setTimeout(() => { T._fcNavigating = false; }, 100);

  const newIdx = T.fcIdx + delta;
  if (newIdx < 0 || newIdx >= T.fcQueue.length) return;
  T.fcIdx         = newIdx;
  T.fcAnswerShown = false;
  fcResetCardUI();
  renderFcCard();
}

let _fcNavGuard = false;
function fcPrevCard() {
  if (_fcNavGuard) return;
  _fcNavGuard = true;
  setTimeout(() => { _fcNavGuard = false; }, 150);
  navigateFcCard(-1);
}

function fcNextCard() {
  if (_fcNavGuard) return;
  _fcNavGuard = true;
  setTimeout(() => { _fcNavGuard = false; }, 150);
  navigateFcCard(1);
}

// ─── ADVANCE TO NEXT CARD ─────────────────────────────────────────────────────

function advanceFcCard() {
  const now = Date.now();

  for (let i = T.fcIdx + 2; i < T.fcQueue.length; i++) {
    const item = T.fcQueue[i];
    if (item?.__queueMeta?.requeued) continue;

    const card = getCard(item.id);
    if (!card) continue;
    if (
      (card.pile === 'learning' || card.pile === 'relearning') &&
      fcIsDueByTimestampNow(card, now)
    ) {
      item.__queueMeta = { ...item.__queueMeta, requeued: true };
      T.fcQueue.splice(i, 1);
      T.fcQueue.splice(T.fcIdx + 1, 0, item);
    }
  }

  T.fcIdx++;
  if (T.fcIdx >= T.fcQueue.length) {
    showFcDone();
  } else {
    T.fcAnswerShown = false;
    fcResetCardUI();
    renderFcCard();
  }
  updateUndoRedoBtns();
}

// ─── SESSION COMPLETE ─────────────────────────────────────────────────────────

function showFcDone() {
  fcMoreMenu.close();
  if (T.fcTimerInterval) {
    clearInterval(T.fcTimerInterval);
    T.fcTimerInterval = null;
  }

  _normalRemoveEndButton();

  el('fcSession')?.classList.add('hidden');
  el('fcDone')?.classList.remove('hidden');

  if (typeof window.mnemoCheckDueNotifications === 'function') {
    setTimeout(() => window.mnemoCheckDueNotifications(), 200);
  }

  const r        = T.fcResults;
  const total    = r.again + r.hard + r.good + r.easy || 1;
  const m        = Math.floor(T.fcSeconds / 60);
  const s        = T.fcSeconds % 60;
  const retained = Math.round(((r.hard + r.good + r.easy) / total) * 100);

  const stats = el('fcdStats');
  if (stats) {
    stats.innerHTML = `
      <div class="fcd-stat">
        <div class="fcd-sv" style="color:var(--red)">${r.again}</div>
        <div class="fcd-sl">Again</div>
      </div>
      <div class="fcd-stat">
        <div class="fcd-sv" style="color:var(--amb)">${r.hard}</div>
        <div class="fcd-sl">Hard</div>
      </div>
      <div class="fcd-stat">
        <div class="fcd-sv" style="color:var(--grn)">${r.good}</div>
        <div class="fcd-sl">Good</div>
      </div>
      <div class="fcd-stat">
        <div class="fcd-sv" style="color:var(--acc)">${r.easy}</div>
        <div class="fcd-sl">Easy</div>
      </div>
      <div class="fcd-stat">
        <div class="fcd-sv">${retained}%</div>
        <div class="fcd-sl">Retained</div>
      </div>
      <div class="fcd-stat">
        <div class="fcd-sv">${m}:${p2(s)}</div>
        <div class="fcd-sl">Time</div>
      </div>
    `;
  }

  el('fcDone')?.querySelector('.fc-done-buttons')?.remove();

  const buttonDiv = document.createElement('div');
  buttonDiv.className  = 'fc-done-buttons';
  buttonDiv.style.cssText = 'display:flex;gap:12px;margin-top:20px;justify-content:center;flex-wrap:wrap;';

  const ratedIds      = [...T.fcSessionRatedIds];
  const hasRatedCards = ratedIds.length > 0;

  if (hasRatedCards) {
    const viewAgainBtn       = document.createElement('button');
    viewAgainBtn.className   = 'btn-primary';
    viewAgainBtn.textContent = '👁️ View Again';
    viewAgainBtn.onclick = () => {
      const ratedSet    = new Set(ratedIds);
      const replayQueue = T.fcQueue
        .filter(c => ratedSet.has(c.id))
        .map(c => fcTag(c, { ...(c.__queueMeta || {}), viewOnly: true, group: 'viewOnly' }));

      if (!replayQueue.length) return;

      T.fcQueue        = replayQueue;
      T.fcViewOnlyMode = true;
      T.fcIdx          = 0;
      T.fcAnswerShown  = false;
      T.fcResults      = { again: 0, hard: 0, good: 0, easy: 0 };
      T.fcHistory      = [];
      T.fcRedoStack    = [];
      T.fcHistoryMap   = new Map();

      el('fcDone')?.classList.add('hidden');
      el('fcSession')?.classList.remove('hidden');

      fcResetCardUI();
      renderFcCard();
      // Scroll to card so the user doesn't have to manually scroll down on mobile
      setTimeout(() => {
        el('fcCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    };
    buttonDiv.appendChild(viewAgainBtn);
  }

  const returnDeckId = T.studyReturnDeckId;
  const backBtn      = document.createElement('button');
  backBtn.className   = 'btn-secondary';
  backBtn.textContent = '← Back to Deck';

  backBtn.onclick = () => {
    if (T.fcTimerInterval) {
      clearInterval(T.fcTimerInterval);
      T.fcTimerInterval = null;
    }
    T.fcQueue           = [];
    T.fcIdx             = 0;
    T.fcAnswerShown     = false;
    T.fcSessionRatedIds = [];
    T.fcSessionRatedSet = new Set();
    T.fcHistoryMap      = new Map();
    T.studyReturnDeckId = null;

    switchSection('decks');

    if (returnDeckId) {
      setTimeout(() => {
        if (typeof openDeckDetail === 'function') openDeckDetail(returnDeckId);
      }, 100);
    }
  };
  buttonDiv.appendChild(backBtn);

  el('fcDone')?.appendChild(buttonDiv);
}

// ─── STOP SESSION ─────────────────────────────────────────────────────────────

function stopFcSession() {
  fcMoreMenu.close();
  if (T.fcTimerInterval) {
    clearInterval(T.fcTimerInterval);
    T.fcTimerInterval = null;
  }
  T.fcAnswerShown     = false;
  T.fcQueue           = [];
  T.fcIdx             = 0;
  T.fcSessionRatedIds = [];
  T.fcSessionRatedSet = new Set();
  T.fcHistoryMap      = new Map();
  el('fcSession')?.classList.add('hidden');
  el('fcIdle')?.classList.remove('hidden');
  el('fcDone')?.classList.add('hidden');
  if (typeof saveImmediate === 'function') saveImmediate();
}

// ─── UNDO / REDO ─────────────────────────────────────────────────────────────

function updateUndoRedoBtns() {
  const undoBtn = el('fcUndoBtn');
  const redoBtn = el('fcRedoBtn');
  if (undoBtn) undoBtn.classList.toggle('disabled', T.fcHistory.length === 0);
  if (redoBtn) redoBtn.classList.toggle('disabled', T.fcRedoStack.length === 0);
}

function handleRatingClick(e) {
  const btn = e.target.closest('.rate-btn');
  if (!btn) return;
  let rating = 'again';
  if (btn.classList.contains('r-hard')) rating = 'hard';
  else if (btn.classList.contains('r-good')) rating = 'good';
  else if (btn.classList.contains('r-easy')) rating = 'easy';
  fcRate(rating);
}

function bindRatingButtons() {
  const container = el('fcRatingRow');
  if (!container) return;
  container.removeEventListener('click', handleRatingClick);
  container.addEventListener('click', handleRatingClick);
}

// ─── EVENT SETUP ─────────────────────────────────────────────────────────────

function setupFlashcardEvents() {
  const againBtn   = el('fcAgainBtn');
  const showBtn    = el('fcShowBtn');
  const undoBtn    = el('fcUndoBtn');
  const redoBtn    = el('fcRedoBtn');
  const prevBtn    = el('fcPrevBtn');
  const nextBtn    = el('fcNextBtn');
  const navNextBtn = el('fcNavNextBtn');

  if (againBtn)   againBtn.onclick   = () => loadFlashcards();
  if (showBtn)    showBtn.onclick    = fcShowAnswer;
  if (undoBtn)    undoBtn.onclick    = fcUndo;
  if (redoBtn)    redoBtn.onclick    = fcRedo;
  if (prevBtn)    prevBtn.onclick    = fcPrevCard;
  if (nextBtn)    nextBtn.onclick    = fcNextCard;
  if (navNextBtn) navNextBtn.onclick = fcNextCard;

  // Tap card to toggle answer ↔ question (primary interaction on mobile,
  // harmless on desktop). Ignore taps on inner buttons / links / inputs / audio.
  const fcCardEl = el('fcCard');
  if (fcCardEl && !fcCardEl._fcToggleBound) {
    fcCardEl._fcToggleBound = true;
    fcCardEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      if (e.target.closest('a, input, textarea, select, .mnemo-audio-row, .fc-rating-row, #fcShowRow, #fcNextRow')) return;
      const answerArea = el('fcAnswerArea');
      const answerVisible = answerArea && !answerArea.classList.contains('hidden');
      if (answerVisible) {
        // Back to question (does not change card / scheduling)
        fcResetCardUI();
      } else {
        fcShowAnswer();
      }
    });
  }

  const fontSlider = el('fcFontSize');
  if (fontSlider) {
    const saved = Number(state.settings?.fcFontScale) || 1;
    fontSlider.value = String(saved);
    applyFcFontScale(saved);
    fontSlider.oninput = (e) => {
      const v = Number(e.target.value) || 1;
      if (!state.settings) state.settings = {};
      state.settings.fcFontScale = v;
      applyFcFontScale(v);
      if (typeof saveImmediate === 'function') saveImmediate();
    };
  }

  const confirmManualDate = el('confirmManualDate');
  if (confirmManualDate) {
    confirmManualDate.onclick = () => {
      const dateInput = el('manualNextDate');
      if (dateInput && T.manualDateCallback) {
        T.manualDateCallback(dateInput.value);
        T.manualDateCallback = null;
        if (typeof closeModal === 'function') closeModal('manualDateModal');
      }
    };
  }

  const fcCardActionsEl = el('fcCard');
  if (fcCardActionsEl && !fcCardActionsEl._fcActionsBound) {
    fcCardActionsEl._fcActionsBound = true;
    fcCardActionsEl.addEventListener('click', flashcardActionHandler);
  }

  bindRatingButtons();

  bindRatingButtons();

  // ── Mobile "End Session" button (normal + cram mode) ───────────────────────
  // Injected once into the nav row so it's always visible on mobile.
  // Hidden on desktop via CSS (.fc-end-session-btn media query).
  if (!document.getElementById('fcEndSessionBtn')) {
    const endBtn = document.createElement('button');
    endBtn.id        = 'fcEndSessionBtn';
    endBtn.type      = 'button';
    endBtn.className = 'fc-end-session-btn';
    endBtn.setAttribute('aria-label', 'End session');
    endBtn.textContent = '✕ End';
    endBtn.onclick = () => {
      if (typeof CRAM !== 'undefined' && CRAM.active) {
        _cramShowEndScreen();
      } else {
        showFcDone();
      }
    };
    // Insert at end of the nav row (after Next button)
    const navRow = document.querySelector('.fc-nav-row');
    if (navRow) navRow.appendChild(endBtn);
  }

  // Ensure the filter dropdowns are bound to auto-reload even if renderFC
  // hasn't run yet (e.g. user enters Flashcards via Today→Start Session
  // before any deck-list re-render). Idempotent via the _fcAutoReloadBound
  // flag set on each element.
  ['fcDeckFilter', 'fcTypeFilter', 'fcModeFilter'].forEach(id => {
    const node = el(id);
    if (node && !node._fcAutoReloadBound) {
      node.addEventListener('change', _fcScheduleAutoReload);
      node._fcAutoReloadBound = true;
    }
  });

  document.removeEventListener('keydown', handleFlashcardHotkeys);
  document.addEventListener('keydown', handleFlashcardHotkeys);
  T.fcHotkeysBound = true;

  // ── Clear Filters button ───────────────────────────────────────────────────
  const filterClearBtn = el('fcFilterClearBtn');
  if (filterClearBtn && !filterClearBtn._fcClearBound) {
    filterClearBtn._fcClearBound = true;
    filterClearBtn.addEventListener('click', () => {
      const deckSel = el('fcDeckFilter');
      const typeSel = el('fcTypeFilter');
      const modeSel = el('fcModeFilter');
      if (deckSel) deckSel.value = 'all';
      if (typeSel) typeSel.value = 'all';
      if (modeSel) modeSel.value = 'normal';
      _cramModeExplicit = false;
      _fcScheduleAutoReload();
      if (typeof showToast === 'function') showToast('Filters cleared', 'info');
    });
  }
}

// ─── KEYBOARD HANDLER ─────────────────────────────────────────────────────────

function handleFlashcardHotkeys(e) {
  const activeTag = document.activeElement?.tagName;
  const isTyping  = activeTag === 'INPUT' || activeTag === 'TEXTAREA'
    || document.activeElement?.isContentEditable;
  if (isTyping) return;

  const flashcardsVisible = !el('section-flashcards')?.classList.contains('hidden');
  const sessionVisible    = !el('fcSession')?.classList.contains('hidden');
  if (!flashcardsVisible || !sessionVisible) return;

  const key  = String(e.key || '').toLowerCase();
  const code = e.code || '';

  if (key === 'escape') {
    fcMoreMenu.close();
    return;
  }

  if (code === 'Space' || key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (document.activeElement instanceof HTMLButtonElement) {
      document.activeElement.blur();
    }
    // Re-entrancy guard — Space repeats can fire many keydown events.
    if (T._fcSpaceLock) return;
    T._fcSpaceLock = true;
    setTimeout(() => { T._fcSpaceLock = false; }, 200);

    const answerAreaEl    = el('fcAnswerArea');
    const answerIsVisible = answerAreaEl
      ? !answerAreaEl.classList.contains('hidden')
      : T.fcAnswerShown;
    if (!answerIsVisible) {
      T._fcJustShownAnswer = true;
      const clearGuard = () => { T._fcJustShownAnswer = false; };
      requestAnimationFrame(() => requestAnimationFrame(clearGuard));
      fcShowAnswer();
      window.addEventListener('keyup', function blockSpaceKeyup(ev) {
        if (ev.code === 'Space' || ev.key === ' ') {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
        T._fcJustShownAnswer = false;
        window.removeEventListener('keyup', blockSpaceKeyup, true);
      }, true);
    }
    return;
  }

  if (T.fcAnswerShown) {
    const currentQueueEntry = T.fcQueue[T.fcIdx];
    const isViewOnly        = currentQueueEntry?.__queueMeta?.viewOnly ?? false;
    if (!isViewOnly) {
      const ratings = {
        digit1: 'again', numpad1: 'again', '1': 'again',
        digit2: 'hard',  numpad2: 'hard',  '2': 'hard',
        digit3: 'good',  numpad3: 'good',  '3': 'good',
        digit4: 'easy',  numpad4: 'easy',  '4': 'easy',
      };
      const picked = ratings[code.toLowerCase()] || ratings[key];
      if (picked) {
        e.preventDefault();
        fcRate(picked);
        return;
      }
    }
  }

  if (code === 'ArrowLeft' || key === 'arrowleft') {
    e.preventDefault();
    fcPrevCard();
    return;
  }
  if (code === 'ArrowRight' || key === 'arrowright') {
    e.preventDefault();
    fcNextCard();
    return;
  }

  if (e.ctrlKey && (code === 'KeyZ' || key === 'z')) {
    e.preventDefault();
    fcUndo();
    return;
  }
  if (e.ctrlKey && (code === 'KeyY' || key === 'y')) {
    e.preventDefault();
    fcRedo();
    return;
  }

  if (!e.ctrlKey && !e.metaKey && !e.altKey && (code === 'KeyH' || key === 'h')) {
    e.preventDefault();
    fcToggleHideQuestion();
    return;
  }
}

// ─── HIDE-QUESTION TOGGLE ────────────────────────────────────────────────────

function fcToggleHideQuestion() {
  const card = el('fcCard');
  if (!card) return;
  const next = !card.classList.contains('hide-question');
  card.classList.toggle('hide-question', next);
  if (!state.settings) state.settings = {};
  state.settings.fcHideQuestion = next;
  if (typeof saveImmediate === 'function') saveImmediate();
  if (typeof showToast === 'function') {
    showToast(next ? 'Question hidden — answer-only mode' : 'Question visible', 'info');
  }
}

function fcApplyHideQuestionSetting() {
  const card = el('fcCard');
  if (!card) return;
  card.classList.toggle('hide-question', !!state.settings?.fcHideQuestion);
}

// ─── RATED STATE (read-only view on Previous navigation) ─────────────────────

function _injectRatedStateCSS() {
  if (document.getElementById('_fcRatedCSS')) return;
  const s = document.createElement('style');
  s.id = '_fcRatedCSS';
  s.textContent = `
    .rate-btn.rated-readonly {
      opacity: 0.45;
      cursor: default;
      pointer-events: none;
    }
    .rate-btn.rated-selected {
      opacity: 1;
      outline: 2px solid currentColor;
      outline-offset: 2px;
      pointer-events: none;
    }
  `;
  document.head.appendChild(s);
}

function fcApplyRatedState() {
  _injectRatedStateCSS();
  const q = T.fcQueue[T.fcIdx];
  if (!q) return;

  const histEntry = T.fcHistoryMap?.get(q.id) ?? (T.fcHistory || []).find(h => T.fcQueue[h.idx]?.id === q.id);

  if (histEntry) {
    // Show answer area so the chosen rating is visible
    el('fcQ')?.classList.add('hidden');
    el('fcAnswerArea')?.classList.remove('hidden');
    el('fcShowRow')?.classList.add('hidden');
    el('fcNextRow')?.classList.add('hidden');
    el('fcRatingRow')?.classList.remove('hidden');
    T.fcAnswerShown = true;

    // Mark buttons read-only and highlight the chosen one
    document.querySelectorAll('.fc-rating-row .rate-btn').forEach(btn => {
      btn.classList.remove('rated-readonly', 'rated-selected');
      let btnRating = 'again';
      if (btn.classList.contains('r-hard')) btnRating = 'hard';
      else if (btn.classList.contains('r-good')) btnRating = 'good';
      else if (btn.classList.contains('r-easy')) btnRating = 'easy';

      if (btnRating === histEntry.rating) {
        btn.classList.add('rated-selected');
      } else {
        btn.classList.add('rated-readonly');
      }
    });
  } else {
    // Unrated or Undone — clear any leftover read-only markers
    document.querySelectorAll('.fc-rating-row .rate-btn').forEach(btn => {
      btn.classList.remove('rated-readonly', 'rated-selected');
    });
  }
}

// ─── UNDO ─────────────────────────────────────────────────────────────────────

function fcUndo() {
  window.MnemoAudio?.stopSpeech();
  if (!T.fcHistory.length) return;

  const last = T.fcHistory.pop();
  const tid  = T.fcQueue[last.idx]?.id;
  if (!tid) return;

  fcRestore(tid, last.snapshot);
  removeFromTodayDone(tid);

  if (last.rating && last.rating !== 'manual') {
    T.fcResults[last.rating] = Math.max(0, T.fcResults[last.rating] - 1);
  } else if (last.rating === 'manual') {
    T.fcResults.good = Math.max(0, T.fcResults.good - 1);
  }

  const ri = T.fcSessionRatedIds.indexOf(tid);
  if (ri !== -1) { T.fcSessionRatedIds.splice(ri, 1); T.fcSessionRatedSet?.delete(tid); }
  T.fcHistoryMap?.delete(tid);

  if (typeof recalcHistoryFromCards !== 'undefined') {
    recalcHistoryFromCards();
  } else {
    const today = todayStr();
    state.history[today] = Math.max(0, (state.history[today] || 0) - 1);
  }

  T.fcRedoStack.push({ ...last });
  T.fcIdx         = last.idx;
  T.fcAnswerShown = false;
  fcResetCardUI();
  renderFcCard();

  if (typeof saveImmediate === 'function') saveImmediate();
  if (typeof recalcStreak  === 'function') recalcStreak();
  updateUndoRedoBtns();
}

function fcRedo() {
  window.MnemoAudio?.stopSpeech();
  if (!T.fcRedoStack.length) return;

  const item = T.fcRedoStack.pop();
  const q    = T.fcQueue[item.idx];
  if (!q) return;

  if (item.rating === 'manual' && item.manualNextReviewAt) {
    const card = ensureCard(q.id);
    card.nextReviewAt   = item.manualNextReviewAt;
    card.lastReviewedAt = Date.now();
    card.pile           = 'review';
    T.fcResults.good++;
  } else {
    const gradeMap = { again: 0, hard: 1, good: 2, easy: 3 };
    const grade    = gradeMap[item.rating] ?? 2;
    updateCard(q.id, grade, state.sm2);
    if (item.rating) T.fcResults[item.rating]++;
  }

  if (!T.fcSessionRatedSet.has(q.id)) { T.fcSessionRatedIds.push(q.id); T.fcSessionRatedSet.add(q.id); }
  addToTodayDone(q.id);
  if (typeof recordReview === 'function') recordReview();

  T.fcHistory.push(item);
  T.fcHistoryMap?.set(q.id, item);
  T.fcIdx         = item.idx + 1;
  T.fcAnswerShown = false;

  if (T.fcIdx >= T.fcQueue.length) {
    if (T.fcTimerInterval) clearInterval(T.fcTimerInterval);
    showFcDone();
  } else {
    renderFcCard();
  }

  if (typeof saveImmediate === 'function') saveImmediate();
  if (typeof recalcStreak  === 'function') recalcStreak();
  updateUndoRedoBtns();
}

// ============================================================================
// CRAM MODE
// ============================================================================

const CRAM = {
  active:         false,
  deckId:         null,
  sessionCardIds: [],
  cardsById:      {},
  currentIndex:   0,
  reviewedIds:    null,
  missedIds:      null,
};

function _cramCollectScopedTopics(deckId) {
  const ids = (typeof getSubDeckIds === 'function')
    ? getSubDeckIds(deckId)
    : [deckId];
  const inScope = new Set(ids);
  return state.topics.filter(t => inScope.has(t.deckId));
}

// ─── startCramSession ────────────────────────────────────────────────────────
// Entry points that legitimately start cram:
//   • The ⚡ Cram button (cramDeckById) — calls this directly.
//   • loadFlashcards when effectiveMode === 'cram' AND _cramModeExplicit is true.
//
// Sets _cramModeExplicit = true so the flag stays consistent with reality.

function startCramSession(opts) {
  const deckId     = opts && opts.deckId;
  const typeFilter = (opts && opts.typeFilter) || 'all';
  if (!deckId) return;

  // Allow cramming across the whole library when the deck filter is 'all'
  // (e.g. user picked 'cram' from the mode dropdown after Today's Start
  // Session set fcDeckFilter to 'all'). Without this branch _cramCollect-
  // ScopedTopics returns nothing for 'all' and cram silently does nothing.
  let topics;
  if (deckId === 'all') {
    const validDeckIds = new Set((state.decks || []).map(d => d.id));
    topics = (state.topics || []).filter(t => t.deckId && validDeckIds.has(t.deckId));
  } else {
    topics = _cramCollectScopedTopics(deckId);
  }

  // When the type filter is 'due', restrict cram to cards that the normal
  // queue would consider due right now (review cards past their next-review
  // time, learning/relearning cards whose timer has expired). The ⚡ Cram
  // button on a deck never passes typeFilter, so it stays auto/all.
  if (typeFilter === 'due' && typeof buildFlashcardPriorityQueue === 'function') {
    const { queue } = buildFlashcardPriorityQueue(deckId, 'due');
    const dueIds = new Set((queue || []).map(t => t.id));
    topics = topics.filter(t => dueIds.has(t.id));
  }

  if (!topics.length) {
    if (typeof showToast === 'function') showToast('No cards to cram.', 'info');
    return;
  }

  // Mark cram as explicitly active.
  _cramModeExplicit = true;

  // Sync the deck filter dropdown to the cram deck.
  const deckFilter = el('fcDeckFilter');
  if (deckFilter) deckFilter.value = deckId;

  // Mark the mode dropdown as cram so the UI reflects reality.
  const modeFilter = el('fcModeFilter');
  if (modeFilter) modeFilter.value = 'cram';

  _cramInit(deckId, topics);
  _cramRenderCurrent();
}

function startCramSessionFromIds(deckId, ids) {
  const baseIds = ids.map(id => id.includes('_') ? id.split('_')[0] : id);
  const topicMap = new Map(state.topics.map(t => [t.id, t]));
  const topics   = baseIds.map(id => topicMap.get(id)).filter(Boolean);
  if (!topics.length) return;
  _cramModeExplicit = true;
  _cramInit(deckId, topics, ids);
  _cramRenderCurrent();
}

function _cramInit(deckId, topics, idsFilter) {
  if (T.fcTimerInterval) {
    clearInterval(T.fcTimerInterval);
    T.fcTimerInterval = null;
  }

  // Expand occlusion topics into virtual shape cards for cram mode
  let expanded = _expandTopics(topics);
  if (idsFilter && idsFilter.length) {
    const filterSet = new Set(idsFilter);
    expanded = expanded.filter(t => filterSet.has(t.id));
  }

  CRAM.active         = true;
  CRAM.deckId         = deckId;
  CRAM.sessionCardIds = expanded.map(t => t.id);
  CRAM.cardsById      = Object.fromEntries(expanded.map(t => [t.id, t]));
  CRAM.currentIndex   = 0;
  CRAM.reviewedIds    = new Set();
  CRAM.missedIds      = new Set();

  T.fcQueue        = expanded.map(t => ({ ...t, __queueMeta: { group: 'cram', cram: true } }));
  T.fcIdx          = 0;
  T.fcAnswerShown  = false;
  T.fcViewOnlyMode = false;
  T.fcResults      = { again: 0, hard: 0, good: 0, easy: 0 };
  T.fcHistory      = [];
  T.fcRedoStack    = [];
  T.fcSessionRatedIds = [];
  T.fcSessionRatedSet = new Set();
  T.fcHistoryMap      = new Map();

  el('fcIdle')?.classList.add('hidden');
  el('fcDone')?.classList.add('hidden');
  el('fcSession')?.classList.remove('hidden');

  _cramInjectEndButton();
}

function _cramRenderCurrent() {
  if (!CRAM.active) return;
  if (CRAM.currentIndex >= CRAM.sessionCardIds.length) {
    _cramShowEndScreen();
    return;
  }
  T.fcIdx = CRAM.currentIndex;
  T.fcAnswerShown = false;
  fcResetCardUI();
  renderFcCard();

  document.querySelectorAll('.fc-rating-row .rate-btn').forEach(btn => {
    if (btn.classList.contains('r-hard') || btn.classList.contains('r-good')) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
      const span = btn.querySelector('span');
      if (btn.classList.contains('r-again')) {
        if (span) span.textContent = "Didn't get it";
        else btn.textContent = "Didn't get it";
      } else if (btn.classList.contains('r-easy')) {
        if (span) span.textContent = 'Got it';
        else btn.textContent = 'Got it';
      }
    }
  });

  const pb = el('fcPileBadge');
  if (pb) {
    pb.className = 'fc-pile-badge pile-preview';
    pb.textContent = `Cram · ${CRAM.currentIndex + 1} / ${CRAM.sessionCardIds.length}`;
  }

  _cramInjectEndButton();
}

function _cramRestoreNormalButtons() {
  document.querySelectorAll('.fc-rating-row .rate-btn').forEach(btn => {
    btn.style.display = '';
  });
}

function _cramInjectEndButton() {
  if (document.getElementById('fcCramEndBtn')) return;
  // Hide other End-session buttons so only the cram one is visible
  const navEnd = document.getElementById('fcEndSessionBtn');
  if (navEnd) navEnd.style.display = 'none';
  const normalEnd = document.getElementById('fcNormalEndBtn');
  if (normalEnd) normalEnd.style.display = 'none';
  const host = el('fcShowRow') || el('fcSession');
  if (!host) return;
  const btn = document.createElement('button');
  btn.id = 'fcCramEndBtn';
  btn.type = 'button';
  btn.className = 'btn-secondary';
  btn.textContent = 'End session';
  btn.style.cssText = 'margin-left:8px';
  btn.onclick = () => _cramShowEndScreen();
  host.appendChild(btn);
}

function _cramRemoveEndButton() {
  document.getElementById('fcCramEndBtn')?.remove();
  // Restore other End-session buttons
  const navEnd = document.getElementById('fcEndSessionBtn');
  if (navEnd) navEnd.style.display = '';
  const normalEnd = document.getElementById('fcNormalEndBtn');
  if (normalEnd) normalEnd.style.display = '';
}

// ─── NORMAL-MODE END SESSION BUTTON ───────────────────────────────────────────
// Mirrors _cramInjectEndButton so a desktop "End session" button is visible
// during regular FSRS review too. Behaviour: ends the current session and
// shows the same results screen the natural end-of-session flow uses.

function _normalInjectEndButton() {
  if (document.getElementById('fcNormalEndBtn')) return;
  // Hide the nav-row End button to avoid duplicates
  const navEnd = document.getElementById('fcEndSessionBtn');
  if (navEnd) navEnd.style.display = 'none';
  const host = el('fcShowRow') || el('fcSession');
  if (!host) return;
  const btn = document.createElement('button');
  btn.id = 'fcNormalEndBtn';
  btn.type = 'button';
  btn.className = 'btn-secondary';
  btn.textContent = 'End session';
  btn.style.cssText = 'margin-left:8px';
  btn.onclick = () => showFcDone();
  host.appendChild(btn);
}

function _normalRemoveEndButton() {
  document.getElementById('fcNormalEndBtn')?.remove();
  // Restore the nav-row End button
  const navEnd = document.getElementById('fcEndSessionBtn');
  if (navEnd) navEnd.style.display = '';
}

function _cramRecordRating(cardId, gotIt) {
  if (!CRAM.active || !cardId) return;
  CRAM.reviewedIds.add(cardId);
  if (gotIt) {
    CRAM.missedIds.delete(cardId);
  } else {
    CRAM.missedIds.add(cardId);
  }
}

let _cramAdvanceGuard = false;
function _cramAdvance() {
  if (_cramAdvanceGuard) return;
  _cramAdvanceGuard = true;
  setTimeout(() => { _cramAdvanceGuard = false; }, 150);
  if (CRAM.currentIndex >= CRAM.sessionCardIds.length - 1) {
    _cramShowEndScreen();
    return;
  }
  CRAM.currentIndex++;
  _cramRenderCurrent();
}

function _cramPrev() {
  if (CRAM.currentIndex <= 0) return;
  CRAM.currentIndex--;
  _cramRenderCurrent();
}

function _cramShowEndScreen() {
  if (!CRAM.active) return;

  el('fcSession')?.classList.add('hidden');
  const done = el('fcDone');
  if (!done) return;
  done.classList.remove('hidden');

  _cramRemoveEndButton();
  _cramRestoreNormalButtons();

  const reviewed = CRAM.reviewedIds.size;
  const missed   = CRAM.missedIds.size;
  const got      = Math.max(0, reviewed - missed);

  const stats = el('fcdStats');
  if (stats) {
    stats.innerHTML = `
      <div class="fcd-stat">
        <div class="fcd-sv">${reviewed}</div>
        <div class="fcd-sl">Reviewed</div>
      </div>
      <div class="fcd-stat">
        <div class="fcd-sv" style="color:var(--grn)">${got}</div>
        <div class="fcd-sl">Got it</div>
      </div>
      <div class="fcd-stat">
        <div class="fcd-sv" style="color:var(--red)">${missed}</div>
        <div class="fcd-sl">Missed</div>
      </div>`;
  }

  done.querySelector('.fc-done-buttons')?.remove();
  done.querySelector('.cram-missed-list')?.remove();

  if (missed > 0) {
    const list = document.createElement('div');
    list.className = 'cram-missed-list';
    list.style.cssText =
      'margin:18px auto 0;max-width:640px;text-align:left;display:flex;flex-direction:column;gap:8px';
    const hdr = document.createElement('div');
    hdr.textContent = 'Missed cards';
    hdr.style.cssText =
      'font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:.78rem;opacity:.7;margin-bottom:4px';
    list.appendChild(hdr);

    [...CRAM.missedIds].forEach(id => {
      const card = CRAM.cardsById[id] || state.topics.find(t => t.id === id);
      if (!card) return;
      
      let front = card.title || card.question || '(untitled)';
      let back  = card.content || card.answer || '— No additional notes —';
      if (card.type === 'occlusion' && card._occShape) {
        front = `${card.title} [Box ${card._occIndex + 1}]: ${card._occShape.label || '(No label)'}`;
        back  = `Image Occlusion Card — Box ${card._occIndex + 1} of ${card._occTotal}`;
      }

      const item = document.createElement('details');
      item.style.cssText =
        'background:var(--surf,#1a1a26);border:1px solid var(--bord,rgba(255,255,255,.1));' +
        'border-radius:10px;padding:10px 14px;cursor:pointer';
      const summary = document.createElement('summary');
      summary.style.cssText = 'font-weight:600;cursor:pointer;list-style:none';
      summary.textContent = String(front).replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, '$1');
      item.appendChild(summary);
      const body = document.createElement('div');
      body.style.cssText = 'margin-top:8px;opacity:.85;font-size:.92rem';
      body.textContent = String(back).replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, '$1');
      item.appendChild(body);
      list.appendChild(item);
    });

    done.appendChild(list);
  }

  const btnRow = document.createElement('div');
  btnRow.className = 'fc-done-buttons';
  btnRow.style.cssText =
    'display:flex;gap:12px;margin-top:20px;justify-content:center;flex-wrap:wrap';

  if (missed > 0) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-primary';
    retryBtn.textContent = '🔁 Retry Weak Cards';
    const missedIdsSnapshot = [...CRAM.missedIds];
    const deckIdSnapshot    = CRAM.deckId;
    retryBtn.onclick = () => {
      el('fcDone')?.classList.add('hidden');
      el('fcSession')?.classList.remove('hidden');
      startCramSessionFromIds(deckIdSnapshot, missedIdsSnapshot);
    };
    btnRow.appendChild(retryBtn);
  }

  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn-secondary';
  doneBtn.textContent = 'Done';
  doneBtn.onclick = () => _cramExitSession();
  btnRow.appendChild(doneBtn);

  // Buttons first, then the missed-cards list below
  done.appendChild(btnRow);

  if (missed > 0) {
    const list = done.querySelector('.cram-missed-list');
    if (list) done.appendChild(list);
  }
}

// ─── _cramExitSession ────────────────────────────────────────────────────────
// Tears down cram state and returns the UI to the idle state.
//
// Critically: clears _cramModeExplicit and resets the dropdown to 'normal'
// so the next "Study this deck" click loads a normal FSRS session, not cram.

function _cramExitSession() {
  const deckId = CRAM.deckId;

  // Tear down cram state.
  CRAM.active         = false;
  CRAM.deckId         = null;
  CRAM.sessionCardIds = [];
  CRAM.cardsById      = {};
  CRAM.currentIndex   = 0;
  CRAM.reviewedIds    = null;
  CRAM.missedIds      = null;

  if (T.cramScope) T.cramScope = null;

  T.fcQueue       = [];
  T.fcIdx         = 0;
  T.fcAnswerShown = false;

  _cramRemoveEndButton();
  _cramRestoreNormalButtons();

  // Clear the explicit flag — this is what prevents the next loadFlashcards
  // call from accidentally re-entering cram just because the dropdown still
  // shows 'cram' in the DOM.
  _cramModeExplicit = false;

  // Reset the mode dropdown to 'normal' so the UI matches the cleared flag.
  const modeFilter = el('fcModeFilter');
  if (modeFilter) modeFilter.value = 'normal';

  // Keep the cram deck selected so "Study" from idle picks it up naturally.
  if (deckId) {
    const deckSel = el('fcDeckFilter');
    if (deckSel) deckSel.value = deckId;
  }

  // Show idle. Do NOT call loadFlashcards — that would read the dropdown
  // again and could still misbehave if called before the DOM settles.
  el('fcSession')?.classList.add('hidden');
  el('fcDone')?.classList.add('hidden');
  el('fcIdle')?.classList.remove('hidden');

  if (typeof renderFC === 'function') renderFC();
}

// ─── FONT SCALE ───────────────────────────────────────────────────────────────

function applyFcFontScale(scale) {
  const v = Math.max(0.5, Math.min(2.5, Number(scale) || 1));
  document.querySelectorAll('.fc-card, .dv-card').forEach(el => {
    el.style.setProperty('--fc-font-scale', String(v));
  });
  document.documentElement.style.setProperty('--fc-font-scale', String(v));
}

// ─── AUTO-INIT ────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupFlashcardEvents);
} else {
  setupFlashcardEvents();
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

window.renderFC                     = renderFC;
window.loadFlashcards               = loadFlashcards;
window.openFlashcardTopic           = openFlashcardTopic;
window.renderFcCard                 = renderFcCard;
window.fcShowAnswer                 = fcShowAnswer;
window.fcRate                       = fcRate;
window.advanceFcCard                = advanceFcCard;
window.fcUndo                       = fcUndo;
window.fcRedo                       = fcRedo;
window.fcPrevCard                   = fcPrevCard;
window.fcNextCard                   = fcNextCard;
window.showFcDone                   = showFcDone;
window.stopFcSession                = stopFcSession;
window.updateUndoRedoBtns           = updateUndoRedoBtns;
window.setupFlashcardEvents         = setupFlashcardEvents;
window.buildFlashcardPriorityQueue  = buildFlashcardPriorityQueue;
window.fcGetNextReviewAtMs          = fcGetNextReviewAtMs;
window.fcIsDueByTimestampNow        = fcIsDueByTimestampNow;
window.getCard                      = getCard;
window.ensureCard                   = ensureCard;
window.bindRatingButtons            = bindRatingButtons;
window.fcToggleHideQuestion         = fcToggleHideQuestion;
window.fcApplyHideQuestionSetting   = fcApplyHideQuestionSetting;
window.applyFcFontScale             = applyFcFontScale;
window.startCramSession             = startCramSession;
window.startCramSessionFromIds      = startCramSessionFromIds;
window.cramExitSession              = _cramExitSession;
window.fcEnhanceCardEl              = fcEnhanceCardEl;