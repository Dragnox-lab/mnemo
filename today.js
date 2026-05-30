'use strict';

// ============================================
// EVENT-DRIVEN REFRESH
// renderToday() is now invoked on demand via the 'mnemo:today-changed'
// custom event, dispatched at the actual mutation points (card rating,
// deck changes, resets). The previous 5-second polling timer has been
// removed — it ran unconditionally even when nothing had changed.
// ============================================

function notifyTodayChanged() {
  window.dispatchEvent(new CustomEvent('mnemo:today-changed'));
}

// ============================================
// PWA INSTALL BANNER (mobile only, inside Today section)
// Dismissible: hidden permanently once user clicks Dismiss
// (state.pwaDismissed persisted via AppStore).
// ============================================

function _isMnemoMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function _isMnemoStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
}

function _isMnemoIOS() {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent) && !window.MSStream;
}

function _hasDeferredPrompt() {
  if (window.deferredPrompt) return true;
  if (window.MnemoInstall && window.MnemoInstall.hasPrompt && window.MnemoInstall.hasPrompt()) return true;
  return false;
}

async function _triggerInstallPrompt() {
  const dp = window.deferredPrompt;
  if (dp) {
    dp.prompt();
    const choice = await dp.userChoice;
    const accepted = choice && choice.outcome === 'accepted';
    if (accepted) window.deferredPrompt = null;
    return accepted;
  }
  if (window.MnemoInstall && window.MnemoInstall.trigger) {
    return window.MnemoInstall.trigger();
  }
  return false;
}

// Renamed to match the documented flow: showPWAPrompt().
// refreshInstallBanner() kept as an alias for existing call sites.
function showPWAPrompt() {
  const banner = document.getElementById('installBanner');
  if (!banner) return;

  // Gate: mobile only, not already installed, not dismissed.
  if (!_isMnemoMobile() || _isMnemoStandalone() || (typeof state !== 'undefined' && state.pwaDismissed)) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  const hasPrompt = _hasDeferredPrompt();
  const iOS = _isMnemoIOS();

  banner.classList.remove('hidden');

  if (hasPrompt) {
    banner.innerHTML = `
      <div class="ib-icon" aria-hidden="true">⤓</div>
      <div class="ib-text">
        <div class="ib-title">Install Mnemo</div>
        <div class="ib-sub">Add to your home screen for the full app experience.</div>
      </div>
      <div class="ib-actions">
        <button class="btn-primary ib-btn" id="installBannerBtn" type="button">Install</button>
        <button class="btn-ghost ib-btn-dismiss" id="installBannerDismiss" type="button" aria-label="Dismiss install prompt">Dismiss</button>
      </div>
    `;
    banner.querySelector('#installBannerBtn')?.addEventListener('click', async () => {
      try {
        const accepted = await _triggerInstallPrompt();
        if (accepted) showPWAPrompt();
      } catch (e) {
        console.warn('[Mnemo] install prompt failed', e);
      }
    });
  } else if (iOS) {
    banner.innerHTML = `
      <div class="ib-icon" aria-hidden="true">📱</div>
      <div class="ib-text">
        <div class="ib-title">Install Mnemo on iOS</div>
        <div class="ib-sub">Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>.</div>
      </div>
      <div class="ib-actions">
        <button class="btn-ghost ib-btn-dismiss" id="installBannerDismiss" type="button" aria-label="Dismiss install prompt">Dismiss</button>
      </div>
    `;
  } else {
    // Android/other mobile browsers where beforeinstallprompt hasn't fired
    // (criteria not yet met, or browser doesn't support programmatic install).
    // Show manual instructions instead of hiding — this is the "loud and clear" path.
    banner.innerHTML = `
      <div class="ib-icon" aria-hidden="true">📦</div>
      <div class="ib-text">
        <div class="ib-title">Install Mnemo</div>
        <div class="ib-sub">Open your browser menu (⋮) and tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</div>
      </div>
      <div class="ib-actions">
        <button class="btn-ghost ib-btn-dismiss" id="installBannerDismiss" type="button" aria-label="Dismiss install prompt">Dismiss</button>
      </div>
    `;
  }

  banner.querySelector('#installBannerDismiss')?.addEventListener('click', () => {
    if (typeof state !== 'undefined') {
      state.pwaDismissed = true;
      if (typeof save === 'function') save();
    }
    banner.classList.add('hidden');
    banner.innerHTML = '';
  });
}

// Back-compat alias — existing callers use refreshInstallBanner().
function refreshInstallBanner() { showPWAPrompt(); }

// Refresh the banner whenever the install prompt becomes available.
window.addEventListener('mnemo:install-available', () => {
  if (document.getElementById('section-today')?.classList.contains('active')) {
    showPWAPrompt();
  }
});

// ============================================
// LIVE TIMER  (per-second badge countdown on minute-step cards)
// ============================================

let _liveTimerInterval = null;

// Tracks the currently-selected deck chip ('all' or a deck id).
// Synced to the hidden #todayDeckFilter select so all existing callers
// (startSession, card-click handler, etc.) keep reading from the select
// unchanged — chips just update the select value and trigger renderToday.
let _activeDeckChip = 'all';

/**
 * Formats remaining milliseconds as a human-readable string.
 *   <= 0      → "Ready"
 *   < 60 000  → "Xs"
 *   otherwise → "Xm Ys"
 */
