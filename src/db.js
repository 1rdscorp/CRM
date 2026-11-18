'use strict';

// SQLite database: one file on disk, no separate database server to run.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Each entry runs once, in order. To change the schema later, append a new
// entry — never edit an old one.
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE customers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    phone        TEXT NOT NULL DEFAULT '',
    phone_digits TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX customers_name ON customers(name COLLATE NOCASE);

  CREATE TABLE jobs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id       INTEGER NOT NULL REFERENCES customers(id),
    device_type       TEXT NOT NULL DEFAULT '',
    brand_model       TEXT NOT NULL DEFAULT '',
    serial_number     TEXT NOT NULL DEFAULT '',
    problem           TEXT NOT NULL DEFAULT '',
    date_received     TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'received',
    status_changed_at TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE INDEX jobs_customer ON jobs(customer_id);
  CREATE INDEX jobs_status ON jobs(status);

  CREATE TABLE job_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'note',
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX job_notes_job ON job_notes(job_id);

  CREATE TABLE invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    number         TEXT NOT NULL UNIQUE,
    customer_id    INTEGER NOT NULL REFERENCES customers(id),
    job_id         INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
    device         TEXT NOT NULL DEFAULT '',
    issue_date     TEXT NOT NULL,
    due_date       TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft',
    tax_rate       REAL NOT NULL DEFAULT 0,
    tax_labor      INTEGER NOT NULL DEFAULT 1,
    discount_type  TEXT NOT NULL DEFAULT 'amount',
    discount_value REAL NOT NULL DEFAULT 0,
    subtotal       INTEGER NOT NULL DEFAULT 0,
    discount       INTEGER NOT NULL DEFAULT 0,
    tax            INTEGER NOT NULL DEFAULT 0,
    total          INTEGER NOT NULL DEFAULT 0,
    notes          TEXT NOT NULL DEFAULT '',
    emailed_at     TEXT,
    emailed_to     TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE INDEX invoices_customer ON invoices(customer_id);
  CREATE INDEX invoices_job ON invoices(job_id);
  CREATE INDEX invoices_status ON invoices(status);

  CREATE TABLE invoice_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    kind        TEXT NOT NULL DEFAULT 'part',
    description TEXT NOT NULL DEFAULT '',
    quantity    REAL NOT NULL DEFAULT 1,
    unit_price  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX invoice_items_invoice ON invoice_items(invoice_id);

  CREATE TABLE payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount     INTEGER NOT NULL,
    method     TEXT NOT NULL DEFAULT 'cash',
    paid_on    TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX payments_invoice ON payments(invoice_id);
  CREATE INDEX payments_paid_on ON payments(paid_on);
  `,
];

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Prepared statements are cached so each query is compiled only once.
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };

  let depth = 0;
  return {
    raw: db,
    file,
    get: (sql, ...params) => stmt(sql).get(...params),
    all: (sql, ...params) => stmt(sql).all(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    exec: (sql) => db.exec(sql),
    /** Run fn so that either all of its writes are saved or none are. */
    transaction(fn) {
      if (depth > 0) return fn();
      db.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}

module.exports = { openDatabase };
