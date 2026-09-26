/**
 * Memory App — app.js
 * ────────────────────────────────────────────────
 * Tech Stack (production):
 *   Frontend:   React Native + Expo + Expo Router
 *   Backend:    FastAPI / Flask
 *   Database:   PostgreSQL + pgVector
 *   Auth:       JWT + Supabase Auth
 *   LLM APIs:   Groq API · Gemini API
 *   Security:   PostgreSQL RLS
 *   Secrets:    Environment Variables
 * ────────────────────────────────────────────────
 * This file IS the entire app logic for the prototype.
 * Data store: JS in-memory (no backend).
 * Limit: 10 memories per account.
 */

'use strict';

/* ════════════════════════════════════════════════
   1. AUTH CREDENTIALS
   In production: POST /auth/login → FastAPI →
   Supabase Auth validates → returns JWT token.
════════════════════════════════════════════════ */
const AUTH = {
  email:    'Dhananjaygurjar20@gmail.com',
  password: 'INDORE@123',
};

const MAX_MEMORIES = 10;
const MAX_ROOMS    = 6;

/* Default rooms created with every new account */
const DEFAULT_ROOMS = [
  { name: 'Work',     icon: '#ic-briefcase', color: 'green', desc: 'Work related goals, projects, learning and professional life.', enabled: true,  isDefault: true },
  { name: 'Health',   icon: '#ic-health',    color: 'teal',  desc: 'Health, fitness, nutrition and wellness.',                       enabled: true,  isDefault: true },
  { name: 'Personal', icon: '#ic-user',      color: 'blue',  desc: 'Personal life, hobbies, relationships and preferences.',        enabled: false, isDefault: true },
];

/* Color → CSS variable map */
const COLOR_MAP = {
  green: { css: 'var(--green)', pale: 'var(--green-pale)', dot: 'var(--green-dot)' },
  teal:  { css: 'var(--teal)',  pale: 'var(--teal-pale)',  dot: 'var(--teal)'      },
  blue:  { css: 'var(--blue)',  pale: 'var(--blue-pale)',  dot: 'var(--blue)'      },
  amber: { css: 'var(--amber)', pale: 'var(--amber-pale)', dot: 'var(--amber)'    },
};

/* Icon options for custom rooms */
const ROOM_ICONS = [
  { value: '#ic-sparkle',   label: 'Sparkle' },
  { value: '#ic-briefcase', label: 'Briefcase' },
  { value: '#ic-health',    label: 'Health' },
  { value: '#ic-user',      label: 'Person' },
  { value: '#ic-shield',    label: 'Shield' },
  { value: '#ic-edit',      label: 'Edit' },
  { value: '#ic-chat',      label: 'Chat' },
  { value: '#ic-clock',     label: 'Clock' },
];

/* ════════════════════════════════════════════════
   2. APP STATE
   Single source of truth. In production this
   lives in PostgreSQL (RLS-protected per user).
════════════════════════════════════════════════ */
let AppState = {
  isAuthenticated: false,
  user: null,              // set after login
  rooms: [],               // Room[] — max 6
  memories: [],            // Memory[] — max 10
  pendingMemories: [],     // Pending[] — awaiting review
  activityLog: [],         // ActivityEntry[]
  vaultFilter: 'all',      // 'all' | 'active' | 'paused' | room name
  selectedMemoryId: null,  // currently open in detail sheet
  chatMessages: [],        // ChatMessage[]
  currentDraft: null,      // DraftMemory | null
};

/* ════════════════════════════════════════════════
   3. DATA MODELS
════════════════════════════════════════════════ */
function createMemory(text, room, retention) {
  return {
    id:        'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    text:      text.trim(),
    room:      room || 'Work',
    retention: retention || '6 months',
    status:    'active',      // 'active' | 'paused'
    uses:      0,
    createdAt: new Date(),
  };
}

function createActivity(type, text) {
  return {
    id:        'act_' + Date.now(),
    type:      type,    // 'added' | 'deleted' | 'paused' | 'resumed' | 'edited' | 'rejected'
    text:      text,
    timestamp: new Date(),
  };
}

function createChatMessage(role, text) {
  return { role, text, timestamp: new Date() };
}

/* ════════════════════════════════════════════════
   4. SCREEN ROUTER
════════════════════════════════════════════════ */
const PROTECTED_SCREENS = [
  'screen-home', 'screen-chat', 'screen-queue', 'screen-vault',
  'screen-detail', 'screen-rooms', 'screen-privacy',
  'screen-profile', 'screen-admin',
];
const AUTH_SCREENS   = ['screen-login'];
const PUBLIC_SCREENS = ['screen-splash'];

const SCREEN_ORDER = [
  'screen-splash', 'screen-login', 'screen-home', 'screen-chat',
  'screen-queue', 'screen-vault', 'screen-detail', 'screen-rooms',
  'screen-privacy', 'screen-profile', 'screen-admin',
];

