'use strict';

// ============================================================
// CONSTANTS
// ============================================================

const STORAGE_KEY      = 'mnemo_v6';
const TODAY_KEY        = 'mnemo_today_date';
const SAVE_DEBOUNCE_MS = 300;
const INDEX_REBUILD_DEBOUNCE_MS = 150; // safety-net rebuild delay
const MS_PER_DAY       = 86_400_000;

// Named calendar month indices — removes magic 0 / 11 comparisons
const JANUARY  = 0;
const DECEMBER = 11;

const FIXED_INTERVALS = Object.freeze([1, 3, 7, 14, 28, 30, 60, 90]);

const DECK_COLORS = Object.freeze([
  '#7B6EF6', '#36E8AA', '#FF5C7A', '#FFB547',
  '#4FC3F7', '#E040FB', '#FF8A65', '#26C6DA',
]);

const ESCAPE_MAP   = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCAPE_REGEX = /[&<>"']/g;

const STARTER_DECK = Object.freeze({
  id: 'starter', name: 'How Memory Works',
  desc: 'Learn why Mnemo works while you use it',
  color: '#7B6EF6', parentId: null, scheduleMode: 'auto',
});

const STARTER_CARDS = Object.freeze([
  { q: 'Your brain forgets 70% of new information within 24 hours — unless you do what?',                 a: 'Review it. This is called the Forgetting Curve, discovered by Hermann Ebbinghaus in 1885.' },
  { q: 'What is spaced repetition?',                                                                       a: 'Reviewing information at increasing intervals over time. The most scientifically proven method for building long-term memory.' },
  { q: 'True or False: Reviewing something once is enough to remember it permanently.',                    a: 'False. A single review fades quickly. Multiple spaced reviews build lasting memory.' },
  { q: 'What does your brain do while you sleep that makes sleep after studying so powerful?',             a: 'It consolidates and organizes memories from the day. Sleeping after studying is more effective than studying more.' },
  { q: 'The best time to review something is just before you forget it — True or False?',                 a: 'True. This is the core insight behind spaced repetition. Mnemo calculates exactly when that moment is.' },
  { q: 'What happens to the review interval each time you correctly remember a card?',                     a: 'It gets longer. The algorithm trusts your memory more and tests you less frequently over time.' },
  { q: 'What does rating a card "Again" do?',                                                              a: "Resets the interval. You'll see it again soon. No penalty — it just means you need more practice on that concept." },
  { q: 'Active recall vs passive review — which is more effective for memory?',                            a: 'Active recall. Being forced to retrieve information from memory strengthens it far more than re-reading or highlighting.' },
  { q: 'How many correctly spaced reviews does it typically take to move something into long-term memory?', a: 'Around 5 to 7 reviews spread over several weeks. After that, the intervals become months or even years.' },
  { q: 'What is Mnemo?',                                                                                   a: 'Your personal spaced repetition system. These 10 cards are now scheduled. Come back tomorrow to keep your streak alive.' },
]);

// ============================================================
// SETTINGS SCHEMA
// Single source of truth for defaults + validation.
// Used on load, on every write via updateSetting(), and in UI clamping.
// ============================================================

const SETTINGS_SCHEMA = Object.freeze({
  newCardsPerDay: { default: 20,       validate: v => Number.isInteger(v) && v >= 0  && v <= 9999 },
  previewUpcomingCardsDefault: { default: false, validate: v => typeof v === 'boolean' },
  dailyGoal:      { default: 20,       validate: v => Number.isInteger(v) && v >= 0  && v <= 9999 },
  theme:          { default: 'obsidian', validate: v => ['obsidian', 'blonde', 'irish', 'magenta'].includes(v) },
});

const validateSettings = (raw = {}) => {
  const out = {};
  for (const [key, rule] of Object.entries(SETTINGS_SCHEMA)) {
    const val = raw[key];
    out[key] = (val !== undefined && rule.validate(val)) ? val : rule.default;
  }
  return out;
};

// ============================================================
// APP STORE
// ============================================================

class AppStore {
  #data = {
    // Persisted
    decks:         [],
    topics:        [],
    pastCards:     [],
    journal:       {},
    history:       {},
    sm2:           {},
    goals:         [],
    todayDone:     [],
    todayUndo:     {},
    reviewLog:     {},
    settings:      validateSettings(),
    currentStreak: 0,
    bestStreak:    0,
    expertMode:        false,
    starterDismissed:  false,
    pwaDismissed:      false,
    filteredDecks:     [],
    // UI / navigation (not persisted)
    section:         'today',
    calYear:         0,
    calMonth:        0,
    calSelected:     null,
    jYear:           0,
    jMonth:          0,
    jSelected:       null,
    reviewSnapshots: {},
  };

  static #PERSISTED_KEYS = new Set([
    'decks', 'topics', 'pastCards', 'journal', 'history',
    'sm2', 'goals', 'todayDone', 'todayUndo', 'reviewLog', 'settings',
    'filteredDecks', 'currentStreak', 'bestStreak', 'expertMode', 'starterDismissed', 'pwaDismissed',
  ]);

  get(key)        { return this.#data[key]; }
  set(key, value) { this.#data[key] = value; }

  /**
   * Write a single settings key through the schema validator.
   * Invalid values are silently replaced with the schema default.
   */
  updateSetting(key, value) {
    const rule = SETTINGS_SCHEMA[key];
    if (!rule) { console.warn(`[MNEMO] Unknown setting key: "${key}"`); return; }
    this.#data.settings = {
      ...this.#data.settings,
      [key]: rule.validate(value) ? value : rule.default,
    };
  }

  serialize() {
    const out = {};
    for (const key of AppStore.#PERSISTED_KEYS) out[key] = this.#data[key];
    return out;
  }

  hydrate(raw) {
    this.#data.decks         = Array.isArray(raw.decks)                           ? raw.decks     : [];
    this.#data.topics        = Array.isArray(raw.topics)                          ? raw.topics    : [];
    this.#data.pastCards     = Array.isArray(raw.pastCards)                       ? raw.pastCards : [];
    this.#data.journal       = raw.journal  && typeof raw.journal  === 'object'   ? raw.journal   : {};
    this.#data.history       = raw.history  && typeof raw.history  === 'object'   ? raw.history   : {};
    this.#data.sm2           = raw.sm2      && !Array.isArray(raw.sm2)            ? raw.sm2       : {};
    this.#data.goals         = Array.isArray(raw.goals)                           ? raw.goals     : [];
    this.#data.todayDone     = Array.isArray(raw.todayDone)                       ? raw.todayDone : [];
    this.#data.todayUndo     = raw.todayUndo  && typeof raw.todayUndo  === 'object' && !Array.isArray(raw.todayUndo)  ? raw.todayUndo  : {};
    this.#data.reviewLog     = raw.reviewLog  && typeof raw.reviewLog  === 'object' && !Array.isArray(raw.reviewLog)  ? raw.reviewLog  : {};
    this.#data.filteredDecks = Array.isArray(raw.filteredDecks)                   ? raw.filteredDecks : [];
    this.#data.settings      = validateSettings(raw.settings);
    this.#data.currentStreak = Number.isInteger(raw.currentStreak) ? raw.currentStreak : 0;
    this.#data.bestStreak    = Number.isInteger(raw.bestStreak)    ? raw.bestStreak    : 0;
    this.#data.expertMode        = Boolean(raw.expertMode);
    this.#data.starterDismissed  = Boolean(raw.starterDismissed);
    this.#data.pwaDismissed      = Boolean(raw.pwaDismissed);
  }
}

const _store = new AppStore();
const state  = new Proxy(_store, {
  get(target, key) {
    if (key in target) return target[key];
    return target.get(key);
  },
  set(target, key, value) {
    target.set(key, value);
    return true;
  },
});

// ============================================================
// TRANSIENT STATE  (never persisted)
// ============================================================

const T = {
  sessQueue:          [],
  sessIdx:            0,
  sessAnswerShown:    false,
  sessViewOnly:       false,
  sessResults:        { again: 0, hard: 0, good: 0, easy: 0 },
  lastSessQueueIds:   [],
  fcQueue:            [],
  fcIdx:              0,
  fcAnswerShown:      false,
  fcResults:          { again: 0, hard: 0, good: 0, easy: 0 },
  fcTimerInterval:    null,
  fcSeconds:          0,
  fcHistory:          [],
  fcRedoStack:        [],
  pomInterval:        null,
  pomRunning:         false,
  pomBreak:           false,
  pomSecondsLeft:     0,
  editingDeckId:      null,
  editingTopicId:     null,
  currentDeckDetailId: null,
  csvRows:            [],
  manualDateCallback: null,
  journalTimer:       null,
  saveTimeout:        null,
  rebuildTimeout:     null,   // for IndexManager.scheduleRebuild
  selectedColor:      null,
  pendingDeleteId:    null,
  pendingDeleteType:  null,
  editingPastCard:    false,
  browseDeckFilter:   'all',
};

// ============================================================
// INDEX MANAGER
// ============================================================

const IndexManager = (() => {
  const byPile      = { new: new Set(), learning: new Set(), review: new Set() };
  const byDeck      = new Map();
  const dueTodaySet = new Set();

  const _tomorrow = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
    return d.getTime();
  };

  const _isDue = (card) => {
    if (!card?.nextReviewAt) return false;
    const pile = card.pile;
    if (pile === 'learning') return card.nextReviewAt < _tomorrow();
    if (pile === 'review')   return card.nextReviewAt <= Date.now();
    return false;
  };

  const _clearPile = (tid) => {
    byPile.new.delete(tid);
    byPile.learning.delete(tid);
    byPile.review.delete(tid);
  };

  const rebuild = () => {
    byPile.new.clear(); byPile.learning.clear(); byPile.review.clear();
    byDeck.clear(); dueTodaySet.clear();

    for (const topic of state.topics) {
      const { id: tid, deckId } = topic;
      if (!byDeck.has(deckId)) byDeck.set(deckId, new Set());
      byDeck.get(deckId).add(tid);

      const card = state.sm2[tid];
      if (!card) { byPile.new.add(tid); continue; }

      const pile = card.pile || 'new';
      if (byPile[pile]) byPile[pile].add(tid);
      if (_isDue(card)) dueTodaySet.add(tid);
    }
  };

  const scheduleRebuild = () => {
    if (T.rebuildTimeout) clearTimeout(T.rebuildTimeout);
    T.rebuildTimeout = setTimeout(rebuild, INDEX_REBUILD_DEBOUNCE_MS);
  };

  const markSeen = (tid, pile = 'learning') => {
    byPile.new.delete(tid);
    if (byPile[pile]) byPile[pile].add(tid);
  };

  const updateDue = (tid, nextReviewAt, pile) => {
    if (_isDue({ pile, nextReviewAt })) dueTodaySet.add(tid);
    else                                dueTodaySet.delete(tid);
  };

  // Centralized mutation wrapper — guarantees markSeen + updateDue + scheduleRebuild
  // fire together. Use this instead of chaining the three calls manually.
  const mutateCard = (tid, nextReviewAt, pile) => {
    markSeen(tid, pile);
    updateDue(tid, nextReviewAt, pile);
    scheduleRebuild();
  };

  const removeCard = (tid) => {
    _clearPile(tid);
    dueTodaySet.delete(tid);
    for (const set of byDeck.values()) set.delete(tid);
  };

  const resetCard = (tid) => {
    _clearPile(tid);
    dueTodaySet.delete(tid);
    byPile.new.add(tid);
  };

  const addCard = (tid, deckId) => {
    byPile.new.add(tid);
    if (!byDeck.has(deckId)) byDeck.set(deckId, new Set());
    byDeck.get(deckId).add(tid);
  };

  const _deckFilter = (filterDeckId) => {
    if (filterDeckId === 'all') return null;
    return new Set(getSubDeckIds(filterDeckId));
  };

  const getDueIds = (filterDeckId) => {
    const done    = new Set(state.todayDone);
    const deckSet = _deckFilter(filterDeckId);
    const topicMap = new Map(state.topics.map(t => [t.id, t]));

    return [...dueTodaySet].filter(tid => {
      if (done.has(tid)) return false;
      const topic = topicMap.get(tid);
      if (!topic) return false;
      if (isTopicHidden(topic)) return false;
      if (deckSet && !deckSet.has(topic.deckId)) return false;
      return true;
    });
  };

  const getNewIds = (filterDeckId, limit) => {
    const done    = new Set(state.todayDone);
    const deckSet = _deckFilter(filterDeckId);
    const results = [];

    for (const topic of state.topics) {
      if (results.length >= limit) break;
      const tid = topic.id;
      if (!byPile.new.has(tid)) continue;
      if (done.has(tid)) continue;
      if (deckSet && !deckSet.has(topic.deckId)) continue;
      if (isTopicHidden(topic)) continue;
      const card = state.sm2[tid];
      if (card && !card.firstSeenAt) results.push(tid);
    }
    return results;
  };

  return {
    rebuild, scheduleRebuild,
    markSeen, updateDue, removeCard, resetCard, addCard,
    mutateCard,
    getDueIds, getNewIds,
  };
})();

