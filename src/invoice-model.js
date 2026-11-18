'use strict';

// Everything that reads or changes invoices lives here, so the web pages, the
// PDF and the emails all agree on the numbers.

const { computeTotals, lineTotal } = require('./money');
const { addDays, nowIso } = require('./dates');

const PAID_SQL = 'COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0)';
const LIST_SQL = `
  SELECT i.*, c.name AS customer_name, ${PAID_SQL} AS paid
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id
`;
// "Overdue" is never stored: it is a sent invoice, past its due date, with money still owed.
const OVERDUE_SQL = `(i.status = 'sent' AND i.due_date < ? AND i.total > ${PAID_SQL})`;

function createInvoiceModel({ db, settings }) {
  /** Adds the values that are worked out rather than stored. */
  function decorate(invoice, today) {
    invoice.balance = Math.max(0, invoice.total - invoice.paid);
    invoice.display_status =
      invoice.status === 'sent' && invoice.due_date < today && invoice.balance > 0 ? 'overdue' : invoice.status;
    return invoice;
  }

  function list({ today, status, q, customerId, jobId, limit } = {}) {
    const where = [];
    const params = [];
    if (status === 'draft' || status === 'paid') {
      where.push('i.status = ?');
      params.push(status);
    } else if (status === 'sent') {
      where.push(`i.status = 'sent' AND NOT ${OVERDUE_SQL}`);
      params.push(today);
    } else if (status === 'overdue') {
      where.push(OVERDUE_SQL);
      params.push(today);
    } else if (status === 'unpaid') {
      where.push(`i.status = 'sent' AND i.total > ${PAID_SQL}`);
    }
    if (customerId) {
      where.push('i.customer_id = ?');
      params.push(customerId);
    }
    if (jobId) {
      where.push('i.job_id = ?');
      params.push(jobId);
    }
    if (q) {
      where.push("(i.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR i.device LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      params.push(like, like, like);
    }
    const sql =
      LIST_SQL +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY i.issue_date DESC, i.id DESC' +
      (limit ? ` LIMIT ${Number(limit)}` : '');
    return db.all(sql, ...params).map((row) => decorate(row, today));
  }

  /** One invoice with its customer, job, line items and payments. */
  function load(id, today) {
    const invoice = db.get(LIST_SQL + ' WHERE i.id = ?', id);
    if (!invoice) return null;
    decorate(invoice, today);
    invoice.customer = db.get('SELECT * FROM customers WHERE id = ?', invoice.customer_id);
    invoice.job = invoice.job_id ? db.get('SELECT * FROM jobs WHERE id = ?', invoice.job_id) : null;
    invoice.items = db
      .all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id', id)
      .map((item) => ({ ...item, line_total: lineTotal(item) }));
    invoice.payments = db.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, id', id);
    return invoice;
  }

  function takeNextNumber() {
    const prefix = settings.get('invoice_prefix');
    let n = Math.max(1, Math.floor(settings.number('next_invoice_number')));
    let number = prefix + String(n).padStart(4, '0');
    while (db.get('SELECT 1 AS taken FROM invoices WHERE number = ?', number)) {
      n += 1;
      number = prefix + String(n).padStart(4, '0');
    }
    settings.set({ next_invoice_number: n + 1 });
    return number;
  }

  /** Describe a job's device in one line for the invoice. */
  function deviceLine(job) {
    if (!job) return '';
    let line = job.brand_model || job.device_type || '';
    if (job.brand_model && job.device_type) line += ` (${job.device_type})`;
    if (job.serial_number) line += `${line ? ' · ' : ''}S/N ${job.serial_number}`;
    return line;
  }

  /** New draft invoice, pre-filled from the job when there is one. */
  function create({ customerId, job = null, today }) {
    return db.transaction(() => {
      const now = nowIso();
      const dueDays = Math.max(0, Math.floor(settings.number('due_days')));
      const result = db.run(
        `INSERT INTO invoices
           (number, customer_id, job_id, device, issue_date, due_date, status,
            tax_rate, tax_labor, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, '', ?, ?)`,
        takeNextNumber(),
        customerId,
        job ? job.id : null,
        deviceLine(job),
        today,
        addDays(today, dueDays),
        Math.max(0, settings.number('tax_rate')),
        settings.get('tax_labor') === '1' ? 1 : 0,
        now,
        now
      );
      return Number(result.lastInsertRowid);
    });
  }

  /** Keep the stored status in step with what has actually been paid. */
  function refreshStatus(id) {
    const row = db.get(LIST_SQL + ' WHERE i.id = ?', id);
    if (!row) return;
    let status = row.status;
    if (row.total > 0 && row.paid >= row.total) status = 'paid';
    else if (row.status === 'paid' && row.paid < row.total) status = 'sent';
    else if (row.status === 'draft' && row.paid > 0) status = 'sent';
    if (status !== row.status) {
      db.run('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
    }
  }

  /** Replace the editable fields and all line items, then re-total. */
  function save(id, fields, items) {
    db.transaction(() => {
      const totals = computeTotals(items, {
        taxRate: fields.tax_rate,
        taxLabor: fields.tax_labor,
        discountType: fields.discount_type,
        discountValue: fields.discount_value,
      });
      db.run(
        `UPDATE invoices SET
           device = ?, issue_date = ?, due_date = ?, tax_rate = ?, tax_labor = ?,
           discount_type = ?, discount_value = ?, notes = ?,
           subtotal = ?, discount = ?, tax = ?, total = ?, updated_at = ?
         WHERE id = ?`,
        fields.device,
        fields.issue_date,
        fields.due_date,
        fields.tax_rate,
        fields.tax_labor ? 1 : 0,
        fields.discount_type,
        fields.discount_value,
        fields.notes,
        totals.subtotal,
        totals.discount,
        totals.tax,
        totals.total,
        nowIso(),
        id
      );
      db.run('DELETE FROM invoice_items WHERE invoice_id = ?', id);
      items.forEach((item, position) => {
        db.run(
          `INSERT INTO invoice_items (invoice_id, position, kind, description, quantity, unit_price)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          position,
          item.kind,
          item.description,
          item.quantity,
          item.unit_price
        );
      });
      refreshStatus(id);
    });
  }

  function setStatus(id, status) {
    db.run('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
  }

  /** Remember that the invoice was emailed; a draft becomes "sent". */
  function markEmailed(id, to) {
    const now = nowIso();
    db.run(
      `UPDATE invoices SET emailed_at = ?, emailed_to = ?, updated_at = ?,
              status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END
       WHERE id = ?`,
      now,
      to,
      now,
      id
    );
  }

  function addPayment(id, { amount, method, paid_on, note }) {
    db.transaction(() => {
      db.run(
        'INSERT INTO payments (invoice_id, amount, method, paid_on, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        amount,
        method,
        paid_on,
        note,
        nowIso()
      );
      refreshStatus(id);
    });
  }

  function deletePayment(id, paymentId) {
    db.transaction(() => {
      db.run('DELETE FROM payments WHERE id = ? AND invoice_id = ?', paymentId, id);
      refreshStatus(id);
    });
  }

  function remove(id) {
    db.run('DELETE FROM invoices WHERE id = ?', id);
  }

  /** How many invoices are in each status, for the filter buttons. */
  function counts(today) {
    return db.get(
      `SELECT COUNT(*) AS "all",
              COALESCE(SUM(i.status = 'draft'), 0) AS draft,
              COALESCE(SUM(i.status = 'sent' AND NOT ${OVERDUE_SQL}), 0) AS sent,
              COALESCE(SUM(${OVERDUE_SQL}), 0) AS overdue,
              COALESCE(SUM(i.status = 'paid'), 0) AS paid
       FROM invoices i`,
      today,
      today
    );
  }

  return { list, load, counts, create, save, setStatus, markEmailed, addPayment, deletePayment, remove, deviceLine };
}

module.exports = { createInvoiceModel };
