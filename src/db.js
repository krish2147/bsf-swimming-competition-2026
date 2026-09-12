const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations(
      id BIGSERIAL PRIMARY KEY,
      registration_id TEXT UNIQUE NOT NULL,
      ticket_token TEXT UNIQUE NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      school_name TEXT NOT NULL,
      gender TEXT NOT NULL,
      dob DATE NOT NULL,
      age_category TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      guardian_name TEXT,
      events_json JSONB NOT NULL,
      amount INTEGER NOT NULL,
      participant_photo TEXT NOT NULL,
      payment_proof TEXT NOT NULL,
      payment_utr TEXT,
      payment_status TEXT NOT NULL DEFAULT 'Pending',
      checkin_status TEXT NOT NULL DEFAULT 'Not Checked In',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS timing_entries(
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL,
      heat_no INTEGER NOT NULL,
      registration_id TEXT NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
      timing_text TEXT,
      status TEXT NOT NULL DEFAULT 'TIME',
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_key,heat_no,registration_id)
    );

    CREATE TABLE IF NOT EXISTS result_entries(
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL,
      position INTEGER NOT NULL,
      registration_id TEXT NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_key,position)
    );

    CREATE TABLE IF NOT EXISTS event_publication(
      event_key TEXT PRIMARY KEY,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      published_at TIMESTAMPTZ,
      published_by TEXT
    );

    CREATE TABLE IF NOT EXISTS checkin_audit(
      id BIGSERIAL PRIMARY KEY,
      registration_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT,
      operator TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS whatsapp_queue(
      id BIGSERIAL PRIMARY KEY,
      registration_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS race_entries(
      id BIGSERIAL PRIMARY KEY,
      event_key TEXT NOT NULL,
      heat_no INTEGER NOT NULL,
      lane_no INTEGER NOT NULL,
      registration_id TEXT NOT NULL REFERENCES registrations(registration_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_key,registration_id),
      UNIQUE(event_key,heat_no,lane_no)
    );

    CREATE TABLE IF NOT EXISTS admin_audit(
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_key TEXT,
      details_json JSONB,
      operator TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb, withTransaction };
