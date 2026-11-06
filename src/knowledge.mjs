/* بانک دانش (دایرةالمعارفِ موتور). تنها جایی که قواعد چاپخانه به‌صورت داده ذخیره می‌شود؛
   موتور محاسبه هیچ عددی را در خودش hardcode نمی‌کند و پیش از محاسبه از همین‌جا می‌خواند.
   هر ورودی چرخهٔ «تعریف‌شده ← تأییدشده» دارد (همان چرخهٔ مشتری/تأمین‌کننده) و موتور فقط
   ورودیِ تأییدشده را قطعی می‌شمارد؛ ورودی تأییدنشده سؤال می‌سازد، نه عدد. */

export const BANK_SCHEMA_VERSION = 1;
export const STATUS_DEFINED = 'تعریف‌شده';
export const STATUS_APPROVED = 'تأییدشده';

const entry = (code, name, fields = {}) => ({ code, name, version: 1, status: STATUS_APPROVED, source: 'پیش‌فرض بانک', ...fields });

/* نام‌های بانک با رقم لاتین نوشته شده‌اند (۲ ورقی، 4.5 ورقی) و رابط کاربری رقم فارسی می‌فرستد. */
const latin = s => String(s).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/* ── ۱) نوع کار ─────────────────────────────────────────────── */
export const PRODUCT_TYPES = [
  entry('book', 'کتاب', { bookLike: true, needs: ['pages', 'cut', 'paper', 'binding', 'cover'], defaultBinding: 'شومیز (چسب گرم)' }),
  entry('magazine', 'مجله', { bookLike: true, needs: ['pages', 'cut', 'paper', 'binding', 'cover'], defaultBinding: 'شومیز (چسب گرم)' }),
  entry('leaflet', 'بروشور و تراکت', { bookLike: false, needs: ['cut', 'paper'] }),
  entry('card', 'کارت ویزیت', { bookLike: false, needs: ['cut', 'paper'], defaultFinishing: ['سلفون', 'برش'] }),
];

/* ── ۲) قطع و ابعاد ─────────────────────────────────────────── */
/* formPages = صفحهٔ هر فرم کامل · paperPages = صفحهٔ هر ورق کاغذ · formSheet = سایز فرم روی ماشین
   partials = نیم‌فرم/یک‌چهارم مجاز · status: ورودی تازه که فرم‌بندی‌اش هنوز تأیید نشده، سؤال می‌سازد. */
export const CUTS = [
  entry('rahli', 'رحلی', { trim: [21, 29], formPages: 8, paperPages: 16, formSheet: [60, 45], paperSheet: [60, 90], partials: [4] }),
  entry('soltani', 'سلطانی', { trim: [25, 35], formPages: 8, paperPages: 16, formSheet: [60, 45], paperSheet: [60, 90], partials: [4] }),
  entry('roghii', 'رقعی', { trim: [14.5, 21], formPages: 16, paperPages: 32, formSheet: [70, 100], paperSheet: [48, 72], partials: [8, 4] }),
  entry('vaziri', 'وزیری', { trim: [17, 24], formPages: 16, paperPages: 32, formSheet: [70, 100], paperSheet: [70, 100], partials: [8, 4] }),
  entry('kheshti', 'خشتی', { trim: [20.5, 20.5], formPages: 12, paperPages: 12, formSheet: [60, 90], paperSheet: [60, 90], partials: [6, 4] }),
  entry('paltoi-10x20', 'پالتویی ۱۰×۲۰', { trim: [10, 20], formPages: null, paperPages: null, formSheet: null, paperSheet: null, partials: [], status: STATUS_DEFINED }),
  entry('paltoi-12x22', 'پالتویی ۱۲×۲۲', { trim: [12, 22], formPages: null, paperPages: null, formSheet: null, paperSheet: null, partials: [], status: STATUS_DEFINED }),
  entry('jibi-8x12', 'جیبی ۸×۱۲', { trim: [8, 12], formPages: null, paperPages: null, formSheet: null, paperSheet: null, partials: [], status: STATUS_DEFINED }),
  entry('jibi-9x13', 'جیبی ۹×۱۳', { trim: [9, 13], formPages: null, paperPages: null, formSheet: null, paperSheet: null, partials: [], status: STATUS_DEFINED }),
  entry('sheet-a3', 'A3', { trim: [29.7, 42], formPages: null, paperPages: null, formSheet: [29.7, 42], paperSheet: [29.7, 42], partials: [], status: STATUS_DEFINED }),
  entry('sheet-a4', 'A4', { trim: [21, 29.7], formPages: null, paperPages: null, formSheet: [21, 29.7], paperSheet: [21, 29.7], partials: [], status: STATUS_DEFINED }),
];

