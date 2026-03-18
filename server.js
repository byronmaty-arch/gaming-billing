const express = require('express');
const path = require('path');
const { load, save } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8603347529:AAFkQm7i8vjR67-U1LHyQdqSPTRsVuyvPjg';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '714460753';

const RATES = { PS3: 2000, PS4: 3000, PS5: 5000 };
const STATION_COUNT = 6;

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

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' }); // YYYY-MM-DD
}

// --- Routes ---

// Get all station statuses
app.get('/api/stations', (req, res) => {
  const { sessions } = load();
  const stations = [];
  for (let i = 1; i <= STATION_COUNT; i++) {
    const session = sessions.find(s => s.station_id === i && s.status === 'active') || null;
    stations.push({ station_id: i, session });
  }
  res.json(stations);
});

// Start a session
app.post('/api/sessions/start', (req, res) => {
  const { station_id, console_type } = req.body;

  if (!RATES[console_type]) {
    return res.status(400).json({ error: 'Invalid console type' });
  }

  const db = load();
  const existing = db.sessions.find(s => s.station_id === station_id && s.status === 'active');
  if (existing) {
    return res.status(400).json({ error: 'Station already has an active session' });
  }

  const session = {
    id: db.nextId++,
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

  if (!session) {
    return res.status(404).json({ error: 'Active session not found' });
  }

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
    `📺 Station ${session.station_id}\n` +
    `🕹 Console: ${session.console_type}\n` +
    `⏱ Duration: ${formatDuration(durationMinutes)}\n` +
    `💰 Amount: UGX ${amount.toLocaleString()}\n` +
    `🕐 Ended: ${formatTime(endTime.toISOString())}`
  );

  res.json(session);
});

// Session history (last 50 completed)
app.get('/api/sessions/history', (req, res) => {
  const { sessions } = load();
  const completed = sessions
    .filter(s => s.status === 'completed')
    .sort((a, b) => new Date(b.end_time) - new Date(a.end_time))
    .slice(0, 50);
  res.json(completed);
});

// Today's stats
app.get('/api/stats/today', (req, res) => {
  const { sessions } = load();
  const today = todayStr();
  const todaySessions = sessions.filter(s => {
    if (s.status !== 'completed' || !s.end_time) return false;
    const endKampala = new Date(s.end_time).toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' });
    return endKampala === today;
  });

  const total = {
    sessions: todaySessions.length,
    revenue: todaySessions.reduce((sum, s) => sum + (s.amount_ugx || 0), 0)
  };

  const byConsole = ['PS3', 'PS4', 'PS5'].map(type => ({
    console_type: type,
    sessions: todaySessions.filter(s => s.console_type === type).length,
    revenue: todaySessions.filter(s => s.console_type === type).reduce((sum, s) => sum + (s.amount_ugx || 0), 0)
  })).filter(c => c.sessions > 0);

  res.json({ by_console: byConsole, total });
});

app.listen(PORT, () => {
  console.log(`\n🎮 Gaming Billing System running at http://localhost:${PORT}\n`);
});
