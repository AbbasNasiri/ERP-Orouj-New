'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote, offsetPrintCost } = require('../electron/pricing.js');

test('agreed book example in caller-selected toman unit', () => {
  const quote = calculateQuote({
    currency: 'IRT',
    materials: [{ qty: 52500, rate: 100, customerSupplied: true }, { qty: 550, rate: 100, customerSupplied: true }],
    services: [408000000, 410000000, 17500000, 204000000].map(rate => ({ qty: 1, rate })),
    serviceMarkupPercent: 20, taxPercent: 10,
  });
  assert.equal(quote.baseCost, 1039500000);
  assert.equal(quote.subtotal, 1247400000);
  assert.equal(quote.total, 1372140000);
  assert.equal(quote.currency, 'IRT');
});

test('markup applies only to services and free offers do not affect sales totals', () => {
  const quote = calculateQuote({
    materials: [{ qty: 2, rate: 100, bookValue: 999999 }],
    services: [{ qty: 1, rate: 100 }], serviceMarkupPercent: 20,
    offers: [{ description: 'Free delivery', internalCost: 50 }, { description: 'Free cutting' }],
  });
  assert.equal(quote.materialsCost, 200);
  assert.equal(quote.baseCost, 300);
  assert.equal(quote.serviceMarkupAmount, 20);
  assert.equal(quote.total, 320);
  assert.equal(quote.offers[0].customerCharge, 0);
  assert.equal(quote.knownOffersInternalCost, 50);
  assert.equal(quote.offersWithUnknownCost, 1);
  assert.equal(quote.currency, 'IRR');
});

test('customer materials retain consumption, do not mutate input or charge book value', () => {
  const material = Object.freeze({ qty: 96.25, rate: 10000, customerSupplied: true, bookValue: 99999 });
  const result = calculateQuote({ materials: [material] });
  assert.equal(result.materials[0].consumedQty, 96.25);
  assert.equal(result.materials[0].cost, 0);
  assert.equal(result.total, 0);
  assert.equal(material.cost, undefined);
});

test('offset minimum full block per plate and explicit policy above 5000', () => {
  assert.equal(offsetPrintCost({ plates: 200, run: 2000, ratePerBlock: 2000000 }), 400000000);
  assert.equal(offsetPrintCost({ plates: 200, run: 5000, ratePerBlock: 2000000 }), 400000000);
  assert.equal(offsetPrintCost({ plates: 200, run: 0, ratePerBlock: 2000000 }), 0);
  assert.throws(() => offsetPrintCost({ plates: 200, run: 5001, ratePerBlock: 2000000 }), /explicit/);
  assert.equal(offsetPrintCost({ plates: 1, run: 7500, ratePerBlock: 100, mode: 'proportional' }), 150);
  assert.equal(offsetPrintCost({ plates: 1, run: 7500, ratePerBlock: 100, mode: 'ceilBlocks' }), 200);
});

test('decimal arithmetic rounds half up at stated line and percentage boundaries', () => {
  const quote = calculateQuote({ services: [{ qty: 0.145, rate: 100 }], serviceMarkupPercent: 10, taxPercent: 10 });
  assert.equal(quote.servicesCost, 15);
  assert.equal(quote.serviceMarkupAmount, 2);
  assert.equal(quote.taxAmount, 2);
  assert.equal(quote.total, 19);
});

test('reject negative, nonfinite, NaN and unsafe money instead of coercion', () => {
  for (const invalid of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => calculateQuote({ services: [{ qty: 1, rate: invalid }] }));
    assert.throws(() => calculateQuote({ materials: [{ qty: invalid, rate: 1 }] }));
    assert.throws(() => calculateQuote({ serviceMarkupPercent: invalid }));
    assert.throws(() => calculateQuote({ taxPercent: invalid }));
    assert.throws(() => offsetPrintCost({ plates: 1, run: invalid, ratePerBlock: 1 }));
  }
  assert.throws(() => calculateQuote({ materials: [{ qty: 1, rate: 1, bookValue: NaN }] }));
  assert.throws(() => calculateQuote({ offers: [{ internalCost: -1 }] }));
  assert.throws(() => calculateQuote({ offers: [{ customerCharge: 10 }] }));
  assert.throws(() => calculateQuote({ services: [{ qty: 1, rate: '100' }] }));
  assert.throws(() => calculateQuote({ services: [{ qty: 1, rate: 0.5 }] }));
  assert.throws(() => calculateQuote({ services: [{ qty: 2, rate: Number.MAX_SAFE_INTEGER }] }), /safe/);
  assert.throws(() => calculateQuote({ services: [{ qty: 1, rate: Number.MAX_SAFE_INTEGER }], serviceMarkupPercent: 1 }), /safe/);
  assert.throws(() => offsetPrintCost({ plates: 2, run: 1, ratePerBlock: Number.MAX_SAFE_INTEGER }), /safe/);
});
