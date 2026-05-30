'use strict';

// ─── ESCAPE FUNCTION (ESCAPE_MAP and ESCAPE_REGEX already defined elsewhere) ──
const esc = (s) => s ? String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) : '';

/* ── Data ─────────────────────────────────────────────────────────────────── */
const CR_KEY  = 'mnemo_classrooms_v1';
const CR_USER = 'mnemo_cr_user_v1';

function currentUser() {
  let u = null;
  try { u = JSON.parse(localStorage.getItem(CR_USER) || 'null'); } catch {}
  if (!u) {
    u = { id:'u_'+Math.random().toString(36).slice(2,9), name:'Guest Learner', email:'guest@mnemo.app' };
    localStorage.setItem(CR_USER, JSON.stringify(u));
  }
  return u;
}
function loadStore() {
  try { return JSON.parse(localStorage.getItem(CR_KEY)) || seedStore(); }
  catch { return seedStore(); }
}
function saveStore(s) { localStorage.setItem(CR_KEY, JSON.stringify(s)); }
function dateOffset(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function seedStore() {
  const me = currentUser();
  const store = {
    classrooms:[
      { id:'cls_pharma', name:'Pharmacology Y3', desc:'Medical school cohort — weekly drug pharmacology decks.', mode:'admin', inviteCode:'PHARMA-2026', memberLimit:60, createdAt:Date.now()-86400000*14, ownerId:me.id },
      { id:'cls_pod',    name:'GRE Study Pod',   desc:'Flat peer pod sharing vocab + quant decks.',            mode:'p2p',   inviteCode:'GRE-POD-77',  memberLimit:12, createdAt:Date.now()-86400000*6,  ownerId:'u_friend1' },
    ],
    members:{
      cls_pharma:[
        { userId:me.id,    name:me.name,       role:'teacher', reviewed:412, retention:0.91, streak:12, lastActive:Date.now()-3600000 },
        { userId:'u_ana',  name:'Ana Müller',  role:'student', reviewed:380, retention:0.88, streak:9,  lastActive:Date.now()-7200000 },
        { userId:'u_raj',  name:'Raj Patel',   role:'student', reviewed:310, retention:0.74, streak:5,  lastActive:Date.now()-86400000 },
        { userId:'u_sue',  name:'Sue Lin',     role:'student', reviewed:295, retention:0.82, streak:7,  lastActive:Date.now()-14400000 },
        { userId:'u_marco',name:'Marco Costa', role:'student', reviewed:268, retention:0.69, streak:3,  lastActive:Date.now()-172800000 },
        { userId:'u_eli',  name:'Eli Bauer',   role:'student', reviewed:244, retention:0.85, streak:11, lastActive:Date.now()-1800000 },
      ],
      cls_pod:[
        { userId:'u_friend1',name:'Priya R.',role:'member',reviewed:510,retention:0.87,streak:21,lastActive:Date.now()-600000,   optIn:true },
        { userId:me.id,      name:me.name,   role:'member',reviewed:322,retention:0.79,streak:6, lastActive:Date.now(),           optIn:true },
        { userId:'u_tomas',  name:'Tomás G.',role:'member',reviewed:188,retention:0.71,streak:2, lastActive:Date.now()-7200000,   optIn:false },
      ],
    },
    decks:{
      cls_pharma:[
        { id:'d1', name:'Pharmacology Week 3 — Cardio', dueDate:dateOffset(3),  status:'prog', priority:'high',   completion:{done:4,prog:1,todo:1} },
        { id:'d2', name:'Antibiotics Mechanisms',       dueDate:dateOffset(7),  status:'prog', priority:'normal', completion:{done:1,prog:3,todo:2} },
        { id:'d3', name:'CNS Drugs Overview',           dueDate:dateOffset(-2), status:'done', priority:'normal', completion:{done:5,prog:1,todo:0} },
        { id:'d4', name:'Renal Pharmacology',           dueDate:null,           status:'todo', priority:'normal', completion:{done:0,prog:0,todo:6} },
      ],
      cls_pod:[
        { id:'pd1',name:'GRE High-Frequency Words', proposalStatus:'accepted', votesUp:3, votesDown:0 },
        { id:'pd2',name:'Quant Tricks — Geometry',  proposalStatus:'voting',   votesUp:2, votesDown:1 },
      ],
    },
    painPoints:{
      cls_pharma:[
        { q:'What is the mechanism of ACE inhibitors in reducing afterload?',                       fail:0.82, attempts:47, deck:'Pharmacology Week 3' },
        { q:'List the four classes of beta-blockers with selectivity profiles.',                    fail:0.74, attempts:39, deck:'Pharmacology Week 3' },
        { q:'Explain the difference between bactericidal and bacteriostatic antibiotics.',          fail:0.69, attempts:31, deck:'Antibiotics Mechanisms' },
        { q:'What is the half-life of digoxin and which factors prolong it?',                      fail:0.63, attempts:28, deck:'CNS Drugs Overview' },
        { q:'Describe the receptor selectivity of dobutamine vs dopamine.',                        fail:0.58, attempts:26, deck:'Pharmacology Week 3' },
      ],
      cls_pod:[
        { q:'Define "perspicacious" and use it in a sentence.',         fail:0.71, attempts:22, deck:'GRE High-Frequency Words' },
        { q:'What is the formula for the area of a regular hexagon?',   fail:0.65, attempts:18, deck:'Quant Tricks — Geometry' },
      ],
    },
    votes:{},
  };
  saveStore(store);
  return store;
}

/* ── Mock API ──────────────────────────────────────────────────────────────── */
const MockAPI = {
  listClassrooms() {
    const s = loadStore(), me = currentUser();
    return s.classrooms.map(c => {
      const members = s.members[c.id] || [];
      const mine = members.find(m => m.userId === me.id);
      return { ...c, memberCount:members.length, myRole:mine?.role||null, lastActive:members.reduce((max,m)=>Math.max(max,m.lastActive),0) };
    });
  },
  getClassroom(id) {
    const s = loadStore(), me = currentUser();
    const c = s.classrooms.find(x => x.id === id);
    if (!c) return null;
    const members = s.members[id] || [];
    const mine = members.find(m => m.userId === me.id);
    return { ...c, memberCount:members.length, myRole:mine?.role||'student' };
  },
  getMembers(id)    { return (loadStore().members[id]||[]); },
  getDecks(id)      { return (loadStore().decks[id]||[]); },
  getPainPoints(id) { return (loadStore().painPoints[id]||[]); },
  getLeaderboard(id){ return this.getMembers(id).slice().sort((a,b)=>b.reviewed-a.reviewed); },
  getStats(id) {
    const members = this.getMembers(id);
    if (!members.length) return { count:0, avgCards:0, avgRetention:0 };
    const avgCards = Math.round(members.reduce((a,m)=>a+m.reviewed,0)/members.length);
    const avgRetention = Math.round(members.reduce((a,m)=>a+m.retention,0)/members.length*100);
    return { count:members.length, avgCards, avgRetention };
  },
  createClassroom({name,desc,mode}) {
    const s = loadStore(), me = currentUser();
    const id = 'cls_'+Math.random().toString(36).slice(2,8);
    s.classrooms.push({ id,name,desc,mode,ownerId:me.id,
      inviteCode:name.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6)+'-'+Math.random().toString(36).slice(2,6).toUpperCase(),
      memberLimit:50, createdAt:Date.now() });
    s.members[id] = [{ userId:me.id,name:me.name,role:mode==='admin'?'teacher':'member',reviewed:0,retention:0,streak:0,lastActive:Date.now(),optIn:true }];
    s.decks[id]=[]; s.painPoints[id]=[];
    saveStore(s); return id;
  },
  joinByCode(code) {
    const s = loadStore(), me = currentUser();
    const c = s.classrooms.find(x => x.inviteCode.toUpperCase()===code.toUpperCase());
    if (!c) return null;
    const members = s.members[c.id]||(s.members[c.id]=[]);
    if (!members.find(m=>m.userId===me.id)) {
      members.push({ userId:me.id,name:me.name,role:c.mode==='admin'?'student':'member',reviewed:0,retention:0,streak:0,lastActive:Date.now(),optIn:true });
      saveStore(s);
    }
    return c.id;
  },
  leave(id) {
    const s = loadStore(), me = currentUser();
    s.members[id]=(s.members[id]||[]).filter(m=>m.userId!==me.id);
    saveStore(s);
  },
  assignDeck(classroomId,name,dueDate,priority='normal') {
    const s = loadStore();
    const list = s.decks[classroomId]||(s.decks[classroomId]=[]);
    list.push({ id:'d_'+Date.now(),name,dueDate:dueDate||null,status:'todo',priority,completion:{done:0,prog:0,todo:1} });
    saveStore(s);
  },
  updateDeadline(classroomId,deckId,newDate) {
    const s = loadStore();
    const deck = (s.decks[classroomId]||[]).find(d=>d.id===deckId);
    if (deck) { deck.dueDate = newDate||null; saveStore(s); return true; }
    return false;
  },
  updateDeck(classroomId, deckId, {status, priority, dueDate}) {
    const s = loadStore();
    const deck = (s.decks[classroomId]||[]).find(d=>d.id===deckId);
    if (!deck) return false;
    if (status   !== undefined) deck.status   = status;
    if (priority !== undefined) deck.priority = priority;
    if (dueDate  !== undefined) deck.dueDate  = dueDate||null;
    saveStore(s); return true;
  },
  removeDeck(classroomId, deckId) {
    const s = loadStore();
    if (!s.decks[classroomId]) return false;
    s.decks[classroomId] = s.decks[classroomId].filter(d=>d.id!==deckId);
    saveStore(s); return true;
  },
  vote(classroomId,deckId,dir) {
    const s = loadStore(), me = currentUser();
    const key = `${classroomId}:${deckId}`;
    if (!s.votes[key]) s.votes[key]={};
    const prev = s.votes[key][me.id];
    s.votes[key][me.id]=dir;
    const deck=(s.decks[classroomId]||[]).find(d=>d.id===deckId);
    if (deck) {
      if (prev==='up')   deck.votesUp  =Math.max(0,(deck.votesUp||0)-1);
      if (prev==='down') deck.votesDown=Math.max(0,(deck.votesDown||0)-1);
      if (dir==='up')    deck.votesUp  =(deck.votesUp||0)+1;
      if (dir==='down')  deck.votesDown=(deck.votesDown||0)+1;
    }
    saveStore(s); return s.votes[key][me.id];
  },
  myVote(classroomId,deckId) {
    const s = loadStore(), me = currentUser();
    return ((s.votes[`${classroomId}:${deckId}`])||{})[me.id]||null;
  },
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */
// esc is defined in script.js
function initials(n) { return (n||'?').split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase(); }
function timeAgo(ts) {
  const m=Math.floor((Date.now()-ts)/60000);
  if(m<1) return 'just now'; if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  return Math.floor(h/24)+'d ago';
}

function deadlineInfo(dateStr) {
  if (!dateStr) return { status:'no-date', label:'No deadline', daysLeft:null };
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(dateStr+'T00:00:00');
  const diff  = Math.round((due-today)/(1000*60*60*24));
  if (diff < 0)  return { status:'overdue', label:`${Math.abs(diff)}d overdue`, daysLeft:diff };
  if (diff === 0) return { status:'urgent',  label:'Due today', daysLeft:0 };
  if (diff <= 7)  return { status:'urgent',  label:`${diff}d left`, daysLeft:diff };
  return { status:'ok', label:`${diff}d left`, daysLeft:diff };
}

function deadlineChip(dateStr, deckStatus) {
  if (deckStatus === 'done') return `<span class="badge badge-green">Done</span>`;
  const {status,label} = deadlineInfo(dateStr);
  const svgIcons = {
    overdue:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    urgent:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    ok:`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    'no-date':`<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };
  return `<span class="deadline-chip ${status}">${svgIcons[status]} ${label}</span>`;
}

function priorityBadge(p) {
  if (p==='urgent') return `<span class="badge badge-rose">Urgent</span>`;
  if (p==='high')   return `<span class="badge badge-amber">High</span>`;
  return `<span class="badge badge-gray">Normal</span>`;
}

function statusBadge(s) {
  if (s==='done') return `<span class="badge badge-green">Done</span>`;
  if (s==='prog') return `<span class="badge badge-blue">In progress</span>`;
  return `<span class="badge badge-gray">Not started</span>`;
}

// Reads top-level (parent) decks only from Mnemo's main store.
function getMnemoDecks() {
  try {
    const raw = localStorage.getItem('mnemo_v6');
    if (!raw) return [];
    const data = JSON.parse(raw);
    const decks = Array.isArray(data.decks) ? data.decks : [];
    return decks
      .filter(d => d && d.name && !d.parentId && !d.isInbox)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(d => {
        // count total cards in this deck + its sub-decks
        const subIds = new Set(decks.filter(x => x.parentId === d.id).map(x => x.id));
        subIds.add(d.id);
        const cards = decks
          .filter(x => subIds.has(x.id))
          .reduce((n, x) => n + (Array.isArray(x.cards) ? x.cards.length : 0), 0);
        return { id: d.id, name: d.name, cards };
      });
  } catch { return []; }
}

let _assignSelectedDeck = null; // { name }

function populateAssignDeckSelect() {
  const list  = document.getElementById('aDeckPickerList');
  const hint  = document.getElementById('aDeckHint');
  const decks = getMnemoDecks();
  _assignSelectedDeck = null;
  document.getElementById('aDeckName').value = '';
  document.getElementById('btnDoAssign').disabled = true;

  if (!decks.length) {
    list.innerHTML = '';
    list.style.display = 'none';
    hint.style.display = '';
    return;
  }
  hint.style.display = 'none';
  list.style.display = '';

  const DECK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;

  list.innerHTML = decks.map((d, i) => `
    <div class="deck-picker-item" data-deck-name="${esc(d.name)}" data-idx="${i}" tabindex="0" role="radio" aria-checked="false">
      <div class="deck-picker-dot"></div>
      <div class="deck-picker-icon">${DECK_SVG}</div>
      <div class="deck-picker-name">${esc(d.name)}</div>
      <div class="deck-picker-count">${d.cards} card${d.cards !== 1 ? 's' : ''}</div>
    </div>`).join('');

  list.querySelectorAll('.deck-picker-item').forEach(item => {
    const select = () => {
      list.querySelectorAll('.deck-picker-item').forEach(x => {
        x.classList.remove('selected');
        x.setAttribute('aria-checked', 'false');
      });
      item.classList.add('selected');
      item.setAttribute('aria-checked', 'true');
      _assignSelectedDeck = { name: item.dataset.deckName };
      document.getElementById('aDeckName').value = item.dataset.deckName;
      document.getElementById('btnDoAssign').disabled = false;
    };
    item.addEventListener('click', select);
    item.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(); } });
  });
}