// ============================================================
// UTILITIES
// ============================================================

const el  = (id) => document.getElementById(id);
const uid = ()   => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s)  => s ? String(s).replace(ESCAPE_REGEX, m => ESCAPE_MAP[m]) : '';
const p2  = (n)  => String(n).padStart(2, '0');

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

const fmt = (d) =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

const parseD = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function isTopicSuspended(topic) {
  return Boolean(topic?.suspended);
}

function isTopicBuried(topic, now = Date.now()) {
  if (!topic || topic.buriedUntil == null) return false;
  const ts = typeof topic.buriedUntil === 'number'
    ? topic.buriedUntil
    : Number(topic.buriedUntil);
  return Number.isFinite(ts) && ts > now;
}

function isTopicHidden(topic, now = Date.now()) {
  return isTopicSuspended(topic) || isTopicBuried(topic, now);
}

// ─── FLAG ACTIONS ─────────────────────────────────────────────────────────────

function _refreshUIafterAction(topicId) {
  if (typeof renderDecks === 'function') renderDecks();
  if (typeof renderDeckDetailContent === 'function' && T.currentDeckDetailId) {
    renderDeckDetailContent(T.currentDeckDetailId);
  }
  if (typeof updateBrowserTable === 'function') updateBrowserTable();
  if (typeof updateFcActionToolbar === 'function') {
    const topic = state.topics.find(t => t.id === topicId);
    if (topic) updateFcActionToolbar(topic);
  }
  if (typeof renderCalendar === 'function' && (state.section === 'calendar' || state.section === 'dateview')) {
    renderCalendar();
  }
}

