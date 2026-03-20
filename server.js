const express = require('express');
const path    = require('path');
const cron    = require('node-cron');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN   = process.env.TELEGRAM_TOKEN   || '8603347529:AAFkQm7i8vjR67-U1LHyQdqSPTRsVuyvPjg';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '714460753';

const RATES = { PS3: 2000, PS4: 3000, PS5: 5000 };

const BRANCHES = [
  { id: 1, name: 'Gamers Galaxy Kajjansi', stations: 6, isTest: false },
  { id: 2, name: 'Gamers Galaxy Kitende',  stations: 5, isTest: false },
  { id: 3, name: 'Gamers Galaxy Ndejje',   stations: 4, isTest: false },
  { id: 4, name: 'Testing Site',           stations: 3, isTest: true  }
];

const REAL_BRANCHES = BRANCHES.filter(b => !b.isTest);

const PASSCODES = {
  1:     process.env.PASSCODE_B1    || 'kajjansi1',
  2:     process.env.PASSCODE_B2    || 'kitende2',
  3:     process.env.PASSCODE_B3    || 'ndejje3',
  4:     process.env.PASSCODE_TEST  || 'testing123',
  admin: process.env.PASSCODE_ADMIN || 'admin0'
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAdminPasscode(p)  { return p === PASSCODES.admin; }

function branchForPasscode(p) {
  for (const b of BRANCHES) if (p === PASSCODES[b.id]) return b.id;
  return null;
}

function requireBranchAccess(req, res, next) {
  const pc = req.headers['x-passcode'];
  if (!pc) return res.status(401).json({ error: 'Passcode required' });
  if (isAdminPasscode(pc)) return next();
  const branchId = Number(req.query.branch || req.body?.branch_id);
  if (branchId && pc === PASSCODES[branchId]) return next();
  return res.status(401).json({ error: 'Incorrect passcode' });
}

function requireAdmin(req, res, next) {
  const pc = req.headers['x-passcode'];
  if (pc && isAdminPasscode(pc)) return next();
  return res.status(401).json({ error: 'Admin access required' });
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(message) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
    });
  } catch (err) { console.error('Telegram error:', err.message); }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60), m = Math.floor(minutes % 60);
  return h > 0 ? `${h}hr ${m}min` : `${m}min`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-UG', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala'
  });
}

function kampalaDateStr(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Kampala' });
}

function formatDateDisplay(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-UG', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function branchName(id) {
  return BRANCHES.find(b => b.id === id)?.name || `Branch ${id}`;
}

// ─── Report builders ─────────────────────────────────────────────────────────

async function buildDailyStats(branchId, dateStr) {
  const { rows } = await db.query(`
    SELECT
      console_type,
      COUNT(*)                    AS sessions,
      COALESCE(SUM(amount_ugx),0) AS revenue
    FROM sessions
    WHERE branch_id = $1
      AND status    = 'completed'
      AND (end_time AT TIME ZONE 'Africa/Kampala')::date = $2::date
    GROUP BY console_type
  `, [branchId, dateStr]);

  const total = {
    sessions: rows.reduce((s, r) => s + parseInt(r.sessions), 0),
    revenue:  rows.reduce((s, r) => s + parseInt(r.revenue),  0)
  };
  const byConsole = rows.map(r => ({
    console_type: r.console_type,
    sessions: parseInt(r.sessions),
    revenue:  parseInt(r.revenue)
  }));
  return { total, byConsole };
}

async function buildWeeklyStats(branchId, startDate, endDate) {
  const { rows } = await db.query(`
    SELECT
      COUNT(*)                    AS sessions,
      COALESCE(SUM(amount_ugx),0) AS revenue
    FROM sessions
    WHERE branch_id = $1
      AND status    = 'completed'
      AND (end_time AT TIME ZONE 'Africa/Kampala')::date BETWEEN $2::date AND $3::date
  `, [branchId, startDate, endDate]);
  return { sessions: parseInt(rows[0].sessions), revenue: parseInt(rows[0].revenue) };
}

