const RATES = { PS3: 2000, PS4: 3000, PS5: 5000 };

let currentBranch = null;   // { id, name, stations }
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

// --- Branch Selection ---

async function initBranchScreen() {
  const res = await fetch('/api/branches');
  const branches = await res.json();

  const list = document.getElementById('branch-list');
  list.innerHTML = branches.map(b => `
    <button class="branch-btn" onclick="selectBranch(${b.id}, '${b.name}', ${b.stations})">
      <span>${b.name}</span>
      <span class="branch-meta">${b.stations} stations</span>
    </button>
  `).join('');

  // Auto-restore last branch from localStorage
  const savedId = localStorage.getItem('branch_id');
  if (savedId) {
    const saved = branches.find(b => b.id === Number(savedId));
    if (saved) {
      selectBranch(saved.id, saved.name, saved.stations);
      return;
    }
  }

  document.getElementById('branch-screen').classList.remove('hidden');
}

function selectBranch(id, name, stationCount) {
  currentBranch = { id, name, stations: stationCount };
  localStorage.setItem('branch_id', id);

  document.getElementById('branch-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('branch-title').textContent = `🎮 ${name}`;

  loadAll();
}

function switchBranch() {
  localStorage.removeItem('branch_id');
  currentBranch = null;
  stations = [];
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('branch-screen').classList.remove('hidden');
}

// --- Render Stations ---

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

// --- Live Timers ---

function updateTimers() {
  stations.forEach(({ station_id, session }) => {
    if (!session) return;
    const timerEl = document.getElementById(`timer-${station_id}`);
    const billEl = document.getElementById(`bill-${station_id}`);
    if (timerEl) timerEl.textContent = formatTimer(session.start_time);
    if (billEl) billEl.textContent = `UGX ${calcRunningBill(session.console_type, session.start_time).toLocaleString()}`;
  });
}

// --- API Calls ---

async function loadStations() {
  const res = await fetch(`/api/stations?branch=${currentBranch.id}`);
  const data = await res.json();
  renderStations(data);
}

async function loadStats() {
  const res = await fetch(`/api/stats/today?branch=${currentBranch.id}`);
  const { total } = await res.json();
  document.getElementById('total-sessions').textContent =
    `${total.sessions} session${total.sessions !== 1 ? 's' : ''} today`;
  document.getElementById('total-revenue').textContent =
    `UGX ${Number(total.revenue).toLocaleString()} today`;
}

async function loadHistory() {
  const res = await fetch(`/api/sessions/history?branch=${currentBranch.id}`);
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
  try {
    await Promise.all([loadStations(), loadStats(), loadHistory()]);
  } catch (e) {
    console.error('Load error:', e);
  }
}

async function startSession() {
  if (!pendingStationId || !selectedConsole) return;

  try {
    const res = await fetch('/api/sessions/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch_id: currentBranch.id,
        station_id: pendingStationId,
        console_type: selectedConsole
      })
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to start session');
      return;
    }

    closeModal();
    await loadAll();
  } catch (e) {
    alert('Network error. Please try again.');
  }
}

async function endSession(sessionId, stationId) {
  if (!confirm(`End session for Station ${stationId}?`)) return;

  try {
    const res = await fetch(`/api/sessions/end/${sessionId}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to end session');
      return;
    }
    await loadAll();
  } catch (e) {
    alert('Network error. Please try again.');
  }
}

// --- Modal ---

function openModal(stationId) {
  pendingStationId = stationId;
  selectedConsole = null;
  document.getElementById('modal-station-label').textContent =
    `${currentBranch.name} — Station ${stationId}`;
  document.querySelectorAll('.console-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('modal-confirm').disabled = true;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
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

// --- Init ---

setInterval(updateTimers, 1000);
setInterval(() => { if (currentBranch) loadAll(); }, 15000);

initBranchScreen();