/* ── ۳) ماشین چاپ و ظرفیت زینک ─────────────────────────────── */
/* plateFactor: هر زینک چند صفحهٔ فرم را پوشش می‌دهد (۰٫۵ = دو زینک برای هر رنگِ هر فرم کامل).
   sheet = بزرگ‌ترین برگی که ماشین روی زینک می‌گیرد؛ هر طرف زینک همین اندازه است. */
export const PRESSES = [
  entry('press-45', '4.5 ورقی', { sheet: [70, 100], plateFactor: 1, offset: true }),
  entry('press-2', '2 ورقی', { sheet: [50, 70], plateFactor: 0.5, offset: true }),
  entry('press-gto', 'GTO', { sheet: [35, 50], plateFactor: 0.25, offset: true }),
  entry('press-digital', 'دیجیتال', { sheet: null, plateFactor: 0, offset: false }),
];

/* ── ۳پ) ورق مادر استاندارد ─────────────────────────────── */
/* کاغذ و مقوا (به‌ویژه مقوای جلد) از این ورق‌های مادر بریده می‌شود؛ موتور «به کدام نزدیک‌تر است»
   را از روی تعداد قطعه‌ای که از هر مادر درمی‌آید انتخاب می‌کند و این اندازه‌ها را نمی‌سازد. */
export const MOTHER_SHEETS = [
  entry('mother-70x100', '70×100', { sheet: [70, 100] }),
  entry('mother-60x90', '60×90', { sheet: [60, 90] }),
];

/* ── ۴) رنگ چاپ ─────────────────────────────────────────────── */
export const COLOURS = [
  entry('c1', 'تک‌رنگ (مشکی)', { plates: 1 }),
  entry('c2', 'دورنگ', { plates: 2 }),
  entry('c3', 'سه‌رنگ', { plates: 3, status: STATUS_DEFINED }),
  entry('c4', 'چهاررنگ (CMYK)', { plates: 4 }),
  entry('c5', 'چهاررنگ + رنگ اضافه', { plates: 5 }),
];

/* ── ۵) صحافی (حداقل فرم = قاعدهٔ قطعی چاپخانه) ─────────────── */
export const BINDINGS = [
  entry('hotmelt', 'شومیز (چسب گرم)', { minForms: 10, matches: ['شومیز', 'چسب گرم', 'چسبی'] }),
  entry('hardcover', 'گالینگور (جلد سخت)', { minForms: 1, matches: ['گالینگور', 'جلد سخت'], extraMaterials: STATUS_DEFINED }),
  entry('wire', 'منگنه‌ای (مفتولی/سیمی)', { minForms: 4, matches: ['منگنه', 'مفتول', 'سیمی', 'فنر'] }),
  entry('box', 'جعبه‌سازی', { minForms: 1, matches: ['جعبه'] }),
  entry('plain', 'بدون صحافی', { minForms: 0, matches: ['بدون صحافی'] }),
];

/* ── ۶) عملیات تکمیلی ────────────────────────────────────────── */
export const FINISHING = [
  entry('cello-gloss', 'سلفون براق', { basis: 'coverSheet', unit: 'متر مربع', matches: ['براق'] }),
  entry('cello-matte', 'سلفون مات', { basis: 'coverSheet', unit: 'متر مربع', matches: ['مات'] }),
  entry('foil', 'طلاکوب', { basis: 'qty', unit: 'عدد', matches: ['طلاکوب'] }),
  entry('cut', 'برش ساده', { basis: 'forms', unit: 'ورق', matches: ['برش'] }),
];

