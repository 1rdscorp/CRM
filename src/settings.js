'use strict';

// Shop-wide settings, kept as simple key/value rows in the database and edited
// on the Settings page.

const DEFAULTS = {
  business_name: 'RDS Electronics',
  business_address: '',
  business_phone: '',
  business_email: '',
  business_website: '',
  logo: '', // data URL (PNG or JPEG), shown on invoices
  logo_version: '0',

  currency_symbol: '$',
  tax_label: 'Tax',
  tax_rate: '0', // percent
  tax_labor: '1', // charge tax on labor as well as parts
  invoice_prefix: 'INV-',
  next_invoice_number: '1001',
  due_days: '14',
  invoice_footer: 'Thank you for your business!',
  paper_size: 'LETTER',

  smtp_host: '',
  smtp_port: '465',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',

  password_hash: '',
  session_secret: '',
  session_version: '1',
};

function createSettings(db) {
  let cache = null;

  function load() {
    if (!cache) {
      cache = { ...DEFAULTS };
      for (const row of db.all('SELECT key, value FROM settings')) cache[row.key] = row.value;
    }
    return cache;
  }

  return {
    get: (key) => load()[key] ?? '',
    all: () => ({ ...load() }),
    number(key) {
      const n = Number(load()[key]);
      return Number.isFinite(n) ? n : Number(DEFAULTS[key]) || 0;
    },
    set(values) {
      db.transaction(() => {
        for (const [key, value] of Object.entries(values)) {
          db.run(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            key,
            String(value ?? '')
          );
        }
      });
      cache = null;
    },
    emailConfigured() {
      const s = load();
      return Boolean(s.smtp_host && (s.smtp_from || s.business_email || s.smtp_user));
    },
  };
}

module.exports = { createSettings, DEFAULTS };
