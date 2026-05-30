/**
 * MNEMO — Topic Management Module (FSRS‑compatible)
 * Handles topic CRUD, scheduling, and rendering
 *
 * Improvements:
 * - Uses nextReviewAt (timestamp) instead of nextReview string
 * - Uses firstSeenAt (timestamp) instead of firstSeenDate
 * - Past cards stored in state.topics with isPastFixed: true (no separate pastCards array)
 * - Fixed save operations to use saveImmediate()
 * - Added snapshot cleanup on topic edits/deletions
 * - Better error handling and validation
 * - Image support via Ctrl+V paste or attach button into fContent area
 *   Image stored as base64 in hidden #fImageData; preview lives below the textarea
 */

'use strict';

// ============================================
// HELPER: Calculate fixed intervals for past cards
// ============================================

const FIXED_INTERVALS_DAYS = [1, 3, 7, 14, 28, 30, 60, 90];

function calculateFixedDates(startDate) {
  const dates = [];
  let current = startDate;
  for (const interval of FIXED_INTERVALS_DAYS) {
    current = addDays(current, interval);
    dates.push(current);
  }
  return dates;
}

// ============================================
// INTERNAL HELPERS: image preview in modal
// ============================================

function _clearImageField() {
  const fImageData = el('fImageData');
  if (fImageData) fImageData.value = '';
  const fImagePreview = el('fImagePreview');
  if (fImagePreview) {
    fImagePreview.src = '';
    fImagePreview.classList.add('hidden');
  }
}

function _populateImageField(imageDataUrl) {
  const fImageData = el('fImageData');
  if (fImageData) fImageData.value = imageDataUrl || '';
  const fImagePreview = el('fImagePreview');
  if (fImagePreview) {
    if (imageDataUrl) {
      fImagePreview.src = imageDataUrl;
      fImagePreview.classList.remove('hidden');
    } else {
      fImagePreview.src = '';
      fImagePreview.classList.add('hidden');
    }
  }
}

// ============================================
// TOPIC MODAL & CRUD
// ============================================

// ============================================
// HELPER: Get breadcrumbs of a deck
// ============================================
function getDeckBreadcrumbs(deckId) {
  if (!deckId) return '';
  const parts = [];
  let cur = deckId;
  while (cur) {
    const deck = state.decks.find(d => d.id === cur);
    if (!deck) break;
    parts.unshift(deck.name);
    cur = deck.parentId;
  }
  return parts.join(' › ');
}

function _updateModalUI(type) {
  const titleLabel = el('fTitleLabel');
  if (titleLabel) {
    titleLabel.textContent = (type === 'occlusion') ? 'Card set name' : 'Question';
  }
  const contentField = el('contentFieldContainer');
  if (contentField) {
    contentField.classList.toggle('hidden', type === 'occlusion');
  }
  const tagsField = el('tagsFieldContainer');
  const occEditor = el('occlusionEditor');
  if (type === 'occlusion') {
    if (tagsField && occEditor) {
      occEditor.parentNode.insertBefore(tagsField, occEditor);
    }
  } else {
    const colContent = el('topicCollapsibleContent');
    if (tagsField && colContent) {
      colContent.appendChild(tagsField);
    }
  }

  // Hide the tags/images collapsible options section entirely for Image Occlusion
  const colHeader = el('topicCollapsibleHeader');
  const colContent = el('topicCollapsibleContent');
  if (colHeader) {
    colHeader.classList.toggle('hidden', type === 'occlusion');
  }
  if (colContent && type === 'occlusion') {
    colContent.classList.add('hidden');
  }
}

function openAddTopic(deckId) {
  T.editingTopicId = null;
  T.editingPastCard = false;

  const title = el('topicModalTitle');
  const editId = el('topicEditId');
  const fTitle = el('fTitle');
  const fContent = el('fContent');
  const fDate = el('fDate');
  const clozeHint = el('clozeHint');
  const resetBtn = el('resetCardBtn');
  const deckField = el('fDeck');

  if (title) title.textContent = 'Add card';
  const sub = el('topicModalSub');
  if (sub) sub.textContent = getDeckBreadcrumbs(deckId) || 'No Deck';

  const saveAddAnotherBtn = el('saveAndAddAnotherBtn');
  if (saveAddAnotherBtn) saveAddAnotherBtn.style.display = '';

  // Reset collapsible section to collapsed
  const colHeader = el('topicCollapsibleHeader');
  const colContent = el('topicCollapsibleContent');
  if (colContent) colContent.classList.add('hidden');
  if (colHeader) {
    const arrow = colHeader.querySelector('.arrow-icon');
    if (arrow) {
      arrow.classList.remove('expanded');
      arrow.textContent = '▸';
    }
  }
  if (editId) editId.value = '';
  if (fTitle) fTitle.value = '';
  if (fContent) fContent.value = '';
  if (el('fTags')) el('fTags').value = '';
  if (el('fFlag')) el('fFlag').value = '';
  if (el('fAutoReverse')) el('fAutoReverse').checked = false;

  // Clear the answer-area image preview
  _clearImageField();

  // Reset occlusion editor
  el('occlusionEditor')?.classList.add('hidden');
  window.OcclusionEditor?.reset();
  const studyModeEl = el('occlusionStudyMode');
  if (studyModeEl) studyModeEl.value = 'hide_one';

  if (fDate) fDate.value = state.section === 'calendar' ? (state.calSelected || todayStr()) : todayStr();

  clozeHint?.classList.add('hidden');
  resetBtn?.classList.add('hidden');

  // Enable deck selection for normal topics
  if (deckField) deckField.disabled = false;

  document.querySelectorAll('#cardTypeSwitch .act-type-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.type === 'standard')
  );
  refreshAllDeckSelects();

  const fDeck = el('fDeck');
  if (fDeck) fDeck.value = deckId || state.decks[0]?.id || '';

  _updateModalUI('standard');
  openModal('topicModal');
}

function openEditTopic(id) {
  const t = state.topics.find(x => x.id === id);
  if (!t) return;

  // Check if this is a past card
  if (t.isPastFixed === true) {
    openEditPastCard(id);
    return;
  }

  T.editingTopicId = id;
  T.editingPastCard = false;

  const title = el('topicModalTitle');
  const editId = el('topicEditId');
  const fTitle = el('fTitle');
  const fContent = el('fContent');
  const fDate = el('fDate');
  const clozeHint = el('clozeHint');
  const resetBtn = el('resetCardBtn');
  const deckField = el('fDeck');

  if (title) title.textContent = 'Edit card';
  const sub = el('topicModalSub');
  if (sub) sub.textContent = getDeckBreadcrumbs(t.deckId) || 'No Deck';

  const saveAddAnotherBtn = el('saveAndAddAnotherBtn');
  if (saveAddAnotherBtn) saveAddAnotherBtn.style.display = 'none';

  // Reset collapsible section to collapsed
  const colHeader = el('topicCollapsibleHeader');
  const colContent = el('topicCollapsibleContent');
  if (colContent) colContent.classList.add('hidden');
  if (colHeader) {
    const arrow = colHeader.querySelector('.arrow-icon');
    if (arrow) {
      arrow.classList.remove('expanded');
      arrow.textContent = '▸';
    }
  }
  if (editId) editId.value = id;
  if (fTitle) fTitle.value = t.title;
  if (fContent) fContent.value = t.content || '';
  if (el('fTags')) el('fTags').value = (Array.isArray(t.tags) ? t.tags.join(', ') : '');
  if (el('fFlag')) el('fFlag').value = t.flag || '';
  if (el('fAutoReverse')) el('fAutoReverse').checked = false;

  // Restore saved image into the answer-area preview
  _populateImageField(t.image || null);

  if (fDate) fDate.value = t.startDate;

  clozeHint?.classList.toggle('hidden', t.type !== 'cloze');

  // Restore occlusion editor state
  const occEditor = el('occlusionEditor');
  if (occEditor) occEditor.classList.toggle('hidden', t.type !== 'occlusion');
  if (t.type === 'occlusion') {
    const shapes = JSON.parse(t.content || '[]');
    window.OcclusionEditor?.load(t.image, shapes);
    const studyModeEl = el('occlusionStudyMode');
    if (studyModeEl) studyModeEl.value = t.occlusionMode || 'hide_one';
  }

  document.querySelectorAll('#cardTypeSwitch .act-type-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.type === (t.type || 'standard'))
  );
  resetBtn?.classList.remove('hidden');

  // Enable deck selection for normal topics
  if (deckField) deckField.disabled = false;

  refreshAllDeckSelects();

  const fDeck = el('fDeck');
  if (fDeck) fDeck.value = t.deckId || '';

  _updateModalUI(t.type || 'standard');
  openModal('topicModal');
}

function openEditPastCard(id) {
  const t = state.topics.find(x => x.id === id && x.isPastFixed === true);
  if (!t) return;

  T.editingTopicId = id;
  T.editingPastCard = true;

  const title = el('topicModalTitle');
  const editId = el('topicEditId');
  const fTitle = el('fTitle');
  const fContent = el('fContent');
  const fDate = el('fDate');
  const clozeHint = el('clozeHint');
  const resetBtn = el('resetCardBtn');
  const deckField = el('fDeck');

  if (title) title.textContent = 'Edit card';
  const sub = el('topicModalSub');
  if (sub) sub.textContent = 'Past Fixed Cards';

  const saveAddAnotherBtn = el('saveAndAddAnotherBtn');
  if (saveAddAnotherBtn) saveAddAnotherBtn.style.display = 'none';

  // Reset collapsible section to collapsed
  const colHeader = el('topicCollapsibleHeader');
  const colContent = el('topicCollapsibleContent');
  if (colContent) colContent.classList.add('hidden');
  if (colHeader) {
    const arrow = colHeader.querySelector('.arrow-icon');
    if (arrow) {
      arrow.classList.remove('expanded');
      arrow.textContent = '▸';
    }
  }
  if (editId) editId.value = id;
  if (fTitle) fTitle.value = t.title;
  if (fContent) fContent.value = t.content || '';
      if (el('fTags')) el('fTags').value = (Array.isArray(t.tags) ? t.tags.join(', ') : '');
      if (el('fAutoReverse')) el('fAutoReverse').checked = false;
  if (fDate) fDate.value = t.startDate;

  clozeHint?.classList.add('hidden');
  resetBtn?.classList.add('hidden');

  // Disable deck selection for past cards (they have no deck)
  if (deckField) {
    deckField.disabled = true;
    deckField.value = '';
  }

  document.querySelectorAll('#cardTypeSwitch .act-type-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.type === 'standard')
  );
  refreshAllDeckSelects();

  openModal('topicModal');
}

