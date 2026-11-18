'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } = require('../auth');
const { parseNumber } = require('../money');
const { str, isEmail } = require('../util');
const { sendMail } = require('../mailer');

const MAX_LOGO_BYTES = 1.5 * 1024 * 1024;

module.exports = function settingsRoutes({ db, settings }) {
  const router = express.Router();

  const done = (req, res, message, anchor = '') => {
    req.flash('success', message);
    res.redirect('/settings' + anchor);
  };
  const fail = (req, res, message, anchor = '') => {
    req.flash('error', message);
    res.redirect('/settings' + anchor);
  };

  router.get('/settings', (req, res) => {
    const all = settings.all();
    res.render('settings', {
      title: 'Settings',
      s: { ...all, smtp_pass: '', password_hash: '', session_secret: '' },
      hasSmtpPassword: Boolean(all.smtp_pass),
      emailReady: settings.emailConfigured(),
    });
  });

  router.post('/settings/business', (req, res) => {
    const email = str(req.body.business_email, 200);
    if (email && !isEmail(email)) return fail(req, res, 'That business email does not look right.', '#business');
    settings.set({
      business_name: str(req.body.business_name, 120) || 'RDS Electronics',
      business_address: str(req.body.business_address, 400),
      business_phone: str(req.body.business_phone, 60),
      business_email: email,
      business_website: str(req.body.business_website, 200),
    });
    done(req, res, 'Business details saved.', '#business');
  });

  // The browser shrinks the chosen picture and sends it as a PNG/JPEG data URL.
  router.post('/settings/logo', (req, res) => {
    const logo = String(req.body.logo || '');
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(logo);
    if (!match) return fail(req, res, 'Choose a picture file (PNG or JPG) for the logo.', '#business');
    const bytes = Buffer.from(match[2], 'base64');
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!(match[1] === 'png' ? isPng : isJpeg)) {
      return fail(req, res, 'That file is not a valid PNG or JPG picture.', '#business');
    }
    if (bytes.length > MAX_LOGO_BYTES) return fail(req, res, 'That logo is too large. Try a smaller picture.', '#business');
    settings.set({ logo, logo_version: Date.now() });
    done(req, res, 'Logo saved.', '#business');
  });

  router.post('/settings/logo/delete', (req, res) => {
    settings.set({ logo: '', logo_version: Date.now() });
    done(req, res, 'Logo removed.', '#business');
  });

  router.post('/settings/invoicing', (req, res) => {
    const nextNumber = Math.floor(parseNumber(req.body.next_invoice_number));
    settings.set({
      currency_symbol: str(req.body.currency_symbol, 6) || '$',
      tax_label: str(req.body.tax_label, 30) || 'Tax',
      tax_rate: Math.min(Math.max(0, parseNumber(req.body.tax_rate)), 100),
      tax_labor: req.body.tax_labor === '1' ? '1' : '0',
      invoice_prefix: str(req.body.invoice_prefix, 12),
      next_invoice_number: nextNumber >= 1 ? nextNumber : settings.get('next_invoice_number'),
      due_days: Math.min(Math.max(0, Math.floor(parseNumber(req.body.due_days))), 365),
      invoice_footer: str(req.body.invoice_footer, 600),
      paper_size: req.body.paper_size === 'A4' ? 'A4' : 'LETTER',
    });
    done(req, res, 'Invoice settings saved. New invoices will use them.', '#invoicing');
  });

  router.post('/settings/email', (req, res) => {
    const from = str(req.body.smtp_from, 200);
    if (from && !isEmail(from)) return fail(req, res, 'The "send from" address does not look right.', '#email');
    const port = Math.floor(parseNumber(req.body.smtp_port));
    const values = {
      smtp_host: str(req.body.smtp_host, 200).replace(/^[a-z]+:\/\//i, ''),
      smtp_port: port >= 1 && port <= 65535 ? port : 465,
      smtp_user: str(req.body.smtp_user, 200),
      smtp_from: from,
    };
    // Leaving the password box empty keeps the saved one.
    const password = String(req.body.smtp_pass || '');
    if (password) values.smtp_pass = password.slice(0, 500);
    if (req.body.clear_smtp_pass === '1') values.smtp_pass = '';
    settings.set(values);
    done(req, res, 'Email settings saved.', '#email');
  });

  router.post('/settings/email/test', async (req, res) => {
    if (!settings.emailConfigured()) return fail(req, res, 'Save your email server details first.', '#email');
    const all = settings.all();
    const to = all.business_email || all.smtp_from || all.smtp_user;
    if (!isEmail(to)) return fail(req, res, 'Add your business email address first, so there is somewhere to send the test.', '#email');
    try {
      await sendMail(all, {
        to,
        subject: `Test email from ${all.business_name}`,
        text: 'Email is working. Invoices can now be emailed to customers straight from the app.',
      });
    } catch (err) {
      console.error('Test email failed:', err.message);
      return fail(req, res, `The test email could not be sent: ${str(err.message, 300)}`, '#email');
    }
    done(req, res, `Test email sent to ${to}.`, '#email');
  });

  router.post('/settings/password', (req, res) => {
    const current = String(req.body.current || '');
    const next = String(req.body.password || '');
    if (!verifyPassword(current, settings.get('password_hash'))) {
      return fail(req, res, 'The current password is not right.', '#password');
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      return fail(req, res, `Choose a new password with at least ${MIN_PASSWORD_LENGTH} characters.`, '#password');
    }
    if (next !== String(req.body.confirm || '')) {
      return fail(req, res, 'The two new passwords do not match.', '#password');
    }
    // Bumping the version signs out every other device.
    const version = String(Number(settings.get('session_version')) + 1);
    settings.set({ password_hash: hashPassword(next), session_version: version });
    req.session.v = version;
    done(req, res, 'Password changed. Other devices will need to sign in again.', '#password');
  });

  // A complete copy of the database, safe to take while the app is running.
  router.get('/settings/backup', (req, res, next) => {
    const tmp = path.join(os.tmpdir(), `rds-backup-${crypto.randomBytes(8).toString('hex')}.db`);
    try {
      db.run('VACUUM INTO ?', tmp);
    } catch (err) {
      return next(err);
    }
    res.download(tmp, `rds-electronics-backup-${req.today}.db`, () => {
      fs.rm(tmp, { force: true }, () => {});
    });
  });

  return router;
};