function toast(msg, warn=false) {
  const t=document.getElementById('toast');
  const dot=t.querySelector('.toast-dot');
  document.getElementById('toastMsg').textContent=msg;
  dot.className='toast-dot'+(warn?' warn':'');
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>t.classList.remove('show'),2800);
}

/* ── View / Tab management ─────────────────────────────────────────────────── */
function showView(id) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
}

let activeClassroomId = null;
let editingDeadlineDeckId = null;

function switchTab(tabName) {
  document.querySelectorAll('.tab-pane').forEach(p=>p.style.display='none');
  const tabEl = document.getElementById('tab-'+tabName);
  if (tabEl) tabEl.style.display='block';
  document.querySelectorAll('#sidebarNav .nav-item').forEach(n=>{
    n.classList.toggle('active',n.dataset.tab===tabName);
  });
  // Load tab content
  if (tabName==='decks')     renderDecksTab(activeClassroomId);
  if (tabName==='deadlines') renderDeadlinesTab(activeClassroomId);
  if (tabName==='members')   renderMembersTab(activeClassroomId);
  if (tabName==='settings')  renderSettingsTab(activeClassroomId);
}

/* ── Renderers ─────────────────────────────────────────────────────────────── */
function renderClassroomList() {
  const me = currentUser();
  document.getElementById('welcomeSub').textContent = me.name;

  const classrooms = MockAPI.listClassrooms();
  const grid = document.getElementById('classroomGrid');

  if (!classrooms.length) {
    grid.innerHTML=`<div class="empty" style="grid-column:1/-1">
      <div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
      <h3>No classrooms yet</h3>
      <p>Create or join a classroom to get started</p>
      <button class="btn btn-primary" style="margin-top:16px" onclick="showView('view-create')">Create your first</button>
    </div>`;
    document.getElementById('deadlinesSummary').style.display='none';
    return;
  }

  // Collect overdue decks across all classrooms
  const s = loadStore();
  let overdueCount = 0, urgentItems = [];
  classrooms.forEach(c => {
    const decks = s.decks[c.id]||[];
    decks.forEach(d => {
      if (d.status==='done') return;
      const info = deadlineInfo(d.dueDate);
      if (info.status==='overdue') overdueCount++;
      if ((info.status==='overdue'||info.status==='urgent') && urgentItems.length<3)
        urgentItems.push({ deckName:d.name, classroomName:c.name, info });
    });
  });

  const summaryBar = document.getElementById('deadlinesSummary');
  const pillRow = document.getElementById('deadlinesPillRow');
  if (urgentItems.length) {
    summaryBar.style.display='flex';
    pillRow.innerHTML = urgentItems.map(item=>`
      <span class="deadline-pill ${item.info.status==='overdue'?'overdue':'urgent'}" style="background:${item.info.status==='overdue'?'rgba(224,107,115,0.1)':'rgba(232,160,69,0.1)'};color:${item.info.status==='overdue'?'var(--rose)':'var(--acc)'};border:1px solid ${item.info.status==='overdue'?'rgba(224,107,115,0.2)':'rgba(232,160,69,0.2)'}">
        <strong>${esc(item.deckName)}</strong> · ${esc(item.classroomName)} · ${item.info.label}
      </span>
    `).join('');
  } else {
    summaryBar.style.display='none';
  }

  const iconSVGs = [
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  ];
  grid.innerHTML = classrooms.map((c,i) => {
    const s2 = loadStore();
    const decks = s2.decks[c.id]||[];
    const overdue = decks.filter(d=>d.status!=='done'&&deadlineInfo(d.dueDate).status==='overdue').length;
    const modeBadge = c.mode==='admin'
      ? `<span class="badge badge-amber">Teacher-led</span>`
      : `<span class="badge badge-cyan">Peer Pod</span>`;
    return `
      <div class="cr-card" data-id="${c.id}">
        <div class="cr-card-top">
          <div class="cr-card-icon">${iconSVGs[i%iconSVGs.length]}</div>
          ${modeBadge}
        </div>
        <h3>${esc(c.name)}</h3>
        <div class="cr-card-desc">${esc(c.desc||'No description')}</div>
        <div class="cr-card-meta">
          <span>${c.memberCount} member${c.memberCount===1?'':'s'}</span>
          <span class="cr-card-meta-dot"></span>
          <span>${decks.length} deck${decks.length===1?'':'s'}</span>
          ${overdue?`<span class="cr-card-meta-dot"></span><span style="color:var(--rose);font-weight:500">${overdue} overdue</span>`:''}
          <span class="cr-card-meta-dot"></span>
          <span>${timeAgo(c.lastActive||c.createdAt)}</span>
        </div>
        <svg class="cr-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }).join('');

  grid.querySelectorAll('.cr-card').forEach(card=>{
    card.addEventListener('click',()=>openClassroom(card.dataset.id));
  });
}

function openClassroom(id) {
  activeClassroomId = id;
  const classroom = MockAPI.getClassroom(id);
  if (!classroom) return;
  const me = currentUser();

  // Sidebar
  document.getElementById('crName').textContent = classroom.name;
  document.getElementById('crRole').textContent = classroom.myRole||'Student';
  const crIconSVGs = [
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  ];
  document.getElementById('sidebarIcon').innerHTML = crIconSVGs[Math.abs(id.charCodeAt(4))%crIconSVGs.length]||crIconSVGs[0];
  document.getElementById('sidebarUserName').textContent = me.name;
  document.getElementById('sidebarUserEmail').textContent = me.email;
  document.getElementById('sidebarAvatar').textContent = initials(me.name);

  // Overdue badge on deadlines nav
  const decks = MockAPI.getDecks(id);
  const overdueCount = decks.filter(d=>d.status!=='done'&&deadlineInfo(d.dueDate).status==='overdue').length;
  const dlBadge = document.getElementById('deadlineBadge');
  if (overdueCount) { dlBadge.textContent=overdueCount; dlBadge.style.display=''; }
  else { dlBadge.style.display='none'; }

  renderDashboard(id);
  switchTab('dashboard');
  showView('view-detail');
}

function renderDashboard(id) {
  const classroom = MockAPI.getClassroom(id);
  const stats = MockAPI.getStats(id);
  const members = MockAPI.getMembers(id);
  const decks = MockAPI.getDecks(id);
  const painPoints = MockAPI.getPainPoints(id);

  document.getElementById('crMeta').textContent = classroom.desc||'';
  document.getElementById('statMembers').textContent = stats.count;
  document.getElementById('statMembersLimit').textContent = `of ${classroom.memberLimit} max`;
  document.getElementById('statAvgCards').textContent = stats.avgCards;
  document.getElementById('statRetention').textContent = stats.avgRetention+'%';
  document.getElementById('statDecks').textContent = decks.length;
  const overdueDecks = decks.filter(d=>d.status!=='done'&&deadlineInfo(d.dueDate).status==='overdue').length;
  document.getElementById('statDecksOverdue').textContent = overdueDecks ? `${overdueDecks} overdue`:'All on track';
  document.getElementById('statDecksOverdue').style.color = overdueDecks?'var(--rose)':'var(--green)';

  document.getElementById('inviteCode').textContent = classroom.inviteCode;
  document.getElementById('inviteHint').textContent = `${members.length} / ${classroom.memberLimit} members`;

  // Next deadline widget
  const upcoming = decks.filter(d=>d.status!=='done'&&d.dueDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  const ndw = document.getElementById('nextDeadlineWidget');
  if (upcoming.length) {
    const next = upcoming[0];
    const info = deadlineInfo(next.dueDate);
    ndw.innerHTML=`
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:8px;background:var(--surf2);border:1px solid var(--bord);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--acc)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
        <div>
          <div style="font-weight:600;color:var(--ink);margin-bottom:4px;font-size:0.88rem">${esc(next.name)}</div>
          <div class="deadline-chip ${info.status}" style="display:inline-flex">${info.label}</div>
        </div>
      </div>`;
  } else {
    ndw.innerHTML=`<div style="font-size:0.82rem;color:var(--ink3);padding:8px 0">No upcoming deadlines</div>`;
  }

  // Leaderboard
  const lb = MockAPI.getLeaderboard(id);
  const me = currentUser();
  const max = lb[0]?.reviewed||1;
  document.getElementById('leaderboardList').innerHTML = lb.slice(0,6).map((r,i)=>`
    <div class="lb-item ${r.userId===me.id?'me-row':''}">
      <div class="lb-rank ${i===0?'gold':''}">#${i+1}</div>
      <div class="mini-avatar" style="${i===0?'background:linear-gradient(135deg,var(--acc),#c4722a);color:#0d0f14;':''}">${initials(r.name)}</div>
      <div style="flex:1;min-width:0">
        <div class="lb-name">${esc(r.name)}${r.userId===me.id?' <span style="font-size:0.72rem;color:var(--ink3)">(you)</span>':''}</div>
        <div class="prog-wrap" style="margin-top:5px;max-width:160px">
          <div class="prog-fill" style="width:${r.reviewed/max*100}%"></div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="lb-score">${r.reviewed}</div>
        <div style="font-size:0.72rem;color:var(--ink3)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-5-6.33-5-6.33s-5 4.95-5 6.33a2.5 2.5 0 0 0 2.5 2.5h5z"/><path d="M15.5 14.5A2.5 2.5 0 0 0 18 12c0-1.38-5-6.33-5-6.33s-5 4.95-5 6.33a2.5 2.5 0 0 0 2.5 2.5h5z"/></svg> ${r.streak}</div>
      </div>
    </div>`).join('');

  // Pain points
  document.getElementById('painPointsList').innerHTML = !painPoints.length
    ? `<div class="empty"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div><h3>No pain points yet</h3><p>Cards will surface here once members start reviewing.</p></div>`
    : painPoints.map(p=>`
      <div class="pain-card">
        <div class="pain-q">${esc(p.q)}</div>
        <div class="pain-meta">
          <span class="pain-fail-rate">${Math.round(p.fail*100)}% failed</span>
          <div class="pain-bar-track"><div class="pain-bar-fill" style="width:${p.fail*100}%"></div></div>
          <span class="pain-deck"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${esc(p.deck)} · ${p.attempts} attempts</span>
        </div>
      </div>`).join('');
}

function renderDecksTab(id) {
  const classroom = MockAPI.getClassroom(id);
  const decks = MockAPI.getDecks(id);
  const isPeer = classroom.mode==='p2p';
  const container = document.getElementById('deckListContainer');

  if (!decks.length) {
    container.innerHTML=`<div class="empty"><div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><h3>No decks assigned</h3><p>Assign a deck to get students studying</p></div>`;
    return;
  }

  if (isPeer) {
    container.innerHTML=`<div class="deck-list">`+decks.map(d=>{
      const me = currentUser();
      const mine = MockAPI.myVote(id,d.id);
      return `
        <div class="proposal-card">
          <div class="proposal-head">
            <div class="proposal-name">${esc(d.name)}</div>
            ${d.proposalStatus==='accepted'?'<span class="badge badge-green">✓ Accepted</span>':'<span class="badge badge-blue">Voting</span>'}
          </div>
          <div class="vote-row">
            <button class="vote-btn ${mine==='up'?'voted-up':''}" data-vote="up" data-deck="${d.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> ${d.votesUp||0}</button>
            <button class="vote-btn ${mine==='down'?'voted-down':''}" data-vote="down" data-deck="${d.id}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg> ${d.votesDown||0}</button>
            <span style="font-size:0.75rem;color:var(--ink3)">${(d.votesUp||0)+(d.votesDown||0)} votes</span>
          </div>
        </div>`;
    }).join('')+`</div>`;
    container.querySelectorAll('.vote-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        MockAPI.vote(id,btn.dataset.deck,btn.dataset.vote);
        renderDecksTab(id);
      });
    });
    return;
  }

  container.innerHTML=`<div class="deck-list">`+decks.map(d=>`
    <div class="deck-card">
      <div class="deck-card-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
      <div class="deck-card-body">
        <div class="deck-card-name">${esc(d.name)}</div>
        <div class="deck-card-meta">
          ${statusBadge(d.status)}
          ${priorityBadge(d.priority||'normal')}
          ${d.completion?`<span>${d.completion.done} done · ${d.completion.prog} in progress · ${d.completion.todo} todo</span>`:''}
        </div>
      </div>
      <div class="deck-card-right">
        ${deadlineChip(d.dueDate,d.status)}
        <button class="btn btn-ghost btn-sm btn-icon edit-deck-btn" title="Edit deck" data-deck-id="${d.id}" data-deck-name="${esc(d.name)}" data-due="${d.dueDate||''}" data-status="${d.status||'todo'}" data-priority="${d.priority||'normal'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 1 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
    </div>`).join('')+`</div>`;

  container.querySelectorAll('.edit-deck-btn').forEach(btn=>{
    btn.addEventListener('click',()=>openEditDeckModal(btn));
  });
}

function renderDeadlinesTab(id) {
  const decks = MockAPI.getDecks(id).filter(d=>!d.proposalStatus);
  const container = document.getElementById('deadlinesList');
  let activeFilter = 'all';

  function applyFilter() {
    let filtered = decks;
    if (activeFilter==='overdue')  filtered = decks.filter(d=>d.status!=='done'&&deadlineInfo(d.dueDate).status==='overdue');
    if (activeFilter==='urgent')   filtered = decks.filter(d=>d.status!=='done'&&deadlineInfo(d.dueDate).status==='urgent');
    if (activeFilter==='upcoming') filtered = decks.filter(d=>d.status!=='done'&&deadlineInfo(d.dueDate).status==='ok');
    if (activeFilter==='no-date')  filtered = decks.filter(d=>!d.dueDate);

    if (!filtered.length) {
      container.innerHTML=`<div class="empty"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><h3>Nothing here</h3><p>No decks match this filter</p></div>`;
      return;
    }

    const sorted = [...filtered].sort((a,b)=>{
      if (!a.dueDate&&!b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    container.innerHTML=`<div class="deck-list">`+sorted.map(d=>{
      const info = deadlineInfo(d.dueDate);
      const pct = d.completion ? Math.round(d.completion.done/(d.completion.done+d.completion.prog+d.completion.todo||1)*100) : 0;
      return `
        <div class="deck-card">
          <div class="deck-card-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
          <div class="deck-card-body">
            <div class="deck-card-name">${esc(d.name)}</div>
            <div class="deck-card-meta">
              ${statusBadge(d.status)}
              ${priorityBadge(d.priority||'normal')}
              <span>${pct}% complete</span>
            </div>
            <div class="prog-wrap" style="margin-top:8px;max-width:200px">
              <div class="prog-fill ${info.status==='overdue'?'rose':info.status==='urgent'?'':''}" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="deck-card-right">
            ${deadlineChip(d.dueDate,d.status)}
            <button class="btn btn-ghost btn-sm btn-icon edit-deck-btn" title="Edit deck" data-deck-id="${d.id}" data-deck-name="${esc(d.name)}" data-due="${d.dueDate||''}" data-status="${d.status||'todo'}" data-priority="${d.priority||'normal'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 1 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
        </div>`;
    }).join('')+`</div>`;

    container.querySelectorAll('.edit-deck-btn').forEach(btn=>{
      btn.addEventListener('click',()=>openEditDeckModal(btn));
    });
  }

  document.querySelectorAll('.filter-tab').forEach(tab=>{
    tab.onclick=()=>{
      activeFilter=tab.dataset.filter;
      document.querySelectorAll('.filter-tab').forEach(t=>t.classList.toggle('active',t===tab));
      applyFilter();
    };
  });

  applyFilter();
}

function renderMembersTab(id) {
  const classroom = MockAPI.getClassroom(id);
  const members = MockAPI.getMembers(id);
  const me = currentUser();
  const isPeer = classroom.mode==='p2p';
  const container = document.getElementById('membersContainer');

  if (!members.length) {
    container.innerHTML=`<div class="empty"><div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><h3>No members yet</h3><p>Share the invite code to get started</p></div>`;
    return;
  }

  if (isPeer) {
    container.innerHTML=`<div class="member-grid">`+members.map(m=>{
      const hidden=m.optIn===false&&m.userId!==me.id;
      return `<div class="member-card">
        <div class="member-avatar">${initials(m.name)}</div>
        <div class="member-name">${esc(m.name)}${m.userId===me.id?' <span style="font-size:0.7rem;color:var(--ink3)">(you)</span>':''}</div>
        <div class="member-role">${m.role}</div>
        ${hidden?`<div style="font-size:0.78rem;color:var(--ink3)">Stats hidden</div>`:`
          <div class="member-stats">
            <div class="member-stat"><div class="member-stat-val">${m.reviewed}</div><div class="member-stat-label">Cards</div></div>
            <div class="member-stat"><div class="member-stat-val">${Math.round(m.retention*100)}%</div><div class="member-stat-label">Retention</div></div>
            <div class="member-stat"><div class="member-stat-val"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-5-6.33-5-6.33s-5 4.95-5 6.33a2.5 2.5 0 0 0 2.5 2.5h5z"/><path d="M15.5 14.5A2.5 2.5 0 0 0 18 12c0-1.38-5-6.33-5-6.33s-5 4.95-5 6.33a2.5 2.5 0 0 0 2.5 2.5h5z"/></svg>${m.streak}</div><div class="member-stat-label">Streak</div></div>
          </div>`}
      </div>`;
    }).join('')+`</div>`;
    return;
  }

  container.innerHTML=`<div class="table-wrap"><table>
    <thead><tr><th>Student</th><th>Cards reviewed</th><th>Retention</th><th>Streak</th><th>Last active</th></tr></thead>
    <tbody>${members.map(m=>{
      const pct=m.retention*100;
      return `<tr>
        <td><div class="td-name"><div class="mini-avatar">${initials(m.name)}</div><div><div style="font-weight:500;color:var(--ink)">${esc(m.name)}</div><div style="font-size:0.75rem;color:var(--ink3)">${m.role}</div></div></div></td>
        <td><div style="font-weight:500;color:var(--ink)">${m.reviewed}</div></td>
        <td><div style="display:flex;align-items:center;gap:8px">
          <div class="prog-wrap" style="width:80px"><div class="prog-fill ${pct<70?'rose':pct>85?'green':''}" style="width:${pct}%"></div></div>
          <span style="font-size:0.78rem;color:var(--ink2)">${Math.round(pct)}%</span>
        </div></td>
        <td><span style="font-size:0.88rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-5-6.33-5-6.33s-5 4.95-5 6.33a2.5 2.5 0 0 0 2.5 2.5h5z"/><path d="M15.5 14.5A2.5 2.5 0 0 0 18 12c0-1.38-5-6.33-5-6.33s-5 4.95-5 6.33a2.5 2.5 0 0 0 2.5 2.5h5z"/></svg> ${m.streak}</span></td>
        <td style="color:var(--ink3);font-size:0.82rem">${timeAgo(m.lastActive)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function renderSettingsTab(id) {
  const classroom = MockAPI.getClassroom(id);
  document.getElementById('editClassName').value = classroom.name;
  document.getElementById('editClassDesc').value  = classroom.desc||'';
  document.getElementById('editInviteCode').value = classroom.inviteCode;
}

/* ── Event listeners ───────────────────────────────────────────────────────── */
// List view
const btnCreateClassroom = document.getElementById('btnCreateClassroom');
if (btnCreateClassroom) btnCreateClassroom.addEventListener('click',()=>showView('view-create'));

const btnJoinClassroom = document.getElementById('btnJoinClassroom');
if (btnJoinClassroom) btnJoinClassroom.addEventListener('click',()=>showView('view-join'));

// Back button
const btnBackToList = document.getElementById('btnBackToList');
if (btnBackToList) btnBackToList.addEventListener('click',()=>{
  activeClassroomId=null;
  showView('view-list');
  renderClassroomList();
});

// Sidebar nav
const sidebarNavItems = document.querySelectorAll('#sidebarNav .nav-item');
sidebarNavItems.forEach(btn=>{
  btn.addEventListener('click',()=>switchTab(btn.dataset.tab));
});

// Copy invite
const copyCode = document.getElementById('copyCode');
if (copyCode) copyCode.addEventListener('click',()=>{
  const code=document.getElementById('inviteCode')?.textContent;
  if (code) navigator.clipboard.writeText(`${location.origin}${location.pathname}?join=${code}`).catch(()=>{});
  toast('Invite link copied to clipboard');
});

// Assign deck buttons
['openAssignDeck','openAssignDeck2'].forEach(id=>{
  document.getElementById(id)?.addEventListener('click',()=>{
    populateAssignDeckSelect();
    document.getElementById('aDueDate').value='';
    document.getElementById('aPriority').value='normal';
    document.getElementById('modal-assign').classList.add('open');
  });
});

// X close button
document.getElementById('btnCancelAssignX')?.addEventListener('click',()=>{
  document.getElementById('modal-assign').classList.remove('open');
});

// Assign form submit
const assignForm = document.getElementById('assignForm');
if (assignForm) {
  assignForm.addEventListener('submit',e=>{
    e.preventDefault();
    const name = document.getElementById('aDeckName').value.trim();
    if (!name) { toast('Please select a deck', true); return; }
    const due=document.getElementById('aDueDate').value;
    const priority=document.getElementById('aPriority').value;
    MockAPI.assignDeck(activeClassroomId,name,due,priority);
    document.getElementById('modal-assign').classList.remove('open');
    toast('Deck assigned successfully');
    renderDashboard(activeClassroomId);
    renderDecksTab(activeClassroomId);
    openClassroom(activeClassroomId);
  });
}

// Cancel assign
const btnCancelAssign = document.getElementById('btnCancelAssign');
if (btnCancelAssign) {
  btnCancelAssign.addEventListener('click',()=>{
    document.getElementById('modal-assign').classList.remove('open');
  });
}
const modalAssign = document.getElementById('modal-assign');
if (modalAssign) {
  modalAssign.addEventListener('click',e=>{
    if(e.target===modalAssign) modalAssign.classList.remove('open');
  });
}

// ── Edit Deck modal ───────────────────────────────────────────────────────────
function openEditDeckModal(btn) {
  editingDeadlineDeckId = btn.dataset.deckId;
  document.getElementById('editDeckTitle').textContent = btn.dataset.deckName;
  document.getElementById('editDeckDate').value     = btn.dataset.due     || '';

  // Activate status segment
  const status = btn.dataset.status || 'todo';
  document.getElementById('editDeckStatus').value = status;
  document.querySelectorAll('#editStatusGroup .edit-seg').forEach(s => {
    s.classList.toggle('active', s.dataset.val === status);
  });

  // Activate priority segment
  const priority = btn.dataset.priority || 'normal';
  document.getElementById('editDeckPriority').value = priority;
  document.querySelectorAll('#editPriorityGroup .edit-seg').forEach(s => {
    s.classList.toggle('active', s.dataset.val === priority);
  });

  document.getElementById('modal-edit-deck').classList.add('open');
}

// Segment click handlers (delegated once)
document.getElementById('editStatusGroup').addEventListener('click', e => {
  const seg = e.target.closest('.edit-seg');
  if (!seg) return;
  document.querySelectorAll('#editStatusGroup .edit-seg').forEach(s => s.classList.remove('active'));
  seg.classList.add('active');
  document.getElementById('editDeckStatus').value = seg.dataset.val;
});
document.getElementById('editPriorityGroup').addEventListener('click', e => {
  const seg = e.target.closest('.edit-seg');
  if (!seg) return;
  document.querySelectorAll('#editPriorityGroup .edit-seg').forEach(s => s.classList.remove('active'));
  seg.classList.add('active');
  document.getElementById('editDeckPriority').value = seg.dataset.val;
});

function closeEditDeckModal() {
  document.getElementById('modal-edit-deck').classList.remove('open');
}

function refreshAfterDeckEdit() {
  renderDecksTab(activeClassroomId);
  renderDeadlinesTab(activeClassroomId);
  renderDashboard(activeClassroomId);
  const decks = MockAPI.getDecks(activeClassroomId);
  const overdueCount = decks.filter(d=>d.status!=='done'&&deadlineInfo(d.dueDate).status==='overdue').length;
  const dlBadge = document.getElementById('deadlineBadge');
  if (overdueCount) { dlBadge.textContent=overdueCount; dlBadge.style.display=''; }
  else { dlBadge.style.display='none'; }
}

document.getElementById('modal-edit-deck').addEventListener('click', e=>{
  if (e.target===document.getElementById('modal-edit-deck')) closeEditDeckModal();
});
document.getElementById('btnCancelEditDeck').addEventListener('click', closeEditDeckModal);
document.getElementById('btnCloseEditDeck').addEventListener('click', closeEditDeckModal);

document.getElementById('btnSaveDeck').addEventListener('click', ()=>{
  if (!editingDeadlineDeckId) return;
  MockAPI.updateDeck(activeClassroomId, editingDeadlineDeckId, {
    status:   document.getElementById('editDeckStatus').value,
    priority: document.getElementById('editDeckPriority').value,
    dueDate:  document.getElementById('editDeckDate').value,
  });
  closeEditDeckModal();
  toast('Deck updated');
  refreshAfterDeckEdit();
});

document.getElementById('btnDeleteDeck').addEventListener('click', ()=>{
  if (!editingDeadlineDeckId) return;
  if (!confirm('Remove this deck from the classroom?')) return;
  MockAPI.removeDeck(activeClassroomId, editingDeadlineDeckId);
  closeEditDeckModal();
  toast('Deck removed');
  refreshAfterDeckEdit();
});

// Leave classroom
['btnLeaveClassroom','btnLeaveSettings'].forEach(id=>{
  document.getElementById(id)?.addEventListener('click',()=>{
    if(confirm('Leave this classroom? You can rejoin with the invite code.')) {
      MockAPI.leave(activeClassroomId);
      activeClassroomId=null;
      toast('You have left the classroom');
      showView('view-list');
      renderClassroomList();
    }
  });
});

// Settings edit toggle
document.getElementById('btnEditSettings').addEventListener('click',()=>{
  document.getElementById('editClassName').disabled=false;
  document.getElementById('editClassDesc').disabled=false;
  document.getElementById('btnEditSettings').style.display='none';
  document.getElementById('btnSaveSettings').style.display='';
  document.getElementById('btnCancelSettings').style.display='';
});
document.getElementById('btnCancelSettings').addEventListener('click',()=>{
  renderSettingsTab(activeClassroomId);
  document.getElementById('editClassName').disabled=true;
  document.getElementById('editClassDesc').disabled=true;
  document.getElementById('btnEditSettings').style.display='';
  document.getElementById('btnSaveSettings').style.display='none';
  document.getElementById('btnCancelSettings').style.display='none';
});
document.getElementById('btnSaveSettings').addEventListener('click',()=>{
  toast('Changes saved');
  document.getElementById('editClassName').disabled=true;
  document.getElementById('editClassDesc').disabled=true;
  document.getElementById('btnEditSettings').style.display='';
  document.getElementById('btnSaveSettings').style.display='none';
  document.getElementById('btnCancelSettings').style.display='none';
});

// Create form
document.querySelectorAll('.mode-option').forEach(opt=>{
  opt.addEventListener('click',()=>{
    document.querySelectorAll('.mode-option').forEach(o=>o.classList.remove('selected'));
    opt.classList.add('selected');
    document.getElementById('cMode').value=opt.dataset.mode;
  });
});
document.getElementById('btnCancelCreate').addEventListener('click',()=>showView('view-list'));
document.getElementById('createForm').addEventListener('submit',e=>{
  e.preventDefault();
  const id=MockAPI.createClassroom({
    name:document.getElementById('cName').value.trim(),
    desc:document.getElementById('cDesc').value.trim(),
    mode:document.getElementById('cMode').value,
  });
  toast('Classroom created');
  openClassroom(id);
});

// Join form
document.getElementById('btnCancelJoin').addEventListener('click',()=>showView('view-list'));
document.getElementById('joinForm').addEventListener('submit',e=>{
  e.preventDefault();
  const code=document.getElementById('jCode').value.trim();
  const cid=MockAPI.joinByCode(code);
  if(cid){ toast('Successfully joined classroom'); openClassroom(cid); }
  else { toast('Invalid invite code — please check and try again',true); }
});

// Exit Class Mode button (list view + detail view sidebar)
document.getElementById('btnExitClassMode')?.addEventListener('click', () => {
  location.href = 'app.html';
});
document.getElementById('btnExitClassModeDetail')?.addEventListener('click', () => {
  location.href = 'app.html';
});

// Handle ?join= in URL
const urlJoin=new URLSearchParams(location.search).get('join');
if(urlJoin){
  document.getElementById('jCode').value=urlJoin;
  showView('view-join');
} else {
  renderClassroomList();
}