'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');

const { openDatabase } = require('./db');
const { createSettings } = require('./settings');
const { createAuth } = require('./auth');
const { createInvoiceModel } = require('./invoice-model');
const constants = require('./constants');
const dates = require('./dates');
const money = require('./money');
const icon = require('./icons');

const ROOT = path.join(__dirname, '..');

function createApp({ dbFile, trustProxy = false } = {}) {
  const db = openDatabase(dbFile || path.join(ROOT, 'data', 'rds.db'));
  const settings = createSettings(db);
  if (!settings.get('session_secret')) {
    settings.set({ session_secret: crypto.randomBytes(32).toString('hex') });
  }
  const invoices = createInvoiceModel({ db, settings });
  const auth = createAuth({ settings });
  const ctx = { db, settings, invoices };

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  // Helpers available in every page template.
  Object.assign(app.locals, constants, {
    assetVersion: require('../package.json').version,
    icon,
    money: (cents) => money.formatMoney(cents, settings.get('currency_symbol')),
    amount: money.formatAmount,
    inputAmount: money.toInputAmount,
    fmtDate: dates.formatDate,
    daysBetween: dates.daysBetween,
    plural: (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`,
    // "RDS Electronics" -> "RDS", "Main Street Repair" -> "MSR"
    brandInitials(name) {
      const words = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (words[0] && words[0].length <= 4 && words[0] === words[0].toUpperCase()) return words[0];
      return words.map((word) => word.charAt(0)).join('').slice(0, 3).toUpperCase();
    },
  });

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
        "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: true, limit: '3mb', parameterLimit: 5000 }));
  app.use(express.json({ limit: '100kb' }));

  app.use(
    cookieSession({
      name: 'rds_session',
      keys: [settings.get('session_secret')],
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
    })
  );

  // Per-request values: the visitor's time zone (sent by the browser in a
  // cookie so "today" is right even when the server runs in another zone),
  // the CSRF token, and one-time "flash" messages.
  app.use((req, res, next) => {
    const tzCookie = /(?:^|;\s*)tz=([^;]+)/.exec(req.headers.cookie || '');
    let tz = null;
    if (tzCookie) {
      try {
        const value = decodeURIComponent(tzCookie[1]);
        if (dates.isValidTimeZone(value)) tz = value;
      } catch {
        /* ignore a malformed cookie */
      }
    }
    req.tz = tz;
    req.today = dates.today(tz);

    if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
    // Touch the session once a day so the 30-day sign-in keeps rolling forward.
    const day = Math.floor(Date.now() / 86400000);
    if (req.session.day !== day) req.session.day = day;

    req.flash = (type, message) => {
      req.session.flash = { type, message };
    };

    Object.assign(res.locals, {
      csrfToken: req.session.csrf,
      currentPath: req.path,
      today: req.today,
      fmtDateTime: (iso) => dates.formatDateTime(iso, tz),
      shop: {
        name: settings.get('business_name') || 'Repair Shop',
        hasLogo: Boolean(settings.get('logo')),
        logoVersion: settings.get('logo_version'),
        currency: settings.get('currency_symbol'),
        taxLabel: settings.get('tax_label') || 'Tax',
      },
      takeFlash() {
        const flash = req.session.flash;
        if (flash) delete req.session.flash;
        return flash || null;
      },
    });
    next();
  });

  // Every form carries the session's CSRF token; reject posts without it.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
    const expected = String(req.session.csrf || '');
    const ok =
      sent.length === expected.length &&
      expected.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
    if (ok) return next();
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(403).json({ error: 'Session expired. Reload the page and try again.' });
    }
    res.status(403).render('error', {
      title: 'Please try again',
      heading: 'That page was open too long',
      message: 'For your security the form expired. Go back, reload the page and try again.',
    });
  });

  app.use(auth.router);
  app.use(auth.requireAuth);

  // The logo picture shown on invoices and on the Settings page.
  app.get('/logo', (req, res) => {
    const match = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(settings.get('logo'));
    if (!match) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.type(match[1]).send(Buffer.from(match[2], 'base64'));
  });

  app.use(require('./routes/dashboard')(ctx));
  app.use(require('./routes/customers')(ctx));
  app.use(require('./routes/jobs')(ctx));
  app.use(require('./routes/invoices')(ctx));
  app.use(require('./routes/settings')(ctx));

  app.use((req, res) => {
    res.status(404).render('error', {
      title: 'Not found',
      heading: 'Page not found',
      message: 'That page does not exist, or the record was deleted.',
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.end();
    let heading = 'Something went wrong';
    let message = 'The error has been logged. Go back and try again.';
    if (status === 404) {
      heading = 'Page not found';
      message = 'That page does not exist, or the record was deleted.';
    } else if (status === 413) {
      heading = 'That was too large to save';
      message = 'Try a smaller image or shorter text.';
    }
    res.status(status).render('error', { title: heading, heading, message });
  });

  app.close = () => db.close();
  app.ctx = ctx;
  return app;
}

module.exports = { createApp };
