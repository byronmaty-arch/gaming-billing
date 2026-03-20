const RATES = { PS3: 2000, PS4: 3000, PS5: 5000 };

let currentBranch = null;   // { id, name, stations }
let currentPasscode = null; // stored for API calls
let currentRole = null;     // 'staff' | 'admin'
let pendingBranch = null;   // branch clicked before passcode entered
let stations = [];
let selectedConsole = null;
let pendingStationId = null;

// --- Helpers ---
function formatTimer(startIso) {
  const elapsed = Math.floor((Date.now() - new Date(startIso)) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return h > 0 ? `${h}hr ${m}min` : `${m}min`;
}

function calcRunningBill(consoleType, startIso) {
  const minutes = (Date.now() - new Date(startIso)) / 60000;
  return Math.ceil((minutes / 60) * RATES[consoleType]);
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala'
  });
}

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'X-Passcode': currentPasscode };
}

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

// --- Screen navigation ---
function showScreen(screenId) {
  ['branch-screen', 'passcode-screen', 'admin-screen', 'dashboard'].forEach(hide);
  show(screenId);
}

// --- Session storage ---
function saveSession() {
  sessionStorage.setItem('gg_role', currentRole);
  sessionStorage.setItem('gg_passcode', currentPasscode);
  if (currentBranch) sessionStorage.setItem('gg_branch', JSON.stringify(currentBranch));
}

function loadSession() {
  const role = sessionStorage.getItem('gg_role');
  const passcode = sessionStorage.getItem('gg_passcode');
  if (!role || !passcode) return false;
  currentRole = role;
  currentPasscode = passcode;
  if (role === 'admin') {
    enterAdmin();
  } else {
    const branch = JSON.parse(sessionStorage.getItem('gg_branch') || 'null');
    if (branch) {
      currentBranch = branch;
      enterBranchDashboard();
    }
  }
  return true;
}

function logout() {
  sessionStorage.clear();
  currentRole = null;
  currentPasscode = null;
  currentBranch = null;
  stations = [];
  showScreen('branch-screen');
}

// --- Branch selector ---
async function initBranchScreen() {
  const res = await fetch('/api/branches');
  const branches = await res.json();

  const list = document.getElementById('branch-list');
  list.innerHTML = branches.map(b => `
    <button class="branch-btn" onclick="onBranchClick(${b.id}, '${b.name}', ${b.stations})">
      <span>${b.name}</span>
      <span class="branch-meta">${b.stations} stations</span>
    </button>
  `).join('');
}

function onBranchClick(id, name, stationCount) {
  pendingBranch = { id, name, stations: stationCount };
  document.getElementById('passcode-title').textContent = name;
  document.getElementById('passcode-subtitle').textContent = 'Enter your branch passcode';
  document.getElementById('passcode-input').value = '';
  document.getElementById('passcode-error').classList.add('hidden');
  showScreen('passcode-screen');
  document.getElementById('passcode-input').focus();
}

function showAdminPasscode() {
  pendingBranch = null;
  document.getElementById('passcode-title').textContent = 'Admin Access';
  document.getElementById('passcode-subtitle').textContent = 'Enter admin passcode';
  document.getElementById('passcode-input').value = '';
  document.getElementById('passcode-error').classList.add('hidden');
  showScreen('passcode-screen');
  document.getElementById('passcode-input').focus();
}

function backToBranches() {
  pendingBranch = null;
  showScreen('branch-screen');
}

// --- Passcode submission ---
async function submitPasscode() {
  const passcode = document.getElementById('passcode-input').value.trim();
  if (!passcode) return;

  const errorEl = document.getElementById('passcode-error');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode, branch_id: pendingBranch?.id || null })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      errorEl.textContent = data.error || 'Incorrect passcode. Please try again.';
      errorEl.classList.remove('hidden');
      document.getElementById('passcode-input').value = '';
      document.getElementById('passcode-input').focus();
      return;
    }

    currentPasscode = passcode;
    currentRole = data.role;

    if (data.role === 'admin') {
      currentBranch = null;
      saveSession();
      enterAdmin();
    } else {
      currentBranch = pendingBranch;
      saveSession();
      enterBranchDashboard();
    }
  } catch (e) {
    errorEl.textContent = 'Network error. Please try again.';
    errorEl.classList.remove('hidden');
  }
}

