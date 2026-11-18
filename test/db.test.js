'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase, MIGRATIONS } = require('../src/db');

test('a database from the first version is upgraded without losing data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rds-test-'));
  const file = path.join(dir, 'old.db');
  try {
    // Build a database exactly as the first release would have left it.
    const old = new DatabaseSync(file);
    old.exec(MIGRATIONS[0]);
    old.exec('PRAGMA user_version = 1');
    old.exec(
      `INSERT INTO customers (name, phone, phone_digits, email, notes, created_at, updated_at)
       VALUES ('Existing Customer', '555-0100', '5550100', 'old@example.com', 'keep me', '2026-01-01', '2026-01-01')`
    );
    old.close();

    const db = openDatabase(file);
    assert.equal(db.get('PRAGMA user_version').user_version, MIGRATIONS.length);
    const customer = db.get('SELECT * FROM customers WHERE id = 1');
    assert.equal(customer.name, 'Existing Customer');
    assert.equal(customer.notes, 'keep me');
    assert.equal(customer.address, '');
    db.close();

    // Opening it again changes nothing.
    const again = openDatabase(file);
    assert.equal(again.get('SELECT COUNT(*) AS n FROM customers').n, 1);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