function showScreen(id) {
  if (PROTECTED_SCREENS.includes(id) && !AppState.isAuthenticated) {
    showScreen('screen-login'); return;
  }
  if (AUTH_SCREENS.includes(id) && AppState.isAuthenticated) {
    showScreen('screen-home'); return;
  }

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add('active');
    const scroll = target.querySelector('.screen-scroll');
    if (scroll) scroll.scrollTop = 0;
  }
  // Sync dot switcher
  document.querySelectorAll('.dot-btn').forEach(d => {
    d.classList.toggle('active', d.dataset.screen === id);
  });
  // Re-render the screen being shown
  onScreenEnter(id);
}

function onScreenEnter(id) {
  switch (id) {
    case 'screen-home':    renderHome();    break;
    case 'screen-vault':   renderVault();   break;
    case 'screen-queue':   renderQueue();   break;
    case 'screen-chat':    renderChat();    break;
    case 'screen-rooms':   renderRooms();   break;
    case 'screen-privacy': renderPrivacyActivity(); break;
    case 'screen-profile': renderProfile(); break;
    case 'screen-admin':   renderAdmin();   break;
    case 'screen-detail':  renderDetail();  break;
  }
}

/* ════════════════════════════════════════════════
   5. AUTH LOGIC
════════════════════════════════════════════════ */
function handleLogin() {
  const emailEl    = document.getElementById('login-email');
  const passwordEl = document.getElementById('login-password');
  const errorEl    = document.getElementById('auth-error');
  const btnEl      = document.getElementById('login-btn');
  if (!emailEl || !passwordEl) return;

  const email    = emailEl.value.trim();
  const password = passwordEl.value;
  errorEl.style.display = 'none';

  if (!email || !password) { showAuthError('Please enter your email and password.'); return; }

  btnEl.textContent   = 'Signing in...';
  btnEl.disabled      = true;
  btnEl.style.opacity = '0.7';

  // Simulate FastAPI /auth/login network call (800ms)
  setTimeout(() => {
    if (
      email.toLowerCase() === AUTH.email.toLowerCase() &&
      password === AUTH.password
    ) {
      // SUCCESS: Build user session
      AppState.isAuthenticated = true;
      AppState.user = buildUserFromEmail(email);

      // Fresh state — no pre-populated data
      AppState.rooms           = DEFAULT_ROOMS.map(r => ({...r, id: 'room_' + r.name.toLowerCase() + '_' + Date.now()}));
      AppState.memories        = [];
      AppState.pendingMemories = [];
      AppState.activityLog     = [];
      AppState.chatMessages    = [];
      AppState.currentDraft    = null;
      AppState.selectedMemoryId = null;
      AppState.vaultFilter     = 'all';

      btnEl.textContent   = 'Welcome!';
      btnEl.style.background = 'var(--green)';

      setTimeout(() => {
        btnEl.textContent      = 'Sign in';
        btnEl.disabled         = false;
        btnEl.style.opacity    = '1';
        btnEl.style.background = 'var(--dark)';
        emailEl.value          = '';
        passwordEl.value       = '';
        showScreen('screen-home');
      }, 700);
    } else {
      showAuthError('Incorrect email or password. Please try again.');
      btnEl.textContent   = 'Sign in';
      btnEl.disabled      = false;
      btnEl.style.opacity = '1';
    }
  }, 800);
}

function buildUserFromEmail(email) {
  // Derive display name from email prefix
  const prefix = email.split('@')[0].replace(/[^a-zA-Z]/g, ' ').trim();
  const words  = prefix.split(' ').filter(Boolean);
  const name   = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const initials = words.slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('');
  return {
    email,
    name:     name || email,
    initials: initials || email.charAt(0).toUpperCase(),
    id:       'usr_' + Math.random().toString(36).slice(2, 10),
    joinedAt: new Date(),
  };
}

function handleLogout() {
  AppState.isAuthenticated = false;
  AppState.user = null;
  AppState.rooms = [];
  AppState.memories = [];
  AppState.pendingMemories = [];
  AppState.activityLog = [];
  AppState.chatMessages = [];
  AppState.currentDraft = null;
  AppState.vaultFilter = 'all';
  showScreen('screen-splash');
}

function showAuthError(msg) {
  const el    = document.getElementById('auth-error');
  const msgEl = document.getElementById('auth-error-msg');
  if (el && msgEl) { msgEl.textContent = msg; el.style.display = 'flex'; }
}

function togglePassword() {
  const pw  = document.getElementById('login-password');
  const eye = document.getElementById('pw-eye');
  if (!pw || !eye) return;
  if (pw.type === 'password') {
    pw.type = 'text'; pw.style.letterSpacing = '0';
    eye.setAttribute('href', '#ic-eye-off');
  } else {
    pw.type = 'password'; pw.style.letterSpacing = '2px';
    eye.setAttribute('href', '#ic-eye');
  }
}

/* ════════════════════════════════════════════════
   6. MEMORY CRUD — max 10 per account
════════════════════════════════════════════════ */
function addMemory(text, room, retention) {
  if (!text || !text.trim()) return null;
  if (AppState.memories.length >= MAX_MEMORIES) {
    alert('Memory limit reached (10/10). Delete a memory to add more.');
    return null;
  }
  const mem = createMemory(text, room, retention);
  AppState.memories.push(mem);
  AppState.activityLog.unshift(createActivity('added', mem.text));
  renderAll();
  return mem;
}

