const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { load, save } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8603347529:AAFkQm7i8vjR67-U1LHyQdqSPTRsVuyvPjg';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '714460753';

const RATES = { PS3: 2000, PS4: 3000, PS5: 5000 };

const BRANCHES = [
  { id: 1, name: 'Gamers Galaxy Kajjansi', stations: 6 },
  { id: 2, name: 'Gamers Galaxy Kitende', stations: 5 },
  { id: 3, name: 'Gamers Galaxy Ndejje',  stations: 4 }
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Telegram ---
async function sendTelegram(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

// --- Helpers ---
function formatDuration(minutes) {
  const hrs = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return hrs > 0 ? `${hrs}hr ${mins}min` : `${mins}min`;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala'
  });
}

function kampalaDateStr(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' }); // YYYY-MM-DD
}

function formatDateDisplay(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function sessionDateKampala(session) {
  return new Date(session.end_time).toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' });
}

function branchName(branchId) {
  return BRANCHES.find(b => b.id === branchId)?.name || `Branch ${branchId}`;
}

// --- Report builders ---
function buildDailyStats(branchId, dateStr) {
  const { sessions } = load();
  const filtered = sessions.filter(s =>
    s.status === 'completed' &&
    s.end_time &&
    (s.branch_id === branchId || (!s.branch_id && branchId === 1)) &&
    sessionDateKampala(s) === dateStr
  );

  const total = {
    sessions: filtered.length,
    revenue: filtered.reduce((sum, s) => sum + (s.amount_ugx || 0), 0)
  };

  const byConsole = ['PS3', 'PS4', 'PS5'].map(type => ({
    console_type: type,
    sessions: filtered.filter(s => s.console_type === type).length,
    revenue: filtered.filter(s => s.console_type === type).reduce((sum, s) => sum + (s.amount_ugx || 0), 0)
  })).filter(c => c.sessions > 0);

  return { total, byConsole };
}

function buildWeeklyStats(branchId, dates) {
  const { sessions } = load();
  const filtered = sessions.filter(s =>
    s.status === 'completed' &&
    s.end_time &&
    (s.branch_id === branchId || (!s.branch_id && branchId === 1)) &&
    dates.includes(sessionDateKampala(s))
  );

  return {
    sessions: filtered.length,
    revenue: filtered.reduce((sum, s) => sum + (s.amount_ugx || 0), 0)
  };
}

// --- Scheduled Reports ---

// Daily report at 11:59 PM EAT, one message per branch
cron.schedule('59 23 * * *', async () => {
  const today = kampalaDateStr();
  const dateDisplay = formatDateDisplay(today);

  for (const branch of BRANCHES) {
    const { total, byConsole } = buildDailyStats(branch.id, today);

    let msg = `📊 <b>Daily Report</b>\n`;
    msg += `📍 ${branch.name}\n`;
    msg += `📅 ${dateDisplay}\n\n`;

    if (total.sessions === 0) {
      msg += `No sessions recorded today.`;
    } else {
      msg += `🕹 Sessions: <b>${total.sessions}</b>\n`;
      msg += `💰 Revenue: <b>UGX ${total.revenue.toLocaleString()}</b>\n`;

      if (byConsole.length > 0) {
        msg += `\n<b>By Console:</b>\n`;
        byConsole.forEach(c => {
          msg += `  ${c.console_type}: ${c.sessions} session${c.sessions !== 1 ? 's' : ''} — UGX ${c.revenue.toLocaleString()}\n`;
        });
      }
    }

    await sendTelegram(msg);
  }
}, { timezone: 'Africa/Kampala' });

// Weekly report every Sunday at 11:59 PM EAT
cron.schedule('59 23 * * 0', async () => {
  // Last 7 days including today
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(kampalaDateStr(d));
  }

  const startDisplay = formatDateDisplay(dates[6]);
  const endDisplay = formatDateDisplay(dates[0]);

  let allSessions = 0;
  let allRevenue = 0;
  let branchLines = '';

  for (const branch of BRANCHES) {
    const stats = buildWeeklyStats(branch.id, dates);
    allSessions += stats.sessions;
    allRevenue += stats.revenue;
    branchLines += `  📍 ${branch.name}: ${stats.sessions} sessions — UGX ${stats.revenue.toLocaleString()}\n`;
  }

  let msg = `📈 <b>Weekly Report</b>\n`;
  msg += `📅 ${startDisplay} → ${endDisplay}\n\n`;
  msg += branchLines;
  msg += `\n<b>All Branches Total:</b>\n`;
  msg += `🕹 ${allSessions} sessions\n`;
  msg += `💰 UGX ${allRevenue.toLocaleString()}`;

  await sendTelegram(msg);
}, { timezone: 'Africa/Kampala' });

