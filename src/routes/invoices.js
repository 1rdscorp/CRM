'use strict';

const express = require('express');
const { PAYMENT_METHODS, paymentMethodLabel } = require('../constants');
const { isValidDate, formatDate } = require('../dates');
const { parseMoney, parseNumber, formatMoney } = require('../money');
const { str, toId, isEmail, notFound } = require('../util');
const { renderInvoicePdf } = require('../pdf');
const { sendMail } = require('../mailer');

const MAX_ITEMS = 200;

module.exports = function invoiceRoutes({ db, settings, invoices }) {
  const router = express.Router();

  const findInvoice = (req) => {
    const id = toId(req.params.id);
    const invoice = id && invoices.load(id, req.today);
    if (!invoice) throw notFound();
    return invoice;
  };

  /** Turn the posted line-item rows into clean items. Empty rows are dropped. */
  function readItems(body) {
    const raw = body.items && typeof body.items === 'object' ? Object.values(body.items) : [];
    return raw
      .slice(0, MAX_ITEMS)
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const quantityText = str(row.quantity, 20);
        const quantity = quantityText === '' ? 1 : Math.max(0, parseNumber(quantityText));
        return {
          kind: row.kind === 'labor' ? 'labor' : 'part',
          description: str(row.description, 300),
          quantity: Math.min(Math.round(quantity * 1000) / 1000, 1e6),
          unit_price: Math.min(parseMoney(row.unit_price), 1e10),
        };
      })
      .filter((item) => item.description || item.unit_price > 0);
  }

  function readInvoiceForm(body, existing) {
    const issueDate = isValidDate(body.issue_date) ? body.issue_date : existing.issue_date;
    let dueDate = isValidDate(body.due_date) ? body.due_date : existing.due_date;
    if (dueDate < issueDate) dueDate = issueDate;
    const discountType = body.discount_type === 'percent' ? 'percent' : 'amount';
    return {
      device: str(body.device, 300),
      issue_date: issueDate,
      due_date: dueDate,
      tax_rate: Math.min(Math.max(0, parseNumber(body.tax_rate)), 100),
      tax_labor: body.tax_labor === '1',
      discount_type: discountType,
      discount_value:
        discountType === 'percent'
          ? Math.min(Math.max(0, parseNumber(body.discount_value)), 100)
          : parseMoney(body.discount_value),
      notes: str(body.notes, 4000),
    };
  }

  function defaultEmail(invoice) {
    const shop = settings.get('business_name');
    const currency = settings.get('currency_symbol');
    const lines = [
      `Hi ${invoice.customer.name},`,
      '',
      `Please find attached invoice ${invoice.number}${invoice.device ? ` for your ${invoice.device.split(' · ')[0]}` : ''}.`,
      '',
      invoice.balance > 0
        ? `Amount due: ${formatMoney(invoice.balance, currency)}\nDue date: ${formatDate(invoice.due_date)}`
        : `Total: ${formatMoney(invoice.total, currency)} (paid in full, thank you!)`,
      '',
      'Thank you,',
      shop,
    ];
    const phone = settings.get('business_phone');
    if (phone) lines.push(phone);
    return {
      to: invoice.customer.email,
      subject: `Invoice ${invoice.number} from ${shop}`,
      message: lines.join('\n'),
    };
  }

  // ---- List --------------------------------------------------------------

  router.get('/invoices', (req, res) => {
    const q = str(req.query.q, 100);
    let status = String(req.query.status || 'all');
    if (!['all', 'draft', 'sent', 'overdue', 'paid', 'unpaid'].includes(status)) status = 'all';
    const list = invoices.list({ today: req.today, status: status === 'all' ? null : status, q, limit: 500 });
    const counts = invoices.counts(req.today);
    res.render('invoices/index', { title: 'Invoices', invoices: list, status, q, counts });
  });

  // New invoice for a customer without a repair job (e.g. selling an accessory).
  router.post('/invoices', (req, res) => {
    const customerId = toId(req.body.customer_id);
    const customer = customerId && db.get('SELECT id FROM customers WHERE id = ?', customerId);
    if (!customer) throw notFound();
    const id = invoices.create({ customerId: customer.id, today: req.today });
    res.redirect(`/invoices/${id}/edit`);
  });

  // ---- View / edit -------------------------------------------------------

  router.get('/invoices/:id', (req, res) => {
    const invoice = findInvoice(req);
    res.render('invoices/show', {
      title: `Invoice ${invoice.number}`,
      invoice,
      business: settings.all(),
      emailReady: settings.emailConfigured(),
      email: defaultEmail(invoice),
    });
  });

  router.get('/invoices/:id/edit', (req, res) => {
    const invoice = findInvoice(req);
    res.render('invoices/form', { title: `Edit invoice ${invoice.number}`, invoice });
  });

  router.post('/invoices/:id', (req, res) => {
    const invoice = findInvoice(req);
    invoices.save(invoice.id, readInvoiceForm(req.body, invoice), readItems(req.body));
    req.flash('success', 'Invoice saved.');
    res.redirect(`/invoices/${invoice.id}`);
  });

  router.get('/invoices/:id/pdf', async (req, res) => {
    const invoice = findInvoice(req);
    const pdf = await renderInvoicePdf(invoice, settings.all());
    const filename = `Invoice-${invoice.number.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  });

  // ---- Status and payments ----------------------------------------------

  router.post('/invoices/:id/status', (req, res) => {
    const invoice = findInvoice(req);
    const status = String(req.body.status || '');
    const fullyPaid = invoice.total > 0 && invoice.paid >= invoice.total;

    if (status === 'sent' && !fullyPaid) {
      invoices.setStatus(invoice.id, 'sent');
      req.flash('success', `Invoice ${invoice.number} marked as sent.`);
    } else if (status === 'draft' && invoice.paid === 0) {
      invoices.setStatus(invoice.id, 'draft');
      req.flash('success', `Invoice ${invoice.number} moved back to draft.`);
    } else if (status === 'paid' && invoice.balance === 0) {
      invoices.setStatus(invoice.id, 'paid');
      req.flash('success', `Invoice ${invoice.number} marked as paid.`);
    } else {
      req.flash('error', 'That status change is not possible for this invoice.');
    }
    res.redirect(`/invoices/${invoice.id}`);
  });

  router.post('/invoices/:id/payments', (req, res) => {
    const invoice = findInvoice(req);
    const amount = parseMoney(req.body.amount);
    const method = PAYMENT_METHODS.some((m) => m.key === req.body.method) ? req.body.method : 'other';
    const currency = settings.get('currency_symbol');

    if (amount <= 0) {
      req.flash('error', 'Enter the amount that was paid.');
    } else if (amount > invoice.balance) {
      req.flash(
        'error',
        `That is more than the ${formatMoney(invoice.balance, currency)} still owed on this invoice.`
      );
    } else {
      invoices.addPayment(invoice.id, {
        amount,
        method,
        paid_on: isValidDate(req.body.paid_on) ? req.body.paid_on : req.today,
        note: str(req.body.note, 200),
      });
      const paidOff = amount === invoice.balance;
      req.flash(
        'success',
        `${formatMoney(amount, currency)} ${paymentMethodLabel(method).toLowerCase()} payment recorded.` +
          (paidOff ? ' Invoice is paid in full.' : '')
      );
    }
    res.redirect(`/invoices/${invoice.id}`);
  });

  router.post('/invoices/:id/payments/:paymentId/delete', (req, res) => {
    const invoice = findInvoice(req);
    invoices.deletePayment(invoice.id, toId(req.params.paymentId));
    req.flash('success', 'Payment removed.');
    res.redirect(`/invoices/${invoice.id}`);
  });

  // ---- Email -------------------------------------------------------------

  router.post('/invoices/:id/email', async (req, res) => {
    const invoice = findInvoice(req);
    const back = `/invoices/${invoice.id}`;
    const to = str(req.body.to, 200);
    const defaults = defaultEmail(invoice);
    const subject = str(req.body.subject, 200) || defaults.subject;
    const message = str(req.body.message, 5000) || defaults.message;

    if (!settings.emailConfigured()) {
      req.flash('error', 'Email is not set up yet. Add your email server details in Settings.');
      return res.redirect(back);
    }
    if (!isEmail(to)) {
      req.flash('error', 'Enter a valid email address to send the invoice to.');
      return res.redirect(back);
    }

    try {
      const pdf = await renderInvoicePdf(invoice, settings.all());
      await sendMail(settings.all(), {
        to,
        subject,
        text: message,
        attachments: [
          {
            filename: `Invoice-${invoice.number.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
    } catch (err) {
      console.error('Email failed:', err.message);
      req.flash('error', `The email could not be sent: ${str(err.message, 300)}`);
      return res.redirect(back);
    }

    invoices.markEmailed(invoice.id, to);
    req.flash('success', `Invoice ${invoice.number} emailed to ${to}.`);
    res.redirect(back);
  });

  router.post('/invoices/:id/delete', (req, res) => {
    const invoice = findInvoice(req);
    invoices.remove(invoice.id);
    req.flash('success', `Invoice ${invoice.number} was deleted.`);
    res.redirect(invoice.job_id ? `/jobs/${invoice.job_id}` : '/invoices');
  });

  return router;
};