// ─── Scheduled Reports ───────────────────────────────────────────────────────

// Daily — 11:59 PM EAT every day
cron.schedule('59 23 * * *', async () => {
  const today = kampalaDateStr();
  for (const branch of REAL_BRANCHES) {
    const { total, byConsole } = await buildDailyStats(branch.id, today);
    let msg = `📊 <b>Daily Report</b>\n📍 ${branch.name}\n📅 ${formatDateDisplay(today)}\n\n`;
    if (total.sessions === 0) {
      msg += `No sessions recorded today.`;
    } else {
      msg += `🕹 Sessions: <b>${total.sessions}</b>\n💰 Revenue: <b>UGX ${total.revenue.toLocaleString()}</b>`;
      if (byConsole.length) {
        msg += `\n\n<b>By Console:</b>\n`;
        byConsole.forEach(c => {
          msg += `  ${c.console_type}: ${c.sessions} session${c.sessions !== 1 ? 's' : ''} — UGX ${c.revenue.toLocaleString()}\n`;
        });
      }
    }
    await sendTelegram(msg);
  }
}, { timezone: 'Africa/Kampala' });

// Weekly — 11:59 PM EAT every Sunday
cron.schedule('59 23 * * 0', async () => {
  const endDate   = kampalaDateStr();
  const startDate = kampalaDateStr(new Date(Date.now() - 6 * 864e5));
  let allSessions = 0, allRevenue = 0, lines = '';
  for (const branch of REAL_BRANCHES) {
    const s = await buildWeeklyStats(branch.id, startDate, endDate);
    allSessions += s.sessions;
    allRevenue  += s.revenue;
    lines += `  📍 ${branch.name}: ${s.sessions} sessions — UGX ${s.revenue.toLocaleString()}\n`;
  }
  const msg =
    `📈 <b>Weekly Report</b>\n📅 ${formatDateDisplay(startDate)} → ${formatDateDisplay(endDate)}\n\n` +
    lines +
    `\n<b>All Branches Total:</b>\n🕹 ${allSessions} sessions\n💰 UGX ${allRevenue.toLocaleString()}`;
  await sendTelegram(msg);
}, { timezone: 'Africa/Kampala' });

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/auth', (req, res) => {
  const { passcode, branch_id } = req.body;
  if (!passcode) return res.status(400).json({ error: 'Passcode required' });
  if (isAdminPasscode(passcode)) return res.json({ success: true, role: 'admin' });
  const matched = branchForPasscode(passcode);
  if (matched) {
    if (branch_id && matched !== branch_id) return res.status(401).json({ error: 'Incorrect passcode' });
    return res.json({ success: true, role: 'staff', branch_id: matched });
  }
  return res.status(401).json({ error: 'Incorrect passcode' });
});

app.get('/api/branches', (req, res) => res.json(BRANCHES));