// --- API Routes ---

// List branches
app.get('/api/branches', (req, res) => {
  res.json(BRANCHES);
});

// Get stations for a branch
app.get('/api/stations', (req, res) => {
  const branchId = Number(req.query.branch);
  const branch = BRANCHES.find(b => b.id === branchId);
  if (!branch) return res.status(400).json({ error: 'Invalid branch' });

  const { sessions } = load();
  const stations = [];
  for (let i = 1; i <= branch.stations; i++) {
    const session = sessions.find(s =>
      (s.branch_id === branchId || (!s.branch_id && branchId === 1)) &&
      s.station_id === i &&
      s.status === 'active'
    ) || null;
    stations.push({ station_id: i, session });
  }
  res.json(stations);
});

// Start a session
app.post('/api/sessions/start', (req, res) => {
  const { branch_id, station_id, console_type } = req.body;

  if (!RATES[console_type]) return res.status(400).json({ error: 'Invalid console type' });
  if (!BRANCHES.find(b => b.id === branch_id)) return res.status(400).json({ error: 'Invalid branch' });

  const db = load();
  const existing = db.sessions.find(s =>
    (s.branch_id === branch_id || (!s.branch_id && branch_id === 1)) &&
    s.station_id === station_id &&
    s.status === 'active'
  );
  if (existing) return res.status(400).json({ error: 'Station already has an active session' });

  const session = {
    id: db.nextId++,
    branch_id,
    station_id,
    console_type,
    start_time: new Date().toISOString(),
    end_time: null,
    duration_minutes: null,
    amount_ugx: null,
    status: 'active'
  };

  db.sessions.push(session);
  save(db);

  sendTelegram(
    `🟢 <b>Session Started</b>\n\n` +
    `📍 ${branchName(branch_id)}\n` +
    `📺 Station ${station_id}\n` +
    `🕹 Console: ${console_type}\n` +
    `⏰ Started: ${formatTime(session.start_time)}\n` +
    `💵 Rate: UGX ${RATES[console_type].toLocaleString()}/hr`
  );

  res.json(session);
});

// End a session
app.post('/api/sessions/end/:id', (req, res) => {
  const db = load();
  const session = db.sessions.find(s => s.id === Number(req.params.id) && s.status === 'active');

  if (!session) return res.status(404).json({ error: 'Active session not found' });

  const endTime = new Date();
  const durationMinutes = (endTime - new Date(session.start_time)) / 60000;
  const amount = Math.ceil((durationMinutes / 60) * RATES[session.console_type]);

  session.end_time = endTime.toISOString();
  session.duration_minutes = durationMinutes;
  session.amount_ugx = amount;
  session.status = 'completed';

  save(db);

  sendTelegram(
    `🔴 <b>Session Ended</b>\n\n` +
    `📍 ${branchName(session.branch_id || 1)}\n` +
    `📺 Station ${session.station_id}\n` +
    `🕹 Console: ${session.console_type}\n` +
    `⏱ Duration: ${formatDuration(durationMinutes)}\n` +
    `💰 Amount: UGX ${amount.toLocaleString()}\n` +
    `🕐 Ended: ${formatTime(endTime.toISOString())}`
  );

  res.json(session);
});

// Session history for a branch (last 50)
app.get('/api/sessions/history', (req, res) => {
  const branchId = Number(req.query.branch);
  const { sessions } = load();
  const completed = sessions
    .filter(s =>
      s.status === 'completed' &&
      (s.branch_id === branchId || (!s.branch_id && branchId === 1))
    )
    .sort((a, b) => new Date(b.end_time) - new Date(a.end_time))
    .slice(0, 50);
  res.json(completed);
});

// Today's stats for a branch
app.get('/api/stats/today', (req, res) => {
  const branchId = Number(req.query.branch);
  const today = kampalaDateStr();
  const { total, byConsole } = buildDailyStats(branchId, today);
  res.json({ by_console: byConsole, total });
});

app.listen(PORT, () => {
  console.log(`\n🎮 Gamers Galaxy Billing running at http://localhost:${PORT}\n`);
});