/* ── ۷) کاغذ و مقوا (جنس‌ها؛ گرماژ و ورق از انبار خوانده می‌شود) ── */
export const PAPER_KINDS = [
  entry('tahrir', 'تحریر', { category: 'کاغذ' }),
  entry('glase', 'گلاسه', { category: 'مقوا', note: 'نیمه‌گلاسه جنس جداست' }),
  entry('halfglase', 'نیمه گلاسه', { category: 'مقوا' }),
  entry('balke', 'بالکی', { category: 'کاغذ' }),
  entry('kraft', 'کرافت', { category: 'کاغذ' }),
];

/* ── ۸) قاعده‌های زنجیره (پیوند نوع کار ← قطع ← کاغذ ← ماشین ← زینک ← فرم ← تیراژ) ── */
export const CHAIN_RULES = [
  entry('rule-form', 'فرم با قطع تعیین می‌شود، نه با تعداد رنگ', { formula: 'forms = pages ÷ formPages' }),
  entry('rule-plate', 'هر فرم کامل برای هر رنگ دو زینک می‌خواهد (رو و پشت)', { formula: 'plates = ceil(pages ÷ (formPages × plateFactor)) × colors' }),
  entry('rule-paper', 'کاغذ با «ورق» شمرده می‌شود و زینک با «قطعه»؛ این دو هرگز جمع نمی‌شوند', { formula: 'sheets = ceil(pages ÷ paperPages × runQty)' }),
  entry('rule-half', 'نیم‌فرم نصف تیراژ و نصف کاغذ؛ ۱/۴ فرم یک‌چهارم', { formula: 'run = ceil(runQty × ratio)' }),
  entry('rule-wat', 'نیم‌فرم «روی خودش دورو» چاپ می‌شود — این دستور اپراتور است نه عدد', { formula: 'workAndTurn = true' }),
  entry('rule-digital', 'چاپ دیجیتال زینک ندارد', { formula: 'plates = 0 when press.offset = false' }),
  entry('rule-binding', 'هر فرم متن (حتی نیم‌فرم) و جلد، یک فرم صحافی است؛ حداقل نوع صحافی رعایت می‌شود', { formula: 'bindingForms = max(chargedForms + coverForms, minForms)' }),
  entry('rule-pressfit', 'سایز فرم روی ماشین نمی‌تواند بزرگ‌تر از ورق کاغذ انتخابی باشد', { formula: 'formSheet = min(formSheet, paperSheet)' }),
  entry('rule-cover', 'جلد با ماشین انتخابی سفارش چاپ می‌شود: تعداد جلد در هر طرف زینک از سایز ماشین حساب می‌شود و زینک جلد فقط رنگ × رو است', { formula: 'coversPerZincSide = fit(press.sheet, coverOpen) · coverPlates = colors × sides' }),
  entry('rule-mother', 'ورق مقوای جلد از ورق مادر استاندارد است: هر ورق مادر چند برگ ماشین می‌دهد، آن‌قدر ورق ماشین چاپ می‌شود', { formula: 'machineSheets = motherSheets × fit(mother, press.sheet)' }),
];

/* ── ۹) تعرفه (اشاره؛ نرخ‌ها در جدول واحدها/تعرفه می‌مانند و دوباره کپی نمی‌شوند) ── */
export const TARIFF_POINTER = entry('tariff', 'نرخ‌ها از تعرفهٔ واحدها خوانده می‌شود', { storageKey: 'printshop_units_v1', reviewed: 'هفتگی' });

/* درایونگِ یکپارچهٔ بانک: ترکیب ورودی‌های ذخیره‌شده در میز دایرةالمعارف با پیش‌فرض‌ها.
   کلیدهای ذخیره همان چیزی است که LexiconDesk می‌نویسد؛ این تابع فقط می‌خواند و تغییر نمی‌دهد. */
