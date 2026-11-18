'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMoney, formatMoney, toInputAmount, computeTotals } = require('../src/money');
const dates = require('../src/dates');

test('parseMoney reads what people actually type', () => {
  assert.equal(parseMoney('12'), 1200);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney('$1,234.56'), 123456);
  assert.equal(parseMoney(' 0.07 '), 7);
  assert.equal(parseMoney('19.99'), 1999); // no floating point drift
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney('abc'), 0);
  assert.equal(parseMoney('-5'), 0);
  assert.equal(parseMoney(undefined), 0);
});

test('formatMoney and toInputAmount', () => {
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(5, '£'), '£0.05');
  assert.equal(formatMoney(-250), '-$2.50');
  assert.equal(toInputAmount(123456), '1234.56');
});

test('totals: parts and labor, no tax or discount', () => {
  const totals = computeTotals(
    [
      { kind: 'part', quantity: 2, unit_price: 1250 },
      { kind: 'labor', quantity: 1.5, unit_price: 8000 },
    ],
    {}
  );
  assert.deepEqual(totals, { subtotal: 14500, discount: 0, tax: 0, total: 14500 });
});

test('totals: percent discount comes off before tax', () => {
  const items = [
    { kind: 'labor', quantity: 1.5, unit_price: 8000 }, // 120.00
    { kind: 'part', quantity: 2, unit_price: 1250 }, // 25.00
  ];
  const totals = computeTotals(items, { taxRate: 8.25, taxLabor: true, discountType: 'percent', discountValue: 10 });
  // 145.00 - 14.50 = 130.50; tax 10.766 -> 10.77
  assert.deepEqual(totals, { subtotal: 14500, discount: 1450, tax: 1077, total: 14127 });
});

test('totals: when labor is not taxed, only the parts share is taxed', () => {
  const items = [
    { kind: 'labor', quantity: 1.5, unit_price: 8000 },
    { kind: 'part', quantity: 2, unit_price: 1250 },
  ];
  const totals = computeTotals(items, { taxRate: 8.25, taxLabor: false, discountType: 'percent', discountValue: 10 });
  // parts 25.00 less 10% = 22.50; tax 1.856 -> 1.86
  assert.deepEqual(totals, { subtotal: 14500, discount: 1450, tax: 186, total: 13236 });
});

test('totals: a flat discount can never exceed the subtotal', () => {
  const totals = computeTotals([{ kind: 'part', quantity: 1, unit_price: 2000 }], {
    taxRate: 10,
    discountType: 'amount',
    discountValue: 5000,
  });
  assert.deepEqual(totals, { subtotal: 2000, discount: 2000, tax: 0, total: 0 });
});

test('totals: empty invoice', () => {
  assert.deepEqual(computeTotals([], { taxRate: 8 }), { subtotal: 0, discount: 0, tax: 0, total: 0 });
});

test('date helpers', () => {
  assert.equal(dates.addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(dates.daysBetween('2026-11-01', '2026-11-18'), 17);
  assert.deepEqual(dates.monthRange('2028-02-10'), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(dates.formatDate('2026-11-18'), 'Nov 18, 2026');
  assert.equal(dates.isValidDate('2026-02-30'), false);
  assert.equal(dates.isValidDate('2026-02-28'), true);
  assert.equal(dates.isValidTimeZone('America/Chicago'), true);
  assert.equal(dates.isValidTimeZone('Not/AZone'), false);
  assert.match(dates.today('Pacific/Auckland'), /^\d{4}-\d{2}-\d{2}$/);
});
