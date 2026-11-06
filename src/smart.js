/* Pure logic (no React): text understanding, imposition, material and cost estimation, number formatting helpers.
   Rule-based and fully offline — every number is derived by explicit formulas shown to the operator. */

import { planBook, CUTS as ENGINE_CUTS } from './print-engine.mjs';
import { buildBank, findCut, findPress, catalogOf, STATUS_APPROVED } from './knowledge.mjs';
import { FINISHING_UNIT_KEY } from './job-templates.js';
import { parseCello, celloLabel, celloKindOf } from './cellophane.js';

export const TRIM_SIZES = {
  'وزیری': [17, 24], 'رقعی': [14.5, 21], 'رحلی': [21, 29], 'خشتی': [20.5, 20.5], 'جیبی': [11, 17],
  'پالتویی': [11, 18], 'A3': [29.7, 42], 'A4': [21, 29.7], 'A5': [14.8, 21], 'B5': [17.6, 25],
  'کارت ویزیت': [9, 5],
};
export const PAPER_KINDS = ['نیمه گلاسه', 'گلاسه', 'تحریر', 'بالکی', 'کرافت', 'کاهی', 'لوکس', 'ریسو', 'مروارید', 'پشت طوسی', 'پشت سفید', 'کتان', 'کالک', 'آرت'];
export const DEFAULT_BINDING_TYPES = ['بدون صحافی', 'شومیز (چسب گرم)', 'گالینگور (جلد سخت)', 'منگنه‌ای (مفتولی/سیمی)', 'جعبه‌سازی', 'سلفون براق', 'سلفون مات', 'طلاکوب', 'برش ساده'];
export const DEFAULT_PRINT_COLORS = [[1, 'تک‌رنگ (مشکی)'], [2, 'دورنگ'], [4, 'چهاررنگ (CMYK)'], [5, 'چهاررنگ + رنگ اضافه']];
export const DEFAULT_BOOK_LIKE_TYPES = ['کتاب', 'مجله'];
/* واژه‌نامهٔ زندهٔ میز «دایرةالمعارف». رابط کاربری همین شیء را پیش از رندرِ فرزندان از فهرست‌های ذخیره‌شده
   پر می‌کند (همان الگوی costContext) تا تحلیل متن و محاسبهٔ مواد از انتخاب‌های مدیر بخوانند. */
export const lexicon = { trimSizes: TRIM_SIZES, paperKinds: PAPER_KINDS, bindingTypes: DEFAULT_BINDING_TYPES, printColors: DEFAULT_PRINT_COLORS, bookLikeTypes: DEFAULT_BOOK_LIKE_TYPES, engineCatalog: null, bank: null };

/* بانک دانش تنها منبع اعداد فرم‌بندی، ورق و ظرفیت زینک است. رابط کاربری applyBank را با دادهٔ
   ذخیره‌شدهٔ میز دایرةالمعارف صدا می‌زند؛ تا آن لحظه، پیش‌فرض‌های همان بانک مصرف می‌شود. */
export function applyBank(saved = {}) {
  lexicon.bank = buildBank(saved);
  lexicon.engineCatalog = catalogOf(lexicon.bank);
  return lexicon.bank;
}
const bank = () => lexicon.bank || buildBank({});

/* ── پرسش‌های موتور: بلوک رنگ و فرم‌بندی قطع ─────────────────────
   این توابع فقط «پیشنهاد» و «وضعیت» را برمی‌گردانند؛ تصمیم با اپراتور است.
   analyzeItem تا وقتی جواب تأیید نشده، هیچ عددی نمی‌سازد (نه ۱۵۲، نه ۴۰). */

/* پیش‌نویس فعلی بلوک رنگ: اگر اپراتور چیزی نگه داشته باشد همان، وگرنه پیشنهاد از متن سفارش. */
export function colourDraftOf(spec, pages, textColors) {
  const sp = spec || {};
  if (sp.colourUniform === true || sp.colourUniform === false || Array.isArray(sp.colourBlocks)) {
    return { uniform: sp.colourUniform === true, blocks: Array.isArray(sp.colourBlocks) ? sp.colourBlocks : [] };
  }
  const p = Math.min(pages, Math.max(0, Math.round(Number(sp.frontColorPages) || 0)));
  const c = Number(sp.frontColors) || 4;
  if (p > 0 && p < pages && c !== Number(textColors)) {
    return { uniform: false, blocks: [
      { from: '1', to: String(p), colors: c, label: 'صفحه‌های اول' },
      { from: String(p + 1), to: String(pages), colors: textColors, label: 'بقیهٔ متن' },
    ] };
  }
  return { uniform: true, blocks: [] };
}

/* جواب تأییدشدهٔ بلوک رنگ؛ null یعنی هنوز پرسیده/تأیید نشده. */
export function resolveColourPlan(spec, pages, textColors) {
  const sp = spec || {};
  const colors = Number(textColors) || 1;
  if (colors < 2) return { uniform: true, ranges: [{ pages, colors, label: '' }] };
  if (sp.colourConfirmed !== true) return null;
  if (sp.colourUniform === true) return { uniform: true, ranges: [{ pages, colors, label: '' }] };
  const ranges = (sp.colourBlocks || []).map(b => ({
    pages: Math.max(0, Number(b.to) - Number(b.from) + 1),
    colors: Number(b.colors) || colors,
    label: String(b.label || ''),
    from: Number(b.from), to: Number(b.to),
  })).filter(r => r.pages > 0);
  return { uniform: false, ranges };
}

/* پیشنهاد فرم‌بندی از نزدیک‌ترین قطعِ تأییدشدهٔ بانک (فقط پیشنهاد، نه جواب). */
export function cutFormSuggestion(trim) {
  if (!Array.isArray(trim) || !(Number(trim[0]) > 0 && Number(trim[1]) > 0)) return null;
  const approved = bank().cuts.filter(c => c.status === STATUS_APPROVED && c.formPages > 0 && c.paperPages > 0 && Array.isArray(c.trim));
  if (!approved.length) return null;
  const distance = c => Math.abs(c.trim[0] - trim[0]) + Math.abs(c.trim[1] - trim[1]);
  const best = [...approved].sort((a, b) => distance(a) - distance(b))[0];
  return { source: best.name, formPages: best.formPages, paperPages: best.paperPages, formSheet: best.formSheet || null, paperSheet: best.paperSheet || null };
}

/* وضعیت فرم‌بندی قطع برای کتاب: از بانک، از تأیید سفارش، یا پرسش. */
export function bookCutPlan(spec) {
  const sp = spec || {};
  const key = sp.sizeKey && sp.sizeKey !== 'سفارشی' ? sp.sizeKey : '';
  if (!key) return { needed: false, values: null };
  if (sp.cutFormConfirmed === true && sp.cutForm && Number(sp.cutForm.formPages) > 0 && Number(sp.cutForm.paperPages) > 0) {
    return { needed: false, confirmed: true, values: { source: 'تأیید سفارش', formPages: Number(sp.cutForm.formPages), paperPages: Number(sp.cutForm.paperPages), formSheet: sp.cutForm.formSheet || null, paperSheet: sp.cutForm.paperSheet || null } };
  }
  const cut = findCut(bank(), key);
  if (cut && cut.status === STATUS_APPROVED && cut.formPages > 0 && cut.paperPages > 0) {
    return { needed: false, values: { source: cut.name, formPages: cut.formPages, paperPages: cut.paperPages, formSheet: cut.formSheet || null, paperSheet: cut.paperSheet || null } };
  }
  return {
    needed: true,
    reason: cut ? `فرم‌بندی قطع «${key}» در بانک دانش تأیید نشده است.` : `قطع «${key}» در بانک دانش تعریف نشده است.`,
    suggestion: cutFormSuggestion(lexicon.trimSizes[key] || (cut && cut.trim)),
  };
}

