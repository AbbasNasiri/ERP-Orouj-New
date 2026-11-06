'use strict';
/* قاعدهٔ کارفرما (بند عددی ۲): جلد باز + عطف از تعداد صفحات ← چیدمان روی یک طرف زینکِ ماشین
   انتخابی ← هر ورق مادر چند برگ ماشین می‌دهد ← ورق کاغذ. زینک جلد = رنگ × رو.
   کنترل منفی: «چاپ جلد» هرگز نباید ورقی بزرگ‌تر از ماشینِ انتخابی را دستور بدهد. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const smartPath = pathToFileURL(path.join(__dirname, '..', 'src', 'smart.js')).href;

const inventory = (coverSize) => [
  { id: 'p1', name: 'تحریر ۷۰ گرم', category: 'کاغذ', gramaj: '70', size: '70×100', unitMode: 'band_sheet', bandCount: 90, sheetsPerBand: 500, simpleUnit: 'بند' },
  { id: 'c1', name: 'گلاسه ۲۵۰ گرم', category: 'مقوا', gramaj: '250', size: coverSize, unitMode: 'band_sheet', bandCount: 20, sheetsPerBand: 100, simpleUnit: 'بند' },
];
const withZinc = [...inventory('70×100'), { id: 'z1', name: 'زینک ۰.۳', category: 'زینک', size: '50×65', unitMode: 'simple', quantity: 400, simpleUnit: 'قطعه' }];
const book = (press, coverSides = 1) => ({
  id: 'i1', productType: 'کتاب', productName: 'کتاب', qty: '2000', press, waste: '', bindingType: 'شومیز (چسب گرم)', coverEnabled: true,
  spec: { sizeKey: 'وزیری', pages: '400', textKind: 'تحریر', textGsm: '70', textColors: 1, textSides: 2, coverKind: 'گلاسه', coverGsm: '250', coverColors: 4, coverSides, printMethod: 'افست', coverEnabled: true },
});
const analyze = async (item, inv) => {
  const smart = await import(smartPath);
  const settings = { calc: { ...smart.DEFAULT_SETTINGS.calc } };
  return smart.analyzeItem(item, { inventory: inv, settings, isBook: true });
};

test('ماشین ۲ ورقی: ۲ جلد در هر طرف زینکِ ۵۰×۷۰ و ۱٬۰۵۰ ورق ماشین از ۵۲۵ ورق مادر', async () => {
  const a = await analyze(book('2 ورقی'), withZinc);
  assert.equal(a.ok, true, a.errors.join(''));
  const n = a.numbers;
  assert.deepEqual(n.coverZincSheet, [50, 70], 'سایز زینک از ماشین ۲ ورقی نیامد');
  assert.equal(n.coverPerZinc, 2);
  assert.equal(n.coverZincCount, 2, 'هر ورق مادر ۷۰×۱۰۰ دو برگ ۵۰×۷۰ می‌دهد');
  assert.equal(n.coverFit, 4, '۴ جلد در هر ورق مادر');
  assert.equal(n.coverSheetsTotal, 525, 'کاغذ جلد (مصرف انبار) باید همان ۵۲۵ ورق بماند');
  assert.equal(n.coverMachineSheets, 1050, 'تیراژ ورق ماشین ۲ برابر ورق کاغذ است');
  assert.equal(n.coverPlates, 4, 'زینک جلد = ۴ رنگ × ۱ رو');
  assert.equal(n.totalPlates, 54);
  assert.equal((a.rows.coverPapers[0] || {}).qty, 525);
});

test('ماشین ۴٫۵ ورقی: ۴ جلد در هر طرف زینک و ورق ماشین با ورق کاغذ یکی می‌شود', async () => {
  const n = (await analyze(book('4.5 ورقی'), inventory('70×100'))).numbers;
  assert.deepEqual(n.coverZincSheet, [70, 100]);
  assert.equal(n.coverPerZinc, 4);
  assert.equal(n.coverZincCount, 1);
  assert.equal(n.coverMachineSheets, 525);
  assert.equal(n.coverPlates, 4);
});

test('ماشین GTO: ورق ماشین ۴ برابر می‌شود ولی زینک جلد همان رنگ × رو است', async () => {
  const n = (await analyze(book('GTO'), inventory('70×100'))).numbers;
  assert.deepEqual(n.coverZincSheet, [35, 50]);
  assert.equal(n.coverPerZinc, 1);
  assert.equal(n.coverZincCount, 4);
  assert.equal(n.coverSheetsTotal, 525);
  assert.equal(n.coverMachineSheets, 2100);
  assert.equal(n.coverPlates, 4, 'GTO زینک جلد را ۱۶ نمی‌کند');
});

test('جلد دورو: زینک دو برابر، ورق ماشین همان می‌ماند', async () => {
  const n = (await analyze(book('2 ورقی', 2), inventory('70×100'))).numbers;
  assert.equal(n.coverPlates, 8);
  assert.equal(n.coverMachineSheets, 1050);
  assert.equal(n.coverSheetsTotal, 525);
});

test('ورق مادر ثبت‌شده در انبار مقدم است؛ مصرفِ بیشتر با پیشنهادِ ورق کم‌مصرف‌تر گفته می‌شود', async () => {
  const a = await analyze(book('2 ورقی'), inventory('60×90'));
  const n = a.numbers;
  assert.deepEqual(n.coverSheet, [60, 90], 'مقوای ثبت‌شده در انبار باید مصرف شود');
  assert.equal(n.coverZincCount, 1, 'از ۶۰×۹۰ یک برگ ۵۰×۷۰ می‌آید');
  assert.equal(n.coverFit, 2);
  assert.equal(n.coverSheetsTotal, 1050);
  assert.ok(a.warnings.some(w => /70×100/.test(w) && /کم‌مصرف/.test(w)), a.warnings.join(''));
});

test('کنترل منفی: وقتی زینک در انبار نیست، سایز زینک منبعِ «ماشین» دارد و وانمود نمی‌کند', async () => {
  const n = (await analyze(book('2 ورقی'), inventory('70×100'))).numbers;
  assert.equal(n.zincRegistered, false);
  assert.deepEqual(n.zincSheet, [50, 70]);
  assert.equal(n.zincPressName, '2 ورقی');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const zincSize = src.slice(src.indexOf('const zincSize = (it) => {'), src.indexOf('const dimsOf'));
  assert.match(zincSize, /بر اساس ماشین/, 'سایز زینک باید منبعش را روی برگه بنویسد');
  assert.match(zincSize, /زینک در انبار ثبت نشده/);
  assert.ok(!/pressSheet \|\| n\.sheet/.test(zincSize), 'زینک نباید سایز ورق ماشین/کاغذ را بی‌منبع بنویسد');
});

test('برگهٔ «چاپ جلد» روی ماشین ۲ ورقی، ورق ۷۰×۱۰۰ را دستور چاپ نمی‌دهد', async () => {
  const n = (await analyze(book('2 ورقی'), withZinc)).numbers;
  assert.match(n.coverRunLabel, /ماشین 2 ورقی/);
  assert.match(n.coverRunLabel, /زینک 50×70/, 'سایز زینکِ ماشین باید روی برگه باشد');
  assert.match(n.coverRunLabel, /2 جلد در هر طرف زینک/);
  assert.ok(n.coverRunLabel.length <= 64, 'ردیف «چاپ جلد» باید در یک خطِ چاپی جا شود (' + n.coverRunLabel.length + ' نویسه): ' + n.coverRunLabel);
  assert.equal(n.coverPlates, 4, 'تعداد زینک جلد در ردیف خودش می‌آید، نه در این خط');
  assert.ok(!n.coverRunLabel.includes('70×100'), 'ردیف «چاپ جلد» نباید ورق مادر را به اپراتور دستور بدهد: ' + n.coverRunLabel);
  /* ورق مادر فقط در ردیف تیراژ (کاغذ) می‌آید و ورق ماشین جدا شمار می‌شود */
  assert.equal(n.coverMachineSheets, 1050);
  assert.equal(n.coverSheetsTotal, 525);
});

test('دیجیتال: زینک ندارد و برگِ ماشین همان ورق کاغذ است', async () => {
  const item = book('2 ورقی');
  item.spec.printMethod = 'دیجیتال';
  const a = await analyze(item, inventory('70×100'));
  const n = a.numbers;
  assert.equal(n.coverPlates, 0);
  assert.equal(n.coverZincSheet, null);
  assert.equal(n.coverMachineSheets, n.coverSheetsTotal);
});

test('جلد بزرگ‌تر از یک طرف زینکِ ماشین: عدد نمی‌سازد، خطا می‌دهد', async () => {
  const item = book('GTO');
  item.spec.sizeKey = 'سلطانی';
  const a = await analyze(item, inventory('70×100'));
  assert.equal(a.ok, false, 'جلد باز ۵۲٫۳×۳۵٫۵ روی زینک ۳۵×۵۰ جا نمی‌شود؛ نباید عدد ساخته شود');
  assert.ok(a.errors.some(e => /جا نمی‌شود/.test(e)), a.errors.join(''));
});
