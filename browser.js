'use strict';

const BROWSER_STATE = {
  filters: {
    deckId: 'all',
    tag: 'all',
    flag: '',
    status: 'all',
    search: '',
  },
  selectedIds: new Set(),
  editingFilteredDeckId: null,
};

// ─── FILTERED DECK SNAPSHOTS (Anki-style) ────────────────────────────────────
//
// Filtered decks are STATIC snapshots of card IDs, not live queries. They are
// only updated when:
//   1. The filter is created (saveFilteredDeck)
//   2. The filter is edited and saved (saveFilteredDeck)
//   3. The user explicitly clicks "Rebuild" (rebuildFilteredDeck)
//
// All read sites must use getFilteredDeckSnapshot(fd) — NEVER call
// buildFilteredDeckTopicIds(fd) directly for a saved filtered deck, because
// that re-evaluates the query against the current state and breaks the
// snapshot guarantee.

function getFilteredDeckSnapshot(fd) {
  if (!fd) return new Set();
  if (!Array.isArray(fd.cardIds)) fd.cardIds = [];
  return new Set(fd.cardIds);
}

// Compute the matching topic IDs for a filtered deck.
//
// We DO NOT rely on buildFilteredDeckTopicIds() from script.js — that helper
// evaluates `status` incorrectly and returns every card in the base deck even
// when status is set to 'due'/'new'/'learning'/etc. Instead we mirror the
// exact filter pipeline used by getBrowserTopics() (deck, tags, flag, status,
// search), which is the same logic the user sees in the Card Browser. The
// snapshot the filtered deck stores is therefore guaranteed to contain only
// the cards that match — e.g. status:'due' yields only due cards.
function _computeFilteredDeckMatchIds(fd) {
  const out = new Set();
  if (!fd) return out;
  const now = Date.now();
  const search = (fd.search || '').trim().toLowerCase();
  const wantDeckId = fd.deckId && fd.deckId !== 'all' ? fd.deckId : null;
  const wantTags = Array.isArray(fd.tags)
    ? fd.tags.map(t => (typeof normalizeTag === 'function' ? normalizeTag(t) : String(t).toLowerCase())).filter(Boolean)
    : [];
  const wantFlag = fd.flag || '';
  const wantStatus = fd.status && fd.status !== 'all' ? fd.status : null;

  // If a base deck is chosen, include all its sub-decks (matches browser semantics).
  let allowedDeckIds = null;
  if (wantDeckId) {
    allowedDeckIds = typeof getSubDeckIds === 'function'
      ? new Set(getSubDeckIds(wantDeckId))
      : new Set([wantDeckId]);
  }

  for (const topic of (state.topics || [])) {
    if (!topic || topic.isPastFixed) continue;
    if (topic.deckId == null) continue;
    if (allowedDeckIds && !allowedDeckIds.has(topic.deckId)) continue;
    if (wantTags.length) {
      const topicTags = (Array.isArray(topic.tags) ? topic.tags : [])
        .map(t => (typeof normalizeTag === 'function' ? normalizeTag(t) : String(t).toLowerCase()));
      if (!wantTags.every(tag => topicTags.includes(tag))) continue;
    }
    if (wantFlag && topic.flag !== wantFlag) continue;
    if (wantStatus && typeof topicMatchesStatus === 'function') {
      if (!topicMatchesStatus(topic, wantStatus, now)) continue;
    }
    if (search) {
      const haystack = `${topic.title || ''} ${topic.content || ''} ${typeof getDeckName === 'function' ? getDeckName(topic.deckId) : ''}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }
    out.add(topic.id);
  }

  // Anki is:due — cap new cards at daily limit per root deck
  if (wantStatus === 'due') {
    const _matchTopics = (state.topics || []).filter(t => out.has(t.id));
    const _capped = _capNewCardsAtDailyLimit(_matchTopics);
    return new Set(_capped.map(t => t.id));
  }

  return out;
}

function rebuildFilteredDeck(filteredDeckId) {
  const fd = typeof getFilteredDeckById === 'function'
    ? getFilteredDeckById(filteredDeckId)
    : null;
  if (!fd) return false;
  const ids = _computeFilteredDeckMatchIds(fd);
  fd.cardIds   = Array.from(ids);
  fd.rebuiltAt = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString();
  if (typeof saveImmediate === 'function') saveImmediate();
  if (typeof renderDecks   === 'function') renderDecks();
  if (typeof showToast     === 'function') {
    showToast(`Rebuilt "${fd.name}" — ${fd.cardIds.length} card${fd.cardIds.length !== 1 ? 's' : ''}`, 'success');
  }
  return true;
}

window.getFilteredDeckSnapshot = getFilteredDeckSnapshot;
window.rebuildFilteredDeck     = rebuildFilteredDeck;

const _origRenderBrowseDeck = typeof window.renderBrowse === 'function'
  ? window.renderBrowse
  : null;

function renderBrowse() {
  if (state.browseMode === 'deck' && _origRenderBrowseDeck) {
    return _origRenderBrowseDeck();
  }
  state.browseMode = 'card';
  renderCardBrowser();
}

function renderCardBrowser() {
  const container = el('browseContainer');
  if (!container) return;

  const titleEl = el('browseDeckTitle');
  if (titleEl) titleEl.textContent = 'Card Browser';
  const subtitleEl = titleEl?.parentElement?.querySelector('.sec-sub');
  if (subtitleEl) subtitleEl.textContent = 'Search, filter, and manage cards across your cards';

  container.innerHTML = `
    <div class="browser-panel">
      <div class="browser-filter-strip">
        <div class="browser-filter-item">
          <label class="visually-hidden" for="browserSearchInput">Search cards</label>
          <input id="browserSearchInput" type="search" class="field-input" placeholder="Search title, answer or deck…" value="${esc(BROWSER_STATE.filters.search)}">
        </div>
        <div class="browser-filter-item">
          <label class="visually-hidden" for="browserDeckFilter">Deck</label>
          <select id="browserDeckFilter" class="field-input"></select>
        </div>
        <div class="browser-filter-item">
          <label class="visually-hidden" for="browserTagFilter">Tag</label>
          <select id="browserTagFilter" class="field-input"></select>
        </div>
        <div class="browser-filter-item">
          <label class="visually-hidden" for="browserFlagFilter">Flag</label>
          <select id="browserFlagFilter" class="field-input">
            <option value="">Any flag</option>
            <option value="red">Red</option>
            <option value="orange">Orange</option>
            <option value="green">Green</option>
            <option value="blue">Blue</option>
          </select>
        </div>
        <div class="browser-filter-item">
          <label class="visually-hidden" for="browserStatusFilter">Status</label>
          <select id="browserStatusFilter" class="field-input">
            <option value="all">All status</option>
            <option value="due">Due</option>
            <option value="new">New</option>
            <option value="learning">Learning</option>
            <option value="review">Review</option>
            <option value="suspended">Suspended</option>
            <option value="buried">Buried</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>
        <button id="browserFilterResetBtn" class="btn-secondary" type="button">Reset</button>
        <button id="browserSaveFilterBtn" class="btn-secondary" type="button">Save as Filtered Deck</button>
      </div>

      <div id="browserBulkBar" class="browser-bulk-bar hidden">
        <div class="browser-bulk-label">
          <strong id="browserBulkCount">0 selected</strong>
        </div>
        <div class="browser-bulk-actions">
          <button class="btn-secondary" type="button" data-browser-action="suspend-selected">Suspend</button>
          <button class="btn-secondary" type="button" data-browser-action="unsuspend-selected">Unsuspend</button>
          <button class="btn-secondary" type="button" data-browser-action="bury-selected">Bury</button>
          <button class="btn-secondary" type="button" data-browser-action="tag-selected">Add tags</button>
          <button class="btn-danger" type="button" data-browser-action="delete-selected">Delete</button>
          <button class="btn-secondary" type="button" id="browserBulkClear">Clear</button>
        </div>
      </div>

      <div class="browser-table-wrap">
        <table class="browser-table" id="browserTable" aria-label="Card browser table">
          <thead>
            <tr>
              <th><label><input type="checkbox" id="browserSelectAll"></label></th>
              <th>Title</th>
              <th>Deck</th>
              <th>Tags</th>
              <th>Status</th>
              <th>Flag</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  populateBrowserFilterOptions();
  updateBrowserTable();
}

function populateBrowserFilterOptions() {
  const deckSel = el('browserDeckFilter');
  const tagSel = el('browserTagFilter');
  if (deckSel) {
    deckSel.innerHTML = '<option value="all">All decks</option>';
    const allIds = new Set(state.decks.map(d => d.id));
    const roots = state.decks.filter(d => !d.parentId || !allIds.has(d.parentId));
    const addOptions = (parentId, depth) => {
      state.decks.filter(d => d.parentId === parentId).forEach(deck => {
        const opt = document.createElement('option');
        opt.value = deck.id;
        opt.textContent = ' '.repeat(depth * 2) + '↳ ' + deck.name;
        deckSel.appendChild(opt);
        addOptions(deck.id, depth + 1);
      });
    };
    roots.forEach(deck => {
      const opt = document.createElement('option');
      opt.value = deck.id;
      opt.textContent = deck.name;
      deckSel.appendChild(opt);
      addOptions(deck.id, 1);
    });
    deckSel.value = BROWSER_STATE.filters.deckId;
  }

  if (tagSel) {
    tagSel.innerHTML = '<option value="all">All tags</option>';
    getAllTags().forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      tagSel.appendChild(opt);
    });
    tagSel.value = BROWSER_STATE.filters.tag;
  }

  const flagSel = el('browserFlagFilter');
  if (flagSel) flagSel.value = BROWSER_STATE.filters.flag || '';
  const statusSel = el('browserStatusFilter');
  if (statusSel) statusSel.value = BROWSER_STATE.filters.status || 'all';
}