export const DEFAULT_SETTINGS = {
  company: { name: 'موسسه چاپ و نشر عروج', logo: '', phone: '', mobile: '', address: '', postalCode: '', economicCode: '', nationalId: '', email: '', website: '', footer: '' },
  quote: { validityDays: 7, vatPercent: 0, terms: '۱) اعتبار این پیش‌فاکتور تا تاریخ ذکرشده است و پس از آن نیاز به بازبینی قیمت دارد.\n۲) شروع تولید پس از تایید مشتری و دریافت پیش‌پرداخت انجام می‌شود.\n۳) زمان تحویل پس از تایید نهایی طرح و پرداخت پیش‌پرداخت محاسبه می‌شود.' },
  calc: {
    calcVersion: 2, wastePercent: 0, makeReadyPerForm: 100, runWasteCopies: 100, leafThicknessFactor: 0.0013, coverExtraCm: 0.5, sheetMarginCm: 1, coverMarginCm: 0, coverMakeReady: 0, bigBindingAreaCm2: 500,
    defaultCoverGsm: 250, plateCostFallback: 0, printRatePer1000: 0, digitalRatePerSide: 0, cellophaneRate: { 'براق': 0, 'مات': 0 }, cellophaneRollWidthCm: 72,
    bindingRates: {}, marginPercent: 20,
  },
  ai: { enabled: false, apiKey: '', model: 'claude-sonnet-5-5' },
};
const _num = (v, d) => { const n = Number(v); return v === '' || v === null || v === undefined || isNaN(n) ? d : n; };
export function mergeSettings(saved) {
  const s = saved || {};
  const D = DEFAULT_SETTINGS;
  const c = { ...D.calc, ...(s.calc || {}) };
  const out = {
    company: { ...D.company, ...(s.company || {}) },
    quote: { ...D.quote, ...(s.quote || {}) },
    ai: { ...D.ai, ...(s.ai || {}) },
    calc: { ...c, cellophaneRate: { ...D.calc.cellophaneRate, ...((s.calc || {}).cellophaneRate || {}) }, bindingRates: { ...((s.calc || {}).bindingRates || {}) } },
  };
  // نسخه‌ی ۲ محاسبه (قاعده‌ی چاپخانه): ضایعات = ۱۰۰ برگ برای هر فرم، بدون درصد؛ جلد بدون ضایعات؛ حاشیه‌ی جلد صفر
  if (!((s.calc || {}).calcVersion >= 2)) { out.calc.wastePercent = 0; out.calc.makeReadyPerForm = 100; out.calc.runWasteCopies = 100; out.calc.coverExtraCm = 0.5; out.calc.coverMarginCm = 0; out.calc.coverMakeReady = 0; out.calc.calcVersion = 2; }
  ['wastePercent', 'makeReadyPerForm', 'runWasteCopies', 'coverMarginCm', 'coverMakeReady', 'bigBindingAreaCm2', 'leafThicknessFactor', 'coverExtraCm', 'sheetMarginCm', 'defaultCoverGsm', 'plateCostFallback', 'printRatePer1000', 'digitalRatePerSide', 'cellophaneRollWidthCm', 'marginPercent']
    .forEach(k => { out.calc[k] = _num(out.calc[k], D.calc[k]); });
  if (!(out.calc.leafThicknessFactor > 0)) out.calc.leafThicknessFactor = D.calc.leafThicknessFactor;
  if (!(out.calc.cellophaneRollWidthCm > 0)) out.calc.cellophaneRollWidthCm = D.calc.cellophaneRollWidthCm;
  Object.keys(out.calc.cellophaneRate).forEach(k => { out.calc.cellophaneRate[k] = _num(out.calc.cellophaneRate[k], 0); });
  Object.keys(out.calc.bindingRates).forEach(k => { out.calc.bindingRates[k] = _num(out.calc.bindingRates[k], 0); });
  out.quote.validityDays = _num(out.quote.validityDays, D.quote.validityDays);
  out.quote.vatPercent = _num(out.quote.vatPercent, 0);
  return out;
}

/* ---------- numbers ---------- */
export function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه')
    .replace(/\u200c/g, ' ').replace(/٫/g, '.');
}
/* نمایش (اصلاحات ۱۷/بند ۳/۶ — تصمیم کارفرما «فارسی»): عددِ لاتینِ ذخیره‌شده را به
   رقمِ فارسی می‌گرداند. فقط برای دیدن است؛ هیچ مقدارِ ذخیره‌شده‌ای از اینجا نمی‌گذرد
   و ورودی‌ها همچنان با normalizeDigits به لاتین برمی‌گردند. */
export function faDigits(str) {
  return String(str ?? '').replace(/[0-9]/g, d => String.fromCharCode(0x06f0 + Number(d)))
    .replace(/[٠-٩]/g, d => String.fromCharCode(0x06f0 + d.charCodeAt(0) - 0x0660));
}
export function cleanNumber(str) {
  let s = normalizeDigits(str).replace(/[,٬،\s]/g, '');
  s = s.replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
  return s;
}
export function formatTyping(raw) {
  const s = String(raw ?? '');
  if (s === '') return '';
  const [ip, fp] = s.split('.');
  const g = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fp === undefined ? g : `${g}.${fp}`;
}

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'یکصد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];
function below1000(n) {
  const parts = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 20) parts.push(ONES[r]);
    else { parts.push(TENS[Math.floor(r / 10)]); if (r % 10) parts.push(ONES[r % 10]); }
  }
  return parts.join(' و ');
}
export function numberToWords(num) {
  let n = Math.round(Number(num) || 0);
  if (n === 0) return 'صفر';
  const neg = n < 0; n = Math.abs(n);
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const out = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    out.push((i === 1 && groups[i] === 1 && groups.length === 2 ? '' : below1000(groups[i]) + ' ') + (SCALES[i] || '').trim());
  }
  return (neg ? 'منفی ' : '') + out.map(x => x.trim()).join(' و ');
}

/* ---------- spoken numbers ----------
   متنِ پیاده‌شده از صوت می‌تواند عدد را واژه بنویسد («دو هزار و پانصد نسخه»، «هفتاد گرم»).
   تبدیل فقط برای شمارش‌های عددی به کار می‌رود، پس رنگ و صحافی از متن اصلی خوانده می‌شوند. */
const WORD_VALUE = new Map();
const WORD_SCALE = new Map([['هزار', 1000], ['میلیون', 1000000], ['میلیارد', 1000000000]]);
ONES.forEach((w, i) => { if (w) WORD_VALUE.set(w, i); });
TENS.forEach((w, i) => { if (w) WORD_VALUE.set(w, i * 10); });
HUNDREDS.forEach((w, i) => { if (w) WORD_VALUE.set(w, i * 100); });
WORD_VALUE.set('صد', 100);

function spokenRunValue(run) {
  let total = 0, current = 0, seen = false;
  for (const token of run) {
    if (token === 'و') continue;
    if (WORD_SCALE.has(token)) { total += (current || 1) * WORD_SCALE.get(token); current = 0; seen = true; continue; }
    if (WORD_VALUE.has(token)) { current += WORD_VALUE.get(token); seen = true; continue; }
    return null;
  }
  return seen ? total + current : null;
}
export function wordsToDigits(str) {
  const tokens = normalizeDigits(str).split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const run = [];
    let j = i;
    while (j < tokens.length && (WORD_VALUE.has(tokens[j]) || WORD_SCALE.has(tokens[j]) || (tokens[j] === 'و' && run.length && run[run.length - 1] !== 'و'))) {
      run.push(tokens[j]); j++;
    }
    while (run.length && run[run.length - 1] === 'و') { run.pop(); j--; }
    const value = run.length ? spokenRunValue(run) : null;
    if (value !== null) { out.push(String(value)); i = j; continue; }
    out.push(tokens[i]); i++;
  }
  return out.join(' ');
}

/* ---------- free-text understanding ---------- */
const WORD_NUM = { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10 };

function colorsFrom(seg) {
  if (!seg) return null;
  const dm = normalizeDigits(seg).match(/(?:^|[^\d.])([1-5])\s*رنگ/);
  if (dm) { const n = Number(dm[1]); return n === 3 ? 4 : n; }
  if (/(تمام\s*رنگی|چهار\s*رنگ|cmyk|فول\s*کالر)/i.test(seg)) return 4;
  if (/(دو\s*رنگ|دورنگ)/.test(seg)) return 2;
  if (/((تک|یک)\s*رنگ|مشکی|سیاه)/.test(seg)) return 1;
  if (/رنگی/.test(seg)) return 4;
  return null;
}
function sidesFrom(seg) {
  if (!seg) return null;
  if (/(رو\s*و\s*پشت|پشت\s*و\s*رو|دو\s*رو|دورو)/.test(seg)) return 2;
  if (/(یک\s*رو|تک\s*رو|یکرو)/.test(seg)) return 1;
  return null;
}
function paperFrom(seg) {
  if (!seg) return { kind: '', gsm: null };
  let kind = '';
  for (const k of lexicon.paperKinds) { if (seg.includes(k)) { kind = k; break; } }
  const spelled = wordsToDigits(seg);
  let gsm = null;
  const m = spelled.match(/(\d{2,3})\s*(?:گرم|گرمی|g\b|gr\b)/i);
  if (m) gsm = Number(m[1]);
  else if (kind) { const m2 = spelled.match(new RegExp(kind + '\\s*(\\d{2,3})(?!\\d)')); if (m2) gsm = Number(m2[1]); }
  return { kind, gsm };
}

