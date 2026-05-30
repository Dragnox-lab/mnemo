/* Mnemo Extras — PWA, notifications, image compression, bulk actions, install prompt.
   Non-invasive: hooks the existing globals (state, save, el, renderToday) when present.

   Fixes:
   1. Notification timing — ±45s tolerance window instead of exact minute match
   2. MutationObserver scoped to #section-settings, auto-disconnects after injection
   3. Bulk delete/reset now snapshots state and shows an Undo toast (8s)
*/
'use strict';

(function () {
  // ── PWA: register service worker + install prompt ──────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err =>
        console.warn('[Mnemo] SW register failed', err)
      );
    });
  }

  let _deferredInstall = null;

  // Expose a tiny API so today.js can render its own in-page banner on mobile.
  window.MnemoInstall = {
    hasPrompt: () => !!_deferredInstall,
    trigger: async () => {
      if (!_deferredInstall) return false;
      _deferredInstall.prompt();
      const choice = await _deferredInstall.userChoice;
      const accepted = choice && choice.outcome === 'accepted';
      if (accepted) _deferredInstall = null;
      return accepted;
    },
  };

  function _isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstall = e;
    // Notify the Today section so it can render its inline banner.
    window.dispatchEvent(new CustomEvent('mnemo:install-available'));
    // Desktop fallback only — on mobile the Today-section banner handles UX.
    if (!_isMobile()) showInstallChip();
  });
  function showInstallChip() {
    if (document.getElementById('mnemoInstallChip')) return;
    const btn = document.createElement('button');
    btn.id = 'mnemoInstallChip';
    btn.textContent = '⤓ Install Mnemo';
    btn.style.cssText = `
      position: fixed; bottom: 80px; right: 16px; z-index: 9999;
      background: var(--acc, #FF2D7F); color: white; border: none;
      padding: 10px 14px; border-radius: 999px; cursor: pointer;
      font-weight: 600; box-shadow: 0 4px 20px rgba(0,0,0,.4);
    `;
    btn.addEventListener('click', async () => {
      if (!_deferredInstall) return btn.remove();
      _deferredInstall.prompt();
      await _deferredInstall.userChoice;
      _deferredInstall = null;
      btn.remove();
    });
    document.body.appendChild(btn);
  }

  // ── Image compression (resize & re-encode base64) ──────────────────────────
  const MAX_DIM = 1280;
  const JPEG_Q  = 0.82;

  async function compressDataUrl(dataUrl) {
    try {
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return dataUrl;
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = dataUrl;
      });
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 500_000) return dataUrl;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const out = cv.toDataURL('image/jpeg', JPEG_Q);
      return out.length < dataUrl.length ? out : dataUrl;
    } catch (e) {
      console.warn('[Mnemo] image compress failed', e);
      return dataUrl;
    }
  }

  function wrapPopulateImage() {
    if (typeof window._populateImageField !== 'function') return;
    const orig = window._populateImageField;
    window._populateImageField = async function (url) {
      const compressed = await compressDataUrl(url);
      return orig(compressed);
    };
  }
  wrapPopulateImage();

  document.addEventListener('change', async (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'file' || !input.accept?.includes('image')) return;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressDataUrl(String(reader.result || ''));
      const fImageData = document.getElementById('fImageData');
      const fImagePreview = document.getElementById('fImagePreview');
      if (fImageData) fImageData.value = compressed;
      if (fImagePreview) {
        fImagePreview.src = compressed;
        fImagePreview.classList.remove('hidden');
      }
    };
    reader.readAsDataURL(file);
  }, true);

  // ── Browser notifications ──────────────────────────────────────────────────
  function ensureNotifySettings() {
    if (typeof state === 'undefined') return null;
    if (!state.settings) state.settings = {};
    if (state.settings.notifyAuto === undefined) state.settings.notifyAuto = true;
    return state.settings;
  }

  async function ensureNotifyPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied')  return false;
    try {
      const r = await Notification.requestPermission();
      return r === 'granted';
    } catch { return false; }
  }

  function dueCountToday() {
    try {
      if (typeof getDueCardsForToday === 'function') {
        const due = getDueCardsForToday().length;
        const limit = typeof getEffectiveNewLimit === 'function'
          ? getEffectiveNewLimit('all')
          : (state.settings?.newCardsPerDay || 0);
        const studied = typeof getStudiedNewTodayInDeck === 'function'
          ? getStudiedNewTodayInDeck('all') : 0;
        const newAvail = typeof getNewCardsForToday === 'function'
          ? Math.min(getNewCardsForToday('all', 9999).length, Math.max(0, limit - studied))
          : 0;
        return due + newAvail;
      }
    } catch {}
    return 0;
  }

  let _lastNotifyKey = null;
  function fireNotification(due) {
    const payload = {
      title: '🧠 Mnemo — Time to review',
      body: `${due} card${due === 1 ? '' : 's'} ready to review.`,
    };
    navigator.serviceWorker?.ready
      .then(reg => reg.active?.postMessage({ type: 'mnemo-notify', payload }))
      .catch(() => { try { new Notification(payload.title, { body: payload.body, icon: 'icon.svg' }); } catch {} });
  }

  // Fix #1: ±45 second tolerance window for any scheduled "notifyTime" (HH:MM).
  // Survives throttling, sleeping tabs, and CPU contention.
  const NOTIFY_TOLERANCE_MS = 45 * 1000;
  function isWithinScheduledWindow(s) {
    const time = s && s.notifyTime; // optional "HH:MM"
    if (!time || typeof time !== 'string') return true; // no schedule → always eligible
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return true;
    const targetH = +m[1], targetM = +m[2];
    const now = new Date();
    const target = new Date(now);
    target.setHours(targetH, targetM, 0, 0);
    return Math.abs(now.getTime() - target.getTime()) <= NOTIFY_TOLERANCE_MS;
  }

  async function maybeNotifyAuto() {
    const s = ensureNotifySettings();
    if (!s || s.notifyAuto === false) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!isWithinScheduledWindow(s)) return; // Fix #1
    const due = dueCountToday();
    if (due <= 0) return;
    const key = new Date().toISOString().slice(0, 10) + ':' + due;
    if (_lastNotifyKey === key) return;
    _lastNotifyKey = key;
    fireNotification(due);
  }

  let _permRequested = false;
  async function lazyPermissionRequest() {
    if (_permRequested) return;
    _permRequested = true;
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      const granted = await ensureNotifyPermission();
      if (granted) maybeNotifyAuto();
    } else if (Notification.permission === 'granted') {
      maybeNotifyAuto();
    }
  }
  document.addEventListener('click',   lazyPermissionRequest, { once: true });
  document.addEventListener('keydown', lazyPermissionRequest, { once: true });

  window.addEventListener('load', () => setTimeout(maybeNotifyAuto, 1500));
  // Poll every 30s so a ±45s window can never be missed between ticks.
  setInterval(maybeNotifyAuto, 30_000);

  window.mnemoCheckDueNotifications = maybeNotifyAuto;

  // ── Undo toast (Fix #3) ────────────────────────────────────────────────────
  let _undoTimer = null;
  function showUndoToast(message, onUndo, ms = 8000) {
    const existing = document.getElementById('mnemoUndoToast');
    if (existing) existing.remove();
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }

    const wrap = document.createElement('div');
    wrap.id = 'mnemoUndoToast';
    wrap.style.cssText = `
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      z-index: 10000; display: flex; align-items: center; gap: 12px;
      background: #1c1c22; color: #fff; padding: 10px 14px;
      border-radius: 999px; box-shadow: 0 8px 30px rgba(0,0,0,.45);
      font-size: .9rem; font-weight: 500; max-width: 92vw;
    `;
    const msg = document.createElement('span');
    msg.textContent = message;
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.textContent = 'Undo';
    undoBtn.style.cssText = `
      background: var(--acc, #FF2D7F); color: #fff; border: none;
      padding: 6px 12px; border-radius: 999px; cursor: pointer;
      font-weight: 700; font-size: .82rem;
    `;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      background: transparent; color: #aaa; border: none; cursor: pointer;
      font-size: 1rem; padding: 0 4px;
    `;

    function dismiss() {
      if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
      wrap.remove();
    }
    undoBtn.addEventListener('click', () => {
      try { onUndo(); } catch (err) { console.warn('[Mnemo] undo failed', err); }
      dismiss();
    });
    closeBtn.addEventListener('click', dismiss);

    wrap.appendChild(msg);
    wrap.appendChild(undoBtn);
    wrap.appendChild(closeBtn);
    document.body.appendChild(wrap);
    _undoTimer = setTimeout(dismiss, ms);
  }
  // Expose globally so other modules (renderdecks.js action sheet) can use it
  try { window.showUndoToast = showUndoToast; } catch {}

  function deepClone(value) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
    } catch {}
    return JSON.parse(JSON.stringify(value));
  }

  // ── Settings UI: bulk actions injected INSIDE the Danger Zone card ────────
  function injectSettingsUI() {
    const section = document.getElementById('section-settings');
    if (!section || document.getElementById('mnemoExtrasBulk')) return false;

    let dangerCard = null;
    section.querySelectorAll('.settings-card').forEach(c => {
      const t = c.querySelector('.sc-title');
      if (t && /danger zone/i.test(t.textContent || '')) dangerCard = c;
    });
    if (!dangerCard) return false;

    const block = document.createElement('div');
    block.id = 'mnemoExtrasBulk';
    block.style.cssText = 'margin-top: 14px; display:flex; flex-direction:column; gap:8px;';
    block.innerHTML = `
      <div style="font-size:.78rem;color:var(--ink3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-top:4px;">🧹 Bulk Actions</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="mxBulkDeleteUnreviewed" type="button" class="btn-danger">Delete all unreviewed cards</button>
        <button id="mxBulkResetAll" type="button" class="btn-danger">Reset progress on all cards</button>
      </div>
      <p style="color:var(--ink3); font-size:.78rem; margin:6px 0 0;">
        🔔 Reminders fire automatically when cards are due (after granting browser permission).
      </p>
    `;
    dangerCard.appendChild(block);

    const save = () => (typeof saveImmediate === 'function' ? saveImmediate() : (typeof window.save === 'function' && window.save()));

    document.getElementById('mxBulkDeleteUnreviewed').addEventListener('click', () => {
      if (typeof state === 'undefined') return;
      const unreviewedIds = state.topics
        .filter(t => !state.sm2?.[t.id]?.firstSeenAt)
        .map(t => t.id);
      if (!unreviewedIds.length) return alert('No unreviewed cards.');
      if (!confirm(`Delete ${unreviewedIds.length} unreviewed cards?`)) return;

      // Fix #3: snapshot for undo
      const idSet = new Set(unreviewedIds);
      const snapshotTopics = state.topics.filter(t => idSet.has(t.id)).map(deepClone);
      const snapshotSm2 = {};
      const snapshotFsrs = {};
      unreviewedIds.forEach(id => {
        if (state.sm2 && state.sm2[id])  snapshotSm2[id]  = deepClone(state.sm2[id]);
        if (state.fsrs && state.fsrs[id]) snapshotFsrs[id] = deepClone(state.fsrs[id]);
      });

      unreviewedIds.forEach(id => {
        if (typeof window.deleteTopic === 'function') window.deleteTopic(id, true);
        else {
          state.topics = state.topics.filter(t => t.id !== id);
          if (state.sm2) delete state.sm2[id];
          if (state.fsrs) delete state.fsrs[id];
        }
      });
      save();
      if (typeof renderToday === 'function') renderToday();

      showUndoToast(`Deleted ${unreviewedIds.length} cards.`, () => {
        state.topics = state.topics.concat(snapshotTopics);
        if (!state.sm2) state.sm2 = {};
        if (!state.fsrs) state.fsrs = {};
        Object.assign(state.sm2, snapshotSm2);
        Object.assign(state.fsrs, snapshotFsrs);
        save();
        if (typeof renderToday === 'function') renderToday();
      });
    });

    document.getElementById('mxBulkResetAll').addEventListener('click', () => {
      if (typeof state === 'undefined') return;
      if (!confirm('Reset review progress on ALL cards? Cards return to "new".')) return;

      // Fix #3: snapshot for undo
      const snapshot = {
        sm2:       deepClone(state.sm2 || {}),
        fsrs:      deepClone(state.fsrs || {}),
        todayDone: deepClone(state.todayDone || []),
      };

      state.sm2 = {};
      state.fsrs = {};
      state.todayDone = [];
      save();
      if (typeof renderToday === 'function') renderToday();

      showUndoToast('All progress reset.', () => {
        state.sm2 = snapshot.sm2;
        state.fsrs = snapshot.fsrs;
        state.todayDone = snapshot.todayDone;
        save();
        if (typeof renderToday === 'function') renderToday();
      });
    });

    return true;
  }

  function removeLegacyBulkCard() {
    const legacy = document.getElementById('mnemoExtrasSettings');
    if (legacy) legacy.remove();
  }

  // Fix #2: scoped, self-disconnecting observer.
  // Strategy: tighten observation as much as we can, and disconnect once injection succeeds.
  let _scopedObs = null;
  function tryInjectAndScope() {
    removeLegacyBulkCard();
    const injected = injectSettingsUI();
    const section = document.getElementById('section-settings');

    // If injection succeeded, fully disconnect — nothing more to watch.
    if (injected) {
      if (_scopedObs) { _scopedObs.disconnect(); _scopedObs = null; }
      return;
    }

    // If the settings section exists but the Danger Zone card hasn't rendered yet,
    // narrow the observer to that subtree only (no full-body scan).
    if (section && (!_scopedObs || _scopedObs._target !== section)) {
      if (_scopedObs) _scopedObs.disconnect();
      _scopedObs = new MutationObserver(() => {
        removeLegacyBulkCard();
        if (injectSettingsUI()) {
          _scopedObs.disconnect();
          _scopedObs = null;
        }
      });
      _scopedObs._target = section;
      _scopedObs.observe(section, { childList: true, subtree: true });
    }
  }

  document.addEventListener('DOMContentLoaded', tryInjectAndScope);
  window.addEventListener('hashchange', tryInjectAndScope);
  // A few re-checks on initial load to catch async-rendered settings page,
  // without permanently observing the whole document body.
  setTimeout(tryInjectAndScope, 500);
  setTimeout(tryInjectAndScope, 1500);
  setTimeout(tryInjectAndScope, 4000);
  if (document.readyState !== 'loading') tryInjectAndScope();
})();