/**
 * Anki is:due — new cards are "due" but capped at the daily new-card limit
 * per root deck.  Used by getBrowserTopics and _computeFilteredDeckMatchIds
 * so both the Browser table and Filtered-Deck snapshots respect the limit.
 */
function _capNewCardsAtDailyLimit(topics) {
  const _decks = state.decks || [];
  const _parentMap = new Map(_decks.map(d => [d.id, d.parentId || null]));
  const _rootOf = (id) => {
    let cur = id, safety = 0;
    while (cur && safety++ < 10) {
      const parent = _parentMap.get(cur);
      if (!parent) return cur;
      cur = parent;
    }
    return cur;
  };

  // Compute remaining new-card budget per root deck
  const budgetPerRoot = {};
  const usedPerRoot = {};
  for (const d of _decks) {
    if (d.parentId) continue; // roots only
    const limit = typeof getEffectiveNewLimit === 'function' ? getEffectiveNewLimit(d.id) : 20;
    const treeIds = typeof getSubDeckIds === 'function' ? getSubDeckIds(d.id) : [d.id];
    let studied = 0;
    if (typeof getStudiedNewTodayInDeck === 'function') {
      for (const tid of treeIds) studied += getStudiedNewTodayInDeck(tid);
    }
    budgetPerRoot[d.id] = Math.max(0, limit - studied);
    usedPerRoot[d.id] = 0;
  }

  const result = [];
  for (const t of topics) {
    const card = typeof ensureCard === 'function' ? ensureCard(t.id) : null;
    const isNew = card && (card.pile === 'new' || !card.pile) && !card.lastReviewedAt;
    if (isNew) {
      const rootId = _rootOf(t.deckId);
      const budget = budgetPerRoot[rootId] ?? 0;
      if ((usedPerRoot[rootId] ?? 0) < budget) {
        usedPerRoot[rootId] = (usedPerRoot[rootId] ?? 0) + 1;
        result.push(t);
      }
    } else {
      result.push(t); // review / learning / relearning — always keep
    }
  }
  return result;
}