export function parseOrderText(rawText, { productTypes = [], serviceTypes = [] } = {}) {
  let t = normalizeDigits(rawText).replace(/[\r\n]+/g, ' ');
  // thousands separators in numbers: 1.000 / 1,000
  for (let i = 0; i < 3; i++) t = t.replace(/(\d)[.,٬،](?=\d{3}(?!\d))/g, '$1');
  const out = { printMethod: '', productType: '', productName: '', sizeKey: '', custom: null, pages: null, qty: null, text: { kind: '', gsm: null, colors: null, sides: null, frontPages: null, frontColors: null }, cover: { enabled: false, kind: '', gsm: null, colors: null, sides: null, cellophane: '' }, binding: '', services: [], notes: [] };
  if (!t.trim()) return out;

  for (const pt of [...productTypes].filter(x => x && x !== 'سایر').sort((a, b) => b.length - a.length)) { if (t.includes(pt)) { out.productType = pt; out.productName = pt; break; } }

  for (const key of Object.keys(lexicon.trimSizes)) { if (key !== 'کارت ویزیت' && t.includes(key)) { out.sizeKey = key; break; } }
  if (!out.sizeKey && /کارت\s*ویزیت/.test(t)) out.sizeKey = 'کارت ویزیت';
  if (!out.sizeKey) {
    const m = t.match(/(\d+(?:\.\d+)?)\s*(?:[×xX*]|در)\s*(\d+(?:\.\d+)?)/);
    if (m && Number(m[1]) <= 60 && Number(m[2]) <= 60) out.custom = [Number(m[1]), Number(m[2])];
  }

  /* تعداد کل صفحه‌ها بزرگ‌ترین عدد صفحه‌ای متن است؛ «۴ صفحه اول» نباید جای ۳۰۴ صفحه بنشیند. */
  const pageHits = [...wordsToDigits(t).matchAll(/(\d+)\s*(?:صفحه|ص(?![\u0600-\u06FF]))/g)].map(m => Number(m[1])).filter(n => n > 0);
  if (pageHits.length) out.pages = Math.max(...pageHits);

  const spokenQty = wordsToDigits(t);
  let q = spokenQty.match(/(?:تیراژ|شمارگان|تعداد)\s*[:\-]?\s*(\d+)/);
  if (q) out.qty = Number(q[1]);
  if (!out.qty) {
    /* «یک جلد کتاب … دو هزار نسخه»: واحد نسخه و عدد بر «جلد/برگ/تا» مقدم‌اند، چون آن‌ها شمار قطعه‌ی کار را می‌برند.
       شرط بعد از واحد «حرف نیست» است نه «خارج از بازه‌ی یونیکد عربی»: متن گفتارِ تبدیل‌شده سرِ هر بند
       ویرگول فارسی «،» (U+060C) دارد و «۲۰۰ نسخه،» باید خوانده شود؛ «۵۰۰ برگه» هم واحد خودش را می‌گیرد. */
    const found = [...spokenQty.matchAll(/(\d+)\s*(نسخه|برگه|برگ|عدد|جلد|دست|بسته|تا)(?!\p{L})/gu)];
    const pick = found.find(m => m[2] === 'نسخه' || m[2] === 'عدد') || found[found.length - 1];
    if (pick) {
      out.qty = Number(pick[1]);
      if (/^برگ/.test(pick[2])) out.notes.push(`تیراژ از «${pick[0].trim()}» خوانده شد؛ اگر منظور تعداد کاغذ بوده، شمارگان را دستی تأیید کنید.`);
    }
  }
  if (!out.qty) {
    const h = t.match(/(\d+|یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)?\s*هزار/);
    if (h) out.qty = (h[1] ? (isNaN(Number(h[1])) ? WORD_NUM[h[1]] : Number(h[1])) : 1) * 1000;
  }

  const bi = t.search(/صحافی/);
  const ci = t.search(/جلد/);
  const ti = t.search(/داخل|متن/);
  const cut = (from, ...limits) => { let end = t.length; limits.forEach(l => { if (l > from && l < end) end = l; }); return t.slice(from, end); };
  let inside = t, coverSeg = '';
  if (ci >= 0) {
    out.cover.enabled = true;
    if (ti >= 0 && ti > ci) { coverSeg = cut(ci, ti, bi); inside = cut(ti, bi); }
    else if (ti >= 0) { inside = cut(ti, ci, bi); coverSeg = cut(ci, bi); }
    else { inside = t.slice(0, ci); coverSeg = cut(ci, bi); }
  }
  /* رنگ و رو/پشت ممکن است پیش از «داخل/متن» گفته شود («۳۰۴ صفحه ۲ رنگ با کاغذ تحریر…»)؛
     پس از کنار گذاشتن بخش جلد، از کل متن خوانده می‌شود تا رنگ متن از دست نرود. */
  const textSeg = coverSeg ? t.replace(coverSeg, ' ') : t;
  /* «۴ صفحه اول ۴ رنگ، مابقی ۲ رنگ»: صفحه‌های اول جدا شمرده می‌شوند و عبارتشان از متن رنگ حذف می‌شود
     تا رنگ بقیهٔ متن از «۲ رنگ» خوانده شود، نه از «۴ رنگ» صفحه‌های اول. عددها ممکن است با حروف باشند،
     ولی خود عبارت از متن اصلی حذف می‌شود تا «سه رنگ»ِ نامشخص همچنان نیازمند تأیید بماند. */
  const WNUM = 'یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده';
  const wordNumber = value => /^\d+$/.test(value) ? Number(value) : (WORD_NUM[value] || 0);
  let colorsText = textSeg;
  const frontMatch =
    colorsText.match(new RegExp(`(\\d+|${WNUM})\\s*(?:صفحه|ص)\\s*(?:اول|اولی|ابتدایی)(?:\\s*[یي]|‌ی)?\\s*[،,:]?\\s*(\\d+|${WNUM})\\s*رنگ`)) ||
    colorsText.match(new RegExp(`(\\d+|${WNUM})\\s*اول(?:\\s*[یي]|‌ی)?\\s*[،,:]?\\s*(\\d+|${WNUM})\\s*رنگ`)) ||
    colorsText.match(new RegExp(`(\\d+|${WNUM})\\s*(?:صفحه|ص)\\s*(?:اول|اولی|ابتدایی)(?:\\s*[یي]|‌ی)?`)) ||
    colorsText.match(new RegExp(`(\\d+|${WNUM})\\s*صفحه\\s*(?:تمام\\s*رنگی|تمام‌رنگی|رنگی)(?=\\s*(?:مابقی|بقیه|سایر|و\\s*(?:\\d+|${WNUM})\\s*صفحه))`));
  if (frontMatch) {
    const frontPages = wordNumber(frontMatch[1]);
    const frontColors = frontMatch[2] ? wordNumber(frontMatch[2]) : 4;
    if (frontPages > 0 && (!out.pages || frontPages < out.pages)) {
      out.text.frontPages = frontPages;
      out.text.frontColors = frontColors;
      /* «۴ صفحه اول ۴ رنگ و ۳۰۰ صفحه ۲ رنگ»: اگر پیش از صفحه‌های اول عدد صفحه‌ای نیامده باشد،
         آن عدد بعدی مقدار «بقیه» است و کل = صفحه‌های اول + بقیه. */
      const before = wordsToDigits(colorsText.slice(0, frontMatch.index)).match(/\d+\s*(?:صفحه|ص)/);
      const after = wordsToDigits(colorsText.slice(frontMatch.index + frontMatch[0].length)).match(/(\d+)\s*(?:صفحه|ص)/);
      if (!before && after) out.pages = frontPages + Number(after[1]);
      colorsText = colorsText.replace(frontMatch[0], ' ');
      out.notes.push(`صفحه‌های اول: ${frontPages} صفحه ${frontColors} رنگ جدا از بقیهٔ متن محاسبه می‌شود.`);
    }
  }
  /* «۳۲۰ صفحه ۱۶ صفحه ۴ رنگ»: بلوک رنگیِ کوتاه‌تر بدون واژهٔ «اول» هم خوانده می‌شود، ولی فقط وقتی
     شمار صفحهٔ بزرگ‌تری پیش از آن آمده باشد و رنگش از رنگ بقیه بیشتر باشد؛ وگرنه «۴ رنگ»ِ کل متن است. */
  if (!out.text.frontPages && out.pages) {
    for (const m of colorsText.matchAll(new RegExp(`(\\d+|${WNUM})\\s*(?:صفحه|ص)\\s*(\\d+|${WNUM})\\s*رنگ`, 'g'))) {
      const frontPages = wordNumber(m[1]);
      const frontColors = wordNumber(m[2]);
      const before = wordsToDigits(colorsText.slice(0, m.index)).match(/(\d+)\s*(?:صفحه|ص)/);
      const rest = `${colorsText.slice(0, m.index)} ${colorsText.slice(m.index + m[0].length)}`;
      const bodyColors = colorsFrom(rest) || 1;
      if (before && frontPages > 0 && frontPages < out.pages && frontColors > bodyColors) {
        out.text.frontPages = frontPages;
        out.text.frontColors = frontColors;
        colorsText = rest;
        out.notes.push(`صفحه‌های اول: ${frontPages} صفحه ${frontColors} رنگ جدا از بقیهٔ متن محاسبه می‌شود.`);
        break;
      }
    }
  }
  const tp = paperFrom(inside); out.text.kind = tp.kind; out.text.gsm = tp.gsm;
  out.text.colors = colorsFrom(colorsText); out.text.sides = sidesFrom(textSeg);
  if (!out.text.colors && /رنگ/.test(inside)) out.notes.push('تعداد رنگ چاپ متن از گفتار روشن نشد؛ قبل از محاسبه تأیید شود (پیش‌فرض برنامه یک رنگ است).');
  if (out.cover.enabled) {
    const cp = paperFrom(coverSeg); out.cover.kind = cp.kind; out.cover.gsm = cp.gsm;
    out.cover.colors = colorsFrom(coverSeg); out.cover.sides = sidesFrom(coverSeg);
    if (!out.cover.colors && /رنگ/.test(coverSeg)) out.notes.push('تعداد رنگ چاپ جلد از گفتار روشن نشد؛ قبل از محاسبه تأیید شود (پیش‌فرض برنامه چهار رنگ است).');
    if (/سلفون/.test(coverSeg)) Object.assign(out.cover, parseCello(coverSeg));
  } else if (/سلفون/.test(t)) {
    Object.assign(out.cover, parseCello(t));
  }

  if (/گالینگور|جلد\s*سخت|سخت\s*جلد/.test(t)) out.binding = 'گالینگور (جلد سخت)';
  else if (/شومیز|چسب\s*گرم|چسبی/.test(t)) out.binding = 'شومیز (چسب گرم)';
  else if (/سیمی|فنری|مفتولی|منگنه/.test(t)) out.binding = 'منگنه‌ای (مفتولی/سیمی)';
  else if (/جعبه/.test(t)) out.binding = 'جعبه‌سازی';

  out.printMethod = /دیجیتال/.test(t) ? 'دیجیتال' : (/افست|آفست/.test(t) ? 'افست' : '');
  out.services = serviceTypes.filter(s => s && t.includes(s));
  return out;
}

