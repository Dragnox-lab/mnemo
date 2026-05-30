'use strict';

// ─── FLAG COLOR HELPER ─────────────────────────────────────────────────────────

function getFlagColor(color) {
  const colors = {
    red: '#ef4444',
    orange: '#f97316',
    green: '#22c55e',
    blue: '#3b82f6'
  };
  return colors[color] || '#ef4444';
}

// ─── NAV STACK + STATE INIT ───────────────────────────────────────────────────

if (typeof window.T === 'undefined') window.T = {};
if (!Array.isArray(window.T.deckNavStack)) window.T.deckNavStack = [];
if (!window.T.topicsExpanded || typeof window.T.topicsExpanded !== 'object') {
  window.T.topicsExpanded = {};
}

// ─── DRAG-TO-REORDER ─────────────────────────────────────────────────────────
//
// Long-press (LP_MS) on the ⠿ handle activates drag. Works with both mouse
// and touch via the Pointer Events API. Reordering is scoped to siblings that
// share the same data-parent-key, so deck rows cannot accidentally be dropped
// inside the children of another deck.

const _dr = {
  active:     false,
  type:       null,   // 'deck' | 'topic'
  id:         null,
  parentKey:  null,
  el:         null,   // source .tree-row
  ghost:      null,   // floating clone
  ph:         null,   // placeholder indicator bar
  timer:      null,
  startX:     0,
  startY:     0,
};
const LP_MS = 480;

// WeakSet so the pointerdown listener is added only once per container element
const _dragAttached = new WeakSet();

function _injectDragCSS() {
  if (document.getElementById('_drCSS')) return;
  const s = document.createElement('style');
  s.id = '_drCSS';
  s.textContent = `
    .drag-handle {
      cursor: grab; padding: 0 7px; color: var(--txt3, #9ca3af);
      user-select: none; touch-action: none; flex-shrink: 0; opacity: .4;
      display: flex; flex-direction: column; gap: 2.5px; justify-content: center;
      align-self: center;
    }
    .drag-handle:hover { opacity: 1; cursor: grab; }
    .drag-handle:active { cursor: grabbing; }
    .dh-r { display: flex; gap: 3px; }
    .dh-d { width: 3px; height: 3px; border-radius: 50%; background: currentColor; display: block; flex-shrink: 0; }
    .tree-row.is-inbox .drag-handle { visibility: hidden; pointer-events: none; }
    .tree-row.is-dragging { opacity: .25; pointer-events: none; }
    .drag-ghost {
      position: fixed; pointer-events: none; z-index: 9999;
      opacity: .9; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.35);
      background: var(--bg2, #1e293b);
    }
    .drag-placeholder {
      height: 3px; background: var(--acc, #6366f1);
      border-radius: 2px; margin: 1px 0;
      pointer-events: none; transition: none;
    }
    details.adv-section > summary {
      cursor: pointer; font-size: .83em;
      color: var(--txt2, #94a3b8);
      list-style: none; user-select: none;
      padding: 6px 0; display: flex; align-items: center; gap: 5px;
    }
    details.adv-section > summary::-webkit-details-marker { display: none; }
    details.adv-section > summary::before {
      content: '▸'; font-size: .75em; transition: transform .15s;
    }
    details.adv-section[open] > summary::before { content: '▾'; }
    details.adv-section > .adv-body { padding-top: 4px; }

    /* ── Move Deck modal overlay ────────────────────────────────── */
    #moveDeckModal {
      display: none;
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.6);
      align-items: center; justify-content: center;
      padding: 16px;
    }
    #moveDeckModal.open { display: flex; }
    #moveDeckModal .mdm-card {
      background: var(--bg2, #1e293b);
      border-radius: 14px;
      box-shadow: 0 16px 48px rgba(0,0,0,.5);
      width: 100%; max-width: 420px;
      max-height: 80vh;
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    #moveDeckModal .mdm-header {
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--bdr, rgba(255,255,255,.08));
    }
    #moveDeckModal .mdm-title {
      font-size: 1.05em; font-weight: 600;
      color: var(--txt1, #f1f5f9);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #moveDeckModal .mdm-sub {
      font-size: .8em; color: var(--txt3, #9ca3af); margin-top: 3px;
    }
    #moveDeckModal .mdm-picker {
      flex: 1; overflow-y: auto; padding: 8px 0;
    }
    #moveDeckModal .mdm-row {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 20px; cursor: pointer;
      transition: background .12s;
      color: var(--txt1, #f1f5f9);
    }
    #moveDeckModal .mdm-row:hover:not(.mdm-disabled) { background: var(--bg3, rgba(255,255,255,.05)); }
    #moveDeckModal .mdm-row.mdm-selected { background: var(--acc-dim, rgba(99,102,241,.2)); }
    #moveDeckModal .mdm-row.mdm-disabled {
      opacity: .35; cursor: not-allowed; pointer-events: none;
    }
    #moveDeckModal .mdm-radio {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid var(--txt3, #9ca3af);
      flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    }
    #moveDeckModal .mdm-row.mdm-selected .mdm-radio {
      border-color: var(--acc, #6366f1);
      background: var(--acc, #6366f1);
    }
    #moveDeckModal .mdm-row.mdm-selected .mdm-radio::after {
      content: ''; width: 6px; height: 6px;
      border-radius: 50%; background: #fff;
    }
    #moveDeckModal .mdm-name { font-size: .9em; flex: 1; }
    #moveDeckModal .mdm-depth-hint {
      font-size: .75em; color: var(--txt3, #9ca3af);
    }
    #moveDeckModal .mdm-footer {
      padding: 14px 20px;
      border-top: 1px solid var(--bdr, rgba(255,255,255,.08));
      display: flex; gap: 10px; justify-content: flex-end;
    }
    #moveDeckModal .mdm-btn {
      padding: 8px 18px; border-radius: 8px; border: none;
      font-size: .9em; font-weight: 500; cursor: pointer;
      transition: opacity .15s;
    }
    #moveDeckModal .mdm-btn:hover { opacity: .85; }
    #moveDeckModal .mdm-cancel {
      background: var(--bg3, rgba(255,255,255,.08));
      color: var(--txt2, #94a3b8);
    }
    #moveDeckModal .mdm-confirm {
      background: var(--acc, #6366f1); color: #fff;
    }
    #moveDeckModal .mdm-confirm:disabled {
      opacity: .4; cursor: not-allowed;
    }

    /* ── Move button in deck cards ──────────────────────────────── */
    .dc-move {
      color: var(--txt2, #94a3b8);
    }
    .dc-move:hover { color: var(--acc, #6366f1); }

    /* ── Chevron expand/collapse button next to deck rows ───────── */
    .deck-chevron-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--txt3, #9ca3af);
      cursor: pointer;
      flex-shrink: 0;
      font-size: .78em;
      transition: background .12s, color .12s, transform .15s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .deck-chevron-btn:hover {
      background: var(--bg3, rgba(255,255,255,.08));
      color: var(--txt1, #f1f5f9);
    }
    .deck-chevron-btn.is-expanded {
      color: var(--acc, #6366f1);
    }
    .deck-chevron-btn svg {
      transition: transform .15s ease;
      pointer-events: none;
    }
    .deck-chevron-btn.is-expanded svg {
      transform: rotate(90deg);
    }

    /* ── Cards-under-deck collapsible wrapper ───────────────────── */
    .deck-cards-collapse {
      overflow: hidden;
    }
    .deck-cards-collapse[hidden] {
      display: none;
    }

    /* ── Three-dot menu ─────────────────────────────────────────── */
    .deck-menu-wrap {
      position: relative;
      flex-shrink: 0;
      margin-left: auto;
      z-index: 20;
    }
    .deck-menu-wrap.menu-open {
      z-index: 1200;
    }
    .deck-menu-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--txt3, #9ca3af);
      cursor: pointer;
      font-size: 1.1em;
      letter-spacing: 1px;
      transition: background .12s, color .12s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
    }
    .deck-menu-btn:hover {
      background: var(--bg3, rgba(255,255,255,.08));
      color: var(--txt1, #f1f5f9);
    }
    .deck-menu-dropdown {
      display: none;
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      z-index: 1201;
      pointer-events: auto;
      min-width: 148px;
      background: var(--bg2, #1e293b);
      border: 1px solid var(--bdr, rgba(255,255,255,.10));
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,.4);
      overflow: hidden;
      flex-direction: column;
    }
    .deck-menu-dropdown.open {
      display: flex;
    }
    .deck-menu-item {
      display: flex;
      align-items: center;
      pointer-events: auto;
      gap: 9px;
      padding: 10px 14px;
      font-size: .88em;
      color: var(--txt1, #f1f5f9);
      cursor: pointer;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      transition: background .10s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .deck-menu-item:hover {
      background: var(--bg3, rgba(255,255,255,.07));
    }
    .deck-menu-item.danger {
      color: var(--red, #f87171);
    }
    .deck-menu-item .dmi-icon {
      font-size: 1em;
      width: 18px;
      text-align: center;
    }
  `;
  document.head.appendChild(s);
}

// ── Inject Move Deck Modal DOM ────────────────────────────────────────────────

function _injectMoveDeckModal() {
  if (document.getElementById('moveDeckModal')) return;

  const div = document.createElement('div');
  div.id = 'moveDeckModal';
  div.innerHTML = `
    <div class="mdm-card">
      <div class="mdm-header">
        <div class="mdm-title" id="mdmTitle">Move Deck</div>
        <div class="mdm-sub" id="mdmSub">Select a destination</div>
      </div>
      <div class="mdm-picker" id="mdmPicker"></div>
      <div class="mdm-footer">
        <button class="mdm-btn mdm-cancel" id="mdmCancelBtn">Cancel</button>
        <button class="mdm-btn mdm-confirm" id="mdmConfirmBtn" disabled>Move Here</button>
      </div>
    </div>`;
  document.body.appendChild(div);

  // Backdrop click closes modal
  div.addEventListener('click', e => {
    if (e.target === div) _closeMoveDeckModal();
  });
  document.getElementById('mdmCancelBtn').addEventListener('click', _closeMoveDeckModal);
  document.getElementById('mdmConfirmBtn').addEventListener('click', executeMoveDeck);
}

function _closeMoveDeckModal() {
  const modal = document.getElementById('moveDeckModal');
  if (modal) modal.classList.remove('open');
  T.movingDeckId = null;
  T.movePicked   = undefined;
}

// ── Open Move Modal ───────────────────────────────────────────────────────────

function openMoveDeck(deckId) {
  _injectMoveDeckModal();
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;

  T.movingDeckId = deckId;
  T.movePicked   = undefined; // nothing selected yet

  const titleEl = document.getElementById('mdmTitle');
  const subEl   = document.getElementById('mdmSub');
  const picker  = document.getElementById('mdmPicker');

  if (titleEl) titleEl.textContent = `Move "${deck.name}"`;
  if (subEl)   subEl.textContent   = 'Choose a new location';
  if (picker)  picker.innerHTML    = _buildMovePickerHTML(deckId);

  // Wire picker row clicks
  picker?.addEventListener('click', _onMovePickerClick);

  document.getElementById('moveDeckModal').classList.add('open');
}

function _onMovePickerClick(e) {
  const row = e.target.closest('.mdm-row:not(.mdm-disabled)');
  if (!row) return;
  T.movePicked = row.dataset.destId; // '' = top level, or a deckId
  // Update selection visuals
  row.closest('#mdmPicker').querySelectorAll('.mdm-row').forEach(r =>
    r.classList.toggle('mdm-selected', r === row));
  const confirmBtn = document.getElementById('mdmConfirmBtn');
  if (confirmBtn) confirmBtn.disabled = false;
}

function _buildMovePickerHTML(movingId, parentId = null, depth = 0) {
  let html = '';
  const indent = '&nbsp;'.repeat(depth * 4);

  // "Top Level" option only at root call
  if (depth === 0) {
    const currentParent = state.decks.find(d => d.id === movingId)?.parentId || null;
    const isCurrentLoc  = currentParent === null;
    html += `
      <div class="mdm-row${isCurrentLoc ? ' mdm-disabled' : ''}" data-dest-id="">
        <div class="mdm-radio"></div>
        <div class="mdm-name">📂 Top Level</div>
        ${isCurrentLoc ? '<div class="mdm-depth-hint">(current)</div>' : ''}
      </div>`;
  }

  const movingDeck        = state.decks.find(d => d.id === movingId);
  const movingDescendants = getAllChildDeckIds(movingId, [movingId]);
  const subtreeHeight     = _getSubtreeHeight(movingId);

  state.decks
    .filter(d => (d.parentId || null) === parentId)
    .sort(_byOrder)
    .forEach(deck => {
      if (deck.id === movingId) return; // skip self

      const isDescendant  = movingDescendants.includes(deck.id);
      const destDepth     = getDeckDepth(deck.id);
      // Would moving here exceed depth 3? The moved deck's subtree height + dest depth + 1
      const wouldExceed   = (destDepth + 1 + subtreeHeight) > 2;
      const isCurrentLoc  = deck.id === (movingDeck?.parentId || null);
      const isDisabled    = isDescendant || wouldExceed;

      let hint = '';
      if (isCurrentLoc)  hint = 'current';
      if (isDescendant)  hint = 'descendant';
      if (wouldExceed)   hint = 'too deep';

      html += `
        <div class="mdm-row${isDisabled || isCurrentLoc ? ' mdm-disabled' : ''}"
             data-dest-id="${deck.id}"
             style="padding-left:${20 + depth * 18}px">
          <div class="mdm-radio"></div>
          <div class="mdm-name">${indent}📁 ${esc(deck.name)}</div>
          ${hint ? `<div class="mdm-depth-hint">${hint}</div>` : ''}
        </div>`;

      // Recurse into children
      html += _buildMovePickerHTML(movingId, deck.id, depth + 1);
    });

  return html;
}

/**
 * Returns the height (max depth below) of a deck's subtree.
 * A deck with no children has height 0.
 */
function _getSubtreeHeight(deckId) {
  const children = state.decks.filter(d => d.parentId === deckId);
  if (!children.length) return 0;
  return 1 + Math.max(...children.map(c => _getSubtreeHeight(c.id)));
}

// ── Execute Move ──────────────────────────────────────────────────────────────

function executeMoveDeck() {
  const deckId    = T.movingDeckId;
  const destId    = T.movePicked; // '' = top level, deckId string = specific parent
  if (!deckId || destId === undefined) return;

  const deck      = state.decks.find(d => d.id === deckId);
  if (!deck) return;

  const newParentId = destId === '' ? null : destId;

  // Validation
  if (newParentId === deckId) {
    alert('A deck cannot be its own parent.'); return;
  }
  if (wouldCreateCircularReference(deckId, newParentId)) {
    alert('This would create a circular reference.'); return;
  }
  if (newParentId) {
    const destDepth    = getDeckDepth(newParentId);
    const subtreeH     = _getSubtreeHeight(deckId);
    if (destDepth + 1 + subtreeH > 2) {
      alert('Moving here would exceed the maximum nesting depth of 3 levels.'); return;
    }
  }
  // Duplicate name check at destination
  const nameLower = deck.name.toLowerCase();
  const duplicate = state.decks.some(d =>
    d.id !== deckId &&
    d.name.toLowerCase() === nameLower &&
    (d.parentId || null) === newParentId
  );
  if (duplicate) {
    alert('A deck with that name already exists at the destination.'); return;
  }

  // Commit move
  const idx = state.decks.findIndex(d => d.id === deckId);
  if (idx !== -1) {
    state.decks[idx].parentId = newParentId;
    // Place at end of destination siblings
    const siblings = state.decks.filter(d =>
      (d.parentId || null) === newParentId && d.id !== deckId);
    state.decks[idx]._order = _nextOrder(siblings);
  }

  // If destination gets its first sub-deck, migrate it to container
  if (newParentId) migrateToContainer(newParentId, deckId);

  // Clear topic expansion state for moved deck (fresh start in new location)
  delete T.topicsExpanded[deckId];

  save();
  _closeMoveDeckModal();
  renderDecks();
  refreshAllDeckSelects();

  if (T.currentDeckDetailId) {
    renderDeckDetailContent(T.currentDeckDetailId);
  }
}

