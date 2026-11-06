'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'print-engine.mjs')).href);
const base = { cut: 'وزیری', pages: 320, qty: 2000, waste: 100, colors: 2, press: '4.5 ورقی' };

test('وزیری ۳۲۰ صفحه روی ۴.۵ ورقی: ۲۱٬۰۰۰ ورق، ۴۰ زینک، ۲۱ فرم صحافی', async () => {
  const { planBook } = await load();
  const plan = planBook(base);
  assert.equal(plan.ok, true);
  assert.equal(plan.paper.sheets, 21000);
  assert.equal(plan.paper.bands, 42);
  assert.equal(plan.plates.total, 40);
  assert.equal(plan.binding.total, 21);
});

test('زینک به ماشین وابسته است و دیجیتال زینک ندارد، صحافی ثابت می‌ماند', async () => {
  const { planBook } = await load();
  const plates = press => planBook({ ...base, press }).plates.total;
  assert.equal(plates('4.5 ورقی'), 40);
  assert.equal(plates('2 ورقی'), 80);
  assert.equal(plates('GTO'), 160);
  assert.equal(plates('دیجیتال'), 0);
  assert.equal(planBook({ ...base, press: 'GTO' }).binding.total, 21);
});

test('نیم‌فرم و یک‌چهارم فرم، تیراژ چاپ و کاغذ را متناسب کم می‌کنند و در صحافی یک فرم‌اند', async () => {
  const { planBook } = await load();
  const half = planBook({ ...base, pages: 328 });
  assert.equal(half.forms.at(-1).kind, 'نیم‌فرم');
  assert.equal(half.forms.at(-1).printRun, 1050);
  assert.equal(half.binding.total, 22);
  const quarter = planBook({ ...base, pages: 324 });
  assert.equal(quarter.forms.at(-1).kind, 'یک‌چهارم فرم');
  assert.equal(quarter.forms.at(-1).printRun, 525);
});

test('رحلی: فرم کامل ۸ صفحه و نیم‌فرم ۴ صفحه؛ باقی‌مانده‌های دیگر خطا می‌دهند', async () => {
  const { planBook } = await load();
  const ok = planBook({ ...base, cut: 'رحلی', pages: 124 });
  assert.equal(ok.ok, true);
  assert.equal(ok.forms.at(-1).kind, 'نیم‌فرم');
  assert.equal(ok.binding.total, 17);
  assert.equal(planBook({ ...base, cut: 'رحلی', pages: 126 }).ok, false);
});

test('صفحه‌شماری نامعتبر دستور تولید نمی‌دهد', async () => {
  const { planBook } = await load();
  const bad = planBook({ ...base, pages: 306 });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /قابل فرم‌بندی نیست/);
});

