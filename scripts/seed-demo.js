'use strict';

// Fills an EMPTY database with made-up customers, jobs and invoices so you can
// click around and see how the app works:  npm run seed
const path = require('node:path');
const { openDatabase } = require('../src/db');
const { createSettings } = require('../src/settings');
const { createInvoiceModel } = require('../src/invoice-model');
const { today: todayIn, addDays } = require('../src/dates');
const { insertCustomer } = require('../src/routes/customers');

const dbFile = process.env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'rds.db');
const db = openDatabase(dbFile);
const settings = createSettings(db);
const invoices = createInvoiceModel({ db, settings });

if (db.get('SELECT COUNT(*) AS n FROM customers').n > 0) {
  console.error('This database already has customers in it, so no demo data was added.');
  process.exit(1);
}

const today = todayIn();
const ago = (days) => addDays(today, -days);
const at = (days, hour = 10) => new Date(Date.now() - days * 86400000 + hour * 60000).toISOString();

if (settings.number('tax_rate') === 0) settings.set({ tax_rate: 8.25 });

const customers = [
  ['Maria Alvarez', '(555) 201-4477', 'maria.alvarez@example.com', '18 Maple Court\nSpringfield, IL 62704', 'Prefers a text when the repair is ready.'],
  ['James O’Connor', '(555) 318-9920', 'james.oconnor@example.com', '', ''],
  ['Priya Nair', '(555) 442-0183', 'priya.nair@example.com', '407 Circuit Avenue\nSpringfield, IL 62704', 'Runs the bakery next door. Give 10% off.'],
  ['Daniel Kim', '(555) 677-3051', '', '', ''],
  ['Sofia Rossi', '(555) 810-2296', 'sofia.rossi@example.com', '', ''],
  ['Marcus Bell', '(555) 934-7712', 'marcus.bell@example.com', '', ''],
  ['Hannah Schmidt', '(555) 126-5540', 'hannah.schmidt@example.com', '92 Lakeview Drive, Apt 3B\nSpringfield, IL 62711', ''],
  ['Oakwood Dental Clinic', '(555) 700-1200', 'office@oakwooddental.example.com', '2100 Oakwood Boulevard, Suite 12\nSpringfield, IL 62702', 'Business account. Ask for Karen at the front desk.'],
].map(([name, phone, email, address, notes]) => insertCustomer(db, { name, phone, email, address, notes }));

function addJob(customerIndex, device_type, brand_model, serial_number, problem, receivedDaysAgo, steps) {
  const created = at(receivedDaysAgo, 0);
  const result = db.run(
    `INSERT INTO jobs (customer_id, device_type, brand_model, serial_number, problem, date_received,
                       status, status_changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`,
    customers[customerIndex],
    device_type,
    brand_model,
    serial_number,
    problem,
    ago(receivedDaysAgo),
    created,
    created,
    created
  );
  const id = Number(result.lastInsertRowid);
  // steps: [daysAgo, 'status' | 'note', text]
  for (const [daysAgo, kind, text] of steps) {
    const when = at(daysAgo, kind === 'status' ? 30 : 45);
    db.run('INSERT INTO job_notes (job_id, kind, body, created_at) VALUES (?, ?, ?, ?)', id, kind, text, when);
    if (kind === 'status') {
      db.run('UPDATE jobs SET status = ?, status_changed_at = ?, updated_at = ? WHERE id = ?', text, when, when, id);
    }
  }
  return db.get('SELECT * FROM jobs WHERE id = ?', id);
}

function addInvoice(job, { issuedDaysAgo, dueInDays = 14, items, discount, notes = '', sent = false, payments = [] }) {
  const id = invoices.create({ customerId: job.customer_id, job, today: ago(issuedDaysAgo) });
  const inv = invoices.load(id, today);
  invoices.save(
    id,
    {
      device: inv.device,
      issue_date: inv.issue_date,
      due_date: addDays(inv.issue_date, dueInDays),
      tax_rate: inv.tax_rate,
      tax_labor: Boolean(inv.tax_labor),
      discount_type: discount ? discount[0] : 'amount',
      discount_value: discount ? discount[1] : 0,
      notes,
    },
    items.map(([kind, description, quantity, unit_price]) => ({ kind, description, quantity, unit_price }))
  );
  if (sent) invoices.setStatus(id, 'sent');
  for (const [daysAgo, method, amount] of payments) {
    invoices.addPayment(id, { amount, method, paid_on: ago(daysAgo), note: '' });
  }
  return id;
}