// ── Attach long-press drag to a container (idempotent) ───────────────────────

function _attachDragToContainer(container) {
  if (_dragAttached.has(container)) return;
  _dragAttached.add(container);
  container.addEventListener('pointerdown', _onDragPointerDown);
}

function _onDragPointerDown(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  const row = handle.closest('.tree-row');
  if (!row) return;

  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;

  _dr.timer = setTimeout(() => _drActivate(row, e), LP_MS);

  // Cancel if pointer moves too far before long-press fires
  function onMove(me) {
    if (Math.hypot(me.clientX - sx, me.clientY - sy) > 8) {
      clearTimeout(_dr.timer);
      document.removeEventListener('pointermove', onMove);
    }
  }
  function onUp() {
    clearTimeout(_dr.timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function _drActivate(row, e) {
  if (_dr.active) return;
  _dr.active    = true;
  _dr.type      = row.dataset.type;
  _dr.id        = _dr.type === 'deck' ? row.dataset.deckId : row.dataset.topicId;
  _dr.parentKey = row.dataset.parentKey || '';
  _dr.el        = row;

  row.classList.add('is-dragging');

  // Ghost clone that follows the pointer
  _dr.ghost = row.cloneNode(true);
  _dr.ghost.classList.add('drag-ghost');
  _dr.ghost.classList.remove('is-dragging');
  const rect = row.getBoundingClientRect();
  _dr.ghost.style.width   = rect.width  + 'px';
  _dr.ghost.style.left    = rect.left   + 'px';
  _dr.ghost.style.top     = rect.top    + 'px';
  document.body.appendChild(_dr.ghost);

  // Placeholder bar inserted before the source row
  _dr.ph = document.createElement('div');
  _dr.ph.className = 'drag-placeholder';
  row.parentNode.insertBefore(_dr.ph, row);

  document.addEventListener('pointermove', _drMove,   { passive: false });
  document.addEventListener('pointerup',   _drCommit);
  document.addEventListener('pointercancel', _drCancel);
}

function _drMove(e) {
  if (!_dr.active) return;
  e.preventDefault();

  // Move ghost
  _dr.ghost.style.left = (e.clientX - 20) + 'px';
  _dr.ghost.style.top  = (e.clientY - 20) + 'px';

  // Temporarily hide ghost so elementFromPoint can see through it
  _dr.ghost.style.visibility = 'hidden';
  const target = document.elementFromPoint(e.clientX, e.clientY);
  _dr.ghost.style.visibility = '';

  const targetRow = target?.closest('.tree-row:not(.is-dragging)');
  if (targetRow && targetRow.dataset.parentKey === _dr.parentKey) {
    const mid = targetRow.getBoundingClientRect().top
              + targetRow.getBoundingClientRect().height / 2;
    if (e.clientY < mid) {
      targetRow.parentNode.insertBefore(_dr.ph, targetRow);
    } else {
      targetRow.parentNode.insertBefore(_dr.ph, targetRow.nextSibling);
    }
  }
}

function _drCommit() {
  if (!_dr.active) return;
  _drCleanListeners();

  const ph = _dr.ph;
  if (ph && ph.parentNode) {
    // Collect all sibling rows with the same parentKey (in document order)
    const container = ph.closest('[id]') || document.body;
    const key = CSS.escape(_dr.parentKey);
    const siblingRows = [...container.querySelectorAll(
      `.tree-row[data-parent-key="${key}"]`
    )].filter(r => !r.classList.contains('is-dragging'));

    // Build ordered list: use document position of each sibling vs placeholder
    const allDesc = [...container.querySelectorAll('*')];
    const phPos   = allDesc.indexOf(ph);

    const withPos = siblingRows.map(r => ({
      id:   r.dataset.type === 'deck' ? r.dataset.deckId : r.dataset.topicId,
      type: r.dataset.type,
      pos:  allDesc.indexOf(r),
    }));

    // Insert dragged item at placeholder position
    const insertAt = withPos.findIndex(s => s.pos > phPos);
    const newOrder = [...withPos];
    const dragged  = { id: _dr.id, type: _dr.type };
    if (insertAt === -1) {
      newOrder.push(dragged);
    } else {
      newOrder.splice(insertAt, 0, dragged);
    }

    // Persist _order
    newOrder.forEach((item, idx) => {
      if (item.type === 'deck') {
        const d = state.decks.find(d => d.id === item.id);
        if (d) d._order = idx;
      } else {
        const t = state.topics.find(t => t.id === item.id);
        if (t) t._order = idx;
      }
    });
    save();
  }

  _drReset();

  if (T.currentDeckDetailId) {
    renderDeckDetailContent(T.currentDeckDetailId);
  }
}

function _drCancel() {
  _drCleanListeners();
  _drReset();
}

function _drCleanListeners() {
  document.removeEventListener('pointermove', _drMove);
  document.removeEventListener('pointerup',   _drCommit);
  document.removeEventListener('pointercancel', _drCancel);
}

function _drReset() {
  _dr.el?.classList.remove('is-dragging');
  _dr.ghost?.remove();
  _dr.ph?.remove();
  _dr.active    = false;
  _dr.type      = _dr.id     = _dr.parentKey = null;
  _dr.el        = _dr.ghost  = _dr.ph        = null;
  _dr.timer     = null;
}

// ─── ORDER HELPERS ────────────────────────────────────────────────────────────

const _byOrder = (a, b) => (a._order ?? 9999) - (b._order ?? 9999);

function _nextOrder(siblings) {
  if (!siblings.length) return 0;
  return Math.max(...siblings.map(s => s._order ?? -1)) + 1;
}

// ─── DECK LIST ───────────────────────────────────────────────────────────────

function renderDecks() {
  const grid  = el('decksGrid');
  const empty = el('decksEmpty');
  if (!grid || !empty) return;

  // ── Ensure the search bar exists in the decks section header ────────────
  _ensureDecksSearchBar();

  const allTopLevel = state.decks.filter(d =>
    !d.parentId || !state.decks.some(p => p.id === d.parentId));

  if (!allTopLevel.length) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  // ── Apply current search filter (deck names + descendant names) ─────────
  const q = (T._deckSearchQuery || '').trim().toLowerCase();
  let topLevel = allTopLevel;
  if (q) {
    topLevel = allTopLevel.filter(d => _deckOrDescendantMatches(d.id, q));
  }

  const filteredDecks = (state.filteredDecks || []).filter(fd =>
    !q || (fd.name || '').toLowerCase().includes(q)
  );

  if (!topLevel.length && !filteredDecks.length) {
    empty.classList.add('hidden');
    grid.innerHTML = `<div class="deck-search-empty"
         style="grid-column:1/-1;padding:32px;text-align:center;color:var(--ink3,#888)">
         No decks match "${esc(q)}".</div>`;
    attachDeckEvents();
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = filteredDecks.map(renderFilteredDeckCard).join('')
    + topLevel.map(d => renderTopLevelDeckCard(d, q)).join('');
  attachDeckEvents();
}

function _deckOrDescendantMatches(deckId, q) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return false;
  if ((deck.name || '').toLowerCase().includes(q)) return true;
  return state.decks
    .filter(d => d.parentId === deckId)
    .some(child => _deckOrDescendantMatches(child.id, q));
}

function _ensureDecksSearchBar() {
  if (document.getElementById('deckSearchInput')) return;
  const grid = el('decksGrid');
  if (!grid) return;

  // Look for a sensible header in the decks section to anchor the search bar.
  const section = document.getElementById('section-decks') || grid.parentElement;
  if (!section) return;

  const wrap = document.createElement('div');
  wrap.className = 'deck-search-wrap';
  wrap.style.cssText =
    'margin:0 0 14px;display:flex;align-items:center;gap:8px;width:100%;';
  wrap.innerHTML = `
    <div style="position:relative;flex:1;display:flex;align-items:center">
      <span aria-hidden="true"
        style="position:absolute;left:12px;pointer-events:none;opacity:.55;font-size:14px">🔍</span>
      <input id="deckSearchInput" type="search" autocomplete="off"
             placeholder="Search decks…"
             aria-label="Search decks by name"
             style="width:100%;padding:10px 36px 10px 34px;border-radius:10px;
                    border:1px solid var(--bord, rgba(255,255,255,.1));
                    background:var(--surf, #1a1a26);color:var(--ink, #f5f5fa);
                    font-size:.92rem;outline:none">
      <button id="deckSearchClear" type="button" aria-label="Clear search"
              style="position:absolute;right:6px;background:transparent;border:0;
                     color:var(--ink3,#888);cursor:pointer;font-size:18px;
                     padding:4px 8px;display:none">×</button>
    </div>`;

  // Insert above the grid so it appears in both desktop and mobile layouts.
  grid.parentNode.insertBefore(wrap, grid);

  const input  = wrap.querySelector('#deckSearchInput');
  const clrBtn = wrap.querySelector('#deckSearchClear');
  let _t = null;

  input.addEventListener('input', () => {
    clrBtn.style.display = input.value ? 'block' : 'none';
    if (_t) clearTimeout(_t);
    _t = setTimeout(() => {
      T._deckSearchQuery = input.value || '';
      renderDecks();
    }, 150);
  });

  clrBtn.addEventListener('click', () => {
    input.value = '';
    clrBtn.style.display = 'none';
    T._deckSearchQuery = '';
    renderDecks();
    input.focus();
  });
}

function getDeckDueCount(deckId) {
  const topics = getTopicsForDeck(deckId);
  const now = Date.now();
  let scheduledDue = 0;
  let rawNew = 0;
  for (const t of topics) {
    const card = ensureCard(t.id);
    if (!card) continue;
    const pile = card.pile;
    if (pile === 'review' || pile === 'learning' || pile === 'relearning') {
      if ((card.nextReviewAt || 0) <= now) scheduledDue++;
    } else if (pile === 'new') {
      rawNew++;
    }
  }
  // New-card budget is shared across the whole tree rooted at this deck's root.
  const newCount = Math.max(0, Math.min(rawNew, getTreeNewBudget(deckId)));
  return scheduledDue + newCount;
}

function renderTopLevelDeckCard(deck, query = '') {
  const allTopics = getTopicsForDeck(deck.id);
  const dueCount  = getDeckDueCount(deck.id);
  const total     = allTopics.length;
  const retention = getDeckRetention(deck.id);

  // Sub-deck context for search: when the deck name doesn't match but a
  // descendant does, list those descendants in a muted "non-matching parent"
  // style so hierarchy context is preserved.
  let subdeckHintHTML = '';
  if (query) {
    const nameMatches = (deck.name || '').toLowerCase().includes(query);
    if (!nameMatches) {
      const matchingDescendants = state.decks.filter(d =>
        getSubDeckIds(deck.id).includes(d.id) &&
        d.id !== deck.id &&
        (d.name || '').toLowerCase().includes(query)
      );
      if (matchingDescendants.length) {
        subdeckHintHTML = `
          <div class="dc-subdeck-hint" style="margin-top:8px;padding:6px 10px;
               border-left:2px solid var(--bord,rgba(255,255,255,.15));
               opacity:.55;font-size:.78rem">
            <div style="opacity:.7;font-size:.7rem;text-transform:uppercase;
                        letter-spacing:.06em;margin-bottom:2px">Matches in</div>
            ${matchingDescendants.map(s =>
              `<div>↳ ${esc(s.name)}</div>`).join('')}
          </div>`;
      }
    }
  }

  return `
    <div class="deck-card" data-deck-id="${deck.id}"
         role="button" tabindex="0" aria-label="Open deck ${esc(deck.name)}">
      <div class="dc-bar" style="background:${deck.color}"></div>
      ${dueCount > 0 ? `<div class="dc-due-badge">${dueCount} due</div>` : ''}

      <div class="dc-top">
        <div class="dc-name">${esc(deck.name)}</div>
        <div class="dc-actions">
          <button class="dc-act-btn dc-move" data-did="${deck.id}" title="Move deck"
                  aria-label="Move ${esc(deck.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
          <button class="dc-act-btn dc-edit" data-did="${deck.id}" title="Edit deck"
                  aria-label="Edit ${esc(deck.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="dc-act-btn dc-del" data-did="${deck.id}" title="Delete deck"
                  aria-label="Delete ${esc(deck.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      ${deck.desc ? `<div class="dc-desc">${esc(deck.desc)}</div>` : ''}

      <div class="dc-stats">
        <div class="dc-stat">
          <div class="dc-stat-val" style="color:${deck.color}">${total}</div>
          <div class="dc-stat-lab">Cards</div>
        </div>
        <div class="dc-stat">
          <div class="dc-stat-val" style="color:var(--red)">${dueCount}</div>
          <div class="dc-stat-lab">Due</div>
        </div>
        <div class="dc-stat">
          <div class="dc-stat-val" style="color:var(--grn)">
            ${retention !== null ? retention + '%' : '—'}
          </div>
          <div class="dc-stat-lab">Retention</div>
        </div>
      </div>

      <div class="dc-cta-row" style="margin-top:12px;display:flex;gap:8px">
        <button class="dc-cram-btn" data-did="${deck.id}"
                aria-label="Cram ${esc(deck.name)}"
                style="flex:1;padding:9px 14px;border-radius:10px;border:0;
                       cursor:pointer;font-weight:600;font-size:.88rem;
                       background:linear-gradient(135deg,var(--acc,#8b5cf6),var(--cyan,#38bdf8));
                       color:#fff;box-shadow:var(--shadow,0 2px 8px rgba(0,0,0,.3));
                       touch-action:manipulation;-webkit-tap-highlight-color:transparent">
          ⚡ Cram
        </button>
      </div>
      ${subdeckHintHTML}
    </div>`;
}

/**
 * Returns the due count for a filtered deck, using the same budget-aware
 * logic as getDeckDueCount() so new-card limits are respected.
 */
function getFilteredDeckDueCount(filteredDeck) {
  // Static snapshot — see browser.js getFilteredDeckSnapshot().
  // Count only cards that are actually due in this filtered deck snapshot,
  // without applying the global new-card budget to a saved filter.
  const topicIds = typeof getFilteredDeckSnapshot === 'function'
    ? getFilteredDeckSnapshot(filteredDeck)
    : new Set(filteredDeck?.cardIds || []);
  const now = Date.now();

  let dueCount = 0;
  topicIds.forEach(tid => {
    const topic = (state.topics || []).find(t => t.id === tid);
    if (!topic || topic.isPastFixed) return;
    if (typeof topicMatchesStatus === 'function' && topicMatchesStatus(topic, 'due', now)) {
      dueCount++;
    }
  });

  return dueCount;
}

function renderFilteredDeckCard(filteredDeck) {
  const topicIds = typeof getFilteredDeckSnapshot === 'function'
    ? getFilteredDeckSnapshot(filteredDeck)
    : new Set(filteredDeck?.cardIds || []);
  const total = topicIds.size;
  const dueCount = getFilteredDeckDueCount(filteredDeck);
  const retValues = [];

  topicIds.forEach(tid => {
    const card = typeof ensureCard === 'function' ? ensureCard(tid) : null;
    if (!card) return;
    if (typeof getRetention === 'function') {
      const ret = getRetention(card);
      if (Number.isFinite(ret)) retValues.push(ret);
    }
  });

  const retention = retValues.length
    ? Math.round(retValues.reduce((a, b) => a + b, 0) / retValues.length)
    : null;

  return `
    <div class="deck-card" data-filtered-deck-id="${filteredDeck.id}"
         role="button" tabindex="0" aria-label="Open deck ${esc(filteredDeck.name)}">
      <div class="dc-bar" style="background:${filteredDeck.color || '#7B6EF6'}"></div>
      ${dueCount > 0 ? `<div class="dc-due-badge">${dueCount} due</div>` : ''}

      <div class="dc-top">
        <div class="dc-name-group">
          <div class="dc-name">${esc(filteredDeck.name)}</div>
          <div class="dc-pill dc-pill--filtered">Filtered</div>
        </div>
        <div class="dc-actions">
          <button class="dc-act-btn dc-edit" data-fdid="${filteredDeck.id}" title="Edit deck"
                  aria-label="Edit ${esc(filteredDeck.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="dc-act-btn dc-del" data-fdid="${filteredDeck.id}" title="Delete deck"
                  aria-label="Delete ${esc(filteredDeck.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      ${filteredDeck.desc ? `<div class="dc-desc">${esc(filteredDeck.desc)}</div>` : ''}

      <div class="dc-stats">
        <div class="dc-stat">
          <div class="dc-stat-val" style="color:${filteredDeck.color || '#7B6EF6'}">${total}</div>
          <div class="dc-stat-lab">Cards</div>
        </div>
        <div class="dc-stat">
          <div class="dc-stat-val" style="color:var(--red)">${dueCount}</div>
          <div class="dc-stat-lab">Due</div>
        </div>
        <div class="dc-stat">
          <div class="dc-stat-val" style="color:var(--grn)">${retention !== null ? retention + '%' : '—'}</div>
          <div class="dc-stat-lab">Retention</div>
        </div>
      </div>
      <div class="dc-cta-row" style="margin-top:12px;display:flex;gap:8px">
        <button class="dc-cram-btn" data-fdid="${filteredDeck.id}" aria-label="Cram ${esc(filteredDeck.name)}" style="flex:1;padding:9px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:600;font-size:.88rem;background:linear-gradient(135deg,var(--acc,#8b5cf6),var(--cyan,#38bdf8));color:#fff;box-shadow:var(--shadow,0 2px 8px rgba(0,0,0,.3));touch-action:manipulation;-webkit-tap-highlight-color:transparent">
          ⚡ Cram
        </button>
      </div>
    </div>`;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getTopicsForDeck(deckId) {
  const ids = getSubDeckIds(deckId);
  return state.topics.filter(t => ids.includes(t.deckId));
}

function getDeckRetention(deckId) {
  const rates = getTopicsForDeck(deckId)
    .map(t => getRetention(ensureCard(t.id)))
    .filter(r => r != null && Number.isFinite(r));
  return rates.length
    ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
    : null;
}

/**
 * Returns 0-indexed depth (0 = top-level, 1 = one level down, …).
 * Max meaningful value is 2 (= 3rd level, cannot have children).
 */
function getDeckDepth(deckId) {
  let depth  = 0;
  let cur    = deckId;
  let safety = 0;
  while (cur && safety++ < 10) {
    const parent = state.decks.find(d => d.id === cur)?.parentId;
    if (!parent) break;
    depth++;
    cur = parent;
  }
  return depth;
}

// ─── CONTAINER DECK HELPERS ──────────────────────────────────────────────────

function isContainerDeck(deckId) {
  return state.decks.some(d => d.parentId === deckId);
}

function migrateToContainer(parentId, newlyCreatedDeckId) {
  const existingSubs = state.decks.filter(
    d => d.parentId === parentId && d.id !== newlyCreatedDeckId
  );
  if (existingSubs.length > 0) return;

  const generalId = uid();
  state.decks.push({
    id:           generalId,
    name:         'General',
    parentId:     parentId,
    isInbox:      true,
    color:        state.decks.find(d => d.id === parentId)?.color,
    scheduleMode: 'fsrs',
    createdAt:    todayStr(),
  });

  state.topics
    .filter(t => t.deckId === parentId)
    .forEach(t => { t.deckId = generalId; });

  save();
}

// ─── DESCRIPTION FIELD ── Feature 3 ─────────────────────────────────────────

function _manageDescField(showForEdit) {
  const descEl = el('deckDesc');
  if (!descEl) return;

  const fieldGroup = descEl.closest('.field-group')
    || descEl.closest('.form-group')
    || descEl.closest('.modal-field')
    || descEl.parentElement;
  if (!fieldGroup) return;

  let details = document.getElementById('deckAdvDetails');
  if (!details) {
    details = document.createElement('details');
    details.id        = 'deckAdvDetails';
    details.className = 'adv-section';

    const summary  = document.createElement('summary');
    summary.textContent = 'Advanced';
    details.appendChild(summary);

    const body     = document.createElement('div');
    body.className = 'adv-body';
    details.appendChild(body);

    fieldGroup.parentNode.insertBefore(details, fieldGroup);
    body.appendChild(fieldGroup);
  }

  if (showForEdit) {
    details.style.display = '';
    details.open = false;
  } else {
    details.style.display = 'none';
    details.open = false;
  }
}

// ─── SUBDECK FOLDER HTML ─────────────────────────────────────────────────────

function buildSubDeckFoldersHTML(parentId) {
  return buildUnifiedTreeHTML(parentId, 0);
}

// ─── DECK GRID EVENTS ────────────────────────────────────────────────────────

function attachDeckEvents() {
  const grid = el('decksGrid');
  if (!grid) return;
  grid.removeEventListener('click',   handleDeckGridClick);
  grid.removeEventListener('keydown', handleDeckGridKeydown);
  grid.addEventListener('click',   handleDeckGridClick);
  grid.addEventListener('keydown', handleDeckGridKeydown);
}

function handleDeckGridClick(e) {
  const card = e.target.closest('.deck-card');
  if (!card) return;
  const filteredDeckId = card.dataset.filteredDeckId;
  const deckId = filteredDeckId ? null : card.dataset.deckId;

  // Check button targets before falling through to deck open
  // Use closest() from the actual click target for reliable mobile behaviour
  if (e.target.closest('.dc-cram-btn')) {
    e.stopPropagation();
    e.preventDefault();
    if (filteredDeckId) {
      cramFilteredDeckById(filteredDeckId);
    } else {
      cramDeckById(deckId);
    }
    return;
  }
  if (e.target.closest('.dc-rebuild-btn')) {
    e.stopPropagation();
    e.preventDefault();
    if (filteredDeckId && typeof rebuildFilteredDeck === 'function') {
      rebuildFilteredDeck(filteredDeckId);
    }
    return;
  }
  if (e.target.closest('.dc-move')) {
    if (filteredDeckId) return;
    e.stopPropagation();
    e.preventDefault();
    openMoveDeck(deckId);
    return;
  }
  if (e.target.closest('.dc-edit')) {
    e.stopPropagation();
    e.preventDefault();
    if (filteredDeckId && typeof openFilteredDeckModal === 'function') {
      openFilteredDeckModal(filteredDeckId);
    } else {
      openEditDeck(deckId);
    }
    return;
  }
  if (e.target.closest('.dc-del')) {
    e.stopPropagation();
    e.preventDefault();
    if (filteredDeckId) {
      const filteredDeck = getFilteredDeckById(filteredDeckId);
      if (!filteredDeck) return;
      T.pendingDeleteId   = filteredDeckId;
      T.pendingDeleteType = 'filteredDeck';
      const msg = el('deleteMsg');
      if (msg) {
        msg.textContent =
          `Delete filtered deck "${filteredDeck.name}"? This cannot be undone.`;
      }
      openModal('deleteModal');
    } else {
      const deck = state.decks.find(d => d.id === deckId);
      if (!deck) return;
      T.pendingDeleteId   = deckId;
      T.pendingDeleteType = 'deck';
      const msg = el('deleteMsg');
      if (msg) {
        msg.textContent =
          `Delete "${deck.name}" and all its sub-decks and cards? This cannot be undone.`;
      }
      openModal('deleteModal');
    }
    return;
  }
  if (e.target.closest('.dc-actions')) {
    // Clicked inside actions area but not a specific button — absorb
    e.stopPropagation();
    return;
  }

  if (filteredDeckId) {
    openFilteredDeckDetail(filteredDeckId);
    return;
  }
  openDeckDetail(deckId);
}

function handleDeckGridKeydown(e) {
  if (e.code !== 'Enter' && e.code !== 'Space') return;
  const card = e.target.closest('.deck-card');
  if (!card || e.target.closest('.dc-actions')) return;
  e.preventDefault();
  if (card.dataset.filteredDeckId) {
    openFilteredDeckDetail(card.dataset.filteredDeckId);
  } else {
    openDeckDetail(card.dataset.deckId);
  }
}

// ─── CREATE / EDIT DECK ──────────────────────────────────────────────────────

function openEditDeck(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;

  T.editingDeckId = deckId;
  T.selectedColor = deck.color;

  const titleEl   = el('deckModalTitle');
  const nameInput = el('deckName');
  const descInput = el('deckDesc');

  if (titleEl)   titleEl.textContent = 'Edit Deck';
  if (nameInput) nameInput.value     = deck.name;
  if (descInput) descInput.value     = deck.desc || '';

  _manageDescField(true);

  updateColorPicker(deck.color);
  refreshDeckParentSelect(deckId);

  const parentSel = el('deckParent');
  if (parentSel) {
    parentSel.value = deck.parentId || '';
    Array.from(parentSel.options).forEach(opt => {
      if (opt.value === deckId) opt.disabled = true;
    });
  }

  const mode = deck.scheduleMode || 'auto';
  document.querySelectorAll('#deckModeSwitch .mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));

  openModal('deckModal');
}

function openNewDeck(parentId = null) {
  T.editingDeckId = null;
  T.selectedColor = DECK_COLORS[0];

  const titleEl   = el('deckModalTitle');
  const nameInput = el('deckName');
  const descInput = el('deckDesc');

  if (titleEl)   titleEl.textContent = parentId ? 'New Sub-Deck' : 'New Deck';
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';

  _manageDescField(false);

  updateColorPicker(T.selectedColor);
  refreshDeckParentSelect();

  const parentSel = el('deckParent');
  if (parentSel) {
    parentSel.value = parentId || '';
    if (parentId) {
      Array.from(parentSel.options).forEach(opt => {
        if (opt.value === parentId) opt.disabled = false;
      });
    }
  }

  // ── Auto mode selected by default on new deck creation ───────────────────
  document.querySelectorAll('#deckModeSwitch .mode-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === 'auto'));

  openModal('deckModal');
}

function saveDeck() {
  const nameInput = el('deckName');
  const descInput = el('deckDesc');
  const parentSel = el('deckParent');

  const name = nameInput?.value.trim();
  if (!name) { alert('Please enter a deck name.'); return; }

  const scheduleMode = document.querySelector('#deckModeSwitch .mode-tab.active')?.dataset.mode || 'auto';
  const parentId     = parentSel?.value || null;
  const color        = T.selectedColor;
  const desc         = descInput?.value.trim() || '';

  const nameLower = name.toLowerCase();
  const duplicate = state.decks.some(d => {
    if (T.editingDeckId && d.id === T.editingDeckId) return false;
    return d.name.toLowerCase() === nameLower
      && (d.parentId || null) === (parentId || null);
  });
  if (duplicate) {
    alert('A deck with that name already exists here.');
    return;
  }

  if (parentId) {
    const parentDepth = getDeckDepth(parentId);
    if (parentDepth >= 2) {
      alert('Maximum nesting depth is 3 levels. Move this deck to a higher level.');
      return;
    }
  }

  if (T.editingDeckId) {
    if (parentId === T.editingDeckId) {
      alert('A deck cannot be its own parent.');
      return;
    }
    if (wouldCreateCircularReference(T.editingDeckId, parentId)) {
      alert('This would create a circular reference. Please choose a different parent.');
      return;
    }

    const idx = state.decks.findIndex(d => d.id === T.editingDeckId);
    if (idx !== -1) {
      state.decks[idx] = { ...state.decks[idx], name, desc, color, scheduleMode, parentId };
    }
  } else {
    const newId    = uid();
    const siblings = state.decks.filter(d => (d.parentId || null) === (parentId || null));
    state.decks.push({
      id:           newId,
      name,
      desc,
      color,
      parentId,
      scheduleMode,
      _order:       _nextOrder(siblings),
      createdAt:    todayStr(),
    });
    if (parentId) migrateToContainer(parentId, newId);
  }

  save();
  closeModal('deckModal');
  renderDecks();
  refreshAllDeckSelects();

  // If the new sub-deck was created from within a filtered deck detail,
  // re-open that filtered deck so the user returns to where they were.
  if (T.__filteredDeckReturnId) {
    const returnId = T.__filteredDeckReturnId;
    T.__filteredDeckReturnId = null;
    openFilteredDeckDetail(returnId);
  }
}

function wouldCreateCircularReference(deckId, newParentId) {
  if (!newParentId) return false;
  let cur = newParentId;
  while (cur) {
    if (cur === deckId) return true;
    cur = state.decks.find(d => d.id === cur)?.parentId || null;
  }
  return false;
}

function deleteDeck(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (deck?.isInbox) {
    const hasCards = state.topics.some(t => t.deckId === deckId);
    if (hasCards) {
      alert('General cannot be deleted while it has cards. Move or delete the cards first.');
      return;
    }
  }

  const allIds = getAllChildDeckIds(deckId, [deckId]);

  state.topics
    .filter(t => allIds.includes(t.deckId))
    .forEach(t => delete state.sm2[t.id]);

  state.topics = state.topics.filter(t => !allIds.includes(t.deckId));
  state.decks  = state.decks.filter(d => !allIds.includes(d.id));

  // Clean up expansion state for deleted decks
  allIds.forEach(id => delete T.topicsExpanded[id]);

  if (deckId === 'starter' || allIds.includes('starter')) {
    state.starterDismissed = true;
  }
  saveImmediate();   // bypass the 300ms debounce so tab-close can't drop the write
  renderDecks();
  refreshAllDeckSelects();

  if (T.currentDeckDetailId && allIds.includes(T.currentDeckDetailId)) {
    closeModal('deckDetailModal');
    T.currentDeckDetailId = null;
    T.deckNavStack = [];
  }
}

function getAllChildDeckIds(deckId, collector) {
  state.decks
    .filter(d => d.parentId === deckId)
    .forEach(child => {
      collector.push(child.id);
      getAllChildDeckIds(child.id, collector);
    });
  return collector;
}

function refreshDeckParentSelect(excludeId = null) {
  const sel = el('deckParent');
  if (!sel) return;
  sel.innerHTML = '<option value="">None (top level)</option>';

  function addOptions(parentId, depth) {
    state.decks
      .filter(d => d.parentId === parentId && d.id !== excludeId)
      .sort(_byOrder)
      .forEach(deck => {
        const opt       = document.createElement('option');
        opt.value       = deck.id;
        opt.textContent = '\u00a0'.repeat(depth * 3) + '\u2514 ' + deck.name;
        opt.disabled    = depth >= 2;
        if (opt.disabled) opt.title = 'Maximum nesting depth reached';
        sel.appendChild(opt);
        addOptions(deck.id, depth + 1);
      });
  }

  const allIds = new Set(state.decks.map(d => d.id));
  state.decks
    .filter(d => !d.parentId || !allIds.has(d.parentId))
    .sort(_byOrder)
    .forEach(deck => {
      if (deck.id === excludeId) return;
      const opt       = document.createElement('option');
      opt.value       = deck.id;
      opt.textContent = deck.name;
      sel.appendChild(opt);
      addOptions(deck.id, 1);
    });
}

// ─── DECK DETAIL — NAV STACK ─────────────────────────────────────────────────

function openDeckDetail(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;

  const stackTop = T.deckNavStack[T.deckNavStack.length - 1];
  if (stackTop !== deckId) {
    T.deckNavStack.push(deckId);
  }

  T.currentDeckDetailId = deckId;
  renderDeckDetailContent(deckId);
}

function openFilteredDeckDetail(filteredDeckId) {
  const filteredDeck = getFilteredDeckById(filteredDeckId);
  if (!filteredDeck) return;

  T.deckNavStack = [filteredDeckId];
  T.currentDeckDetailId = filteredDeckId;
  renderFilteredDeckDetailContent(filteredDeckId);
}

function clearDeckNavStack() {
  T.deckNavStack = [];
}

function renderFilteredDeckDetailContent(filteredDeckId) {
  const filteredDeck = getFilteredDeckById(filteredDeckId);
  if (!filteredDeck) return;

  const baseDeckId = filteredDeck.deckId && filteredDeck.deckId !== 'all'
    ? filteredDeck.deckId
    : null;

  // ── 1. Compute filtered topic set ─────────────────────────────────────────
  // Static snapshot — see browser.js getFilteredDeckSnapshot()
  const topicIds = typeof getFilteredDeckSnapshot === 'function'
    ? getFilteredDeckSnapshot(filteredDeck)
    : new Set(filteredDeck?.cardIds || []);
  const topics = Array.from(topicIds)
    .map(tid => state.topics.find(t => t.id === tid))
    .filter(Boolean);

  // ── 2. Insert proxy deck so renderDeckDetailContent doesn't bail ──────────
  //    No real data lives here permanently — it's removed synchronously below.
  const proxy = {
    id:       filteredDeckId,
    name:     filteredDeck.name,
    desc:     '',            // subtitle is patched in step 5
    color:    filteredDeck.color || 'var(--acc,#6366f1)',
    parentId: null,
  };
  state.decks.push(proxy);

  // ── 3. Temporarily remap topics to the proxy so the tree renders them ─────
  const originalDeckIds = new Map();
  topics.forEach(t => {
    originalDeckIds.set(t.id, t.deckId);
    t.deckId = filteredDeckId;
  });

  // ── 4. Full render — chevrons, drag, orbital menus, buttons, 100% free ────
  renderDeckDetailContent(filteredDeckId);

  // ── 5. Restore state immediately (sync — DOM is already committed) ─────────
  topics.forEach(t => { t.deckId = originalDeckIds.get(t.id); });
  const proxyIdx = state.decks.indexOf(proxy);
  if (proxyIdx !== -1) state.decks.splice(proxyIdx, 1);

  // ── 6. Patch the 4 things that differ from a normal deck ──────────────────

  // Subtitle
  const subEl = el('ddSub');
  if (subEl) {
    const n = topicIds.size;
    const parts = [`${n} card${n !== 1 ? 's' : ''}`, 'Filtered Deck'];
    if (filteredDeck.desc) parts.push(filteredDeck.desc);
    subEl.textContent = parts.join(' · ');
  }

  // Daily-new-limit panel: filtered decks do NOT own a per-day new-card
  // limit (Anki spec). Remove any panel that renderDeckDetailContent may
  // have inserted via the proxy-deck render above, so it never shows up
  // for a filtered deck's detail view.
  const limitPanel = document.getElementById('ddNewLimitPanel');
  if (limitPanel) limitPanel.remove();

  // Study
  const studyBtn = el('ddStudyBtn');
  if (studyBtn) {
    studyBtn.onclick = () => { closeModal('deckDetailModal'); studyFilteredDeckById(filteredDeckId); };
  }

  // Cram
  const browseBtn = el('ddBrowseBtn');
  if (browseBtn) {
    browseBtn.onclick = () => { closeModal('deckDetailModal'); cramFilteredDeckById(filteredDeckId); };
  }


  // Reset
  const resetBtn = el('ddResetBtn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      T.pendingDeleteId   = filteredDeckId;
      T.pendingDeleteType = 'filteredDeckReset';
      const msg = el('deleteMsg');
      if (msg) msg.textContent =
        `Reset all progress for cards in "${filteredDeck.name}"? This cannot be undone.`;
      openModal('deleteModal');
    };
  }

  // Add Card — proxy was a leaf deck so renderDeckDetailContent showed the button
  //            pointing at filteredDeckId; redirect it to the real target.
  const addBtn = el('ddAddBtn');
  if (addBtn) {
    if (baseDeckId && !isContainerDeck(baseDeckId)) {
      addBtn.style.display = '';
      addBtn.onclick = () => { closeModal('deckDetailModal'); openAddTopic(baseDeckId); };
    } else if (baseDeckId) {
      addBtn.style.display = 'none';
    } else {
      // "All Decks" filter — add to first available leaf deck
      const leafDeck = state.decks.find(d => !isContainerDeck(d.id));
      if (leafDeck) {
        addBtn.style.display = '';
        addBtn.onclick = () => { closeModal('deckDetailModal'); openAddTopic(leafDeck.id); };
      } else {
        addBtn.style.display = 'none';
      }
    }
  }

  // Add Sub-deck — hidden for filtered decks (sub-decks belong to real decks, not filters)
  const addSubBtn = el('ddAddSubBtn');
  if (addSubBtn) addSubBtn.style.display = 'none';
}

function renderDeckDetailContent(deckId) {
  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) {
    // Not a real deck — delegate to filtered deck renderer if applicable.
    // This keeps back-navigation working after the proxy deck is removed.
    if (typeof getFilteredDeckById === 'function' && getFilteredDeckById(deckId)) {
      renderFilteredDeckDetailContent(deckId);
    }
    return;
  }

  const modal = el('deckDetailModal');
  if (!modal) return;

  const allSubIds   = getSubDeckIds(deckId);
  const totalTopics = state.topics.filter(t => allSubIds.includes(t.deckId)).length;
  const directSubs  = state.decks.filter(d => d.parentId === deckId);

  const titleEl        = el('ddTitle');
  const subEl          = el('ddSub');
  const topicContainer = el('ddTopicList');

  if (titleEl) titleEl.textContent = deck.name;
  if (subEl)   subEl.textContent   =
    `${totalTopics} card${totalTopics !== 1 ? 's' : ''}${deck.desc ? ` · ${deck.desc}` : ''}`;
  modal.dataset.deckId = deckId;

  if (topicContainer) {
    if (!totalTopics && !directSubs.length) {
      topicContainer.innerHTML = `
        <div class="empty-state" style="padding:40px 20px">
          <div class="es-icon">📭</div>
          <div class="es-msg">No topics or sub-decks yet.</div>
        </div>`;
    } else {
      topicContainer.innerHTML = buildUnifiedTreeHTML(deckId, 0);
      attachUnifiedTreeEvents(topicContainer);
      _attachDragToContainer(topicContainer);
    }
  }

  // ── Phase 1.2 — Per-Deck New Card Limit override ──────────────────────────
  renderDeckNewLimitPanel(deckId);

  const addBtn       = el('ddAddBtn');
  const studyBtn     = el('ddStudyBtn');
  const browseBtn    = el('ddBrowseBtn');
  const addSubBtn    = el('ddAddSubBtn');
  const resetBtn     = el('ddResetBtn');

  if (addBtn) {
    addBtn.style.display = isContainerDeck(deckId) ? 'none' : '';
    addBtn.onclick = () => { closeModal('deckDetailModal'); openAddTopic(deckId); };
  }
  if (studyBtn) {
    studyBtn.style.display = '';
    studyBtn.onclick  = () => { closeModal('deckDetailModal'); studyDeckById(deckId); };
  }
  if (browseBtn) {
    browseBtn.style.display = '';
    browseBtn.textContent = '⚡ Cram';
    browseBtn.onclick = () => { closeModal('deckDetailModal'); cramDeckById(deckId); };
  }
  if (addSubBtn) {
    addSubBtn.style.display = '';
    addSubBtn.onclick = () => { closeModal('deckDetailModal'); openNewDeck(deckId); };
  }
  if (resetBtn) {
    resetBtn.style.display = '';
    resetBtn.onclick = () => {
      T.pendingDeleteId   = deckId;
      T.pendingDeleteType = 'reset';
      const msg = el('deleteMsg');
      if (msg) msg.textContent =
        `Reset all progress for "${deck.name}" and its sub-decks? This cannot be undone.`;
      openModal('deleteModal');
    };
  }
  if (resetBtn) resetBtn.onclick = () => {
    T.pendingDeleteId   = deckId;
    T.pendingDeleteType = 'reset';
    const msg = el('deleteMsg');
    if (msg) msg.textContent =
      `Reset all progress for "${deck.name}" and its sub-decks? This cannot be undone.`;
    openModal('deleteModal');
  };

  // ── Back button — injected dynamically so it doesn't depend on static HTML ──
  //
  // Rules:
  //   • Only shown when the nav stack has a previous entry (we've drilled in).
  //   • The previous entry must belong to the same root deck as the current one
  //     (so pressing back on Deck A never jumps to Deck B's hierarchy).
  //   • Clicking back pops the stack and re-renders the parent deck detail.
  //   • If the stack reaches depth 1 (root deck), back closes the modal.

  const actionsEl = document.querySelector('#deckDetailModal .dd-actions');
  if (actionsEl) {
    // ── Inject or reuse the dynamic back button ────────────────────────────
    let backBtn = actionsEl.querySelector('.dd-back-btn-dynamic');
    if (!backBtn) {
      backBtn = document.createElement('button');
      backBtn.className = 'btn-secondary dd-back-btn-dynamic';
      backBtn.type = 'button';
      backBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
             style="margin-right:5px;vertical-align:middle">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>Back`;
      actionsEl.insertBefore(backBtn, actionsEl.firstChild);
    }

    // Determine whether back is valid for this deck
    const stackDepth = T.deckNavStack.length;
    const prevDeckId = stackDepth > 1 ? T.deckNavStack[stackDepth - 2] : null;

    // Guard: previous entry must share the same root deck as current
    const currentRoot = _getRootDeckId(deckId);
    const prevRoot    = prevDeckId ? _getRootDeckId(prevDeckId) : null;
    const canGoBack   = prevDeckId !== null && currentRoot === prevRoot;

    backBtn.style.display = canGoBack ? '' : 'none';
    // Re-assign onclick each render so it always captures the right stack state
    backBtn.onclick = () => {
      T.deckNavStack.pop();
      const previous = T.deckNavStack[T.deckNavStack.length - 1];
      if (previous) {
        T.currentDeckDetailId = previous;
        renderDeckDetailContent(previous);
      } else {
        closeModal('deckDetailModal');
        T.currentDeckDetailId = null;
      }
    };

    // ── Restructure dd-actions: back first, then the rest, reset last ────
    if (!actionsEl.dataset.rowified) {
      actionsEl.dataset.rowified = '1';
      const rowPrimary   = document.createElement('div');
      rowPrimary.className = 'dd-row-primary';
      const rowSecondary = document.createElement('div');
      rowSecondary.className = 'dd-row-secondary';

      // Back goes first in primary row
      rowPrimary.appendChild(backBtn);
      [addBtn, studyBtn, browseBtn, addSubBtn].forEach(b => { if (b) rowPrimary.appendChild(b); });
      if (resetBtn) rowSecondary.appendChild(resetBtn);

      Array.from(actionsEl.children).forEach(c => {
        if (c !== rowPrimary && c !== rowSecondary) c.remove();
      });
      actionsEl.appendChild(rowPrimary);
      actionsEl.appendChild(rowSecondary);
    }
  }

  openModal('deckDetailModal');
}

/** Returns the root (top-level) deck ID for any deck in the hierarchy. */
function _getRootDeckId(deckId) {
  let cur    = deckId;
  let safety = 0;
  while (cur && safety++ < 10) {
    const d = state.decks.find(d => d.id === cur);
    if (!d || !d.parentId) return cur;
    cur = d.parentId;
  }
  return cur;
}

/**
 * Returns the remaining new-card budget for the entire deck tree that
 * contains `deckId`. Sub-decks share their root's single daily limit
 * rather than each having an independent budget.
 */
function getTreeNewBudget(deckId) {
  const rootId  = _getRootDeckId(deckId);
  const rootLim = typeof getEffectiveNewLimit === 'function'
    ? getEffectiveNewLimit(rootId)
    : Math.max(0, Number(state.settings?.newCardsPerDay || 0));
  const treeIds = getAllChildDeckIds(rootId, [rootId]);
  let studiedTree = 0;
  if (typeof getStudiedNewTodayInDeck === 'function') {
    for (const id of treeIds) studiedTree += getStudiedNewTodayInDeck(id);
  }
  return Math.max(0, rootLim - studiedTree);
}

// ─── UNIFIED TREE ─────────────────────────────────────────────────────────────
//
// Cards are ALWAYS hidden by default at every depth.
// Each deck row (at any depth, including depth-0 root decks) gets a chevron
// button that toggles T.topicsExpanded[deckId] to show/hide its direct cards.
//
// Rules:
//   • Leaf deck  (no sub-decks, has cards)  → chevron button shown; cards hidden by default.
//   • Mixed deck (has sub-decks AND cards)  → chevron button shown; cards hidden by default.
//   • Container  (has sub-decks, no cards)  → no chevron button (nothing to expand).
//   • Empty deck (no sub-decks, no cards)   → no chevron button.
//
// At depth 0 the root deck being viewed in the modal has no rendered row of
// its own, so we render a slim "Cards (N) ▶" summary row at the top instead.
// Clicking the row or its chevron toggles T.topicsExpanded[parentId].

function _dragHandleHTML(depth) {
  const rows = Math.max(1, 3 - depth);
  let inner  = '';
  for (let r = 0; r < rows; r++) {
    inner += '<span class="dh-r"><span class="dh-d"></span><span class="dh-d"></span></span>';
  }
  return `<div class="drag-handle" aria-label="Hold to reorder" title="Hold to reorder">${inner}</div>`;
}

/**
 * Chevron SVG — points right by default; CSS rotates it 90° when expanded.
 */
function _chevronSVG() {
  return `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"
               xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M3 1.5 L7 5 L3 8.5" stroke="currentColor" stroke-width="1.6"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * Returns the chevron button HTML for a deck that has direct cards.
 * `deckId`     — the deck whose cards this toggles.
 * `count`      — number of direct cards (shown in tooltip).
 * `isExpanded` — current state.
 */
function _chevronBtnHTML(deckId, count, isExpanded) {
  return `<button
    class="deck-chevron-btn${isExpanded ? ' is-expanded' : ''}"
    data-chevron-deck="${deckId}"
    type="button"
    title="${isExpanded ? 'Hide' : 'Show'} ${count} card${count !== 1 ? 's' : ''}"
    aria-label="${isExpanded ? 'Hide' : 'Show'} ${count} card${count !== 1 ? 's' : ''} in this deck"
    aria-expanded="${isExpanded}"
  >${_chevronSVG()}</button>`;
}

/**
 * Builds the orbital context menu HTML for a deck row.
 */
function _deckMenuHTML(deckId, deckName) {
  return `
    <div class="orbital-menu-container" data-menu-deck-id="${deckId}">
      <button class="orbital-trigger"
              aria-label="More options for ${esc(deckName)}"
              title="More options"
              type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
        </svg>
      </button>
      <div class="orbital-ring" id="orbital-ring-${deckId}" data-orbital-deck="${deckId}">
        <button class="orbital-item dd-study-deck" data-sid="${deckId}" type="button" title="Study">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        </button>
        <button class="orbital-item dd-cram-deck" data-sid="${deckId}" type="button" title="Cram">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </button>
        <button class="orbital-item dd-move-deck" data-sid="${deckId}" type="button" title="Move">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button class="orbital-item dd-edit-deck" data-sid="${deckId}" type="button" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="orbital-item danger dd-del-deck" data-sid="${deckId}" type="button" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>`;
}

// ── Shared helper: render a list of topic nodes as tree rows ─────────────────
function _renderTopicRows(topicNodes, parentId, depth, ancestorIsLast) {
  let html = '';
  topicNodes.forEach((node, i) => {
    const isLast = i === topicNodes.length - 1;
    let indentHTML = '';
    ancestorIsLast.forEach(wasLast => {
      indentHTML += `<div class="indent-line${wasLast ? ' hidden-line' : ''}"></div>`;
    });
    if (depth > 0) {
      indentHTML += `<div class="indent-line branch${isLast ? ' is-last' : ''}"></div>`;
    }
    const dragHandle = _dragHandleHTML(depth);
    const card = ensureCard(node.id);
    const pile = card.pile || 'new';
    const stab = card.state ? Math.round(card.state.stability) : 0;
    const ret  = getRetention(card);
    let isDue = false;
    if (pile === 'review' && card.nextReviewAt) {
      isDue = new Date(card.nextReviewAt).toISOString().split('T')[0] <= todayStr();
    } else if ((pile === 'learning' || pile === 'relearning') && card.nextReviewAt) {
      isDue = card.nextReviewAt <= Date.now();
    }
    const pileClass = pile === 'new' ? 'pill-new'
      : (pile === 'learning' || pile === 'relearning') ? 'pill-learn'
      : 'pill-due';
    const pileIcon = pile === 'new' ? '🆕'
      : (pile === 'learning' || pile === 'relearning') ? '📖'
      : '🔁';
    const flagDotHTML = node.flag
      ? `<span class="card-flag-dot" data-flag="${node.flag}" style="background-color:${getFlagColor(node.flag)}"></span>`
      : '';
    const suspendedBadge = node.suspended
      ? `<span class="card-badge card-badge--suspended">Paused</span>`
      : '';
    const buriedBadge = isTopicBuried(node)
      ? `<span class="card-badge card-badge--buried">Buried</span>`
      : '';
    const suspendBtnLabel = node.suspended ? 'Resume card' : 'Suspend card';
    const suspendBtnIcon  = node.suspended ? '▶' : '⏸';
    const pileTip = pile === 'new' ? 'New'
      : (pile === 'learning' || pile === 'relearning') ? 'Learning'
      : `Review · S:${stab}d · ${ret}%`;
    html += `
      <div class="tree-row${isDue ? ' has-due' : ''}"
           data-type="topic"
           data-topic-id="${node.id}"
           data-parent-key="${parentId}">
        <div class="indent-cell">${indentHTML}</div>
        <div class="row-icon" aria-hidden="true">📄</div>
        ${dragHandle}
        <div class="row-label">${flagDotHTML}${esc(node.title)}${suspendedBadge}${buriedBadge}</div>
        <div class="row-counts">
          <span class="count-pill ${pileClass}" title="${esc(pileTip)}">${pileIcon}</span>
        </div>
        <div class="row-actions">
          <button class="act-btn dd-toggle-suspend" data-tid="${node.id}" type="button"
                  aria-label="${esc(suspendBtnLabel)}">${suspendBtnIcon}</button>
          <button class="act-btn dd-bury-topic" data-tid="${node.id}" type="button"
                  aria-label="${isTopicBuried(node) ? 'Unbury' : 'Bury'}">${isTopicBuried(node) ? '🪦' : '⬇'}</button>
          <button class="act-btn dd-flag-topic" data-tid="${node.id}" type="button"
                  aria-label="Flag">🚩</button>
          <button class="act-btn dd-edit-topic" data-tid="${node.id}" type="button"
                  aria-label="Edit ${esc(node.title)}">Edit</button>
          <button class="act-btn del-btn dd-del-topic" data-tid="${node.id}" type="button"
                  aria-label="Delete ${esc(node.title)}">Delete</button>
        </div>
      </div>`;
  });
  return html;
}

/**
 * Wraps topic rows in a collapsible div keyed to `deckId`.
 * Hidden by default unless T.topicsExpanded[deckId] is true.
 */
function _wrapTopicRows(deckId, topicRowsHTML) {
  const isExpanded = !!T.topicsExpanded[deckId];
  return `<div class="deck-cards-collapse"
               id="cards-collapse-${deckId}"
               ${isExpanded ? '' : 'hidden'}
               data-cards-for="${deckId}">${topicRowsHTML}</div>`;
}

// ── Root-level cards summary row ──────────────────────────────────────────────
//
// Rendered at the very top when the deck being viewed (parentId at depth 0)
// has direct cards. Clicking anywhere on the row (or its chevron) toggles
// T.topicsExpanded[parentId]. The deck row itself is not rendered at depth 0
// (the modal header serves that purpose), so this row is the only toggle point.

function _rootCardsRowHTML(parentId, count) {
  const isExpanded = !!T.topicsExpanded[parentId];
  return `
    <div class="tree-row root-cards-row"
         data-type="root-cards-toggle"
         data-chevron-deck="${parentId}"
         role="button"
         tabindex="0"
         aria-expanded="${isExpanded}"
         aria-label="${isExpanded ? 'Hide' : 'Show'} ${count} card${count !== 1 ? 's' : ''} in this deck">
      <div class="indent-cell"></div>
      <div class="row-icon" aria-hidden="true">📄</div>
      <div class="row-label" style="flex:1">
        Cards
        <span style="margin-left:6px;opacity:.55;font-size:.82em">(${count})</span>
      </div>
      ${_chevronBtnHTML(parentId, count, isExpanded)}
    </div>`;
}

function buildUnifiedTreeHTML(parentId, depth = 0, ancestorIsLast = []) {
  let html = '';

  const deckNodes = state.decks
    .filter(d => d.parentId === parentId)
    .map(d => ({ ...d, _type: 'deck' }))
    .sort((a, b) => {
      if (a.isInbox && !b.isInbox) return -1;
      if (b.isInbox && !a.isInbox) return  1;
      return _byOrder(a, b);
    });

  const topicNodes = state.topics
    .filter(t => t.deckId === parentId)
    .sort(_byOrder);

  const hasSubDecks = deckNodes.length > 0;
  const hasTopics   = topicNodes.length > 0;

  // ── Direct cards of `parentId` ────────────────────────────────────────────
  //
  // At depth 0: render a dedicated root-cards-row (the modal header acts as
  // the deck row, so there's nothing else to put the chevron on).
  //
  // At depth > 0: the chevron lives on the deck's own tree-row (see below),
  // and the collapsed wrapper is emitted immediately after the deck row.
  // We handle depth > 0 inside the deckNodes loop further down.
  if (hasTopics) {
    if (depth === 0) {
      // Root deck — show summary row + collapsible wrapper regardless of
      // whether there are also sub-decks.
      html += _rootCardsRowHTML(parentId, topicNodes.length);
      html += _wrapTopicRows(
        parentId,
        _renderTopicRows(topicNodes, parentId, depth, ancestorIsLast)
      );
    }
    // depth > 0 case is handled inside deckNodes loop below.
  }

  // ── Render deck nodes ─────────────────────────────────────────────────────
  deckNodes.forEach((node, i) => {
    const isLast = i === deckNodes.length - 1;

    let indentHTML = '';
    ancestorIsLast.forEach(wasLast => {
      indentHTML += `<div class="indent-line${wasLast ? ' hidden-line' : ''}"></div>`;
    });
    if (depth > 0) {
      indentHTML += `<div class="indent-line branch${isLast ? ' is-last' : ''}"></div>`;
    }

    const dragHandle   = _dragHandleHTML(depth);
    const deckTopics   = getTopicsForDeck(node.id);
    const rawNewCount  = deckTopics.filter(t => ensureCard(t.id).pile === 'new' && !ensureCard(t.id).firstSeenAt).length;
    // Shared tree budget: sub-decks draw from their root's single limit.
    const newCount     = Math.max(0, Math.min(rawNewCount, getTreeNewBudget(node.id)));
    const learnCount   = deckTopics.filter(t => ['learning', 'relearning'].includes(ensureCard(t.id).pile)).length;
    const dueCount     = getDeckDueCount(node.id);
    const inboxBadge   = node.isInbox
      ? `<span class="inbox-badge" title="General inbox sub-deck">📥</span>` : '';

    // Direct cards of this node (used for the chevron + collapsible wrapper)
    const nodeDirectTopics   = state.topics.filter(t => t.deckId === node.id).sort(_byOrder);
    const nodeHasDirectCards = nodeDirectTopics.length > 0;
    const isExpanded         = !!T.topicsExpanded[node.id];

    // Show chevron whenever this deck has direct cards, at any depth.
    const chevronHTML = nodeHasDirectCards
      ? _chevronBtnHTML(node.id, nodeDirectTopics.length, isExpanded)
      : '';

    html += `
      <div class="tree-row${dueCount > 0 ? ' has-due' : ''}${node.isInbox ? ' is-inbox' : ''}"
           data-type="deck"
           data-deck-id="${node.id}"
           data-parent-key="${parentId}">
        <div class="indent-cell">${indentHTML}</div>
        <div class="row-icon" aria-hidden="true">📁</div>
        ${dragHandle}
        <div class="row-label" style="color:${node.color}">${inboxBadge}${esc(node.name)}</div>
        <div class="row-counts">
          <span class="count-pill pill-new"   title="New">${newCount}</span>
          <span class="count-pill pill-learn" title="Learning">${learnCount}</span>
          <span class="count-pill pill-due"   title="Due">${dueCount}</span>
        </div>
        ${chevronHTML}
        ${_deckMenuHTML(node.id, node.name)}
      </div>`;

    // Collapsible cards wrapper for this deck node (hidden by default).
    // Rendered immediately after the deck row so it visually belongs to it.
    if (nodeHasDirectCards) {
      html += _wrapTopicRows(
        node.id,
        _renderTopicRows(nodeDirectTopics, node.id, depth + 1, [...ancestorIsLast, isLast])
      );
    }

    // Recurse into child decks.
    html += buildUnifiedTreeHTML(node.id, depth + 1, [...ancestorIsLast, isLast]);
  });

  return html;
}

function attachUnifiedTreeEvents(container) {
  container.removeEventListener('click', handleDeckMenuCapture, true);
  container.removeEventListener('pointerdown', absorbDeckMenuPointerDown, true);
  container.removeEventListener('click', handleUnifiedTreeClick);
  container.addEventListener('click', handleDeckMenuCapture, true);
  container.addEventListener('pointerdown', absorbDeckMenuPointerDown, true);
  container.addEventListener('click',   handleUnifiedTreeClick);
}

// ── Close all open deck menus ─────────────────────────────────────────────────

function _getOrCreateBackdrop() {
  let bd = document.getElementById('deck-menu-backdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = 'deck-menu-backdrop';
    bd.addEventListener('click', () => _closeAllDeckMenus(null));
    bd.addEventListener('contextmenu', () => _closeAllDeckMenus(null));
    document.body.appendChild(bd);
  }
  return bd;
}

function _closeAllDeckMenus(exceptId) {
  document.querySelectorAll('.deck-menu-dropdown.open').forEach(menu => {
    if (menu.id !== `deck-menu-${exceptId}`) {
      _returnMenuToWrap(menu);
      menu.classList.remove('open');
      menu.closest('.deck-menu-wrap')?.classList.remove('menu-open');
      menu.closest('.deck-card')?.classList.remove('menu-card-active');
    }
  });
  // Also sweep any teleported menus sitting on body
  document.querySelectorAll('body > .deck-menu-dropdown').forEach(menu => {
    if (menu.id !== `deck-menu-${exceptId}`) {
      _returnMenuToWrap(menu);
      menu.classList.remove('open');
    }
  });
  const bd = document.getElementById('deck-menu-backdrop');
  if (bd) bd.style.display = 'none';
}

/** Move an open dropdown back into its original .deck-menu-wrap */
function _returnMenuToWrap(menuEl) {
  const deckId = menuEl.id.replace('deck-menu-', '');
  const wrap = document.querySelector(`.deck-menu-wrap[data-menu-deck-id="${deckId}"]`);
  if (wrap && menuEl.parentNode !== wrap) {
    wrap.appendChild(menuEl);
    // Reset inline positioning set during teleport
    menuEl.style.cssText = '';
  }
}

function _setDeckMenuOpen(deckId, open) {
  const menuEl = document.getElementById(`deck-menu-${deckId}`);
  if (!menuEl) return;
  const wrap = menuEl.closest('.deck-menu-wrap')
            || document.querySelector(`.deck-menu-wrap[data-menu-deck-id="${deckId}"]`);
  const card = wrap?.closest('.deck-card');

  if (!open) {
    _returnMenuToWrap(menuEl);
    menuEl.classList.remove('open');
    wrap?.classList.remove('menu-open');
    card?.classList.remove('menu-card-active');
    const bd = document.getElementById('deck-menu-backdrop');
    if (bd) bd.style.display = 'none';
    return;
  }

  // ── Opening: teleport the dropdown to <body> so it escapes
  //    the deck-card's CSS-animation stacking context entirely ──
  const btn  = wrap?.querySelector('.deck-menu-btn');
  const rect = (btn || wrap)?.getBoundingClientRect();
  if (!rect) return;

  menuEl.classList.add('open');
  wrap?.classList.add('menu-open');
  card?.classList.add('menu-card-active');

  // Move to body, position with fixed coords
  document.body.appendChild(menuEl);
  const menuW = 160; // min-width from injected CSS
  let left = rect.right - menuW;
  if (left < 4) left = 4;
  // Keep on screen vertically
  const menuH = 200; // approximate
  let top = rect.bottom + 4;
  if (top + menuH > window.innerHeight - 8) top = rect.top - menuH - 4;

  menuEl.style.cssText = `
    position: fixed !important;
    top: ${top}px !important;
    left: ${left}px !important;
    right: auto !important;
    z-index: 99999 !important;
    display: flex !important;
  `;

  // Show backdrop to absorb clicks behind the dropdown
  const bd = _getOrCreateBackdrop();
  bd.style.display = 'block';
}

function absorbDeckMenuPointerDown(e) {
  if (e.target.closest('.deck-menu-wrap') || e.target.closest('.orbital-menu-container')) {
    e.stopPropagation();
  }
}

function handleDeckMenuCapture(e) {
  // Handle orbital containers in tree rows
  const orbitalContainer = e.target.closest('.orbital-menu-container');
  if (orbitalContainer) {
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Orbital trigger click — toggle active
    if (e.target.closest('.orbital-trigger')) {
      e.preventDefault();
      const deckId = orbitalContainer.dataset.menuDeckId;
      const wasActive = orbitalContainer.classList.contains('active');
      _closeAllOrbitalMenus(null);
      if (!wasActive) _openOrbitalMenu(deckId);
      return;
    }

    // Orbital item click (ring may have been teleported to body, handled below)
    const orbitalItem = e.target.closest('.orbital-item');
    if (!orbitalItem) return;
    e.preventDefault();
    _closeAllOrbitalMenus(null);
    _runDeckMenuItemAction(orbitalItem);
    return;
  }

  const menuTarget = e.target.closest('.deck-menu-wrap');
  if (!menuTarget) return;

  e.stopPropagation();
  e.stopImmediatePropagation();

  const menuTrigger = e.target.closest('[data-menu-trigger]');
  if (menuTrigger) {
    e.preventDefault();
    const deckId = menuTrigger.dataset.menuTrigger;
    const menuEl = document.getElementById(`deck-menu-${deckId}`);
    if (!menuEl) return;
    const wasOpen = menuEl.classList.contains('open');
    _closeAllDeckMenus(null);
    _setDeckMenuOpen(deckId, !wasOpen);
    return;
  }

  const menuItem = e.target.closest('.deck-menu-item');
  if (!menuItem) return;

  e.preventDefault();
  _runDeckMenuItemAction(menuItem);
}

function _runDeckMenuItemAction(menuItem) {
  const sid = menuItem.dataset.sid;
  if (!sid) return;

  if (menuItem.classList.contains('dd-study-deck')) {
    _closeAllDeckMenus(null);
    closeModal('deckDetailModal');
    studyDeckById(sid);
    return;
  }

  if (menuItem.classList.contains('dd-cram-deck')) {
    _closeAllDeckMenus(null);
    closeModal('deckDetailModal');
    cramDeckById(sid);
    return;
  }

  if (menuItem.classList.contains('dd-move-deck')) {
    _closeAllDeckMenus(null);
    openMoveDeck(sid);
    return;
  }

  if (menuItem.classList.contains('dd-edit-deck')) {
    _closeAllDeckMenus(null);
    closeModal('deckDetailModal');
    openEditDeck(sid);
    return;
  }

  if (menuItem.classList.contains('dd-del-deck')) {
    _closeAllDeckMenus(null);
    const deck = state.decks.find(d => d.id === sid);
    if (!deck) return;
    T.pendingDeleteId   = sid;
    T.pendingDeleteType = 'deck';
    const msg = el('deleteMsg');
    if (msg) {
      msg.textContent =
        `Delete "${deck.name}" and all its sub-decks and cards? This cannot be undone.`;
    }
    openModal('deleteModal');
  }
}

// Outside-click to close menus is now handled by #deck-menu-backdrop (see _getOrCreateBackdrop).
// Keeping a lightweight fallback for edge cases (e.g. Escape key).
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    _closeAllDeckMenus(null);
    _closeAllOrbitalMenus(null);
  }
});

// ─── ORBITAL MENU SYSTEM ─────────────────────────────────────────────────────
//
// The .orbital-ring is teleported to <body> on open (same pattern as
// _setDeckMenuOpen) so it escapes modal overflow:hidden clipping.
// Position is set via fixed coords from the trigger's getBoundingClientRect.

function _openOrbitalMenu(deckId) {
  const container = document.querySelector(`.orbital-menu-container[data-menu-deck-id="${deckId}"]`);
  const ring      = document.getElementById(`orbital-ring-${deckId}`);
  if (!container || !ring) return;

  container.classList.add('active');

  // Teleport ring to body
  document.body.appendChild(ring);

  // Position: centred on the trigger button
  const trigger = container.querySelector('.orbital-trigger');
  const rect    = (trigger || container).getBoundingClientRect();
  const cx      = rect.left + rect.width  / 2;
  const cy      = rect.top  + rect.height / 2;

  ring.style.cssText = `
    position: fixed !important;
    top: ${cy}px !important;
    left: ${cx}px !important;
    width: 0 !important;
    height: 0 !important;
    z-index: 99999 !important;
  `;
  ring.classList.add('open');

  // Backdrop to catch outside clicks
  let bd = document.getElementById('orbital-backdrop');
  if (!bd) {
    bd = document.createElement('div');
    bd.id = 'orbital-backdrop';
    bd.style.cssText = 'position:fixed;inset:0;z-index:99998;display:none';
    bd.addEventListener('click', () => _closeAllOrbitalMenus(null));
    document.body.appendChild(bd);
  }
  bd.style.display = 'block';
}

function _closeAllOrbitalMenus(exceptId) {
  document.querySelectorAll('.orbital-menu-container.active').forEach(c => {
    if (c.dataset.menuDeckId === exceptId) return;
    c.classList.remove('active');
  });
  // Return any teleported rings to their containers
  document.querySelectorAll('.orbital-ring.open').forEach(ring => {
    const deckId    = ring.dataset.orbitalDeck;
    if (deckId === exceptId) return;
    ring.classList.remove('open');
    ring.style.cssText = '';
    const container = document.querySelector(`.orbital-menu-container[data-menu-deck-id="${deckId}"]`);
    if (container && ring.parentNode !== container) container.appendChild(ring);
  });
  const bd = document.getElementById('orbital-backdrop');
  if (bd) bd.style.display = 'none';
}

// Body-level delegate: catches clicks on teleported orbital items
document.addEventListener('click', e => {
  const item = e.target.closest && e.target.closest('.orbital-item');
  if (item && item.closest('.orbital-ring')) {
    e.preventDefault();
    e.stopPropagation();
    _closeAllOrbitalMenus(null);
    _runDeckMenuItemAction(item);
    return;
  }
}, true);

function initOrbitalMenus() {
  // Escape key closes any open orbital
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') _closeAllOrbitalMenus(null);
  });
}

initOrbitalMenus();

// Capture-phase delegate: when the menu is teleported (e.g. portaled to <body>),
// clicks on .deck-menu-item no longer bubble through the deck container's
// click handler. Catch them here and route to _runDeckMenuItemAction.
document.addEventListener('click', e => {
  const menuItem = e.target.closest && e.target.closest('.deck-menu-item');
  if (!menuItem) return;
  e.preventDefault();
  e.stopPropagation();
  _runDeckMenuItemAction(menuItem);
}, true);

// ─── UNIFIED TREE EVENT HANDLER ───────────────────────────────────────────────

function handleUnifiedTreeClick(e) {
  if (e.target.closest('.card-flag-dot, .flag-indicator')) {
    e.stopPropagation();
    return;
  }

  // ── Three-dot menu trigger ─────────────────────────────────────────────────
  const menuTrigger = e.target.closest('[data-menu-trigger]');
  if (menuTrigger) {
    e.stopPropagation();
    e.preventDefault();
    const deckId  = menuTrigger.dataset.menuTrigger;
    const menuEl  = document.getElementById(`deck-menu-${deckId}`);
    if (!menuEl) return;
    const wasOpen = menuEl.classList.contains('open');
    _closeAllDeckMenus(null);
    _setDeckMenuOpen(deckId, !wasOpen);
    return;
  }

  // ── Chevron expand/collapse button (or root-cards-row click) ─────────────
  //
  // Fires for:
  //   1. A .deck-chevron-btn click (data-chevron-deck on the button itself).
  //   2. A click anywhere on a .root-cards-row (which also carries
  //      data-chevron-deck on the row element).
  const chevronTarget = e.target.closest('[data-chevron-deck]');
  if (chevronTarget) {
    // Ignore if the click came from within the menu wrap (it bubbles up)
    if (e.target.closest('.deck-menu-wrap')) return;
    e.stopPropagation();
    e.preventDefault();
    const deckId = chevronTarget.dataset.chevronDeck;
    _toggleDeckCards(deckId);
    return;
  }

  // ── Study deck (from three-dot menu) ──────────────────────────────────────
  const studyDeckBtn = e.target.closest('.dd-study-deck');
  if (studyDeckBtn) {
    e.stopPropagation();
    e.preventDefault();
    _closeAllDeckMenus(null);
    closeModal('deckDetailModal');
    studyDeckById(studyDeckBtn.dataset.sid);
    return;
  }

  // ── Cram deck (from three-dot menu) ───────────────────────────────────────
  const cramDeckBtn = e.target.closest('.dd-cram-deck');
  if (cramDeckBtn) {
    e.stopPropagation();
    e.preventDefault();
    _closeAllDeckMenus(null);
    closeModal('deckDetailModal');
    cramDeckById(cramDeckBtn.dataset.sid);
    return;
  }

  // ── Move deck (from three-dot menu) ───────────────────────────────────────
  const moveDeckBtn = e.target.closest('.dd-move-deck');
  if (moveDeckBtn) {
    e.stopPropagation();
    e.preventDefault();
    _closeAllDeckMenus(null);
    openMoveDeck(moveDeckBtn.dataset.sid);
    return;
  }

  // ── Edit deck (from three-dot menu) ───────────────────────────────────────
  const editDeckBtn = e.target.closest('.dd-edit-deck');
  if (editDeckBtn) {
    e.stopPropagation();
    e.preventDefault();
    _closeAllDeckMenus(null);
    closeModal('deckDetailModal');
    openEditDeck(editDeckBtn.dataset.sid);
    return;
  }

  // ── Delete deck (from three-dot menu) ─────────────────────────────────────
  const delDeckBtn = e.target.closest('.dd-del-deck');
  if (delDeckBtn) {
    e.stopPropagation();
    e.preventDefault();
    _closeAllDeckMenus(null);
    const sid  = delDeckBtn.dataset.sid;
    const deck = state.decks.find(d => d.id === sid);
    if (!deck) return;
    T.pendingDeleteId   = sid;
    T.pendingDeleteType = 'deck';
    const msg = el('deleteMsg');
    if (msg) {
      msg.textContent =
        `Delete "${deck.name}" and all its sub-decks and cards? This cannot be undone.`;
    }
    openModal('deleteModal');
    return;
  }

  // ── Edit topic ─────────────────────────────────────────────────────────────
  const editTopicBtn = e.target.closest('.dd-edit-topic');
  if (editTopicBtn) {
    e.stopPropagation();
    e.preventDefault();
    closeModal('deckDetailModal');
    openEditTopic(editTopicBtn.dataset.tid);
    return;
  }

  // ── Delete topic ───────────────────────────────────────────────────────────
  const delTopicBtn = e.target.closest('.dd-del-topic');
  if (delTopicBtn) {
    e.stopPropagation();
    e.preventDefault();
    const tid   = delTopicBtn.dataset.tid;
    const topic = state.topics.find(t => t.id === tid);
    if (!topic) return;
    T.pendingDeleteId   = tid;
    T.pendingDeleteType = 'topic';
    const msg = el('deleteMsg');
    if (msg) msg.textContent = `Delete "${topic.title}"? This cannot be undone.`;
    openModal('deleteModal');
    return;
  }

  const toggleSuspendBtn = e.target.closest('.dd-toggle-suspend');
  if (toggleSuspendBtn) {
    e.stopPropagation();
    e.preventDefault();
    const tid = toggleSuspendBtn.dataset.tid;
    if (!tid) return;
    if (typeof window.toggleTopicSuspend === 'function') {
      window.toggleTopicSuspend(tid, { skipAdvance: true });
    }
    return;
  }

  const buryBtn = e.target.closest('.dd-bury-topic');
  if (buryBtn) {
    e.stopPropagation();
    e.preventDefault();
    const tid = buryBtn.dataset.tid;
    if (!tid) return;
    const topic = state.topics.find(t => t.id === tid);
    if (topic && isTopicBuried(topic)) {
      if (typeof window.unburyTopic === 'function') window.unburyTopic(tid);
    } else {
      if (typeof window.buryTopic === 'function') window.buryTopic(tid);
    }
    return;
  }

  const flagBtn = e.target.closest('.dd-flag-topic');
  if (flagBtn) {
    e.stopPropagation();
    e.preventDefault();
    const tid = flagBtn.dataset.tid;
    if (!tid) return;
    // Show flag color picker modal
    if (typeof showFlagPicker === 'function') {
      showFlagPicker(tid);
    }
    return;
  }

  // ── Absorb clicks on any row-actions area (prevents deck drill-in) ─────────
  if (e.target.closest('.row-actions') || e.target.closest('.deck-menu-wrap') || e.target.closest('.orbital-menu-container')) {
    e.stopPropagation();
    return;
  }

  // ── Clicking a deck row (not on a button) → drill into sub-deck ───────────
  // Explicitly exclude every interactive sub-element so touch events that
  // somehow survive stopPropagation never accidentally drill into a deck.
  const deckRow = e.target.closest('.tree-row[data-type="deck"]');
  if (deckRow
      && !e.target.closest('.drag-handle')
      && !e.target.closest('[data-chevron-deck]')
      && !e.target.closest('.deck-menu-wrap')
      && !e.target.closest('.orbital-menu-container')
      && !e.target.closest('.deck-menu-item')
      && !e.target.closest('.row-actions')
      && !e.target.closest('.row-counts')) {
    const id = deckRow.dataset.deckId;
    if (id) openDeckDetail(id);
    return;
  }

  // ── Clicking a topic row → open flashcard ─────────────────────────────────
  const topicRow = e.target.closest('.tree-row[data-type="topic"]');
  if (topicRow && !e.target.closest('.drag-handle')) {
    const topicId = topicRow.dataset.topicId;
    if (!topicId) return;
    const deckContext = T.currentDeckDetailId || 'all';
    closeModal('deckDetailModal');
    T.deckNavStack = [];
    if (typeof openFlashcardTopic === 'function') {
      openFlashcardTopic(topicId, { deckFilter: deckContext, dateFilter: 'all' });
    }
  }
}

// ─── CHEVRON TOGGLE HELPER ────────────────────────────────────────────────────
//
// Toggles T.topicsExpanded[deckId] and updates the DOM in-place so the whole
// tree doesn't need to re-render (avoids scroll-position loss).

function _toggleDeckCards(deckId) {
  const wasExpanded = !!T.topicsExpanded[deckId];
  T.topicsExpanded[deckId] = !wasExpanded;
  const nowExpanded = !wasExpanded;

  // Update the collapsible wrapper visibility
  const collapseEl = document.getElementById(`cards-collapse-${deckId}`);
  if (collapseEl) {
    if (nowExpanded) {
      collapseEl.removeAttribute('hidden');
    } else {
      collapseEl.setAttribute('hidden', '');
    }
  }

  // Update ALL chevron buttons and root-cards-rows for this deck
  // (there may be one button and one row element both carrying the attribute)
  document.querySelectorAll(`[data-chevron-deck="${deckId}"]`).forEach(el => {
    // Chevron button
    if (el.classList.contains('deck-chevron-btn')) {
      el.classList.toggle('is-expanded', nowExpanded);
      el.setAttribute('aria-expanded', String(nowExpanded));
      const count = collapseEl
        ? collapseEl.querySelectorAll('.tree-row[data-type="topic"]').length
        : 0;
      const label = `${nowExpanded ? 'Hide' : 'Show'} ${count} card${count !== 1 ? 's' : ''}`;
      el.title = label;
      el.setAttribute('aria-label', label + ' in this deck');
    }
    // Root-cards-row (the row itself also carries the attribute)
    if (el.classList.contains('root-cards-row')) {
      el.setAttribute('aria-expanded', String(nowExpanded));
      const count = collapseEl
        ? collapseEl.querySelectorAll('.tree-row[data-type="topic"]').length
        : 0;
      el.setAttribute('aria-label',
        `${nowExpanded ? 'Hide' : 'Show'} ${count} card${count !== 1 ? 's' : ''} in this deck`);
    }
  });
}

window._toggleDeckCards = _toggleDeckCards;

// ─── PROGRESS RESET ──────────────────────────────────────────────────────────

function resetDeckProgress(deckId) {
  getSubDeckIds(deckId).forEach(did => {
    state.topics
      .filter(t => t.deckId === did)
      .forEach(t => { state.sm2[t.id] = fsrsInit(t.id); });
  });
  save();
  closeModal('deckDetailModal');
  T.deckNavStack = [];
  renderDecks();
}

// ─── STUDY / BROWSE ───────────────────────────────────────────────────────────

function studyDeckById(deckId) {
  T.studyReturnDeckId = deckId;
  if (typeof closeModal === 'function') closeModal('deckDetailModal');
  switchSection('flashcards');
  if (typeof renderFC === 'function') renderFC();
  loadFlashcards(deckId);
}

function browseDeckById(deckId, filter) {
  // Sync the dropdown to whatever filter was requested (e.g. from the
  // deck detail modal "Browse Due" button), then read it back as the
  // single source of truth so the dropdown always reflects reality.
  const filterEl = document.getElementById('browseTypeFilter');
  if (filterEl && filter) filterEl.value = filter;
  const activeFilter = (filterEl && filterEl.value) || filter || 'all';
  T.browseDeckFilter = activeFilter;

  const allIds = getSubDeckIds(deckId);
  let cards = state.topics.filter(t => allIds.includes(t.deckId));

  if (activeFilter === 'due') {
    const { queue } = buildFlashcardPriorityQueue(deckId, 'due');
    const dueIds = new Set(
      (queue || [])
        .filter(t => t.__queueMeta && t.__queueMeta.group !== 'new')
        .map(t => t.id)
    );
    cards = cards.filter(t => dueIds.has(t.id));
  }

  if (!cards.length) {
    const msg = activeFilter === 'due'
      ? 'No due cards in this deck right now.'
      : 'No cards in this deck yet.';
    if (typeof showToast === 'function') showToast(msg, 'info');
    else alert(msg);
    return;
  }

  state.browseQueue  = cards;
  state.browseDeckId = deckId;
  state.browseMode   = 'deck';
  switchSection('browse');
}

function studyFilteredDeckById(filteredDeckId) {
  const filteredDeck = getFilteredDeckById(filteredDeckId);
  if (!filteredDeck) return;
  T.studyReturnDeckId = null;
  if (typeof closeModal === 'function') closeModal('deckDetailModal');
  state.browseMode = 'card';
  switchSection('flashcards');
  // Set type filter to 'due' to show only due cards for filtered decks
  const typeSelEl = el('fcTypeFilter');
  if (typeSelEl) typeSelEl.value = 'due';
  if (typeof loadFlashcards === 'function') loadFlashcards(`filtered:${filteredDeckId}`, 'normal');
}

function cramFilteredDeckById(filteredDeckId) {
  const filteredDeck = getFilteredDeckById(filteredDeckId);
  if (!filteredDeck) return;
  const topicIds = typeof getFilteredDeckSnapshot === 'function'
    ? getFilteredDeckSnapshot(filteredDeck)
    : new Set(filteredDeck.cardIds || []);
  if (!topicIds || !topicIds.size) {
    if (typeof showToast === 'function') {
      showToast('No cards to cram.', 'info');
    } else {
      alert('No cards to cram.');
    }
    return;
  }

  T.studyReturnDeckId = null;
  if (typeof closeModal === 'function') closeModal('deckDetailModal');
  state.browseMode = 'card';
  switchSection('flashcards');
  if (typeof startCramSessionFromIds === 'function') {
    startCramSessionFromIds(`filtered:${filteredDeckId}`, [...topicIds]);
  } else if (typeof loadFlashcards === 'function') {
    loadFlashcards(`filtered:${filteredDeckId}`, 'cram');
  }
}

// ─── CRAM MODE ───────────────────────────────────────────────────────────────

function cramDeckById(deckId) {
  const allIds = getSubDeckIds(deckId);
  const cards  = state.topics.filter(t => allIds.includes(t.deckId));

  if (!cards.length) {
    if (typeof showToast === 'function') {
      showToast('No cards in this deck yet.', 'info');
    } else {
      alert('No cards in this deck yet.');
    }
    return;
  }

  T.cramScope         = { deckId, mode: 'cram' };
  T.studyReturnDeckId = deckId;

  if (typeof closeModal === 'function') closeModal('deckDetailModal');
  switchSection('flashcards');

  // Reset the type filter dropdown to 'all' (Auto). Otherwise a previous
  // session (e.g. Today's Start Session, which sets fcTypeFilter to 'due')
  // leaves the filter narrowed and cram visibly opens with the wrong filter.
  const _typeSelEl = (typeof el === 'function') ? el('fcTypeFilter')
                    : document.getElementById('fcTypeFilter');
  if (_typeSelEl) _typeSelEl.value = 'all';

  if (typeof startCramSession === 'function') {
    startCramSession({ deckId });
  } else if (typeof renderFC === 'function') {
    renderFC();
  }
}

// ─── EVENT SETUP ─────────────────────────────────────────────────────────────

function setupDeckEvents() {
  _injectDragCSS();
  _injectMoveDeckModal();

  el('newDeckBtn')?.addEventListener('click', () => openNewDeck());
  el('createFirstDeckBtn')?.addEventListener('click', () => openNewDeck());
  el('importDeckCsvBtn')?.addEventListener('click', () => switchSection('import'));
  el('saveDeckBtn')?.addEventListener('click', saveDeck);

  el('deckModeSwitch')?.addEventListener('click', e => {
    const btn = e.target.closest('.mode-tab');
    if (!btn) return;
    document.querySelectorAll('#deckModeSwitch .mode-tab').forEach(b =>
      b.classList.remove('active'));
    btn.classList.add('active');
  });

  el('colorRow')?.addEventListener('click', e => {
    const dot = e.target.closest('.color-dot');
    if (!dot) return;
    T.selectedColor = dot.dataset.color;
    updateColorPicker(T.selectedColor);
  });
}

// ─── PHASE 1.2 — PER-DECK NEW CARD LIMIT PANEL ───────────────────────────────

function renderDeckNewLimitPanel(deckId) {
  const body = document.querySelector('#deckDetailModal .modal-body');
  if (!body) return;

  // Filtered decks never own a daily new-card limit (Anki spec).
  // If this id resolves to a filtered deck, remove any stale panel and bail.
  if (typeof getFilteredDeckById === 'function' && getFilteredDeckById(deckId)) {
    const stale = document.getElementById('ddNewLimitPanel');
    if (stale) stale.remove();
    return;
  }

  const deck = state.decks.find(d => d.id === deckId);
  if (!deck) return;

  // Sub-decks share their root's daily new limit, so don't show the
  // override panel for them. Remove any stale panel left from a previous
  // root-deck view.
  if (deck.parentId) {
    const stale = document.getElementById('ddNewLimitPanel');
    if (stale) stale.remove();
    return;
  }

  let panel = document.getElementById('ddNewLimitPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ddNewLimitPanel';
    panel.className = 'dd-newlimit-panel';
    panel.style.cssText = 'margin:6px 0 8px; padding:6px 10px; border-radius:8px; background:var(--surf2,#20202E); border:1px solid var(--bord,rgba(255,255,255,.08)); display:flex; flex-wrap:nowrap; gap:8px; align-items:center; white-space:nowrap; overflow-x:auto;';
    // insert just after action buttons
    const actions = body.querySelector('.dd-actions');
    if (actions && actions.nextSibling) body.insertBefore(panel, actions.nextSibling);
    else body.prepend(panel);
  }

  const globalDefault = Number(state.settings?.newCardsPerDay) || 20;
  const hasOverride   = Number.isFinite(Number(deck.newCardsPerDay)) && Number(deck.newCardsPerDay) >= 0;
  const value         = hasOverride ? Number(deck.newCardsPerDay) : globalDefault;
  const effective     = typeof getEffectiveNewLimit === 'function' ? getEffectiveNewLimit(deckId) : value;

  panel.innerHTML = `
    <strong>📅 Daily new</strong>
    <input type="number" id="ddNewLimitInput" min="0" max="9999" value="${value}"
           style="width:80px; padding:8px 10px; border-radius:8px; border:1px solid var(--bord,rgba(255,255,255,.1)); background:var(--surf,#1A1A26); color:var(--ink,#F5F5FA); font-size:.95rem;">
    <button id="ddNewLimitSave"  class="btn-primary"   style="padding:8px 14px;">Save</button>
    <button id="ddNewLimitClear" class="btn-secondary" style="padding:8px 14px;" ${hasOverride ? '' : 'disabled'}>Global</button>
    <small style="color:var(--ink3,#9ca3af);margin-left:auto;">eff <b>${effective}</b>${hasOverride ? ' · ovr' : ''} · def ${globalDefault}</small>
  `;

  const input    = panel.querySelector('#ddNewLimitInput');
  const saveBtn  = panel.querySelector('#ddNewLimitSave');
  const clearBtn = panel.querySelector('#ddNewLimitClear');

  saveBtn.onclick = () => {
    const v = Math.max(0, Math.min(9999, parseInt(input.value, 10) || 0));
    deck.newCardsPerDay = v;
    if (typeof saveImmediate === 'function') saveImmediate();
    else if (typeof save === 'function') save();
    if (typeof IndexManager !== 'undefined' && IndexManager.scheduleRebuild) IndexManager.scheduleRebuild();
    if (typeof renderToday === 'function') renderToday();
    if (typeof renderDecks === 'function') renderDecks();
    if (typeof renderFC === 'function' && state.section === 'flashcards') renderFC();
    renderDeckNewLimitPanel(deckId);
    if (typeof showToast === 'function') showToast(`Deck limit set to ${v}/day`, 'success');
  };

  clearBtn.onclick = () => {
    delete deck.newCardsPerDay;
    if (typeof saveImmediate === 'function') saveImmediate();
    else if (typeof save === 'function') save();
    if (typeof IndexManager !== 'undefined' && IndexManager.scheduleRebuild) IndexManager.scheduleRebuild();
    if (typeof renderToday === 'function') renderToday();
    if (typeof renderDecks === 'function') renderDecks();
    if (typeof renderFC === 'function' && state.section === 'flashcards') renderFC();
    renderDeckNewLimitPanel(deckId);
    if (typeof showToast === 'function') showToast('Using global default', 'info');
  };
}

window.renderDeckNewLimitPanel   = renderDeckNewLimitPanel;

// ─── FILTERED DECK DELETE — confirm-button handler ───────────────────────────
// Runs alongside other confirm handlers. Only activates for pendingDeleteType === 'filteredDeck'.
(function _bindFilteredDeckDeleteConfirm() {
  function _bind() {
    const btn = el('confirmDeleteBtn');
    if (!btn || btn.__filteredDeleteBound) return;
    btn.__filteredDeleteBound = true;
    btn.addEventListener('click', () => {
      if (T.pendingDeleteType !== 'filteredDeck') return;
      const filteredDeckId = T.pendingDeleteId;
      if (filteredDeckId && Array.isArray(state.filteredDecks)) {
        state.filteredDecks = state.filteredDecks.filter(fd => fd.id !== filteredDeckId);
        if (typeof saveImmediate === 'function') saveImmediate();
        else if (typeof save === 'function') save();
        if (typeof renderDecks === 'function') renderDecks();
      }
      T.pendingDeleteId   = null;
      T.pendingDeleteType = null;
      if (typeof closeModal === 'function') closeModal('deleteModal');
    });
  }
  document.addEventListener('DOMContentLoaded', _bind);
  if (document.readyState !== 'loading') _bind();
})();

// ─── FILTERED DECK RESET — confirm-button handler ────────────────────────────
// Runs alongside the existing topic.js / multi-select confirm handlers.
// Only activates when pendingDeleteType === 'filteredDeckReset'.
(function _bindFilteredDeckResetConfirm() {
  function _bind() {
    const btn = el('confirmDeleteBtn');
    if (!btn || btn.__filteredResetBound) return;
    btn.__filteredResetBound = true;
    btn.addEventListener('click', () => {
      if (T.pendingDeleteType !== 'filteredDeckReset') return;
      const filteredDeckId = T.pendingDeleteId;
      const filteredDeck   = typeof getFilteredDeckById === 'function'
        ? getFilteredDeckById(filteredDeckId) : null;
      if (filteredDeck) {
        const topicIds = typeof getFilteredDeckSnapshot === 'function'
          ? getFilteredDeckSnapshot(filteredDeck)
          : new Set(filteredDeck.cardIds || []);
        topicIds.forEach(tid => {
          if (typeof resetCard === 'function') resetCard(tid);
        });
        if (typeof saveImmediate === 'function') saveImmediate();
        if (typeof renderDecks   === 'function') renderDecks();
        if (typeof renderToday   === 'function') renderToday();
        if (typeof showToast     === 'function')
          showToast(`Reset ${topicIds.size} card${topicIds.size !== 1 ? 's' : ''}`, 'success');
      }
      T.pendingDeleteId   = null;
      T.pendingDeleteType = null;
      if (typeof closeModal === 'function') closeModal('deleteModal');
      // Re-open filtered deck detail so user sees fresh state
      if (filteredDeckId) renderFilteredDeckDetailContent(filteredDeckId);
    });
  }
  document.addEventListener('DOMContentLoaded', _bind);
  if (document.readyState !== 'loading') _bind();
})();

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

window.renderDecks               = renderDecks;
window.getTopicsForDeck          = getTopicsForDeck;
window.getDeckRetention          = getDeckRetention;
window.getDeckDepth              = getDeckDepth;
window.isContainerDeck           = isContainerDeck;
window.migrateToContainer        = migrateToContainer;
window.buildSubDeckFoldersHTML   = buildSubDeckFoldersHTML;
window.openEditDeck              = openEditDeck;
window.openNewDeck               = openNewDeck;
window.saveDeck                  = saveDeck;
window.deleteDeck                = deleteDeck;
window.openDeckDetail            = openDeckDetail;
window.clearDeckNavStack         = clearDeckNavStack;
window.renderDeckDetailContent   = renderDeckDetailContent;
window.resetDeckProgress         = resetDeckProgress;
window.studyDeckById             = studyDeckById;
window.browseDeckById            = browseDeckById;
window.cramDeckById              = cramDeckById;
window.setupDeckEvents           = setupDeckEvents;
window.openMoveDeck              = openMoveDeck;
window.executeMoveDeck           = executeMoveDeck;

// ═════════════════════════════════════════════════════════════════════════════
// MULTI-SELECT (Deck Detail card list — topic rows only)
// Self-contained: hooks renderDeckDetailContent, attaches its own event
// listeners on #ddTopicList, and reuses the existing deleteModal + mdm picker
// styles. SRS state is preserved on bulk-move (deckId reassignment only).
// ═════════════════════════════════════════════════════════════════════════════
(function () {
  if (window.__msDeckInit) return;
  window.__msDeckInit = true;

  const LP_MS = 450; // long-press threshold (mobile + desktop)

  // ── State on T ────────────────────────────────────────────────────────────
  T.msSelectMode    = false;
  T.msSelectedIds   = new Set();
  T.msAnchorId      = null;
  T.msDeckScopeId   = null; // deck whose detail modal is currently scoped

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _msToast(msg, kind) {
    if (typeof showToast === 'function') showToast(msg, kind || 'info');
  }

  function _msTopicRowsInScope() {
    return Array.from(document.querySelectorAll(
      '#ddTopicList .tree-row[data-type="topic"]'
    ));
  }

  function _msAllVisibleIds() {
    return _msTopicRowsInScope().map(r => r.dataset.topicId).filter(Boolean);
  }

  function _msApplyRowVisuals() {
    const list = document.getElementById('ddTopicList');
    if (!list) return;
    list.classList.toggle('ms-select-mode', T.msSelectMode);
    _msTopicRowsInScope().forEach(row => {
      const id = row.dataset.topicId;
      const sel = T.msSelectedIds.has(id);
      row.classList.toggle('ms-selected', sel);
      // Inject check-circle once per row
      if (!row.querySelector('.ms-check')) {
        const chk = document.createElement('div');
        chk.className = 'ms-check';
        chk.setAttribute('aria-hidden', 'true');
        chk.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12"><polyline points="3,8 7,12 13,4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        row.insertBefore(chk, row.firstChild);
      }
    });
  }

  function _msUpdateBar() {
    const bar = document.getElementById('ddMSBar');
    if (!bar) return;
    const n = T.msSelectedIds.size;
    bar.classList.toggle('is-visible', T.msSelectMode);
    const cnt = bar.querySelector('.ms-count b');
    if (cnt) cnt.textContent = String(n);
    const allIds = _msAllVisibleIds();
    const allSelected = allIds.length > 0 && allIds.every(id => T.msSelectedIds.has(id));
    const sa = bar.querySelector('.ms-selectall');
    if (sa) sa.textContent = allSelected ? 'Clear all' : 'Select all';
    // Also hide normal dd-actions while in select mode
    const actions = document.querySelector('#deckDetailModal .dd-actions');
    if (actions) actions.classList.toggle('ms-hidden', T.msSelectMode);
  }

  function _msEnsureBar() {
    if (document.getElementById('ddMSBar')) return;
    const body = document.querySelector('#deckDetailModal .modal-body');
    if (!body) return;
    const bar = document.createElement('div');
    bar.id = 'ddMSBar';
    bar.className = 'dd-multiselect-bar';
    bar.innerHTML = `
      <button type="button" class="ms-exit"      title="Exit select mode" aria-label="Exit select mode">✕</button>
      <span class="ms-count"><b>0</b> selected</span>
      <button type="button" class="ms-selectall">Select all</button>
      <span class="ms-spacer"></span>
      <button type="button" class="ms-move"   title="Move selected cards to a deck">📦 Move</button>
      <button type="button" class="ms-delete" title="Delete selected cards">🗑️ Delete</button>`;
    body.insertBefore(bar, body.firstChild);

    bar.querySelector('.ms-exit').addEventListener('click', _msExit);
    bar.querySelector('.ms-selectall').addEventListener('click', _msToggleSelectAll);
    bar.querySelector('.ms-move').addEventListener('click', _msOpenMovePicker);
    bar.querySelector('.ms-delete').addEventListener('click', _msConfirmDelete);
  }

  function _msEnter(anchorId) {
    T.msSelectMode  = true;
    T.msAnchorId    = anchorId || null;
    T.msDeckScopeId = T.currentDeckDetailId || null;
    if (anchorId) T.msSelectedIds.add(anchorId);
    _msEnsureBar();
    _msApplyRowVisuals();
    _msUpdateBar();
  }

  function _msExit() {
    T.msSelectMode  = false;
    T.msSelectedIds.clear();
    T.msAnchorId    = null;
    T.msDeckScopeId = null;
    _msApplyRowVisuals();
    _msUpdateBar();
  }
  window._msExitSelectMode = _msExit;

  function _msToggleSelectAll() {
    const ids = _msAllVisibleIds();
    const allSel = ids.length > 0 && ids.every(id => T.msSelectedIds.has(id));
    if (allSel) T.msSelectedIds.clear();
    else ids.forEach(id => T.msSelectedIds.add(id));
    if (T.msSelectedIds.size === 0) { _msExit(); return; }
    _msApplyRowVisuals();
    _msUpdateBar();
  }

  function _msToggleId(id, additive) {
    if (!additive) T.msSelectedIds.clear();
    if (T.msSelectedIds.has(id)) T.msSelectedIds.delete(id);
    else T.msSelectedIds.add(id);
    T.msAnchorId = id;
    if (T.msSelectedIds.size === 0) { _msExit(); return; }
    _msApplyRowVisuals();
    _msUpdateBar();
  }

  function _msRangeSelect(toId) {
    const ids = _msAllVisibleIds();
    const aIdx = T.msAnchorId ? ids.indexOf(T.msAnchorId) : -1;
    const bIdx = ids.indexOf(toId);
    if (bIdx < 0) return;
    if (aIdx < 0) { T.msSelectedIds.add(toId); }
    else {
      const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
      for (let i = lo; i <= hi; i++) T.msSelectedIds.add(ids[i]);
    }
    _msApplyRowVisuals();
    _msUpdateBar();
  }

  // ── Pointer / click handling on #ddTopicList ──────────────────────────────
  let _lpTimer = null, _lpRow = null, _lpStartX = 0, _lpStartY = 0, _lpFired = false;

  function _msClearLP() {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    _lpRow = null;
  }

  function _onPointerDown(e) {
    const list = e.currentTarget;
    const row  = e.target.closest('.tree-row[data-type="topic"]');
    if (!row || !list.contains(row)) return;
    // Ignore presses on row buttons / drag handle
    if (e.target.closest('.row-actions, .drag-handle')) return;
    _lpFired = false;
    _lpRow   = row;
    _lpStartX = e.clientX; _lpStartY = e.clientY;
    _msClearLPTimerOnly();
    _lpTimer = setTimeout(() => {
      _lpFired = true;
      const id = row.dataset.topicId;
      if (!T.msSelectMode) _msEnter(id);
      else _msToggleId(id, true);
      // Light haptic if available
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      row.classList.add('ms-lp-flash');
      setTimeout(() => row.classList.remove('ms-lp-flash'), 250);
    }, LP_MS);
  }
  function _msClearLPTimerOnly() {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
  }
  function _onPointerMove(e) {
    if (!_lpTimer) return;
    if (Math.abs(e.clientX - _lpStartX) > 8 || Math.abs(e.clientY - _lpStartY) > 8) {
      _msClearLP();
    }
  }
  function _onPointerUp() { _msClearLPTimerOnly(); }

  // Capture-phase click intercept — runs BEFORE handleUnifiedTreeClick so we
  // can swallow the click when in select mode (or when a long-press just fired).
  function _onClickCapture(e) {
    const row = e.target.closest('.tree-row[data-type="topic"]');
    if (!row) { _lpFired = false; return; }
    // Long-press completed on this pointerdown — swallow the trailing click
    if (_lpFired) {
      _lpFired = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    // Allow row-action buttons (Edit / Delete) to run normally outside select mode
    if (!T.msSelectMode) return;
    // In select mode, swallow clicks on row buttons too — selection rules.
    e.stopPropagation();
    e.preventDefault();
    const id = row.dataset.topicId;
    if (!id) return;
    if (e.shiftKey)             _msRangeSelect(id);
    else if (e.ctrlKey || e.metaKey) _msToggleId(id, true);
    else                        _msToggleId(id, true); // mobile-friendly: tap toggles
  }

  function _onKeydown(e) {
    if (!T.msSelectMode) return;
    const ddOpen = !document.getElementById('deckDetailModal')?.classList.contains('hidden');
    if (!ddOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); _msExit(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      _msAllVisibleIds().forEach(id => T.msSelectedIds.add(id));
      _msApplyRowVisuals(); _msUpdateBar();
    }
  }

  function _attachListListeners() {
    const list = document.getElementById('ddTopicList');
    if (!list || list.__msAttached) return;
    list.__msAttached = true;
    list.addEventListener('pointerdown', _onPointerDown);
    list.addEventListener('pointermove', _onPointerMove);
    list.addEventListener('pointerup',   _onPointerUp);
    list.addEventListener('pointercancel', _onPointerUp);
    list.addEventListener('pointerleave',  _onPointerUp);
    // Capture-phase so we run before handleUnifiedTreeClick
    list.addEventListener('click', _onClickCapture, true);
  }
  document.addEventListener('keydown', _onKeydown);

  // ── Bulk Move picker (subdecks of current root, exclude source deck) ──────
  function _msOpenMovePicker() {
    if (!T.msSelectedIds.size) return;
    _msEnsureMoveModal();
    const rootId   = _getRootDeckId(T.msDeckScopeId || T.currentDeckDetailId);
    // Source deckIds = decks that the selected cards currently belong to
    const sourceDeckIds = new Set(
      Array.from(T.msSelectedIds)
        .map(tid => state.topics.find(t => t.id === tid)?.deckId)
        .filter(Boolean)
    );
    const treeIds = getAllChildDeckIds(rootId, [rootId]);
    const candidates = state.decks
      .filter(d => treeIds.includes(d.id))
      .filter(d => !isContainerDeck(d.id))
      .filter(d => !(sourceDeckIds.size === 1 && sourceDeckIds.has(d.id)));

    const picker = document.getElementById('msmPicker');
    if (!picker) return;
    if (!candidates.length) {
      picker.innerHTML = `<div class="mdm-row mdm-disabled"><div class="mdm-name">No other sub-decks under this root.</div></div>`;
    } else {
      picker.innerHTML = candidates
        .sort(_byOrder)
        .map(d => {
          const depth = getDeckDepth(d.id);
          const indent = 12 + depth * 18;
          return `<div class="mdm-row" data-dest-id="${d.id}" style="padding-left:${indent}px">
            <div class="mdm-radio"></div>
            <div class="mdm-name">📁 ${esc(d.name)}</div>
          </div>`;
        }).join('');
    }
    T.msMovePickedId = null;
    document.getElementById('msmConfirmBtn').disabled = true;
    document.getElementById('msMoveModal').classList.add('open');
  }

  function _msEnsureMoveModal() {
    if (document.getElementById('msMoveModal')) return;
    const div = document.createElement('div');
    div.id = 'msMoveModal';
    // Reuse mdm-* styling already present in the project
    div.innerHTML = `
      <div class="mdm-card">
        <div class="mdm-header">
          <div class="mdm-title">Move selected cards</div>
          <div class="mdm-sub" id="msmSub">Pick a destination sub-deck</div>
        </div>
        <div class="mdm-picker" id="msmPicker"></div>
        <div class="mdm-footer">
          <button class="mdm-btn mdm-cancel"  id="msmCancelBtn">Cancel</button>
          <button class="mdm-btn mdm-confirm" id="msmConfirmBtn" disabled>Move Here</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', e => { if (e.target === div) _msCloseMoveModal(); });
    document.getElementById('msmCancelBtn').addEventListener('click', _msCloseMoveModal);
    document.getElementById('msmConfirmBtn').addEventListener('click', _msExecuteMove);
    document.getElementById('msmPicker').addEventListener('click', e => {
      const row = e.target.closest('.mdm-row:not(.mdm-disabled)');
      if (!row) return;
      T.msMovePickedId = row.dataset.destId;
      row.parentNode.querySelectorAll('.mdm-row')
        .forEach(r => r.classList.toggle('mdm-selected', r === row));
      document.getElementById('msmConfirmBtn').disabled = false;
    });
  }

  function _msCloseMoveModal() {
    const m = document.getElementById('msMoveModal');
    if (m) m.classList.remove('open');
    T.msMovePickedId = null;
  }

  function _msExecuteMove() {
    const destId = T.msMovePickedId;
    if (!destId || !T.msSelectedIds.size) return;
    const destDeck = state.decks.find(d => d.id === destId);
    if (!destDeck) return;
    const ids = Array.from(T.msSelectedIds);
    let moved = 0;
    ids.forEach(tid => {
      const t = state.topics.find(x => x.id === tid);
      if (!t || t.isPastFixed) return;
      if (t.deckId === destId) return;
      t.deckId = destId;       // Reassign deck only — SRS state preserved.
      moved++;
    });
    if (typeof saveImmediate === 'function') saveImmediate();
    else if (typeof save === 'function') save();
    if (typeof IndexManager !== 'undefined' && IndexManager.scheduleRebuild) IndexManager.scheduleRebuild();
    _msCloseMoveModal();
    _msExit();
    if (T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
    if (typeof renderDecks === 'function') renderDecks();
    _msToast(`Moved ${moved} card${moved !== 1 ? 's' : ''} to ${destDeck.name}`, 'success');
  }

  // ── Bulk Delete (reuses existing #deleteModal) ────────────────────────────
  function _msConfirmDelete() {
    if (!T.msSelectedIds.size) return;
    const n = T.msSelectedIds.size;
    T.pendingDeleteId   = '__ms_bulk__';
    T.pendingDeleteType = 'topics-bulk';
    T.pendingBulkIds    = Array.from(T.msSelectedIds);
    const msg = el('deleteMsg');
    if (msg) msg.textContent = `Delete ${n} card${n !== 1 ? 's' : ''}? This cannot be undone.`;
    if (typeof openModal === 'function') openModal('deleteModal');
  }

  // Extra confirm-button handler — runs alongside topic.js's existing one
  // (which is a no-op for our 'topics-bulk' type).
  document.addEventListener('DOMContentLoaded', _bindBulkDeleteConfirm);
  if (document.readyState !== 'loading') _bindBulkDeleteConfirm();
  function _bindBulkDeleteConfirm() {
    const btn = el('confirmDeleteBtn');
    if (!btn || btn.__msBulkBound) return;
    btn.__msBulkBound = true;
    btn.addEventListener('click', () => {
      if (T.pendingDeleteType !== 'topics-bulk') return;
      const ids = Array.isArray(T.pendingBulkIds) ? T.pendingBulkIds : [];
      let removed = 0;
      const idSet = new Set(ids);
      const before = state.topics.length;
      state.topics = state.topics.filter(t => !idSet.has(t.id));
      removed = before - state.topics.length;
      ids.forEach(tid => {
        if (state.sm2)  delete state.sm2[tid];
        if (state.fsrs) delete state.fsrs[tid];
      });
      if (Array.isArray(state.todayDone)) {
        state.todayDone = state.todayDone.filter(id => !idSet.has(id));
      }
      if (typeof saveImmediate === 'function') saveImmediate();
      else if (typeof save === 'function') save();
      if (typeof IndexManager !== 'undefined' && IndexManager.scheduleRebuild) IndexManager.scheduleRebuild();

      T.pendingDeleteId   = null;
      T.pendingDeleteType = null;
      T.pendingBulkIds    = null;
      if (typeof closeModal === 'function') closeModal('deleteModal');

      _msExit();
      if (T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
      if (typeof renderDecks   === 'function') renderDecks();
      if (typeof renderToday   === 'function') renderToday();
      if (typeof renderCalendar === 'function') renderCalendar();
      _msToast(`Deleted ${removed} card${removed !== 1 ? 's' : ''}`, 'success');
    });
  }

  // ── Hook renderDeckDetailContent: reattach listeners + restore visuals ────
  const _origRenderDD = window.renderDeckDetailContent;
  window.renderDeckDetailContent = function (deckId) {
    const r = _origRenderDD.apply(this, arguments);
    // If user changed deck while in select mode, exit cleanly
    if (T.msSelectMode && T.msDeckScopeId && T.msDeckScopeId !== deckId) _msExit();
    _msEnsureBar();
    _attachListListeners();
    _msApplyRowVisuals();
    _msUpdateBar();
    return r;
  };

  // ── Auto-exit when the deck detail modal is closed ────────────────────────
  document.addEventListener('click', e => {
    const closer = e.target.closest('[data-modal-close="deckDetailModal"]');
    if (closer && T.msSelectMode) _msExit();
  }, true);
})();