export function buildBank(saved = {}) {
  const cuts = CUTS.map(cut => {
    const savedCut = saved.engineCuts?.[cut.name];
    if (!savedCut) return { ...cut };
    const merged = { ...cut, trim: saved.cutTrim?.[cut.name] ?? cut.trim };
    if (Number(savedCut.formPages) > 0) merged.formPages = Number(savedCut.formPages);
    if (Number(savedCut.paperPages) > 0) merged.paperPages = Number(savedCut.paperPages);
    if (Array.isArray(savedCut.formSheet) && savedCut.formSheet.length === 2) merged.formSheet = savedCut.formSheet.map(Number);
    if (Array.isArray(savedCut.paperSheet) && savedCut.paperSheet.length === 2) merged.paperSheet = savedCut.paperSheet.map(Number);
    if (Array.isArray(savedCut.partials) && savedCut.partials.length) merged.partials = savedCut.partials.map(Number);
    merged.status = STATUS_APPROVED;
    merged.source = 'میز دایرةالمعارف';
    return merged;
  });
  const byName = new Map(cuts.map(c => [c.name, c]));
  Object.entries(saved.engineCuts || {}).forEach(([name, cut]) => {
    if (byName.has(name)) return;
    byName.set(name, entry(`cut-${name}`, name, {
      trim: Array.isArray(cut.trim) ? cut.trim.map(Number) : (saved.cutTrim?.[name] || null),
      formPages: Number(cut.formPages) || null, paperPages: Number(cut.paperPages) || null,
      formSheet: Array.isArray(cut.formSheet) ? cut.formSheet.map(Number) : null,
      paperSheet: Array.isArray(cut.paperSheet) ? cut.paperSheet.map(Number) : null,
      partials: (cut.partials || []).map(Number), status: STATUS_APPROVED, source: 'میز دایرةالمعارف',
    }));
  });
  Object.entries(saved.cutTrim || {}).forEach(([name, trim]) => {
    if (byName.has(name)) return;
    byName.set(name, entry(`cut-${name}`, name, { trim: Array.isArray(trim) ? trim.map(Number) : null, formPages: null, paperPages: null, formSheet: null, paperSheet: saved.engineCuts?.[name]?.paperSheet ?? null, partials: saved.engineCuts?.[name]?.partials?.map(Number) || [], status: STATUS_DEFINED, source: 'میز دایرةالمعارف' }));
  });
  const presses = PRESSES.map(p => {
    const savedPress = saved.enginePresses?.[p.name];
    if (!savedPress) return { ...p };
    return { ...p, sheet: Array.isArray(savedPress.sheet) ? savedPress.sheet.map(Number) : p.sheet, plateFactor: Number(savedPress.plateFactor ?? p.plateFactor), offset: savedPress.offset === undefined ? p.offset : !!savedPress.offset, status: STATUS_APPROVED, source: 'میز دایرةالمعارف' };
  });
  Object.entries(saved.enginePresses || {}).forEach(([name, p]) => {
    if (presses.some(x => x.name === name)) return;
    presses.push(entry(`press-${name}`, name, {
      sheet: Array.isArray(p.sheet) ? p.sheet.map(Number) : null,
      plateFactor: Number(p.plateFactor) || 0, offset: p.offset === undefined ? true : !!p.offset, source: 'میز دایرةالمعارف',
    }));
  });
  const productTypes = (saved.productTypes || []).length
    ? saved.productTypes.map((name, i) => {
      const known = PRODUCT_TYPES.find(p => p.name === name);
      return known ? { ...known, code: `${known.code}-${i}` } : entry(`type-${i}`, name, { bookLike: (saved.bookLikeTypes || []).includes(name), needs: ['cut', 'paper'], status: STATUS_DEFINED, source: 'میز دایرةالمعارف' });
    })
    : PRODUCT_TYPES.map(p => ({ ...p }));
  const bindings = BINDINGS.map(b => ((saved.bindingTypes || []).includes(b.name) ? { ...b, source: 'میز دایرةالمعارف' } : { ...b }));
  const colours = (saved.printColors || []).length
    ? saved.printColors.map((c, i) => entry(`colour-${c[0] ?? i}`, c[1] ?? String(c), { plates: Number(c[0]) || 0, source: 'میز دایرةالمعارف' }))
    : COLOURS.map(c => ({ ...c }));
  return {
    schemaVersion: BANK_SCHEMA_VERSION,
    builtAt: new Date().toISOString().slice(0, 10),
    productTypes, cuts: [...byName.values()], presses, motherSheets: MOTHER_SHEETS.map(s => ({ ...s })), colours, bindings, finishing: FINISHING.map(f => ({ ...f })),
    paperKinds: PAPER_KINDS.map(p => ({ ...p })), rules: CHAIN_RULES.map(r => ({ ...r })), tariff: TARIFF_POINTER,
  };
}