db.transaction(() => {
  addJob(0, 'Phone', 'Apple iPhone 13', 'F2LXK4T9Q1', 'Cracked screen after a drop. Touch still works. Left with case.', 0, []);
  addJob(3, 'Game Console', 'Sony PlayStation 5', 'S01-F3348812', 'No picture on the TV. Console powers on and beeps.', 1, []);

  addJob(1, 'Laptop', 'Dell XPS 15 9520', '7HK2PQ3', 'Will not charge. Battery light blinks orange. Charger left with us.', 3, [
    [2, 'status', 'diagnosing'],
    [2, 'note', 'Charger tests fine at 19.5V. DC jack looks loose on the board.'],
  ]);

  addJob(4, 'TV', 'Samsung QN55Q60B 55"', '0B3X3CAT500213', 'Sound but no picture. Backlight looks dead.', 6, [
    [5, 'status', 'diagnosing'],
    [5, 'note', 'Two LED strips failed. Power board output is good.'],
    [4, 'status', 'waiting_parts'],
    [4, 'note', 'Ordered LED strip kit BN96-52593A. Supplier says 5 to 7 days.'],
  ]);
  addJob(7, 'Printer', 'HP LaserJet Pro M404dn', 'PHBQJ41977', 'Paper jams on every page. Grinding noise from the back.', 9, [
    [8, 'status', 'diagnosing'],
    [7, 'status', 'waiting_parts'],
    [7, 'note', 'Fuser gear stripped. Replacement fuser on order.'],
  ]);

  addJob(5, 'Audio / Stereo', 'Marantz PM6007 amplifier', 'MZ0012345678', 'Left channel cuts out when the volume is turned.', 4, [
    [3, 'status', 'diagnosing'],
    [3, 'note', 'Volume pot is worn and dirty. Cleaning did not fix it.'],
    [1, 'status', 'repairing'],
    [1, 'note', 'Replacing volume potentiometer and re-flowing input board joints.'],
  ]);

  const ready1 = addJob(2, 'Tablet', 'Apple iPad Air (5th gen)', 'DMPG7XYZQ16M', 'Battery drains in two hours.', 8, [
    [7, 'status', 'diagnosing'],
    [7, 'note', 'Battery health at 61%. Recommended replacement, customer approved by phone.'],
    [5, 'status', 'repairing'],
    [2, 'status', 'ready'],
    [2, 'note', 'New battery fitted and calibrated. Left a voicemail.'],
  ]);
  addInvoice(ready1, {
    issuedDaysAgo: 2,
    sent: true,
    discount: ['percent', 10],
    notes: 'Battery replaced and tested for 24 hours. 90-day warranty on parts and labor.',
    items: [
      ['part', 'iPad Air replacement battery', 1, 6400],
      ['labor', 'Battery replacement', 1, 7500],
    ],
  });

  const ready2 = addJob(6, 'Laptop', 'Lenovo ThinkPad T14 Gen 2', 'PF3A9K2L', 'Keyboard keys E, R and T do not work after a coffee spill.', 5, [
    [4, 'status', 'diagnosing'],
    [3, 'status', 'repairing'],
    [1, 'status', 'ready'],
    [1, 'note', 'Keyboard replaced, board cleaned. All keys tested.'],
  ]);
  addInvoice(ready2, {
    issuedDaysAgo: 1,
    items: [
      ['part', 'ThinkPad T14 keyboard (US layout)', 1, 8900],
      ['labor', 'Keyboard replacement and liquid damage cleaning', 1.5, 6000],
    ],
  });

  const done1 = addJob(0, 'Laptop', 'Apple MacBook Air M1', 'C02FX1ABQ6L4', 'Screen flickers when the lid is moved.', 34, [
    [33, 'status', 'diagnosing'],
    [31, 'status', 'repairing'],
    [29, 'status', 'ready'],
    [28, 'status', 'picked_up'],
  ]);
  addInvoice(done1, {
    issuedDaysAgo: 29,
    sent: true,
    items: [
      ['part', 'Display flex cable', 1, 4500],
      ['labor', 'Display cable replacement', 1, 9000],
    ],
    payments: [[28, 'card', 14614]],
  });

  const done2 = addJob(7, 'Desktop PC', 'Dell OptiPlex 7090 (front desk)', 'J4T8W13', 'Very slow, takes 10 minutes to start.', 26, [
    [25, 'status', 'diagnosing'],
    [24, 'status', 'repairing'],
    [24, 'note', 'Hard drive failing (SMART errors). Cloned to a new SSD.'],
    [23, 'status', 'ready'],
    [22, 'status', 'picked_up'],
  ]);
  addInvoice(done2, {
    issuedDaysAgo: 23,
    dueInDays: 14,
    sent: true,
    items: [
      ['part', '500GB SATA SSD', 1, 5900],
      ['labor', 'Drive clone and Windows tune-up', 2, 6000],
    ],
  });

  const done3 = addJob(3, 'Phone', 'Samsung Galaxy S22', 'R5CT20ABCDE', 'Charging port only works at an angle.', 7, [
    [6, 'status', 'repairing'],
    [5, 'status', 'ready'],
    [4, 'status', 'picked_up'],
  ]);
  addInvoice(done3, {
    issuedDaysAgo: 5,
    sent: true,
    items: [
      ['part', 'USB-C charging port board', 1, 2800],
      ['labor', 'Charging port replacement', 1, 6500],
    ],
    payments: [[4, 'cash', 10067]],
  });

  const done4 = addJob(5, 'Headphones', 'Sony WH-1000XM4', '', 'Right ear cup has no sound.', 12, [
    [11, 'status', 'diagnosing'],
    [10, 'status', 'repairing'],
    [9, 'status', 'ready'],
    [8, 'status', 'picked_up'],
  ]);
  addInvoice(done4, {
    issuedDaysAgo: 9,
    sent: true,
    items: [['labor', 'Re-solder right driver wiring', 1, 5500]],
    payments: [[8, 'card', 3000]],
  });
});

const count = (table) => db.get(`SELECT COUNT(*) AS n FROM ${table}`).n;
console.log(`Demo data added: ${count('customers')} customers, ${count('jobs')} jobs and ${count('invoices')} invoices.`);
db.close();