/* ---------- imposition ---------- */
export function parseSheetSize(str) {
  const m = normalizeDigits(str || '').match(/(\d+(?:\.\d+)?)\s*(?:[×xX*\-]|در)\s*(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
export function pieceFit(sheet, w, h, margin = 1) {
  const uw = sheet[0] - margin, uh = sheet[1] - margin;
  if (!(w > 0 && h > 0)) return 0;
  const a = Math.floor(uw / w) * Math.floor(uh / h);
  const b = Math.floor(uw / h) * Math.floor(uh / w);
  return Math.max(a, b);
}
function foldable(n) { for (const f of [32, 16, 8, 4, 2, 1]) if (n >= f) return f; return 0; }
export const DEFAULT_PRESS = '2 ورقی';
/* بند ۱۱: فرم متن با قطع تعیین می‌شود، نه با تعداد رنگ. هر فرم یک روی و یک پشت دارد.
   اعداد فرم‌بندی، ورق کاغذ، سایز فرم روی ماشین و ظرفیت زینک دیگر در این فایل نوشته نشده‌اند:
   findCut/findPress از بانک دانش (knowledge.mjs) خوانده می‌شوند و اگر بانک نگفت، حدس هندسی پایین می‌آید. */

const runNumber = value => {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const number = Number(normalizeDigits(text));
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};
/* نیم‌فرم رقعی/وزیری ۰٫۷۵ به یک ۸ صفحه و یک ۴ صفحه شکسته می‌شود؛ هر تکه روی خودش دورو چاپ می‌شود. */
function runChunks(pages, formPages) {
  const chunks = [];
  let rest = pages;
  while (rest > 0) { const size = Math.min(rest, Math.max(4, formPages / 2)); chunks.push(size); rest -= size; }
  return chunks;
}
function runRatioLabel(pages, formPages) {
  const ratio = pages / formPages;
  if (ratio === 0.5) return 'نصف';
  if (ratio === 0.25) return 'یک‌چهارم';
  if (ratio === 0.75) return 'سه‌چهارم';
  return `${Math.round(ratio * 100)}٪`;
}

function norm(s) { return normalizeDigits(s).toLowerCase(); }
function gsmOf(inv) { const g = Number(normalizeDigits(inv.gramaj).replace(/[^0-9.]/g, '')); if (g) return g; const m = norm(inv.name).match(/(\d{2,3})\s*(?:گرم|g)/); return m ? Number(m[1]) : 0; }
function stockOf(inv) {
  if (inv.unitMode === 'band_sheet') return (Number(inv.bandCount) || 0) * (Number(inv.sheetsPerBand) || 0);
  if (inv.unitMode === 'roll_kg') return Number(inv.weightKg) || 0;
  return Number(inv.quantity) || 0;
}
export function findPaper(inventory, { kind, gsm, cats }, customerId) {
  let list = inventory.filter(i => cats.includes(i.category));
  const byGsm = gsm ? list.filter(i => gsmOf(i) === Number(gsm)) : list;
  let pool = byGsm;
  if (kind) {
    const k = norm(kind);
    const exact = byGsm.filter(i => norm(`${i.name} ${i.brand || ''}`).includes(k) && !(k === 'گلاسه' && norm(i.name).includes('نیمه')));
    pool = exact;
  }
  if (!pool.length) return null;
  const score = (i) => (customerId && i.ownerType === 'مشتری' && i.ownerCustomerId === customerId ? 1e12 : 0) + (stockOf(i) > 0 ? 1e6 : 0) + Math.min(stockOf(i), 9e5);
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

function paperQty(inv, sheets, sheetSize, gsm) {
  if (inv.unitMode === 'band_sheet') return { qty: sheets, unit: 'ورق' };
  if (inv.unitMode === 'roll_kg') return { qty: r2(sheets * (sheetSize[0] / 100) * (sheetSize[1] / 100) * gsm / 1000), unit: 'کیلوگرم' };
  return { qty: sheets, unit: 'ورق' };
}

/* ---------- main analysis ---------- */
export function analyzeItem(item, ctx) {
  const { inventory, customerId, settings } = ctx;
  const c = settings.calc;
  const sp = item.spec || {};
  const isBook = !!ctx.isBook;
  const errors = [], warnings = [], steps = [];
  const qty = Number(sp.qtyOverride) || Number(item.qty) || 0;
  const trim = sp.sizeKey && sp.sizeKey !== 'سفارشی'
    ? (lexicon.trimSizes[sp.sizeKey] || (findCut(bank(), sp.sizeKey) || {}).trim || [0, 0])
    : [Number(sp.w) || 0, Number(sp.h) || 0];
  const pages = Number(sp.pages) || 0;
  const res = { ok: false, errors, warnings, steps, waiting: [], numbers: {}, rows: { papers: [], coverPapers: [], litho: [], cellophane: [] }, invIds: {}, services: [] };

  if (!qty) errors.push('شمارگان (تیراژ) وارد نشده است.');
  if (!(trim[0] > 0 && trim[1] > 0)) errors.push('قطع محصول مشخص نیست.');
  if (isBook && !pages) errors.push('تعداد صفحات کتاب مشخص نیست.');
  if (isBook && pages && qty) {
    const cutKey = sp.sizeKey && sp.sizeKey !== 'سفارشی' ? sp.sizeKey : '';
    if ((lexicon.engineCatalog?.cuts ?? ENGINE_CUTS)[cutKey]) {
      const check = planBook({ cut: cutKey, pages, qty, press: sp.printMethod === 'دیجیتال' ? 'دیجیتال' : String(item.press || DEFAULT_PRESS), colors: 1, catalog: lexicon.engineCatalog || undefined });
      if (!check.ok) errors.push(...check.errors.filter(e => /فرم‌بندی/.test(e)));
    }
  }
  if (!sp.textGsm) errors.push('گرماژ کاغذ مشخص نیست.');
  if (errors.length) return res;

  const textColors = Number(sp.textColors) || 1;
  const textSides = Number(sp.textSides) || (isBook ? 2 : 1);
  const digital = sp.printMethod === 'دیجیتال';

  // ----- paper for body / flat product
  const body = findPaper(inventory, { kind: sp.textKind, gsm: sp.textGsm, cats: ['کاغذ', 'مقوا'] }, customerId);
  let sheet = [70, 100];
  if (body) { const ps = parseSheetSize(body.size); if (ps) sheet = ps; else warnings.push(`اندازه ورق «${body.name}» در انبار ثبت نشده؛ ۷۰×۱۰۰ فرض شد.`); }
  else warnings.push(`کاغذ ${sp.textKind || ''} ${sp.textGsm} گرم در انبار پیدا نشد؛ اندازه ورق ۷۰×۱۰۰ فرض شد. (کاغذ را در انبار ثبت کنید یا دستی انتخاب کنید.)`);

  const fit = pieceFit(sheet, trim[0], trim[1], c.sheetMarginCm);
  if (fit < 1) { errors.push(`قطع ${trim[0]}×${trim[1]} روی ورق ${sheet[0]}×${sheet[1]} جا نمی‌شود.`); return res; }

  let sheetsNet, forms, plates, pagesPerSheet = 0, sheetsPerCopy = 0, pagesRounded = pages;
  let pressSheet = sheet, pressForm = 0, platesPerColor = 0, leftoverPages = 0;
  let runWaste = runNumber(item.waste);
  if (runWaste === null) runWaste = isBook ? Math.max(0, Number(c.runWasteCopies) || 100) : 0;
  const runQty = qty + runWaste;
  let formPages = 0, platePages = 0, colorRanges = [], pressPlan = [], formDesc = '';
  let frontPages = 0, frontColors = 0;
  let textFormsExact = 1, textFormsFull = 1, textFormsCharged = 1, pressSheets = 0;
  let textBands = 0, bandsPer = 0;
  let bodyWaste = 0, bodyMakeReady = 0, bodyTotal = 0;
  if (isBook) {
    const cut = sp.sizeKey && sp.sizeKey !== 'سفارشی' ? sp.sizeKey : '';
    /* فرم‌بندی قطع: بانک یا تأیید همین سفارش؛ در غیر این صورت پرسش، نه حدس. */
    const cutPlan = bookCutPlan(sp);
    if (cutPlan.needed) {
      warnings.push(`${cutPlan.reason} چهار عدد فرم و ورق را در کارت «فرم‌بندی قطع» تأیید کنید؛ تا آن لحظه عددی ساخته نمی‌شود.`);
      res.waiting = [{ part: 'کاغذ متن', unit: 'ورق' }, { part: 'زینک متن', unit: 'زینک' }, { part: 'فرم متن', unit: 'فرم' }];
      return res;
    }
    const cutValues = cutPlan.values;
    const cutRow = findCut(bank(), cut);
    const pressRow = findPress(bank(), String(item.press || DEFAULT_PRESS));
    formPages = cutValues ? cutValues.formPages : (cutRow && cutRow.formPages > 0 ? cutRow.formPages : Math.max(4, foldable(fit) * 2));
    /* ظرفیت زینک از plateFactor ماشینِ بانک می‌آید؛ ماشین دیجیتال زینک ندارد، پس ظرفیت ماشین پیش‌فرض می‌نشیند. */
    const plateFactor = pressRow && pressRow.offset ? pressRow.plateFactor : findPress(bank(), DEFAULT_PRESS).plateFactor;
    platePages = Math.max(1, formPages * plateFactor);
    pagesPerSheet = cutValues ? cutValues.paperPages : (cutRow && cutRow.paperPages > 0 ? cutRow.paperPages : formPages * 2);
    let ps = ctx.pressSheet || (cutValues && cutValues.formSheet) || (cutRow && cutRow.formSheet) || (pressRow && pressRow.offset ? pressRow.sheet : null) || sheet;
    if (ps[0] * ps[1] > sheet[0] * sheet[1]) ps = sheet;
    pressSheet = ps;
    pressForm = formPages;
    /* بلوک رنگ: یک‌رنگ نیازی به پرسش ندارد؛ ۲ رنگ و بیشتر تا تأیید نشود، عدد ساخته نمی‌شود. */
    const plan = resolveColourPlan(sp, pages, textColors);
    if (!plan) {
      warnings.push('بلوک رنگ تأیید نشده است: همهٔ متن یک‌رنگ است یا بخشی از صفحه‌ها رنگ دیگری دارد؟ پیشنهاد در کارت «بلوک رنگ» نشسته؛ تأیید کنید.');
      res.waiting = [{ part: 'فرم متن', unit: 'فرم' }, { part: 'زینک متن', unit: 'زینک' }, { part: 'تیراژ چاپ', unit: 'نسخه' }];
      return res;
    }
    const specs = plan.ranges;
    if (!plan.uniform) {
      const bad = specs.find(r => !(r.from >= 1 && r.to <= pages && r.to >= r.from));
      if (bad) { errors.push('یکی از بلوک‌های رنگ خارج از محدودهٔ صفحه‌های کتاب است؛ بازه‌های «از/تا» را اصلاح کنید.'); return res; }
      const declared = specs.reduce((s, r) => s + r.pages, 0);
      if (declared !== pages) { errors.push(`جمع صفحه‌های بلوک‌های رنگی (${declared}) با تعداد صفحات (${pages}) برابر نیست؛ جمع باید دقیقاً ${pages} باشد.`); return res; }
    }
    const frontRange = specs.find(r => r.label === 'صفحه‌های اول' && r.colors !== textColors);
    frontPages = frontRange ? frontRange.pages : 0;
    frontColors = frontRange ? frontRange.colors : 0;
    colorRanges = specs.filter(r => r.pages > 0).map(r => {
      const exact = r.pages / formPages;
      const full = Math.floor(exact + 1e-9);
      const partial = r.pages - full * formPages;
      const charged = Math.ceil(exact - 1e-9);
      const perColor = Math.ceil(r.pages / platePages);
      return { label: r.label, pages: r.pages, colors: r.colors, exact: r2(exact), full, partial, charged, platesPerColor: perColor, plates: perColor * r.colors };
    });
    textFormsExact = r2(pages / formPages);
    textFormsFull = colorRanges.reduce((sum, r) => sum + r.full, 0);
    textFormsCharged = colorRanges.reduce((sum, r) => sum + r.charged, 0);
    const textPlates = colorRanges.reduce((sum, r) => sum + r.plates, 0);
    forms = textFormsCharged;
    plates = digital ? 0 : textPlates;
    platesPerColor = colorRanges.length === 1 ? colorRanges[0].platesPerColor : 0;
    leftoverPages = colorRanges.reduce((sum, r) => sum + r.partial, 0);
    sheetsPerCopy = r2(pages / pagesPerSheet);
    sheetsNet = Math.ceil((pages / pagesPerSheet) * qty);
    bodyWaste = Math.ceil((pages / pagesPerSheet) * runWaste);
    bodyMakeReady = 0;
    bodyTotal = Math.ceil((pages / pagesPerSheet) * runQty);
    for (const r of colorRanges) {
      if (r.full > 0) pressPlan.push({ label: `${r.full} فرم ${formPages} صفحه‌ای${r.label ? ` (${r.label})` : ''}`, forms: r.full, pages: formPages, sheets: r.full * runQty, workAndTurn: false, colors: r.colors });
      for (const chunk of runChunks(r.partial, formPages)) pressPlan.push({ label: `۱ فرم ${chunk} صفحه‌ای روی خودش دورو (${r.label || 'متن'})`, forms: 1, pages: chunk, sheets: Math.ceil((runQty * chunk) / formPages), workAndTurn: true, colors: r.colors });
    }
    pressSheets = pressPlan.reduce((sum, row) => sum + row.sheets, 0);
    formDesc = colorRanges.map(r => {
      const bits = [];
      if (r.full) bits.push(`${r.full} فرم ${formPages} صفحه‌ای کامل`);
      for (const chunk of runChunks(r.partial, formPages)) bits.push(`۱ فرم ${chunk} صفحه‌ای روی خودش دورو با تیراژ ${runRatioLabel(chunk, formPages)}`);
      return `${colorRanges.length > 1 ? `${r.colors} رنگ: ` : ''}${bits.join(' + ') || 'بدون فرم'}`;
    }).join(' | ');
    for (const r of colorRanges) {
      const rem = r.pages % formPages;
      if (formPages === 8 && rem !== 0 && rem !== 4) warnings.push(`${r.pages} صفحه بر فرم ۸ صفحه‌ای بخش‌پذیر نیست (${r.pages} ÷ ۸ = ${r2(r.exact)}); فقط نیم‌فرم ۴ صفحه‌ای پذیرفته است. تعداد صفحات را با مشتری نهایی کنید تا فرم اشتباه چاپ نشود.`);
    }
    if (frontPages && frontPages % platePages !== 0 && frontPages % formPages !== 0) warnings.push(`صفحه‌های رنگی اول (${frontPages} صفحه) روی نیم‌فرم ${platePages} صفحه‌ای نمی‌نشیند؛ رنگ‌پذیری را با مشتری نهایی کنید.`);
    steps.push(`قطع ${cut ? cut + ' ' : ''}(${trim[0]}×${trim[1]} سانتی‌متر) روی ورق ${sheet[0]}×${sheet[1]}: ${fit} قطعه در هر رو؛ هر ورق ${pagesPerSheet} صفحه و هر فرم ${formPages} صفحه.`);
    steps.push(`${pages} صفحه ÷ ${formPages} = ${r2(pages / formPages)} فرم${colorRanges.length > 1 ? ` — ${colorRanges.map(r => `${r.pages} صفحه ${r.colors} رنگ: ${r2(r.exact)} فرم، ${r.plates} زینک`).join(' | ')}` : `، ${textFormsCharged} فرم برای لیتوگرافی و صحافی`}.`);
    steps.push(`کاغذ متن: ${pages} ÷ ${pagesPerSheet} × (${qty} + ${runWaste} باطله) = ${bodyTotal.toLocaleString('en-US')} ورق (${sheetsNet.toLocaleString('en-US')} خالص + ${bodyWaste.toLocaleString('en-US')} باطله).`);
    if (pressPlan.length) steps.push(`دستور چاپ: ${pressPlan.map(p => `${p.forms > 1 ? `${p.forms} فرم ${p.pages} صفحه‌ای کامل پشت‌ورو` : `۱ فرم ${p.pages} صفحه‌ای روی خودش دورو`} ${p.sheets.toLocaleString('en-US')} ورق`).join(' + ')} (جمع ${pressSheets.toLocaleString('en-US')} ورق ماشین).`);
  } else {
    forms = 1;
    plates = digital ? 0 : textColors * textSides;
    sheetsNet = Math.ceil(qty / fit);
    sheetsPerCopy = r2(1 / fit);
    pagesPerSheet = fit;
    bodyWaste = Math.ceil(sheetsNet * c.wastePercent / 100);
    bodyMakeReady = digital ? 0 : c.makeReadyPerForm;
    bodyTotal = sheetsNet + bodyWaste + bodyMakeReady;
    formDesc = `${forms} فرم`;
    steps.push(`قطع ${trim[0]}×${trim[1]} روی ورق ${sheet[0]}×${sheet[1]}: ${fit} عدد در هر ورق → برای ${qty} عدد، ${sheetsNet} ورق.`);
    steps.push(`کاغذ مورد نیاز: ${sheetsNet.toLocaleString('en-US')} ورق خالص${bodyWaste ? ` + ${bodyWaste.toLocaleString('en-US')} ضایعات (${c.wastePercent}٪)` : ''} + ${bodyMakeReady.toLocaleString('en-US')} آماده‌سازی = ${bodyTotal.toLocaleString('en-US')} ورق.`);
    steps.push(digital ? 'چاپ دیجیتال: زینک لازم نیست.' : `زینک: ${forms} فرم × ${textColors} رنگ × ${textSides} رو = ${plates} قطعه.`);
  }
  const sheetsPerBand = body && body.unitMode === 'band_sheet' ? Number(body.sheetsPerBand) || 0 : 0;
  if (sheetsPerBand) { bandsPer = sheetsPerBand; textBands = r2(bodyTotal / sheetsPerBand); }

  res.numbers = {
    sheet, pressSheet, pressForm, platesPerColor, leftoverPages, fit, pagesPerSheet, pagesRounded, forms, sheetsPerCopy,
    textSheetsNet: sheetsNet, textWasteSheets: bodyWaste, textSheetsTotal: bodyTotal,
    textColors, textSides: isBook ? 2 : textSides, textPlates: plates, digital, qty, trim, textGsm: Number(sp.textGsm),
    runWaste, runQty, cut: sp.sizeKey || '', formPages: isBook ? formPages : 0, platePages: isBook ? platePages : 0,
    frontColorPages: isBook ? frontPages : 0, frontColors: isBook ? frontColors : 0,
    colorRanges, colorRangeLabel: colorRanges.filter(r => r.pages).map(r => `${r.colors} رنگ: ${r.plates}`).join(' | '),
    textFormsExact, textFormsFull, textFormsCharged, formDesc, pressPlan, pressSheets, textBands, bandsPer,
  };
  if (isBook) {
    const engCut = sp.sizeKey && sp.sizeKey !== 'سفارشی' ? sp.sizeKey : '';
    if ((lexicon.engineCatalog?.cuts ?? ENGINE_CUTS)[engCut]) {
      const eng = planBook({ cut: engCut, pages: pagesRounded, qty, waste: runWaste, press: digital ? 'دیجیتال' : String(item.press || DEFAULT_PRESS), colorRanges: colorRanges.filter(x => x.pages).map(x => ({ pages: x.pages, colors: x.colors })), textGsm: Number(sp.textGsm), caliperMm: Number(body && body.caliperMm) || undefined, leafFactor: c.leafThicknessFactor, spineExtraMm: 0, bleedCm: c.coverExtraCm / 2, catalog: lexicon.engineCatalog || undefined });
      if (eng.ok) res.numbers.engine = { forms: eng.forms, instructions: eng.forms.map(f => f.instruction), geometry: eng.coverGeometry, binding: eng.binding, plates: eng.plates };
    }
  }
  if (body) {
    res.invIds.text = body.id;
    const pq = paperQty(body, bodyTotal, sheet, Number(sp.textGsm));
    res.rows.papers.push({ inv: body, qty: pq.qty, unit: pq.unit });
    if (textBands) steps.push(`معادل ${textBands} بند (هر بند ${bandsPer} ورق) از «${body.name}».`);
  }

  // ----- cover / cellophane / zinc
  let totalPlates = plates;
  let coverSheetsNet = 0, coverTotal = 0, coverSheet = null, coverPlates = 0, cellArea = 0;
  const coverOn = isBook && sp.coverEnabled;
  /* سایز زینک = بزرگ‌ترین برگی که ماشینِ انتخابیِ همین سفارش روی زینک می‌گیرد (از بانک). */
  const orderPress = digital ? null : findPress(bank(), String(item.press || DEFAULT_PRESS));
  const zincSheet = orderPress && orderPress.offset && Array.isArray(orderPress.sheet) ? orderPress.sheet : null;
  const zincPressName = orderPress ? String(orderPress.name) : '';
  if (coverOn) {
    const cGsm = Number(sp.coverGsm) || c.defaultCoverGsm;
    if (!sp.coverGsm) warnings.push(`گرماژ جلد مشخص نبود؛ ${cGsm} گرم فرض شد.`);
    const realLeafMm = Number(body && body.caliperMm);
    const leafMm = realLeafMm > 0 ? realLeafMm : (Number(sp.textGsm) || 70) * c.leafThicknessFactor;
    const spine = r2((pagesRounded / 2) * leafMm / 10);
    const cw = r1(trim[0] * 2 + spine + c.coverExtraCm), ch = r1(trim[1] + c.coverExtraCm);
    const cp = findPaper(inventory, { kind: sp.coverKind, gsm: cGsm, cats: ['مقوا', 'کاغذ'] }, customerId);
    const registered = cp ? parseSheetSize(cp.size) : null;
    if (cp && !registered) warnings.push(`اندازه ورق «${cp.name}» در انبار ثبت نشده؛ ورق مادر بانک انتخاب می‌شود.`);
    if (!cp) warnings.push(`کاغذ/مقوای جلد (${sp.coverKind || ''} ${cGsm} گرم) در انبار پیدا نشد؛ ورق مادر بانک انتخاب می‌شود.`);
    /* قاعدهٔ کارفرما: جلد با همان ماشینِ انتخابی چاپ می‌شود. پس زنجیره این است:
       جلدِ باز + عطف ← چیدمان روی یک طرف زینکِ ماشین ← هر ورق مادر چند برگ ماشین می‌دهد ← تعداد جلد در هر ورق مادر. */
    const options = [];
    const addOption = (sheet, source) => {
      if (!Array.isArray(sheet) || !(sheet[0] > 0 && sheet[1] > 0)) return;
      if (options.some(o => o.sheet[0] === sheet[0] && o.sheet[1] === sheet[1])) return;
      const basis = zincSheet || sheet;
      const perZinc = pieceFit(basis, cw, ch, c.coverMarginCm);
      const zincsPerMother = zincSheet ? pieceFit(sheet, zincSheet[0], zincSheet[1], 0) : 1;
      options.push({ sheet, source, perZinc, zincsPerMother, perMother: perZinc * zincsPerMother });
    };
    if (registered) addOption(registered, `ورق ثبت‌شده در انبار${cp ? ` (${cp.name})` : ''}`);
    (bank().motherSheets || []).forEach(m => addOption(m.sheet, 'ورق مادر استاندارد بانک'));
    if (!options.length) { errors.push('اندازهٔ ورق مقوای جلد مشخص نیست؛ مقوای جلد را با سایز ورق در انبار ثبت کنید.'); return res; }
    /* ورقِ ثبت‌شده در انبار خریدِ واقعی است؛ ورق مادر فقط وقتی انتخاب می‌شود که انبار سایزی ثبت نکرده باشد. */
    const ranked = [...options].sort((a, b) => (b.perMother - a.perMother) || (a.sheet[0] * a.sheet[1] - b.sheet[0] * b.sheet[1]));
    const chosen = registered ? options.find(o => o.sheet[0] === registered[0] && o.sheet[1] === registered[1]) : ranked[0];
    if (registered && ranked[0].perMother > chosen.perMother) warnings.push(`با ورق مادر ${ranked[0].sheet.join('×')} به‌جای ${chosen.sheet.join('×')}، ${ranked[0].perMother} جلد در هر ورق می‌آید (الآن ${chosen.perMother})؛ برای کاغذ کم‌مصرف‌تر، مقوا را با همان سایز تهیه کنید.`);
    coverSheet = chosen.sheet;
    const cfit = chosen.perMother;
    if (cfit < 1) {
      errors.push(zincSheet && chosen.perZinc < 1
        ? `جلد باز (${cw}×${ch}) روی یک طرف زینکِ ماشین ${zincPressName} (${zincSheet.join('×')}) جا نمی‌شود؛ ماشینِ بزرگ‌تر لازم دارد یا ابعاد جلد را بررسی کنید.`
        : `جلد باز (${cw}×${ch}) روی ورق ${coverSheet[0]}×${coverSheet[1]} جا نمی‌شود.`);
      return res;
    }
    coverSheetsNet = Math.ceil(qty / cfit);
    coverTotal = Math.ceil(runQty / cfit);
    const coverWasteSheets = coverTotal - coverSheetsNet;
    const coverMachineSheets = coverTotal * chosen.zincsPerMother;
    const cColors = Number(sp.coverColors) || 4, cSides = Number(sp.coverSides) || 1;
    coverPlates = digital ? 0 : cColors * cSides; totalPlates += coverPlates;
    steps.push(`عطف کتاب ≈ ${spine} سانتی‌متر (${pages / 2} برگ × ${r2(leafMm)} میلی‌متر). ابعاد جلد باز: ${cw}×${ch} سانتی‌متر.`);
    steps.push(zincSheet
      ? `ماشین ${zincPressName} (زینک ${zincSheet.join('×')}): ${chosen.perZinc} جلد در هر طرف زینک و هر ورق مادر ${coverSheet.join('×')} ${chosen.zincsPerMother} برگ ماشین می‌دهد → ${cfit} جلد در هر ورق مادر.`
      : `${cfit} جلد در هر ورق ${coverSheet.join('×')} (دیجیتال: برگِ ماشین همان ورق است).`);
    steps.push(`کاغذ جلد: (${qty} + ${runWaste} باطله) ÷ ${cfit} = ${coverTotal.toLocaleString('en-US')} ورق ${coverSheet.join('×')} (${coverSheetsNet.toLocaleString('en-US')} خالص + ${coverWasteSheets.toLocaleString('en-US')} باطله) → دستور چاپ: ${coverMachineSheets.toLocaleString('en-US')} ورق ${zincSheet ? zincSheet.join('×') : coverSheet.join('×')} روی ماشین${zincSheet ? ` ${zincPressName}` : ''}؛ ${cColors} رنگ، ${cSides === 2 ? 'دورو' : 'یک‌رو'}.${digital ? '' : ` زینک جلد: ${cColors} رنگ × ${cSides} رو = ${coverPlates} قطعه.`}`);
    if (/سخت|گالینگور/.test(item.bindingType || '')) warnings.push('جلد سخت: مقوای خاکستری، پارچه و استر به‌صورت خودکار محاسبه نمی‌شوند.');
    if (cp) { res.invIds.cover = cp.id; const pq = paperQty(cp, coverTotal, coverSheet, cGsm); res.rows.coverPapers.push({ inv: cp, qty: pq.qty, unit: pq.unit }); }
    res.numbers.coverW = cw; res.numbers.coverH = ch; res.numbers.coverArea100 = r2(cw * ch / 100); res.numbers.coverFit = cfit; res.numbers.spine = spine; res.numbers.coverSheetsTotal = coverTotal; res.numbers.coverSheetsNet = coverSheetsNet; res.numbers.coverWasteSheets = coverWasteSheets; res.numbers.coverPlates = coverPlates; res.numbers.coverSheet = coverSheet; res.numbers.coverGsm = cGsm; res.numbers.coverColors = cColors; res.numbers.coverSides = cSides;
    res.numbers.coverZincSheet = zincSheet; res.numbers.coverPerZinc = chosen.perZinc; res.numbers.coverZincCount = chosen.zincsPerMother;
    res.numbers.coverMachineSheets = coverMachineSheets; res.numbers.coverPressName = zincPressName; res.numbers.coverSheetSource = chosen.source;
    // One printed line: the zinc count lives in the «زینک جلد» row, so it is not repeated here.
    res.numbers.coverRunLabel = zincSheet
      ? `${cColors} رنگ، ${cSides === 2 ? 'دورو' : 'یک‌رو'} — ماشین ${zincPressName} (زینک ${zincSheet.join('×')}): ${chosen.perZinc} جلد در هر طرف زینک`
      : `${cColors} رنگ، ${cSides === 2 ? 'دورو' : 'یک‌رو'} — دیجیتال: ${coverTotal.toLocaleString('en-US')} ورق ${coverSheet.join('×')} (${cfit} جلد در هر ورق)`;
  }
  if (sp.cellophane) {
    const sh = coverOn ? coverSheet : sheet;
    const sheetsForCello = coverOn ? coverTotal : bodyTotal;
    cellArea = r2((sh[0] * sh[1] / 10000) * sheetsForCello);
    steps.push(`سلفون ${sp.cellophane}: ${sheetsForCello.toLocaleString('en-US')} ورق × ${r2(sh[0] * sh[1] / 10000)} مترمربع = ${cellArea.toLocaleString('en-US')} مترمربع.`);
    const cands = inventory.filter(i => i.category === 'سلفون');
    const cello = cands.find(i => norm(i.name).includes(norm(sp.celloVariant || '')) && sp.celloVariant) || cands.find(i => norm(i.name).includes(norm(celloKindOf(sp))) && norm(i.name).includes(norm(sp.cellophane))) || cands.find(i => norm(i.name).includes(norm(sp.cellophane))) || cands[0];
    if (!cello) warnings.push('سلفون در انبار ثبت نشده است.');
    else {
      res.invIds.cello = cello.id;
      const unit = cello.simpleUnit;
      if (cello.unitMode === 'simple' && unit === 'متر مربع') res.rows.cellophane.push({ inv: cello, qty: cellArea, unit });
      else if (cello.unitMode === 'simple' && unit === 'متر') res.rows.cellophane.push({ inv: cello, qty: r2(cellArea / (c.cellophaneRollWidthCm / 100)), unit });
      else { warnings.push(`واحد موجودی سلفون «${cello.unitMode === 'roll_kg' ? 'کیلوگرم' : unit}» است و به مترمربع تبدیل نمی‌شود؛ مقدار مصرف را دستی وارد کنید (${cellArea} مترمربع).`); res.rows.cellophane.push({ inv: cello, qty: '', unit }); }
    }
    res.numbers.cellArea = cellArea; res.numbers.cellType = sp.cellophane; res.numbers.cellKind = celloKindOf(sp); res.numbers.cellVariant = sp.celloVariant || ''; res.numbers.cellLabel = celloLabel(sp);
  }
  const zinc = digital ? null : inventory.find(i => i.category === 'زینک' && stockOf(i) > 0) || inventory.find(i => i.category === 'زینک');
  res.numbers.zincSheet = zincSheet; res.numbers.zincPressName = zincPressName; res.numbers.zincRegistered = !!zinc;
  if (digital) { /* no plates */ }
  else if (zinc) { res.invIds.zinc = zinc.id; res.rows.litho.push({ inv: zinc, qty: totalPlates, unit: zinc.simpleUnit }); }
  else warnings.push('زینک در انبار ثبت نشده است.');
  if (isBook) {
    /* بند ۱۱: هر فرم متن (حتی نیم‌فرم) یک فرم صحافی است؛ جلد هم یک فرم. چسب گرم حداقل ۱۰ و مفتول حداقل ۴ فرم. */
    const binding = item.bindingType || '';
    const coverForms = coverOn ? 1 : 0;
    const textBindingForms = textFormsCharged;
    const rawForms = textBindingForms + coverForms;
    const hotMelt = /شومیز|چسب\s*گرم|چسبی/.test(binding);
    const wire = /منگنه|مفتول|سیمی|فنر/.test(binding);
    const minForms = hotMelt ? 10 : wire ? 4 : 0;
    const charged = Math.max(rawForms, minForms);
    res.numbers.bindingFormPages = formPages;
    res.numbers.bindingForms = rawForms;
    res.numbers.bindingFormsCharged = charged;
    res.numbers.bindingFormText = textBindingForms;
    res.numbers.bindingFormCover = coverForms;
    res.numbers.bindingMinForms = minForms;
    res.numbers.bindingRule = hotMelt ? 'چسب گرم — حداقل ۱۰ فرم' : wire ? 'مفتول/منگنه — حداقل ۴ فرم' : '';
    steps.push(`فرم صحافی: ${textBindingForms} فرم متن + ${coverForms} فرم جلد = ${rawForms} فرم${minForms && rawForms < minForms ? `؛ کمتر از حداقل ${minForms} فرم است و ${charged} فرم محاسبه می‌شود` : ''} × تیراژ ${runQty.toLocaleString('en-US')} نسخه.`);
  }
  res.numbers.totalPlates = totalPlates;
  if (!digital) steps.push(`جمع زینک: ${totalPlates} قطعه.`);
  res.ok = true;
  return res;
}

/* ---------- cost estimate (shown only in the Finance tab) ---------- */
export const costContext = { units: null, priceEntry: null, entryHasPrice: null, entryHasTiers: null };
function unitPick(kind, pred) {
  const u = costContext.units && costContext.units[kind];
  if (!u || !costContext.priceEntry) return null;
  const list = (u.items || []).filter(e => e.active !== false && costContext.entryHasPrice(e));
  return list.find(pred) || null;
}
const nz = (v) => normalizeDigits(v || '').toLowerCase();
const PRESS_KEYS = { 'GTO': ['gto'], '2 ورقی': ['2 ورقی', 'sm 74'], '4.5 ورقی': ['4.5 ورقی', 'cd 102', 'sm 102'] };
const BINDING_KEYS = [
  [/شومیز|چسب گرم/, 'چسب گرم'], [/گالینگور|جلد سخت/, 'گالینگور'], [/منگنه|مفتولی|سیمی/, 'منگنه'], [/فنر/, 'فنر'], [/برش/, 'برش'],
];
function sheetPrice(inv, sheetSize, gsm, materialRates) {
  // Explicit selling rate per inventory unit (band or kg), never warehouse value.
  if (!Object.prototype.hasOwnProperty.call(materialRates, inv.id)) return null;
  const raw = materialRates[inv.id];
  if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '') return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  if (inv.unitMode === 'band_sheet') { const spb = Number(inv.sheetsPerBand); return Number.isFinite(spb) && spb > 0 ? v / spb : null; }
  if (inv.unitMode === 'roll_kg' && Array.isArray(sheetSize) && sheetSize.length === 2 && sheetSize.every(x => Number.isFinite(Number(x)) && Number(x) > 0) && Number.isFinite(Number(gsm)) && Number(gsm) > 0) return v * (sheetSize[0] / 100) * (sheetSize[1] / 100) * gsm / 1000;
  return null;
}
export function estimateCost(item, inventory, settings, { materialRates = {} } = {}) {
  const a = item.analysis;
  if (!a || !a.ok) return null;
  const c = settings.calc, n = a.numbers;
  const get = (id) => inventory.find(i => i.id === id);
  const lines = [], errors = [];
  const add = (label, amount, note, kind = 'service') => lines.push({ label, amount: Math.round(amount), note: note || '', kind });
  const addMaterial = (label, inv, sheets, size, gsm) => {
    if (sheets === 0) { add(label, 0, 'بدون مصرف', 'material'); return; }
    if (inv?.ownerType === 'مشتری') { add(label, 0, 'متعلق به مشتری', 'material'); return; }
    const rate = inv ? sheetPrice(inv, size, gsm, materialRates || {}) : null;
    if (rate === null) {
      const note = inv ? 'نرخ روز معتبر برای واحد این کالا ثبت نشده' : 'کالا در انبار انتخاب نشده';
      errors.push(`${label}: ${note}`);
      add(label, 0, note, 'material');
    } else add(label, sheets * rate, `${sheets.toLocaleString('en-US')} ورق (نرخ روز)`, 'material');
  };
  const text = get(a.invIds.text);
  addMaterial('کاغذ متن', text, n.textSheetsTotal, n.sheet, n.textGsm);
  if (n.coverSheetsTotal) {
    const cv = get(a.invIds.cover);
    addMaterial('کاغذ/مقوای جلد', cv, n.coverSheetsTotal, n.coverSheet, n.coverGsm);
  }
  const zinc = get(a.invIds.zinc);
  const plateUnit = zinc && Number(zinc.unitValue) > 0 ? Number(zinc.unitValue) : c.plateCostFallback;
  const pressKeys = PRESS_KEYS[item.press] || [];
  if (!n.digital) {
    const le = unitPick('litho', e => pressKeys.some(k => nz(e.name).includes(k)));
    if (le) { const r = costContext.priceEntry(le, { plates: n.totalPlates, forms: n.forms }, 'litho'); add(`زینک — ${le.name}`, r.amount, r.ok ? `${n.totalPlates} قطعه (فرمول واحد لیتوگرافی)` : `خطای فرمول: ${r.error}`); }
    else {
      add('زینک', n.totalPlates * plateUnit, `${n.totalPlates} قطعه${plateUnit ? '' : ' (قیمت زینک در انبار/تنظیمات ثبت نشده)'}`);
    }
  }
  const impressions = n.textSheetsTotal * n.textColors * n.textSides + (n.coverSheetsTotal ? n.coverSheetsTotal * n.coverColors * n.coverSides : 0);
  const totalSheets = n.textSheetsTotal + (n.coverSheetsTotal || 0);
  if (n.digital) {
    const sides = n.textSheetsTotal * n.textSides + (n.coverSheetsTotal ? n.coverSheetsTotal * n.coverSides : 0);
    const de = unitPick('digital', e => (e.kind === 'ماشین چاپ') && (!item.spec || !item.spec.machineId || e.id === item.spec.machineId) && (!(Number(e.colors) > 0) || Number(e.colors) >= n.textColors));
    if (de) { const r = costContext.priceEntry(de, { qty: n.qty, sheets: totalSheets, netSheets: n.textSheetsNet, sides: n.textSides, impressions: sides, forms: n.forms }, 'digital'); add(`چاپ دیجیتال — ${de.name}`, r.amount, r.ok ? `${sides.toLocaleString('en-US')} رو (فرمول واحد دیجیتال)` : `خطای فرمول: ${r.error}`); }
    else add('چاپ دیجیتال', sides * c.digitalRatePerSide, `${sides.toLocaleString('en-US')} رو${c.digitalRatePerSide ? '' : ' (نرخ چاپ دیجیتال در تنظیمات ثبت نشده)'}`);
  } else {
    const chosen = item.spec && item.spec.machineId;
    const oe = unitPick('offset', e => chosen ? e.id === chosen : (pressKeys.some(k => nz(e.name).includes(k)) && Number(e.colors) >= n.textColors))
      || (chosen ? null : unitPick('offset', e => pressKeys.some(k => nz(e.name).includes(k))));
    if (oe && costContext.entryHasTiers && costContext.entryHasTiers(oe)) {
      // قاعده‌ی چاپخانه: برای هر زینک یک دور چاپ؛ قیمت هر دور طبق پلکان تیراژ همین ماشین
      const base = { qty: n.qty, run: n.qty, sheets: totalSheets, netSheets: n.textSheetsNet, colors: n.textColors, sides: n.textSides, impressions };
      const r = costContext.priceEntry(oe, { ...base, plates: n.textPlates, forms: n.forms }, 'offset');
      add(`چاپ متن — ${oe.name}`, r.amount, r.ok ? `${n.textPlates} زینک × قیمت دور برای تیراژ ${n.qty.toLocaleString('en-US')} (پلکان ماشین)` : `خطای فرمول: ${r.error}`);
      if (n.coverPlates) { const rc = costContext.priceEntry(oe, { ...base, plates: n.coverPlates, forms: 1, colors: n.coverColors, sides: n.coverSides }, 'offset', { cover: true }); add(`چاپ جلد — ${oe.name}`, rc.amount, rc.ok ? `${n.coverPlates} زینک جلد × قیمت دور برای تیراژ ${n.qty.toLocaleString('en-US')}` : `خطای فرمول: ${rc.error}`); }
    } else if (oe) { const r = costContext.priceEntry(oe, { qty: n.qty, sheets: totalSheets, netSheets: n.textSheetsNet, forms: n.forms, colors: n.textColors, sides: n.textSides, impressions }, 'offset'); add(`چاپ — ${oe.name}`, r.amount, r.ok ? `${impressions.toLocaleString('en-US')} دور رنگ (فرمول واحد افست)` : `خطای فرمول: ${r.error}`); }
    else add('چاپ', impressions / 1000 * c.printRatePer1000, `${impressions.toLocaleString('en-US')} دور رنگ${c.printRatePer1000 ? '' : ' (نرخ چاپ در تنظیمات ثبت نشده)'}`);
  }
  if (n.cellArea) {
    const ce = unitPick('binding', e => nz(e.name).includes('سلفون') && n.cellVariant && nz(e.name).includes(nz(n.cellVariant))) || unitPick('binding', e => nz(e.name).includes('سلفون') && nz(e.name).includes(nz(n.cellKind || 'حرارتی')) && nz(e.name).includes(nz(n.cellType))) || unitPick('binding', e => nz(e.name).includes('سلفون') && nz(e.name).includes(nz(n.cellType)));
    const coverArea = n.coverArea100 || (n.trim ? Math.round(n.trim[0] * n.trim[1]) / 100 : 0);
    if (ce) { const r = costContext.priceEntry(ce, { qty: n.qty, area: n.cellArea, sheets: totalSheets, coverArea, coverAreaCm2: Math.round((n.coverW || 0) * (n.coverH || 0) * 100) / 100 }, 'binding'); add(`سلفون ${n.cellLabel || n.cellType}`, r.amount, r.ok ? `گسترده‌ی جلد ${coverArea} (طول×عرض÷۱۰۰) × تیراژ ${n.qty.toLocaleString('en-US')} (فرمول واحد صحافی)` : `خطای فرمول: ${r.error}`); }
    else { const rate = c.cellophaneRate[n.cellType] || 0; add(`سلفون ${n.cellLabel || n.cellType}`, n.cellArea * rate, `${n.cellArea} مترمربع${rate ? '' : ' (نرخ در تنظیمات ثبت نشده)'}`); }
  }
  const br = Number(c.bindingRates[item.bindingType]) || 0;
  if (item.bindingType && item.bindingType !== 'بدون صحافی') {
    const bk = (BINDING_KEYS.find(([re]) => re.test(item.bindingType)) || [])[1];
    const be = bk && unitPick('binding', e => nz(e.name).includes(bk));
    if (be) { const r = costContext.priceEntry(be, { qty: n.qty, pages: n.pagesRounded, forms: n.forms, sheets: totalSheets, bindForms: n.bindingFormsCharged || n.bindingForms || 0 }, 'binding'); add(`صحافی — ${item.bindingType}`, r.amount, r.ok ? `${n.bindingFormsCharged ? `${n.bindingFormsCharged} فرم صحافی × ` : ''}${n.qty.toLocaleString('en-US')} نسخه (فرمول واحد صحافی)` : `خطای فرمول: ${r.error}`); }
    else add(`صحافی — ${item.bindingType}`, br * n.qty, br ? `${n.qty.toLocaleString('en-US')} نسخه` : '(نرخ صحافی در تنظیمات ثبت نشده)');
  }
  if (Array.isArray(item.finishingSteps) && item.finishingSteps.length && costContext.priceEntry) {
    const bindsCut = /برش/.test(item.bindingType || '');
    item.finishingSteps.forEach(step => {
      const key = FINISHING_UNIT_KEY[step];
      if (!key || (step === 'برش' && bindsCut)) return;
      const fe = unitPick('binding', e => nz(e.name).includes(nz(key)));
      if (!fe) { add(`تکمیلی — ${step}`, 0, '(نرخ این مرحله در واحد صحافی ثبت نشده)'); return; }
      const r = costContext.priceEntry(fe, { qty: n.qty, pages: n.pagesRounded, forms: n.forms, sheets: totalSheets, bindForms: n.bindingFormsCharged || n.bindingForms || 0 }, 'binding');
      add(`تکمیلی — ${step}`, r.amount, r.ok ? (r.amount ? `${n.qty.toLocaleString('en-US')} نسخه (فرمول واحد صحافی)` : '(نرخ این مرحله در واحد صحافی ثبت نشده)') : `خطای فرمول: ${r.error}`);
    });
  }  /* برون‌سپاری: هزینه‌ی داخلی همان مرحله حذف و هزینه‌ی پیمانکار جایگزین می‌شود */
  const plan = item.plan;
  let linesOut = lines;
  if (plan && costContext.units && costContext.priceEntry) {
    const SKIP = { litho: /^زینک/, print: /^چاپ/, binding: /^(صحافی|سلفون|تکمیلی)/ };
    const method = n.digital ? 'digital' : 'offset';
    const ctxAll = { qty: n.qty, run: n.qty, pages: n.pagesRounded, forms: n.forms, plates: n.totalPlates, sheets: totalSheets, netSheets: n.textSheetsNet, colors: n.textColors, sides: n.textSides, impressions, area: n.cellArea || 0, hours: 1, amount: n.qty, bindForms: n.bindingFormsCharged || 0, coverArea: n.coverArea100 || 0, coverAreaCm2: Math.round((n.coverW || 0) * (n.coverH || 0) * 100) / 100 };
    const extra = [];
    [['design', 'design', 'طراحی'], ['litho', 'litho', 'لیتوگرافی'], ['print', method, 'چاپ'], ['binding', 'binding', 'صحافی و تکمیلی']].forEach(([step, unitKey, label]) => {
      const st = plan[step];
      if (!st || st.mode !== 'برون‌سپاری') return;
      const partner = ((costContext.units[unitKey] || {}).outsource || []).find(p => p.id === st.partnerId);
      if (!partner) { if (SKIP[step]) linesOut = linesOut.filter(l => !SKIP[step].test(l.label)); extra.push({ label: `برون‌سپاری ${label}`, amount: 0, note: 'پیمانکار انتخاب نشده یا نرخ ندارد', kind: 'service' }); return; }
      const r = costContext.priceEntry(partner, ctxAll, unitKey, { partner: true });
      if (SKIP[step]) linesOut = linesOut.filter(l => !SKIP[step].test(l.label));
      extra.push({ label: `برون‌سپاری ${label} — ${partner.name}`, amount: r.amount, note: r.ok ? 'طبق نرخ/فرمول پیمانکار' : `خطای فرمول: ${r.error}`, kind: 'service' });
    });
    linesOut = [...linesOut, ...extra];
  }
  if (linesOut.some(l => l.label === 'زینک') && n.totalPlates > 0 && !(Number.isFinite(Number(plateUnit)) && Number(plateUnit) > 0)) errors.push('نرخ زینک در انبار/تنظیمات ثبت نشده');
  const total = linesOut.reduce((s, l) => s + l.amount, 0);
  const materialTotal = linesOut.filter(l => l.kind === 'material').reduce((s, l) => s + l.amount, 0);
  const serviceTotal = total - materialTotal;
  const marginAmount = serviceTotal * (Number(c.marginPercent) || 0) / 100;
  const complete = errors.length === 0;
  const suggestedTotal = complete ? Math.round(total + marginAmount) : null;
  const suggestedUnit = complete ? (n.qty ? Math.round(suggestedTotal / n.qty / 100) * 100 : 0) : null;
  return { lines: linesOut, total, materialTotal, serviceTotal, marginAmount, complete, errors, suggestedTotal, suggestedUnit, qty: n.qty };
}