function deleteMemory(id) {
  const mem = AppState.memories.find(m => m.id === id);
  if (!mem) return;
  AppState.memories = AppState.memories.filter(m => m.id !== id);
  AppState.activityLog.unshift(createActivity('deleted', mem.text));
  renderAll();
}

function togglePauseMemory(id) {
  const mem = AppState.memories.find(m => m.id === id);
  if (!mem) return;
  mem.status = mem.status === 'active' ? 'paused' : 'active';
  const type = mem.status === 'paused' ? 'paused' : 'resumed';
  AppState.activityLog.unshift(createActivity(type, mem.text));
  renderAll();
}

function editMemoryText(id, newText) {
  const mem = AppState.memories.find(m => m.id === id);
  if (!mem || !newText.trim()) return;
  mem.text = newText.trim();
  AppState.activityLog.unshift(createActivity('edited', mem.text));
  renderAll();
}

/* ════════════════════════════════════════════════
   7. PENDING MEMORY QUEUE
════════════════════════════════════════════════ */
function addPendingMemory(text, room, retention) {
  if (AppState.memories.length >= MAX_MEMORIES) return;
  AppState.pendingMemories.push({
    id:        'pnd_' + Date.now(),
    text:      text.trim(),
    room:      room || 'Work',
    retention: retention || '6 months',
    createdAt: new Date(),
  });
  renderAll();
}

function approvePending(id) {
  const pnd = AppState.pendingMemories.find(p => p.id === id);
  if (!pnd) return;
  AppState.pendingMemories = AppState.pendingMemories.filter(p => p.id !== id);
  addMemory(pnd.text, pnd.room, pnd.retention);
}

function rejectPending(id) {
  const pnd = AppState.pendingMemories.find(p => p.id === id);
  AppState.pendingMemories = AppState.pendingMemories.filter(p => p.id !== id);
  if (pnd) AppState.activityLog.unshift(createActivity('rejected', pnd.text));
  renderAll();
}

/* ════════════════════════════════════════════════
   8. CHAT LOGIC
════════════════════════════════════════════════ */
const AI_RESPONSES = [
  "Got it! That's helpful context. Shall I save that as a memory?",
  "Interesting — I'll keep that in mind for future answers. Want me to save it?",
  "Thanks for sharing that. I can remember this to give you better responses. Save it?",
  "Noted! This will help me give you more relevant answers. Shall I add it to your memory?",
  "That's useful to know! I can save this so I remember it next time. Would you like that?",
  "I'll factor that into my answers going forward. Want to save this as a memory?",
];

let aiResponseIndex = 0;
let chatDraftTimeout = null;

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';

  // Add user message
  AppState.chatMessages.push(createChatMessage('user', text));
  renderChat();

  // Check limit
  if (AppState.memories.length >= MAX_MEMORIES) {
    setTimeout(() => {
      AppState.chatMessages.push(createChatMessage('ai', 'You\'ve reached the 10-memory limit. Please delete a memory from the Vault before adding more.'));
      renderChat();
    }, 600);
    return;
  }

  // AI response after 700ms
  setTimeout(() => {
    const reply = AI_RESPONSES[aiResponseIndex % AI_RESPONSES.length];
    aiResponseIndex++;
    AppState.chatMessages.push(createChatMessage('ai', reply));
    renderChat();

    // Show draft card after another 400ms
    setTimeout(() => {
      // Default to first enabled room
      const defaultRoom = AppState.rooms.find(r => r.enabled);
      AppState.currentDraft = {
        text:      text,
        room:      defaultRoom ? defaultRoom.name : 'Work',
        retention: '6 months',
      };
      renderChatDraft();
    }, 400);
  }, 700);
}

function keepDraftMemory() {
  if (!AppState.currentDraft) return;
  const room      = document.getElementById('draft-room')?.value      || AppState.currentDraft.room;
  const retention = document.getElementById('draft-retention')?.value || AppState.currentDraft.retention;
  addMemory(AppState.currentDraft.text, room, retention);
  AppState.chatMessages.push(createChatMessage('ai', 'Memory saved! I\'ll use this to give you better answers.'));
  AppState.currentDraft = null;
  renderChat();
  renderChatDraft();
}

function dismissDraft() {
  if (AppState.currentDraft) {
    AppState.activityLog.unshift(createActivity('rejected', AppState.currentDraft.text));
    AppState.currentDraft = null;
  }
  AppState.chatMessages.push(createChatMessage('ai', 'Okay, I won\'t save that. Just let me know if you change your mind.'));
  renderChat();
  renderChatDraft();
}

function showAddMemoryForm() {
  const input = document.getElementById('chat-input');
  if (input) { input.placeholder = 'Type a preference, habit, or fact about yourself...'; input.focus(); }
}

/* ════════════════════════════════════════════════
   9. RENDER FUNCTIONS
════════════════════════════════════════════════ */

