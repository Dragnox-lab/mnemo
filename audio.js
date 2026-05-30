/* Mnemo — Audio module (fixed)
   Stores Anki audio files in IndexedDB (offline, browser-local).
   Provides playback button helpers (manual play only; user pref).

   Fixes:
   1. Revoke object URLs to prevent memory leaks
   2. IndexedDB lifecycle handlers (onblocked, onversionchange)
   3. Audio race condition (serialize play/pause)
   4. Batch writes during import (single transaction)
   5. Surface missing audio to user (return result object + visual indicator)
*/
'use strict';

(function () {
  const DB_NAME = 'mnemo-audio';
  const STORE   = 'files';
  const DB_VERSION = 1;
  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE); // key = filename, value = { blob, mime }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Fix #2: handle version changes from other tabs
        db.onversionchange = () => {
          try { db.close(); } catch {}
          _dbPromise = null;
          console.warn('[Mnemo audio] DB version changed in another tab — reloading');
          if (typeof window !== 'undefined' && window.location) {
            window.location.reload();
          }
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      // Fix #2: another tab is holding an older version open
      req.onblocked = () => {
        console.warn('[Mnemo audio] DB upgrade blocked — please close other Mnemo tabs');
        try {
          if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert('Mnemo is open in another tab. Please close other tabs to continue.');
          }
        } catch {}
      };
    });
    return _dbPromise;
  }

  async function putAudio(name, blob, mime) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ blob, mime }, name);
      tx.oncomplete = () => res();
      tx.onerror    = () => rej(tx.error);
      tx.onabort    = () => rej(tx.error);
    });
  }

  // Fix #4: batch many writes into a single transaction
  // entries: Array<{ name, blob, mime }>
  async function putAudioBatch(entries) {
    if (!Array.isArray(entries) || !entries.length) return { written: 0 };
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let written = 0;
      for (const e of entries) {
        if (!e || !e.name) continue;
        store.put({ blob: e.blob, mime: e.mime }, e.name);
        written++;
      }
      tx.oncomplete = () => res({ written });
      tx.onerror    = () => rej(tx.error);
      tx.onabort    = () => rej(tx.error);
    });
  }

  async function getAudio(name) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const r  = tx.objectStore(STORE).get(name);
      r.onsuccess = () => res(r.result || null);
      r.onerror   = () => rej(r.error);
    });
  }

  // Fix #1: track all created object URLs so we can revoke them
  const _liveUrls = new Set();

  async function createAudioURL(name) {
    const rec = await getAudio(name);
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    _liveUrls.add(url);
    return url;
  }

  function revokeAudioURL(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch {}
    _liveUrls.delete(url);
  }

  // Revoke every outstanding URL (e.g. when card changes)
  function revokeAll() {
    for (const url of _liveUrls) {
      try { URL.revokeObjectURL(url); } catch {}
    }
    _liveUrls.clear();
  }

  // Fix #3: serialize play/pause to avoid race conditions
  let _currentAudio = null;
  let _currentUrl   = null;
  let _playToken    = 0;

  async function stopCurrent() {
    if (!_currentAudio) return;
    const a = _currentAudio;
    const u = _currentUrl;
    _currentAudio = null;
    _currentUrl = null;
    try {
      a.pause();
      a.currentTime = 0;
    } catch {}
    // strip handlers so a late 'ended' doesn't double-revoke
    a.onended = null;
    a.onerror = null;
    if (u) revokeAudioURL(u);
  }

  async function playAudio(name) {
    const token = ++_playToken;
    try {
      // Cancel anything currently playing first
      await stopCurrent();
      if (token !== _playToken) return { success: false, reason: 'superseded' };

      const url = await createAudioURL(name);
      if (!url) {
        // Fix #5: surface missing audio
        console.warn('[Mnemo audio] missing audio file:', name);
        return { success: false, reason: 'audio file not found', name };
      }
      if (token !== _playToken) {
        revokeAudioURL(url);
        return { success: false, reason: 'superseded' };
      }

      const audio = new Audio(url);
      _currentAudio = audio;
      _currentUrl = url;

      // Fix #1: revoke once playback finishes (or errors)
      audio.onended = () => {
        if (_currentAudio === audio) {
          _currentAudio = null;
          _currentUrl = null;
        }
        revokeAudioURL(url);
      };
      audio.onerror = () => {
        if (_currentAudio === audio) {
          _currentAudio = null;
          _currentUrl = null;
        }
        revokeAudioURL(url);
      };

      try {
        await audio.play();
      } catch (err) {
        // If we were superseded mid-play, that's expected
        if (token !== _playToken) return { success: false, reason: 'superseded' };
        console.warn('[Mnemo audio] play failed', err);
        revokeAudioURL(url);
        if (_currentAudio === audio) {
          _currentAudio = null;
          _currentUrl = null;
        }
        return { success: false, reason: 'play failed', error: err };
      }
      return { success: true, name };
    } catch (err) {
      console.warn('[Mnemo audio] playAudio error', err);
      return { success: false, reason: 'unexpected error', error: err };
    }
  }

  // Call when navigating to next card etc. to release URLs
  function resetPlayback() {
    _playToken++;
    stopCurrent();
    revokeAll();
  }

  // Extract [sound:filename.mp3] markers and return { cleaned, refs:[names] }
  function extractSoundRefs(text) {
    if (!text) return { cleaned: text || '', refs: [] };
    const refs = [];
    const cleaned = String(text).replace(/\[sound:([^\]]+)\]/g, (_, fn) => {
      refs.push(fn.trim());
      return '';
    }).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { cleaned, refs };
  }

  // Fix #5: check which refs actually exist in storage
  async function checkRefs(refs) {
    if (!Array.isArray(refs) || !refs.length) return {};
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const result = {};
      let pending = refs.length;
      refs.forEach((name) => {
        const r = store.getKey ? store.getKey(name) : store.get(name);
        r.onsuccess = () => {
          result[name] = r.result != null;
          if (--pending === 0) res(result);
        };
        r.onerror = () => {
          result[name] = false;
          if (--pending === 0) res(result);
        };
      });
      tx.onerror = () => rej(tx.error);
    });
  }

  // Build <img> elements from image blobs stored in IndexedDB.
  // URLs are tracked in _liveUrls so resetPlayback()/revokeAll() releases
  // them on card change, just like audio URLs.
  // Supported mimes: image/png, image/jpeg, image/gif, image/webp, image/svg+xml.
  async function buildImageElements(names) {
    const map = new Map();
    if (!Array.isArray(names) || !names.length) return map;
    const seen = new Set();
    for (const raw of names) {
      const name = String(raw || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      try {
        const rec = await getAudio(name); // generic blob-by-key fetch
        if (!rec || !rec.blob) { map.set(name, null); continue; }
        const url = URL.createObjectURL(rec.blob);
        _liveUrls.add(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = name;
        img.className = 'mnemo-card-image';
        img.loading = 'lazy';
        map.set(name, img);
      } catch (err) {
        console.warn('[Mnemo image] failed to load', name, err);
        map.set(name, null);
      }
    }
    return map;
  }

  // Optionally pass a presence map { name: boolean } from checkRefs() to render
  // a missing-audio indicator for unknown files (Fix #5).
  function buildAudioButtons(refs, presence) {
    if (!Array.isArray(refs) || !refs.length) return '';
    return refs.map((name, i) => {
      const safe = name.replace(/"/g, '&quot;');
      const missing = presence && presence[name] === false;
      if (missing) {
        return `<button type="button" class="mnemo-audio-btn mnemo-audio-missing" data-audio="${safe}" aria-label="Audio missing for ${safe}" title="Audio missing from import">🔊❌ <span>Missing${refs.length > 1 ? ' ' + (i + 1) : ''}</span></button>`;
      }
      return `<button type="button" class="mnemo-audio-btn" data-audio="${safe}" aria-label="Play audio ${i + 1}">🔊 <span>Play${refs.length > 1 ? ' ' + (i + 1) : ''}</span></button>`;
    }).join('');
  }

  // ── TTS (Web Speech API) ────────────────────────────────────────────────
  function _stripPlaceholders(text) {
    return String(text || '')
      .replace(/⟦IMG::[^⟧]*⟧/g, '')
      .replace(/⟦MATH::[^⟧]*⟧/g, '')
      .trim();
  }

  function speakText(text, lang) {
    try {
      if (typeof speechSynthesis === 'undefined') return;
      const cleaned = _stripPlaceholders(text);
      if (!cleaned) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(cleaned);
      u.lang = lang || (typeof state !== 'undefined' && state?.settings?.ttsLang) || 'en-US';
      speechSynthesis.speak(u);
    } catch (err) {
      console.warn('[Mnemo TTS] speak failed', err);
    }
  }

  function stopSpeech() {
    try {
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    } catch {}
  }

  function buildTTSButton(text) {
    const safe = String(text || '').replace(/"/g, '&quot;');
    return `<button type="button" class="mnemo-audio-btn mnemo-tts-btn" data-tts="${safe}" aria-label="Read aloud">🔊 <span>Read</span></button>`;
  }

  // Single delegated click handler
  document.addEventListener('click', async (e) => {
    const ttsBtn = e.target.closest('.mnemo-tts-btn');
    if (ttsBtn) {
      e.preventDefault();
      e.stopPropagation();
      const text = ttsBtn.dataset.tts || '';
      const label = ttsBtn.querySelector('span');
      if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) {
        stopSpeech();
        if (label) label.textContent = 'Read';
        ttsBtn.childNodes[0] && (ttsBtn.childNodes[0].nodeValue = '🔊 ');
      } else {
        speakText(text);
        if (label) label.textContent = 'Stop';
        ttsBtn.childNodes[0] && (ttsBtn.childNodes[0].nodeValue = '⏹ ');
        try {
          const u = () => {
            if (label) label.textContent = 'Read';
            ttsBtn.childNodes[0] && (ttsBtn.childNodes[0].nodeValue = '🔊 ');
          };
          if (typeof speechSynthesis !== 'undefined') {
            const poll = setInterval(() => {
              if (!speechSynthesis.speaking) { clearInterval(poll); u(); }
            }, 250);
          }
        } catch {}
      }
      return;
    }
    const btn = e.target.closest('.mnemo-audio-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const name = btn.dataset.audio;
    if (!name) return;
    const result = await playAudio(name);
    // Fix #5: if the file is missing, mark the button so the user sees it
    if (result && result.success === false && result.reason === 'audio file not found') {
      btn.classList.add('mnemo-audio-missing');
      btn.setAttribute('title', 'Audio missing from import');
      const label = btn.querySelector('span');
      if (label) label.textContent = 'Missing';
      btn.firstChild && (btn.childNodes[0].nodeValue = '🔊❌ ');
    }
  });

  // Inject styles once
  function injectStyles() {
    if (document.getElementById('mnemoAudioStyles')) return;
    const s = document.createElement('style');
    s.id = 'mnemoAudioStyles';
    s.textContent = `
      .mnemo-audio-btn {
        display: inline-flex; align-items: center; gap: 6px;
        margin: 6px 6px 0 0;
        padding: 7px 14px;
        background: var(--acc-d, rgba(255,45,127,0.15));
        color: var(--acc, #FF2D7F);
        border: 1px solid var(--acc-d2, rgba(255,45,127,0.30));
        border-radius: 999px;
        font-size: 0.82rem; font-weight: 600;
        cursor: pointer;
        transition: transform .15s ease, background .2s ease;
        min-height: 36px; /* a11y tap target */
      }
      .mnemo-audio-btn:hover, .mnemo-audio-btn:focus-visible {
        background: var(--acc, #FF2D7F);
        color: #fff;
        outline: none;
        transform: translateY(-1px);
      }
      .mnemo-audio-btn:active { transform: translateY(0); }
      .mnemo-audio-btn.mnemo-audio-missing {
        background: rgba(120,120,120,0.15);
        color: #888;
        border-color: rgba(120,120,120,0.35);
        cursor: help;
      }
      .mnemo-audio-btn.mnemo-audio-missing:hover {
        background: rgba(120,120,120,0.25);
        color: #555;
      }
      .mnemo-audio-row {
        display: flex; flex-wrap: wrap; gap: 4px;
        margin-top: 8px;
      }
      .mnemo-tts-btn { /* identical to .mnemo-audio-btn (shares class) */ }
    `;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else { injectStyles(); }

  // ── Public API ───────────────────────────────────────────────────────────
  window.MnemoAudio = {
    putAudio,
    putAudioBatch,      // Fix #4
    getAudio,
    createAudioURL,     // Fix #1 (replaces getAudioURL)
    revokeAudioURL,     // Fix #1
    revokeAll,          // Fix #1
    playAudio,
    resetPlayback,      // Fix #1/#3 — call on card change
    extractSoundRefs,
    checkRefs,          // Fix #5
    buildAudioButtons,
    buildImageElements, // image rendering for cards
    speakText,          // TTS
    stopSpeech,         // TTS
    buildTTSButton,     // TTS
  };
})();
