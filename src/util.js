'use strict';

/** Form text -> trimmed string of a sane length. */
function str(value, max = 500) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

/** URL/form id -> positive integer, or null. */
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Wrap user text for a SQL LIKE ... ESCAPE '\' search. */
function like(q) {
  return `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Only allow redirects back into this app. */
function safePath(value, fallback = '/') {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : fallback;
}

function notFound() {
  const err = new Error('Not found');
  err.status = 404;
  return err;
}

module.exports = { str, toId, like, isEmail, safePath, notFound };