function setTopicFlag(topicId, color) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  // If clicking the same color, clear the flag
  if (topic.flag === color) {
    topic.flag = null;
  } else {
    topic.flag = color;
  }
  
  if (typeof saveImmediate === 'function') {
    saveImmediate();
  } else if (typeof save === 'function') {
    save();
  }
  
  _refreshUIafterAction(topicId);
}

function clearTopicFlag(topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  topic.flag = null;
  
  if (typeof saveImmediate === 'function') {
    saveImmediate();
  } else if (typeof save === 'function') {
    save();
  }
  
  _refreshUIafterAction(topicId);
}

// ─── BURY ACTIONS ─────────────────────────────────────────────────────────────

function buryTopic(topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  // Set buriedUntil to tomorrow midnight
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  topic.buriedUntil = tomorrow.getTime();
  
  if (typeof saveImmediate === 'function') {
    saveImmediate();
  } else if (typeof save === 'function') {
    save();
  }
  
  _refreshUIafterAction(topicId);
}

function unburyTopic(topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  topic.buriedUntil = null;
  
  if (typeof saveImmediate === 'function') {
    saveImmediate();
  } else if (typeof save === 'function') {
    save();
  }
  
  _refreshUIafterAction(topicId);
}

// ─── SUSPEND ACTIONS ───────────────────────────────────────────────────────────

function toggleTopicSuspend(topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  topic.suspended = !topic.suspended;
  if (topic.suspended) topic.buriedUntil = null;
  
  if (typeof saveImmediate === 'function') {
    saveImmediate();
  } else if (typeof save === 'function') {
    save();
  }
  
  _refreshUIafterAction(topicId);
}

function suspendTopic(topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  topic.suspended = true;
  
  if (typeof saveImmediate === 'function') {
    saveImmediate();
  } else if (typeof save === 'function') {
    save();
  }
  
  _refreshUIafterAction(topicId);
}

function unsuspendTopic(topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  topic.suspended = false;
  
  if (typeof saveImmediate === 'function') {
    saveImmediate();
  } else if (typeof save === 'function') {
    save();
  }
  
  _refreshUIafterAction(topicId);
}

// ─── FLAG PICKER ─────────────────────────────────────────────────────────────

function showFlagPicker(topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  
  const colors = [
    { name: 'red', label: 'Red', value: '#ef4444' },
    { name: 'orange', label: 'Orange', value: '#f97316' },
    { name: 'green', label: 'Green', value: '#22c55e' },
    { name: 'blue', label: 'Blue', value: '#3b82f6' }
  ];
  
  // Create a simple modal for flag selection
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
  
  const content = document.createElement('div');
  content.style.cssText = 'background:var(--surf,#1A1A26);padding:20px;border-radius:12px;max-width:300px;width:90%;';
  
  const title = document.createElement('h3');
  title.textContent = 'Select Flag Color';
  title.style.cssText = 'margin:0 0 15px 0;color:var(--ink,#F5F5FA);';
  
  const colorGrid = document.createElement('div');
  colorGrid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:10px;';
  
  colors.forEach(color => {
    const btn = document.createElement('button');
    btn.style.cssText = `padding:12px;border-radius:8px;border:2px solid ${color.value};background:transparent;color:${color.value};cursor:pointer;font-weight:600;`;
    btn.textContent = color.label;
    btn.onclick = () => {
      setTopicFlag(topicId, color.name);
      document.body.removeChild(modal);
    };
    colorGrid.appendChild(btn);
  });
  
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear Flag';
  clearBtn.style.cssText = 'width:100%;padding:12px;border-radius:8px;border:1px solid var(--bord,rgba(255,255,255,.1));background:transparent;color:var(--ink3,#9ca3af);cursor:pointer;font-weight:600;margin-top:10px;';
  clearBtn.onclick = () => {
    clearTopicFlag(topicId);
    document.body.removeChild(modal);
  };
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'width:100%;padding:12px;border-radius:8px;border:none;background:var(--surf2,#20202E);color:var(--ink,#F5F5FA);cursor:pointer;font-weight:600;margin-top:10px;';
  cancelBtn.onclick = () => {
    document.body.removeChild(modal);
  };
  
  content.appendChild(title);
  content.appendChild(colorGrid);
  content.appendChild(clearBtn);
  content.appendChild(cancelBtn);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

function normalizeTag(raw) {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/\s+/g, '-');
}