function getBrowserTopics() {
  const now = Date.now();
  const search = (BROWSER_STATE.filters.search || '').trim().toLowerCase();
  const results = (state.topics || []).filter(topic => {
    if (!topic || topic.isPastFixed) return false;
    if (topic.deckId == null) return false;
    if (BROWSER_STATE.filters.deckId && BROWSER_STATE.filters.deckId !== 'all') {
      const _allowedIds = BROWSER_STATE._deckIdSet
        || (BROWSER_STATE._deckIdSet = new Set(
             typeof getSubDeckIds === 'function'
               ? getSubDeckIds(BROWSER_STATE.filters.deckId)
               : [BROWSER_STATE.filters.deckId]));
      if (!_allowedIds.has(topic.deckId)) return false;
    }
    if (BROWSER_STATE.filters.tag && BROWSER_STATE.filters.tag !== 'all') {
      const topicTags = (Array.isArray(topic.tags) ? topic.tags : []).map(normalizeTag);
      if (!topicTags.includes(normalizeTag(BROWSER_STATE.filters.tag))) return false;
    }
    if (BROWSER_STATE.filters.flag && BROWSER_STATE.filters.flag !== '') {
      if (topic.flag !== BROWSER_STATE.filters.flag) return false;
    }
    if (BROWSER_STATE.filters.status && BROWSER_STATE.filters.status !== 'all') {
      if (!topicMatchesStatus(topic, BROWSER_STATE.filters.status, now)) return false;
    }
    if (search) {
      const haystack = `${topic.title || ''} ${topic.content || ''} ${getDeckName(topic.deckId)}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // Anki is:due — cap new cards at daily limit per root deck
  if (BROWSER_STATE.filters.status === 'due') {
    return _capNewCardsAtDailyLimit(results);
  }

  return results;
}

function getTopicStatusName(topic) {
  if (isTopicSuspended(topic)) return 'Suspended';
  if (isTopicBuried(topic)) return 'Buried';
  const card = typeof ensureCard === 'function' ? ensureCard(topic.id) : null;
  if (card) {
    if (card.pile === 'new' || !card.pile) return 'New';
    if (card.pile === 'learning' || card.pile === 'relearning') return 'Learning';
    if (card.pile === 'review') return 'Review';
  }
  return 'Unknown';
}

function getTopicTagsHtml(topic) {
  return (Array.isArray(topic.tags) ? topic.tags : []).map(tag => `<span class="tag-pill">${esc(normalizeTag(tag))}</span>`).join(' ');
}

function updateBrowserTable() {
  const tableBody = el('browserTable')?.querySelector('tbody');
  if (!tableBody) return;
  const rows = getBrowserTopics();
  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--ink3);">No cards match these filters.</td></tr>`;
    updateBrowserBulkBar();
    return;
  }

  const html = rows.map(topic => {
    const selected = BROWSER_STATE.selectedIds.has(topic.id);
    const status = getTopicStatusName(topic);
    const flagDot = topic.flag ? `<span class="browser-flag-dot" data-flag="${topic.flag}" title="Flag ${topic.flag}" style="background-color:${getFlagColor(topic.flag)}"></span>` : '';
    const buriedBadge = isTopicBuried(topic) ? '<span class="card-badge card-badge--buried">Buried</span>' : '';
    const suspendedBadge = topic.suspended ? '<span class="card-badge card-badge--suspended">Paused</span>' : '';
    return `
      <tr class="browser-row${selected ? ' selected' : ''}" data-topic-id="${topic.id}">
        <td><input type="checkbox" class="browser-row-checkbox" data-topic-id="${topic.id}" ${selected ? 'checked' : ''}></td>
        <td>${flagDot}${esc(topic.title)}${buriedBadge}${suspendedBadge}</td>
        <td>${esc(getDeckName(topic.deckId))}</td>
        <td>${getTopicTagsHtml(topic)}</td>
        <td>${esc(status)}</td>
        <td>${flagDot}</td>
        <td>
          <button class="btn-secondary btn-sm" data-browser-action="edit" data-topic-id="${topic.id}">Edit</button>
          <button class="btn-secondary btn-sm" data-browser-action="suspend" data-topic-id="${topic.id}">${topic.suspended ? 'Resume' : 'Suspend'}</button>
          <button class="btn-secondary btn-sm" data-browser-action="bury" data-topic-id="${topic.id}">${isTopicBuried(topic) ? 'Unbury' : 'Bury'}</button>
          <button class="btn-secondary btn-sm" data-browser-action="flag" data-topic-id="${topic.id}">Flag</button>
        </td>
      </tr>`;
  }).join('');

  tableBody.innerHTML = html;
  updateBrowserBulkBar();
}

function updateBrowserBulkBar() {
  const count = BROWSER_STATE.selectedIds.size;
  const bulkBar = el('browserBulkBar');
  if (!bulkBar) return;
  if (count === 0) {
    bulkBar.classList.add('hidden');
  } else {
    bulkBar.classList.remove('hidden');
    const label = el('browserBulkCount');
    if (label) label.textContent = `${count} selected`;
  }
}

function toggleBrowserSelection(topicId, checked) {
  if (!topicId) return;
  if (checked) BROWSER_STATE.selectedIds.add(topicId);
  else BROWSER_STATE.selectedIds.delete(topicId);
  updateBrowserBulkBar();
}

function setBrowserSelectAll(value) {
  const topics = getBrowserTopics();
  BROWSER_STATE.selectedIds.clear();
  if (value) {
    topics.forEach(topic => BROWSER_STATE.selectedIds.add(topic.id));
  }
  updateBrowserTable();
}

function browserClearSelection() {
  BROWSER_STATE.selectedIds.clear();
  updateBrowserTable();
}

function browserApplyFilter(field, value) {
  BROWSER_STATE.filters[field] = value;
  if (field === 'tag') {
    BROWSER_STATE.filters.tag = value || 'all';
  }
  updateBrowserTable();
}

function browserClickHandler(event) {
  const target = event.target;
  const actionBtn = target.closest('[data-browser-action]');
  if (actionBtn) {
    event.preventDefault();
    const action = actionBtn.dataset.browserAction;
    const topicId = actionBtn.dataset.topicId;
    if (topicId) {
      handleBrowserRowAction(action, topicId);
    } else {
      handleBrowserBulkAction(action);
    }
    return;
  }

  const selectAll = target.closest('#browserSelectAll');
  if (selectAll) {
    setBrowserSelectAll(selectAll.checked);
    return;
  }

  const rowCheckbox = target.closest('.browser-row-checkbox');
  if (rowCheckbox) {
    toggleBrowserSelection(rowCheckbox.dataset.topicId, rowCheckbox.checked);
    return;
  }

  const editFiltered = target.closest('[data-fdid] .dc-edit');
  if (editFiltered) {
    // handled by deck grid events
  }
}

function handleBrowserRowAction(action, topicId) {
  const topic = state.topics.find(t => t.id === topicId);
  if (!topic) return;
  switch (action) {
    case 'edit':
      if (typeof openEditTopic === 'function') openEditTopic(topicId);
      break;
    case 'suspend':
      if (typeof toggleTopicSuspend === 'function') toggleTopicSuspend(topicId, { skipAdvance: true });
      break;
    case 'bury':
      if (isTopicBuried(topic)) {
        unburyTopic(topicId);
      } else {
        buryTopic(topicId);
      }
      break;
    case 'flag':
      if (typeof showFlagPicker === 'function') showFlagPicker(topicId);
      break;
  }
}

function handleBrowserBulkAction(action) {
  const selected = Array.from(BROWSER_STATE.selectedIds);
  if (!selected.length) return;
  switch (action) {
    case 'suspend-selected':
      selected.forEach(id => { const topic = state.topics.find(t => t.id === id); if (topic) topic.suspended = true; });
      break;
    case 'unsuspend-selected':
      selected.forEach(id => { const topic = state.topics.find(t => t.id === id); if (topic) topic.suspended = false; });
      break;
    case 'bury-selected':
      selected.forEach(id => { if (typeof buryCard === 'function') buryCard(id, { skipAdvance: true }); });
      break;
    case 'tag-selected': {
      const tags = prompt('Add tag(s), comma-separated:');
      if (!tags) return;
      const parsed = tags.split(',').map(t => normalizeTag(t)).filter(Boolean);
      if (!parsed.length) return;
      selected.forEach(id => {
        const topic = state.topics.find(t => t.id === id);
        if (!topic) return;
        topic.tags = Array.from(new Set([...(Array.isArray(topic.tags) ? topic.tags : []).map(normalizeTag), ...parsed]));
      });
      break;
    }
    case 'delete-selected': {
      if (!confirm(`Delete ${selected.length} cards from the browser? This cannot be undone.`)) return;
      selected.forEach(id => {
        state.topics = state.topics.filter(t => t.id !== id);
        delete state.sm2[id];
        state.todayDone = state.todayDone.filter(tid => tid !== id);
      });
      break;
    }
  }

  saveImmediate();
  BROWSER_STATE.selectedIds.clear();
  updateBrowserTable();
  if (typeof renderDecks === 'function') renderDecks();
  if (typeof renderDeckDetailContent === 'function' && T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
}

function browserInputHandler(event) {
  const target = event.target;
  if (target.id === 'browserSearchInput') {
    BROWSER_STATE.filters.search = target.value || '';
    updateBrowserTable();
  }
}

function browserChangeHandler(event) {
  const target = event.target;
  switch (target.id) {
    case 'browserDeckFilter':
      BROWSER_STATE.filters.deckId = target.value;
      BROWSER_STATE._deckIdSet = null;
      updateBrowserTable();
      break;
    case 'browserTagFilter':
      BROWSER_STATE.filters.tag = target.value || 'all';
      updateBrowserTable();
      break;
    case 'browserFlagFilter':
      BROWSER_STATE.filters.flag = target.value || '';
      updateBrowserTable();
      break;
    case 'browserStatusFilter':
      BROWSER_STATE.filters.status = target.value || 'all';
      updateBrowserTable();
      break;
    case 'browserFilterResetBtn':
      resetBrowserFilters();
      break;
    case 'browserBulkClear':
      browserClearSelection();
      break;
    default:
      break;
  }
}

function resetBrowserFilters() {
  BROWSER_STATE.filters = { deckId: 'all', tag: 'all', flag: '', status: 'all', search: '' };
  BROWSER_STATE.selectedIds.clear();
  const searchInput = el('browserSearchInput'); if (searchInput) searchInput.value = '';
  populateBrowserFilterOptions();
  updateBrowserTable();
}

function _getModalField(id) { return el(id) || null; }

function openFilteredDeckModalWithCurrentFilters() {
  const f = BROWSER_STATE.filters;

  // Build an auto-generated name from whichever filters are active
  const parts = [];
  if (f.deckId && f.deckId !== 'all') {
    const deck = state.decks.find(d => d.id === f.deckId);
    if (deck) parts.push(deck.name);
  }
  if (f.status && f.status !== 'all') {
    parts.push(f.status.charAt(0).toUpperCase() + f.status.slice(1));
  }
  if (f.tag && f.tag !== 'all') {
    parts.push('#' + f.tag);
  }
  if (f.search && f.search.trim()) {
    parts.push('\u201c' + f.search.trim() + '\u201d');
  }
  const name = parts.length ? parts.join(' \u00b7 ') : 'Filtered Deck';

  const prefill = {
    name,
    deckId: f.deckId || 'all',
    tags: f.tag && f.tag !== 'all' ? f.tag : '',
    flag: f.flag || '',
    status: f.status || 'all',
    search: f.search || '',
  };

  openFilteredDeckModal(null, prefill);
}

function openFilteredDeckModal(editId = null, prefill = null) {
  const title = el('filteredDeckModalTitle');
  const hiddenId = el('filteredDeckEditId');
  const name = el('filteredDeckName');
  const base = el('filteredDeckBase');
  const tags = el('filteredDeckTags');
  const flag = el('filteredDeckFlags');
  const status = el('filteredDeckStatus');
  const search = el('filteredDeckSearch');

  if (!name || !base || !tags || !flag || !status || !search || !title || !hiddenId) return;
  hiddenId.value = editId || '';
  title.textContent = editId ? 'Edit Filtered Deck' : 'Create Filtered Deck';
  populateFilteredDeckBaseOptions();

  if (prefill) {
    name.value = prefill.name || '';
    base.value = prefill.deckId || 'all';
    tags.value = prefill.tags || '';
    flag.value = prefill.flag || '';
    status.value = prefill.status || 'all';
    search.value = prefill.search || '';
  } else if (editId) {
    const deck = getFilteredDeckById(editId);
    if (deck) {
      name.value = deck.name || '';
      base.value = deck.deckId || 'all';
      tags.value = (deck.tags || []).join(', ');
      flag.value = deck.flag || '';
      status.value = deck.status || 'all';
      search.value = deck.search || '';
    }
  } else {
    name.value = '';
    base.value = 'all';
    tags.value = '';
    flag.value = '0';
    status.value = 'all';
    search.value = '';
  }

  if (typeof openModal === 'function') openModal('filteredDeckModal');
}

function closeFilteredDeckModal() {
  if (typeof closeModal === 'function') closeModal('filteredDeckModal');
}

function populateFilteredDeckBaseOptions() {
  const base = el('filteredDeckBase');
  if (!base) return;
  base.innerHTML = '<option value="all">All decks</option>';
  const allIds = new Set(state.decks.map(d => d.id));
  const roots = state.decks.filter(d => !d.parentId || !allIds.has(d.parentId));
  const addOptions = (parentId, depth) => {
    state.decks.filter(d => d.parentId === parentId).forEach(deck => {
      const opt = document.createElement('option');
      opt.value = deck.id;
      opt.textContent = ' '.repeat(depth * 2) + '↳ ' + deck.name;
      base.appendChild(opt);
      addOptions(deck.id, depth + 1);
    });
  };
  roots.forEach(deck => {
    const opt = document.createElement('option');
    opt.value = deck.id;
    opt.textContent = deck.name;
    base.appendChild(opt);
    addOptions(deck.id, 1);
  });
}

function saveFilteredDeck() {
  const hiddenId = el('filteredDeckEditId');
  const name = (el('filteredDeckName')?.value || '').trim();
  const deckId = el('filteredDeckBase')?.value || 'all';
  const tags = (el('filteredDeckTags')?.value || '').split(',').map(t => normalizeTag(t)).filter(Boolean);
  const flag = el('filteredDeckFlags')?.value || '';
  const status = el('filteredDeckStatus')?.value || 'all';
  const search = (el('filteredDeckSearch')?.value || '').trim();
  if (!name) { alert('Please name the filtered deck.'); return; }

  const now = todayStr();
  let deck = null;
  if (hiddenId?.value) deck = getFilteredDeckById(hiddenId.value);
  if (!deck) {
    deck = { id: `f_${uid()}`, createdAt: now };
    state.filteredDecks = Array.isArray(state.filteredDecks) ? state.filteredDecks : [];
    state.filteredDecks.push(deck);
  }

  deck.name = name;
  deck.deckId = deckId;
  deck.tags = tags;
  deck.flag = flag || null;
  deck.status = status;
  deck.search = search;
  deck.updatedAt = now;

  // Anki behavior: saving a filtered deck (create OR edit) takes a fresh
  // snapshot of cards matching the query. After this, the snapshot is frozen
  // until the user clicks "Rebuild".
  const _matchIds = _computeFilteredDeckMatchIds(deck);
  deck.cardIds   = Array.from(_matchIds);
  deck.rebuiltAt = now;

  saveImmediate();
  if (typeof renderDecks === 'function') renderDecks();
  if (state.section === 'flashcards' && typeof renderFC === 'function') renderFC();
  closeFilteredDeckModal();
}

function attachBrowserEvents() {
  document.addEventListener('click', function (event) {
    const target = event.target;
    const actionBtn = target.closest('[data-browser-action]');
    if (actionBtn) {
      event.preventDefault();
      const action = actionBtn.dataset.browserAction;
      const topicId = actionBtn.dataset.topicId;
      if (topicId) handleBrowserRowAction(action, topicId);
      else handleBrowserBulkAction(action);
      return;
    }

    const resetBtn = target.closest('#browserFilterResetBtn');
    if (resetBtn) {
      event.preventDefault();
      resetBrowserFilters();
      return;
    }

    const saveFilterBtn = target.closest('#browserSaveFilterBtn');
    if (saveFilterBtn) {
      event.preventDefault();
      openFilteredDeckModalWithCurrentFilters();
      return;
    }

    const clearBulk = target.closest('#browserBulkClear');
    if (clearBulk) {
      event.preventDefault();
      browserClearSelection();
      return;
    }

    const newFilteredDeck = target.closest('#newFilteredDeckBtn');
    if (newFilteredDeck) {
      event.preventDefault();
      openFilteredDeckModal();
      return;
    }

    const saveFiltered = target.closest('#saveFilteredDeckBtn');
    if (saveFiltered) {
      event.preventDefault();
      saveFilteredDeck();
      return;
    }
  });

  document.addEventListener('input', function (event) {
    const target = event.target;
    if (target.id === 'browserSearchInput') {
      BROWSER_STATE.filters.search = target.value || '';
      updateBrowserTable();
      return;
    }
  });

  document.addEventListener('change', function (event) {
    const target = event.target;
    if (target.id === 'browserDeckFilter') {
      BROWSER_STATE.filters.deckId = target.value || 'all';
      BROWSER_STATE._deckIdSet = null;
      updateBrowserTable();
      return;
    }
    if (target.id === 'browserTagFilter') {
      BROWSER_STATE.filters.tag = target.value || 'all';
      updateBrowserTable();
      return;
    }
    if (target.id === 'browserFlagFilter') {
      BROWSER_STATE.filters.flag = target.value || '';
      updateBrowserTable();
      return;
    }
    if (target.id === 'browserStatusFilter') {
      BROWSER_STATE.filters.status = target.value || 'all';
      updateBrowserTable();
      return;
    }
    if (target.id === 'browserSelectAll') {
      setBrowserSelectAll(target.checked);
      return;
    }
    if (target.classList.contains('browser-row-checkbox')) {
      toggleBrowserSelection(target.dataset.topicId, target.checked);
      return;
    }
  });
}

attachBrowserEvents();

window.openFilteredDeckModal = openFilteredDeckModal;
window.openFilteredDeckModalWithCurrentFilters = openFilteredDeckModalWithCurrentFilters;
window.renderBrowse = renderBrowse;