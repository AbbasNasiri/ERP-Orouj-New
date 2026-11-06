'use strict';
/* آزمون بانک دانش + موتور زنجیره‌ای. عددهای مرجع از نمونهٔ خود کارفرما (کتاب رحلی ۳۰۴ صفحه،
   تیراژ ۲۰۰۰، ۴ صفحهٔ اول چهاررنگ + ۳۰۰ صفحه دورنگ، جلد ۴رنگ یک‌رو، شومیز چسب گرم) گرفته شده است. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = name => pathToFileURL(path.resolve(__dirname, '..', 'src', name)).href;
const load = async () => {
  const [chain, knowledge, smart] = await Promise.all([import(src('calc-chain.mjs')), import(src('knowledge.mjs')), import(src('smart.js'))]);
  return { chain, knowledge, smart };
};

const inventory = [
  { id: 'p70', name: 'تحریر ۷۰ گرم', category: 'کاغذ', gramaj: '70', size: '60×90', unitMode: 'band_sheet', bandCount: 200, sheetsPerBand: 500, ownerType: 'چاپخانه' },
  { id: 'c250', name: 'گلاسه ۲۵۰ گرم', category: 'مقوا', gramaj: '250', size: '50×70', unitMode: 'band_sheet', bandCount: 50, sheetsPerBand: 125, ownerType: 'چاپخانه' },
  { id: 'zinc', name: 'زینک ۲ ورقی', category: 'زینک', unitMode: 'simple', quantity: 500, simpleUnit: 'قطعه' },
  { id: 'cello', name: 'سلفون براق', category: 'سلفون', unitMode: 'simple', quantity: 9999, simpleUnit: 'متر مربع' },
];

const RAHLI = {
  productType: 'کتاب', cut: 'رحلی', trim: [21, 29], pages: 304, qty: 2000, waste: '',
  colourPlan: [{ pages: 4, colors: 4, label: 'صفحه‌های اول' }, { pages: 300, colors: 2, label: 'بقیهٔ متن' }],
  textColors: 2, method: 'افست', press: '۲ ورقی',
  paper: { kind: 'تحریر', gsm: 70 }, cover: { enabled: true, kind: 'گلاسه', gsm: 250, colors: 4, sides: 1 },
  binding: 'شومیز (چسب گرم)', finishing: [{ name: 'سلفون براق' }],
};

test('نمونهٔ مرجع کارفرما: ۳۹٬۹۰۰ ورق، ۷۹.۸ بند، ۱۵۸ زینک، ۴۰ فرم صحافی، ۷۹٬۸۰۰ ورق ماشین', async () => {
  const { chain, smart } = await load();
  const out = chain.runChain(RAHLI, { inventory, settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } } });
  const n = out.numbers;
  assert.equal(out.complete, true, `سؤال باقی مانده: ${JSON.stringify(out.questions)}`);
  assert.equal(n.textSheets, 39900);
  assert.equal(n.textSheetsNet, 38000);
  assert.equal(n.textBands, 79.8);
  assert.equal(n.pressSheets, 79800);
  assert.equal(n.textPlates, 154);
  assert.equal(n.coverPlates, 4);
  assert.equal(n.plates, 158);
  assert.equal(n.bindingForms, 40);
  assert.equal(n.coverSheets, 1050);
  assert.deepEqual(out.stages.paper.values.pressPlan.map(r => r.sheets), [1050, 77700, 1050]);
  assert.equal(out.stages.finishing.values.lines[0].qty, 367.5);
  assert.deepEqual([n.paperSheet, n.formSheet], [[60, 90], [60, 45]], 'ورق کاغذ ۶۰×۹۰ و سایز فرم روی ماشین ۶۰×۴۵');
  const rules = out.rulesUsed.map(r => r.code);
  assert.deepEqual([rules.includes('rule-form'), rules.includes('rule-plate'), rules.includes('rule-paper'), rules.includes('rule-half'), rules.includes('rule-wat'), rules.includes('rule-binding')], [true, true, true, true, true, true], 'ردپای قواعد بانک ثبت نشد');
  assert.ok(out.rulesUsed.every(r => r.name && r.status === 'تأییدشده' && r.version === 1), 'هر قاعده باید نام، نسخه و وضعیت داشته باشد');
});

test('بلوک رنگ اعلام‌نشده: سؤال می‌سازد و زینک نهایی نمی‌دهد (نه عددِ ۱۵۲ِ خاموش)', async () => {
  const { chain, smart } = await load();
  const { colourPlan, ...blind } = RAHLI;
  const out = chain.runChain(blind, { inventory, settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } } });
  assert.equal(out.complete, false);
  assert.equal(out.numbers.plates, 0);
  assert.ok(out.stages.colour.questions.some(q => q.field === 'colourPlan'), 'سؤال بلوک رنگ پرسیده نشد');
  assert.equal(out.stages.zinc.values, null);
});

test('موتور از بانک می‌خواند: تغییر ظرفیت زینک در بانک، تعداد زینک را تغییر می‌دهد', async () => {
  const { chain, knowledge, smart } = await load();
  const bank = knowledge.buildBank({});
  const twoSide = JSON.parse(JSON.stringify(bank));
  twoSide.presses.find(p => p.name === '2 ورقی').plateFactor = 1;
  const base = chain.runChain(RAHLI, { bank, inventory, settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } } }).numbers.plates;
  const changed = chain.runChain(RAHLI, { bank: twoSide, inventory, settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } } }).numbers.plates;
  assert.equal(base, 158);
  assert.equal(changed, 84, 'با ظرفیت کامل‌فرم، زینک باید نصف شود: ۸۰ متن + ۴ جلد');
});

test('قطع تازهٔ تأییدنشده (پالتویی ۱۰×۲۰): فرم‌بندی را سؤال می‌کند، عدد نمی‌سازد', async () => {
  const { chain, knowledge, smart } = await load();
  const out = chain.runChain({ ...RAHLI, cut: 'پالتویی ۱۰×۲۰', pages: 0, colourPlan: null }, { inventory, settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } } });
  assert.equal(out.stages.forms.values, null);
  assert.ok(out.stages.forms.questions.some(q => q.field === 'formPages'), 'سؤال تعداد صفحهٔ فرم پرسیده نشد');
});

test('دیجیتال: زینک صفر است و سؤالِ زینک پرسیده نمی‌شود', async () => {
  const { chain, smart } = await load();
  const out = chain.runChain({ ...RAHLI, method: 'دیجیتال', press: '' }, { inventory, settings: { calc: { ...smart.DEFAULT_SETTINGS.calc } } });
  assert.equal(out.numbers.plates, 0);
  assert.equal(out.stages.zinc.values.total, 0);
  assert.equal(out.stages.press.values.offset, false);
});

test('هم‌ارزی با موتور فعلی روی پنج سفارش: کاغذ، زینک، ورق ماشین و فرم صحافی یکی است', async () => {
  const { chain, smart } = await load();
  const cases = [
    { cut: 'رحلی', pages: 304, qty: 2000, textColors: 2, front: [4, 4], cover: true, binding: 'شومیز (چسب گرم)' },
    { cut: 'رحلی', pages: 308, qty: 2000, textColors: 2, front: null, cover: true, binding: 'شومیز (چسب گرم)' },
    { cut: 'رقعی', pages: 96, qty: 1000, textColors: 1, front: null, cover: false, binding: 'منگنه‌ای (مفتولی/سیمی)' },
    { cut: 'وزیری', pages: 328, qty: 3000, textColors: 1, front: null, cover: true, binding: 'شومیز (چسب گرم)' },
    { cut: 'رقعی', pages: 160, qty: 1500, textColors: 2, front: [8, 4], cover: true, binding: 'گالینگور (جلد سخت)' },
  ];
  const settings = { calc: { ...smart.DEFAULT_SETTINGS.calc } };
  for (const c of cases) {
    const item = {
      id: 'x', qty: c.qty, qtyUnit: 'نسخه', press: '2 ورقی', waste: '', bindingType: c.binding, coverEnabled: c.cover,
      spec: { sizeKey: c.cut, pages: c.pages, textKind: 'تحریر', textGsm: 70, textColors: c.textColors, textSides: 2, coverEnabled: c.cover,
        frontColorPages: c.front ? c.front[0] : 0, frontColors: c.front ? c.front[1] : 0,
        coverKind: 'گلاسه', coverGsm: 250, coverColors: 4, coverSides: 1, printMethod: 'افست',
        ...(c.textColors >= 2 ? {
          colourConfirmed: true, colourUniform: !c.front,
          colourBlocks: c.front ? [{ from: '1', to: String(c.front[0]), colors: c.front[1], label: 'صفحه‌های اول' }, { from: String(c.front[0] + 1), to: String(c.pages), colors: c.textColors, label: 'بقیهٔ متن' }] : [],
        } : {}) },
    };
    const old = smart.analyzeItem(item, { inventory, customerId: '', settings, isBook: true }).numbers;
    const facts = {
      productType: 'کتاب', cut: c.cut, pages: c.pages, qty: c.qty, waste: '', textColors: c.textColors,
      colourPlan: c.front ? [{ pages: c.front[0], colors: c.front[1], label: 'صفحه‌های اول' }, { pages: c.pages - c.front[0], colors: c.textColors, label: 'بقیهٔ متن' }] : null,
      method: 'افست', press: '۲ ورقی', paper: { kind: 'تحریر', gsm: 70 },
      cover: { enabled: c.cover, kind: 'گلاسه', gsm: 250, colors: 4, sides: 1 }, binding: c.binding, finishing: [],
    };
    const fresh = chain.runChain(facts, { inventory, settings }).numbers;
    assert.equal(fresh.textSheets, old.textSheetsTotal, `${c.cut}/${c.pages}: کاغذ متن`);
    assert.equal(fresh.textPlates + fresh.coverPlates, old.totalPlates, `${c.cut}/${c.pages}: جمع زینک`);
    assert.equal(fresh.pressSheets, old.pressSheets, `${c.cut}/${c.pages}: ورق ماشین`);
    assert.equal(fresh.bindingForms, old.bindingFormsCharged, `${c.cut}/${c.pages}: فرم صحافی`);
  }
});

test('پنج سطر بانک: ورودی تأییدنشده در bankGaps دیده می‌شود', async () => {
  const { knowledge } = await load();
  const bank = knowledge.buildBank({});
  const gaps = knowledge.bankGaps(bank);
  assert.ok(gaps.length >= 6, 'ورودی‌های تأییدنشده باید در گزارش بانک دیده شوند');
  assert.ok(gaps.some(g => g.name === 'سلطانی' || g.name.startsWith('پالتویی') || g.name.startsWith('جیبی')));
});

test('موتور برنامه (analyzeItem) هم از بانک می‌خواند: یک سطرِ میز، همهٔ اعداد را جابه‌جا می‌کند', async () => {
  const { smart } = await load();
  const item = {
    id: 'x', qty: 2000, qtyUnit: 'نسخه', press: '2 ورقی', waste: '', bindingType: 'شومیز (چسب گرم)', coverEnabled: true,
    spec: { sizeKey: 'رحلی', pages: 304, textKind: 'تحریر', textGsm: 70, textColors: 2, textSides: 2, coverEnabled: true,
      frontColorPages: 4, frontColors: 4, coverKind: 'گلاسه', coverGsm: 250, coverColors: 4, coverSides: 1, printMethod: 'افست',
      colourConfirmed: true, colourUniform: false,
      colourBlocks: [{ from: '1', to: '4', colors: 4, label: 'صفحه‌های اول' }, { from: '5', to: '304', colors: 2, label: 'بقیهٔ متن' }] },
  };
  const settings = { calc: { ...smart.DEFAULT_SETTINGS.calc } };
  const read = () => smart.analyzeItem(item, { inventory, customerId: '', settings, isBook: true }).numbers;

  smart.applyBank({});
  const before = read();
  assert.deepEqual([before.formPages, before.platePages, before.pagesPerSheet, before.pressSheet], [8, 4, 16, [60, 45]], 'خواندنِ پیش‌فرض بانک');
  assert.equal(before.textSheetsTotal, 39900);
  assert.equal(before.textPlates, 154);

  smart.applyBank({
    engineCuts: { 'رحلی': { formPages: 16, paperPages: 32, partials: [8, 4], formSheet: [70, 50] } },
    enginePresses: { '2 ورقی': { plateFactor: 1, offset: true, sheet: [50, 70] } },
  });
  const after = read();
  assert.deepEqual([after.formPages, after.platePages, after.pagesPerSheet, after.pressSheet], [16, 16, 32, [70, 50]], 'اعداد از سطر تازهٔ بانک نیامدند');
  assert.equal(after.textSheetsTotal, 19950, 'کاغذ باید با paperPages بانک تغییر کند');
  assert.equal(after.textPlates, 42, 'زینک باید با plateFactor بانک تغییر کند');

  smart.applyBank({});
  assert.equal(read().formPages, 8, 'بازگرداندن بانک پیش‌فرض');
  assert.equal(smart.FORM_PAGES_BY_CUT, undefined, 'نقشهٔ hardcode در smart.js باید حذف شده باشد');
});
