'use strict';

// Forgot the shop password? Stop the app, run `npm run reset-password`, start
// the app again and it will ask you to choose a new one. No data is lost.
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createSettings } = require('../src/settings');

const dbFile = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'rds.db');
const db = openDatabase(dbFile);
const settings = createSettings(db);

settings.set({
  password_hash: '',
  session_version: String(Number(settings.get('session_version')) + 1),
});
db.close();

console.log('Password cleared. Start the app and open it in your browser to choose a new one.');
