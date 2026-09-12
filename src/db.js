const Database=require('better-sqlite3');
const path=require('path');
const db=new Database(path.join(__dirname,'..','competition.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS registrations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 registration_id TEXT UNIQUE NOT NULL,
 ticket_token TEXT UNIQUE NOT NULL,
 idempotency_key TEXT UNIQUE NOT NULL,
 full_name TEXT NOT NULL,school_name TEXT NOT NULL,gender TEXT NOT NULL,dob TEXT NOT NULL,
 age_category TEXT NOT NULL,phone TEXT NOT NULL,email TEXT,guardian_name TEXT,
 events_json TEXT NOT NULL,amount INTEGER NOT NULL,participant_photo TEXT NOT NULL,payment_proof TEXT NOT NULL,
 payment_utr TEXT,payment_status TEXT NOT NULL DEFAULT 'Pending',checkin_status TEXT NOT NULL DEFAULT 'Not Checked In',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS timing_entries(
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL,heat_no INTEGER NOT NULL,registration_id TEXT NOT NULL,
 timing_text TEXT,status TEXT NOT NULL DEFAULT 'TIME',updated_by TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(event_key,heat_no,registration_id),FOREIGN KEY(registration_id) REFERENCES registrations(registration_id)
);
CREATE TABLE IF NOT EXISTS result_entries(
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL,position INTEGER NOT NULL,registration_id TEXT NOT NULL,
 updated_by TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(event_key,position),FOREIGN KEY(registration_id) REFERENCES registrations(registration_id)
);
CREATE TABLE IF NOT EXISTS event_publication(
 event_key TEXT PRIMARY KEY,published INTEGER NOT NULL DEFAULT 0,published_at TEXT,published_by TEXT
);
CREATE TABLE IF NOT EXISTS checkin_audit(
 id INTEGER PRIMARY KEY AUTOINCREMENT,registration_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT,operator TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS whatsapp_queue(
 id INTEGER PRIMARY KEY AUTOINCREMENT,registration_id TEXT NOT NULL,phone TEXT NOT NULL,message_type TEXT NOT NULL,
 payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
module.exports=db;

// v5 race management + admin audit
try {
  db.exec(`
  CREATE TABLE IF NOT EXISTS race_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL,
    heat_no INTEGER NOT NULL,
    lane_no INTEGER NOT NULL,
    registration_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(event_key, registration_id),
    UNIQUE(event_key, heat_no, lane_no),
    FOREIGN KEY(registration_id) REFERENCES registrations(registration_id)
  );

  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_key TEXT,
    details_json TEXT,
    operator TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `);
} catch (e) { console.error('v5 schema migration failed', e); }