/* -- Helpers ---------------------------------------- */
function timeAgo(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

/* Room helpers — look up from live AppState.rooms */
function findRoom(name) {
  return AppState.rooms.find(r => r.name === name);
}

function roomColor(room) {
  const r = findRoom(room);
  return r ? r.color : 'gray';
}

function roomIcon(room) {
  const r = findRoom(room);
  return r ? r.icon : '#ic-sparkle';
}

function roomCssColor(room) {
  const r = findRoom(room);
  return r ? (COLOR_MAP[r.color]?.css || 'var(--text-muted)') : 'var(--text-muted)';
}

function roomCssPale(room) {
  const r = findRoom(room);
  return r ? (COLOR_MAP[r.color]?.pale || 'var(--panel)') : 'var(--panel)';
}

function svgIcon(href, color, size) {
  size = size || 16;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><use href="${href}"/></svg>`;
}

function emptyState(icon, title, sub) {
  return `<div style="padding:32px 20px;text-align:center;">
    <div style="width:48px;height:48px;border-radius:12px;background:var(--panel);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
      ${svgIcon(icon, 'var(--text-muted)', 22)}
    </div>
    <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px;">${title}</div>
    <div style="font-size:13px;color:var(--text-muted);line-height:1.5;">${sub}</div>
  </div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}

/* -- Home ------------------------------------------- */
function renderHome() {
  if (!AppState.user) return;
  const u = AppState.user;
  const mems = AppState.memories;
  const active = mems.filter(m => m.status === 'active').length;
  const paused = mems.filter(m => m.status === 'paused').length;
  const pending = AppState.pendingMemories.length;

  setText('home-greeting',  greeting());
  setText('home-username',  u.name);
  setText('home-avatar',    u.initials);
  setText('stat-total',     mems.length);
  setText('stat-limit-label', `${mems.length} / ${MAX_MEMORIES} used`);
  setText('stat-pending',   pending);
  setText('stat-active',    active);
  setText('stat-paused',    paused);

  // Activity feed — last 5 entries
  const actList = document.getElementById('home-activity-list');
  if (actList) {
    const recent = AppState.activityLog.slice(0, 5);
    if (recent.length === 0) {
      actList.innerHTML = emptyState('#ic-sparkle', 'No activity yet', 'Your memory actions will appear here.');
    } else {
      actList.innerHTML = recent.map(a => {
        const icon  = activityIcon(a.type);
        const color = activityColor(a.type);
        const pale  = activityPale(a.type);
        return `<div class="activity-item">
          <div class="act-dot" style="background:${pale};">${svgIcon(icon, color, 13)}</div>
          <div class="act-body">
            <div class="act-label">${activityLabel(a.type)}</div>
            <div class="act-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${esc(a.text)}</div>
          </div>
          <div class="act-time">${timeAgo(a.timestamp)}</div>
        </div>`;
      }).join('');
    }
  }
}

function activityIcon(type) {
  const map = {
    added:'#ic-check', deleted:'#ic-trash', paused:'#ic-pause',
    resumed:'#ic-play', edited:'#ic-edit', rejected:'#ic-x',
  };
  return map[type] || '#ic-sparkle';
}
function activityColor(type) {
  const map = {
    added:'var(--green)', deleted:'var(--red)', paused:'var(--amber)',
    resumed:'var(--green)', edited:'var(--blue)', rejected:'var(--text-muted)',
  };
  return map[type] || 'var(--text-muted)';
}
function activityPale(type) {
  const map = {
    added:'var(--green-pale)', deleted:'var(--red-pale)', paused:'var(--amber-pale)',
    resumed:'var(--green-pale)', edited:'var(--blue-pale)', rejected:'var(--panel)',
  };
  return map[type] || 'var(--panel)';
}
function activityLabel(type) {
  const map = {
    added:'Memory saved', deleted:'Memory deleted', paused:'Memory paused',
    resumed:'Memory resumed', edited:'Memory edited', rejected:'Memory rejected',
  };
  return map[type] || type;
}

/* -- Vault ------------------------------------------ */
function setVaultFilter(filter) {
  AppState.vaultFilter = filter;
  renderVaultTabs();
  renderVault();
}

function renderVaultTabs() {
  const wrap = document.getElementById('vault-filter-tabs');
  if (!wrap) return;
  const f = AppState.vaultFilter;
  const roomNames = AppState.rooms.map(r => r.name);
  let html = '';
  html += `<div class="filter-tab ${f==='all'?'active':''}" onclick="setVaultFilter('all')">All</div>`;
  html += `<div class="filter-tab ${f==='active'?'active':''}" onclick="setVaultFilter('active')">Active</div>`;
  html += `<div class="filter-tab ${f==='paused'?'active':''}" onclick="setVaultFilter('paused')">Paused</div>`;
  roomNames.forEach(name => {
    html += `<div class="filter-tab ${f===name?'active':''}" onclick="setVaultFilter('${esc(name)}')">${esc(name)}</div>`;
  });
  wrap.innerHTML = html;
}

function renderVault() {
  const searchEl = document.getElementById('vault-search');
  const query    = (searchEl?.value || '').toLowerCase().trim();

  const vf = AppState.vaultFilter;
  let mems = [...AppState.memories];
  if (query) mems = mems.filter(m => m.text.toLowerCase().includes(query));
  if (vf === 'active')      mems = mems.filter(m => m.status === 'active');
  else if (vf === 'paused') mems = mems.filter(m => m.status === 'paused');
  else if (vf !== 'all') {
    // It's a room name
    mems = mems.filter(m => m.room === vf);
  }

  const listEl   = document.getElementById('vault-list');
  const badgeEl  = document.getElementById('vault-count-badge');
  const addBtn   = document.getElementById('vault-add-btn');

  if (badgeEl) badgeEl.textContent = `${AppState.memories.length} / ${MAX_MEMORIES}`;
  if (addBtn)  addBtn.disabled = AppState.memories.length >= MAX_MEMORIES;

  if (!listEl) return;

  if (mems.length === 0) {
    listEl.innerHTML = query
      ? emptyState('#ic-vault', 'No matches', 'Try a different search term.')
      : emptyState('#ic-vault', 'No memories yet', 'Start a chat and save your first memory.');
    return;
  }

  listEl.innerHTML = `<div style="border-radius:16px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:12px;">
    ${mems.map((m, i) => {
      const first = i === 0;
      const last  = i === mems.length - 1;
      const col   = roomCssColor(m.room);
      const pale  = roomCssPale(m.room);
      const br    = first ? 'border-radius:14px 14px 0 0;' : last ? 'border-radius:0 0 14px 14px;' : '';
      return `<div class="memory-row" style="${br}" onclick="openDetail('${m.id}')">
        <div class="mem-dot ${roomColor(m.room)}">${svgIcon(roomIcon(m.room), col, 16)}</div>
        <div class="mem-body">
          <div class="mem-text" style="${m.status==='paused'?'opacity:0.5;text-decoration:line-through;':''}">${esc(m.text)}</div>
          <div class="mem-meta">${m.room} · ${m.retention}${m.status==='paused'?' · Paused':''}</div>
        </div>
        ${svgIcon('#ic-chevron-right','var(--text-muted)',16)}
      </div>`;
    }).join('')}
  </div>`;
}

/* -- Queue ------------------------------------------ */
function renderQueue() {
  const listEl  = document.getElementById('queue-list');
  const badgeEl = document.getElementById('queue-count-badge');
  const pnd     = AppState.pendingMemories;

  if (badgeEl) badgeEl.textContent = `${pnd.length} pending`;

  if (!listEl) return;
  if (pnd.length === 0) {
    listEl.innerHTML = emptyState('#ic-check', 'All caught up', 'No memories waiting for review.');
    return;
  }

  listEl.innerHTML = pnd.map(p => {
    const col  = roomCssColor(p.room);
    const pale = roomCssPale(p.room);
    return `<div class="queue-card" style="margin-bottom:12px;">
      <div class="queue-card-header">
        <div style="width:8px;height:8px;border-radius:50%;background:${col};"></div>
        <span style="font-size:11px;font-weight:700;color:${col};text-transform:uppercase;letter-spacing:0.4px;">Possible memory · Not saved</span>
      </div>
      <div class="queue-card-text">${esc(p.text)}</div>
      <div class="queue-card-footer">
        <span class="queue-time">${timeAgo(p.createdAt)}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="room-tag ${p.room.toLowerCase()}">${p.room}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn btn-outline" style="flex:1;padding:8px;" onclick="rejectPending('${p.id}')">Reject</button>
        <button class="btn btn-primary" style="flex:1;padding:8px;" onclick="approvePending('${p.id}')">Save memory</button>
      </div>
    </div>`;
  }).join('');
}

/* -- Chat ------------------------------------------- */
function renderChat() {
  const wrap = document.getElementById('chat-messages');
  if (!wrap) return;

  // Welcome message if no messages
  if (AppState.chatMessages.length === 0) {
    wrap.innerHTML = `<div style="padding:16px 0 8px;text-align:center;">
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Start a conversation to save a memory</div>
    </div>
    <div class="bubble ai" style="align-self:flex-start;margin-bottom:4px;">
      Hi ${AppState.user?.name?.split(' ')[0] || 'there'}! Tell me something about yourself — a preference, habit, or goal — and I can save it as a memory to give you better answers.
    </div>
    <div class="bubble-time left">${formatTime(new Date())}</div>`;
  } else {
    wrap.innerHTML = AppState.chatMessages.map(msg => {
      const cls  = msg.role === 'user' ? 'user' : 'ai';
      const time = `<div class="bubble-time ${msg.role==='ai'?'left':''}">${formatTime(msg.timestamp)}</div>`;
      return `<div class="bubble ${cls}">${esc(msg.text)}</div>${time}`;
    }).join('');
  }

  // Scroll to bottom
  const scrollEl = document.getElementById('chat-messages-wrap');
  if (scrollEl) setTimeout(() => { scrollEl.scrollTop = scrollEl.scrollHeight; }, 50);

  // Limit banner
  const limitBanner = document.getElementById('chat-limit-banner');
  if (limitBanner) limitBanner.style.display = AppState.memories.length >= MAX_MEMORIES ? 'block' : 'none';

  renderChatDraft();
}

function renderChatDraft() {
  const wrap = document.getElementById('chat-draft-wrap');
  if (!wrap) return;
  if (AppState.currentDraft) {
    const textEl = document.getElementById('chat-draft-text');
    if (textEl) textEl.textContent = AppState.currentDraft.text;
    wrap.style.display = 'block';
    renderDraftRoomOptions();
  } else {
    wrap.style.display = 'none';
  }
}

function renderDraftRoomOptions() {
  const sel = document.getElementById('draft-room');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = AppState.rooms
    .filter(r => r.enabled)
    .map(r => `<option value="${esc(r.name)}" ${r.name === current ? 'selected' : ''}>${esc(r.name)}</option>`)
    .join('');
}

function formatTime(date) {
  const d = new Date(date);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/* -- Rooms ------------------------------------------ */
function renderRooms() {
  const listEl = document.getElementById('rooms-list');
  const limitNote = document.getElementById('rooms-limit-note');
  const createToggle = document.getElementById('create-room-toggle');
  if (!listEl) return;

  // Show/hide limit note and create button
  const atLimit = AppState.rooms.length >= MAX_ROOMS;
  if (limitNote) limitNote.style.display = atLimit ? 'block' : 'none';
  if (createToggle) createToggle.style.display = atLimit ? 'none' : 'flex';

  if (AppState.rooms.length === 0) {
    listEl.innerHTML = emptyState('#ic-vault', 'No rooms yet', 'Create your first context room.');
    return;
  }

  listEl.innerHTML = AppState.rooms.map(room => {
    const count = AppState.memories.filter(m => m.room === room.name).length;
    const colorObj = COLOR_MAP[room.color] || COLOR_MAP.green;
    const toggleClass = room.enabled ? '' : ' off';
    const deleteBtn = room.isDefault ? '' :
      `<div onclick="event.stopPropagation(); deleteRoom('${room.id}')" style="display:flex;align-items:center;gap:4px;padding:6px 10px;border-radius:8px;background:var(--red-pale);cursor:pointer;margin-top:8px;width:fit-content;">
        ${svgIcon('#ic-trash', 'var(--red)', 13)}
        <span style="font-size:11px;font-weight:600;color:var(--red);">Delete room</span>
      </div>`;

    return `<div class="room-card">
      <div class="room-card-header">
        <div class="room-card-title">
          <div class="room-icon ${room.color}">${svgIcon(room.icon, colorObj.css, 18)}</div>
          <div>
            <div class="room-name">${esc(room.name)}</div>
            <div class="room-count">${count} ${count === 1 ? 'memory' : 'memories'}</div>
          </div>
        </div>
        <div class="toggle${toggleClass}" onclick="toggleRoomEnabled('${room.id}')"></div>
      </div>
      <div class="room-desc">${esc(room.desc)}</div>
      <div class="room-boundary" style="${room.color === 'teal' ? 'background:var(--teal-pale);color:var(--teal);' : ''}">
        ${svgIcon(room.color === 'teal' ? '#ic-shield' : '#ic-clock', room.color === 'teal' ? 'var(--teal)' : 'var(--text-muted)', 14)}
        ${room.color === 'teal' ? 'Stronger privacy defaults. Default retention: 90 days.' : `Retrieval boundary: ${esc(room.name)} content only.`}
      </div>
      ${deleteBtn}
    </div>`;
  }).join('');
}

function toggleCreateRoomForm() {
  const form = document.getElementById('create-room-form');
  const toggle = document.getElementById('create-room-toggle');
  if (!form || !toggle) return;
  const showing = form.style.display !== 'none';
  form.style.display = showing ? 'none' : 'block';
  toggle.style.display = showing ? 'flex' : 'none';
}

function createRoom() {
  const nameEl  = document.getElementById('new-room-name');
  const descEl  = document.getElementById('new-room-desc');
  const colorEl = document.getElementById('new-room-color');
  if (!nameEl) return;

  const name = nameEl.value.trim();
  const desc = descEl?.value.trim() || `${name} related memories.`;
  const color = colorEl?.value || 'green';

  if (!name) { alert('Please enter a room name.'); return; }
  if (name.length > 20) { alert('Room name must be 20 characters or less.'); return; }
  if (AppState.rooms.find(r => r.name.toLowerCase() === name.toLowerCase())) {
    alert(`A room named "${name}" already exists.`); return;
  }
  if (AppState.rooms.length >= MAX_ROOMS) {
    alert(`Maximum ${MAX_ROOMS} rooms. Delete a custom room first.`); return;
  }

  const newRoom = {
    id:        'room_' + Date.now(),
    name:      name.charAt(0).toUpperCase() + name.slice(1),
    icon:      '#ic-sparkle',
    color:     color,
    desc:      desc,
    enabled:   true,
    isDefault: false,
  };

  AppState.rooms.push(newRoom);
  AppState.activityLog.unshift(createActivity('added', `Room: ${newRoom.name}`));

  // Clear form and hide
  nameEl.value = '';
  if (descEl) descEl.value = '';
  toggleCreateRoomForm();
  renderAll();
}

function deleteRoom(id) {
  const room = AppState.rooms.find(r => r.id === id);
  if (!room) return;
  if (room.isDefault) { alert('Default rooms cannot be deleted.'); return; }

  const memCount = AppState.memories.filter(m => m.room === room.name).length;
  const msg = memCount > 0
    ? `Delete "${room.name}"? Its ${memCount} memories will be moved to Work.`
    : `Delete "${room.name}"?`;
  if (!confirm(msg)) return;

  // Move memories to Work
  AppState.memories.filter(m => m.room === room.name).forEach(m => { m.room = 'Work'; });
  AppState.rooms = AppState.rooms.filter(r => r.id !== id);
  AppState.activityLog.unshift(createActivity('deleted', `Room: ${room.name}`));

  // Reset vault filter if it was this room
  if (AppState.vaultFilter === room.name) AppState.vaultFilter = 'all';
  renderAll();
}

function toggleRoomEnabled(id) {
  const room = AppState.rooms.find(r => r.id === id);
  if (!room) return;
  room.enabled = !room.enabled;
  renderRooms();
  renderDraftRoomOptions();
  renderVaultTabs();
}

/* -- Privacy activity --------------------------------- */
function renderPrivacyActivity() {
  const el = document.getElementById('privacy-activity-list');
  if (!el) return;
  const recent = AppState.activityLog.slice(0, 5);
  if (recent.length === 0) {
    el.innerHTML = `<div style="padding:16px;text-align:center;font-size:13px;color:var(--text-muted);">No activity yet.</div>`;
    return;
  }
  el.innerHTML = recent.map((a, i) => {
    const icon  = activityIcon(a.type);
    const color = activityColor(a.type);
    const pale  = activityPale(a.type);
    return `<div class="activity-item" ${i===recent.length-1?'style="border-bottom:none;"':''}>
      <div class="act-dot" style="background:${pale};">${svgIcon(icon, color, 12)}</div>
      <div class="act-body"><div class="act-label">${activityLabel(a.type)}</div></div>
      <div class="act-time">${timeAgo(a.timestamp)}</div>
    </div>`;
  }).join('');
}

/* -- Profile ----------------------------------------- */
function renderProfile() {
  if (!AppState.user) return;
  const u = AppState.user;
  setText('profile-avatar',       u.initials);
  setText('profile-name',         u.name);
  setText('profile-email',        u.email);
  setText('profile-row-name',     u.name);
  setText('profile-row-email',    u.email);
  const joined = new Date(u.joinedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  setText('profile-row-joined',   joined);
  setText('profile-stat-memories', AppState.memories.length);
  setText('profile-stat-joined', new Date(u.joinedAt).toLocaleDateString('en-US', { month: 'short' }));
}

/* -- Detail ------------------------------------------ */
function openDetail(id) {
  AppState.selectedMemoryId = id;
  showScreen('screen-detail');
}

function renderDetail() {
  const id  = AppState.selectedMemoryId;
  const mem = AppState.memories.find(m => m.id === id);
  if (!mem) { showScreen('screen-vault'); return; }

  const badgeEl = document.getElementById('detail-status-badge');
  if (badgeEl) {
    badgeEl.textContent  = mem.status === 'active' ? 'Active' : 'Paused';
    badgeEl.className    = `badge ${mem.status === 'active' ? 'green' : 'gray'}`;
  }
  setText('detail-text',      mem.text);
  setText('detail-room',      mem.room);
  setText('detail-retention', mem.retention);
  const created = new Date(mem.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  setText('detail-created', created);

  // Pause/resume button
  const pauseIcon  = document.getElementById('detail-pause-icon');
  const pauseLabel = document.getElementById('detail-pause-label');
  if (pauseIcon && pauseLabel) {
    if (mem.status === 'active') {
      pauseIcon.innerHTML  = '<use href="#ic-pause"/>';
      pauseLabel.textContent = 'Pause';
    } else {
      pauseIcon.innerHTML  = '<use href="#ic-play"/>';
      pauseLabel.textContent = 'Resume';
    }
  }
}

function toggleDetailMemoryPause() {
  togglePauseMemory(AppState.selectedMemoryId);
  renderDetail();
}

function deleteDetailMemory() {
  deleteMemory(AppState.selectedMemoryId);
  AppState.selectedMemoryId = null;
  showScreen('screen-vault');
}

function editDetailMemory() {
  const mem = AppState.memories.find(m => m.id === AppState.selectedMemoryId);
  if (!mem) return;
  const newText = prompt('Edit memory text:', mem.text);
  if (newText && newText.trim()) {
    editMemoryText(mem.id, newText);
    renderDetail();
  }
}

/* -- Admin ------------------------------------------- */
function renderAdmin() {
  if (!AppState.user) return;
  const u    = AppState.user;
  const mems = AppState.memories;
  setText('admin-user-label',  `${u.name} · Owner`);
  setText('admin-email',       u.email);
  setText('admin-uid',         u.id);
  setText('admin-mem-total',   mems.length);
  setText('admin-mem-slots',   `${mems.length} / ${MAX_MEMORIES} used`);
  setText('admin-mem-active',  mems.filter(m => m.status === 'active').length);
  setText('admin-mem-paused',  mems.filter(m => m.status === 'paused').length);

  const lastAct = AppState.activityLog[0];
  setText('admin-last-action', lastAct ? `${activityLabel(lastAct.type)} · ${timeAgo(lastAct.timestamp)}` : 'None');

  const listEl = document.getElementById('admin-memory-list');
  if (!listEl) return;
  if (mems.length === 0) {
    listEl.innerHTML = `<div style="padding:16px;text-align:center;font-size:13px;color:var(--text-muted);">No memories saved yet.</div>`;
    return;
  }
  listEl.innerHTML = mems.map((m, i) => `
    <div class="admin-row" ${i===mems.length-1?'style="border-bottom:none;"':''}>
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.text)}</div>
        <div style="font-size:10px;color:var(--text-muted);">${m.room} · ${m.retention} · ${m.status}</div>
      </div>
      <button onclick="deleteMemory('${m.id}')" style="background:var(--red-pale);color:var(--red);border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">Delete</button>
    </div>`).join('');
}

function deleteAllMemories() {
  if (AppState.memories.length === 0) { alert('No memories to delete.'); return; }
  if (confirm(`Delete all ${AppState.memories.length} memories? This cannot be undone.`)) {
    AppState.memories.forEach(m => AppState.activityLog.unshift(createActivity('deleted', m.text)));
    AppState.memories = [];
    renderAll();
  }
}

/* -- renderAll ---------------------------------------- */
function renderAll() {
  renderHome();
  renderVaultTabs();
  renderVault();
  renderQueue();
  renderRooms();
  renderDraftRoomOptions();
  renderPrivacyActivity();
  renderProfile();
  renderAdmin();
}

/* ════════════════════════════════════════════════
   10. UTILITY
════════════════════════════════════════════════ */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ════════════════════════════════════════════════
   11. TOGGLES
════════════════════════════════════════════════ */
function initToggles() {
  // Toggles inside the Privacy Center (not rooms — those are handled by toggleRoomEnabled)
  document.addEventListener('click', e => {
    const toggleEl = e.target.classList.contains('toggle') ? e.target : e.target.closest('.toggle');
    if (!toggleEl) return;
    // Skip toggles inside #rooms-list — those are handled programmatically
    if (toggleEl.closest('#rooms-list')) return;
    toggleEl.classList.toggle('off');
  });
}

/* ════════════════════════════════════════════════
   12. FILTER TABS (static ones in privacy etc.)
════════════════════════════════════════════════ */
function initStaticFilterTabs() {
  document.querySelectorAll('.filter-tabs').forEach(group => {
    group.querySelectorAll('.filter-tab').forEach(tab => {
      if (!tab.hasAttribute('onclick')) {
        tab.addEventListener('click', () => {
          group.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
        });
      }
    });
  });
}

/* ════════════════════════════════════════════════
   13. LIVE CLOCK
════════════════════════════════════════════════ */
function initClock() {
  function tick() {
    const now = new Date();
    const h   = now.getHours();
    const m   = now.getMinutes().toString().padStart(2, '0');
    document.querySelectorAll('.time').forEach(el => { el.textContent = `${h % 12 || 12}:${m}`; });
  }
  tick();
  setInterval(tick, 30000);
}

/* ════════════════════════════════════════════════
   14. KEYBOARD + SWIPE NAV
════════════════════════════════════════════════ */
function initKeyboardNav() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const cur = document.querySelector('.screen.active');
      if (cur?.id === 'screen-login') { handleLogin(); return; }
      if (cur?.id === 'screen-chat')  { sendChatMessage(); return; }
    }
  });
}

