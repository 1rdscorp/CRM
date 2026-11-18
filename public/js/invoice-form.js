/* Invoice editor: add/remove lines and keep the totals up to date as you type.
   The sums mirror computeTotals() in src/money.js; the server always
   recalculates when the invoice is saved. */
(function () {
  'use strict';

  var form = document.querySelector('[data-invoice-form]');
  if (!form) return;

  var currency = form.getAttribute('data-currency') || '$';
  var list = form.querySelector('[data-items]');
  var template = form.querySelector('[data-item-template]');

  function number(value) {
    var n = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function cents(value) {
    var n = number(value);
    return n > 0 ? Math.round(n * 100) : 0;
  }

  function money(amount) {
    return (
      (amount < 0 ? '-' : '') +
      currency +
      (Math.abs(amount) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }

  function rows() {
    return Array.prototype.slice.call(list.querySelectorAll('[data-item]'));
  }

  // Number the fields in screen order so the server keeps the same order.
  function renumber() {
    rows().forEach(function (row, index) {
      row.querySelectorAll('[name]').forEach(function (field) {
        var name = field.name.replace(/^items\[\d+\]\[(\w+)\]$/, '$1');
        field.name = 'items[' + index + '][' + name + ']';
      });
    });
  }

  function recalc() {
    var taxLabor = form.elements.tax_labor.checked;
    var subtotal = 0;
    var taxable = 0;

    rows().forEach(function (row) {
      var qtyText = row.querySelector('.qty').value.trim();
      var qty = qtyText === '' ? 1 : Math.max(0, number(qtyText));
      qty = Math.round(qty * 1000) / 1000;
      var line = Math.round(qty * cents(row.querySelector('.price').value));
      row.querySelector('[data-line-total]').textContent = money(line);
      subtotal += line;
      if (taxLabor || row.querySelector('.kind').value !== 'labor') taxable += line;
    });

    var discountValue = Math.max(0, number(form.elements.discount_value.value));
    var discount =
      form.elements.discount_type.value === 'percent'
        ? Math.round((subtotal * Math.min(discountValue, 100)) / 100)
        : Math.round(discountValue * 100);
    discount = Math.max(0, Math.min(discount, subtotal));

    var taxRate = Math.min(Math.max(0, number(form.elements.tax_rate.value)), 100);
    var taxableAfterDiscount = subtotal > 0 ? (taxable * (subtotal - discount)) / subtotal : 0;
    var tax = Math.round((taxableAfterDiscount * taxRate) / 100);

    var show = function (name, text) {
      form.querySelector('[data-total="' + name + '"]').textContent = text;
    };
    show('subtotal', money(subtotal));
    show('discount', discount ? '-' + money(discount) : money(0));
    show('tax', money(tax));
    show('total', money(subtotal - discount + tax));
  }

  function addRow(kind) {
    var row = template.content.firstElementChild.cloneNode(true);
    row.querySelector('.kind').value = kind;
    list.appendChild(row);
    renumber();
    recalc();
    row.querySelector('.desc').focus();
  }

  form.addEventListener('click', function (event) {
    var adder = event.target.closest('[data-add]');
    if (adder) {
      addRow(adder.getAttribute('data-add'));
      return;
    }
    var remover = event.target.closest('[data-remove]');
    if (remover) {
      remover.closest('[data-item]').remove();
      renumber();
      recalc();
    }
  });

  form.addEventListener('input', recalc);
  form.addEventListener('change', recalc);
  form.addEventListener('submit', renumber);

  // Enter in a line moves on instead of saving the half-finished invoice.
  list.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || event.target.tagName !== 'INPUT') return;
    event.preventDefault();
    var row = event.target.closest('[data-item]');
    var all = rows();
    if (row === all[all.length - 1]) addRow(row.querySelector('.kind').value);
    else all[all.indexOf(row) + 1].querySelector('.desc').focus();
  });

  renumber();
  recalc();
})();