function getAllTags() {
  const tags = new Set();
  (state.topics || []).forEach(topic => {
    if (!Array.isArray(topic.tags)) return;
    topic.tags.forEach(tag => {
      const normalized = normalizeTag(tag);
      if (normalized) tags.add(normalized);
    });
  });
  return [...tags].sort();
}

function getDeckName(deckId) {
  if (!deckId) return 'Unknown';
  const deck = (state.decks || []).find(d => d.id === deckId);
  return deck ? deck.name : 'Unknown';
}

function getFilteredDeckById(deckId) {
  return (state.filteredDecks || []).find(deck => deck.id === deckId) || null;
}

function topicMatchesStatus(topic, status, now = Date.now()) {
  const card = typeof ensureCard === 'function' ? ensureCard(topic.id) : null;
  switch (status) {
    case 'due':
      if (!card) return false;
      if (card.pile === 'review' && (card.nextReviewAt || 0) <= now) return true;
      if ((card.pile === 'learning' || card.pile === 'relearning') && (card.nextReviewAt || 0) <= now) return true;
      // New cards are due if their start date has arrived (Anki is:due).
      // Daily-limit enforcement is handled by callers, not here.
      if ((card.pile === 'new' || !card.pile) && !card.lastReviewedAt) {
        const sd = topic.startDate;
        if (!sd) return true;
        const _td = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10);
        return sd <= _td;
      }
      return false;
    case 'new':
      return card && (card.pile === 'new' || !card.pile) && !card.firstSeenAt;
    case 'learning':
      return card && (card.pile === 'learning' || card.pile === 'relearning');
    case 'review':
      return card && card.pile === 'review';
    case 'suspended':
      return isTopicSuspended(topic);
    case 'buried':
      return isTopicBuried(topic, now);
    case 'flagged':
      return Boolean(topic.flag);
    default:
      return true;
  }
}

