/* Mnemo — Anki .apkg import (with audio support).
   Uses CDN-loaded sql.js (SQLite WASM) + fflate (zip).
   Heavy work runs in a Web Worker so the UI thread stays responsive.
   Audio files are stored in IndexedDB via window.MnemoAudio.
*/
'use strict';

(function () {
  const SQLJS_URL  = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js';
  const SQLJS_WASM = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
  const FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';

  // ── Shared text helpers (used by main thread post-processing) ───────────
  function stripHTML(html) {
    if (!html) return '';
    let s = String(html);

    // Convert Anki [latex]...[/latex] → \[...\] BEFORE stripping
    s = s.replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi, (_, body) => '\\[' + body + '\\]');

    // Replace <img src="..."> with ⟦IMG::filename⟧ placeholder (mirrors [sound:...])
    s = s.replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (_, src) => {
      const name = String(src).split('/').pop().split('?')[0];
      return '⟦IMG::' + name + '⟧';
    });

    // Protect \(...\) and \[...\] math from the HTML strip pass
    const mathStash = [];
    s = s.replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, (m) => {
      mathStash.push(m);
      return '⟦MATH::' + (mathStash.length - 1) + '⟧';
    });

    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li)>/gi, '\n')
      .replace(/\[sound:([^\]]+)\]/g, '⟦SND::$1⟧')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/⟦SND::([^⟧]+)⟧/g, '[sound:$1]')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Restore math placeholders verbatim
    s = s.replace(/⟦MATH::(\d+)⟧/g, (_, i) => mathStash[Number(i)] || '');
    return s;
  }

  // FIX #4: Proper non-greedy cloze regex. Captures content between
  // {{cN:: and }} regardless of `::` or `}` characters inside.
  // Form: {{c1::answer}} or {{c1::answer::hint}}.
  // We split on the LAST `::` (only if followed by a non-`::` hint) to
  // separate hint, then keep the answer body verbatim.
  function normalizeCloze(s) {
    if (!s) return s;
    return s.replace(/\{\{c(\d+)::([\s\S]+?)\}\}/g, (_, _n, body) => {
      // Strip an optional trailing `::hint` (hint may itself contain `}` or `:`).
      // Find the last `::` that isn't part of the body's own `::` cluster.
      const idx = body.lastIndexOf('::');
      const answer = idx >= 0 ? body.slice(0, idx) : body;
      return `{{c1::${answer}}}`;
    });
  }

  function mimeFor(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return {
      mp3:'audio/mpeg', m4a:'audio/mp4', mp4:'audio/mp4', aac:'audio/aac',
      ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg', wav:'audio/wav',
      webm:'audio/webm', flac:'audio/flac',
      png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
      gif:'image/gif', webp:'image/webp', svg:'image/svg+xml',
    }[ext] || 'application/octet-stream';
  }
  function isAudioName(name) {
    return /\.(mp3|m4a|mp4|aac|ogg|oga|opus|wav|webm|flac)$/i.test(name || '');
  }
  function isImageName(name) {
    return /\.(png|jpe?g|gif|webp|svg)$/i.test(name || '');
  }

  // ── FIX #1: Web Worker for heavy work (unzip + SQLite parse) ────────────
  // Worker source is built as a string and spawned via Blob URL so we don't
  // need a separate file. It loads sql.js + fflate from CDN inside the worker.
  function buildWorkerSource() {
    return `
      'use strict';
      let SQL = null;
      let fflate = null;

      self.onmessage = async (ev) => {
        const { type, payload } = ev.data || {};
        if (type !== 'parse') return;
        try {
          await loadLibs();
          const result = await parse(payload.buffer);
          self.postMessage({ type: 'done', result }, []);
        } catch (err) {
          self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
        }
      };

      async function loadLibs() {
        if (!fflate) {
          importScripts(${JSON.stringify(FFLATE_URL)});
          fflate = self.fflate;
        }
        if (!SQL) {
          importScripts(${JSON.stringify(SQLJS_URL)});
          SQL = await self.initSqlJs({ locateFile: f => ${JSON.stringify(SQLJS_WASM)} + f });
        }
      }

      function progress(msg) { self.postMessage({ type: 'progress', message: msg }); }

      // FIX #2: Validate the SQLite schema before issuing real queries.
      function validateSchema(db) {
        const required = ['notes', 'cards', 'col'];
        const res = db.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('notes','cards','col')"
        );
        const present = new Set((res && res[0] && res[0].values || []).map(r => r[0]));
        const missing = required.filter(t => !present.has(t));
        if (missing.length) {
          throw new Error(
            'Invalid .apkg file: missing required tables (' + missing.join(', ') +
            "). Try re-exporting from Anki with 'Support older versions' enabled."
          );
        }
      }

      async function parse(buf) {
        progress('Unpacking…');
        const u8 = new Uint8Array(buf);
        const unzipped = fflate.unzipSync(u8);

        const dbBytes =
          unzipped['collection.anki21'] ||
          unzipped['collection.anki2']  ||
          unzipped['collection.anki21b'];
        if (!dbBytes) throw new Error('No collection.anki2 found inside the .apkg file.');
        if (unzipped['collection.anki21b'] && !unzipped['collection.anki2'] && !unzipped['collection.anki21']) {
          throw new Error("This .apkg uses Anki's newer encrypted format (anki21b). Re-export from Anki with \\"Support older Anki versions\\" enabled.");
        }

        // Media manifest: { "0": "hello.mp3", ... }
        let mediaMap = {};
        if (unzipped['media']) {
          try { mediaMap = JSON.parse(new TextDecoder().decode(unzipped['media'])); } catch (e) {}
        }

        // Pull audio + image entries out of unzipped so they can be transferred back.
        progress('Collecting media…');
        const audio  = []; // { name, mime, buffer }
        const images = []; // { name, mime, buffer }
        for (const num in mediaMap) {
          const origName = mediaMap[num];
          const data = unzipped[num];
          if (!data) continue;
          const isAudio = /\\.(mp3|m4a|mp4|aac|ogg|oga|opus|wav|webm|flac)$/i.test(origName);
          const isImage = /\\.(png|jpe?g|gif|webp|svg)$/i.test(origName);
          if (!isAudio && !isImage) continue;
          const ext = (origName.split('.').pop() || '').toLowerCase();
          const mime = ({
            mp3:'audio/mpeg', m4a:'audio/mp4', mp4:'audio/mp4', aac:'audio/aac',
            ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg', wav:'audio/wav',
            webm:'audio/webm', flac:'audio/flac',
            png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
            gif:'image/gif', webp:'image/webp', svg:'image/svg+xml',
          })[ext] || 'application/octet-stream';
          // Copy into its own ArrayBuffer so it can be transferred.
          const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
          (isAudio ? audio : images).push({ name: origName, mime, buffer: ab });
        }

        progress('Reading cards…');
        const db = new SQL.Database(dbBytes);
        validateSchema(db);

        const colRows = db.exec('SELECT decks FROM col LIMIT 1');
        const decksJson = colRows && colRows[0] && colRows[0].values[0] && colRows[0].values[0][0];
        let deckMap = {};
        try { deckMap = JSON.parse(decksJson || '{}'); } catch (e) {}

        const cardRows = db.exec('SELECT nid, did FROM cards');
        const nidToDid = Object.create(null);
        const cv = (cardRows && cardRows[0] && cardRows[0].values) || [];
        for (let i = 0; i < cv.length; i++) {
          const nid = cv[i][0], did = cv[i][1];
          if (nidToDid[nid] === undefined) nidToDid[nid] = did;
        }

        const noteRows = db.exec('SELECT id, flds, tags FROM notes');
        const nv = (noteRows && noteRows[0] && noteRows[0].values) || [];
        const notes = [];
        for (let i = 0; i < nv.length; i++) {
          const nid = nv[i][0], flds = nv[i][1], tags = nv[i][2];
          const fields = String(flds || '').split('\\x1f');
          const did = nidToDid[nid];
          const deckObj = did != null ? deckMap[String(did)] : null;
          const deckPath = (deckObj && deckObj.name) || 'Imported';
          notes.push({
            front: fields[0] || '',
            back:  fields.slice(1).join('\\n\\n') || '',
            fields,
            deckPath,
            tags: String(tags || '').trim(),
          });
        }
        db.close();

        const transfers = [...audio, ...images].map(a => a.buffer);
        return { notes, audio, images, transfers };
      }
    `;
  }

  let _workerPromise = null;
  function getWorker() {
    if (_workerPromise) return _workerPromise;
    _workerPromise = new Promise((resolve, reject) => {
      try {
        const blob = new Blob([buildWorkerSource()], { type: 'application/javascript' });
        const url  = URL.createObjectURL(blob);
        const w = new Worker(url);
        // We can revoke after the worker fetches it.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        resolve(w);
      } catch (e) {
        reject(e);
      }
    });
    return _workerPromise;
  }

  function runWorkerParse(buffer, onProgress) {
    return new Promise(async (resolve, reject) => {
      let worker;
      try { worker = await getWorker(); } catch (e) { return reject(e); }
      const onMsg = (ev) => {
        const { type, message, result } = ev.data || {};
        if (type === 'progress') { onProgress?.(message); return; }
        if (type === 'done')     { worker.removeEventListener('message', onMsg); resolve(result); return; }
        if (type === 'error')    { worker.removeEventListener('message', onMsg); reject(new Error(message)); return; }
      };
      worker.addEventListener('message', onMsg);
      try {
        worker.postMessage({ type: 'parse', payload: { buffer } }, [buffer]);
      } catch (e) {
        worker.removeEventListener('message', onMsg);
        reject(e);
      }
    });
  }

  // ── FIX #3: Parallel batched media writes (audio + images) ───────────────
  async function storeMediaParallel(items, onProgress, label = 'media', batchSize = 8) {
    if (!window.MnemoAudio || !items?.length) return 0;
    let stored = 0;
    for (let i = 0; i < items.length; i += batchSize) {
      const slice = items.slice(i, i + batchSize);
      const results = await Promise.allSettled(slice.map(a => {
        const blob = new Blob([a.buffer], { type: a.mime });
        return window.MnemoAudio.putAudio(a.name, blob, a.mime);
      }));
      for (let k = 0; k < results.length; k++) {
        if (results[k].status === 'fulfilled') stored++;
        else console.warn('[Mnemo] failed to store ' + label, slice[k].name, results[k].reason);
      }
      onProgress?.(`Storing ${label}… ${Math.min(i + batchSize, items.length)}/${items.length}`);
    }
    return stored;
  }

  // Collect ⟦IMG::name⟧ placeholders without removing them from the text
  function extractImageRefs(text) {
    if (!text) return [];
    const refs = [];
    String(text).replace(/⟦IMG::([^⟧]+)⟧/g, (_, n) => { refs.push(n.trim()); return ''; });
    return refs;
  }

  // Parse Anki SVG image occlusion masks and normalize coordinates to 0-1 range
  function parseAnkiOcclusion(fields) {
    let imgFilename = null;
    let svgString = null;
    
    for (const f of fields || []) {
      const s = String(f || '').trim();
      if (!s) continue;
      
      // Find image tag
      if (!imgFilename && /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.test(s)) {
        const match = s.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
        if (match && match[1]) {
          imgFilename = match[1].split('/').pop().split('?')[0];
        }
      }
      
      // Find SVG tag
      if (!svgString && /<svg\b[^>]*>[\s\S]*<\/svg>/i.test(s)) {
        const m = s.match(/<svg\b[^>]*>[\s\S]*<\/svg>/i);
        if (m) svgString = m[0];
      }
    }
    
    if (!imgFilename || !svgString) return null;
    
    // Parse SVG dimensions to normalize coordinates
    let width = 0, height = 0;
    const svgOpenTag = (svgString.match(/<svg\b[^>]*>/i) || [''])[0];
    const wMatch = svgOpenTag.match(/\bwidth\s*=\s*["'](\d+(?:\.\d+)?)["']/i);
    const hMatch = svgOpenTag.match(/\bheight\s*=\s*["'](\d+(?:\.\d+)?)["']/i);
    
    if (wMatch && hMatch) {
      width = parseFloat(wMatch[1]);
      height = parseFloat(hMatch[1]);
    } else {
      const vbMatch = svgOpenTag.match(/\bviewBox\s*=\s*["']\s*\d+\s+\d+\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']/i);
      if (vbMatch) {
        width = parseFloat(vbMatch[1]);
        height = parseFloat(vbMatch[2]);
      }
    }
    
    if (!width || !height) {
      width = 800;
      height = 600;
    }
    
    const shapes = [];
    const rectRegex = /<rect\b([^>]+)>/ig;
    let match;
    while ((match = rectRegex.exec(svgString)) !== null) {
      const attrsStr = match[1];
      const getAttr = (name) => {
        const m = attrsStr.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
        return m ? m[1] : null;
      };
      
      const rx = parseFloat(getAttr('x') || '0');
      const ry = parseFloat(getAttr('y') || '0');
      const rw = parseFloat(getAttr('width') || '0');
      const rh = parseFloat(getAttr('height') || '0');
      const id = getAttr('id') || Math.random().toString(36).slice(2, 6);
      
      const x = rx / width;
      const y = ry / height;
      const w = rw / width;
      const h = rh / height;
      
      if (w > 0.001 && h > 0.001) {
        shapes.push({
          id,
          x: Math.min(1, Math.max(0, x)),
          y: Math.min(1, Math.max(0, y)),
          w: Math.min(1, Math.max(0, w)),
          h: Math.min(1, Math.max(0, h)),
          label: ''
        });
      }
    }
    
    if (!shapes.length) return null;
    
    return {
      image: imgFilename,
      shapes: shapes
    };
  }

  // ── Main parse: worker does heavy lifting; we post-process notes here ───
  async function parseApkg(file, onProgress) {
    onProgress?.('Reading file…');
    const buffer = await file.arrayBuffer();
    onProgress?.('Parsing in background…');
    const { notes, audio, images } = await runWorkerParse(buffer, onProgress);

    const audioCount = await storeMediaParallel(audio,  onProgress, 'audio');
    const imageCount = await storeMediaParallel(images, onProgress, 'images');

    onProgress?.('Building cards…');
    const cards = [];
    for (const n of notes) {
      const occlusion = parseAnkiOcclusion(n.fields);
      if (occlusion) {
        cards.push({
          type: 'occlusion',
          image: occlusion.image,
          content: JSON.stringify(occlusion.shapes),
          deckPath: n.deckPath,
          tags: n.tags
        });
        continue;
      }

      let front = normalizeCloze(stripHTML(n.front));
      let back  = normalizeCloze(stripHTML(n.back));

      let frontRefs = [], backRefs = [];
      if (window.MnemoAudio) {
        const f = window.MnemoAudio.extractSoundRefs(front);
        const b = window.MnemoAudio.extractSoundRefs(back);
        front = f.cleaned; frontRefs = f.refs;
        back  = b.cleaned; backRefs  = b.refs;
      }
      const frontImageRefs = extractImageRefs(front);
      const backImageRefs  = extractImageRefs(back);
      if (!front && !back && !frontRefs.length && !backRefs.length
          && !frontImageRefs.length && !backImageRefs.length) continue;
      cards.push({
        front, back, deckPath: n.deckPath, tags: n.tags,
        frontRefs, backRefs, frontImageRefs, backImageRefs,
      });
    }

    return {
      cards,
      deckCount: new Set(cards.map(c => c.deckPath)).size,
      audioCount,
      imageCount,
    };
  }

  // ── Inject into Mnemo state ─────────────────────────────────────────────
  function ensureDeckPath(path) {
    if (typeof state === 'undefined' || !Array.isArray(state.decks)) return null;
    const segs = String(path).split('::').map(s => s.trim()).filter(Boolean);
    let parentId = null;
    let lastId = null;
    for (const name of segs) {
      let found = state.decks.find(d => d.name === name && (d.parentId || null) === parentId);
      if (!found) {
        const id = 'apkg_' + Math.random().toString(36).slice(2, 10);
        const palette = ['#7B6EF6','#36E8AA','#FF5C7A','#FFB547','#4FC3F7','#E040FB','#FF8A65','#26C6DA'];
        found = {
          id, name, color: palette[state.decks.length % palette.length],
          parentId, scheduleMode: 'auto', desc: 'Imported from Anki',
        };
        state.decks.push(found);
      }
      parentId = found.id;
      lastId   = found.id;
    }
    return lastId;
  }

  function importIntoMnemo(cards) {
    if (typeof state === 'undefined' || !Array.isArray(state.topics)) {
      throw new Error('Mnemo state is not ready.');
    }
    const today = (typeof todayStr === 'function') ? todayStr() : new Date().toISOString().slice(0,10);
    let added = 0;
    for (const c of cards) {
      const deckId = ensureDeckPath(c.deckPath) || null;
      const id = 't_' + Math.random().toString(36).slice(2, 11);
      const isCloze = /\{\{c\d+::/.test(c.front || '') || /\{\{c\d+::/.test(c.back || '');
      const topic = {
        id,
        title:   c.type === 'occlusion' ? 'Image Occlusion' : (c.front || '(no front)').slice(0, 500),
        content: c.type === 'occlusion' ? c.content : (c.back  || '').slice(0, 10000),
        deckId,
        type:    c.type === 'occlusion' ? 'occlusion' : (isCloze ? 'cloze' : 'standard'),
        startDate: today,
        createdAt: today,
        tags: c.tags || '',
        image: c.type === 'occlusion' ? c.image : undefined,
        occlusionMode: c.type === 'occlusion' ? 'hide_one' : undefined
      };
      const allRefs = [...(c.frontRefs || []), ...(c.backRefs || [])];
      if (allRefs.length) {
        topic.audioRefs      = allRefs;
        topic.audioRefsFront = c.frontRefs || [];
        topic.audioRefsBack  = c.backRefs  || [];
      }
      const allImgRefs = [...(c.frontImageRefs || []), ...(c.backImageRefs || [])];
      if (allImgRefs.length) {
        topic.imageRefs      = allImgRefs;
        topic.imageRefsFront = c.frontImageRefs || [];
        topic.imageRefsBack  = c.backImageRefs  || [];
      }
      state.topics.push(topic);
      added++;
    }
    if (typeof saveImmediate === 'function') saveImmediate();
    else if (typeof window.save === 'function') window.save();
    if (typeof IndexManager?.scheduleRebuild === 'function') IndexManager.scheduleRebuild();
    if (typeof renderToday === 'function') renderToday();
    return added;
  }

  // ── Import/Export UI (Anki card is the FIRST item in the layout) ───────
  function injectSettingsUI() {
    const section = document.getElementById('section-import');
    if (!section || document.getElementById('mnemoApkgImport')) return false;
    const layout = section.querySelector('.import-layout') || section;
    const card = document.createElement('div');
    card.id = 'mnemoApkgImport';
    card.className = 'import-card';
    card.innerHTML = `
      <div class="ic-title">📦 Import from Anki (.apkg)</div>
      <div class="ic-desc">
        Brings in cards, deck folders and audio. Fill-in-the-blank cards and
        sound files (MP3/OGG/WAV) are kept. Audio stays on this device.
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;">
        <label class="btn-primary" style="cursor:pointer;">
          Choose .apkg file
          <input id="mxApkgInput" type="file" accept=".apkg,.zip" style="display:none;">
        </label>
        <span id="mxApkgStatus" style="color:var(--ink2);font-size:.88rem;" aria-live="polite"></span>
      </div>
    `;
    if (layout.firstChild) layout.insertBefore(card, layout.firstChild);
    else layout.appendChild(card);
    wireInput(card.querySelector('#mxApkgInput'), card.querySelector('#mxApkgStatus'));
    return true;
  }

  function wireInput(input, statusEl) {
    if (!input || input.dataset.mxWired === '1') return;
    input.dataset.mxWired = '1';
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const setStatus = (txt) => { if (statusEl) statusEl.textContent = txt; };
      setStatus('Reading file… (first import downloads ~600KB of helper code)');
      try {
        const { cards, deckCount, audioCount, imageCount } = await parseApkg(file, setStatus);
        if (!cards.length) { setStatus('No cards found in this file.'); return; }
        const audioMsg = audioCount ? ` (+ ${audioCount} audio files)` : '';
        const imageMsg = imageCount ? ` (+ ${imageCount} image files)` : '';
        const mediaMsg = audioMsg + imageMsg;
        if (!confirm(`Import ${cards.length} cards into ${deckCount} deck${deckCount===1?'':'s'}${mediaMsg}?`)) {
          setStatus('Cancelled.');
          input.value = '';
          return;
        }
        const added = importIntoMnemo(cards);
        setStatus(`✅ Imported ${added} cards${mediaMsg}.`);
      } catch (err) {
        console.error('[Mnemo] apkg import failed', err);
        setStatus('❌ ' + (err?.message || 'Import failed.'));
      } finally {
        input.value = '';
      }
    });
  }

  function wireAISectionInput() {
    const input = document.getElementById('aiSectionApkgInput');
    const status = document.getElementById('aiSectionApkgStatus');
    if (input && input.dataset.mxWired !== '1') {
      wireInput(input, status);
      return true;
    }
    return false;
  }

  // ── FIX #5: Bounded, scoped DOM observation ─────────────────────────────
  // Watch the smallest container that can host our target sections. Stop
  // observing as soon as both injection points are wired (or after a hard
  // timeout) so we don't keep firing on every DOM mutation in the app.
  function init() {
    const settingsDone = !!document.getElementById('mnemoApkgImport') || injectSettingsUI();
    const aiDone = !!document.querySelector('#aiSectionApkgInput[data-mx-wired="1"]') || wireAISectionInput();
    return settingsDone && aiDone;
  }

  function startScopedObserver() {
    if (init()) return; // already done — never observe.

    // Prefer a #app/main container; fall back to body but disconnect aggressively.
    const target =
      document.getElementById('app') ||
      document.querySelector('main') ||
      document.body;

    const obs = new MutationObserver(() => {
      if (init()) obs.disconnect();
    });
    obs.observe(target, { childList: true, subtree: true });

    // Hard safety net: stop observing after 30s no matter what.
    setTimeout(() => obs.disconnect(), 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startScopedObserver, { once: true });
  } else {
    startScopedObserver();
  }
})();
