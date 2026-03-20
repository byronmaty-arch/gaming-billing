const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          SERIAL PRIMARY KEY,
      branch_id   INTEGER   NOT NULL,
      station_id  INTEGER   NOT NULL,
      console_type TEXT     NOT NULL CHECK(console_type IN ('PS3','PS4','PS5')),
      start_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      end_time    TIMESTAMPTZ,
      duration_minutes REAL,
      amount_ugx  INTEGER,
      status      TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed'))
    )
  `);
  console.log('✅ Database ready');
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { init, query };
