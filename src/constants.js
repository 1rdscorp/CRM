'use strict';

// The repair workflow, in order. The last status closes the job.
const JOB_STATUSES = [
  { key: 'received', label: 'Received' },
  { key: 'diagnosing', label: 'Diagnosing' },
  { key: 'waiting_parts', label: 'Waiting for Parts' },
  { key: 'repairing', label: 'Repairing' },
  { key: 'ready', label: 'Ready for Pickup' },
  { key: 'picked_up', label: 'Picked Up' },
];
const JOB_STATUS_KEYS = JOB_STATUSES.map((s) => s.key);
const OPEN_JOB_STATUSES = JOB_STATUSES.filter((s) => s.key !== 'picked_up');
const CLOSED_JOB_STATUS = 'picked_up';

const jobStatusLabel = (key) => JOB_STATUSES.find((s) => s.key === key)?.label || key;
const nextJobStatus = (key) => JOB_STATUSES[JOB_STATUS_KEYS.indexOf(key) + 1] || null;

// "Overdue" is never stored: it is a sent invoice whose due date has passed.
const INVOICE_STATUSES = [
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
];
const invoiceStatusLabel = (key) => INVOICE_STATUSES.find((s) => s.key === key)?.label || key;

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'other', label: 'Other' },
];
const paymentMethodLabel = (key) => PAYMENT_METHODS.find((m) => m.key === key)?.label || key;

const ITEM_KINDS = [
  { key: 'part', label: 'Part' },
  { key: 'labor', label: 'Labor' },
];

// Suggestions offered when typing a device type on a job. Any text is allowed.
const DEVICE_TYPES = [
  'Phone',
  'Tablet',
  'Laptop',
  'Desktop PC',
  'TV',
  'Monitor',
  'Game Console',
  'Audio / Stereo',
  'Headphones',
  'Camera',
  'Smartwatch',
  'Printer',
  'Appliance',
  'Other',
];

module.exports = {
  JOB_STATUSES,
  JOB_STATUS_KEYS,
  OPEN_JOB_STATUSES,
  CLOSED_JOB_STATUS,
  jobStatusLabel,
  nextJobStatus,
  INVOICE_STATUSES,
  invoiceStatusLabel,
  PAYMENT_METHODS,
  paymentMethodLabel,
  ITEM_KINDS,
  DEVICE_TYPES,
};