app.get('/api/admin/summary', requireAdmin, async (req, res) => {
  try {
    const today   = kampalaDateStr();
    const summary = await Promise.all(BRANCHES.map(async branch => {
      const [{ rows: ar }, { total }] = await Promise.all([
        db.query(`SELECT COUNT(*) AS count FROM sessions WHERE branch_id=$1 AND status='active'`, [branch.id]),
        buildDailyStats(branch.id, today)
      ]);
      return { ...branch, active_sessions: parseInt(ar[0].count), today_sessions: total.sessions, today_revenue: total.revenue };
    }));
    const realOnly = summary.filter(b => !b.isTest);
    res.json({
      branches: summary,
      total: {
        active:   realOnly.reduce((s, b) => s + b.active_sessions,  0),
        sessions: realOnly.reduce((s, b) => s + b.today_sessions,   0),
        revenue:  realOnly.reduce((s, b) => s + b.today_revenue,    0)
      }
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/stations', requireBranchAccess, async (req, res) => {
  try {
    const branchId = Number(req.query.branch);
    const branch   = BRANCHES.find(b => b.id === branchId);
    if (!branch) return res.status(400).json({ error: 'Invalid branch' });
    const { rows } = await db.query(
      `SELECT * FROM sessions WHERE branch_id=$1 AND status='active'`, [branchId]
    );
    const stations = [];
    for (let i = 1; i <= branch.stations; i++)
      stations.push({ station_id: i, session: rows.find(s => s.station_id === i) || null });
    res.json(stations);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/sessions/start', requireBranchAccess, async (req, res) => {
  try {
    const { branch_id, station_id, console_type } = req.body;
    if (!RATES[console_type])              return res.status(400).json({ error: 'Invalid console type' });
    if (!BRANCHES.find(b => b.id === branch_id)) return res.status(400).json({ error: 'Invalid branch' });

    const { rows: existing } = await db.query(
      `SELECT id FROM sessions WHERE branch_id=$1 AND station_id=$2 AND status='active'`,
      [branch_id, station_id]
    );
    if (existing.length) return res.status(400).json({ error: 'Station already has an active session' });

    const { rows } = await db.query(
      `INSERT INTO sessions (branch_id, station_id, console_type, start_time, status)
       VALUES ($1,$2,$3,NOW(),'active') RETURNING *`,
      [branch_id, station_id, console_type]
    );
    const session = rows[0];
    sendTelegram(
      `🟢 <b>Session Started</b>\n\n📍 ${branchName(branch_id)}\n📺 Station ${station_id}\n` +
      `🕹 Console: ${console_type}\n⏰ Started: ${formatTime(session.start_time)}\n` +
      `💵 Rate: UGX ${RATES[console_type].toLocaleString()}/hr`
    );
    res.json(session);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/sessions/end/:id', requireBranchAccess, async (req, res) => {
  try {
    const pc = req.headers['x-passcode'];
    const { rows } = await db.query(
      `SELECT * FROM sessions WHERE id=$1 AND status='active'`, [Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Active session not found' });
    const session = rows[0];

    if (!isAdminPasscode(pc)) {
      if (session.branch_id !== branchForPasscode(pc))
        return res.status(403).json({ error: 'Not authorised for this session' });
    }

    const { rows: updated } = await db.query(`
      UPDATE sessions SET
        end_time         = NOW(),
        duration_minutes = EXTRACT(EPOCH FROM (NOW() - start_time)) / 60,
        amount_ugx       = CEIL((EXTRACT(EPOCH FROM (NOW() - start_time)) / 3600) * $1),
        status           = 'completed'
      WHERE id = $2 RETURNING *
    `, [RATES[session.console_type], session.id]);
    const done = updated[0];

    sendTelegram(
      `🔴 <b>Session Ended</b>\n\n📍 ${branchName(session.branch_id)}\n📺 Station ${session.station_id}\n` +
      `🕹 Console: ${session.console_type}\n⏱ Duration: ${formatDuration(done.duration_minutes)}\n` +
      `💰 Amount: UGX ${done.amount_ugx.toLocaleString()}\n🕐 Ended: ${formatTime(done.end_time)}`
    );
    res.json(done);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/sessions/history', requireBranchAccess, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM sessions WHERE branch_id=$1 AND status='completed' ORDER BY end_time DESC LIMIT 50`,
      [Number(req.query.branch)]
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/stats/today', requireBranchAccess, async (req, res) => {
  try {
    const { total, byConsole } = await buildDailyStats(Number(req.query.branch), kampalaDateStr());
    res.json({ by_console: byConsole, total });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// TEMPORARY EXPORT — admin only, remove after migration
app.get('/api/export', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM sessions ORDER BY id`);
    res.setHeader('Content-Disposition', 'attachment; filename="billing-export.json"');
    res.json({ sessions: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function start() {
  await db.init();
  app.listen(PORT, () =>
    console.log(`\n🎮 Gamers Galaxy Billing running at http://localhost:${PORT}\n`)
  );
}

start().catch(err => { console.error('Startup error:', err); process.exit(1); });