// Allow Enter key on passcode input
document.getElementById('passcode-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPasscode();
});

// --- Branch Dashboard ---
function enterBranchDashboard() {
  document.getElementById('branch-title').textContent = `${currentBranch.name}`;
  showScreen('dashboard');
  loadAll();
}

function renderStations(data) {
  stations = data;
  const grid = document.getElementById('stations-grid');
  grid.innerHTML = '';

  data.forEach(({ station_id, session }) => {
    const card = document.createElement('div');
    card.className = `station-card ${session ? 'active' : ''}`;
    card.id = `station-${station_id}`;

    if (session) {
      card.innerHTML = `
        <div class="station-header">
          <span class="station-title">Station ${station_id}</span>
          <span class="status-badge active">Active</span>
        </div>
        <span class="console-tag ${session.console_type}">${session.console_type}</span>
        <div class="timer-display" id="timer-${station_id}">00:00:00</div>
        <div class="running-bill" id="bill-${station_id}">UGX 0</div>
        <button class="btn-stop" onclick="endSession(${session.id}, ${station_id})">
          Stop &amp; Bill
        </button>
      `;
    } else {
      card.innerHTML = `
        <div class="station-header">
          <span class="station-title">Station ${station_id}</span>
          <span class="status-badge idle">Idle</span>
        </div>
        <div class="idle-text">No active session</div>
        <button class="btn-start" onclick="openModal(${station_id})">
          Start Session
        </button>
      `;
    }
    grid.appendChild(card);
  });
}

function updateTimers() {
  stations.forEach(({ station_id, session }) => {
    if (!session) return;
    const timerEl = document.getElementById(`timer-${station_id}`);
    const billEl = document.getElementById(`bill-${station_id}`);
    if (timerEl) timerEl.textContent = formatTimer(session.start_time);
    if (billEl) billEl.textContent = `UGX ${calcRunningBill(session.console_type, session.start_time).toLocaleString()}`;
  });
}

async function loadStations() {
  const res = await fetch(`/api/stations?branch=${currentBranch.id}`, { headers: apiHeaders() });
  if (res.status === 401) { logout(); return; }
  renderStations(await res.json());
}

async function loadStats() {
  const res = await fetch(`/api/stats/today?branch=${currentBranch.id}`, { headers: apiHeaders() });
  if (res.status === 401) { logout(); return; }
  const { total } = await res.json();
  document.getElementById('total-sessions').textContent =
    `${total.sessions} session${total.sessions !== 1 ? 's' : ''} today`;
  document.getElementById('total-revenue').textContent =
    `UGX ${Number(total.revenue).toLocaleString()} today`;
}

