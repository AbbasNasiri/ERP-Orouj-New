'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = import(pathToFileURL(path.resolve(__dirname, '../src/quote-money.mjs')).href);

function snapshot() {
  const services = [4080000000, 4100000000, 175000000, 2040000000].map((cost, index) => ({ description: `خدمت ${index}`, qty: 1, rate: cost, cost }));
  return { quoteRev: 2, items: [{ qty: 1, unitPrice: 999999 }], discount: 99999, vatPercent: 99,
    payments: [{ amount: '1000000000' }], pricing: { schemaVersion: 1, revision: 2, result: {
      currency: 'IRR', materials: [{ description: 'کاغذ مشتری', qty: 52500, rate: 100, cost: 0, customerSupplied: true, bookValue: 123456789 }],
      services, materialsCost: 0, servicesCost: 10395000000, baseCost: 10395000000, serviceMarkupAmount: 2079000000,
      subtotal: 12474000000, discount: 0, taxAmount: 1247400000, total: 13721400000,
      offers: [{ description: 'ارسال رایگان', customerCharge: 0, internalCost: 987654321 }],
    } } };
}

test('IRR snapshot book example is authoritative, with paid balance and aligned rows', async () => {
  const m = await load;
  const order = snapshot();
  const before = JSON.stringify(order);
  assert.equal(m.moneyError(order), null);
  assert.equal(m.hasQuotePricing(order), true);
  assert.equal(m.orderGrandTotal(order), 12474000000);
  assert.equal(m.orderDiscount(order), 0);
  assert.equal(m.orderTax(order), 1247400000);
  assert.equal(m.orderPayable(order), 13721400000);
  assert.equal(m.orderPaid(order), 1000000000);
  assert.equal(m.orderBalance(order), 12721400000);
  for (const detailed of [false, true]) {
    const rows = m.invoiceRows(order, detailed);
    assert.equal(rows.reduce((sum, row) => sum + row.total, 0), m.orderGrandTotal(order));
    assert.equal(rows[0].qty, '۵۲٬۵۰۰');
    assert.equal(rows[0].price, '۰');
    assert.equal(rows[0].total, 0);
    assert.equal(rows.at(-1).total, 0);
    assert.equal(JSON.stringify(rows).includes('987654321'), false);
    assert.equal(JSON.stringify(rows).includes('123456789'), false);
    assert.equal(rows.some(row => 'internalCost' in row || 'bookValue' in row), false);
  }
  assert.equal(JSON.stringify(order), before);
});

test('material cost has no extra markup; discount and tax come from result', async () => {
  const m = await load;
  const order = { quoteRev: 1, payments: [], pricing: { schemaVersion: 1, revision: 1, result: {
    currency: 'IRR', materials: [{ qty: 2, rate: 100, cost: 200 }], services: [{ qty: 1, rate: 100, cost: 100 }],
    materialsCost: 200, servicesCost: 100, baseCost: 300, serviceMarkupAmount: 20,
    subtotal: 320, discount: 10, taxAmount: 31, total: 341, offers: [],
  } } };
  assert.equal(m.orderGrandTotal(order), 320);
  assert.equal(m.orderDiscount(order), 10);
  assert.equal(m.orderTax(order), 31);
  assert.equal(m.orderPayable(order), 341);
  assert.equal(m.invoiceRows(order, true).reduce((sum, row) => sum + row.total, 0), 320);
});

test('stale, malformed, foreign-unit or inconsistent snapshots never fall back to legacy values', async () => {
  const m = await load;
  const mutations = [
    order => { order.pricing.revision = 1; }, order => { order.pricing = null; },
    order => { order.pricing.schemaVersion = 2; }, order => { order.pricing.result.currency = 'IRT'; },
    order => { order.pricing.result.total = NaN; }, order => { order.pricing.result.subtotal = -1; },
    order => { order.pricing.result.total = Number.MAX_SAFE_INTEGER + 1; },
    order => { order.pricing.result.materials[0].cost = 1; }, order => { order.pricing.result.services[0].cost++; },
    order => { order.pricing.result.offers[0].customerCharge = 1; },
  ];
  for (const mutate of mutations) {
    const order = snapshot(); mutate(order);
    assert.equal(m.hasQuotePricing(order), false);
    assert.equal(typeof m.moneyError(order), 'string');
    assert.equal(m.orderGrandTotal(order), 0);
    assert.equal(m.orderTax(order), 0);
    assert.equal(m.orderPayable(order), 0);
    assert.equal(m.orderBalance(order), 0);
    assert.deepEqual(m.invoiceRows(order, true), []);
  }
});

test('legacy detailed and summary rows retain existing totals and formatting', async () => {
  const m = await load;
  const order = { items: [{ id: 'i1', productName: 'کتاب', productType: 'رحلی', qty: '2000', qtyUnit: 'نسخه', unitPrice: '100',
    hasDesign: true, designPrice: '500', designDescription: 'جلد', services: [{ id: 's1', serviceType: 'برش', notes: 'نهایی', price: '700' }],
    spec: { sizeKey: 'رحلی', pages: 400, textKind: 'تحریر', textGsm: 70 }, bindingType: 'چسب گرم' }],
    shippingCost: '100', otherCost: '200', otherLabel: 'بسته‌بندی', discount: '1500', vatPercent: '10', payments: [{ amount: '1000' }, { amount: 2000 }] };
  assert.equal(m.moneyError(order), null);
  assert.equal(m.hasQuotePricing(order), false);
  assert.equal(m.orderGrandTotal(order), 201500);
  assert.equal(m.orderTax(order), 20000);
  assert.equal(m.orderPayable(order), 220000);
  assert.equal(m.orderPaid(order), 3000);
  assert.equal(m.orderBalance(order), 217000);
  const detailed = m.invoiceRows(order, true);
  assert.deepEqual(detailed[0], { key: 'i1', desc: 'کتاب (رحلی)', spec: 'قطع رحلی — 400 صفحه — تحریر 70 گرم — چسب گرم', qty: '2,000 نسخه', price: '100', total: 200000 });
  assert.deepEqual(detailed[1], { key: 'i1d', desc: 'طراحی — جلد', qty: '—', price: '—', total: 500, sub: true });
  for (const rows of [detailed, m.invoiceRows(order, false)]) assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 201500);
});