test('رحلی ۳۰۴ صفحه با چهار صفحهٔ اول چهاررنگ و جلد: ۳۹٬۹۰۰ ورق، ۱۵۸ زینک روی ۲ ورقی', async () => {
  const { planBook } = await load();
  const plan = planBook({
    cut: 'رحلی', pages: 304, qty: 2000, waste: 100, press: '2 ورقی',
    colorRanges: [{ pages: 4, colors: 4 }, { pages: 300, colors: 2 }],
    cover: { perSheet: 4, colors: 4, sides: 1 },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.paper.sheets, 39900);
  assert.equal(plan.plates.text, 154);
  assert.equal(plan.plates.cover, 4);
  assert.equal(plan.plates.total, 158);
  assert.equal(plan.coverPaper.sheets, 525);
  assert.equal(plan.binding.total, 39);
});

test('جمع صفحه‌های بازه‌های رنگی باید با تعداد صفحه برابر باشد و جلد ناقص خطا می‌دهد', async () => {
  const { planBook } = await load();
  assert.equal(planBook({ ...base, colorRanges: [{ pages: 100, colors: 2 }] }).ok, false);
  assert.equal(planBook({ ...base, cover: { perSheet: 4, colors: 4 } }).ok, false);
  assert.equal(planBook({ ...base, press: 'دیجیتال', cover: { perSheet: 4, colors: 4, sides: 1 } }).plates.total, 0);
});

require('node:test')('press sheets follow press size', async () => {
  const { planBook } = await import('../src/print-engine.mjs');
  const paper = press => planBook({ cut: 'وزیری', pages: 320, qty: 1000, waste: 50, press, colors: 1 }).paper;
  require('node:assert').equal(paper('GTO').pressSheets, paper('GTO').sheets * 4);
  require('node:assert').equal(paper('4.5 ورقی').pressSheets, paper('4.5 ورقی').sheets);
});

require('node:test')('legacy analyzeItem blocks unformable page counts', async () => {
  const { analyzeItem, mergeSettings } = await import('../src/smart.js');
  const run = pages => analyzeItem({ qty: 1000, press: '2 ورقی', spec: { sizeKey: 'وزیری', pages, textGsm: 70, textKind: 'تحریر' } }, { inventory: [], customerId: null, settings: mergeSettings({}), isBook: true });
  const bad = run(306), good = run(320);
  require('node:assert').equal(bad.ok, false);
  require('node:assert').ok(bad.errors.some(e => e.includes('فرم‌بندی')));
  require('node:assert').ok(!good.errors.some(e => e.includes('فرم‌بندی')));
});

test('paper smaller than the press sheet is rejected', async () => {
  const { planBook } = await load();
  assert.equal(planBook({ ...base, paperSize: [50, 70] }).ok, false);
  assert.equal(planBook({ ...base, press: '2 ورقی', paperSize: [50, 70] }).ok, true);
  assert.equal(planBook({ ...base, press: 'GTO', paperSize: [70, 100] }).ok, true);
});

test('cover spine and open size follow pages and paper weight', async () => {
  const { planBook } = await load();
  const g = planBook({ ...base, textGsm: 70 }).coverGeometry;
  assert.equal(g.spineMm, 14.4);
  assert.equal(g.openWidthCm, 36.04);
  assert.equal(g.openHeightCm, 24.6);
  assert.equal(planBook(base).coverGeometry, null);
});

test('an edited catalog replaces the built-in cuts and presses', async () => {
  const { planBook, CUTS, PRESSES } = await load();
  const cuts = { ...CUTS, 'جیبی': { formPages: 16, paperPages: 32, partials: [8, 4], trim: [11, 17] } };
  assert.equal(planBook({ ...base, cut: 'جیبی' }).ok, false);
  assert.equal(planBook({ ...base, cut: 'جیبی', catalog: { cuts } }).ok, true);
  const presses = { ...PRESSES, 'ماشین جدید': { plateFactor: 0.5, offset: true, sheet: [50, 70] } };
  assert.equal(planBook({ ...base, press: 'ماشین جدید', catalog: { presses } }).plates.capacityPages, 8);
});

require('node:test')('real paper caliper on the stock card drives the spine', async () => {
  const { analyzeItem, mergeSettings } = await import('../src/smart.js');
  const stock = caliperMm => [{ id: 'p1', category: 'کاغذ', name: 'تحریر ۷۰', gramaj: '70', size: '70×100', unitMode: 'band_sheet', bandCount: '100', sheetsPerBand: '500', ownerType: 'چاپخانه', ...(caliperMm ? { caliperMm } : {}), movements: [] }];
  const run = inventory => analyzeItem({ qty: 1000, press: '2 ورقی', spec: { sizeKey: 'وزیری', pages: 320, textGsm: 70, textKind: 'تحریر', coverEnabled: true, coverGsm: 250 } }, { inventory, customerId: null, settings: mergeSettings({}), isBook: true });
  const approx = run(stock()).numbers.spine, real = run(stock('0.12')).numbers.spine;
  require('node:assert').equal(real, 1.92, 'عطف = ۱۶۰ برگ × ۰٫۱۲ میلی‌متر');
  require('node:assert').notEqual(approx, real);
});