function initSwipeNav() {
  const phone = document.querySelector('.phone');
  if (!phone) return;
  let startX = 0;
  phone.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  phone.addEventListener('touchend', e => {
    const cur = document.querySelector('.screen.active');
    if (!cur || cur.id === 'screen-splash' || cur.id === 'screen-login') return;
    const dx  = e.changedTouches[0].clientX - startX;
    const idx = SCREEN_ORDER.indexOf(cur.id);
    if (Math.abs(dx) < 60) return;
    if (dx < 0 && idx < SCREEN_ORDER.length - 1) showScreen(SCREEN_ORDER[idx + 1]);
    if (dx > 0 && idx > 0) showScreen(SCREEN_ORDER[idx - 1]);
  }, { passive: true });
}

/* ════════════════════════════════════════════════
   15. SPLASH AUTO-ADVANCE
════════════════════════════════════════════════ */
function initSplashTimer() {
  setTimeout(() => {
    const cur = document.querySelector('.screen.active');
    if (cur?.id === 'screen-splash') showScreen('screen-login');
  }, 2800);
}

/* ════════════════════════════════════════════════
   16. BOOT
════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initToggles();
  initStaticFilterTabs();
  initKeyboardNav();
  initSwipeNav();
  initSplashTimer();
  showScreen('screen-splash');
});
