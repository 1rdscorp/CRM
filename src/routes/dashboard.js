'use strict';

const express = require('express');
const { OPEN_JOB_STATUSES, CLOSED_JOB_STATUS } = require('../constants');
const { monthRange, formatMonth } = require('../dates');

module.exports = function dashboardRoutes({ db, settings, invoices }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const today = req.today;

    const counts = Object.fromEntries(
      db
        .all('SELECT status, COUNT(*) AS n FROM jobs WHERE status != ? GROUP BY status', CLOSED_JOB_STATUS)
        .map((row) => [row.status, row.n])
    );
    const jobsByStatus = OPEN_JOB_STATUSES.map((s) => ({ ...s, count: counts[s.key] || 0 }));
    const openJobs = jobsByStatus.reduce((sum, s) => sum + s.count, 0);

    const readyJobs = db.all(
      `SELECT j.*, c.name AS customer_name, c.phone AS customer_phone
       FROM jobs j JOIN customers c ON c.id = j.customer_id
       WHERE j.status = 'ready'
       ORDER BY j.status_changed_at, j.id`
    );

    const unpaid = invoices
      .list({ today, status: 'unpaid' })
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.id - b.id);
    const unpaidTotal = unpaid.reduce((sum, inv) => sum + inv.balance, 0);
    const overdueCount = unpaid.filter((inv) => inv.display_status === 'overdue').length;
    const draftCount = db.get("SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'").n;

    const { start, end } = monthRange(today);
    const collected = db.get(
      'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM payments WHERE paid_on BETWEEN ? AND ?',
      start,
      end
    );

    res.render('dashboard', {
      title: 'Dashboard',
      jobsByStatus,
      openJobs,
      readyJobs,
      unpaid,
      unpaidTotal,
      overdueCount,
      draftCount,
      collected,
      monthLabel: formatMonth(today),
      // Nudge a new shop to add the details that appear on its invoices.
      needsDetails: !settings.get('business_phone') && !settings.get('business_address') && !settings.get('logo'),
    });
  });

  return router;
};
