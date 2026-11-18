'use strict';

// Drives the real app over HTTP with a throwaway in-memory database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function startApp() {
  const app = createApp({ dbFile: ':memory:' });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const cookies = new Map();
      let csrf = '';

      async function request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
        const res = await fetch(base + path, { redirect: 'manual', ...options, headers });
        for (const line of res.headers.getSetCookie()) {
          const [pair] = line.split(';');
          const index = pair.indexOf('=');
          cookies.set(pair.slice(0, index), pair.slice(index + 1));
        }
        const type = res.headers.get('content-type') || '';
        const body = type.includes('pdf') || type.includes('octet') ? Buffer.from(await res.arrayBuffer()) : await res.text();
        const token = typeof body === 'string' && /name="csrf-token" content="([^"]+)"/.exec(body);
        if (token) csrf = token[1];
        return { status: res.status, location: res.headers.get('location'), headers: res.headers, body };
      }

      const get = (path) => request(path);
      const post = (path, fields = {}, { token = true } = {}) =>
        request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(token ? { _csrf: csrf, ...fields } : fields).toString(),
        });

      resolve({
        app,
        get,
        post,
        request,
        csrf: () => csrf,
        clearCookies: () => cookies.clear(),
        close: () => new Promise((done) => server.close(() => (app.close(), done()))),
      });
    });
  });
}

test('first run asks for a password, then everything needs a login', async () => {
  const t = await startApp();
  try {
    let res = await t.get('/');
    assert.equal(res.status, 302);
    assert.equal(res.location, '/setup');

    await t.get('/setup');
    res = await t.post('/setup', { password: 'short', confirm: 'short' });
    assert.equal(res.status, 400);
    res = await t.post('/setup', { password: 'correct horse', confirm: 'correct horse' });
    assert.equal(res.location, '/');
    assert.equal((await t.get('/')).status, 200);

    // Setup can not be run a second time.
    assert.equal((await t.get('/setup')).location, '/login');

    // A fresh browser is sent to the login page and can sign in.
    t.clearCookies();
    res = await t.get('/customers');
    assert.equal(res.location, '/login?next=%2Fcustomers');
    await t.get('/login');
    res = await t.post('/login', { password: 'wrong', next: '/customers' });
    assert.equal(res.status, 401);
    res = await t.post('/login', { password: 'correct horse', next: '/customers' });
    assert.equal(res.location, '/customers');
    // The "next" page can never point at another website.
    await t.post('/logout');
    await t.get('/login');
    res = await t.post('/login', { password: 'correct horse', next: '//evil.example.com' });
    assert.equal(res.location, '/');
  } finally {
    await t.close();
  }
});

test('forms without the security token are refused', async () => {
  const t = await startApp();
  try {
    await t.get('/setup');
    await t.post('/setup', { password: 'correct horse', confirm: 'correct horse' });
    const res = await t.post('/customers', { name: 'No Token' }, { token: false });
    assert.equal(res.status, 403);
    assert.equal(t.app.ctx.db.get('SELECT COUNT(*) AS n FROM customers').n, 0);
  } finally {
    await t.close();
  }
});

