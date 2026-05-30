'use strict';
(function(){
  let shapes = [];
  let bgDataUrl = null;

  // ── Init canvas drawing ───────────────────────────────────────
  function init() {
    const fileInput = document.getElementById('occlusionImageFile');
    const canvas    = document.getElementById('occlusionCanvas');
    const bg        = document.getElementById('occlusionBg');
    const wrap      = document.getElementById('occlusionCanvasWrap');
    if (!fileInput || !canvas) return;

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        bgDataUrl = ev.target.result;
        bg.src = bgDataUrl;
        bg.onload = () => {
          canvas.width  = bg.naturalWidth;
          canvas.height = bg.naturalHeight;
          wrap.classList.remove('hidden');
          redraw();
        };
      };
      reader.readAsDataURL(file);
    };

    // Scroll Down Button Event
    const scrollDownBtn = document.getElementById('occlusionScrollDownBtn');
    if (scrollDownBtn) {
      scrollDownBtn.onclick = () => {
        const shapeList = document.getElementById('occlusionShapeList');
        if (shapeList) {
          shapeList.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
    }

    let sx, sy, drawing = false;

    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      const r = canvas.getBoundingClientRect();
      sx = (e.clientX - r.left) / r.width;
      sy = (e.clientY - r.top)  / r.height;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const r  = canvas.getBoundingClientRect();
      const ex = (e.clientX - r.left) / r.width;
      const ey = (e.clientY - r.top)  / r.height;
      redraw({ x: Math.min(sx,ex), y: Math.min(sy,ey), w: Math.abs(ex-sx), h: Math.abs(ey-sy) });
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!drawing) return;
      drawing = false;
      const r  = canvas.getBoundingClientRect();
      const ex = (e.clientX - r.left) / r.width;
      const ey = (e.clientY - r.top)  / r.height;
      const w = Math.abs(ex - sx), h = Math.abs(ey - sy);
      if (w > 0.01 && h > 0.01) {
        shapes.push({ id: Date.now().toString(36), x: Math.min(sx,ex), y: Math.min(sy,ey), w, h, label: '' });
        syncShapeList();
      }
      redraw();
    });
  }

  function redraw(preview) {
    const canvas = document.getElementById('occlusionCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const all = preview ? [...shapes, preview] : shapes;
    all.forEach((s, i) => {
      ctx.fillStyle   = 'rgba(255,45,127,0.45)';
      ctx.strokeStyle = '#FF2D7F';
      ctx.lineWidth   = 2;
      ctx.fillRect(s.x*W, s.y*H, s.w*W, s.h*H);
      ctx.strokeRect(s.x*W, s.y*H, s.w*W, s.h*H);
      if (s.label) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.min(24, Math.max(12, s.h*H*0.25))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Stroke for high contrast readability
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeText(s.label, (s.x+s.w/2)*W, (s.y+s.h/2)*H);
        ctx.fillText(s.label, (s.x+s.w/2)*W, (s.y+s.h/2)*H);
      }
    });
  }

  function updateWarningState() {
    // 1. Update count badge
    const badge = document.getElementById('occlusionCountBadge');
    if (badge) {
      if (shapes.length > 0) {
        badge.textContent = `${shapes.length} ${shapes.length === 1 ? 'box' : 'boxes'} · ${shapes.length} ${shapes.length === 1 ? 'card' : 'cards'}`;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    // 2. Scan shapes and update each row's classes and pill styling
    let firstWarningIndex = -1;
    shapes.forEach((s, idx) => {
      const row = document.querySelector(`.occlusion-shape-card[data-id="${s.id}"]`);
      if (!row) return;

      const isBlank = !s.label || !s.label.trim();
      const pill = row.querySelector('.occlusion-pill');
      
      // Update row warning-border
      if (isBlank) {
        row.classList.add('warning-border');
        if (pill) {
          pill.style.background = 'none';
          pill.style.border = '1.5px solid rgba(255, 255, 255, 0.3)';
        }
        if (firstWarningIndex === -1) {
          firstWarningIndex = idx + 1; // 1-indexed
        }
      } else {
        row.classList.remove('warning-border');
        if (pill) {
          pill.style.background = 'rgba(255,45,127,0.45)';
          pill.style.border = '1px solid #FF2D7F';
        }
      }
    });

    // 3. Update warning banner at bottom
    const banner = document.getElementById('occlusionWarningBanner');
    const warningText = document.getElementById('occlusionWarningText');
    if (banner && warningText) {
      if (firstWarningIndex !== -1) {
        warningText.textContent = `Box ${firstWarningIndex} has no label — it will reveal the image region only, no text answer.`;
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    }
  }

  function syncShapeList() {
    const list = document.getElementById('occlusionShapeList');
    if (!list) return;
    if (shapes.length === 0) {
      list.innerHTML = '';
      updateWarningState();
      return;
    }

    list.innerHTML = shapes.map((s, i) => {
      const isBlank = !s.label || !s.label.trim();
      const pillStyle = isBlank
        ? 'background:none; border:1.5px solid rgba(255,255,255,0.3);'
        : 'background:rgba(255,45,127,0.45); border:1px solid #FF2D7F;';
      const warningClass = isBlank ? 'warning-border' : '';
      
      return `
        <div class="occlusion-shape-card ${warningClass}" data-id="${s.id}">
          <div class="occlusion-pill" style="width:24px;height:14px;border-radius:3px;flex-shrink:0;${pillStyle}"></div>
          <input class="field-input" style="flex:1;padding:6px 12px;font-size:0.9rem;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.15);color:#fff;"
            placeholder="Label for box ${i+1} (currently hidden in review)"
            value="${s.label.replace(/"/g,'&quot;')}"
            data-shape-id="${s.id}"
            oninput="OcclusionEditor.setLabel('${s.id}',this.value)">
          <button type="button" class="occlusion-delete-shape-btn" onclick="OcclusionEditor.removeShape('${s.id}')" title="Delete Box">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </div>
      `;
    }).join('');

    updateWarningState();
  }

  function setLabel(id, val) {
    const s = shapes.find(x => x.id === id);
    if (s) {
      s.label = val;
      redraw();
      updateWarningState();
    }
  }

  // Make sure to redraw and sync list after removing shape
  function removeShape(id) {
    shapes = shapes.filter(x => x.id !== id);
    redraw();
    syncShapeList();
  }

  function reset() {
    shapes = [];
    bgDataUrl = null;
    const wrap  = document.getElementById('occlusionCanvasWrap');
    const bg    = document.getElementById('occlusionBg');
    const list  = document.getElementById('occlusionShapeList');
    const fi    = document.getElementById('occlusionImageFile');
    if (wrap)  wrap.classList.add('hidden');
    if (bg)    bg.src = '';
    if (list)  list.innerHTML = '';
    if (fi)    fi.value = '';
    const canvas = document.getElementById('occlusionCanvas');
    if (canvas) canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
    updateWarningState();
  }

  function load(dataUrl, shapeArr) {
    reset();
    bgDataUrl = dataUrl;
    shapes    = shapeArr ? JSON.parse(JSON.stringify(shapeArr)) : [];
    const bg   = document.getElementById('occlusionBg');
    const wrap = document.getElementById('occlusionCanvasWrap');
    const canvas = document.getElementById('occlusionCanvas');
    if (bg) {
      bg.src = dataUrl;
      bg.onload = () => {
        if (canvas) { canvas.width = bg.naturalWidth; canvas.height = bg.naturalHeight; }
        if (wrap) wrap.classList.remove('hidden');
        redraw();
        syncShapeList();
      };
    }
  }

  function getShapes()   { return shapes; }
  function getBgDataUrl(){ return bgDataUrl; }

  // ── Review renderer ───────────────────────────────────────────
  function buildReviewHTML(topic, activeShapeId, mode) {
    // mode: 'question' | 'answer'
    const shapes = JSON.parse(topic.content || '[]');
    const isHideAll = topic.occlusionMode === 'hide_all';
    const boxes = shapes.map(s => {
      const isActive = s.id === activeShapeId;
      let bg = '';
      if (isActive) {
        bg = (mode === 'question') ? '#0f0f11' : 'rgba(255,45,127,0.45)';
      } else {
        bg = isHideAll ? '#0f0f11' : 'rgba(255,45,127,0.45)';
      }
      const border = '#FF2D7F';
      const pct = n => (n*100).toFixed(3)+'%';
      return `<div class="oc-box${isActive && mode==='answer' ? ' oc-revealed' : ''}" style="left:${pct(s.x)};top:${pct(s.y)};width:${pct(s.w)};height:${pct(s.h)};background:${bg};border-color:${border};">${isActive && mode==='answer' ? escHtml(s.label||'?') : ''}</div>`;
    }).join('');
    return `<div class="oc-wrap"><img src="${topic.image}" class="oc-bg" data-img-ref="${topic.image || ''}" alt="">${boxes}</div>`;
  }

  function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.OcclusionEditor = { getShapes, getBgDataUrl, setLabel, removeShape, reset, load, buildReviewHTML };
})();
