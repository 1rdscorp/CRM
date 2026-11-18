'use strict';

// Calendar dates are stored as 'YYYY-MM-DD' text; moments in time as ISO UTC.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Today's date ('YYYY-MM-DD') in the given time zone (server zone if omitted). */
function today(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  const d = new Date(str + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (positive when b is later). */
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** 'YYYY-MM-DD' -> first and last day of that month. */
function monthRange(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** '2026-11-18' -> 'Nov 18, 2026' */
function formatDate(dateStr) {
  if (!isValidDate(dateStr)) return dateStr || '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr + 'T00:00:00Z'));
}

/** '2026-11-18' -> 'November 2026' */
function formatMonth(dateStr) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long' }).format(
    new Date(dateStr + 'T00:00:00Z')
  );
}

/** ISO timestamp -> 'Nov 18, 2026, 3:42 PM' in the given time zone. */
function formatDateTime(iso, tz) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

module.exports = {
  isValidTimeZone,
  today,
  nowIso,
  isValidDate,
  addDays,
  daysBetween,
  monthRange,
  formatDate,
  formatMonth,
  formatDateTime,
};
