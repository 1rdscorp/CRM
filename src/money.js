'use strict';

// All money is stored as whole cents (integers) so totals never drift by a
// fraction of a cent. The same maths runs in the browser for the live invoice
// preview: public/js/invoice-form.js mirrors computeTotals() below.

/** "1,234.50" / "$12" / 12.5  ->  cents. Anything unparseable or negative is 0. */
function parseMoney(input) {
  const n = parseNumber(input);
  return n > 0 ? Math.round(n * 100) : 0;
}

/** Lenient number parser for form fields. Returns 0 for junk. */
function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  const cleaned = String(input ?? '').replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** cents -> "1,234.50" (no currency symbol). */
function formatAmount(cents) {
  return (Math.abs(cents || 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** cents -> "$1,234.50". */
function formatMoney(cents, symbol = '$') {
  return (cents < 0 ? '-' : '') + symbol + formatAmount(cents);
}

/** cents -> "1234.50", for pre-filling form inputs. */
function toInputAmount(cents) {
  return ((cents || 0) / 100).toFixed(2);
}

function lineTotal(item) {
  return Math.round((Number(item.quantity) || 0) * (Number(item.unit_price) || 0));
}

/**
 * items: [{ kind: 'part'|'labor', quantity, unit_price (cents) }]
 * opts:  { taxRate (percent), taxLabor (bool), discountType: 'amount'|'percent',
 *          discountValue (cents when 'amount', percent when 'percent') }
 *
 * The discount comes off before tax. When labor is not taxed, the discount is
 * shared between parts and labor in proportion to their size.
 */
function computeTotals(items, opts = {}) {
  const taxRate = Math.max(0, Number(opts.taxRate) || 0);
  const taxLabor = opts.taxLabor !== false && opts.taxLabor !== 0;
  const discountValue = Math.max(0, Number(opts.discountValue) || 0);

  let subtotal = 0;
  let taxable = 0;
  for (const item of items) {
    const line = lineTotal(item);
    subtotal += line;
    if (taxLabor || item.kind !== 'labor') taxable += line;
  }

  let discount =
    opts.discountType === 'percent'
      ? Math.round((subtotal * Math.min(discountValue, 100)) / 100)
      : Math.round(discountValue);
  discount = Math.max(0, Math.min(discount, subtotal));

  const taxableAfterDiscount = subtotal > 0 ? (taxable * (subtotal - discount)) / subtotal : 0;
  const tax = Math.round((taxableAfterDiscount * taxRate) / 100);
  const total = subtotal - discount + tax;

  return { subtotal, discount, tax, total };
}

module.exports = {
  parseMoney,
  parseNumber,
  formatAmount,
  formatMoney,
  toInputAmount,
  lineTotal,
  computeTotals,
};
