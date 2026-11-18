'use strict';

const express = require('express');
const { nowIso } = require('../dates');
const { str, toId, like, isEmail, notFound } = require('../util');

const LIST_LIMIT = 300;

/** Read and check the customer fields of a form. */
function readCustomerForm(body, prefix = '') {
  const customer = {
    name: str(body[prefix + 'name'], 120),
    phone: str(body[prefix + 'phone'], 40),
    email: str(body[prefix + 'email'], 200),
    address: str(body[prefix + 'address'], 400),
    notes: str(body[prefix + 'notes'], 4000),
  };
  let error = null;
  if (!customer.name) error = 'Please enter the customer’s name.';
  else if (customer.email && !isEmail(customer.email)) error = 'That email address does not look right.';
  return { customer, error };
}

function insertCustomer(db, customer) {
  const now = nowIso();
  const result = db.run(
    `INSERT INTO customers (name, phone, phone_digits, email, address, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    customer.name,
    customer.phone,
    customer.phone.replace(/\D/g, ''),
    customer.email,
    customer.address || '',
    customer.notes || '',
    now,
    now
  );
  return Number(result.lastInsertRowid);
}

module.exports = function customerRoutes({ db, invoices }) {
  const router = express.Router();

  function search(q, limit) {
    const where = [];
    const params = [];
    if (q) {
      const clauses = ["c.name LIKE ? ESCAPE '\\'", "c.email LIKE ? ESCAPE '\\'", "c.phone LIKE ? ESCAPE '\\'"];
      params.push(like(q), like(q), like(q));
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 3) {
        clauses.push('c.phone_digits LIKE ?');
        params.push(`%${digits}%`);
      }
      where.push(`(${clauses.join(' OR ')})`);
    }
    return db.all(
      `SELECT c.*,
              (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id) AS job_count,
              (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id AND j.status != 'picked_up') AS open_jobs
       FROM customers c
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.name COLLATE NOCASE, c.id
       LIMIT ${Number(limit)}`,
      ...params
    );
  }

  const findCustomer = (req) => {
    const id = toId(req.params.id);
    const customer = id && db.get('SELECT * FROM customers WHERE id = ?', id);
    if (!customer) throw notFound();
    return customer;
  };

  router.get('/customers', (req, res) => {
    const q = str(req.query.q, 100);
    const customers = search(q, LIST_LIMIT + 1);
    const truncated = customers.length > LIST_LIMIT;
    res.render('customers/index', {
      title: 'Customers',
      q,
      customers: customers.slice(0, LIST_LIMIT),
      truncated,
      total: db.get('SELECT COUNT(*) AS n FROM customers').n,
    });
  });

  // Used by the customer search box on the "New job" form.
  router.get('/api/customers', (req, res) => {
    const q = str(req.query.q, 100);
    const rows = q ? search(q, 8) : [];
    res.json(rows.map(({ id, name, phone, email }) => ({ id, name, phone, email })));
  });

  router.get('/customers/new', (req, res) => {
    res.render('customers/form', {
      title: 'New customer',
      customer: { name: '', phone: '', email: '', address: '', notes: '' },
      error: null,
    });
  });

  router.post('/customers', (req, res) => {
    const { customer, error } = readCustomerForm(req.body);
    if (error) {
      return res.status(400).render('customers/form', { title: 'New customer', customer, error });
    }
    const id = insertCustomer(db, customer);
    req.flash('success', 'Customer added.');
    res.redirect(`/customers/${id}`);
  });

  router.get('/customers/:id', (req, res) => {
    const customer = findCustomer(req);
    const jobs = db.all(
      'SELECT * FROM jobs WHERE customer_id = ? ORDER BY date_received DESC, id DESC',
      customer.id
    );
    const customerInvoices = invoices.list({ today: req.today, customerId: customer.id });
    const owed = customerInvoices
      .filter((inv) => inv.status === 'sent')
      .reduce((sum, inv) => sum + inv.balance, 0);
    res.render('customers/show', {
      title: customer.name,
      customer,
      jobs,
      invoices: customerInvoices,
      owed,
    });
  });

  router.get('/customers/:id/edit', (req, res) => {
    const customer = findCustomer(req);
    res.render('customers/form', { title: `Edit ${customer.name}`, customer, error: null });
  });

  router.post('/customers/:id', (req, res) => {
    const existing = findCustomer(req);
    const { customer, error } = readCustomerForm(req.body);
    if (error) {
      return res.status(400).render('customers/form', {
        title: `Edit ${existing.name}`,
        customer: { ...customer, id: existing.id },
        error,
      });
    }
    db.run(
      `UPDATE customers SET name = ?, phone = ?, phone_digits = ?, email = ?, address = ?, notes = ?,
              updated_at = ?
       WHERE id = ?`,
      customer.name,
      customer.phone,
      customer.phone.replace(/\D/g, ''),
      customer.email,
      customer.address,
      customer.notes,
      nowIso(),
      existing.id
    );
    req.flash('success', 'Customer saved.');
    res.redirect(`/customers/${existing.id}`);
  });

  router.post('/customers/:id/delete', (req, res) => {
    const customer = findCustomer(req);
    const used = db.get(
      `SELECT (SELECT COUNT(*) FROM jobs WHERE customer_id = ?) AS jobs,
              (SELECT COUNT(*) FROM invoices WHERE customer_id = ?) AS invoices`,
      customer.id,
      customer.id
    );
    if (used.jobs || used.invoices) {
      req.flash('error', 'This customer has jobs or invoices, so it cannot be deleted. Delete those first.');
      return res.redirect(`/customers/${customer.id}`);
    }
    db.run('DELETE FROM customers WHERE id = ?', customer.id);
    req.flash('success', `${customer.name} was deleted.`);
    res.redirect('/customers');
  });

  return router;
};

module.exports.readCustomerForm = readCustomerForm;
module.exports.insertCustomer = insertCustomer;
