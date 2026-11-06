const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote } = require('../electron/pricing');
const { allocate, buildInvoiceData } = require('../electron/invoice');
const { computeQuote } = require('../electron/quote');

test('invoice allocations preserve integer totals with stable remainder ties', () => {
  assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(allocate(0, [0, 0]), [0, 0]);
  assert.throws(() => allocate(1, [0]));
  assert.deepEqual(allocate(Number.MAX_SAFE_INTEGER, [Number.MAX_SAFE_INTEGER]), [Number.MAX_SAFE_INTEGER]);
});

test('invoice hides internal offer costs, includes service markup and reconciles every row', () => {
  const quote = calculateQuote({ currency: 'IRR', materials: [
    { id: 'm1', description: 'کاغذ مشتری', qty: 105, unit: 'بند', rate: 500, customerSupplied: true },
    { id: 'm2', description: 'مقوا', qty: 2.5, unit: 'کیلو', rate: 1001 },
  ], services: [{ id: 's1', description: 'چاپ', qty: 3, unit: 'دور', rate: 101 }, { id: 's2', description: 'صحافی', qty: 7, unit: 'فرم', rate: 31 }], serviceMarkupPercent: 20, discount: 7, taxPercent: 10,
    offers: [{ id: 'gift', description: 'ارسال رایگان', internalCost: 987654321 }] });
  const before = JSON.stringify(quote);
  const data = buildInvoiceData(quote);
  assert.equal(JSON.stringify(quote), before);
  assert.equal(data.rows[0].grossAmount, 0);
  assert.equal(data.rows[1].grossAmount, 2503, 'materials receive no markup');
  assert.equal(data.rows[2].grossAmount + data.rows[3].grossAmount, quote.servicesCost + quote.serviceMarkupAmount);
  for (const key of Object.keys(data.totals)) assert.equal(data.rows.reduce((s, r) => s + r[key], 0), data.totals[key]);
  assert.equal(JSON.stringify(data).includes('987654321'), false);
  assert.equal(JSON.stringify(data).includes('internalCost'), false);
  assert.equal(data.rows.at(-1).total, 0);
});

test('a fully discounted invoice has no fictional taxable amount; corrupted totals fail closed', () => {
  const quote = calculateQuote({ services: [{ id: 's', description: 'خدمت', qty: 1, unit: 'بار', rate: 5 }], discount: 5, taxPercent: 10 });
  assert.deepEqual(buildInvoiceData(quote).totals, { grossAmount: 5, discountAmount: 5, taxableAmount: 0, taxAmount: 0, total: 0 });
  assert.throws(() => buildInvoiceData({ ...quote, total: 1 }));
});

test('a supplied goods/service code is whitelisted, completed to 13 digits and frozen; invalid codes are rejected', () => {
  const input = { services: [{ id: 's', description: 'چاپ', qty: 1, unit: 'بار', rate: 10, itemCode: '1234567890123', bookValue: 999 }] };
  const quote = computeQuote(input);
  assert.equal(buildInvoiceData(quote.result).rows[0].itemCode, input.services[0].itemCode);
  assert.equal(Object.hasOwn(quote.input.services[0], 'bookValue'), false);
  assert.equal(computeQuote({ services: [{ ...input.services[0], itemCode: '12' }] }).input.services[0].itemCode, '0000000000012');
  assert.equal(computeQuote({ services: [{ ...input.services[0], itemCode: '۱۲۳' }] }).input.services[0].itemCode, '0000000000123');
  assert.equal(computeQuote({ services: [{ ...input.services[0], itemCode: '' }] }).input.services[0].itemCode, undefined);
  for (const itemCode of ['12345678901234', 1234567890123, '<script>', '12a']) assert.throws(() => computeQuote({ services: [{ ...input.services[0], itemCode }] }));
});
