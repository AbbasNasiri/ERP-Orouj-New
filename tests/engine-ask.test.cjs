'use strict';
/* کنترل‌های پرسش موتور: تا بلوک رنگ (۲ رنگ و بیشتر) و فرم‌بندی قطعِ تعریف‌نشده تأیید نشود،
   analyzeItem هیچ عددی نمی‌سازد. عددهای مرجع از نمونهٔ خود کارفرما (رحلی ۳۰۴ صفحه، تیراژ ۲۰۰۰). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const smartUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'smart.js')).href;

const inventory = [
  { id: 'p70', name: 'تحریر ۷۰ گرم', category: 'کاغذ', gramaj: '70', size: '60×90', unitMode: 'band_sheet', bandCount: 200, sheetsPerBand: 500, ownerType: 'چاپخانه' },
  { id: 'c250', name: 'گلاسه ۲۵۰ گرم', category: 'مقوا', gramaj: '250', size: '50×70', unitMode: 'band_sheet', bandCount: 50, sheetsPerBand: 125, ownerType: 'چاپخانه' },
  { id: 'zinc', name: 'زینک ۲ ورقی', category: 'زینک', unitMode: 'simple', quantity: 500, simpleUnit: 'قطعه' },
];

const book = (extra = {}) => ({
  id: 'x', qty: 2000, qtyUnit: 'نسخه', press: '2 ورقی', waste: '', bindingType: 'شومیز (چسب گرم)', coverEnabled: true,
  spec: {
    sizeKey: 'رحلی', pages: 304, textKind: 'تحریر', textGsm: 70, textColors: 2, textSides: 2, coverEnabled: true,
    coverKind: 'گلاسه', coverGsm: 250, coverColors: 4, coverSides: 1, printMethod: 'افست', ...extra,
  },
});

async function run(extra = {}) {
  const smart = await import(smartUrl);
  smart.applyBank({});
  return { smart, out: smart.analyzeItem(book(extra), { inventory, customerId: '', settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } }, isBook: true }) };
}

test('۲ رنگ بدون تأیید بلوک رنگ: ok=false، عددی ساخته نمی‌شود و کارت باید پرسیده شود', async () => {
  const { out } = await run();
  assert.equal(out.ok, false);
  assert.equal(out.numbers.textSheetsTotal, undefined);
  assert.equal(out.numbers.textPlates, undefined);
  assert.ok(out.waiting.some(w => w.part === 'زینک متن'), 'ردیف انتظار زینک باید باشد');
  assert.ok(out.warnings.some(w => /بلوک رنگ/.test(w)), 'هشدار بلوک رنگ باید باشد');
});

test('تک‌رنگ: سؤال رنگ پرسیده نمی‌شود و عدد ساخته می‌شود', async () => {
  const { out } = await run({ textColors: 1 });
  assert.equal(out.ok, true, (out.errors || []).join(' | '));
  assert.equal(out.numbers.textSheetsTotal, 39900);
  assert.equal(out.numbers.textPlates, 76);
});

test('پس از تأیید یکدستِ ۲ رنگ: عددها با همان تیراژ برمی‌گردند', async () => {
  const { out } = await run({ colourConfirmed: true, colourUniform: true });
  assert.equal(out.ok, true, (out.errors || []).join(' | '));
  assert.equal(out.numbers.textSheetsTotal, 39900);
  assert.equal(out.numbers.textPlates, 152);
  assert.equal(out.numbers.forms, 38);
});

test('بلوک‌های ناقص (جمع ≠ صفحات): خطا، نه عدد', async () => {
  const { out } = await run({ colourConfirmed: true, colourUniform: false, colourBlocks: [{ from: '1', to: '100', colors: 4, label: 'صفحه‌های اول' }] });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some(e => /جمع صفحه‌های بلوک‌های رنگی \(100\)/.test(e)), JSON.stringify(out.errors));
  assert.equal(out.numbers.textSheetsTotal, undefined);
});

test('پیش‌نویس بلوک رنگ از متن سفارش ساخته می‌شود (نه جواب)', async () => {
  const { smart } = await run();
  const draft = smart.colourDraftOf({ frontColorPages: '4', frontColors: 4 }, 304, 2);
  assert.equal(draft.uniform, false);
  assert.deepEqual(draft.blocks.map(b => [b.from, b.to, b.colors]), [['1', '4', 4], ['5', '304', 2]]);
});

test('قطع تعریف‌نشده: پرسش فرم‌بندی می‌سازد و عدد نمی‌دهد', async () => {
  const { out } = await run({ sizeKey: 'پالتویی ۱۰×۲۰', pages: 200, qty: 1000, textColors: 1 });
  assert.equal(out.ok, false);
  assert.equal(out.numbers.textSheetsTotal, undefined);
  assert.ok(out.waiting.some(w => w.part === 'فرم متن'));
  assert.ok(out.warnings.some(w => /فرم‌بندی قطع «پالتویی ۱۰×۲۰»/.test(w)), JSON.stringify(out.warnings));
});

test('پس از تأیید فرم‌بندی قطع: عدد ساخته می‌شود و پیشنهاد هم موجود است', async () => {
  const { smart, out } = await run({
    sizeKey: 'پالتویی ۱۰×۲۰', pages: 200, qtyOverride: 1000, textColors: 1,
    cutFormConfirmed: true, cutForm: { formPages: 8, paperPages: 16, formSheet: [60, 45], paperSheet: [60, 90] },
  });
  assert.equal(out.ok, true, (out.errors || []).join(' | '));
  assert.equal(out.numbers.textSheetsTotal, 13750);
  const plan = smart.bookCutPlan({ sizeKey: 'پالتویی ۱۰×۲۰' });
  assert.equal(plan.needed, true);
  assert.ok(plan.suggestion && plan.suggestion.formPages > 0 && plan.suggestion.source, JSON.stringify(plan.suggestion));
});
