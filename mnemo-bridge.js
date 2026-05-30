/* ============================================================================
   mnemo-bridge.js — Classroom ↔ Mnemo Core Integration
   ============================================================================ */

   (function () {
    'use strict';
  
    let initialized = false;
  
    function initBridge() {
      if (initialized) return;
      if (!window.state || !window.MockAPI) {
        console.log('[Mnemo Bridge] Waiting for dependencies...');
        return;
      }
      initialized = true;
      console.log('[Mnemo Bridge] Initializing classroom integration');
  
      // Classroom integration - now uses separate classroom.html file
      // addClassroomToSidebar();
      // addClassroomToMobileDrawer();

      if (typeof SECTION_RENDERERS !== 'undefined') {
        SECTION_RENDERERS.classrooms = () => {
          // Show the static classroom section content
          const section = document.getElementById('section-classrooms');
          if (section) {
            section.classList.remove('hidden');
            section.classList.add('active');
          }
        };
      }
  
      syncUserIdentity();
      addClassroomStatsToToday();
  
      console.log('[Mnemo Bridge] Classroom integration ready');
    }
  
    function addClassroomToSidebar() {
      const sidebar = document.getElementById('sidebarNav');
      if (!sidebar) return;
      if (document.querySelector('.nav-item[data-section="classrooms"]')) return;
  
      const simpleNavGroup = document.getElementById('simpleNavGroup');
      if (!simpleNavGroup) return;
  
      const classroomNav = document.createElement('button');
      classroomNav.className = 'nav-item';
      classroomNav.dataset.section = 'classrooms';
      classroomNav.setAttribute('aria-label', 'Classrooms');
      classroomNav.innerHTML = `
        <span class="ni-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </span>
        <span class="ni-label">Classrooms</span>
        <span class="ni-badge hidden" id="classroomBadge">0</span>
      `;
  
      const journalNav = simpleNavGroup.querySelector('[data-section="journal"]');
      if (journalNav && journalNav.nextSibling) {
        simpleNavGroup.insertBefore(classroomNav, journalNav.nextSibling);
      } else {
        simpleNavGroup.appendChild(classroomNav);
      }
  
      classroomNav.addEventListener('click', () => switchToClassroomsView());
    }
  
    function addClassroomToMobileDrawer() {
      const drawerBody = document.querySelector('.side-drawer-body');
      if (!drawerBody) return;
      if (drawerBody.querySelector('[data-drawer-section="classrooms"]')) return;
  
      const classroomsRow = document.createElement('button');
      classroomsRow.className = 'sd-row';
      classroomsRow.dataset.drawerSection = 'classrooms';
      classroomsRow.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <span>Classrooms</span>
      `;
  
      const calendarRow = drawerBody.querySelector('[data-drawer-section="calendar"]');
      if (calendarRow && calendarRow.nextSibling) {
        drawerBody.insertBefore(classroomsRow, calendarRow.nextSibling);
      } else {
        drawerBody.appendChild(classroomsRow);
      }
  
      classroomsRow.addEventListener('click', () => {
        if (typeof window.closeSideDrawer === 'function') window.closeSideDrawer();
        switchToClassroomsView();
      });
    }
  
    function switchToClassroomsView() {
      let container = document.getElementById('classrooms-root');
  
      if (!container) {
        container = document.createElement('div');
        container.id = 'classrooms-root';
        container.className = 'section';
        container.style.cssText = 'display:block; padding:0; min-height:100vh; background:var(--bg);';
        document.getElementById('mainContent').appendChild(container);
      }
  
      document.querySelectorAll('.section').forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active');
      });
      container.classList.remove('hidden');
      container.classList.add('active');
  
      loadClassroomsContent(container);
    }
  
    function loadClassroomsContent(container) {
      if (container.dataset.loaded === '1') return;

      const me = CR.currentUser();
      if (!me) return;

      const classrooms = MockAPI.listClassrooms();

      container.innerHTML = `
        <div class="cr-main">
          <h1 class="cr-h1">Your Classrooms</h1>
          <p class="cr-sub" id="welcomeSub">Welcome back, ${me.name}.</p>
          <div class="cr-grid cr-list" id="grid"></div>
        </div>
      `;

      const grid = container.querySelector('#grid');
      if (grid) {
        if (!classrooms.length) {
          grid.innerHTML = `<div class="cr-empty">You haven't joined any classrooms yet.
            <div style="margin-top:14px"><button class="btn primary" id="createFirstClassroomBtn">Create your first</button></div></div>`;
          container.querySelector('#createFirstClassroomBtn')?.addEventListener('click', () => {
            renderCreateClassroomView(container);
          });
        } else {
          grid.innerHTML = classrooms.map(c => `
            <div class="cr-list-card" data-classroom-id="${c.id}">
              <h3>${CR.esc(c.name)}</h3>
              <p class="desc">${CR.esc(c.desc || '')}</p>
              <div class="stats">
                <span>${c.memberCount} member${c.memberCount === 1 ? '' : 's'}</span>
                <span>${c.mode === 'admin' ? 'Teacher-led' : 'Peer pod'}</span>
                <span>Active ${CR.timeAgo(c.lastActive || c.createdAt)}</span>
              </div>
            </div>
          `).join('');

          grid.querySelectorAll('.cr-list-card').forEach(card => {
            card.addEventListener('click', () => {
              const id = card.dataset.classroomId;
              navigateToClassroom(id);
            });
          });
        }
      }

      container.dataset.loaded = '1';
    }
  
    function reinitializeClassroomScripts(container) {
      const classrooms = MockAPI.listClassrooms();
      const me = CR.currentUser();
  
      const welcomeSub = container.querySelector('#welcomeSub');
      if (welcomeSub) welcomeSub.textContent = `Welcome back, ${me.name}.`;
  
      const grid = container.querySelector('#grid');
      if (grid) {
        if (!classrooms.length) {
          grid.innerHTML = `<div class="cr-empty">You haven't joined any classrooms yet.
            <div style="margin-top:14px"><button class="btn primary" id="createFirstClassroomBtn">Create your first</button></div></div>`;
          container.querySelector('#createFirstClassroomBtn')?.addEventListener('click', () => {
            renderCreateClassroomView(container);
          });
        } else {
          grid.innerHTML = classrooms.map(c => `
            <div class="cr-list-card" data-classroom-id="${c.id}">
              <h3>${CR.esc(c.name)}</h3>
              <p class="desc">${CR.esc(c.desc || '')}</p>
              <div class="stats">
                <span>${c.memberCount} member${c.memberCount === 1 ? '' : 's'}</span>
                <span>${c.mode === 'admin' ? 'Teacher-led' : 'Peer pod'}</span>
                <span>Active ${CR.timeAgo(c.lastActive || c.createdAt)}</span>
              </div>
            </div>
          `).join('');
  
          grid.querySelectorAll('.cr-list-card').forEach(card => {
            card.addEventListener('click', () => {
              const id = card.dataset.classroomId;
              navigateToClassroom(id);
            });
          });
        }
      }
  
      updateClassroomBadge(classrooms.length);
    }
  
    function navigateToClassroom(classroomId) {
      const classroom = MockAPI.getClassroom(classroomId);
      if (!classroom) return;

      const container = document.getElementById('classrooms-root');
      if (!container) return;

      const me = CR.currentUser();
      const members = MockAPI.getMembers(classroomId);
      const painPoints = MockAPI.getPainPoints(classroomId);

      container.innerHTML = `
        <div class="cr-shell">
          <aside class="cr-side">
            <h2>${CR.esc(classroom.name)}</h2>
            <div class="cr-meta">${CR.esc(classroom.desc || '')}</div>
            <div class="cr-role">${classroom.mode === 'admin' ? 'Teacher' : 'Member'}</div>
            <nav class="cr-nav">
              <a href="#" class="active">Dashboard</a>
              <a href="#">Decks</a>
              <a href="#">Members</a>
              <a href="#">Settings</a>
            </nav>
            <div class="cr-side-foot">
              <button class="cr-leave" id="btnLeaveClassroom">Leave classroom</button>
            </div>
          </aside>
          <main class="cr-main">
            <h1 class="cr-h1">Dashboard</h1>
            <p class="cr-sub">Overview of classroom activity</p>
            <div class="cr-grid cr-grid-2">
              <div class="cr-card">
                <h3>Invite <span class="hint">${members.length} / ${classroom.memberLimit}</span></h3>
                <div class="invite-box"><code>${classroom.inviteCode}</code><button class="btn sm" id="copyCode">Copy link</button></div>
              </div>
              <div class="cr-card"><h3>Assign a deck</h3><button class="btn primary" id="openAssignDeck">+ Assign deck</button></div>
            </div>
            <div class="cr-card"><h3>Students <span class="hint">${members.length}</span></h3>${CR.renderStudentTable(members)}</div>
            <div class="cr-card"><h3>Top pain points <span class="hint">last 7 days</span></h3>${CR.renderPainPoints(painPoints)}</div>
          </main>
        </div>
      `;

      container.querySelector('#copyCode')?.addEventListener('click', () => {
        navigator.clipboard.writeText(`${location.origin}/app.html?classroom=${classroomId}`);
        CR.toast('Invite link copied');
      });

      container.querySelector('#openAssignDeck')?.addEventListener('click', () => {
        const deckName = prompt('Enter deck name to assign:');
        if (deckName) {
          MockAPI.assignDeck(classroomId, deckName, new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
          CR.toast(`Deck "${deckName}" assigned`);
          navigateToClassroom(classroomId);
        }
      });

      container.querySelector('#btnLeaveClassroom')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to leave this classroom?')) {
          MockAPI.leaveClassroom(classroomId, me.id);
          CR.toast('Left classroom');
          loadClassroomsContent(container);
        }
      });
    }

    // Expose functions globally for use by app.html
    window.navigateToClassroom = navigateToClassroom;
    window.switchToClassroomsView = switchToClassroomsView;
    window.renderClassroomsSection = renderClassroomsSection;
    window.renderCreateClassroomView = renderCreateClassroomView;
    window.renderJoinClassroomView = renderJoinClassroomView;
  
    function initializeClassroomUI(container, classroomId) {
      const c = MockAPI.getClassroom(classroomId);
      if (!c) return;
  
      const me = CR.currentUser();
  
      container.querySelector('#crName').textContent = c.name;
      container.querySelector('#crMeta').textContent =
        `${c.memberCount} member${c.memberCount === 1 ? '' : 's'} · ${c.mode === 'admin' ? 'Teacher-led' : 'Peer pod'}`;
      container.querySelector('#crRole').textContent = c.myRole || 'member';
  
      if (c.ownerId === me.id) {
        const navSettings = container.querySelector('#navSettings');
        if (navSettings) navSettings.style.display = 'block';
      }
  
      container.querySelector('#leaveBtn')?.addEventListener('click', () => {
        if (confirm('Leave this classroom?')) {
          MockAPI.leave(classroomId);
          switchToClassroomsView();
        }
      });

      container.querySelector('#exitModeBtn')?.addEventListener('click', () => {
        switchToClassroomsView();
      });
  
      const backBtn = container.querySelector('.btn.ghost.sm');
      if (backBtn) {
        backBtn.addEventListener('click', (e) => {
          e.preventDefault();
          switchToClassroomsView();
        });
      }
  
      container.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.modal-back').forEach(m => m.classList.remove('open'));
        });
      });
  
      container.querySelectorAll('.modal-back').forEach(modal => {
        modal.addEventListener('click', e => {
          if (e.target === modal) modal.classList.remove('open');
        });
      });
  
      const dashboardTab = container.querySelector('#tabDashboard');
      if (dashboardTab) renderClassroomDashboard(dashboardTab, c);
    }
  
    function renderClassroomDashboard(host, c) {
      const me = CR.currentUser();
      const painPoints = MockAPI.getPainPoints(c.id);
  
      if (c.mode === 'admin' && (c.myRole === 'teacher' || c.ownerId === me.id)) {
        renderTeacherDashboard(host, c, painPoints);
      } else if (c.mode === 'admin') {
        renderStudentDashboard(host, c);
      } else {
        renderP2PDashboard(host, c, painPoints);
      }
    }
  
    function renderTeacherDashboard(host, c, painPoints) {
      const members = MockAPI.getMembers(c.id).filter(m => m.role !== 'teacher');
      host.innerHTML = `
        <h1 class="cr-h1">Teacher Dashboard</h1>
        <p class="cr-sub">Monitor progress, identify pain points, and assign decks.</p>
        <div class="cr-grid cr-grid-2">
          <div class="cr-card">
            <h3>Invite <span class="hint">${members.length} / ${c.memberLimit}</span></h3>
            <div class="invite-box"><code>${c.inviteCode}</code><button class="btn sm" id="copyCode">Copy link</button></div>
          </div>
          <div class="cr-card"><h3>Assign a deck</h3><button class="btn primary" id="openAssignDeck">+ Assign deck</button></div>
        </div>
        <div class="cr-card"><h3>Students <span class="hint">${members.length}</span></h3>${CR.renderStudentTable(members)}</div>
        <div class="cr-card"><h3>Top pain points <span class="hint">last 7 days</span></h3>${CR.renderPainPoints(painPoints)}</div>
      `;
  
      host.querySelector('#copyCode')?.addEventListener('click', () => {
        navigator.clipboard.writeText(`${location.origin}/app.html?classroom=${classroomId}`);
        CR.toast('Invite link copied');
      });
  
      host.querySelector('#openAssignDeck')?.addEventListener('click', () => {
        const deckName = prompt('Enter deck name to assign:');
        if (deckName) {
          MockAPI.assignDeck(c.id, deckName, new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
          CR.toast(`Deck "${deckName}" assigned`);
          renderTeacherDashboard(host, c, painPoints);
        }
      });
    }
  
    function renderStudentDashboard(host, c) {
      const { mine, classAvg } = MockAPI.getMyStats(c.id);
      const lb = MockAPI.getLeaderboard(c.id);
      const decks = MockAPI.getDecks(c.id);
      const myMax = Math.max(mine.reviewed, classAvg, 1);
  
      host.innerHTML = `
        <h1 class="cr-h1">Your Progress</h1>
        <div class="cr-grid cr-grid-2">
          <div class="cr-card">
            <h3>You vs. class average</h3>
            <div class="cr-progress"><div class="cr-progress-lbl"><span>You</span><span>${mine.reviewed} cards</span></div>
            <div class="cr-progress-bar"><div class="cr-progress-fill" style="width:${mine.reviewed / myMax * 100}%"></div></div></div>
            <div class="cr-progress"><div class="cr-progress-lbl"><span>Class average</span><span>${classAvg} cards</span></div>
            <div class="cr-progress-bar"><div class="cr-progress-fill alt" style="width:${classAvg / myMax * 100}%"></div></div></div>
          </div>
          <div class="cr-card"><h3>Weekly leaderboard</h3><div id="lbBox">${CR.renderLeaderboard(lb, me.id)}</div></div>
        </div>
        <div class="cr-card"><h3>Assigned decks</h3>${CR.renderDeckList(decks)}</div>
      `;
    }
  
    function renderP2PDashboard(host, c, painPoints) {
      const members = MockAPI.getMembers(c.id);
      const decks = MockAPI.getDecks(c.id);
  
      host.innerHTML = `
        <h1 class="cr-h1">Peer Pod</h1>
        <div class="cr-grid cr-grid-2">
          <div class="cr-card"><h3>Shared decks <button class="btn sm primary" id="proposeDeck">+ Propose</button></h3>
          <div id="propBox">${CR.renderProposals(c.id, decks)}</div></div>
          <div class="cr-card"><h3>Pod pain points</h3>${CR.renderPainPoints(painPoints)}</div>
        </div>
        <div class="cr-card"><h3>Members <span class="hint">${members.length}</span></h3>
        <div class="cr-grid cr-grid-2">${CR.renderMemberCards(members, me.id)}</div></div>
      `;
  
      host.querySelector('#proposeDeck')?.addEventListener('click', () => {
        const name = prompt('Deck name to propose:');
        if (name) {
          MockAPI.assignDeck(c.id, name, '');
          const store = JSON.parse(localStorage.getItem(CR_KEY));
          const last = store.decks[c.id][store.decks[c.id].length - 1];
          last.proposalStatus = 'voting';
          last.votesUp = 0;
          last.votesDown = 0;
          localStorage.setItem(CR_KEY, JSON.stringify(store));
          CR.toast('Proposal submitted');
          renderP2PDashboard(host, c, painPoints);
        }
      });
    }
  
    function renderClassroomsSection() {
      // Don't auto-load classrooms, show "Enter classroom mode" state
      // The user must click "Enter Classroom Mode" button first
    }

    function renderCreateClassroomView(container) {
      if (!container) {
        container = document.getElementById('classrooms-root');
        if (!container) return;
      }

      container.innerHTML = `
        <div class="center-page">
          <div class="modal">
            <div class="ai-hero" style="margin-bottom: 24px; padding: 32px 28px;">
              <div class="ai-hero-inner">
                <div class="ai-hero-badge">Create</div>
                <h1 class="ai-hero-title">New Classroom</h1>
                <p class="ai-hero-sub">Set up your learning space and invite others to join</p>
              </div>
            </div>
            <form id="createForm">
              <div class="form-group">
                <label for="cName">Classroom Name</label>
                <input id="cName" required maxlength="60" placeholder="e.g. Anatomy Cohort 2026">
                <div class="input-hint">Choose a clear, memorable name for your classroom</div>
              </div>
              <div class="form-group">
                <label for="cDesc">Description</label>
                <textarea id="cDesc" rows="3" maxlength="200" placeholder="What this classroom is for..."></textarea>
                <div class="input-hint">Briefly describe the purpose of this classroom</div>
              </div>
              <div class="form-group">
                <label>Classroom Mode</label>
                <div class="ai-feature-grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
                  <div class="ai-feat-card mode-option" data-mode="admin">
                    <div class="ai-feat-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                      </svg>
                    </div>
                    <div class="ai-feat-title">Teacher-led</div>
                    <div class="ai-feat-desc">You assign decks and track student progress</div>
                    <div class="mode-radio">
                      <input type="radio" name="mode" value="admin" checked>
                      <span class="radio-indicator"></span>
                    </div>
                  </div>
                  <div class="ai-feat-card mode-option" data-mode="p2p">
                    <div class="ai-feat-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    </div>
                    <div class="ai-feat-title">Peer Pod</div>
                    <div class="ai-feat-desc">Members share decks and vote on proposals</div>
                    <div class="mode-radio">
                      <input type="radio" name="mode" value="p2p">
                      <span class="radio-indicator"></span>
                    </div>
                  </div>
                </div>
                <input type="hidden" id="cMode" value="admin">
              </div>
              <div class="modal-actions">
                <button class="btn btn-secondary" type="button" id="btnCancelCreate">Cancel</button>
                <button class="btn btn-primary ai-cta" type="submit">Create Classroom</button>
              </div>
            </form>
          </div>
        </div>
      `;

      // Mode selection handlers
      container.querySelectorAll('.mode-option').forEach(option => {
        option.addEventListener('click', () => {
          const mode = option.dataset.mode;
          container.querySelectorAll('.mode-option').forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          container.querySelector('#cMode').value = mode;
          option.querySelector('input[type="radio"]').checked = true;
        });
      });

      // Initialize first mode as selected
      container.querySelector('.mode-option[data-mode="admin"]').classList.add('selected');

      // Cancel button
      container.querySelector('#btnCancelCreate')?.addEventListener('click', () => {
        loadClassroomsContent(container);
      });

      // Form submission
      container.querySelector('#createForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = MockAPI.createClassroom({
          name: document.getElementById('cName').value.trim(),
          desc: document.getElementById('cDesc').value.trim(),
          mode: document.getElementById('cMode').value,
        });
        CR.toast('Classroom created');
        loadClassroomsContent(container);
      });
    }

    function renderJoinClassroomView(container) {
      if (!container) {
        container = document.getElementById('classrooms-root');
        if (!container) return;
      }

      container.innerHTML = `
        <div class="center-page">
          <div class="modal">
            <div class="ai-hero" style="margin-bottom: 24px; padding: 32px 28px;">
              <div class="ai-hero-inner">
                <div class="ai-hero-badge">Join</div>
                <h1 class="ai-hero-title">Join a Classroom</h1>
                <p class="ai-hero-sub">Enter the invite code to join an existing classroom</p>
              </div>
            </div>
            <form id="joinForm">
              <div class="form-group">
                <label for="jCode">Invite Code</label>
                <input id="jCode" required placeholder="e.g. ABC123">
                <div class="input-hint">Enter the code shared by your teacher or classmates</div>
              </div>
              <div class="modal-actions">
                <button class="btn btn-secondary" type="button" id="btnCancelJoin">Cancel</button>
                <button class="btn btn-primary ai-cta" type="submit">Join Classroom</button>
              </div>
            </form>
          </div>
        </div>
      `;

      // Cancel button
      container.querySelector('#btnCancelJoin')?.addEventListener('click', () => {
        loadClassroomsContent(container);
      });

      // Form submission
      container.querySelector('#joinForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('jCode').value.trim();
        const classroom = MockAPI.getClassroomByCode(code);
        if (classroom) {
          MockAPI.joinClassroom(classroom.id, CR.currentUser().id);
          CR.toast('Joined classroom');
          loadClassroomsContent(container);
        } else {
          CR.toast('Invalid invite code');
        }
      });
    }
  
    function syncUserIdentity() {
      try {
        const stored = localStorage.getItem(CR_USER);
        let existing = stored ? JSON.parse(stored) : null;
  
        if (!existing || existing.name === 'Guest Learner') {
          const userName = state.settings?.userName || localStorage.getItem('mnemo_user_name') || null;
          if (userName) {
            const user = existing || {
              id: 'u_' + Math.random().toString(36).slice(2, 9),
              email: 'local@mnemo.app',
            };
            user.name = userName;
            localStorage.setItem(CR_USER, JSON.stringify(user));
            console.log('[Mnemo Bridge] Synced user identity:', userName);
          }
        }
      } catch (e) {
        console.warn('[Mnemo Bridge] User sync failed:', e);
      }
    }
  
    function addClassroomStatsToToday() {
      const todaySection = document.getElementById('section-today');
      if (!todaySection) return;
  
      const statsRow = todaySection.querySelector('.toc-stats-row');
      if (!statsRow || document.querySelector('.today-classroom-stat')) return;
  
      const classroomStat = document.createElement('div');
      classroomStat.className = 'toc-stat-box today-classroom-stat';
      classroomStat.innerHTML = `
        <div class="toc-stat-num" id="todayClassroomCount">0</div>
        <div class="toc-stat-label">🏫 Classrooms</div>
      `;
      statsRow.appendChild(classroomStat);
  
      updateClassroomStat();
  
      window.addEventListener('mnemo:classrooms-changed', () => updateClassroomStat());
    }
  
    function updateClassroomStat() {
      const count = MockAPI.listClassrooms().length;
      const el = document.getElementById('todayClassroomCount');
      if (el) el.textContent = count;
    }
  
    function updateClassroomBadge(count) {
      const badge = document.getElementById('classroomBadge');
      if (badge) {
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
      }
    }
  
    window.switchToClassroomsView = switchToClassroomsView;
    window.navigateToClassroom = navigateToClassroom;
    window.updateClassroomBadge = updateClassroomBadge;
  
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initBridge);
    } else {
      setTimeout(initBridge, 100);
    }
  })();