export function findCut(bank, name) {
  const text = latin(String(name || ''));
  return bank.cuts.find(c => c.name === name || latin(c.name) === text) || null;
}
export function findPress(bank, label) {
  const text = latin(String(label || '')).toLowerCase();
  if (/دیجیتال/.test(text)) return bank.presses.find(p => !p.offset) || null;
  if (/gto/.test(text)) return bank.presses.find(p => /gto/i.test(p.name)) || null;
  if (/4[.٫]5/.test(text)) return bank.presses.find(p => p.name.startsWith('4.5')) || null;
  if (/2\s*ورقی/.test(text)) return bank.presses.find(p => /2\s*ورقی/.test(latin(p.name))) || null;
  return null;
}
export function findBinding(bank, name) {
  const text = String(name || '');
  return bank.bindings.find(b => (b.matches || []).some(m => text.includes(m))) || null;
}
export function approvedOnly(list) { return (list || []).filter(x => x.status === STATUS_APPROVED); }

const persian = s => String(s).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

/* موتورهای موجود برنامه (smart.js و planBook) فهرست مرجع را به شکل «نام ← سطر» می‌خواهند.
   این تابع همان سطرهای بانک را می‌چیند؛ عدد تازه‌ای نمی‌سازد.=cut‌هایی که فرم‌بندی تأییدنشده دارند
   عمداً بیرون می‌مانند تا موتور برنامه هم از آن‌ها عدد نسازد. */
export function catalogOf(bank) {
  const cuts = {};
  for (const c of bank.cuts) {
    if (c.status !== STATUS_APPROVED || !(c.formPages > 0) || !(c.paperPages > 0)) continue;
    cuts[c.name] = { formPages: c.formPages, paperPages: c.paperPages, partials: c.partials || [], trim: c.trim, formSheet: c.formSheet, paperSheet: c.paperSheet };
  }
  const presses = {};
  for (const p of bank.presses) {
    const row = { plateFactor: p.plateFactor, offset: p.offset, sheet: p.sheet };
    presses[p.name] = row;
    const fa = persian(p.name);
    if (fa !== p.name) presses[fa] = row;
  }
  return { cuts, presses };
}

/* چه چیزی از بانک هنوز تأیید نشده؟ موتور پیش از محاسبه این را می‌پرسد. */
export function bankGaps(bank) {
  const gaps = [];
  bank.cuts.filter(c => c.status !== STATUS_APPROVED).forEach(c => gaps.push({ group: 'قطع', code: c.code, name: c.name, missing: ['formPages', 'paperPages', 'formSheet'], why: `فرم‌بندی «${c.name}» هنوز تأیید نشده است.` }));
  bank.bindings.filter(b => b.status !== STATUS_APPROVED).forEach(b => gaps.push({ group: 'صحافی', code: b.code, name: b.name, missing: ['extraMaterials'], why: `مصالح «${b.name}» در بانک تعریف نشده است.` }));
  bank.colours.filter(c => c.status !== STATUS_APPROVED).forEach(c => gaps.push({ group: 'رنگ', code: c.code, name: c.name, missing: ['tariff'], why: `کد رنگ «${c.name}» تأیید نشده و تعرفه ندارد.` }));
  return gaps;
}