test('customer -> job -> invoice -> payment, end to end', async () => {
  const t = await startApp();
  const { db, settings } = t.app.ctx;
  try {
    await t.get('/setup');
    await t.post('/setup', { password: 'correct horse', confirm: 'correct horse' });
    settings.set({ tax_rate: 10 });

    // New job with a brand-new customer in one step.
    await t.get('/jobs/new');
    let res = await t.post('/jobs', {
      new_customer_name: 'Ada <b>Lovelace</b>',
      new_customer_phone: '(555) 123-4567',
      new_customer_email: 'ada@example.com',
      new_customer_address: '12 Analytical Row\nLondon',
      device_type: 'Laptop',
      brand_model: 'ThinkPad X1',
      serial_number: 'SN1',
      problem: 'No power',
      date_received: '2026-11-01',
    });
    assert.equal(res.location, '/jobs/1');
    const job = await t.get('/jobs/1');
    assert.equal(job.status, 200);
    assert.ok(job.body.includes('Ada &lt;b&gt;Lovelace&lt;/b&gt;'), 'customer text is escaped');
    assert.ok(!job.body.includes('<b>Lovelace</b>'));

    // The address typed with the job is saved and shown on the customer's page.
    assert.equal(db.get('SELECT address FROM customers WHERE id = 1').address, '12 Analytical Row\nLondon');
    assert.ok((await t.get('/customers/1')).body.includes('12 Analytical Row'));
    await t.post('/customers/1', {
      name: 'Ada <b>Lovelace</b>',
      phone: '(555) 123-4567',
      email: 'ada@example.com',
      address: '7 Engine Street\r\nLondon',
    });
    assert.equal(db.get('SELECT address FROM customers WHERE id = 1').address, '7 Engine Street\nLondon');

    // Search finds the customer by name and by phone digits.
    assert.ok((await t.get('/customers?q=lovelace')).body.includes('ada@example.com'));
    const api = JSON.parse((await t.get('/api/customers?q=5551234567')).body);
    assert.equal(api.length, 1);
    assert.equal(api[0].id, 1);

    // Status flow, with history.
    res = await t.post('/jobs/1/status', { status: 'ready' });
    assert.equal(res.location, '/jobs/1');
    assert.equal(db.get('SELECT status FROM jobs WHERE id = 1').status, 'ready');
    assert.equal((await t.post('/jobs/1/status', { status: 'nonsense' })).location, '/jobs/1');
    assert.equal(db.get('SELECT status FROM jobs WHERE id = 1').status, 'ready');
    await t.post('/jobs/1/notes', { body: 'Replaced DC jack' });
    assert.equal(db.get('SELECT COUNT(*) AS n FROM job_notes WHERE job_id = 1').n, 2);
    assert.ok((await t.get('/jobs?status=ready&view=list')).body.includes('ThinkPad X1'));
    assert.ok((await t.get('/jobs?view=board')).body.includes('data-job-id="1"'));

    // One-click invoice, pre-filled from the job.
    res = await t.post('/jobs/1/invoice');
    assert.equal(res.location, '/invoices/1/edit');
    let invoice = db.get('SELECT * FROM invoices WHERE id = 1');
    assert.equal(invoice.number, 'INV-1001');
    assert.equal(invoice.customer_id, 1);
    assert.equal(invoice.job_id, 1);
    assert.equal(invoice.device, 'ThinkPad X1 (Laptop) · S/N SN1');
    assert.equal(invoice.status, 'draft');
    assert.equal(invoice.tax_rate, 10);

    await t.get('/invoices/1/edit');
    res = await t.post('/invoices/1', {
      device: invoice.device,
      issue_date: '2026-11-02',
      due_date: '2026-11-16',
      tax_rate: '10',
      tax_labor: '1',
      discount_type: 'amount',
      discount_value: '5',
      notes: 'Thanks',
      'items[0][kind]': 'part',
      'items[0][description]': 'DC jack',
      'items[0][quantity]': '1',
      'items[0][unit_price]': '25.00',
      'items[1][kind]': 'labor',
      'items[1][description]': 'Fitting',
      'items[1][quantity]': '2',
      'items[1][unit_price]': '40',
      'items[2][kind]': 'part',
      'items[2][description]': '',
      'items[2][quantity]': '1',
      'items[2][unit_price]': '',
    });
    assert.equal(res.location, '/invoices/1');
    invoice = db.get('SELECT * FROM invoices WHERE id = 1');
    // 25 + 80 = 105; -5 = 100; +10% = 110
    assert.deepEqual(
      [invoice.subtotal, invoice.discount, invoice.tax, invoice.total],
      [10500, 500, 1000, 11000]
    );
    assert.equal(db.get('SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = 1').n, 2, 'blank row dropped');

    // Sent, and overdue because the due date has passed.
    await t.post('/invoices/1/status', { status: 'sent' });
    const list = await t.get('/invoices?status=overdue');
    assert.ok(list.body.includes('INV-1001'));
    const dashboard = await t.get('/');
    assert.ok(dashboard.body.includes('$110.00'));
    assert.ok(dashboard.body.includes('1 overdue'));

    // Payments: too much is refused, part-payment keeps it open, the rest closes it.
    await t.post('/invoices/1/payments', { amount: '500', method: 'cash', paid_on: '2026-11-10' });
    assert.equal(db.get('SELECT COUNT(*) AS n FROM payments').n, 0);
    await t.post('/invoices/1/payments', { amount: '60', method: 'cash', paid_on: '2026-11-10' });
    assert.equal(db.get('SELECT status FROM invoices WHERE id = 1').status, 'sent');
    await t.post('/invoices/1/payments', { amount: '50.00', method: 'card', paid_on: '2026-11-11' });
    assert.equal(db.get('SELECT status FROM invoices WHERE id = 1').status, 'paid');
    const paidPage = (await t.get('/invoices/1')).body;
    assert.ok(paidPage.includes('PAID'));
    assert.ok(paidPage.includes('<div class="soft">7 Engine Street</div>'), 'invoice shows the customer address');

    // Removing a payment re-opens the invoice.
    await t.post('/invoices/1/payments/2/delete');
    assert.equal(db.get('SELECT status FROM invoices WHERE id = 1').status, 'sent');

    // PDF.
    const pdf = await t.get('/invoices/1/pdf?download=1');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.match(pdf.headers.get('content-disposition'), /attachment; filename="Invoice-INV-1001\.pdf"/);

    // Email without a mail server set up gives a clear message instead of failing.
    await t.post('/invoices/1/email', { to: 'ada@example.com' });
    assert.ok((await t.get('/invoices/1')).body.includes('Email is not set up yet'));

    // The next invoice gets the next number.
    res = await t.post('/invoices', { customer_id: '1' });
    assert.equal(res.location, '/invoices/2/edit');
    assert.equal(db.get('SELECT number FROM invoices WHERE id = 2').number, 'INV-1002');

    // A customer with history can not be deleted by accident.
    await t.post('/customers/1/delete');
    assert.equal(db.get('SELECT COUNT(*) AS n FROM customers').n, 1);

    // Deleting the job keeps the invoice.
    await t.post('/jobs/1/delete');
    assert.equal(db.get('SELECT job_id FROM invoices WHERE id = 1').job_id, null);

    assert.equal((await t.get('/jobs/999')).status, 404);
    assert.equal((await t.get('/nope')).status, 404);
  } finally {
    await t.close();
  }
});

