'use strict';

const express = require('express');
const {
  JOB_STATUSES,
  JOB_STATUS_KEYS,
  OPEN_JOB_STATUSES,
  CLOSED_JOB_STATUS,
  jobStatusLabel,
} = require('../constants');
const { nowIso, isValidDate } = require('../dates');
const { str, toId, like, safePath, notFound } = require('../util');
const { readCustomerForm, insertCustomer } = require('./customers');

module.exports = function jobRoutes({ db, invoices }) {
  const router = express.Router();

  const JOB_SQL = `
    SELECT j.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
    FROM jobs j JOIN customers c ON c.id = j.customer_id
  `;

  const findJob = (req) => {
    const id = toId(req.params.id);
    const job = id && db.get(JOB_SQL + ' WHERE j.id = ?', id);
    if (!job) throw notFound();
    return job;
  };

  /** WHERE clause for the search box: customer, device, serial, problem or job number. */
  function searchClause(q) {
    if (!q) return { sql: '', params: [] };
    const clauses = [
      "c.name LIKE ? ESCAPE '\\'",
      "j.device_type LIKE ? ESCAPE '\\'",
      "j.brand_model LIKE ? ESCAPE '\\'",
      "j.serial_number LIKE ? ESCAPE '\\'",
      "j.problem LIKE ? ESCAPE '\\'",
    ];
    const params = Array(clauses.length).fill(like(q));
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3) {
      clauses.push('c.phone_digits LIKE ?');
      params.push(`%${digits}%`);
    }
    const jobNumber = toId(q.replace(/^#/, ''));
    if (jobNumber) {
      clauses.push('j.id = ?');
      params.push(jobNumber);
    }
    return { sql: `(${clauses.join(' OR ')})`, params };
  }

  function readJobForm(body, today) {
    const job = {
      device_type: str(body.device_type, 80),
      brand_model: str(body.brand_model, 160),
      serial_number: str(body.serial_number, 120),
      problem: str(body.problem, 4000),
      date_received: isValidDate(body.date_received) ? body.date_received : today,
    };
    let error = null;
    if (!job.device_type && !job.brand_model) error = 'Please say what the device is.';
    return { job, error };
  }

  function changeStatus(job, status) {
    if (job.status === status) return;
    const now = nowIso();
    db.transaction(() => {
      db.run(
        'UPDATE jobs SET status = ?, status_changed_at = ?, updated_at = ? WHERE id = ?',
        status,
        now,
        now,
        job.id
      );
      db.run(
        "INSERT INTO job_notes (job_id, kind, body, created_at) VALUES (?, 'status', ?, ?)",
        job.id,
        status,
        now
      );
    });
  }

  // ---- Board / list ------------------------------------------------------

  router.get('/jobs', (req, res) => {
    if (req.query.view === 'board' || req.query.view === 'list') req.session.jobsView = req.query.view;
    const view = req.session.jobsView === 'list' ? 'list' : 'board';
    const q = str(req.query.q, 100);
    const search = searchClause(q);

    let status = String(req.query.status || 'open');
    if (!['open', 'all', ...JOB_STATUS_KEYS].includes(status)) status = 'open';
    // The board only shows open jobs; closed ones are on the list.
    const showBoard = view === 'board' && status !== 'all' && status !== CLOSED_JOB_STATUS;

    const where = [];
    const params = [];
    if (status === 'open') where.push(`j.status != '${CLOSED_JOB_STATUS}'`);
    else if (status !== 'all') {
      where.push('j.status = ?');
      params.push(status);
    }
    if (search.sql) {
      where.push(search.sql);
      params.push(...search.params);
    }
    const jobs = db.all(
      JOB_SQL +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        (showBoard ? ' ORDER BY j.date_received, j.id' : ' ORDER BY j.date_received DESC, j.id DESC') +
        ' LIMIT 500',
      ...params
    );

    const countRows = db.all(
      `SELECT j.status, COUNT(*) AS n FROM jobs j JOIN customers c ON c.id = j.customer_id
       ${search.sql ? 'WHERE ' + search.sql : ''} GROUP BY j.status`,
      ...search.params
    );
    const counts = Object.fromEntries(countRows.map((r) => [r.status, r.n]));
    counts.all = countRows.reduce((sum, r) => sum + r.n, 0);
    counts.open = counts.all - (counts[CLOSED_JOB_STATUS] || 0);

    const columns = (status === 'open' ? OPEN_JOB_STATUSES : JOB_STATUSES.filter((s) => s.key === status)).map(
      (s) => ({ ...s, jobs: jobs.filter((job) => job.status === s.key) })
    );

    res.render('jobs/index', {
      title: 'Jobs',
      view,
      showBoard,
      status,
      q,
      jobs,
      columns,
      counts,
      returnTo: req.originalUrl,
    });
  });

  // ---- Create ------------------------------------------------------------

  router.get('/jobs/new', (req, res) => {
    const customerId = toId(req.query.customer_id);
    const customer = customerId ? db.get('SELECT * FROM customers WHERE id = ?', customerId) : null;
    res.render('jobs/form', {
      title: 'New job',
      job: {
        device_type: '',
        brand_model: '',
        serial_number: '',
        problem: '',
        date_received: req.today,
      },
      customer: customer || null,
      newCustomer: null,
      error: null,
    });
  });

  router.post('/jobs', (req, res) => {
    const { job, error: jobError } = readJobForm(req.body, req.today);
    const customerId = toId(req.body.customer_id);
    let customer = customerId ? db.get('SELECT * FROM customers WHERE id = ?', customerId) : null;
    let newCustomer = null;
    let error = null;

    if (!customer) {
      const form = readCustomerForm(req.body, 'new_customer_');
      if (form.customer.name || form.customer.phone || form.customer.email) {
        newCustomer = form.customer;
        error = form.error;
      } else {
        error = 'Please choose a customer, or add a new one.';
      }
    }
    error = error || jobError;

    if (error) {
      return res.status(400).render('jobs/form', { title: 'New job', job, customer, newCustomer, error });
    }

    const id = db.transaction(() => {
      const now = nowIso();
      const ownerId = customer ? customer.id : insertCustomer(db, newCustomer);
      const result = db.run(
        `INSERT INTO jobs
           (customer_id, device_type, brand_model, serial_number, problem, date_received,
            status, status_changed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`,
        ownerId,
        job.device_type,
        job.brand_model,
        job.serial_number,
        job.problem,
        job.date_received,
        now,
        now,
        now
      );
      return Number(result.lastInsertRowid);
    });
    req.flash('success', `Job #${id} created.`);
    res.redirect(`/jobs/${id}`);
  });

  // ---- View / edit -------------------------------------------------------

  router.get('/jobs/:id', (req, res) => {
    const job = findJob(req);
    const notes = db.all('SELECT * FROM job_notes WHERE job_id = ? ORDER BY created_at DESC, id DESC', job.id);
    res.render('jobs/show', {
      title: `Job #${job.id}`,
      job,
      notes,
      invoices: invoices.list({ today: req.today, jobId: job.id }),
    });
  });

  router.get('/jobs/:id/edit', (req, res) => {
    const job = findJob(req);
    res.render('jobs/form', {
      title: `Edit job #${job.id}`,
      job,
      customer: { id: job.customer_id, name: job.customer_name, phone: job.customer_phone, email: job.customer_email },
      newCustomer: null,
      error: null,
    });
  });

  router.post('/jobs/:id', (req, res) => {
    const existing = findJob(req);
    const { job, error } = readJobForm(req.body, existing.date_received);
    if (error) {
      return res.status(400).render('jobs/form', {
        title: `Edit job #${existing.id}`,
        job: { ...job, id: existing.id },
        customer: { id: existing.customer_id, name: existing.customer_name, phone: existing.customer_phone },
        newCustomer: null,
        error,
      });
    }
    db.run(
      `UPDATE jobs SET device_type = ?, brand_model = ?, serial_number = ?, problem = ?,
              date_received = ?, updated_at = ? WHERE id = ?`,
      job.device_type,
      job.brand_model,
      job.serial_number,
      job.problem,
      job.date_received,
      nowIso(),
      existing.id
    );
    req.flash('success', 'Job saved.');
    res.redirect(`/jobs/${existing.id}`);
  });

  router.post('/jobs/:id/status', (req, res) => {
    const job = findJob(req);
    const status = String(req.body.status || '');
    const wantsJson = req.accepts(['html', 'json']) === 'json';
    if (!JOB_STATUS_KEYS.includes(status)) {
      if (wantsJson) return res.status(400).json({ error: 'Unknown status.' });
      req.flash('error', 'Unknown status.');
      return res.redirect(`/jobs/${job.id}`);
    }
    changeStatus(job, status);
    if (wantsJson) return res.json({ ok: true, status });
    req.flash('success', `Job #${job.id} moved to ${jobStatusLabel(status)}.`);
    res.redirect(safePath(req.body.next, `/jobs/${job.id}`));
  });

  router.post('/jobs/:id/notes', (req, res) => {
    const job = findJob(req);
    const body = str(req.body.body, 4000);
    if (body) {
      db.run(
        "INSERT INTO job_notes (job_id, kind, body, created_at) VALUES (?, 'note', ?, ?)",
        job.id,
        body,
        nowIso()
      );
    }
    res.redirect(`/jobs/${job.id}#notes`);
  });

  router.post('/jobs/:id/notes/:noteId/delete', (req, res) => {
    const job = findJob(req);
    db.run("DELETE FROM job_notes WHERE id = ? AND job_id = ? AND kind = 'note'", toId(req.params.noteId), job.id);
    res.redirect(`/jobs/${job.id}#notes`);
  });

  router.post('/jobs/:id/delete', (req, res) => {
    const job = findJob(req);
    db.run('DELETE FROM jobs WHERE id = ?', job.id);
    req.flash('success', `Job #${job.id} was deleted.`);
    res.redirect('/jobs');
  });

  // One click: start an invoice already filled in with this job's customer and device.
  router.post('/jobs/:id/invoice', (req, res) => {
    const job = findJob(req);
    const invoiceId = invoices.create({ customerId: job.customer_id, job, today: req.today });
    res.redirect(`/invoices/${invoiceId}/edit`);
  });

  return router;
};
