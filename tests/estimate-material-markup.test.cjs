'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = import(pathToFileURL(path.resolve(__dirname, '../src/smart.js')).href);

function fixture(DEFAULT_SETTINGS) {
  return {
    settings: { calc: { ...DEFAULT_SETTINGS.calc, digitalRatePerSide: 10, marginPercent: 20 } },
    inventory: [{ id: 'paper', unitMode: 'band_sheet', sheetsPerBand: 500, unitValue: 999999, ownerType: 'چاپخانه' }],
    item: { bindingType: 'بدون صحافی', analysis: { ok: true, invIds: { text: 'paper' }, numbers: {
      digital: true, qty: 1000, sheet: [70, 100], textGsm: 70,
      textSheetsTotal: 500, textSheetsNet: 500, textColors: 1, textSides: 1,
    } } },
  };
}

test('daily band rate is independent of book value; profit only covers services', async () => {
  const { estimateCost, DEFAULT_SETTINGS } = await load;
  const { item, inventory, settings } = fixture(DEFAULT_SETTINGS);
  const r = estimateCost(item, inventory, settings, { materialRates: { paper: 100000 } });
  // One band 100,000 + printing 500 × 10 + service profit 5,000 × 20%.
  assert.equal(r.materialTotal, 100000);
  assert.equal(r.serviceTotal, 5000);
  assert.equal(r.marginAmount, 1000);
  assert.equal(r.total, 105000);
  assert.equal(r.suggestedTotal, 106000);
  assert.equal(r.complete, true);
  inventory[0].unitValue = 1;
  assert.deepEqual(estimateCost(item, inventory, settings, { materialRates: { paper: 100000 } }), r);
});

test('missing or invalid daily rate prevents a suggested price; explicit zero is valid', async () => {
  const { estimateCost, DEFAULT_SETTINGS } = await load;
  const { item, inventory, settings } = fixture(DEFAULT_SETTINGS);
  for (const rate of [undefined, null, '', ' ', -1, NaN, Infinity, false, 'bad']) {
    const r = estimateCost(item, inventory, settings, { materialRates: { paper: rate } });
    assert.equal(r.complete, false, String(rate));
    assert.equal(r.suggestedTotal, null);
    assert.equal(r.suggestedUnit, null);
    assert.match(r.errors[0], /نرخ روز/);
  }
  assert.equal(estimateCost(item, inventory, settings).complete, false);
  const zero = estimateCost(item, inventory, settings, { materialRates: { paper: 0 } });
  assert.equal(zero.complete, true);
  assert.equal(zero.suggestedTotal, 6000);
});

test('customer-owned paper is zero without any daily rate', async () => {
  const { estimateCost, DEFAULT_SETTINGS } = await load;
  const { item, inventory, settings } = fixture(DEFAULT_SETTINGS);
  inventory[0].ownerType = 'مشتری';
  const r = estimateCost(item, inventory, settings);
  assert.equal(r.materialTotal, 0);
  assert.equal(r.complete, true);
  assert.equal(r.suggestedTotal, 6000);
});

test('cover sold by kilogram converts area and grammage using its own daily rate', async () => {
  const { estimateCost, DEFAULT_SETTINGS } = await load;
  const { item, inventory, settings } = fixture(DEFAULT_SETTINGS);
  inventory[0].ownerType = 'مشتری';
  inventory.push({ id: 'cover', unitMode: 'roll_kg', unitValue: 1, ownerType: 'چاپخانه' });
  item.analysis.invIds.cover = 'cover';
  Object.assign(item.analysis.numbers, { coverSheetsTotal: 100, coverSheetsNet: 100, coverSheet: [50, 70], coverGsm: 250, coverColors: 4, coverSides: 1 });
  const missing = estimateCost(item, inventory, settings);
  assert.equal(missing.complete, false);
  const r = estimateCost(item, inventory, settings, { materialRates: { cover: 2000 } });
  // 100 × .5 × .7 × 250 / 1000 = 8.75 kg; 8.75 × 2,000 = 17,500.
  assert.equal(r.materialTotal, 17500);
  assert.equal(r.serviceTotal, 6000);
  assert.equal(r.suggestedTotal, 24700);
});

test('missing material or invalid band conversion leaves estimate incomplete', async () => {
  const { estimateCost, DEFAULT_SETTINGS } = await load;
  const { item, inventory, settings } = fixture(DEFAULT_SETTINGS);
  assert.equal(estimateCost(item, [], settings).complete, false);
  inventory[0].sheetsPerBand = 0;
  assert.equal(estimateCost(item, inventory, settings, { materialRates: { paper: 100 } }).complete, false);
});

test('lithography fallback remains a service and absent plate rate is reported', async () => {
  const { estimateCost, DEFAULT_SETTINGS } = await load;
  const { item, inventory, settings } = fixture(DEFAULT_SETTINGS);
  inventory[0].ownerType = 'مشتری';
  Object.assign(item.analysis.numbers, { digital: false, totalPlates: 2 });
  settings.calc.plateCostFallback = 2000;
  const priced = estimateCost(item, inventory, settings);
  assert.equal(priced.serviceTotal, 4000);
  assert.equal(priced.suggestedTotal, 4800);
  settings.calc.plateCostFallback = 0;
  const missing = estimateCost(item, inventory, settings);
  assert.equal(missing.complete, false);
  assert.equal(missing.suggestedTotal, null);
  assert.ok(missing.errors.some(e => /زینک/.test(e)));
});
