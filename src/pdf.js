'use strict';

// Draws the invoice PDF that is downloaded and attached to emails.
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { formatMoney } = require('./money');
const { formatDate } = require('./dates');
const { paymentMethodLabel } = require('./constants');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const COLOR = {
  text: '#1a2233',
  muted: '#667085',
  line: '#dfe3e8',
  soft: '#f3f5f8',
  paid: '#15803d',
};

/** 8.250 -> "8.25", 1.000 -> "1" */
const trimNumber = (n) => String(Number((Number(n) || 0).toFixed(3)));

function decodeLogo(dataUrl) {
  const match = /^data:image\/(?:png|jpeg);base64,(.+)$/.exec(dataUrl || '');
  return match ? Buffer.from(match[1], 'base64') : null;
}

/** Returns a Promise of a Buffer holding the PDF. */
function renderInvoicePdf(invoice, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: settings.paper_size === 'A4' ? 'A4' : 'LETTER',
      margin: 48,
      bufferPages: true,
      info: { Title: `Invoice ${invoice.number}`, Author: settings.business_name || '' },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc, invoice, settings);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function draw(doc, invoice, s) {
  doc.registerFont('body', path.join(FONT_DIR, 'Inter-Regular.otf'));
  doc.registerFont('bold', path.join(FONT_DIR, 'Inter-SemiBold.otf'));

  const money = (cents) => formatMoney(cents, s.currency_symbol);
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const pageBottom = doc.page.height - doc.page.margins.bottom - 24; // room for the page number
  let y = doc.page.margins.top;

  const body = (size = 10, color = COLOR.text) => doc.font('body').fontSize(size).fillColor(color);
  const bold = (size = 10, color = COLOR.text) => doc.font('bold').fontSize(size).fillColor(color);
  const label = (text, x, yPos, options = {}) =>
    bold(7.5, COLOR.muted).text(text.toUpperCase(), x, yPos, { characterSpacing: 0.6, ...options });
  const rule = (yPos, color = COLOR.line) =>
    doc.moveTo(left, yPos).lineTo(right, yPos).lineWidth(0.75).strokeColor(color).stroke();

  // ---- Header: business on the left, invoice title on the right -----------
  const headerRightWidth = 190;
  const headerLeftWidth = width - headerRightWidth - 20;
  let leftY = y;

  const logo = decodeLogo(s.logo);
  if (logo) {
    try {
      const image = doc.openImage(logo);
      const scale = Math.min(180 / image.width, 60 / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      doc.image(image, left, leftY, { width: w, height: h });
      leftY += h + 10;
    } catch {
      /* an unreadable logo should never stop an invoice from being produced */
    }
  }

  bold(14).text(s.business_name || '', left, leftY, { width: headerLeftWidth });
  leftY = doc.y + 3;
  const contact = [
    ...String(s.business_address || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    [s.business_phone, s.business_email].filter(Boolean).join('  ·  '),
    s.business_website,
  ].filter(Boolean);
  for (const line of contact) {
    body(9, COLOR.muted).text(line, left, leftY, { width: headerLeftWidth });
    leftY = doc.y + 1.5;
  }

  const rightX = right - headerRightWidth;
  bold(24).text('INVOICE', rightX, y - 4, { width: headerRightWidth, align: 'right' });
  body(11, COLOR.muted).text(invoice.number, rightX, doc.y + 1, { width: headerRightWidth, align: 'right' });
  let rightY = doc.y;
  if (invoice.status === 'paid') {
    const badgeW = 52;
    const badgeY = rightY + 8;
    doc
      .roundedRect(right - badgeW, badgeY, badgeW, 19, 4)
      .lineWidth(1.25)
      .strokeColor(COLOR.paid)
      .stroke();
    bold(9.5, COLOR.paid).text('PAID', right - badgeW, badgeY + 4.5, {
      width: badgeW,
      align: 'center',
      characterSpacing: 1,
    });
    rightY = badgeY + 19;
  }

  y = Math.max(leftY, rightY) + 16;
  rule(y);
  y += 16;

  // ---- Bill to / device / dates ------------------------------------------
  const gap = 18;
  const colA = width * 0.36;
  const colB = width * 0.34;
  const colC = width - colA - colB;
  const xA = left;
  const xB = left + colA;
  const xC = left + colA + colB;

  label('Bill to', xA, y);
  let aY = y + 13;
  bold(10.5).text(invoice.customer.name, xA, aY, { width: colA - gap });
  aY = doc.y + 2;
  for (const line of [invoice.customer.phone, invoice.customer.email].filter(Boolean)) {
    body(9.5, COLOR.muted).text(line, xA, aY, { width: colA - gap });
    aY = doc.y + 1.5;
  }

  let bY = y;
  if (invoice.device) {
    label('Device', xB, y);
    bY = y + 13;
    for (const line of invoice.device.split(' · ')) {
      body(9.5).text(line, xB, bY, { width: colB - gap });
      bY = doc.y + 1.5;
    }
  }

  let cY = y;
  const meta = [
    ['Issue date', formatDate(invoice.issue_date)],
    ['Due date', formatDate(invoice.due_date)],
  ];
  if (invoice.job_id) meta.push(['Job', `#${invoice.job_id}`]);
  for (const [name, value] of meta) {
    body(9.5, COLOR.muted).text(name, xC, cY, { width: colC * 0.45 });
    body(9.5).text(value, xC + colC * 0.45, cY, { width: colC * 0.55, align: 'right' });
    cY += 15;
  }

  y = Math.max(aY, bY, cY) + 18;

  // ---- Line items ---------------------------------------------------------
  const cols = { type: 52, qty: 44, price: 82, amount: 86 };
  const xAmount = right - cols.amount;
  const xPrice = xAmount - cols.price;
  const xQty = xPrice - cols.qty;
  const xType = xQty - cols.type;
  const descWidth = xType - left - 12;

  function tableHeader() {
    label('Description', left, y);
    label('Type', xType, y);
    label('Qty', xQty, y, { width: cols.qty, align: 'right' });
    label('Unit price', xPrice, y, { width: cols.price, align: 'right' });
    label('Amount', xAmount, y, { width: cols.amount, align: 'right' });
    y += 14;
    rule(y, COLOR.text);
    y += 8;
  }

  function newPage() {
    doc.addPage();
    y = doc.page.margins.top;
  }

  tableHeader();
  if (invoice.items.length === 0) {
    body(10, COLOR.muted).text('No items yet.', left, y);
    y = doc.y + 8;
  }
  for (const item of invoice.items) {
    const description = item.description || (item.kind === 'labor' ? 'Labor' : 'Part');
    const rowHeight = body(10).heightOfString(description, { width: descWidth });
    if (y + rowHeight > pageBottom) {
      newPage();
      tableHeader();
    }
    body(10).text(description, left, y, { width: descWidth });
    const rowBottom = doc.y;
    body(9.5, COLOR.muted).text(item.kind === 'labor' ? 'Labor' : 'Part', xType, y + 0.5);
    body(10).text(trimNumber(item.quantity), xQty, y, { width: cols.qty, align: 'right' });
    body(10).text(money(item.unit_price), xPrice, y, { width: cols.price, align: 'right' });
    body(10).text(money(item.line_total), xAmount, y, { width: cols.amount, align: 'right' });
    y = rowBottom + 7;
    rule(y);
    y += 8;
  }

  // ---- Totals -------------------------------------------------------------
  const totalsWidth = 236;
  const xTotals = right - totalsWidth;
  const rows = [['Subtotal', money(invoice.subtotal)]];
  if (invoice.discount > 0) {
    const pct = invoice.discount_type === 'percent' ? ` (${trimNumber(invoice.discount_value)}%)` : '';
    rows.push([`Discount${pct}`, `-${money(invoice.discount)}`]);
  }
  if (invoice.tax_rate > 0) {
    const scope = invoice.tax_labor ? '' : ' on parts';
    rows.push([`${s.tax_label || 'Tax'} (${trimNumber(invoice.tax_rate)}%)${scope}`, money(invoice.tax)]);
  }
  const hasPayments = invoice.payments.length > 0;
  const totalsHeight = rows.length * 17 + 34 + (hasPayments ? invoice.payments.length * 17 + 34 : 0);
  if (y + totalsHeight > pageBottom) newPage();

  y += 4;
  for (const [name, value] of rows) {
    body(10, COLOR.muted).text(name, xTotals, y, { width: totalsWidth * 0.6 });
    body(10).text(value, xTotals + totalsWidth * 0.5, y, { width: totalsWidth * 0.5, align: 'right' });
    y += 17;
  }

  const strongRow = (name, value) => {
    doc.rect(xTotals - 10, y, totalsWidth + 10, 26).fill(COLOR.soft);
    bold(11.5).text(name, xTotals, y + 7, { width: totalsWidth * 0.5 });
    bold(11.5).text(value, xTotals + totalsWidth * 0.4, y + 7, { width: totalsWidth * 0.6 - 8, align: 'right' });
    y += 34;
  };

  y += 2;
  if (!hasPayments) {
    strongRow('Total', money(invoice.total));
  } else {
    bold(10).text('Total', xTotals, y, { width: totalsWidth * 0.5 });
    bold(10).text(money(invoice.total), xTotals + totalsWidth * 0.5, y, { width: totalsWidth * 0.5, align: 'right' });
    y += 17;
    for (const payment of invoice.payments) {
      const name = `Paid ${formatDate(payment.paid_on)} · ${paymentMethodLabel(payment.method)}`;
      body(9.5, COLOR.muted).text(name, xTotals, y, { width: totalsWidth * 0.68 });
      body(10).text(`-${money(payment.amount)}`, xTotals + totalsWidth * 0.5, y, {
        width: totalsWidth * 0.5,
        align: 'right',
      });
      y += 17;
    }
    y += 2;
    strongRow('Balance due', money(invoice.balance));
  }

  // ---- Notes and footer ---------------------------------------------------
  if (invoice.notes) {
    const notesHeight = body(9.5).heightOfString(invoice.notes, { width }) + 20;
    if (y + Math.min(notesHeight, 120) > pageBottom) newPage();
    y += 6;
    label('Notes', left, y);
    y += 13;
    body(9.5).text(invoice.notes, left, y, { width, lineGap: 1.5 });
    y = doc.y + 10;
  }

  if (s.invoice_footer) {
    const footerHeight = body(9.5).heightOfString(s.invoice_footer, { width, align: 'center' });
    if (y + footerHeight + 24 > pageBottom) newPage();
    y += 14;
    rule(y);
    y += 12;
    body(9.5, COLOR.muted).text(s.invoice_footer, left, y, { width, align: 'center', lineGap: 1.5 });
  }

  // ---- Page numbers (only when the invoice runs over one page) -------------
  const range = doc.bufferedPageRange();
  if (range.count > 1) {
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // let us write inside the margin without adding a page
      body(8.5, COLOR.muted).text(
        `${invoice.number}  ·  Page ${i + 1} of ${range.count}`,
        left,
        doc.page.height - bottomMargin + 6,
        { width, align: 'center', lineBreak: false }
      );
      doc.page.margins.bottom = bottomMargin;
    }
  }
}

module.exports = { renderInvoicePdf };