async function loadHistory() {
  const res = await fetch(`/api/sessions/history?branch=${currentBranch.id}`, { headers: apiHeaders() });
  if (res.status === 401) { logout(); return; }
  const sessions = await res.json();
  const tbody = document.getElementById('history-body');
  if (sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No completed sessions yet</td></tr>`;
    return;
  }
  tbody.innerHTML = sessions.map(s => `
    <tr>
      <td>Station ${s.station_id}</td>
      <td><span class="console-tag ${s.console_type}">${s.console_type}</span></td>
      <td>${formatDuration(s.duration_minutes)}</td>
      <td class="amount-cell">UGX ${s.amount_ugx.toLocaleString()}</td>
      <td>${formatTime(s.end_time)}</td>
    </tr>
  `).join('');
}

async function loadAll() {
  try { await Promise.all([loadStations(), loadStats(), loadHistory()]); }
  catch (e) { console.error('Load error:', e); }
}

async function startSession() {
  if (!pendingStationId || !selectedConsole) return;
  try {
    const res = await fetch('/api/sessions/start', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ branch_id: currentBranch.id, station_id: pendingStationId, console_type: selectedConsole })
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) { alert((await res.json()).error || 'Failed to start session'); return; }
    closeModal();
    await loadAll();
  } catch (e) { alert('Network error. Please try again.'); }
}

async function endSession(sessionId, stationId) {
  if (!confirm(`End session for Station ${stationId}?`)) return;
  try {
    const res = await fetch(`/api/sessions/end/${sessionId}`, { method: 'POST', headers: apiHeaders() });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) { alert((await res.json()).error || 'Failed to end session'); return; }
    await loadAll();
  } catch (e) { alert('Network error. Please try again.'); }
}

// --- Modal ---
function openModal(stationId) {
  pendingStationId = stationId;
  selectedConsole = null;
  document.getElementById('modal-station-label').textContent = `${currentBranch.name} — Station ${stationId}`;
  document.querySelectorAll('.console-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('modal-confirm').disabled = true;
  show('modal-overlay');
}

function closeModal() {
  hide('modal-overlay');
  pendingStationId = null;
  selectedConsole = null;
}

document.querySelectorAll('.console-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.console-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedConsole = btn.dataset.console;
    document.getElementById('modal-confirm').disabled = false;
  });
});

document.getElementById('modal-confirm').addEventListener('click', startSession);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// --- Admin Dashboard ---
function enterAdmin() {
  showScreen('admin-screen');
  loadAdminSummary();
}

async function loadAdminSummary() {
  try {
    const res = await fetch('/api/admin/summary', { headers: apiHeaders() });
    if (res.status === 401) { logout(); return; }
    const { branches, total } = await res.json();

    document.getElementById('admin-total-active').textContent = `${total.active} active`;
    document.getElementById('admin-total-revenue').textContent = `UGX ${total.revenue.toLocaleString()} today`;

    document.getElementById('admin-branch-cards').innerHTML = branches.map(b => `
      <div class="admin-branch-card" onclick="adminEnterBranch(${b.id}, '${b.name}', ${b.stations})">
        <h3>${b.name}</h3>
        <div class="admin-stat-row">
          <span class="label">Active now</span>
          <span class="value yellow">${b.active_sessions} session${b.active_sessions !== 1 ? 's' : ''}</span>
        </div>
        <div class="admin-stat-row">
          <span class="label">Today's sessions</span>
          <span class="value">${b.today_sessions}</span>
        </div>
        <div class="admin-stat-row">
          <span class="label">Today's revenue</span>
          <span class="value green">UGX ${b.today_revenue.toLocaleString()}</span>
        </div>
      </div>
    `).join('');
  } catch (e) { console.error('Admin load error:', e); }
}

function adminEnterBranch(id, name, stationCount) {
  currentBranch = { id, name, stations: stationCount };
  document.getElementById('branch-title').textContent = `🎮 ${name}`;
  // Replace logout with back-to-admin
  document.getElementById('logout-btn').textContent = '← All Branches';
  document.getElementById('logout-btn').onclick = () => {
    currentBranch = null;
    document.getElementById('logout-btn').textContent = 'Logout';
    document.getElementById('logout-btn').onclick = logout;
    enterAdmin();
  };
  showScreen('dashboard');
  loadAll();
}

// --- Timers & polling ---
setInterval(updateTimers, 1000);
setInterval(() => {
  if (currentRole === 'staff' && currentBranch) loadAll();
  if (currentRole === 'admin' && !currentBranch) loadAdminSummary();
}, 15000);

// --- Init ---
async function init() {
  await initBranchScreen();
  if (!loadSession()) {
    showScreen('branch-screen');
  }
}

init();