function formatTimeRemaining(ms) {
  if (ms <= 0) return 'Ready';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

function startLiveTimers() {
  stopLiveTimers();
  // Cache the section reference and the matching nodes so we don't
  // re-query the whole DOM every second. Nodes are re-cached only when
  // the underlying list mutates (handled by 'mnemo:today-changed').
  const todaySection = document.getElementById('section-today');
  let _cachedNodes = null;
  let _cacheStamp = 0;
  const refreshCache = () => {
    _cachedNodes = todaySection
      ? todaySection.querySelectorAll(
          '.due-item[data-pile="learning"], .due-item[data-pile="relearning"]'
        )
      : [];
    _cacheStamp = Date.now();
  };
  // Invalidate cache whenever Today re-renders.
  window.addEventListener('mnemo:today-changed', () => { _cachedNodes = null; });

  _liveTimerInterval = setInterval(() => {
    // Only tick while the Today section is the active view.
    if (!todaySection?.classList.contains('active')) return;
    if (document.hidden) return; // skip work when tab is in background
    if (!_cachedNodes) refreshCache();
    if (!_cachedNodes.length) return;

    const now = Date.now();
    _cachedNodes.forEach(item => {
      const badge      = item.querySelector('.due-pile');
      const nextReview = Number(item.dataset.nextReviewAt);
      if (!badge) return;

      const remaining = nextReview ? nextReview - now : 0;
      const isReady   = remaining <= 0;
      const prefix    = item.dataset.pile === 'relearning' ? '🔁 Relearning' : '📖 Learning';

      if (isReady) {
        badge.textContent = `${prefix} · ✅ Ready`;
        badge.style.color = '#22c55e';
      } else {
        badge.textContent = `${prefix} · ⏱️ ${formatTimeRemaining(remaining)}`;
        badge.style.color = '';
      }
    });
  }, 1_000);
}

function stopLiveTimers() {
  if (_liveTimerInterval !== null) {
    clearInterval(_liveTimerInterval);
    _liveTimerInterval = null;
  }
}

// ============================================
// CLOZE FALLBACKS
// ============================================

if (typeof renderClozeQ === 'undefined') {
  window.renderClozeQ = (title) =>
    (typeof esc === 'function' ? esc : (s) => s)(
      title.replace(/\{\{c\d+::(.+?)\}\}/g, '[...]')
    );
}
if (typeof renderClozeA === 'undefined') {
  window.renderClozeA = (title) =>
    title.replace(/\{\{c\d+::(.+?)\}\}/g, (_, ans) =>
      `<span class="cloze-answer">${typeof esc === 'function' ? esc(ans) : ans}</span>`
    );
}

// ============================================
// HEADER BUTTONS
// Sessions now live in Flashcards, so we only track whether the
// session queue contains any actionable cards.
// ============================================

function updateTodayHeaderButtons(sessionTotal) {
  const startBtn    = el('startSessionBtn');
  const reviewedBtn = el('reviewAgainHeaderBtn');
  const resetBtn    = el('resetTodayHeaderBtn');

  // Start Review button: always present, disabled + faded when no cards are ready.
  if (startBtn) {
    const isEmpty = sessionTotal === 0;
    startBtn.disabled = isEmpty;
    startBtn.classList.toggle('is-empty', isEmpty);
    // Never hide the button — only the disabled/opacity state changes.
    startBtn.classList.remove('hidden');
  }

  // "View Again": only visible once at least 1 card has been rated today.
  if (reviewedBtn) {
    const hasDone = (state.todayDone || []).length > 0;
    reviewedBtn.classList.toggle('hidden', !hasDone);
  }

  // "Reset Today": only visible when there are undoable reviews.
  if (resetBtn) {
    const hasUndo = Object.keys(state.todayUndo || {}).length > 0;
    resetBtn.classList.toggle('hidden', !hasUndo);
  }
}

// ============================================
// HELPERS
// ============================================

function parseStartDateToMs(startDate) {
  if (!startDate || typeof startDate !== 'string') return null;
  const parsed = parseD(startDate);
  const ms     = parsed instanceof Date ? parsed.getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function getReviewRetentionPercent(card) {
  try {
    if (!card?.state?.stability || !card?.lastReviewedAt) return 100;
    const stability   = Number(card.state.stability);
    const elapsedDays = Math.max(0, (Date.now() - Number(card.lastReviewedAt)) / 86_400_000);
    if (!Number.isFinite(stability) || stability <= 0 || !Number.isFinite(elapsedDays)) return 100;
    const retention = Math.pow(0.9, elapsedDays / stability) * 100;
    if (!Number.isFinite(retention)) return 100;
    return Math.max(0, Math.min(100, retention));
  } catch {
    return 100;
  }
}

function getLearningStepMinutes(card) {
  const isRelearning = card?.pile === 'relearning';
  const steps = isRelearning
    ? (window.SCHEDULER_CONFIG?.RELEARNING_STEPS || [10])
    : (window.SCHEDULER_CONFIG?.LEARNING_STEPS   || [1, 10]);
  const stepIndex = Number.isInteger(card?.stepIndex) ? card.stepIndex : 0;
  const safeIndex = Math.max(0, Math.min(stepIndex, steps.length - 1));
  return Number(steps[safeIndex]) || 0;
}

function queueTopicWithMeta(topic, meta = {}) {
  return { ...topic, __queueMeta: { ...meta } };
}

function getNextReviewAtMs(card) {
  const raw = card?.nextReviewAt;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isDueByTimestampNow(card, now = Date.now()) {
  if (!card?.state) {
    const nextMs = getNextReviewAtMs(card);
    return nextMs === null || nextMs <= now;
  }
  const nextMs = getNextReviewAtMs(card);
  if (nextMs === null) return true;
  return nextMs <= now;
}

function isStillLearning(card) {
  return card?.pile === 'learning' || card?.pile === 'relearning';
}

// ============================================
// VISUAL PRIORITY QUEUE  (used only for renderDueList)
//
// Includes ALL minute-step cards regardless of whether their timer
// has expired, so the user can see them and watch the countdown.
// This queue is NEVER used as a study session queue.
// ============================================

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

function buildTodayPriorityQueue(deckId = 'all') {
  const now           = Date.now();

  // ── Filtered-deck fast-path ──────────────────────────────────────────────
  // If deckId starts with 'f_' or 'filtered:' it refers to a filtered deck.
  // Resolve the matching topic set via buildFilteredDeckTopicIds, then run
  // the same scheduling logic on just those topics.
  const _filteredDeckId = deckId && typeof deckId === 'string'
    ? (deckId.startsWith('filtered:') ? deckId.slice('filtered:'.length) : deckId.startsWith('f_') ? deckId : null)
    : null;

  if (_filteredDeckId) {
    const _fd = typeof getFilteredDeckById === 'function' ? getFilteredDeckById(_filteredDeckId) : null;
    // Static snapshot — filtered decks are frozen until rebuilt (see browser.js)
    const _fdTopicIds = _fd && typeof getFilteredDeckSnapshot === 'function'
      ? getFilteredDeckSnapshot(_fd)
      : new Set(_fd?.cardIds || []);

    // Filtered decks have NO daily new-card limit of their own and do NOT
    // share the global/root daily budget. We build the queue directly from
    // the snapshot, classifying each topic by its own scheduler state.
    // Every card in the snapshot that is actually due/learning/new is
    // included verbatim — no cap, no overflow bucket.
    const _doneIds      = new Set(state.todayDone || []);
    const _validDeckIds = new Set((state.decks || []).map(d => d.id));
    const _relearning = [];
    const _review     = [];
    const _learning   = [];
    const _newCards   = [];

    for (const topic of _expandTopics(state.topics || [])) {
      if (!topic?.id || !topic?.title) continue;
      const checkId = topic._origId || topic.id;
      if (!_fdTopicIds.has(checkId)) continue;
      if (isTopicHidden(topic)) continue;
      if (!topic.deckId || !_validDeckIds.has(topic.deckId)) continue;

      const _startMs = parseStartDateToMs(topic.startDate);
      if (_startMs !== null && _startMs > now) continue;

      const card = ensureCard(topic.id);

      if (card.pile === 'learning') {
        const stepIndex   = Number.isInteger(card.stepIndex) ? card.stepIndex : 0;
        const stepMinutes = getLearningStepMinutes(card);
        _learning.push(queueTopicWithMeta(topic, {
          group: 'learning', viewOnly: false, stepIndex, stepMinutes,
        }));
        continue;
      }
      if (card.pile === 'relearning') {
        _relearning.push(queueTopicWithMeta(topic, { group: 'relearning', viewOnly: false }));
        continue;
      }
      if (_doneIds.has(topic.id)) continue;
      if (card.pile === 'review') {
        if (!isDueByTimestampNow(card, now)) continue;
        const retention = getReviewRetentionPercent(card);
        _review.push(queueTopicWithMeta(topic, { group: 'review', viewOnly: false, retention }));
        continue;
      }
      if ((!card.pile || card.pile === 'new') && !card.lastReviewedAt) {
        _newCards.push(queueTopicWithMeta(topic, { group: 'new', viewOnly: false }));
        continue;
      }
    }

    _review.sort((a, b)   => (a.__queueMeta?.retention ?? 100) - (b.__queueMeta?.retention ?? 100));
    _learning.sort((a, b) => (a.__queueMeta?.stepIndex  ?? 0)   - (b.__queueMeta?.stepIndex  ?? 0));

    const _queue = [..._relearning, ..._review, ..._learning, ..._newCards];
    return {
      queue:        _queue,
      dueCount:     _relearning.length + _review.length + _learning.length,
      newCount:     _newCards.length,
      previewCount: 0,
    };
  }
  // ── End filtered-deck fast-path ──────────────────────────────────────────

  // The new-card daily limit is a SHARED budget across the entire deck tree
  // rooted at a top-level deck. Sub-decks do not get their own independent
  // budgets — they all draw from (and decrement) the root's single budget.
  //
  // Local helpers so this file does not hard-depend on renderdecks.js load order.
  const _decks = state.decks || [];
  // Pre-build parent map O(D) so _rootOf traversal is O(depth) with O(1) hops
  // instead of O(D) per hop via _decks.find.
  const _parentMap = new Map(_decks.map(d => [d.id, d.parentId || null]));
  const _rootOf = (id) => {
    if (typeof _getRootDeckId === 'function') return _getRootDeckId(id);
    let cur = id, safety = 0;
    while (cur && safety++ < 10) {
      const parent = _parentMap.get(cur);
      if (!parent) return cur;
      cur = parent;
    }
    return cur;
  };
  const _descendantIds = (rootId) => {
    const out = [rootId];
    const stack = [rootId];
    while (stack.length) {
      const cur = stack.pop();
      for (const d of _decks) {
        if (d.parentId === cur) { out.push(d.id); stack.push(d.id); }
      }
    }
    return out;
  };
  const _baseLimit = (id) => typeof getEffectiveNewLimit === 'function'
    ? getEffectiveNewLimit(id)
    : Math.max(0, Number(state.settings.newCardsPerDay || 0));
  // Fallback for _studied: count cards in this deck whose firstSeenAt was
  // set today. firstSeenAt is stamped the first time a new card is rated.
  // The previous fallback was a hardcoded 0, so the daily new-card budget
  // was always treated as fully unused and new cards kept refilling.
  const _today = typeof todayStr === 'function' ? todayStr()
    : new Date().toISOString().slice(0, 10);
  const _firstSeenTodaySet = new Set(
    Object.entries(state.sm2 || {}).filter(([, c]) => {
      if (!c.firstSeenAt) return false;
      return new Date(c.firstSeenAt).toISOString().slice(0, 10) === _today;
    }).map(([id]) => id)
  );
  const _studied = (id) => {
    if (typeof getStudiedNewTodayInDeck === 'function') return getStudiedNewTodayInDeck(id);
    // Count only cards directly in deck `id` (not its subtree).
    // The caller already iterates treeIds and sums _studied() per node,
    // so counting the subtree here would double-count every descendant.
    // _descendantIds returns an Array (no .has/.add), which caused the
    // previous version of this fallback to silently return 0 every time.
    return Array.from(_firstSeenTodaySet).filter(cardId => {
      const t = state.topics.find(x => x.id === cardId || (cardId.includes('_') && x.id === cardId.split('_')[0]));
      return t && t.deckId === id;
    }).length;
  };

  // Phase 1: build budget map keyed by ROOT deck ids only.
  let dailyNewLimit;
  let perRootBudget = null;
  if (deckId === 'all') {
    perRootBudget = {};
    for (const d of _decks) {
      if (d.parentId) continue; // roots only
      const treeIds = _descendantIds(d.id);
      const studiedTree = treeIds.reduce((sum, id) => sum + _studied(id), 0);
      perRootBudget[d.id] = Math.max(0, _baseLimit(d.id) - studiedTree);
    }
    dailyNewLimit = null;
  } else {
    const rootId = _rootOf(deckId);
    const treeIds = _descendantIds(rootId);
    const studiedTree = treeIds.reduce((sum, id) => sum + _studied(id), 0);
    dailyNewLimit = Math.max(0, _baseLimit(rootId) - studiedTree);
  }
  const doneIds       = new Set(state.todayDone || []);
  const validDeckIds  = new Set((state.decks || []).map(d => d.id));
  const isDeckPreviewEnabled = typeof isDeckPreviewUpcomingEnabled === 'function'
    ? isDeckPreviewUpcomingEnabled
    : () => false;

  const relearningPile = [];
  const reviewPile     = [];
  const learningPile   = [];
  const newPile        = [];

  for (const topic of _expandTopics(state.topics || [])) {
    if (!topic?.id || !topic?.title) continue;
    if (isTopicHidden(topic)) continue;
    if (!topic.deckId || !validDeckIds.has(topic.deckId)) continue;
    if (deckId !== 'all' && !isInDeck(topic.deckId, deckId)) continue;

    const startMs = parseStartDateToMs(topic.startDate);
    if (startMs !== null && startMs > now) continue;

    const card = ensureCard(topic.id);

    // Learning: always shown in Today list (timer controls interactivity, not visibility)
    if (card.pile === 'learning') {
      const stepIndex   = Number.isInteger(card.stepIndex) ? card.stepIndex : 0;
      const stepMinutes = getLearningStepMinutes(card);
      learningPile.push(queueTopicWithMeta(topic, {
        group: 'learning',
        viewOnly: false,
        stepIndex,
        stepMinutes,
      }));
      continue;
    }

    // Relearning: always shown in Today list (same reason as above)
    if (card.pile === 'relearning') {
      relearningPile.push(queueTopicWithMeta(topic, { group: 'relearning', viewOnly: false }));
      continue;
    }

    // Cards already reviewed today are excluded from the visual list.
    if (doneIds.has(topic.id)) continue;

    if (card.pile === 'review') {
      if (!isDueByTimestampNow(card, now)) continue;
      const retention = getReviewRetentionPercent(card);
      reviewPile.push(queueTopicWithMeta(topic, { group: 'review', viewOnly: false, retention }));
      continue;
    }

    if ((!card.pile || card.pile === 'new') && !card.lastReviewedAt) {
      newPile.push(queueTopicWithMeta(topic, { group: 'new', viewOnly: false }));
      continue;
    }
  }

  reviewPile.sort((a, b)   => (a.__queueMeta?.retention ?? 100) - (b.__queueMeta?.retention ?? 100));
  learningPile.sort((a, b) => (a.__queueMeta?.stepIndex  ?? 0)   - (b.__queueMeta?.stepIndex  ?? 0));

  // Deterministic stable order so Today and Flashcards select the SAME
  // subset of new cards within the daily limit (prevents "Reviewed Today"
  // mislabel when opening a card from Today's list).
  const shuffledNew = [...newPile];
  // When deckId === 'all', apply each deck's own limit independently.
  // When a specific deck is selected, apply the single dailyNewLimit.
  let newLimited, newOverflow;
  if (perRootBudget !== null) {
    const usedPerRoot = {};
    newLimited  = [];
    newOverflow = [];
    for (const t of shuffledNew) {
      const rootId = _rootOf(t.deckId);
      if (usedPerRoot[rootId] === undefined) usedPerRoot[rootId] = 0;
      const slot = perRootBudget[rootId] ?? 0;
      if (usedPerRoot[rootId] < slot) {
        usedPerRoot[rootId]++;
        newLimited.push(t);
      } else if (isDeckPreviewEnabled(t.deckId)) {
        newOverflow.push(queueTopicWithMeta(t, {
          ...(t.__queueMeta || {}),
          group: 'newOverflow',
          viewOnly: true,
        }));
      }
    }
  } else {
    newLimited  = shuffledNew.slice(0, dailyNewLimit);
    newOverflow = shuffledNew
      .slice(dailyNewLimit)
      .filter(t => isDeckPreviewEnabled(t.deckId))
      .map(t => queueTopicWithMeta(t, {
        ...(t.__queueMeta || {}),
        group: 'newOverflow',
        viewOnly: true,
      }));
  }

  const queue = [
    ...relearningPile,
    ...reviewPile,
    ...learningPile,
    ...newLimited,
    ...newOverflow,
  ];

  return {
    queue,
    dueCount:     relearningPile.length + reviewPile.length + learningPile.length,
    newCount:     newLimited.length,
    previewCount: newOverflow.length,
  };
}

// ============================================
// SESSION QUEUE  (used by Start Session)
//
// Derived from the visual queue but with one extra filter:
// minute-step cards whose nextReviewAt is still in the future are
// removed, because the user cannot rate them until the timer expires.
// Review, new, and preview cards pass through unchanged.
// ============================================

function buildSessionQueue(deckId = 'all') {
  const now = Date.now();
  const { queue } = buildTodayPriorityQueue(deckId);

  return queue.filter(topic => {
    const meta = topic.__queueMeta || {};
    if (meta.group === 'learning' || meta.group === 'relearning') {
      // Only include minute-step cards whose timer has already expired.
      const card = ensureCard(topic.id);
      return isDueByTimestampNow(card, now);
    }
    // All other card types (review, new, preview) are always included.
    return true;
  });
}

// ============================================
// RENDER TODAY
// ============================================

function renderToday() {
  const today     = todayStr();
  const dateLabel = el('todayDateLabel');
  if (dateLabel) {
    dateLabel.textContent = new Date(today + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  }

  // Refresh PWA install banner (mobile only; non-dismissible)
  refreshInstallBanner();

  const filterDeck = el('todayDeckFilter')?.value || 'all';
  const { queue, dueCount, newCount, previewCount } = buildTodayPriorityQueue(filterDeck);

  const done  = state.todayDone ? state.todayDone.length : 0;
  const total = queue.length;

  console.log(`[Today] Visual queue — Due:${dueCount} New:${newCount} Preview:${previewCount} Total:${total}`);

  const _set = (id, val) => { const e = el(id); if (e) e.textContent = val; };
  _set('statDue',         dueCount + newCount);
  _set('statDueMs',       dueCount + newCount);
  _set('statNew',         newCount);
  _set('statDone',        done);
  _set('statStreakToday', state.currentStreak || 0);
  _set('streakNum',       state.currentStreak || 0);
  _set('mobStreak',       state.currentStreak || 0);

  // Streak pill inside Today section
  _set('todayStreakCount', state.currentStreak || 0);

  // Circular progress ring: done / (done + due + new), clamped 0–100.
  const _progressTotal = done + dueCount + newCount;
  const _pct = _progressTotal > 0 ? Math.round((done / _progressTotal) * 100) : 0;
  _set('todayProgressPct', _pct + '%');
  const _arc = el('todayProgressArc');
  if (_arc) {
    // Circumference = 2π × r = 2π × 40 ≈ 251.33
    const _circ = 251.33;
    _arc.style.strokeDashoffset = String(_circ * (1 - _pct / 100));
  }

  // Per-deck counts for chip badges — derived from the ALREADY-BUILT main queue
  // instead of calling buildTodayPriorityQueue once per parent deck (was O(P*T)).
  // We need the 'all' queue to extract per-root counts from, so build it once here
  // if the current filter is a specific deck (main queue already covers 'all' path).
  const _allQueue = filterDeck === 'all'
    ? queue
    : buildTodayPriorityQueue('all').queue;

  // Build a parentId lookup map once, O(D), for root resolution.
  const _deckParentMap = new Map((state.decks || []).map(d => [d.id, d.parentId || null]));
  const _getRootId = (deckId) => {
    let cur = deckId, safety = 0;
    while (cur && safety++ < 10) {
      const parent = _deckParentMap.get(cur);
      if (!parent) return cur;
      cur = parent;
    }
    return cur;
  };

  const _perDeckCounts = {};
  for (const t of _allQueue) {
    const g = t.__queueMeta?.group;
    if (g === 'viewOnly' || g === 'newOverflow') continue; // not actionable
    const rootId = _getRootId(t.deckId);
    if (rootId) _perDeckCounts[rootId] = (_perDeckCounts[rootId] || 0) + 1;
  }

  // "All" total: use already-computed value when filterDeck is 'all',
  // otherwise sum across all parent decks.
  const _allTotal = filterDeck === 'all'
    ? dueCount + newCount
    : Object.values(_perDeckCounts).reduce((a, b) => a + b, 0);

  // Render deck chips with per-deck counts
  renderDeckChips(_perDeckCounts, _allTotal);

  // Update sticky start review visibility
  var stickyBtn = el('stickyStartReview');
  if (stickyBtn) stickyBtn.style.display = (dueCount + newCount) > 0 ? '' : 'none';

  const goal    = state.settings.dailyGoal || 20;
  const goalPct = Math.min(100, Math.round((done / goal) * 100));
  el('dgmFill').style.width = goalPct + '%';
  el('dgmNums').textContent = `${done}/${goal}`;

  const badge = el('todayBadge');
  if (badge) {
    badge.textContent = total;
    badge.classList.toggle('hidden', total === 0);
  }

  // Header buttons: use session queue count (excludes non-expired minute-step cards)
  // so "Start Session" only activates when at least one card is actually rateable.
  const sessionQueue = buildSessionQueue(filterDeck);
  console.log(`[Today] Session queue (actionable) — ${sessionQueue.length} cards`);
  updateTodayHeaderButtons(sessionQueue.length);

  renderDueList(queue, done, total, { dueCount, newCount, previewCount }, filterDeck);
}

// ============================================
// DUE & NEW HELPERS  (kept for external callers)
// ============================================

function getDueCardsForToday(deckId = 'all') {
  const today      = todayStr();
  // Pre-build O(D) lookup Sets so the per-topic filter is O(1) instead of O(D)+O(done)
  const deckIdSet  = new Set(state.decks.map(d => d.id));
  const doneSet    = new Set(state.todayDone || []);
  return _expandTopics(state.topics).filter(t => {
    if (!t?.id || !t?.title) return false;
    if (!t.deckId || !deckIdSet.has(t.deckId)) return false;
    if (t.startDate && t.startDate > today) return false;
    if (deckId !== 'all' && !isInDeck(t.deckId, deckId)) return false;
    if (doneSet.has(t.id)) return false;
    const card = ensureCard(t.id);
    if (card.pile === 'new' || !card.state) return false;
    return isDueByTimestampNow(card);
  });
}

function getNewCardsForToday(deckId = 'all', limit = 20) {
  const today      = todayStr();
  // Pre-build O(D) lookup Sets so the per-topic filter is O(1) instead of O(D)+O(done)
  const deckIdSet  = new Set(state.decks.map(d => d.id));
  const doneSet    = new Set(state.todayDone || []);
  return _expandTopics(state.topics).filter(t => {
    if (!t?.id || !t?.title) return false;
    if (!t.deckId || !deckIdSet.has(t.deckId)) return false;
    if (t.startDate && t.startDate > today) return false;
    if (deckId !== 'all' && !isInDeck(t.deckId, deckId)) return false;
    if (doneSet.has(t.id)) return false;
    const card = ensureCard(t.id);
    // Use !lastReviewedAt (same condition as buildTodayPriorityQueue) so that
    // cards restored by resetTodayReviews correctly appear as new here too.
    return (!card.pile || card.pile === 'new') && !card.lastReviewedAt;
  }).slice(0, limit);
}

// ============================================
// RENDER DECK CHIPS
//
// Builds the horizontal chip row under "Select Deck".
// Only parent decks (parentId is null/undefined) get a chip.
// Clicking a chip syncs the hidden #todayDeckFilter select so all
// existing callers (startSession, card-click handler, etc.) keep
// reading from the select without any changes.
// ============================================

function renderDeckChips(perDeckCounts = {}, allTotal = 0) {
  const container = el('deckChipList');
  if (!container) return;

  // Parent decks only — no sub-decks.
  const parentDecks = (state.decks || []).filter(d => !d.parentId);

  // Filtered decks get their own chips too, with their own due counts.
  const filteredDecks = state.filteredDecks || [];

  // Build per-filtered-deck due counts using the same fast-path.
  const perFilteredDeckCounts = {};
  filteredDecks.forEach(fd => {
    const result = buildTodayPriorityQueue(fd.id);
    perFilteredDeckCounts[fd.id] = result.dueCount + result.newCount;
  });

  // Build the chip list: "All" first, then parent decks, then filtered decks.
  const chips = [
    { id: 'all', name: 'All', isFiltered: false },
    ...parentDecks.map(d => ({ id: d.id, name: d.name || 'Unnamed', isFiltered: false })),
    ...filteredDecks.map(fd => ({ id: fd.id, name: fd.name || 'Filtered', isFiltered: true })),
  ];

  // Preserve scroll position across rebuilds.
  const prevScroll = container.scrollLeft;

  container.innerHTML = '';

  chips.forEach(({ id, name, isFiltered }) => {
    const count = id === 'all'
      ? allTotal
      : isFiltered
        ? (perFilteredDeckCounts[id] || 0)
        : (perDeckCounts[id] || 0);
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'deck-chip' + (id === _activeDeckChip ? ' active' : '') + (isFiltered ? ' deck-chip--filtered' : '');
    btn.dataset.deckId = id;

    // Label: name + count badge when count > 0
    // Filtered deck chips get a ⚡ prefix so they're visually distinct.
    const displayName = isFiltered ? '⚡ ' + name : name;
    if (count > 0) {
      const nameNode = document.createTextNode(displayName + ' ');
      const badge = document.createElement('span');
      badge.className = 'deck-chip-count';
      badge.textContent = count;
      btn.appendChild(nameNode);
      btn.appendChild(badge);
    } else {
      btn.textContent = displayName;
    }

    btn.addEventListener('click', () => {
      if (_activeDeckChip === id) return; // already active — no-op
      _activeDeckChip = id;

      // Sync the hidden select so startSession / card-click handler still work.
      const sel = el('todayDeckFilter');
      if (sel) {
        // Ensure the option exists (parent deck may not be in the select yet).
        if (!Array.from(sel.options).some(o => o.value === id)) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = name;
          sel.appendChild(opt);
        }
        sel.value = id;
      }

      renderToday();
    });

    container.appendChild(btn);
  });

  // Restore scroll position so active chip doesn't jump.
  container.scrollLeft = prevScroll;
}

// ============================================
// RENDER DUE LIST
// ============================================

function renderDueList(queue, done, total, counts = { dueCount: 0, newCount: 0, previewCount: 0 }, filterDeck = 'all') {
  const list = el('todayDueList');
  if (!list) return;

  list.innerHTML = '';

  // Pre-build deck lookup map O(D) so per-card deck resolution is O(1) not O(D).
  const _deckMap = new Map((state.decks || []).map(d => [d.id, d]));

  if (total === 0) {
    const msg = done === 0
      ? 'All caught up! No reviews due today.'
      : `All ${done} reviews done for today! 🎉`;
    list.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">${done === 0 ? '✨' : '🎉'}</div>
        <div class="es-msg">${msg}</div>
      </div>`;
    return;
  }

  const doneIds = new Set(state.todayDone || []);
  const now     = Date.now();

  queue.forEach(t => {
    if (!t?.id) return;

    // Learning / relearning cards are never in todayDone — keep them visible.
    const meta            = t.__queueMeta || {};
    const isLearningGroup = meta.group === 'learning' || meta.group === 'relearning';
    if (!isLearningGroup && doneIds.has(t.id)) return;

    try {
      const deck = _deckMap.get(t.deckId)
        || { name: 'Uncategorized', color: '#7B6EF6' };
      const card = ensureCard(t.id);

      const pileClass = meta.group === 'newOverflow' ? 'nvp'
        : meta.group === 'viewOnly' || meta.group === 'viewOnly' ? 'vp'
        : meta.group === 'relearning' ? 'rlp'
        : meta.group === 'learning'   ? 'lp'
        : meta.group === 'review'     ? 'rp'
        : 'np';

      const dataPile = meta.group === 'learning'   ? 'learning'
                     : meta.group === 'relearning' ? 'relearning'
                     : meta.group === 'review'     ? 'review'
                     : 'other';

      const nextMs = getNextReviewAtMs(card);

      let pileLabel  = '';
      let badgeStyle = '';

      if (meta.group === 'newOverflow') {
        pileLabel = '🆕 New · View Only (daily limit)';
      } else if (meta.group === 'viewOnly') {
        pileLabel = '👁️ Reviewed Today · View Only';
      } else if (meta.group === 'relearning') {
        const remaining = nextMs ? nextMs - now : 0;
        if (remaining > 0) {
          pileLabel = `🔁 Relearning · ⏱️ ${formatTimeRemaining(remaining)}`;
        } else {
          pileLabel  = '🔁 Relearning · ✅ Ready';
          badgeStyle = 'color:#22c55e';
        }
      } else if (meta.group === 'review') {
        pileLabel = `🔁 Review · ${Math.round(meta.retention ?? getReviewRetentionPercent(card))}%`;
      } else if (meta.group === 'learning') {
        const remaining = nextMs ? nextMs - now : 0;
        if (remaining > 0) {
          pileLabel = `📖 Learning · ⏱️ ${formatTimeRemaining(remaining)}`;
        } else {
          pileLabel  = '📖 Learning · ✅ Ready';
          badgeStyle = 'color:#22c55e';
        }
      } else {
        pileLabel = '🆕 New';
      }

      const div = document.createElement('div');
      div.className       = 'due-item';
      div.dataset.topicId = t.id;
      div.dataset.pile    = dataPile;
      if (nextMs !== null) div.dataset.nextReviewAt = String(nextMs);

      div.innerHTML = `
        <div class="due-dot" style="background:${deck.color}"></div>
        <div class="due-title"></div>
        <div class="due-deck-name"></div>
        <div class="due-pile ${pileClass}" style="${badgeStyle}">${pileLabel}</div>
      `;
      div.querySelector('.due-title').textContent     = t.title || '(Untitled)';
      div.querySelector('.due-deck-name').textContent = deck.name;
      list.appendChild(div);
    } catch (err) {
      console.warn('[renderDueList] Skipped malformed topic:', t?.id, err);
    }
  });
}

// ============================================
// START SESSION
//
// No longer runs an inline session inside Today.
// Switches to the Flashcards section with the appropriate filters
// pre-set and immediately loads the session queue.
// ============================================

function startSession() {
  const filterDeck   = el('todayDeckFilter')?.value || 'all';
  const sessionQueue = buildSessionQueue(filterDeck);

  if (!sessionQueue.length) {
    const msg = 'No cards are ready to review right now. Check back once a timer expires.';
    if (typeof showToast === 'function') showToast(msg, 'info');
    else alert(msg);
    return;
  }

  console.log(`[Today] Start Session → injecting ${sessionQueue.length} cards into Flashcards. Deck: "${filterDeck}"`);

  // ── 1. Tear down any lingering cram state ──────────────────────────────────
  //    If the user was in cram mode and navigated away without properly
  //    exiting, CRAM.active and _cramModeExplicit can still be set.
  //    Without this teardown the cram buttons remain and rating buttons stay
  //    hidden, making the session look broken.
  if (typeof CRAM !== 'undefined') {
    if (CRAM.active || window._cramModeExplicit) {
      CRAM.active         = false;
      CRAM.deckId         = null;
      CRAM.sessionCardIds = [];
      CRAM.cardsById      = {};
      CRAM.currentIndex   = 0;
      CRAM.reviewedIds    = null;
      CRAM.missedIds      = null;
      if (window.T && window.T.cramScope) window.T.cramScope = null;
      if (typeof _cramRemoveEndButton      === 'function') _cramRemoveEndButton();
      if (typeof _cramRestoreNormalButtons === 'function') _cramRestoreNormalButtons();
    }
  }

  // ── 2. Switch to Flashcards section ────────────────────────────────────────
  if (typeof switchSection === 'function') switchSection('flashcards');

  // ── 3. Sync dropdowns ──────────────────────────────────────────────────────
  const deckSel = el('fcDeckFilter');
  if (deckSel) deckSel.value = filterDeck;
  const typeSel = el('fcTypeFilter');
  if (typeSel) typeSel.value = 'due';
  const modeSel = el('fcModeFilter');
  if (modeSel) modeSel.value = 'normal';

  // ── 4. Clear any running session timer ─────────────────────────────────────
  if (window.T && window.T.fcTimerInterval) {
    clearInterval(window.T.fcTimerInterval);
    window.T.fcTimerInterval = null;
  }

  // ── 5. Compute counts from the pre-built queue ─────────────────────────────
  const dueCount = sessionQueue.filter(t => {
    const g = t.__queueMeta?.group;
    return g === 'review' || g === 'learning' || g === 'relearning';
  }).length;
  const newCount = sessionQueue.filter(t => t.__queueMeta?.group === 'new').length;

  // ── 6. Inject queue directly into flashcard session state ──────────────────
  //    Bypasses buildFlashcardPriorityQueue entirely, eliminating the
  //    queue-computation mismatch that caused new cards to go missing when
  //    learning cards were on a timer.
  window.T = window.T || {};
  Object.assign(window.T, {
    fcQueue:            sessionQueue,
    fcViewOnlyMode:     false,
    fcDueCount:         dueCount,
    fcNewCount:         newCount,
    fcPreviewCount:     0,
    fcIdx:              0,
    fcAnswerShown:      false,
    fcResults:          { again: 0, hard: 0, good: 0, easy: 0 },
    fcHistory:          [],
    fcRedoStack:        [],
    fcSeconds:          0,
    fcSessionRatedIds:  [],
    fcSessionRatedSet:  new Set(),
    fcHistoryMap:       new Map(),
    _fcRating:          false,
    _fcNavigating:      false,
    _fcJustShownAnswer: false,
    _fcNavGuard:        false,
  });

  // ── 7. Start the session timer ─────────────────────────────────────────────
  window.T.fcTimerInterval = setInterval(() => {
    window.T.fcSeconds++;
    const timer = el('fcTimer');
    if (timer) {
      const m = Math.floor(window.T.fcSeconds / 60);
      const s = window.T.fcSeconds % 60;
      timer.textContent = `${m}:${s < 10 ? '0' + s : s}`;
    }
  }, 1000);

  // ── 8. Show session UI ─────────────────────────────────────────────────────
  el('fcIdle')?.classList.add('hidden');
  el('fcDone')?.classList.add('hidden');
  el('fcSession')?.classList.remove('hidden');

  if (typeof updateUndoRedoBtns === 'function') updateUndoRedoBtns();
  if (typeof renderFcCard === 'function') renderFcCard();
  else console.error('[Today] renderFcCard() not available. Ensure flashcards.js is loaded first.');
}

// ============================================
// VIEW AGAIN  (replays today's rated cards, view-only)
//
// Uses state.todayDone so it covers every card rated during the day,
// whether the session started from Today or from a deck's Study button.
// Does NOT include unexpired minute-step cards.
// ============================================

function reviewAgain() {
  const replayIds = (T.lastSessQueueIds?.length)
    ? T.lastSessQueueIds
    : (state.todayDone || []);

  // Build a Map once for O(1) lookups instead of O(R×T) topics.find per id
  const topicMap = new Map(state.topics.map(t => [t.id, t]));
  const cards = replayIds
    .map(id => topicMap.get(id))
    .filter(Boolean);

  if (!cards.length) {
    if (typeof showToast === 'function') showToast('No reviewed cards to replay yet.', 'info');
    return;
  }

  // Delegate view-only replay to Flashcards: build a view-only queue
  // and inject it directly into the Flashcard session state.
  const replayQueue = cards.map(t =>
    queueTopicWithMeta(t, { group: 'viewOnly', viewOnly: true })
  );

  if (typeof switchSection === 'function') switchSection('flashcards');

  // Inject the queue into the shared T object used by flashcards.js.
  window.T = window.T || {};
  Object.assign(window.T, {
    fcQueue:           replayQueue,
    fcViewOnlyMode:    true,
    fcIdx:             0,
    fcAnswerShown:     false,
    fcResults:         { again: 0, hard: 0, good: 0, easy: 0 },
    fcHistory:         [],
    fcRedoStack:       [],
    fcSessionRatedIds: [],
    fcSessionRatedSet: new Set(),
    fcHistoryMap:      new Map(),
  });

  el('fcIdle')?.classList.add('hidden');
  el('fcDone')?.classList.add('hidden');
  el('fcSession')?.classList.remove('hidden');

  if (typeof renderFcCard === 'function') renderFcCard();
  else console.error('[Today] renderFcCard() not available. Ensure flashcards.js is loaded first.');
}

// ============================================
// SHOW REVIEWED CARDS  (legacy alias kept for any external callers)
// ============================================

function showReviewedCards() {
  reviewAgain();
}

// ============================================
// RESET TODAY'S REVIEWS
// ============================================

function resetTodayReviews() {
  const today = todayStr();
  const undo  = (state.todayUndo && typeof state.todayUndo === 'object') ? state.todayUndo : {};
  const undoIds = Object.keys(undo);

  if (!undoIds.length) {
    if (typeof showToast === 'function') showToast('Nothing to reset — no cards reviewed today yet.', 'info');
    return;
  }

  // 1) Restore each card's pre-review SM2/FSRS snapshot
  if (!state.sm2) state.sm2 = {};
  const undoSet = new Set(undoIds); // build once for O(1) lookups
  undoIds.forEach(id => {
    const snap = undo[id]?.sm2;
    if (snap && typeof snap === 'object') {
      const restoredSnap = JSON.parse(JSON.stringify(snap));

      // Defensive: if the snapshot was captured after firstSeenAt was already
      // set (legacy bug — fixed in fcRate but old stored data may still have
      // it), strip firstSeenAt so the card is treated as truly new again.
      // Without this, getStudiedNewTodayInDeck / rawNewCount (renderdecks.js)
      // see firstSeenAt as set and incorrectly count the card against the
      // daily new-card budget, making the card vanish from Today's list.
      if (!restoredSnap.lastReviewedAt &&
          (!restoredSnap.pile || restoredSnap.pile === 'new')) {
        delete restoredSnap.firstSeenAt;
      }

      state.sm2[id] = restoredSnap;
    } else {
      // No prior data — card was new before review; remove it so it's "new" again
      delete state.sm2[id];
    }
  });

  // Remove all reset cards from todayDone in a single pass (was O(n²) inside forEach)
  if (Array.isArray(state.todayDone)) {
    state.todayDone = state.todayDone.filter(x => !undoSet.has(x));
  }
  // Invalidate the O(1) set mirror in flashcards.js so it rebuilds from the
  // updated todayDone array on next access.
  if (typeof window._invalidateTodayDoneSet === 'function') window._invalidateTodayDoneSet();

  // 2) Trim today's reviewLog entries for restored cards
  if (state.reviewLog && Array.isArray(state.reviewLog[today])) {
    const restored = new Set(undoIds);
    state.reviewLog[today] = state.reviewLog[today].filter(e => !restored.has(e.cardId));
    if (!state.reviewLog[today].length) delete state.reviewLog[today];
  }

  // 3) Re-derive history count for today from remaining todayDone
  state.history[today] = (state.todayDone || []).length;

  // 4) Clear the undo map (one-shot per day)
  state.todayUndo = {};

  // 5) Reset transient session UI state
  if (window.T) {
    T.lastSessQueueIds  = [];
    T.fcQueue           = [];
    T.fcIdx             = 0;
    T.fcAnswerShown     = false;
    T.fcSessionRatedIds = [];
    T.fcSessionRatedSet = new Set();
    T.fcHistoryMap      = new Map();
    T.fcResults         = { again: 0, hard: 0, good: 0, easy: 0 };
  }

  if (window.IndexManager?.scheduleRebuild) window.IndexManager.scheduleRebuild();
  if (typeof invalidateDueCountCache === 'function') invalidateDueCountCache();
  if (typeof recalcStreak  === 'function') recalcStreak();
  if (typeof saveImmediate === 'function') saveImmediate();

  // notifyTodayChanged() dispatches 'mnemo:today-changed', which the listener
  // in setupTodayEvents() already handles by calling renderToday(). Calling
  // renderToday() directly here as well would cause a double render.
  notifyTodayChanged();

  if (typeof showToast === 'function') {
    showToast(`Reset ${undoIds.length} card${undoIds.length === 1 ? '' : 's'} to pre-review state.`, 'success');
  }
}

// ============================================
// EVENT SETUP
// ============================================

let _todayEventsInitialized = false;

function setupTodayEvents() {
  if (_todayEventsInitialized) return;
  _todayEventsInitialized = true;

  // Primary action buttons
  el('startSessionBtn')?.addEventListener('click', startSession);
  el('reviewAgainHeaderBtn')?.addEventListener('click', reviewAgain);
  el('resetTodayReviewsBtn')?.addEventListener('click', resetTodayReviews);
  // New overview-card "Reset Today" button (Phase 2)
  el('resetTodayHeaderBtn')?.addEventListener('click', resetTodayReviews);

  // Deck chips replace the hidden select as the user-facing filter.
  // Render chips once on setup; they rebuild on every mnemo:today-changed.
  renderDeckChips();

  // ── Card click handler ──────────────────────────────────────────────────────
  el('todayDueList')?.addEventListener('click', (e) => {
    const row     = e.target.closest('.due-item');
    const topicId = row?.dataset?.topicId;
    if (!topicId) return;

    const pile = row.dataset.pile;

    // Timer-expiry guard for minute-step cards.
    if (pile === 'learning' || pile === 'relearning') {
      const nextReviewAt = Number(row.dataset.nextReviewAt);
      if (nextReviewAt && nextReviewAt > Date.now()) {
        const remaining = nextReviewAt - Date.now();
        const msg       = `Please wait ${formatTimeRemaining(remaining)} before reviewing this card.`;
        if (typeof showToast === 'function') showToast(msg);
        else alert(msg);
        return;         // Block — timer not yet expired.
      }
      // Timer has expired: fall through and open Flashcards normally.
    }

    // Open Flashcards with the card pre-selected.
    const deckFilter = el('todayDeckFilter')?.value || 'all';
    if (typeof openFlashcardTopic === 'function') {
      openFlashcardTopic(topicId, { deckFilter, dateFilter: 'due' });
    } else {
      console.error('[Today] openFlashcardTopic() not available.');
    }
  });

  // Re-render only when something actually changed.
  window.addEventListener('mnemo:today-changed', renderToday);

  // Start live (per-second badge) timers when Today is mounted.
  startLiveTimers();
}

// ============================================
// EXPORTS
// ============================================

window.renderToday           = renderToday;
window.startSession          = startSession;
window.reviewAgain           = reviewAgain;
window.showReviewedCards     = showReviewedCards;
window.resetTodayReviews     = resetTodayReviews;
window.buildTodayPriorityQueue = buildTodayPriorityQueue;
window.buildSessionQueue     = buildSessionQueue;
window.setupTodayEvents      = setupTodayEvents;
window.notifyTodayChanged    = notifyTodayChanged;
window.startLiveTimers       = startLiveTimers;
window.stopLiveTimers        = stopLiveTimers;
window.formatTimeRemaining   = formatTimeRemaining;
window.renderDueList         = renderDueList;
window.renderDeckChips       = renderDeckChips;
window.getDueCardsForToday   = getDueCardsForToday;
window.getNewCardsForToday   = getNewCardsForToday;