test('changing the password signs out other devices', async () => {
  const t = await startApp();
  try {
    await t.get('/setup');
    await t.post('/setup', { password: 'correct horse', confirm: 'correct horse' });
    await t.get('/settings');
    let res = await t.post('/settings/password', { current: 'nope', password: 'new password 1', confirm: 'new password 1' });
    assert.ok((await t.get('/settings')).body.includes('current password is not right'));
    res = await t.post('/settings/password', {
      current: 'correct horse',
      password: 'new password 1',
      confirm: 'new password 1',
    });
    assert.equal(res.location, '/settings#password');
    assert.equal((await t.get('/settings')).status, 200, 'this device stays signed in');

    t.clearCookies();
    await t.get('/login');
    assert.equal((await t.post('/login', { password: 'correct horse' })).status, 401);
    assert.equal((await t.post('/login', { password: 'new password 1' })).location, '/');
  } finally {
    await t.close();
  }
});

test('a no-charge invoice never shows as unpaid or overdue', async () => {
  const t = await startApp();
  const { db, invoices } = t.app.ctx;
  try {
    await t.get('/setup');
    await t.post('/setup', { password: 'correct horse', confirm: 'correct horse' });
    await t.post('/customers', { name: 'Warranty Customer' });
    await t.post('/invoices', { customer_id: '1' });
    await t.post('/invoices/1', {
      issue_date: '2026-01-01',
      due_date: '2026-01-15',
      tax_rate: '0',
      'items[0][kind]': 'labor',
      'items[0][description]': 'Warranty repair',
      'items[0][quantity]': '1',
      'items[0][unit_price]': '0',
    });
    await t.post('/invoices/1/status', { status: 'sent' });
    const invoice = invoices.load(1, '2026-06-01');
    assert.equal(invoice.display_status, 'sent');
    assert.equal(invoices.list({ today: '2026-06-01', status: 'overdue' }).length, 0);
    assert.equal(invoices.list({ today: '2026-06-01', status: 'unpaid' }).length, 0);
    assert.equal(invoices.counts('2026-06-01').overdue, 0);
    await t.post('/invoices/1/status', { status: 'paid' });
    assert.equal(db.get('SELECT status FROM invoices WHERE id = 1').status, 'paid');
  } finally {
    await t.close();
  }
});
