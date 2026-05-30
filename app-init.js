/* ============================================================================
   app-init.js — Mnemo page-level bootstrap
   Extracted from the inline <script> block at the bottom of app.html.
   Loaded with <script src="app-init.js" defer></script> in place of that block.
   Depends on: script.js (switchSection, state, setExpertMode, startSession, etc.)
               and DOM elements already present in app.html.
   ============================================================================ */
   (function () {
    'use strict';
  
    // ── Modal close via data-modal-close attribute ──────────────────────────────
    document.addEventListener('click', function (e) {
      const closeBtn = e.target.closest('[data-modal-close]');
      if (closeBtn) {
        const modalId = closeBtn.dataset.modalClose;
        if (typeof closeModal === 'function') closeModal(modalId);
      }
    });
  
    // ── Session rating buttons (Today section) ──────────────────────────────────
    document.addEventListener('click', function (e) {
      const rateBtn = e.target.closest('#sessRatingRow [data-rating]');
      if (rateBtn && typeof rateSessionCard === 'function') {
        rateSessionCard(rateBtn.dataset.rating);
      }
    });
  
    // ── Flashcard rating buttons ────────────────────────────────────────────────
    document.addEventListener('click', function (e) {
      const rateBtn = e.target.closest('#fcRatingRow [data-rating]');
      if (rateBtn && typeof fcRate === 'function') {
        fcRate(rateBtn.dataset.rating);
      }
    });
  
    // ── Mobile bottom nav: active state + routing ───────────────────────────────
    const mobNavItems = document.querySelectorAll('.mob-nav-item[data-section]');
    mobNavItems.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const section = btn.dataset.section;
        const sidebarBtn = document.querySelector(
          '.sidebar .nav-item[data-section="' + section + '"]'
        );
        if (sidebarBtn) sidebarBtn.click();
        mobNavItems.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.mob-nav-svg').forEach(function (s) {
          s.classList.remove('mob-nav-svg--active');
        });
        btn.querySelector('.mob-nav-svg')?.classList.add('mob-nav-svg--active');
      });
    });
  
    // Keep bottom nav in sync when sidebar nav is used ─────────────────────────
    document.addEventListener('click', function (e) {
      const sideBtn = e.target.closest('.sidebar .nav-item[data-section]');
      if (!sideBtn) return;
      const section = sideBtn.dataset.section;
      mobNavItems.forEach(function (b) {
        const isActive = b.dataset.section === section;
        b.classList.toggle('active', isActive);
        b.querySelector('.mob-nav-svg')?.classList.toggle('mob-nav-svg--active', isActive);
      });
    });
  
    // ── Settings sheet open/close ───────────────────────────────────────────────
    function openSettingsSheet() {
      const overlay = document.getElementById('settingsSheetOverlay');
      const sheet   = document.getElementById('settingsSheet');
      if (overlay) { overlay.classList.remove('hidden'); overlay.removeAttribute('aria-hidden'); }
      if (sheet)   { sheet.classList.remove('hidden'); sheet.scrollTop = 0; }
    }
    function closeSettingsSheet() {
      const overlay = document.getElementById('settingsSheetOverlay');
      const sheet   = document.getElementById('settingsSheet');
      if (overlay) { overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden', 'true'); }
      if (sheet)   sheet.classList.add('hidden');
    }
    window.openSettingsSheet  = openSettingsSheet;
    window.closeSettingsSheet = closeSettingsSheet;
  
    // ── Side drawer (hamburger) open/close ──────────────────────────────────────
    function openSideDrawer() {
      const ov = document.getElementById('sideDrawerOverlay');
      const dr = document.getElementById('sideDrawer');
      if (ov) { ov.classList.remove('hidden'); ov.removeAttribute('aria-hidden'); }
      if (dr) { dr.classList.add('open'); dr.removeAttribute('aria-hidden'); }
    }
    function closeSideDrawer() {
      const ov = document.getElementById('sideDrawerOverlay');
      const dr = document.getElementById('sideDrawer');
      if (ov) { ov.classList.add('hidden'); ov.setAttribute('aria-hidden', 'true'); }
      if (dr) { dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); }
    }
    window.openSideDrawer  = openSideDrawer;
    window.closeSideDrawer = closeSideDrawer;
  
    document.getElementById('mobHamburgerBtn')?.addEventListener('click', openSideDrawer);
    document.getElementById('sideDrawerClose')?.addEventListener('click', closeSideDrawer);
    document.getElementById('sideDrawerOverlay')?.addEventListener('click', closeSideDrawer);
  
    document.querySelectorAll('.sd-row[data-drawer-section]').forEach(function (row) {
      row.addEventListener('click', function () {
        const section = row.dataset.drawerSection;
        closeSideDrawer();
        const sb = document.querySelector('.sidebar .nav-item[data-section="' + section + '"]');
        if (sb) sb.click();
      });
    });
  
    document.getElementById('settingsSheetBack')?.addEventListener('click', closeSettingsSheet);
    document.getElementById('settingsSheetOverlay')?.addEventListener('click', closeSettingsSheet);
  
    // ── Drawer rows: route through switchSection ────────────────────────────────
    // Expert-gated sections: auto-enable expert mode when opened from drawer.
    const EXPERT_DRAWER_SECTIONS = ['analytics', 'goals', 'heatmap', 'import', 'past'];
    document.querySelectorAll('.sd-row[data-drawer-section]').forEach(function (row) {
      row.addEventListener('click', function () {
        const section = row.dataset.drawerSection;
        closeSideDrawer();
        if (EXPERT_DRAWER_SECTIONS.indexOf(section) !== -1) {
          if (typeof window.setExpertMode === 'function' &&
              !(window.state && window.state.expertMode)) {
            window.setExpertMode(true);
          }
        }
        if (typeof window.switchSection === 'function') {
          window.switchSection(section);
        }
      });
    });
  
    // ── Deck name 40-char counter ───────────────────────────────────────────────
    const dnInput = document.getElementById('deckName');
    const dnCount = document.getElementById('deckNameCount');
    if (dnInput && dnCount) {
      function updateDeckNameCount() {
        const len = (dnInput.value || '').length;
        dnCount.textContent = len + ' / 40';
        dnCount.style.color = len >= 40 ? 'var(--red)' : 'var(--ink3)';
      }
      dnInput.addEventListener('input', updateDeckNameCount);
      dnInput.addEventListener('focus', updateDeckNameCount);
      // Also refresh when the deck modal opens (title may change)
      const deckModal = document.getElementById('deckModal');
      if (deckModal) {
        new MutationObserver(updateDeckNameCount).observe(deckModal, {
          attributes: true, attributeFilter: ['class'],
        });
      }
      updateDeckNameCount();
    }
  
    // ── Settings sheet rows: navigate to matching section ──────────────────────
    document.querySelectorAll('.settings-sheet-row[data-settings-section]').forEach(function (row) {
      row.addEventListener('click', function () {
        const section = row.dataset.settingsSection;
        // analytics / calendar / heatmap / import → switch section directly
        if (['analytics', 'calendar', 'heatmap', 'import'].includes(section)) {
          closeSettingsSheet();
          const sidebarBtn = document.querySelector(
            '.sidebar .nav-item[data-section="' + section + '"]'
          );
          if (sidebarBtn) sidebarBtn.click();
          return;
        }
        // Everything else → go to settings section (scroll-to-card handled by settings.js)
        closeSettingsSheet();
        const sidebarBtn = document.querySelector('.sidebar .nav-item[data-section="settings"]');
        if (sidebarBtn) sidebarBtn.click();
      });
    });
  
    // ── Classrooms: identity sync + navigation ──────────────────────────────────
    // Reads the user's display name from Mnemo's own settings key so that
    // classroom pages show the real name instead of "Guest Learner".
    function goToClassrooms() {
      try {
        const CR_USER = 'mnemo_cr_user_v1';
        let existing = null;
        try { existing = JSON.parse(localStorage.getItem(CR_USER) || 'null'); } catch {}
        if (!existing || existing.name === 'Guest Learner') {
          let s = {};
          try { s = JSON.parse(localStorage.getItem('mnemoSettings') || '{}'); } catch {}
          const name = s.userName || s.name || null;
          if (name) {
            const u = existing || {
              id: 'u_' + Math.random().toString(36).slice(2, 9),
              email: 'local@mnemo.app',
            };
            u.name = name;
            localStorage.setItem(CR_USER, JSON.stringify(u));
          }
        }
      } catch {}
      location.href = 'app.html';
    }
  
    document.getElementById('classroomsNavBtn')?.addEventListener('click', goToClassrooms);
    document.getElementById('mobClassroomsBtn')?.addEventListener('click', goToClassrooms);
    document.getElementById('sdClassroomsRow')?.addEventListener('click', function () {
      closeSideDrawer();
      goToClassrooms();
    });
  
  
    // ── Swipe gestures for flashcard & session cards ─────────────────────────────
    (function initSwipeGestures() {
      const SWIPE_THRESHOLD   = 52;   // px horizontal to register a swipe
      const SWIPE_REJECT_Y    = 80;   // abort if vertical drag exceeds this
      const DRAG_RESIST       = 0.55; // rubber-band resistance
      const ANIM_DURATION_MS  = 280;
      const ANIM_EASING       = 'cubic-bezier(0.22, 1, 0.36, 1)';
  
      // Inject CSS once
      const styleId = 'mnemo-swipe-styles';
      if (!document.getElementById(styleId)) {
        const s = document.createElement('style');
        s.id = styleId;
        s.textContent = `
          /* ── Swipe card container ────────────────────────────────── */
          .fc-card,
          .sess-card {
            touch-action: pan-y;
            user-select: none;
            will-change: transform, opacity;
            overflow: hidden;
          }
  
          /* ── Hint arrows that appear during swipe ───────────────── */
          .swipe-hint {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            border-radius: 999px;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.12s ease;
            backdrop-filter: blur(8px);
            white-space: nowrap;
            z-index: 4;
          }
          .swipe-hint--prev {
            left: 12px;
            background: rgba(var(--acc-rgb, 155 111 212) / 0.18);
            color: var(--acc);
            border: 1px solid rgba(var(--acc-rgb, 155 111 212) / 0.30);
          }
          .swipe-hint--next {
            right: 12px;
            background: rgba(var(--acc-rgb, 155 111 212) / 0.18);
            color: var(--acc);
            border: 1px solid rgba(var(--acc-rgb, 155 111 212) / 0.30);
          }
          .swipe-hint--active { opacity: 1 !important; }
  
          /* ── Exit animation classes ─────────────────────────────── */
          .swipe-exit-left {
            animation: swipeExitLeft var(--swipe-dur, 280ms) cubic-bezier(0.4,0,1,1) forwards;
          }
          .swipe-exit-right {
            animation: swipeExitRight var(--swipe-dur, 280ms) cubic-bezier(0.4,0,1,1) forwards;
          }
          .swipe-enter-left {
            animation: swipeEnterFromRight var(--swipe-dur, 280ms) cubic-bezier(0.22,1,0.36,1) forwards;
          }
          .swipe-enter-right {
            animation: swipeEnterFromLeft var(--swipe-dur, 280ms) cubic-bezier(0.22,1,0.36,1) forwards;
          }
  
          @keyframes swipeExitLeft  { to { transform: translateX(-110%) rotate(-3deg); opacity: 0; } }
          @keyframes swipeExitRight { to { transform: translateX(110%)  rotate(3deg);  opacity: 0; } }
          @keyframes swipeEnterFromRight { from { transform: translateX(60%);  opacity: 0; } to { transform: translateX(0); opacity: 1; } }
          @keyframes swipeEnterFromLeft  { from { transform: translateX(-60%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        `;
        document.head.appendChild(s);
      }
  
      function attachSwipe(cardEl, getPrevBtn, getNextBtn) {
        if (!cardEl) return;
  
        // Add hint elements
        const hintPrev = document.createElement('div');
        hintPrev.className = 'swipe-hint swipe-hint--prev';
        hintPrev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Prev';
  
        const hintNext = document.createElement('div');
        hintNext.className = 'swipe-hint swipe-hint--next';
        hintNext.innerHTML = 'Next<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  
        // Insert into parent so they sit over the card
        const wrap = cardEl.parentElement;
        if (wrap) {
          wrap.style.position = wrap.style.position || 'relative';
          wrap.appendChild(hintPrev);
          wrap.appendChild(hintNext);
        }
  
        let startX = 0, startY = 0, curX = 0, tracking = false, aborted = false;
  
        cardEl.addEventListener('touchstart', function (e) {
          // Only single touch
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          startX = t.clientX;
          startY = t.clientY;
          curX = 0;
          tracking = true;
          aborted = false;
          cardEl.style.transition = 'none';
        }, { passive: true });
  
        cardEl.addEventListener('touchmove', function (e) {
          if (!tracking || aborted) return;
          const t = e.touches[0];
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
  
          // Abort on strong vertical scroll
          if (Math.abs(dy) > SWIPE_REJECT_Y && Math.abs(dy) > Math.abs(dx)) {
            aborted = true;
            cardEl.style.transform = '';
            hintPrev.classList.remove('swipe-hint--active');
            hintNext.classList.remove('swipe-hint--active');
            return;
          }
  
          curX = dx;
          const clamped = dx * DRAG_RESIST;
          const tilt = clamped * 0.02; // subtle rotation
          cardEl.style.transform = `translateX(${clamped}px) rotate(${tilt}deg)`;
          cardEl.style.opacity = String(1 - Math.min(Math.abs(clamped) / 320, 0.25));
  
          // Show directional hints
          if (dx < -20) {
            hintNext.classList.add('swipe-hint--active');
            hintPrev.classList.remove('swipe-hint--active');
          } else if (dx > 20) {
            hintPrev.classList.add('swipe-hint--active');
            hintNext.classList.remove('swipe-hint--active');
          } else {
            hintPrev.classList.remove('swipe-hint--active');
            hintNext.classList.remove('swipe-hint--active');
          }
        }, { passive: true });
  
        cardEl.addEventListener('touchend', function () {
          if (!tracking) return;
          tracking = false;
          hintPrev.classList.remove('swipe-hint--active');
          hintNext.classList.remove('swipe-hint--active');
  
          if (aborted || Math.abs(curX) < SWIPE_THRESHOLD) {
            // Snap back
            cardEl.style.transition = `transform ${ANIM_DURATION_MS}ms ${ANIM_EASING}, opacity ${ANIM_DURATION_MS}ms ease`;
            cardEl.style.transform = '';
            cardEl.style.opacity = '';
            return;
          }
  
          // Commit swipe
          cardEl.style.transition = '';
          cardEl.style.cssText += `--swipe-dur: ${ANIM_DURATION_MS}ms;`;
  
          if (curX < 0) {
            // Swipe left → next card
            cardEl.classList.add('swipe-exit-left');
            setTimeout(function () {
              cardEl.classList.remove('swipe-exit-left');
              cardEl.style.transform = '';
              cardEl.style.opacity = '';
              const btn = getNextBtn();
              if (btn && !btn.disabled) {
                btn.click();
                // Brief enter animation on the refreshed card
                requestAnimationFrame(function () {
                  cardEl.classList.add('swipe-enter-left');
                  setTimeout(function () { cardEl.classList.remove('swipe-enter-left'); }, ANIM_DURATION_MS + 40);
                });
              }
            }, ANIM_DURATION_MS);
          } else {
            // Swipe right → prev card
            cardEl.classList.add('swipe-exit-right');
            setTimeout(function () {
              cardEl.classList.remove('swipe-exit-right');
              cardEl.style.transform = '';
              cardEl.style.opacity = '';
              const btn = getPrevBtn();
              if (btn && !btn.disabled) {
                btn.click();
                requestAnimationFrame(function () {
                  cardEl.classList.add('swipe-enter-right');
                  setTimeout(function () { cardEl.classList.remove('swipe-enter-right'); }, ANIM_DURATION_MS + 40);
                });
              }
            }, ANIM_DURATION_MS);
          }
        });
  
        cardEl.addEventListener('touchcancel', function () {
          tracking = false;
          cardEl.style.transition = `transform ${ANIM_DURATION_MS}ms ${ANIM_EASING}, opacity ${ANIM_DURATION_MS}ms ease`;
          cardEl.style.transform = '';
          cardEl.style.opacity = '';
          hintPrev.classList.remove('swipe-hint--active');
          hintNext.classList.remove('swipe-hint--active');
        });
      }
  
      // Wire up after DOM is ready (other scripts may create these elements)
      function wireCards() {
        const fcCard   = document.getElementById('fcCard');
        const sessCard = document.getElementById('sessCard');
  
        if (fcCard && !fcCard.dataset.swipeAttached) {
          fcCard.dataset.swipeAttached = '1';
          attachSwipe(
            fcCard,
            function () { return document.getElementById('fcPrevBtn'); },
            function () { return document.getElementById('fcNavNextBtn'); }
          );
        }
        if (sessCard && !sessCard.dataset.swipeAttached) {
          sessCard.dataset.swipeAttached = '1';
          attachSwipe(
            sessCard,
            function () { return document.getElementById('sessPrevBtn'); },
            function () { return document.getElementById('sessNavNextBtn'); }
          );
        }
      }
  
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireCards);
      } else {
        wireCards();
      }
    })();
  
  
    const moreStatsToggle  = document.getElementById('moreStatsToggle');
    const moreStatsPanel   = document.getElementById('moreStatsPanel');
    const moreStatsChevron = document.getElementById('moreStatsChevron');
    if (moreStatsToggle && moreStatsPanel) {
      moreStatsToggle.addEventListener('click', function () {
        const isHidden = moreStatsPanel.classList.contains('hidden');
        moreStatsPanel.classList.toggle('hidden');
        moreStatsToggle.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
        if (moreStatsChevron) moreStatsChevron.textContent = isHidden ? '▾' : '▸';
      });
    }
  
    // ── Sticky Start Review mirrors startSessionBtn ─────────────────────────────
    document.getElementById('startSessionBtn2')?.addEventListener('click', function () {
      if (typeof startSession === 'function') startSession();
    });
  
    // ── Calendar drawer: open on date-cell tap (mobile) ────────────────────────
    const calDrawerOverlay = document.getElementById('calDrawerOverlay');
    const calSidePanel     = document.getElementById('calSidePanel');
  
    function openCalDrawer() {
      if (!calSidePanel || !calDrawerOverlay) return;
      if (window.innerWidth > 900) return; // desktop: panel is always visible inline
      calSidePanel.classList.add('drawer-mode', 'open');
      calDrawerOverlay.classList.add('active');
      calDrawerOverlay.removeAttribute('aria-hidden');
    }
    function closeCalDrawer() {
      if (!calSidePanel || !calDrawerOverlay) return;
      calSidePanel.classList.remove('open');
      calDrawerOverlay.classList.remove('active');
      calDrawerOverlay.setAttribute('aria-hidden', 'true');
      // Remove drawer-mode after transition so desktop layout still works
      setTimeout(function () {
        if (window.innerWidth <= 900) return;
        calSidePanel.classList.remove('drawer-mode');
      }, 400);
    }
  
    if (calDrawerOverlay) calDrawerOverlay.addEventListener('click', closeCalDrawer);
  
    // Expose so calender.js can call openCalDrawer() on cell click
    window.openCalDrawer  = openCalDrawer;
    window.closeCalDrawer = closeCalDrawer;
  
    // Reset drawer state when crossing the 900px breakpoint (debounced to prevent layout thrashing)
    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!calSidePanel) return;
        if (window.innerWidth > 900) {
          calSidePanel.classList.remove('drawer-mode', 'open');
          if (calDrawerOverlay) {
            calDrawerOverlay.classList.remove('active');
            calDrawerOverlay.setAttribute('aria-hidden', 'true');
          }
        }
      }, 100);
    });
  
  })();