function saveTopic(keepOpen = false) {
  const fTitle = el('fTitle');
  const fContent = el('fContent');
  const fDeck = el('fDeck');
  const fDate = el('fDate');

  const title = fTitle?.value.trim();
  let content = fContent?.value.trim();
  let deckId = fDeck?.value;
  let startDateStr = fDate?.value;

  // Read the base64 image from the hidden field.
  // Populated either by the Ctrl+V paste handler or the attach-button fallback,
  // both of which live in index.html's inline script.
  const image = el('fImageData')?.value || null;
  const flag = el('fFlag')?.value || null;

  const type = document.querySelector('#cardTypeSwitch .act-type-tab.active')?.dataset.type || 'standard';

  // Occlusion validation & serialization
  let occlusionImage = null;
  let occlusionMode = 'hide_one';
  if (type === 'occlusion') {
    const occShapes = window.OcclusionEditor?.getShapes() || [];
    if (!occShapes.length) { alert('Draw at least one box on the image.'); return; }
    occlusionImage = window.OcclusionEditor?.getBgDataUrl() || null;
    if (!occlusionImage) { alert('Please upload a background image.'); return; }
    content = JSON.stringify(occShapes);
    occlusionMode = el('occlusionStudyMode')?.value || 'hide_one';
  }

  const tagsInput = (el('fTags')?.value || '').split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .map(t => t.replace(/\s+/g, '-'));
  const tags = Array.from(new Set(tagsInput));
  const autoReverse = el('fAutoReverse')?.checked === true;

  if (!title) { alert('Please enter a title.'); return; }
  if (!startDateStr) { alert('Please set a start date.'); return; }

  const today = todayStr();
  const isStartDatePast = startDateStr < today;

  // ============================================
  // CASE 1: Editing an existing past card
  // ============================================
  if (T.editingPastCard === true && T.editingTopicId) {
    const idx = state.topics.findIndex(t => t.id === T.editingTopicId && t.isPastFixed === true);
    if (idx === -1) {
      alert('Past card not found.');
      T.editingPastCard = false;
      closeModal('topicModal');
      return;
    }

    const existingCard = state.topics[idx];

    // If start date changed to future/present, convert to normal card
    if (!isStartDatePast) {
      if (!deckId) { alert('Select a deck to convert this card to active study.'); return; }

      // Remove past card
      state.topics.splice(idx, 1);

      // Create new normal card
      const newId = uid();
      state.topics.push({
        id: newId,
        title,
        content,
        image: type === 'occlusion' ? occlusionImage : image,
        deckId,
        startDate: startDateStr,
        type,
        suspended: false,
        buriedUntil: null,
        flag: flag,
        tags,
        isPastFixed: false,
        createdAt: today,
        occlusionMode: type === 'occlusion' ? occlusionMode : undefined
      });

      const card = fsrsInit(newId);
      card.nextReviewAt = new Date(startDateStr).getTime();
      card.firstSeenAt = null;
      state.sm2[newId] = card;

      alert('Card converted to active study mode.');
    } else {
      // Update existing past card in place
      state.topics[idx] = {
        ...existingCard,
        title,
        content,
        image: type === 'occlusion' ? occlusionImage : image,
        startDate: startDateStr,
        fixedDates: calculateFixedDates(startDateStr),
        isPastFixed: true,
        deckId: null,
        flag: flag || null,
        occlusionMode: type === 'occlusion' ? occlusionMode : undefined
      };
    }

    saveImmediate();
    closeModal('topicModal');
    T.editingPastCard = false;
    T.editingTopicId = null;

    if (state.section === 'calendar' || state.section === 'dateview') renderCalendar();
    else if (state.section === 'decks') renderDecks();
    return;
  }

  // ============================================
  // CASE 2: Creating a NEW past card (start date in past)
  // ============================================
  if (isStartDatePast && !T.editingTopicId) {
    state.topics.push({
      id: uid(),
      title,
      content,
      image: type === 'occlusion' ? occlusionImage : image,
      deckId: null,
      startDate: startDateStr,
      type,
      suspended: false,
      buriedUntil: null,
      flag: flag,
      tags,
      isPastFixed: true,
      fixedDates: calculateFixedDates(startDateStr),
      createdAt: today,
      occlusionMode: type === 'occlusion' ? occlusionMode : undefined
    });

    saveImmediate();
    if (!keepOpen) {
      closeModal('topicModal');
    } else {
      if (fTitle) fTitle.value = '';
      if (fContent) fContent.value = '';
      _clearImageField();
      if (fTitle) fTitle.focus();
    }

    if (state.section === 'calendar' || state.section === 'dateview') renderCalendar();
    else if (state.section === 'decks') renderDecks();
    return;
  }

  // ============================================
  // CASE 3: Normal card (present/future start date)
  // ============================================
  if (!deckId) { alert('Please select a deck.'); return; }

  // Editing existing normal card
  if (T.editingTopicId && !T.editingPastCard) {
    const idx = state.topics.findIndex(x => x.id === T.editingTopicId);
    if (idx !== -1) {
      state.topics[idx] = {
        ...state.topics[idx],
        title,
        content,
        image: type === 'occlusion' ? occlusionImage : image,
        deckId,
        startDate: startDateStr,
        type,
        tags,
        isPastFixed: false,
        flag: flag || null,
        occlusionMode: type === 'occlusion' ? occlusionMode : undefined
      };

      // If card is still new, update its nextReviewAt to start date
      const card = state.sm2[T.editingTopicId];
      if (card && card.pile === 'new') {
        card.nextReviewAt = new Date(startDateStr).getTime();
      }
    }
  }
  // Creating new normal card
  else {
    const newId = uid();
    state.topics.push({
      id: newId,
      title,
      content,
      image: type === 'occlusion' ? occlusionImage : image,
      deckId,
      startDate: startDateStr,
      type,
      suspended: false,
      buriedUntil: null,
      flag: flag,
      tags,
      isPastFixed: false,
      createdAt: today,
      occlusionMode: type === 'occlusion' ? occlusionMode : undefined
    });

    const card = fsrsInit(newId);
    card.nextReviewAt = new Date(startDateStr).getTime();
    card.firstSeenAt = null;
    state.sm2[newId] = card;

    if (autoReverse && content) {
      const reverseId = uid();
      state.topics.push({
        id: reverseId,
        title: content,
        content: title,
        image: type === 'occlusion' ? occlusionImage : image,
        deckId,
        startDate: startDateStr,
        type,
        suspended: false,
        buriedUntil: null,
        flag: flag,
        tags,
        isPastFixed: false,
        createdAt: today,
        autoReverse: true,
        occlusionMode: type === 'occlusion' ? occlusionMode : undefined
      });
      const reverseCard = fsrsInit(reverseId);
      reverseCard.nextReviewAt = new Date(startDateStr).getTime();
      reverseCard.firstSeenAt = null;
      state.sm2[reverseId] = reverseCard;
    }
  }

  saveImmediate();
  if (!keepOpen) {
    closeModal('topicModal');
    T.editingPastCard = false;
    T.editingTopicId = null;
  } else {
    if (fTitle) fTitle.value = '';
    if (fContent) fContent.value = '';
    _clearImageField();
    T.editingPastCard = false;
    T.editingTopicId = null;
    if (fTitle) fTitle.focus();
  }

  if (T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
  if (state.section === 'decks') renderDecks();
  else if (state.section === 'calendar') renderCalendar();
  else if (state.section === 'today') renderToday();
}

function resetCard() {
  if (!T.editingTopicId || T.editingPastCard) return;
  if (!confirm("Reset this card's FSRS progress? It will return to New.")) return;

  const t = state.topics.find(x => x.id === T.editingTopicId);
  if (!t || t.isPastFixed) return;

  const card = fsrsInit(T.editingTopicId);
  card.nextReviewAt = t?.startDate ? new Date(t.startDate).getTime() : Date.now();
  card.firstSeenAt = null;
  card.pile = 'new';
  card.stepIndex = 0;
  card.lastReviewedAt = null;
  card.interval = 0;
  card.ratings = { again: 0, hard: 0, good: 0, easy: 0 };

  state.sm2[T.editingTopicId] = card;

  saveImmediate();
  alert('Card reset to New.');
}

function deleteTopic(topicId) {
  state.topics = state.topics.filter(t => t.id !== topicId);
  delete state.sm2[topicId];
  state.todayDone = state.todayDone.filter(id => id !== topicId);

  saveImmediate();

  if (T.currentDeckDetailId) renderDeckDetailContent(T.currentDeckDetailId);
  if (state.section === 'decks') renderDecks();
  else if (state.section === 'calendar') renderCalendar();
  else if (state.section === 'today') renderToday();
}

// ============================================
// HIERARCHICAL TOPIC DISPLAY
// ============================================

function renderTopicsHierarchy(deckId, level = 0) {
  let html = '';
  const topicsHere = state.topics.filter(t => t.deckId === deckId && !t.isPastFixed);
  const subDecksHere = state.decks.filter(d => d.parentId === deckId);

  topicsHere.forEach(t => {
    const card = ensureCard(t.id);
    const pile = card.pile || 'new';

    let isDue = false;
    let dueLabel = '';

    if (pile === 'review' && card.nextReviewAt) {
      const dueDate = DateUtils.tsToDate(card.nextReviewAt);
      isDue = dueDate <= todayStr();
      dueLabel = `Due: ${dueDate}`;
    } else if ((pile === 'learning' || pile === 'relearning') && card.nextReviewAt) {
      isDue = card.nextReviewAt <= Date.now();
      const mins = Math.max(0, Math.round((card.nextReviewAt - Date.now()) / 60000));
      dueLabel = mins === 0 ? 'Due now' : (mins < 60 ? `Due in ${mins}m` : `Due in ${Math.round(mins/60)}h`);
    } else {
      dueLabel = pile === 'new' ? 'New' : '—';
    }

    const pileClass = pile === 'new' ? 'np'
      : (pile === 'learning' || pile === 'relearning') ? 'lp'
      : 'rp';
    const pileIcon = pile === 'new' ? '🆕'
      : (pile === 'learning' || pile === 'relearning') ? '📖'
      : '🔁';

    const indent = level * 24;
    const prefix = level > 0 ? '<span class="tree-prefix">└─ </span>' : '';
    const stability = card.state ? Math.round(card.state.stability) : 0;
    const dateLabel = pile === 'review'
      ? `S: ${stability}d · ${dueLabel}`
      : dueLabel;

    // Small thumbnail shown in deck list if the topic has an attached image
    const thumbHtml = t.image
      ? `<img src="${t.image}" style="height:32px;width:48px;object-fit:cover;border-radius:4px;margin-right:8px;flex-shrink:0;">`
      : '';

    html += `
      <div class="dd-topic-row" data-topic-id="${t.id}" style="margin-left:${indent}px">
        <div class="dd-topic-title">${prefix}${thumbHtml}${esc(t.title)}</div>
        <div class="dd-topic-pile ${pileClass}">${pileIcon}</div>
        <div class="dd-topic-date" style="color:${isDue ? 'var(--red)' : 'var(--ink3)'}">
          ${dateLabel}
        </div>
        <div class="dd-topic-actions">
          <button class="dd-btn dd-edit" data-tid="${t.id}">Edit</button>
          <button class="dd-btn dd-del" data-tid="${t.id}">Delete</button>
        </div>
      </div>
    `;
  });

  subDecksHere.forEach(sub => {
    const subIndent = level * 24;
    const allSubTopicsCount = getTopicsForDeck(sub.id).length;
    html += `
      <div class="dd-subdeck-heading" style="margin-left:${subIndent}px;margin-top:12px;margin-bottom:4px;">
        <div class="dd-subdeck-dot" style="background:${sub.color}"></div>
        <span class="dd-subdeck-name" style="color:${sub.color}">
          📂 ${esc(sub.name)} (${allSubTopicsCount} cards)
        </span>
      </div>
    `;
    html += renderTopicsHierarchy(sub.id, level + 1);
  });

  return html;
}

// ============================================
// EVENT SETUP
// ============================================

function setupTopicEvents() {
  const saveBtn = el('saveTopicBtn');
  const saveAndAddAnotherBtn = el('saveAndAddAnotherBtn');
  const resetCardBtn = el('resetCardBtn');
  const cardTypeSwitch = el('cardTypeSwitch');
  const confirmManualDate = el('confirmManualDate');
  const confirmDeleteBtn = el('confirmDeleteBtn');

  if (saveBtn) saveBtn.onclick = () => saveTopic(false);
  if (saveAndAddAnotherBtn) saveAndAddAnotherBtn.onclick = () => saveTopic(true);
  if (resetCardBtn) resetCardBtn.onclick = resetCard;

  // Collapsible toggle handler
  const colHeader = el('topicCollapsibleHeader');
  const colContent = el('topicCollapsibleContent');
  if (colHeader && colContent) {
    colHeader.onclick = () => {
      const isExpanded = colContent.classList.toggle('hidden') === false;
      colHeader.setAttribute('aria-expanded', String(isExpanded));
      const arrow = colHeader.querySelector('.arrow-icon');
      if (arrow) {
        arrow.textContent = isExpanded ? '▾' : '▸';
      }
    };
    // Keyboard accessibility
    colHeader.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); colHeader.click(); }
    };
  }


  if (cardTypeSwitch) {
    cardTypeSwitch.addEventListener('click', e => {
      const btn = e.target.closest('.act-type-tab');
      if (!btn) return;
      document.querySelectorAll('#cardTypeSwitch .act-type-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const clozeHint = el('clozeHint');
      if (clozeHint) clozeHint.classList.toggle('hidden', btn.dataset.type !== 'cloze');
      const occEditor = el('occlusionEditor');
      if (occEditor) occEditor.classList.toggle('hidden', btn.dataset.type !== 'occlusion');
      if (btn.dataset.type !== 'occlusion' && window.OcclusionEditor) OcclusionEditor.reset();
      _updateModalUI(btn.dataset.type);
    });
  }

  // NOTE: Ctrl+V paste and attach-button handlers are wired in index.html's
  // inline script (they need the DOM ready and live next to the elements).
  // topics.js owns only:
  //   • reading fImageData on save  →  saveTopic()
  //   • clearing the preview on open  →  _clearImageField()
  //   • restoring the preview on edit  →  _populateImageField()

  if (confirmManualDate) {
    confirmManualDate.addEventListener('click', () => {
      const date = el('manualNextDate')?.value;
      closeModal('manualDateModal');
      if (T.manualDateCallback) T.manualDateCallback(date);
      T.manualDateCallback = null;
    });
  }

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', () => {
      if (T.pendingDeleteId && T.pendingDeleteType === 'topic') {
        deleteTopic(T.pendingDeleteId);
        T.pendingDeleteId = null;
      } else if (T.pendingDeleteId && T.pendingDeleteType === 'deck') {
        if (typeof deleteDeck === 'function') deleteDeck(T.pendingDeleteId);
        if (T.currentDeckDetailId && el('deckDetailModal') && !el('deckDetailModal').classList.contains('hidden')) {
          const currentStillExists = state.decks.some(d => d.id === T.currentDeckDetailId);
          if (currentStillExists && typeof renderDeckDetailContent === 'function') {
            renderDeckDetailContent(T.currentDeckDetailId);
          }
        }
        T.pendingDeleteId = null;
      } else if (T.pendingDeleteId && T.pendingDeleteType === 'filteredDeck') {
        if (typeof deleteFilteredDeckById === 'function') deleteFilteredDeckById(T.pendingDeleteId);
        T.pendingDeleteId = null;
      }
      T.pendingDeleteType = null;
      closeModal('deleteModal');
    });
  }
}

// Expose globals
window.openAddTopic = openAddTopic;
window.openEditTopic = openEditTopic;
window.openEditPastCard = openEditPastCard;
window.saveTopic = saveTopic;
window.resetCard = resetCard;
window.deleteTopic = deleteTopic;
window.renderTopicsHierarchy = renderTopicsHierarchy;
window.setupTopicEvents = setupTopicEvents;
window.calculateFixedDates = calculateFixedDates;
window.FIXED_INTERVALS_DAYS = FIXED_INTERVALS_DAYS;