function topicMatchesFilter(topic, filter, now = Date.now()) {
  if (!topic || !filter) return true;
  if (filter.deckId && filter.deckId !== 'all' && topic.deckId !== filter.deckId) return false;
  if (filter.search) {
    const needle = String(filter.search).trim().toLowerCase();
    if (needle) {
      const haystack = `${topic.title || ''} ${topic.content || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
  }
  if (filter.tags && filter.tags.length) {
    const normalizedTags = new Set((Array.isArray(topic.tags) ? topic.tags : []).map(normalizeTag).filter(Boolean));
    if (!filter.tags.some(tag => normalizedTags.has(normalizeTag(tag)))) return false;
  }
  if (filter.flag) {
    if (topic.flag !== filter.flag) return false;
  }
  if (filter.status && filter.status !== 'all') {
    if (!topicMatchesStatus(topic, filter.status, now)) return false;
  }
  return true;
}

function buildFilteredDeckTopicIds(filteredDeck) {
  const query = typeof filteredDeck === 'string'
    ? getFilteredDeckById(filteredDeck)
    : filteredDeck;
  if (!query) return new Set();
  const now = Date.now();
  return new Set((state.topics || [])
    .filter(topic => topic && !topic.isPastFixed)
    .filter(topic => topicMatchesFilter(topic, query, now))
    .map(topic => topic.id));
}

const addDays = (s, n) => {
  const d = parseD(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
};

const diffDays      = (a, b) => Math.round((parseD(a) - parseD(b)) / MS_PER_DAY);
const dispDate      = (s)    => s ? parseD(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Select a date';
const shortDate     = (s)    => parseD(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const daysFromToday = (s)    => diffDays(s, todayStr());

const calcAutoReviews = (startDate = todayStr()) =>
  FIXED_INTERVALS.map(interval => addDays(startDate, interval));

// ============================================================
// ERROR UI
// ============================================================

const showSectionError = (sectionName, err) => {
  const section = el(`section-${sectionName}`);
  if (!section) return;
  const msg = err instanceof Error ? err.message : String(err);
  section.querySelector('.mnemo-section-error')?.remove();
  const banner = document.createElement('div');
  banner.className  = 'mnemo-section-error';
  banner.style.cssText = [
    'padding:12px 16px', 'margin:12px', 'border-radius:8px',
    'background:var(--color-danger,#FF5C7A)', 'color:#fff', 'font-size:14px',
  ].join(';');
  banner.textContent = `⚠️ Failed to load this section: ${msg}`;
  section.prepend(banner);
  console.error(`[MNEMO] Section "${sectionName}" render error:`, err);
};

const safeRender = (sectionName, renderFn) => {
  try { renderFn(); }
  catch (err) { showSectionError(sectionName, err); }
};

const safeSetup = (label, fn) => {
  try { if (typeof fn === 'function') fn(); }
  catch (err) { console.error(`[MNEMO] Setup error in "${label}":`, err); }
};

// ============================================================
// PERSISTENCE
// ============================================================

const save = () => {
  if (T.saveTimeout) clearTimeout(T.saveTimeout);
  T.saveTimeout = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_store.serialize())); }
    catch (e) { console.warn('[MNEMO] Debounced save failed:', e); }
  }, SAVE_DEBOUNCE_MS);
};

const saveImmediate = () => {
  if (T.saveTimeout) { clearTimeout(T.saveTimeout); T.saveTimeout = null; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_store.serialize())); }
  catch (e) { console.warn('[MNEMO] Immediate save failed:', e); }
};

const loadData = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    _store.hydrate(JSON.parse(raw));
    return true;
  } catch (e) {
    console.warn('[MNEMO] Load failed:', e);
    return false;
  }
};

// ============================================================
// NAVIGATION
// ============================================================

const EXPERT_SECTIONS = new Set(['analytics', 'goals', 'heatmap', 'import', 'past']);

const SECTION_RENDERERS = {
  today:      () => safeRender('today',      renderToday),
  decks:      () => typeof renderDecks === 'function' ? safeRender('decks', renderDecks) : () => {},
  flashcards: () => safeRender('flashcards', renderFC),
  calendar:   () => safeRender('calendar',   renderCalendar),
  journal:    () => safeRender('journal',    renderJournal),
  classrooms: () => renderClassrooms(),
  settings:   () => safeRender('settings',   renderSettings),
  analytics:  () => safeRender('analytics',  renderAnalytics),
  goals:      () => safeRender('goals',      renderGoals),
  heatmap:    () => safeRender('heatmap',    renderHeatmap),
  import:     () => safeRender('import',     renderImport),
  past:       () => safeRender('past',       renderPast),
  dateview:   () => safeRender('dateview',   renderDateView),
  browse:     () => safeRender('browse',     renderBrowse),
  ai:         () => {},
};

const switchSection = (name) => {
  if (EXPERT_SECTIONS.has(name) && !state.expertMode) return;
  state.section = name;

  document.querySelectorAll('.section').forEach(s => {
    const active = s.id === `section-${name}`;
    s.classList.toggle('active',  active);
    s.classList.toggle('hidden', !active);
  });

  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.section === name)
  );

  const navLabel = document.querySelector(`[data-section="${name}"] .ni-label`);
  const mobTitle = el('mobTitle');
  if (mobTitle) mobTitle.textContent = navLabel?.textContent ?? 'Mnemo';

  el('sidebar')?.classList.remove('open');
  el('sidebarOverlay')?.classList.remove('active');

  SECTION_RENDERERS[name]?.();
};

// Mobile detection — Expert mode is forced ON on mobile (no toggle shown)
const isMobileDevice = () => window.matchMedia('(max-width: 768px)').matches;

const setExpertMode = (on) => {
  // On mobile, expert mode is always enabled regardless of the requested value.
  if (isMobileDevice()) on = true;
  state.expertMode = on;
  el('expertNavGroup')?.classList.toggle('hidden', !on);
  el('expertToggleBtn')?.classList.toggle('active',  on);
  const s  = el('expertStatus');
  if (s)  s.textContent  = on ? 'ON' : 'OFF';
  // Hide the sidebar Expert toggle button entirely on mobile
  el('expertToggleBtn')?.parentElement?.classList.toggle('hidden', isMobileDevice());
  save();
};

// ============================================================
// CARD FILTERING  (thin wrappers over IndexManager)
// ============================================================

const isInDeck = (deckId, filterDeckId) => {
  if (deckId === filterDeckId) return true;
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck?.parentId) return false;
  return isInDeck(deck.parentId, filterDeckId);
};

const getSubDeckIds = (deckId) => {
  const ids = [deckId];
  state.decks
    .filter(d => d.parentId === deckId)
    .forEach(sub => ids.push(...getSubDeckIds(sub.id)));
  return ids;
};

const getDueCards = (filterDeckId) => {
  const ids = new Set(IndexManager.getDueIds(filterDeckId));
  return state.topics.filter(t => ids.has(t.id));
};

const getNewCards = (filterDeckId, limit) => {
  const ids = new Set(IndexManager.getNewIds(filterDeckId, limit));
  return state.topics.filter(t => ids.has(t.id));
};

// ============================================================
// PER-DECK NEW-CARD LIMIT (Phase 1)
// Returns the effective daily new-card limit for a deck:
// the deck's own override (deck.newCardsPerDay) if a non-negative
// integer is set, otherwise the global state.settings.newCardsPerDay.
// ============================================================
const getEffectiveNewLimit = (deckId) => {
  const globalRaw = Number(state.settings?.newCardsPerDay);
  const globalLimit = Number.isFinite(globalRaw) && globalRaw >= 0 ? globalRaw : 20;
  if (!deckId || deckId === 'all') return globalLimit;
  const deck = state.decks?.find(d => d.id === deckId);
  if (!deck) return globalLimit;
  const override = Number(deck.newCardsPerDay);
  if (Number.isFinite(override) && override >= 0) return override;
  return globalLimit;
};

// New cards already studied today, optionally scoped to a deck (or its subtree).
const getStudiedNewTodayInDeck = (deckId) => {
  const today = todayStr();
  const inScope = (tid) => {
    if (!deckId || deckId === 'all') return true;
    const t = state.topics.find(x => x.id === tid);
    return t && (typeof isInDeck === 'function' ? isInDeck(t.deckId, deckId) : t.deckId === deckId);
  };
  let n = 0;
  for (const [tid, card] of Object.entries(state.sm2 || {})) {
    if (!card?.lastReviewedAt) continue;
    if (!Array.isArray(card.log) || card.log.length !== 1) continue;
    const day = new Date(card.lastReviewedAt).toISOString().slice(0, 10);
    if (day !== today) continue;
    if (!inScope(tid)) continue;
    n++;
  }
  return n;
};
window.getEffectiveNewLimit       = getEffectiveNewLimit;
window.getStudiedNewTodayInDeck   = getStudiedNewTodayInDeck;
const isDeckPreviewUpcomingEnabled = (deckId) => {
  const defaultEnabled = Boolean(state.settings?.previewUpcomingCardsDefault);
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return defaultEnabled;
  if (typeof deck.previewUpcomingCards === 'boolean') return deck.previewUpcomingCards;
  return defaultEnabled;
};

const getTodayNewCardCount = () =>
  Object.values(state.sm2).filter(card => {
    if (card.pile !== 'new' || !card.lastReviewedAt) return false;
    return new Date(card.lastReviewedAt).toISOString().slice(0, 10) === todayStr();
  }).length;

// ============================================================
// FIXED-INTERVAL CARD UPDATE
// ============================================================

const updateFixedIntervalCard = (tid) => {
  const card        = ensureCard(tid);
  const currentStep = Number.isInteger(card.fixedStep) ? card.fixedStep : -1;
  const nextStep    = Math.min(currentStep + 1, FIXED_INTERVALS.length - 1);
  const interval    = FIXED_INTERVALS[nextStep];
  const nowMs       = Date.now();

  card.fixedStep      = nextStep;
  card.interval       = interval;
  card.pile           = 'review';
  card.lastReviewedAt = nowMs;
  card.nextReviewAt   = nowMs + interval * MS_PER_DAY;
  if (!card.firstSeenAt) card.firstSeenAt = nowMs;

  IndexManager.mutateCard(tid, card.nextReviewAt, 'review');
  if (typeof window !== 'undefined' && typeof window.notifyTodayChanged === 'function') {
    window.notifyTodayChanged();
  }

  return card;
};

// ============================================================
// STREAK MANAGEMENT
// ============================================================

const recalcStreak = () => {
  const hist = state.history ?? {};
  const todayCount  = hist[todayStr()] ?? 0;
  const startOffset = todayCount > 0 ? 0 : 1;
  let streak = 0;

  for (let i = startOffset; i < 10_000; i++) {
    if ((hist[addDays(todayStr(), -i)] ?? 0) > 0) streak++;
    else break;
  }

  state.currentStreak = streak;
  state.bestStreak    = Math.max(state.bestStreak ?? 0, streak);
};

const recordReview = () => {
  const today          = todayStr();
  state.history[today] = (state.history[today] ?? 0) + 1;
  recalcStreak();
  saveImmediate();

  const n = state.currentStreak;
  const a = el('streakNum'); const b = el('mobStreak');
  if (a) a.textContent = n;
  if (b) b.textContent = n;
};

// ============================================================
// MODAL HELPERS
// ============================================================

const openModal  = (id) => {
  const m = el(id);
  if (m) { m.classList.remove('hidden'); m.classList.add('open'); document.body.style.overflow = 'hidden'; }
};

const closeModal = (id) => {
  const m = el(id);
  if (m) { m.classList.add('hidden'); m.classList.remove('open'); document.body.style.overflow = ''; }
};

// ============================================================
// COMMON UI HELPERS
// ============================================================

const updateColorPicker = (active) => {
  document.querySelectorAll('.color-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === active)
  );
};

const refreshAllDeckSelects = () => {
  const populate = (selectId, includeAll) => {
    const sel = el(selectId);
    if (!sel || sel.tagName !== 'SELECT') return;
    const prev = sel.value;
    sel.innerHTML = includeAll ? '<option value="all">All Decks</option>' : '';
    const source = includeAll ? state.decks.filter(d => !d.parentId) : state.decks;
    source.forEach(d => {
      const opt       = document.createElement('option');
      opt.value       = d.id;
      opt.textContent = (d.parentId ? '  └ ' : '') + d.name;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  };

  populate('fDeck',          false);
  populate('todayDeckFilter', true);
  populate('fcDeckFilter',    true);
};

// ============================================================
// THEME
// ============================================================

const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  _store.updateSetting('theme', theme);
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === theme)
  );
  save();
};

// ============================================================
// HISTORY RECALC
// ============================================================

const recalcHistoryFromCards = () => {
  const newHistory = {};

  Object.values(state.sm2).forEach(card => {
    if (card.lastReviewedAt) {
      const date = new Date(card.lastReviewedAt).toISOString().slice(0, 10);
      newHistory[date] = (newHistory[date] ?? 0) + 1;
    }
  });

  const today = todayStr();
  if (state.todayDone.length > 0) {
    newHistory[today] = Math.max(newHistory[today] ?? 0, state.todayDone.length);
  }

  state.history = newHistory;
  recalcStreak();
  saveImmediate();
};

// ============================================================
// FIRST LAUNCH (welcome overlay removed — starter deck loads silently)
// ============================================================

const ensureStarterDeck = () => {
  if (state.starterDismissed) return;
  if (state.decks.find(d => d.id === 'starter')) return;
  if (state.topics.some(t => t.deckId === 'starter')) return;

  state.decks.push({ ...STARTER_DECK });

  STARTER_CARDS.forEach((c, i) => {
    const tid = `starter_${i}`;
    state.topics.push({
      id: tid, title: c.q, content: c.a,
      deckId: 'starter', type: 'standard', startDate: todayStr(),
    });
    state.sm2[tid]             = fsrsInit(tid);
    state.sm2[tid].firstSeenAt = null;
    IndexManager.addCard(tid, 'starter');
  });

  save();
};
// ============================================================
// CALENDAR EVENTS
// ============================================================

const setupCalendarEvents = () => {
  el('calPrev')?.addEventListener('click', () => {
    if (state.calMonth === JANUARY) { state.calMonth = DECEMBER; state.calYear--; }
    else state.calMonth--;
    safeRender('calendar', renderCalendar);
  });

  el('calNext')?.addEventListener('click', () => {
    if (state.calMonth === DECEMBER) { state.calMonth = JANUARY; state.calYear++; }
    else state.calMonth++;
    safeRender('calendar', renderCalendar);
  });

  el('calTodayBtn')?.addEventListener('click', () => {
    const now = new Date();
    state.calYear = now.getFullYear(); state.calMonth = now.getMonth();
    state.calSelected = fmt(now);
    safeRender('calendar', renderCalendar);
  });

  el('calAddTopicBtn')?.addEventListener('click', () => {
    if (!state.calSelected) { alert('Select a date first'); return; }
    openAddTopic(null);
    const fDate = el('fDate');
    if (fDate) fDate.value = state.calSelected;
  });

  el('dvBackBtn')?.addEventListener('click',    () => switchSection('calendar'));
  el('browseBackBtn')?.addEventListener('click', () => switchSection('decks'));
  el('browseTypeFilter')?.addEventListener('change', () => {
    if (state.browseDeckId) browseDeckById(state.browseDeckId);
  });
};

// ============================================================
// JOURNAL EVENTS
// ============================================================

const setupJournalEvents = () => {
  el('jPrev')?.addEventListener('click', () => {
    if (state.jMonth === JANUARY) { state.jMonth = DECEMBER; state.jYear--; }
    else state.jMonth--;
    safeRender('journal', renderJournal);
  });

  el('jNext')?.addEventListener('click', () => {
    if (state.jMonth === DECEMBER) { state.jMonth = JANUARY; state.jYear++; }
    else state.jMonth++;
    safeRender('journal', renderJournal);
  });

  // Journal fullscreen toggle (mobile + desktop)
  const fsBtn = el('journalFsBtn');
  const editorCol = el('journalEditorCol');
  function setFs(on) {
    if (!editorCol) return;
    editorCol.classList.toggle('is-fullscreen', on);
    document.body.classList.toggle('journal-fs-open', on);
    if (fsBtn) {
      fsBtn.textContent = on ? '✕' : '⛶';
      fsBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Toggle fullscreen');
    }
    if (on) {
      const ta = el('journalTA');
      if (ta && !ta.disabled) setTimeout(() => ta.focus(), 50);
    }
  }
  fsBtn?.addEventListener('click', () => {
    setFs(!editorCol?.classList.contains('is-fullscreen'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editorCol?.classList.contains('is-fullscreen')) setFs(false);
  });

  // Mobile horizontal date strip — populate ±14 days around today, click selects
  const strip = el('journalDateStrip');
  if (strip && !strip.dataset.built) {
    const today = new Date();
    const frag = document.createDocumentFragment();
    for (let i = -14; i <= 14; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const ds = d.toISOString().slice(0,10);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jds-item';
      btn.dataset.date = ds;
      btn.setAttribute('role', 'option');
      btn.innerHTML = `<span class="jds-dow">${d.toLocaleDateString('en-US',{weekday:'short'})}</span><span class="jds-day">${d.getDate()}</span>`;
      btn.addEventListener('click', () => {
        state.jSelected = ds;
        state.jYear = d.getFullYear(); state.jMonth = d.getMonth();
        safeRender('journal', renderJournal);
        strip.querySelectorAll('.jds-item').forEach(b => b.classList.toggle('selected', b.dataset.date === ds));
      });
      frag.appendChild(btn);
    }
    strip.appendChild(frag);
    strip.dataset.built = '1';
    // Auto-scroll today into view
    requestAnimationFrame(() => {
      const t = strip.querySelector(`.jds-item[data-date="${today.toISOString().slice(0,10)}"]`);
      if (t) t.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }
};

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

const setupKeyboardShortcuts = () => {
  const RATING_MAP = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };

  const _digit = (key, code) =>
    key.match(/^[1-4]$/) ? key : (code.match(/^(?:digit|numpad)([1-4])$/)?.[1] ?? null);

  document.addEventListener('keydown', (e) => {
    const tag       = document.activeElement?.tagName;
    const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (isEditing) return;

    const key  = String(e.key  ?? '').toLowerCase();
    const code = (e.code ?? '').toLowerCase();
    const digit = _digit(key, code);

    // ── Flashcard session ──────────────────────────────
    if (state.section === 'flashcards' && !el('fcSession')?.classList.contains('hidden')) {
      if (code === 'space' || key === ' ') {
        e.preventDefault();
        if (T.fcAnswerShown) fcNextCard();
        else fcShowAnswer();
        return;
      }
      if (T.fcAnswerShown && digit)   { e.preventDefault(); fcRate(RATING_MAP[digit]); return; }
      if (code === 'arrowleft')       { e.preventDefault(); fcPrevCard(); return; }
      if (code === 'arrowright')      { e.preventDefault(); fcNextCard(); return; }
      if (e.ctrlKey && (code === 'keyz' || key === 'z')) { e.preventDefault(); fcUndo();  return; }
      if (e.ctrlKey && (code === 'keyy' || key === 'y')) { e.preventDefault(); fcRedo();  return; }
    }

    // ── Today session ──────────────────────────────────
    if (state.section === 'today' && !el('sessionWrap')?.classList.contains('hidden')) {
      if (code === 'space' || key === ' ') { e.preventDefault(); handleSessNavNext(); return; }
      if (code === 'arrowright' && T.sessViewOnly && T.sessAnswerShown) { e.preventDefault(); nextSessionCard(); return; }
      if (T.sessAnswerShown && !T.sessViewOnly && digit) { e.preventDefault(); rateSessionCard(RATING_MAP[digit]); return; }
    }
  });
};

// ============================================================
// BUTTON FALLBACKS
// ============================================================

const setupButtonFallbacks = () => {
  const bind = (id, fn) => {
    const node = el(id);
    if (node && typeof fn === 'function') node.onclick = fn;
  };

  bind('startSessionBtn',      () => startSession());
  bind('reviewAgainHeaderBtn', () => reviewAgain());
  bind('endSessionBtn',        () => endSession());
  bind('sessShowBtn',          () => showSessionAnswer());
  bind('sessNextBtn',          () => nextSessionCard());
  bind('reviewAgainBtn',       () => reviewAgain());
  bind('resetTodayReviewsBtn', () => resetTodayReviews());
  bind('sessionDoneBtn',       () => endSession());

  // Decks — saveDeckBtn, newDeckBtn, createFirstDeckBtn deliberately excluded (bound once in setupDeckEvents)
  bind('importDeckCsvBtn',     () => switchSection('import'));

  // Generic [data-jump-section] buttons (e.g. Settings → Import / Export shortcut)
  document.addEventListener('click', (ev) => {
    const jump = ev.target.closest('[data-jump-section]');
    if (jump) {
      ev.preventDefault();
      switchSection(jump.dataset.jumpSection);
    }
  });

  bind('fcLoadBtn',            () => loadFlashcards());
  bind('fcAgainBtn',           () => loadFlashcards());
  bind('fcShowBtn',            () => fcShowAnswer());
  bind('fcUndoBtn',            () => fcUndo());
  bind('fcRedoBtn',            () => fcRedo());
  bind('fcPrevBtn',            () => fcPrevCard());
  bind('fcNextBtn',            () => fcNextCard());
  bind('fcNavNextBtn',         () => fcNextCard());

  bind('saveSettingsBtn',      () => saveSettings());
  bind('newGoalBtn',           () => openModal('goalModal'));
  bind('saveGoalBtn',          () => saveGoal());
  // (pomToggle binding removed — Pomodoro feature deleted)
};





function runMixedDeckMigration() {
  state.decks.forEach(deck => {
    const hasSubDecks   = state.decks.some(d => d.parentId === deck.id);
    const hasDirectCards = state.topics.some(t => t.deckId === deck.id);

    if (hasSubDecks && hasDirectCards) {
      let inboxDeck = state.decks.find(d => d.parentId === deck.id && d.isInbox);
      if (!inboxDeck) {
        const generalId = uid();
        state.decks.push({
          id: generalId,
          name: 'General',
          parentId: deck.id,
          isInbox: true,
          color: deck.color,
          scheduleMode: 'fsrs',
          createdAt: todayStr()
        });
        inboxDeck = state.decks.find(d => d.id === generalId);
      }
      state.topics
        .filter(t => t.deckId === deck.id)
        .forEach(t => { t.deckId = inboxDeck.id; });
    }
  });
  save();
}
// ============================================================
// INITIALIZATION
// ============================================================

const init = () => {
  loadData();
  loadSavedFSRSParams();
  // Roll over todayDone + todayUndo if the calendar day has changed
  const storedDay = localStorage.getItem(TODAY_KEY);
  if (storedDay && storedDay !== todayStr()) {
    state.todayDone = [];
    state.todayUndo = {};
    // Prune reviewLog: keep only the last 365 days
    if (state.reviewLog && typeof state.reviewLog === 'object') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 365);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      Object.keys(state.reviewLog).forEach(d => {
        if (d < cutoffStr) delete state.reviewLog[d];
      });
    }
    localStorage.setItem(TODAY_KEY, todayStr());
    saveImmediate();
  } else if (!storedDay) {
    localStorage.setItem(TODAY_KEY, todayStr());
  }

  // Build indexes before any render depends on them
  IndexManager.rebuild();
  runMixedDeckMigration()
  // Calendar / journal initialisation
  const now = new Date();
  state.calYear = now.getFullYear(); state.calMonth  = now.getMonth();
  state.jYear   = now.getFullYear(); state.jMonth    = now.getMonth();
  state.calSelected = fmt(now);      state.jSelected = fmt(now);

  recalcStreak();
  // Use the actual theme options exposed in settings and fall back to Obsidian.
  const allowedThemes = ['obsidian', 'blonde', 'irish', 'magenta'];
  const themePref = state.settings.theme ?? 'obsidian';
  applyTheme(allowedThemes.includes(themePref) ? themePref : 'obsidian');
  // Force expert mode ON for mobile devices regardless of stored value
  setExpertMode(isMobileDevice() ? true : state.expertMode);

  // Protect against data loss if user closes tab during the save debounce
  window.addEventListener('beforeunload', saveImmediate);

  // PWA install prompt — capture deferred event so the Today banner can trigger it.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('mnemo:install-available'));
  });
  window.addEventListener('appinstalled', () => {
    window.deferredPrompt = null;
    document.getElementById('installBanner')?.classList.add('hidden');
  });

  const dueCount = getDueCards('all').length
                 + getNewCards('all', getEffectiveNewLimit('all')).length;
  switchSection(dueCount > 0 ? 'today' : 'decks');

  const n = state.currentStreak;
  const a = el('streakNum'); const b = el('mobStreak');
  if (a) a.textContent = n;
  if (b) b.textContent = n;

  ensureStarterDeck();

  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => switchSection(btn.dataset.section))
  );

  el('mobMenuBtn')?.addEventListener('click', () => {
    el('sidebar')?.classList.toggle('open');
    el('sidebarOverlay')?.classList.toggle('active');
  });
  el('sidebarOverlay')?.addEventListener('click', () => {
    el('sidebar')?.classList.remove('open');
    el('sidebarOverlay')?.classList.remove('active');
  });

  el('expertToggleBtn')?.addEventListener('click', () => setExpertMode(!state.expertMode));

  safeSetup('todayEvents',        setupTodayEvents);
  safeSetup('deckEvents',         typeof setupDeckEvents === 'function' ? setupDeckEvents : () => {});
  safeSetup('topicEvents',        setupTopicEvents);
  safeSetup('calendarEvents',     setupCalendarEvents);
  safeSetup('flashcardEvents',    setupFlashcardEvents);
  safeSetup('journalEvents',      setupJournalEvents);
  safeSetup('goalEvents',         setupGoalEvents);
  safeSetup('settingsEvents',     setupSettingsEvents);
  safeSetup('importExportEvents', setupImportExportEvents);
  safeSetup('keyboardShortcuts',  setupKeyboardShortcuts);
  safeSetup('buttonFallbacks',    setupButtonFallbacks);

  document.querySelectorAll('.modal').forEach(modal =>
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal.id); })
  );

  refreshAllDeckSelects();
};

document.addEventListener('DOMContentLoaded', init);

// ============================================================
// WINDOW EXPORTS
// ============================================================

Object.assign(window, {
  // Core
  state, T, DECK_COLORS,
  // Utilities
  el, uid, esc, p2, todayStr, fmt, parseD,
  addDays, diffDays, dispDate, shortDate, daysFromToday, calcAutoReviews,
  // Persistence
  save, saveImmediate,
  // Navigation
  switchSection, setExpertMode,
  // Card queries
  isInDeck, getSubDeckIds, getDueCards,
  getNewCards, getTodayNewCardCount, isDeckPreviewUpcomingEnabled,
  // Mutations
  updateFixedIntervalCard,
  // Streaks
  recalcStreak, recordReview,
  // Modals
  openModal, closeModal,
  // UI helpers
  updateColorPicker, refreshAllDeckSelects, applyTheme, recalcHistoryFromCards,
  // Index — exported so fsrs.js can call scheduleRebuild() after rating
  IndexManager,
});

// ============================================================
// CLASSROOMS RENDERER
// ============================================================
function renderClassrooms() {
  if (typeof window.MockAPI === 'undefined' || typeof window.CR === 'undefined') {
    console.warn('[renderClassrooms] MockAPI or CR not available yet');
    return;
  }

  const classrooms = window.MockAPI.listClassrooms();
  const grid = el('classroomsGrid');
  const empty = el('classroomsEmpty');

  if (!classrooms || classrooms.length === 0) {
    if (grid) grid.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  if (grid) {
    grid.innerHTML = classrooms.map(c => `
      <div class="deck-card classroom-card" data-classroom-id="${c.id}">
        <div class="dc-bar" style="background: ${c.mode === 'admin' ? 'var(--acc)' : 'var(--cyan)'}"></div>
        <div class="dc-top">
          <div class="dc-name">${window.CR.esc(c.name)}</div>
        </div>
        <div class="dc-desc">${window.CR.esc(c.desc || 'No description')}</div>
        <div class="dc-stats">
          <div class="dc-stat">
            <div class="dc-stat-val">${c.memberCount}</div>
            <div class="dc-stat-lab">Member${c.memberCount === 1 ? '' : 's'}</div>
          </div>
          <div class="dc-stat">
            <div class="dc-stat-val" style="font-size: 1.2rem">
              ${c.mode === 'admin' ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'}
            </div>
            <div class="dc-stat-lab">${c.mode === 'admin' ? 'Teacher-led' : 'Peer pod'}</div>
          </div>
          <div class="dc-stat">
            <div class="dc-stat-val" style="font-size: 1rem">${window.CR.timeAgo(c.lastActive || c.createdAt)}</div>
            <div class="dc-stat-lab">Last active</div>
          </div>
        </div>
      </div>
    `).join('');

    // Add click handlers for classroom cards
    grid.querySelectorAll('.classroom-card').forEach(card => {
      card.addEventListener('click', () => {
        const classroomId = card.dataset.classroomId;
        if (typeof window.navigateToClassroom === 'function') {
          window.navigateToClassroom(classroomId);
        }
      });
    });
  }
}