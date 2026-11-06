'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'smart.js')).href;

const inventory = [
  { id: 'p1', name: 'تحریر ۷۰ گرم', category: 'کاغذ', gramaj: '70', size: '70×100', unitMode: 'band_sheet', bandCount: 100, sheetsPerBand: 500, simpleUnit: 'بند' },
  { id: 'c1', name: 'گلاسه ۲۵۰ گرم', category: 'مقوا', gramaj: '250', size: '50×70', unitMode: 'band_sheet', bandCount: 50, sheetsPerBand: 100, simpleUnit: 'بند' },
  { id: 'z1', name: 'زینک', category: 'زینک', unitMode: 'simple', quantity: 500, simpleUnit: 'قطعه' },
];

function book(extra = {}) {
  return {
    id: 'i1', productType: 'کتاب', productName: 'کتاب رحلی', qty: '2000', press: '2 ورقی', waste: '',
    bindingType: 'شومیز (چسب گرم)', coverEnabled: true,
    spec: {
      sizeKey: 'رحلی', pages: '304', textKind: 'تحریر', textGsm: '70', textColors: 2, textSides: 2,
      coverKind: 'گلاسه', coverGsm: '250', coverColors: 4, coverSides: 1, cellophane: 'براق',
      printMethod: 'افست', frontColorPages: '', frontColors: 4, coverEnabled: true, ...extra,
    },
  };
}

async function withSettings() {
  const smart = await import(moduleUrl);
  return { smart, settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } } };
}

test('رنگ‌های مختلف متن: ۴ صفحه ۴ رنگ + ۳۰۰ صفحه ۲ رنگ روی فرم ۸ صفحه‌ای رحلی', async () => {
  const { smart, settings } = await withSettings();
  const a = smart.analyzeItem(book({
    frontColorPages: '4', colourConfirmed: true, colourUniform: false,
    colourBlocks: [{ from: '1', to: '4', colors: 4, label: 'صفحه‌های اول' }, { from: '5', to: '304', colors: 2, label: 'بقیهٔ متن' }],
  }), { inventory, settings, isBook: true });
  const n = a.numbers;
  assert.equal(a.ok, true);
  assert.equal(n.textSheetsTotal, 39900);
  assert.equal(n.textBands, 79.8);
  assert.equal(n.textPlates, 154);
  assert.equal(n.coverPlates, 4);
  assert.equal(n.totalPlates, 158);
  assert.equal(n.pressSheets, 79800);
  assert.equal(n.coverSheetsTotal, 1050);
  assert.equal(n.coverFit, 2);
  assert.equal(n.bindingFormsCharged, 40);
  assert.deepEqual(n.pressPlan.map(p => p.sheets), [1050, 77700, 1050]);
});

test('۳۰۸ صفحه دو رنگ: ۳۸ فرم کامل + یک فرم ۴ صفحه‌ای روی خودش دورو', async () => {
  const { smart, settings } = await withSettings();
  const a = smart.analyzeItem(book({ pages: '308', colourConfirmed: true, colourUniform: true }), { inventory, settings, isBook: true });
  const n = a.numbers;
  assert.equal(n.textSheetsTotal, 40425);
  assert.equal(n.totalPlates, 158);
  assert.equal(n.textFormsExact, 38.5);
  assert.equal(n.textFormsCharged, 39);
  assert.equal(n.pressSheets, 80850);
  assert.equal(n.bindingFormsCharged, 40);
  assert.match(n.formDesc, /تیراژ نصف/);
});

test('عدد صفحه‌ای که بر فرم ۸ صفحه‌ای جور نمی‌شود سفارش تولید را مسدود می‌کند', async () => {
  const { smart, settings } = await withSettings();
  const a = smart.analyzeItem(book({ pages: '306', colourConfirmed: true, colourUniform: true }), { inventory, settings, isBook: true });
  assert.equal(a.ok, false);
  assert.ok(a.errors.some(e => /306/.test(e) && /فرم‌بندی/.test(e)));
});

test('متن سفارش: «۴ اول ۴ رنگ مابقی ۲ رنگ» صفحه‌های اول را جدا می‌خواند', async () => {
  const { smart } = await withSettings();
  const p = smart.parseOrderText('کتاب رحلی 304 صفحه که 4 اول 4 رنگ مابقی 2 رنگ، داخل تحریر 70 گرم، جلد گلاسه 250 گرم چهار رنگ، تیراژ 2000 نسخه');
  assert.equal(p.pages, 304);
  assert.equal(p.text.colors, 2);
  assert.equal(p.text.frontPages, 4);
  assert.equal(p.text.frontColors, 4);
});

test('متن سفارش: «۴ صفحه اول ۴ رنگ و ۳۰۰ صفحه ۲ رنگ» کل صفحات را جمع می‌زند', async () => {
  const { smart } = await withSettings();
  const p = smart.parseOrderText('کتاب وزیری ۴ صفحه اول ۴ رنگ و ۳۰۰ صفحه ۲ رنگ، کاغذ تحریر ۷۰ گرم، تیراژ ۲۰۰۰ نسخه');
  assert.equal(p.pages, 304);
  assert.equal(p.text.colors, 2);
  assert.equal(p.text.frontPages, 4);
});

test('متن سفارش: «۳۲۰ صفحه ۱۶ صفحه ۴ رنگ» بلوک ۱۶ صفحه‌ای چهاررنگ را از کل جدا می‌کند', async () => {
  const { smart } = await withSettings();
  const p = smart.parseOrderText('وزیری 320 صفحه 16 صفحه 4 رنگ');
  assert.equal(p.pages, 320);
  assert.equal(p.text.frontPages, 16);
  assert.equal(p.text.frontColors, 4);
  assert.equal(p.text.colors, null, 'رنگ بقیهٔ متن باید پرسیده شود، نه ۴ رنگ فرض شود');
  const draft = smart.colourDraftOf({ frontColorPages: String(p.text.frontPages), frontColors: p.text.frontColors }, p.pages, p.text.colors || 1);
  assert.deepEqual(draft.blocks.map(b => [b.from, b.to, b.colors]), [['1', '16', 4], ['17', '320', 1]]);
});

test('متن سفارش: تنها یک شمار صفحه («۱۶ صفحه ۴ رنگ») بلوک رنگی نمی‌سازد', async () => {
  const { smart } = await withSettings();
  const p = smart.parseOrderText('کتاب 16 صفحه 4 رنگ');
  assert.equal(p.pages, 16);
  assert.equal(p.text.frontPages, null);
  assert.equal(p.text.colors, 4);
});
