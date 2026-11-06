'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'src', f)).href);

test('قالب نوع کار: قلم خالی کتاب پر می‌شود و انتخاب کاربر دست نمی‌خورد', async () => {
  const { applyJobTemplate, JOB_TEMPLATES } = await load('job-templates.js');
  const blank = { productType: 'کتاب', bindingType: 'بدون صحافی', spec: {} };
  const out = applyJobTemplate(blank);
  assert.equal(out.spec.sizeKey, 'وزیری');
  assert.equal(out.press, '2 ورقی');
  assert.equal(out.coverEnabled, true);
  assert.ok(out.finishingSteps.includes('برش'));
  const touched = { productType: 'کتاب', bindingType: 'بدون صحافی', spec: { sizeKey: 'رحلی' } };
  assert.equal(applyJobTemplate(touched), touched);
  const unknown = { productType: 'بنر', spec: {} };
  assert.equal(applyJobTemplate(unknown), unknown);
  const { CUTS, PRESSES } = await load('print-engine.mjs');
  for (const [k, t] of Object.entries(JOB_TEMPLATES)) {
    assert.ok(CUTS[t.sizeKey], k + ': قطع در موتور نیست');
    assert.ok(PRESSES[t.press], k + ': ماشین در موتور نیست');
  }
});

test('مراحل تکمیلی بسته‌بندی و ارسال در جدول صحافی هستند و جدول قیمت دوم ساخته نشده', async () => {
  const { defaultUnits } = await load('units.js');
  const names = defaultUnits().binding.items.map(e => e.name);
  assert.ok(names.some(n => n.startsWith('بسته‌بندی')));
  assert.ok(names.includes('ارسال و حمل'));
});
test('مراحل تکمیلی قلم با ردیف‌های جدول صحافی قیمت می‌خورند و بدون نرخ صفر با یادداشت می‌آیند', async () => {
  const smart = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'smart.js')).href);
  const units = await load('units.js');
  const u = units.defaultUnits();
  const pack = u.binding.items.find(e => e.name.startsWith('بسته‌بندی'));
  pack.rate = 100; pack.active = true;
  Object.assign(smart.costContext, { units: u, priceEntry: units.priceEntry, entryHasPrice: units.entryHasPrice, entryHasTiers: units.entryHasTiers });
  const settings = { calc: { ...smart.DEFAULT_SETTINGS.calc } };
  const inventory = [
    { id: 'p1', name: 'تحریر ۷۰ گرم', category: 'کاغذ', gramaj: '70', size: '70×100', unitMode: 'band_sheet', bandCount: 100, sheetsPerBand: 500, simpleUnit: 'بند' },
    { id: 'z1', name: 'زینک', category: 'زینک', unitMode: 'simple', quantity: 500, simpleUnit: 'قطعه' },
  ];
  const item = { id: 'i1', productType: 'کتاب', productName: 'کتاب', qty: '1000', press: '2 ورقی', waste: '', bindingType: 'بدون صحافی', coverEnabled: false, finishingSteps: ['بسته‌بندی', 'ارسال و حمل'],
    spec: { sizeKey: 'وزیری', pages: '64', textKind: 'تحریر', textGsm: '70', textColors: 1, textSides: 2, printMethod: 'افست' } };
  const a = smart.analyzeItem(item, { inventory, settings, isBook: true });
  assert.equal(a.ok, true, a.errors.join());
  const est = smart.estimateCost({ ...item, analysis: a }, inventory, settings, {});
  const packLine = est.lines.find(l => l.label === 'تکمیلی — بسته‌بندی');
  assert.ok(packLine && packLine.amount === 100000, JSON.stringify(est.lines.map(l => [l.label, l.amount])));
  const ship = est.lines.find(l => l.label === 'تکمیلی — ارسال و حمل');
  assert.ok(ship && ship.amount === 0 && /ثبت نشده/.test(ship.note));
});
test('mergeUnits: جدول ذخیره‌شده‌ی قدیمی دو ردیف بسته‌بندی و ارسال را می‌گیرد', async () => {
  const { defaultUnits, mergeUnits } = await load('units.js');
  const saved = defaultUnits();
  saved.binding.items = saved.binding.items.filter(e => !/بسته‌بندی|ارسال/.test(e.name));
  const names = mergeUnits(saved).binding.items.map(e => e.name);
  assert.ok(names.includes('ارسال و حمل'));
  assert.ok(names.some(n => n.startsWith('بسته‌بندی')));
});