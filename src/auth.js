'use strict';

// One shared password for the whole shop. No user accounts or roles.
const crypto = require('node:crypto');
const express = require('express');

const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/** Only allow redirects back into this app, never to another site. */
function safeNext(next) {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/';
}

function createAuth({ settings }) {
  const router = express.Router();
  const failures = new Map(); // ip -> { count, until }

  const hasPassword = () => Boolean(settings.get('password_hash'));

  function isLockedOut(ip) {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (Date.now() > entry.until) {
      failures.delete(ip);
      return false;
    }
    return entry.count >= MAX_FAILED_LOGINS;
  }

  function recordFailure(ip) {
    if (failures.size > 5000) {
      const now = Date.now();
      for (const [key, value] of failures) if (now > value.until) failures.delete(key);
    }
    const entry = failures.get(ip) || { count: 0, until: 0 };
    entry.count += 1;
    entry.until = Date.now() + LOCKOUT_MS;
    failures.set(ip, entry);
  }

  function signIn(req) {
    req.session.auth = true;
    req.session.v = settings.get('session_version');
  }

  const isSignedIn = (req) =>
    Boolean(req.session && req.session.auth && req.session.v === settings.get('session_version'));

  // First run: choose the shop password.
  router.get('/setup', (req, res) => {
    if (hasPassword()) return res.redirect('/login');
    res.render('setup', { title: 'Welcome', error: null });
  });

  router.post('/setup', (req, res) => {
    if (hasPassword()) return res.redirect('/login');
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    let error = null;
    if (password.length < MIN_PASSWORD_LENGTH) {
      error = `Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (password !== confirm) {
      error = 'The two passwords do not match.';
    }
    if (error) return res.status(400).render('setup', { title: 'Welcome', error });
    settings.set({ password_hash: hashPassword(password) });
    signIn(req);
    res.redirect('/');
  });

  router.get('/login', (req, res) => {
    if (!hasPassword()) return res.redirect('/setup');
    if (isSignedIn(req)) return res.redirect('/');
    res.render('login', { title: 'Sign in', error: null, next: safeNext(req.query.next) });
  });

  router.post('/login', (req, res) => {
    if (!hasPassword()) return res.redirect('/setup');
    const next = safeNext(req.body.next);
    const fail = (status, error) => res.status(status).render('login', { title: 'Sign in', error, next });

    if (isLockedOut(req.ip)) {
      return fail(429, 'Too many wrong passwords. Please wait 15 minutes and try again.');
    }
    if (!verifyPassword(req.body.password || '', settings.get('password_hash'))) {
      recordFailure(req.ip);
      return fail(401, 'That password is not right.');
    }
    failures.delete(req.ip);
    signIn(req);
    res.redirect(next);
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.redirect('/login');
  });

  /** Everything registered after this middleware needs a signed-in session. */
  function requireAuth(req, res, next) {
    if (!hasPassword()) return res.redirect('/setup');
    if (isSignedIn(req)) return next();
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      const target = req.originalUrl === '/' ? '' : `?next=${encodeURIComponent(req.originalUrl)}`;
      return res.redirect('/login' + target);
    }
    res.status(401).send('Please sign in again.');
  }

  return { router, requireAuth, signIn };
}

module.exports = { createAuth, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH };
