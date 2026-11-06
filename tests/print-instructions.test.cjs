'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'src', f)).href);

test('دستور چاپ: نیم‌فرم و یک‌چهارم فرم تیراژ کسری و عبارت روی خودش دورو', async () => {
  const { planBook } = await load('print-engine.mjs');
  const half = planBook({ cut: 'وزیری', pages: 328, qty: 1000, press: '2 ورقی', colors: 1 });
  assert.ok(half.ok, half.errors && half.errors.join());
  assert.match(half.forms[0].instruction, /کامل، پشت‌ورو/);
  assert.match(half.forms[1].instruction, /نیم‌فرم.*روی خودش دورو.*500/);
  const quarter = planBook({ cut: 'وزیری', pages: 324, qty: 1000, press: 'GTO', colors: 1 });
  assert.match(quarter.forms[1].instruction, /یک‌چهارم فرم.*250/);
});

test('خط‌لولهٔ تحلیل: دستور اپراتور و ابعاد جلد در numbers.engine', async () => {
  const smart = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'smart.js')).href);
  const settings = { calc: { ...smart.DEFAULT_SETTINGS.calc } };
  const inventory = [
    { id: 'p1', name: 'تحریر ۷۰ گرم', category: 'کاغذ', gramaj: '70', size: '70×100', unitMode: 'band_sheet', bandCount: 100, sheetsPerBand: 500, simpleUnit: 'بند' },
    { id: 'c1', name: 'گلاسه ۲۵۰ گرم', category: 'مقوا', gramaj: '250', size: '50×70', unitMode: 'band_sheet', bandCount: 50, sheetsPerBand: 100, simpleUnit: 'بند' },
    { id: 'z1', name: 'زینک', category: 'زینک', unitMode: 'simple', quantity: 500, simpleUnit: 'قطعه' },
  ];
  const item = { id: 'i1', productType: 'کتاب', productName: 'کتاب', qty: '1000', press: '2 ورقی', waste: '', bindingType: 'شومیز (چسب گرم)', coverEnabled: true,
    spec: { sizeKey: 'وزیری', pages: '328', textKind: 'تحریر', textGsm: '70', textColors: 1, textSides: 2, coverKind: 'گلاسه', coverGsm: '250', coverColors: 4, coverSides: 1, printMethod: 'افست', coverEnabled: true } };
  const a = smart.analyzeItem(item, { inventory, settings, isBook: true });
  assert.equal(a.ok, true, a.errors.join());
  const eng = a.numbers.engine;
  assert.ok(eng, 'engine در numbers نیست');
  assert.ok(eng.instructions.some(x => /نیم‌فرم.*روی خودش دورو/.test(x)));
  assert.ok(eng.geometry.spineMm > 0);
  assert.ok(Math.abs(eng.geometry.spineMm / 10 - a.numbers.spine) <= 0.05, "spine mismatch " + eng.geometry.spineMm + " vs " + a.numbers.spine);
  assert.ok(Math.abs(eng.geometry.openWidthCm - a.numbers.coverW) <= 0.1, "coverW mismatch " + eng.geometry.openWidthCm + " vs " + a.numbers.coverW);
});