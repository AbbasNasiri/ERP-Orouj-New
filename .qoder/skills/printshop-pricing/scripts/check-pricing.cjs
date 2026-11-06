#!/usr/bin/env node
/* Checks the print-shop pricing invariants against the real backend engine.
   Usage: node check-pricing.cjs [--root=<project-dir>] */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const FALLBACK_ROOT = 'C:/Users/LianTech/Desktop/print-shop-desktop-v1.9-secure/print-shop-desktop';

function findRoot() {
  const arg = process.argv.slice(2).find(a => a.startsWith('--root='));
  if (arg) return arg.slice(7);
  if (process.env.PRINTSHOP_ROOT) return process.env.PRINTSHOP_ROOT;
  let dir = HERE;
  for (let depth = 0; depth < 6; depth++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try { if (JSON.parse(fs.readFileSync(pkg, 'utf8')).name === 'print-shop-desktop') return dir; } catch { /* ignore */ }
    }
    dir = path.dirname(dir);
  }
  return FALLBACK_ROOT;
}

const root = findRoot();
const pricingPath = path.join(root, 'electron', 'pricing.js');
if (!fs.existsSync(pricingPath)) {
  console.log(`FAIL cannot find electron/pricing.js under ${root} — pass --root=<project dir>`);
  process.exit(2);
}
const { calculateQuote, offsetPrintCost } = require(pricingPath);

let failed = 0;
function check(name, fn) {
  try {
    const warning = fn();
    console.log(warning ? `WARN ${name}\n     ${warning}` : `PASS ${name}`);
    if (warning) return;
  } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); return; }
}
function eq(got, want, label) {
  if (got !== want) throw new Error(`${label} expected ${want} got ${got}`);
}

const BOOK = () => calculateQuote({
  currency: 'IRT',
  materials: [{ description: 'کاغذ متن مشتری', qty: 52500, rate: 100, customerSupplied: true },
    { description: 'مقوای جلد مشتری', qty: 550, rate: 100, customerSupplied: true }],
  services: [408000000, 410000000, 17500000, 204000000].map(rate => ({ qty: 1, rate })),
  serviceMarkupPercent: 20, taxPercent: 10,
  offers: [{ description: 'برش و بسته‌بندی و ارسال', customerCharge: 0, internalCost: 5000000 }],
});

check('owner reference example: 400p two-colour Rahli, 2000 copies', () => {
  const q = BOOK();
  eq(q.materialsCost, 0, 'materialsCost');
  eq(q.servicesCost, 1039500000, 'servicesCost');
  eq(q.baseCost, 1039500000, 'baseCost');
  eq(q.serviceMarkupAmount, 207900000, 'serviceMarkupAmount');
  eq(q.subtotal, 1247400000, 'subtotal');
  eq(q.taxAmount, 124740000, 'taxAmount');
  eq(q.total, 1372140000, 'total');
  eq(q.offers[0].customerCharge, 0, 'offer customerCharge');
  eq(q.knownOffersInternalCost, 5000000, 'offer internal cost kept separate');
});

check('markup is never applied to materials', () => {
  const q = calculateQuote({ materials: [{ qty: 100, rate: 1000000 }], services: [], serviceMarkupPercent: 30 });
  eq(q.baseCost, 100000000, 'baseCost');
  eq(q.serviceMarkupAmount, 0, 'serviceMarkupAmount');
  eq(q.subtotal, 100000000, 'subtotal');
});

check('customer-supplied material keeps its consumed quantity', () => {
  const q = calculateQuote({ materials: [{ qty: 52500, rate: 100, customerSupplied: true }] });
  eq(q.materials[0].cost, 0, 'cost');
  eq(q.materials[0].consumedQty, 52500, 'consumedQty');
});

check('offset block rule requires an explicit mode above 5000 sheets', () => {
  eq(offsetPrintCost({ plates: 1, run: 5000, ratePerBlock: 2000000 }), 2000000, 'minimum block');
  eq(offsetPrintCost({ plates: 1, run: 1, ratePerBlock: 2000000 }), 2000000, 'any run up to a block is one block');
  eq(offsetPrintCost({ plates: 200, run: 2100, ratePerBlock: 2000000 }), 400000000, '200 plates at 2100 run');
  let threw = false;
  try { offsetPrintCost({ plates: 1, run: 5001, ratePerBlock: 2000000 }); } catch { threw = true; }
  if (!threw) throw new Error('run above one block must require an explicit pricing mode');
  eq(offsetPrintCost({ plates: 1, run: 10000, ratePerBlock: 2000000, mode: 'ceilBlocks' }), 4000000, 'ceilBlocks at two full blocks');
  eq(offsetPrintCost({ plates: 1, run: 10000, ratePerBlock: 2000000, mode: 'proportional' }), 4000000, 'proportional at two full blocks');
  eq(offsetPrintCost({ plates: 1, run: 10001, ratePerBlock: 2000000, mode: 'ceilBlocks' }), 6000000, 'ceilBlocks rounds the partial block up');
  eq(offsetPrintCost({ plates: 1, run: 10001, ratePerBlock: 2000000, mode: 'proportional' }), 4000400, 'proportional prorates the whole run');
});

check('discount is taken before tax and tax stays a parameter', () => {
  const q = calculateQuote({ services: [{ qty: 1, rate: 1000000 }], serviceMarkupPercent: 0, taxPercent: 10, discount: 200000 });
  eq(q.discountedSubtotal, 800000, 'discountedSubtotal');
  eq(q.taxAmount, 80000, 'taxAmount on discounted subtotal');
  eq(calculateQuote({ services: [{ qty: 1, rate: 1000000 }] }).taxAmount, 0, 'no tax unless declared');
});

check('forged money and negative quantities are rejected', () => {
  [-1, NaN, Infinity].forEach(bad => {
    try { calculateQuote({ services: [{ qty: bad, rate: 10 }] }); throw new Error(`accepted qty ${bad}`); }
    catch (e) { if (/accepted/.test(e.message)) throw e; }
  });
  try { calculateQuote({ services: [{ qty: 1, rate: -5 }] }); throw new Error('accepted negative rate'); }
  catch (e) { if (/accepted/.test(e.message)) throw e; }
});

check('renderer estimate must not mark up materials', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'smart.js'), 'utf8');
  const marksUpEverything = /suggestedTotal\s*=\s*total\s*\*\s*\(1\s*\+/.test(src);
  if (marksUpEverything) {
    const line = src.slice(0, src.indexOf('suggestedTotal = total')).split('\n').length;
    return `src/smart.js:${line} adds marginPercent to the whole total including materials — diverges from electron/pricing.js (markup on services only). Sales figures in the Finance tab must come from the backend quote, not this estimate.`;
  }
});

console.log(`\n${failed ? `${failed} pricing checks FAILED` : 'all pricing checks pass'} — root: ${root}`);
process.exit(failed ? 1 : 0);
