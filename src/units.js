/* واحدهای تولید: داده‌ی پایه‌ی ماشین‌آلات و خدمات هر واحد + موتور فرمول قیمت.
   هیچ قیمتی از پیش پر نشده است؛ مدیر چاپخانه نرخ‌ها را وارد می‌کند. بدون eval — فرمول‌ها با تجزیه‌گر امن ارزیابی می‌شوند. */
import { normalizeDigits } from './smart.js';

/* ---------- متغیرهای فرمول ---------- */
export const FORMULA_VARS = [
  { key: 'تیراژ', en: 'qty', label: 'تیراژ (تعداد نسخه/عدد)' },
  { key: 'ورق', en: 'sheets', label: 'تعداد کل ورق (با ضایعات و آماده‌سازی)' },
  { key: 'ورق_خالص', en: 'netSheets', label: 'ورق خالص (بدون ضایعات)' },
  { key: 'فرم', en: 'forms', label: 'تعداد فرم' },
  { key: 'زینک', en: 'plates', label: 'تعداد زینک' },
  { key: 'رنگ', en: 'colors', label: 'تعداد رنگ' },
  { key: 'رو', en: 'sides', label: 'تعداد رو (۱ یا ۲)' },
  { key: 'دور', en: 'impressions', label: 'دور چاپ (ورق × رنگ × رو)' },
  { key: 'صفحه', en: 'pages', label: 'تعداد صفحات' },
  { key: 'متر_مربع', en: 'area', label: 'مساحت (متر مربع)' },
  { key: 'متر', en: 'meters', label: 'طول (متر)' },
  { key: 'ساعت', en: 'hours', label: 'ساعت کار' },
  { key: 'مقدار', en: 'amount', label: 'مقدار دلخواه (عدد، قطعه، ...)' },
  { key: 'نرخ', en: 'rate', label: 'نرخ واحد همین ردیف' },
  { key: 'راه_اندازی', en: 'setup', label: 'هزینه‌ی راه‌اندازی/آماده‌سازی همین ردیف' },
  { key: 'حداقل', en: 'minCharge', label: 'حداقل مبلغ همین ردیف' },
  { key: 'اجزا', en: 'parts', label: 'جمع قیمت اجزای فعال همین ردیف' },
  { key: 'پله', en: 'tier', label: 'قیمت هر دور چاپ (برای هر زینک) طبق پلکان تیراژ همین ماشین' },
  { key: 'فرم_صحافی', en: 'bindForms', label: 'تعداد فرم صحافی (شامل جلد؛ حداقل ۱۰ فرم)' },
  { key: 'مساحت_جلد', en: 'coverArea', label: 'مساحت گسترده‌ی جلد (طول × عرض ÷ ۱۰۰)' },
  { key: 'مساحت_جلد_سانتیمتر', en: 'coverAreaCm2', label: 'مساحت گسترده‌ی جلد (سانتی‌متر مربع)' },
];
const EN_TO_FA = Object.fromEntries(FORMULA_VARS.map(v => [v.en.toLowerCase(), v.key]));
export const FORMULA_FUNCS = [
  { fa: 'سقف', en: 'ceil', desc: 'گرد به بالا' }, { fa: 'کف', en: 'floor', desc: 'گرد به پایین' }, { fa: 'گرد', en: 'round', desc: 'گرد معمولی' },
  { fa: 'بیشینه', en: 'max', desc: 'بزرگ‌تر' }, { fa: 'کمینه', en: 'min', desc: 'کوچک‌تر' }, { fa: 'قدرمطلق', en: 'abs', desc: 'قدر مطلق' },
  { fa: 'ریشه', en: 'sqrt', desc: 'جذر' }, { fa: 'اگر', en: 'if', desc: 'اگر(شرط، مقدار۱، مقدار۲)' },
];
const FUNCS = {
  ceil: (a) => Math.ceil(a), floor: (a) => Math.floor(a), round: (a) => Math.round(a), abs: (a) => Math.abs(a), sqrt: (a) => Math.sqrt(a),
  max: (...a) => Math.max(...a), min: (...a) => Math.min(...a), if: (c, a, b) => (c ? a : b),
};
const FUNC_ALIAS = Object.fromEntries(FORMULA_FUNCS.flatMap(f => [[f.fa, f.en], [f.en, f.en]]));

function tokenize(src) {
  const s = normalizeDigits(src).replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/،/g, ',').replace(/٬/g, '');
  const out = []; let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; const n = Number(s.slice(i, j)); if (isNaN(n)) throw new Error(`عدد نامعتبر: ${s.slice(i, j)}`); out.push({ t: 'num', v: n }); i = j; continue; }
    if (/[A-Za-z_\u0600-\u06FF\u200c]/.test(ch)) { let j = i; while (j < s.length && /[A-Za-z0-9_\u0600-\u06FF\u200c]/.test(s[j])) j++; out.push({ t: 'id', v: s.slice(i, j).replace(/\u200c/g, '_') }); i = j; continue; }
    const two = s.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '<>'].includes(two)) { out.push({ t: 'op', v: two === '<>' ? '!=' : two }); i += 2; continue; }
    if ('+-*/()<>,%^'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new Error(`نویسه‌ی نامعتبر: ${ch}`);
  }
  return out;
}

export function evalFormula(formula, vars) {
  try {
    const toks = tokenize(String(formula || ''));
    if (!toks.length) return { ok: false, error: 'فرمول خالی است.' };
    let p = 0;
    const peek = () => toks[p];
    const eat = (v) => { const t = toks[p]; if (t && t.t === 'op' && t.v === v) { p++; return true; } return false; };
    const lookup = (name) => {
      if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
      const fa = EN_TO_FA[name.toLowerCase()];
      if (fa && Object.prototype.hasOwnProperty.call(vars, fa)) return vars[fa];
      throw new Error(`متغیر ناشناخته: ${name}`);
    };
    function cmp() {
      let a = add();
      for (;;) {
        const t = peek();
        if (t && t.t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(t.v)) {
          p++; const b = add();
          a = t.v === '>' ? +(a > b) : t.v === '<' ? +(a < b) : t.v === '>=' ? +(a >= b) : t.v === '<=' ? +(a <= b) : t.v === '==' ? +(a === b) : +(a !== b);
        } else return a;
      }
    }
    function add() { let a = mul(); for (;;) { if (eat('+')) a += mul(); else if (eat('-')) a -= mul(); else return a; } }
    function mul() {
      let a = pow();
      for (;;) {
        if (eat('*')) a *= pow();
        else if (eat('/')) { const b = pow(); if (b === 0) throw new Error('تقسیم بر صفر'); a /= b; }
        else if (eat('%')) { const b = pow(); if (b === 0) throw new Error('تقسیم بر صفر'); a %= b; }
        else return a;
      }
    }
    function pow() { const a = unary(); if (eat('^')) return Math.pow(a, pow()); return a; }
    function unary() { if (eat('-')) return -unary(); if (eat('+')) return unary(); return primary(); }
    function primary() {
      const t = toks[p];
      if (!t) throw new Error('فرمول ناقص است.');
      if (t.t === 'num') { p++; return t.v; }
      if (t.t === 'op' && t.v === '(') { p++; const v = cmp(); if (!eat(')')) throw new Error('پرانتز بسته نشده است.'); return v; }
      if (t.t === 'id') {
        p++;
        if (toks[p] && toks[p].t === 'op' && toks[p].v === '(') {
          const fn = FUNC_ALIAS[t.v] || FUNC_ALIAS[t.v.toLowerCase()];
          if (!fn) throw new Error(`تابع ناشناخته: ${t.v}`);
          p++; const args = [];
          if (!eat(')')) { do { args.push(cmp()); } while (eat(',')); if (!eat(')')) throw new Error('پرانتز تابع بسته نشده است.'); }
          return FUNCS[fn](...args);
        }
        return Number(lookup(t.v)) || 0;
      }
      throw new Error('ساختار فرمول نامعتبر است.');
    }
    const v = cmp();
    if (p < toks.length) throw new Error('بخش اضافه در انتهای فرمول.');
    if (!isFinite(v)) throw new Error('نتیجه عدد معتبر نیست.');
    return { ok: true, value: v };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

/* ---------- فرمول پیش‌فرض هر واحد ---------- */
export const DEFAULT_FORMULAS = {
  design: 'ساعت * نرخ + راه_اندازی',
  litho: 'زینک * اجزا + راه_اندازی',
  digital: 'بیشینه(حداقل, ورق * رو * نرخ) + راه_اندازی',
  offset: 'بیشینه(حداقل, دور / 1000 * نرخ) + فرم * راه_اندازی',
  binding: 'تیراژ * نرخ + راه_اندازی',
};
/* فرمول پیش‌فرض پیمانکار برون‌سپاری (اجزا ندارد، پس مستقیم از نرخ می‌خواند) */
export const PARTNER_FORMULAS = { litho: 'زینک * نرخ + راه_اندازی', design: 'نرخ + راه_اندازی' };
export const TIER_FORMULA = 'زینک * پله + فرم * راه_اندازی';
/* پلکان قیمت هر دور چاپ (هر زینک): تا تیراژ X قیمت Y؛ بالاتر از آخرین پله به نسبت (قیمت آخرین پله × تیراژ ÷ سقف آخرین پله) */
export function normTierList(tiers) {
  return (tiers || []).map(t => ({ upTo: Number(String(t.upTo ?? '').replace(/,/g, '')) || 0, price: Number(String(t.price ?? '').replace(/,/g, '')) || 0 })).filter(t => t.upTo > 0 && t.price > 0).sort((a, b) => a.upTo - b.upTo);
}
export function tierPrice(tiers, run) {
  const t = normTierList(tiers); const r = Number(run) || 0;
  if (!t.length || r <= 0) return 0;
  for (const x of t) if (r <= x.upTo) return x.price;
  const last = t[t.length - 1];
  return last.price * r / last.upTo;
}
export const entryHasTiers = (e) => normTierList(e && e.tiers).length > 0;
export const UNIT_ORDER = ['design', 'litho', 'digital', 'offset', 'binding'];
export const UNIT_META = {
  design: {
    title: 'واحد طراحی',
    vars: ['ساعت', 'مقدار', 'صفحه', 'نرخ', 'راه_اندازی', 'حداقل'],
    sample: { ساعت: 3, مقدار: 1, صفحه: 100 },
    defaultDescription: 'واحد طراحی فایل مشتری را آماده‌ی چاپ می‌کند: صفحه‌آرایی، طراحی جلد و کارت و لوگو، ویرایش و اصلاح فایل، آماده‌سازی نهایی (پری‌پرس) و پروف. هزینه‌ی این واحد دستمزد طراح است؛ ساعتی، به‌ازای هر صفحه یا به‌صورت پروژه‌ای. اگر مشتری فایل آماده بدهد، این بخش از سفارش حذف می‌شود و از هزینه‌ی نهایی کم می‌شود.',
    outsourceWhy: 'اگر طراح داخلی مشغول است یا کار تخصصی (تصویرسازی، لوگو) است، طراحی به فریلنسر یا استودیوی بیرونی سپرده می‌شود.',
  },
  litho: {
    title: 'واحد لیتوگرافی',
    vars: ['زینک', 'فرم', 'اجزا', 'نرخ', 'راه_اندازی', 'حداقل'],
    sample: { زینک: 8, فرم: 2, ورق: 2000 },
    defaultDescription: 'لیتوگرافی فایل نهایی را فرم‌بندی (ایمپوزیشن) می‌کند و زینک چاپ را می‌سازد: خام زینک، کپی و ظهور یا لیزر (CTP) و فرم‌بندی. هر ردیف یک نوع زینک/خروجی است و هزینه‌اش از چند جزء ساخته می‌شود. اگر مشتری زینک یا فیلم آماده داشته باشد، جزء مربوط را در سفارش خاموش می‌کنید تا از مبلغ نهایی کم شود. تعداد زینک مصرف‌شده و هزینه‌اش در بخش لیتوگرافی فرم سفارش چاپ می‌آید.',
    outsourceWhy: 'اگر دستگاه خراب است، اپراتور نیست یا زینک خام ندارید، کار مشتری نباید معطل بماند؛ زینک را از لیتوگرافی بیرونی می‌گیرید و هزینه‌اش را از اینجا حساب می‌کنید.',
  },
  digital: {
    title: 'واحد چاپ دیجیتال',
    vars: ['ورق', 'رو', 'تیراژ', 'متر_مربع', 'متر', 'مقدار', 'نرخ', 'راه_اندازی', 'حداقل'],
    sample: { ورق: 500, رو: 2, تیراژ: 500, متر_مربع: 4, متر: 3, مقدار: 100 },
    defaultDescription: 'چاپ دیجیتال بدون زینک و با راه‌اندازی سریع، مناسب تیراژ کم و کار فوری. شامل دستگاه‌های سیاه‌وسفید و رنگی، پلاتر، و خدمات پیوسته مثل سلفون (لمینت)، برش، چسب گرم، طلاکوب، پانچ، فنر و لیبل/DTF. برای هر دستگاه یا خدمت، واحد قیمت، نرخ و هزینه‌ی متریال را ثبت کنید یا فرمول بنویسید.',
    outsourceWhy: 'اگر دستگاه خراب است یا قطع/جنس کار از توان دستگاه‌های شما خارج است (مثلاً پلاتر بزرگ یا DTF)، کار به مرکز دیجیتال بیرونی سپرده می‌شود.',
  },
  offset: {
    title: 'واحد چاپ افست',
    vars: ['زینک', 'پله', 'دور', 'ورق', 'فرم', 'رنگ', 'رو', 'تیراژ', 'نرخ', 'راه_اندازی', 'حداقل'],
    sample: { زینک: 100, دور: 16000, ورق: 2000, فرم: 20, رنگ: 2, رو: 2, تیراژ: 2000 },
    defaultDescription: 'چاپ افست برای تیراژ متوسط و بالا با کیفیت بالا. هر ماشین بر اساس تعداد رنگ، قطع ورق و پشت‌ورو بودن (دو رو در یک عبور) فرق می‌کند. هزینه‌ی چاپ برای هر زینک یک «دور چاپ» است و قیمت هر دور بر اساس تیراژ پله‌ای است (مثلاً تا ۱۰۰۰، ۲۰۰۰، ۳۰۰۰ و ۵۰۰۰؛ بالاتر از آن به نسبت ۵۰۰۰). پلکان هر ماشین را در همان ردیف («فرمول» ← پلکان قیمت هر دور) وارد کنید؛ اگر پلکان ندارد، فرمول یا نرخ هر هزار دور به کار می‌رود.',
    outsourceWhy: 'اگر ماشین مناسب قطع کار را ندارید، ماشین مشغول یا خراب است، یا تیراژ از ظرفیت شما بیشتر است، چاپ به چاپخانه‌ی بیرونی سپرده می‌شود.',
  },
  binding: {
    title: 'واحد صحافی و خدمات تکمیلی',
    vars: ['تیراژ', 'فرم_صحافی', 'مساحت_جلد', 'مساحت_جلد_سانتیمتر', 'صفحه', 'فرم', 'ورق', 'متر_مربع', 'مقدار', 'نرخ', 'راه_اندازی', 'حداقل'],
    sample: { تیراژ: 1000, فرم_صحافی: 21, مساحت_جلد: 8.75, مساحت_جلد_سانتیمتر: 875, صفحه: 320, فرم: 20, ورق: 2000, متر_مربع: 300, مقدار: 1000 },
    defaultDescription: 'صفحات چاپ‌شده را به محصول نهایی تبدیل می‌کند: برش، تا، ترتیب، منگنه، چسب گرم، دوخت، جلدسازی، فنر و سیم، و خدمات تکمیلی مثل سلفون، یووی، فویل‌کوبی، قالب‌زنی و جعبه‌سازی. قیمت صحافی چسب گرم و مفتولی: تعداد فرم (هر ۱۶ صفحه، برای رحلی هر ۸ صفحه، به‌علاوه‌ی ۱ فرم جلد، حداقل ۱۰ فرم) × نرخ هر فرم × تیراژ. سلفون: مساحت گسترده‌ی جلد (طول × عرض ÷ ۱۰۰) × تعرفه‌ی روز × تیراژ. برای حالت‌های دیگر فرمول بنویسید.',
    outsourceWhy: 'اگر دستگاه خدمات خاص (مثل دوخت، گالینگور، یووی یا جعبه‌سازی) را ندارید، آن بخش به صحافی یا مجموعه‌ی بیرونی سپرده می‌شود.',
  },
};

/* ---------- فهرست آماده (از مشخصات منتشرشده‌ی سازندگان/آگهی‌ها؛ مقادیر تقریبی را با دستگاه خودتان تطبیق دهید) ---------- */
const E = (name, kind, extra = {}) => ({ name, kind, notes: '', w: '', h: '', colors: '', perfecting: false, unit: '', components: [], ...extra });
export const PRESETS = {
  design: [
    E('طراحی گرافیک (ساعتی)', 'طراحی', { unit: 'ساعت' }),
    E('صفحه‌آرایی کتاب و مجله', 'صفحه‌آرایی', { unit: 'صفحه', formula: 'صفحه * نرخ + راه_اندازی' }),
    E('طراحی جلد', 'طراحی', { unit: 'پروژه', formula: 'نرخ + راه_اندازی' }),
    E('طراحی کارت ویزیت / سربرگ / پاکت', 'طراحی', { unit: 'پروژه', formula: 'نرخ + راه_اندازی' }),
    E('طراحی لوگو و هویت بصری', 'طراحی', { unit: 'پروژه', formula: 'نرخ + راه_اندازی' }),
    E('ویرایش و اصلاح فایل مشتری', 'اصلاح فایل', { unit: 'ساعت' }),
    E('تصویرسازی و ایلاستریشن', 'طراحی', { unit: 'ساعت' }),
    E('آماده‌سازی فایل برای چاپ (پری‌پرس)', 'پری‌پرس', { unit: 'ساعت' }),
    E('پروف رنگی', 'پروف', { unit: 'عدد', formula: 'مقدار * نرخ + راه_اندازی' }),
  ],
  litho: [
    E('پلیت‌ستر CTP (حرارتی) — خروجی مستقیم زینک', 'دستگاه', { notes: 'ابعاد حداکثر زینک بسته به مدل دستگاه شماست؛ ثبت کنید.' }),
    E('زینک برای GTO / SM 52 (حدود ۵۲×۴۶)', 'زینک', { unit: 'قطعه', components: [{ id: 'c1', name: 'خام زینک', price: 0, on: true }, { id: 'c2', name: 'کپی و ظهور / لیزر (CTP)', price: 0, on: true }, { id: 'c3', name: 'فرم‌بندی', price: 0, on: true }] }),
    E('زینک برای SM 74 / ۲ ورقی (حدود ۷۴×۶۰)', 'زینک', { unit: 'قطعه', components: [{ id: 'c1', name: 'خام زینک', price: 0, on: true }, { id: 'c2', name: 'کپی و ظهور / لیزر (CTP)', price: 0, on: true }, { id: 'c3', name: 'فرم‌بندی', price: 0, on: true }] }),
    E('زینک برای CD 102 / ۴٫۵ ورقی (حدود ۱۰۳×۷۹)', 'زینک', { unit: 'قطعه', components: [{ id: 'c1', name: 'خام زینک', price: 0, on: true }, { id: 'c2', name: 'کپی و ظهور / لیزر (CTP)', price: 0, on: true }, { id: 'c3', name: 'فرم‌بندی', price: 0, on: true }] }),
    E('فیلم و کپی سنتی (زینک از روی فیلم)', 'خدمت', { unit: 'قطعه', components: [{ id: 'c1', name: 'خام زینک', price: 0, on: true }, { id: 'c2', name: 'فیلم', price: 0, on: true }, { id: 'c3', name: 'کپی و ظهور', price: 0, on: true }] }),
    E('فرم‌بندی (ایمپوزیشن) مستقل', 'خدمت', { unit: 'فرم', formula: 'فرم * نرخ + راه_اندازی' }),
  ],
  digital: [
    E('Xerox Versant 180 / 280 (رنگی)', 'ماشین چاپ', { w: 33, h: 48.8, colors: 4, unit: 'رو', notes: 'ورق استاندارد ۳۳×۴۸٫۸؛ ورق بلند (XLS) تا ۳۳×۶۶.' }),
    E('Xerox Versant 4100 (رنگی)', 'ماشین چاپ', { w: 33, h: 48.8, colors: 4, unit: 'رو', notes: 'بنر تا ۳۳×۱۲۰.' }),
    E('Konica Minolta AccurioPress C14000 / C7100 (رنگی)', 'ماشین چاپ', { w: 33, h: 48.8, colors: 4, unit: 'رو', notes: 'ورق استاندارد حدود ۳۳×۴۸٫۸.' }),
    E('Canon imagePRESS C10000VP / V1000 (رنگی)', 'ماشین چاپ', { w: 33, h: 48.8, colors: 4, unit: 'رو', notes: 'ورق استاندارد حدود ۳۳×۴۸٫۸.' }),
    E('Ricoh Pro C7210 / C9200 (رنگی)', 'ماشین چاپ', { w: 33, h: 48.8, colors: 4, unit: 'رو' }),
    E('HP Indigo 7900 (دیجیتال افستی)', 'ماشین چاپ', { w: 32, h: 46, colors: 4, unit: 'رو', notes: 'مشخصات تقریبی؛ بررسی شود.' }),
    E('دستگاه سیاه‌وسفید پرسرعت (Xerox Nuvera / Konica Minolta / Sharp MX-M1055)', 'ماشین چاپ', { w: 33, h: 48.8, colors: 1, unit: 'رو' }),
    E('پلاتر بنر و پوستر (HP DesignJet / Epson SureColor)', 'پلاتر', { unit: 'متر مربع', formula: 'بیشینه(حداقل, متر_مربع * نرخ) + راه_اندازی' }),
    E('پلاتر اکوسالونت / یووی رول (Roland / Mimaki)', 'پلاتر', { unit: 'متر مربع', formula: 'بیشینه(حداقل, متر_مربع * نرخ) + راه_اندازی' }),
    E('چاپ DTF (فیلم انتقال حرارتی)', 'DTF', { unit: 'متر', formula: 'بیشینه(حداقل, متر * نرخ) + راه_اندازی' }),
    E('لیبل دیجیتال (رول)', 'لیبل', { unit: 'متر', formula: 'بیشینه(حداقل, متر * نرخ) + راه_اندازی' }),
    E('سلفون (لمینت) سرد/گرم — براق', 'خدمت دیجیتال', { unit: 'متر مربع', formula: 'بیشینه(حداقل, متر_مربع * نرخ) + راه_اندازی' }),
    E('سلفون (لمینت) سرد/گرم — مات', 'خدمت دیجیتال', { unit: 'متر مربع', formula: 'بیشینه(حداقل, متر_مربع * نرخ) + راه_اندازی' }),
    E('برش (گیوتین / کاتر / کات‌کانتور)', 'خدمت دیجیتال', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('چسب گرم دیجیتال', 'خدمت دیجیتال', { unit: 'نسخه', formula: 'تیراژ * نرخ + راه_اندازی' }),
    E('طلاکوب / فویل دیجیتال', 'خدمت دیجیتال', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('پانچ و پرفراژ', 'خدمت دیجیتال', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('فنر / سیم (اسپیرال و وایرو)', 'خدمت دیجیتال', { unit: 'نسخه', formula: 'تیراژ * نرخ + راه_اندازی' }),
  ],
  offset: [
    E('Heidelberg GTO 46 — تک‌رنگ', 'ماشین چاپ', { w: 32, h: 46, colors: 1, unit: 'هزار دور', notes: 'ورق تقریبی؛ با ماشین خودتان تطبیق دهید.' }),
    E('Heidelberg GTO 52 — تک‌رنگ', 'ماشین چاپ', { w: 36, h: 52, colors: 1, unit: 'هزار دور' }),
    E('Heidelberg GTO 52 — دورنگ', 'ماشین چاپ', { w: 36, h: 52, colors: 2, unit: 'هزار دور' }),
    E('Heidelberg GTO VP 52 (GTO)', 'ماشین چاپ', { w: 36, h: 52, colors: 1, unit: 'هزار دور', notes: 'حداکثر ورق ۳۶×۵۲ طبق مشخصات.' }),
    E('Heidelberg Speedmaster SM 52-1 — تک‌رنگ', 'ماشین چاپ', { w: 37, h: 52, colors: 1, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster SM 52-2 — دورنگ', 'ماشین چاپ', { w: 37, h: 52, colors: 2, unit: 'هزار دور', notes: 'حداکثر ورق ۳۷×۵۲؛ نسخه‌ی معمولی پشت‌ورو نیست.' }),
    E('Heidelberg Speedmaster SM 52-4 — چهاررنگ', 'ماشین چاپ', { w: 37, h: 52, colors: 4, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster SM 52-5 + لاک', 'ماشین چاپ', { w: 37, h: 52, colors: 5, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster SM 52-4P — چهاررنگ پشت‌ورو', 'ماشین چاپ', { w: 37, h: 52, colors: 4, perfecting: true, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster SM 74-2 — دورنگ (۲ ورقی)', 'ماشین چاپ', { w: 52, h: 74, colors: 2, unit: 'هزار دور', notes: 'ورق تقریبی؛ بررسی شود.' }),
    E('Heidelberg Speedmaster SM 74-4 — چهاررنگ', 'ماشین چاپ', { w: 52, h: 74, colors: 4, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster SM 74-4P — چهاررنگ پشت‌ورو', 'ماشین چاپ', { w: 52, h: 74, colors: 4, perfecting: true, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster SM 102-2 — دورنگ (۴٫۵ ورقی)', 'ماشین چاپ', { w: 72, h: 102, colors: 2, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster SM 102-4 — چهاررنگ', 'ماشین چاپ', { w: 72, h: 102, colors: 4, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster CD 102-5 + لاک', 'ماشین چاپ', { w: 72, h: 102, colors: 5, unit: 'هزار دور', notes: 'حداکثر ورق ۷۲×۱۰۲ طبق مشخصات.' }),
    E('Heidelberg Speedmaster SM 102-8P — هشت‌رنگ پشت‌ورو', 'ماشین چاپ', { w: 72, h: 102, colors: 8, perfecting: true, unit: 'هزار دور' }),
    E('Heidelberg Speedmaster XL 75-4 / XL 106', 'ماشین چاپ', { w: 75, h: 106, colors: 4, unit: 'هزار دور', notes: 'مشخصات تقریبی؛ مدل خود را وارد کنید.' }),
    E('Komori Lithrone (مدل‌های ۲۶ و ۲۸)', 'ماشین چاپ', { w: 74, h: 104, colors: 4, unit: 'هزار دور', notes: 'مشخصات تقریبی؛ مدل خود را وارد کنید.' }),
    E('KBA Rapida 75 / 105', 'ماشین چاپ', { w: 75, h: 105, colors: 4, unit: 'هزار دور', notes: 'مشخصات تقریبی؛ مدل خود را وارد کنید.' }),
    E('Roland 200 / 300 / 700', 'ماشین چاپ', { w: 70, h: 100, colors: 4, unit: 'هزار دور', notes: 'مشخصات تقریبی؛ مدل خود را وارد کنید.' }),
    E('Ryobi 520 / 524 / 750', 'ماشین چاپ', { w: 52, h: 74, colors: 4, unit: 'هزار دور', notes: 'مشخصات تقریبی؛ مدل خود را وارد کنید.' }),
    E('Mitsubishi Diamond', 'ماشین چاپ', { w: 72, h: 102, colors: 4, unit: 'هزار دور', notes: 'مشخصات تقریبی؛ مدل خود را وارد کنید.' }),
  ],
  binding: [
    E('برش ساده (گیوتین)', 'برش', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('بسته‌بندی (کارتن / شیرینک)', 'بسته‌بندی', { unit: 'نسخه', formula: 'تیراژ * نرخ + راه_اندازی' }),
    E('ارسال و حمل', 'ارسال', { unit: 'نسخه', formula: 'تیراژ * نرخ + راه_اندازی' }),
    E('تاکنی (تا)', 'تا', { unit: 'فرم', formula: 'فرم * تیراژ * نرخ + راه_اندازی' }),
    E('ترتیب (ست‌کردن فرم‌ها)', 'ترتیب', { unit: 'نسخه', formula: 'تیراژ * نرخ + راه_اندازی' }),
    E('منگنه / مفتولی', 'صحافی', { unit: 'فرم', formula: 'فرم_صحافی * نرخ * تیراژ + راه_اندازی' }),
    E('شومیز — چسب گرم', 'صحافی', { unit: 'فرم', formula: 'فرم_صحافی * نرخ * تیراژ + راه_اندازی' }),
    E('دوخت (ریسه) و گالینگور — جلد سخت', 'جلدسازی', { unit: 'نسخه' }),
    E('فنر / سیم (اسپیرال و وایرو)', 'صحافی', { unit: 'نسخه' }),
    E('خط تا (خط‌زن) و لب‌تا', 'خدمات تکمیلی', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('پرفراژ (خط‌تیری)', 'خدمات تکمیلی', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('شماره‌زنی', 'خدمات تکمیلی', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('سلفون حرارتی براق', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('سلفون حرارتی مات', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('سلفون حرارتی مخملی', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('سلفون حرارتی شنی', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('سلفون حرارتی هولوگرام', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('سلفون حرارتی متالایز', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('سلفون واتربیس براق', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('سلفون واتربیس مات', 'سلفون', { unit: 'سانتی‌متر مربع', formula: 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی' }),
    E('یووی کامل', 'یووی', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('یووی موضعی (با کلیشه/شابلون)', 'یووی', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('فویل‌کوبی / طلاکوب (لترپرس و بوبست)', 'فویل', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('قالب‌زنی دایکات / نیم‌تیغ', 'قالب', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('برجسته‌کاری (امباس)', 'خدمات تکمیلی', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('پوشال‌گیری', 'خدمات تکمیلی', { unit: 'ورق', formula: 'ورق * نرخ + راه_اندازی' }),
    E('جعبه‌سازی (چسب‌خوری / نقطه‌چسب)', 'جعبه', { unit: 'عدد', formula: 'تیراژ * نرخ + راه_اندازی' }),
  ],
};

let _id = 0;
const nid = () => 'u' + Date.now().toString(36) + (++_id).toString(36) + Math.random().toString(36).slice(2, 5);
export function makeEntry(preset = {}) {
  return {
    id: nid(), name: '', kind: '', notes: '', w: '', h: '', colors: '', perfecting: false, unit: '', rate: '', setup: '', minCharge: '', formula: '', tiers: [], coverTiers: [],
    active: true, ...preset,
    components: (preset.components || []).map(c => ({ ...c, id: nid() })),
  };
}
export function makePartner() { return { id: nid(), name: '', phone: '', address: '', service: '', unit: '', rate: '', setup: '', formula: '', notes: '' }; }

export function defaultUnits() {
  const out = {};
  UNIT_ORDER.forEach(k => { out[k] = { description: UNIT_META[k].defaultDescription, items: PRESETS[k].map(p => makeEntry(p)), outsource: [] }; });
  return out;
}
const LEGACY_UPGRADES = [
  { unit: 'binding', name: 'شومیز — چسب گرم', old: ['', 'تیراژ * نرخ + راه_اندازی'], formula: 'فرم_صحافی * نرخ * تیراژ + راه_اندازی' },
  { unit: 'binding', name: 'منگنه / مفتولی', old: ['', 'تیراژ * نرخ + راه_اندازی'], formula: 'فرم_صحافی * نرخ * تیراژ + راه_اندازی' },
  ...['سلفون حرارتی براق', 'سلفون حرارتی مات', 'سلفون واتربیس براق'].map(name => ({ unit: 'binding', name, old: ['بیشینه(حداقل, متر_مربع * نرخ) + راه_اندازی'], formula: 'مساحت_جلد * نرخ * تیراژ + راه_اندازی' })),
];
export function mergeUnits(saved) {
  const base = defaultUnits();
  if (!saved || typeof saved !== 'object') return base;
  const CELLO_RENAME = { 'سلفون براق (حرارتی)': 'سلفون حرارتی براق', 'سلفون مات (حرارتی)': 'سلفون حرارتی مات', 'سلفون واتربیس': 'سلفون واتربیس براق' };
  const isCello = (n) => /^سلفون (حرارتی|واتربیس)/.test(n || '');
  // فرمول‌های پیش‌فرض دست‌نخورده‌ی قدیمی به قاعده‌ی جدید ارتقا می‌یابند؛ فرمولی که خودتان نوشته‌اید دست نمی‌خورد
  if (saved.binding && Array.isArray(saved.binding.items)) {
    const items = saved.binding.items;
    items.forEach(e => { if (CELLO_RENAME[e.name]) e.name = CELLO_RENAME[e.name]; });
    PRESETS.binding.filter(p => ['سلفون', 'بسته‌بندی', 'ارسال'].includes(p.kind) && !items.some(e => e.name === p.name)).forEach(p => items.push(makeEntry(p)));
  }
  LEGACY_UPGRADES.forEach(u => { const list = saved[u.unit] && saved[u.unit].items; if (Array.isArray(list)) list.forEach(e => { if (e.name === u.name && u.old.includes((e.formula || '').trim())) { e.formula = u.formula; } }); });
  // سلفون حرارتی: قیمت هر سانتی‌متر مربع. فقط ردیف‌هایی که هنوز نرخی در آن‌ها ثبت نشده به واحد جدید می‌روند تا نرخ قدیمی ۱۰۰ برابر نشود
  const savedBinding = saved.binding && saved.binding.items;
  if (Array.isArray(savedBinding)) savedBinding.forEach(e => { if (isCello(e.name) && (e.formula || '').trim() === 'مساحت_جلد * نرخ * تیراژ + راه_اندازی' && !(Number(e.rate) > 0)) { e.formula = 'مساحت_جلد_سانتیمتر * نرخ * تیراژ + راه_اندازی'; e.unit = 'سانتی‌متر مربع'; } });
  const out = {};
  UNIT_ORDER.forEach(k => {
    const s = saved[k];
    out[k] = s ? { description: s.description ?? base[k].description, items: Array.isArray(s.items) ? s.items : [], outsource: Array.isArray(s.outsource) ? s.outsource : [] } : base[k];
  });
  return out;
}

/* ---------- محاسبه‌ی قیمت یک ردیف ---------- */
export function entryParts(entry, disabledIds = []) {
  return (entry.components || []).filter(c => c.on !== false && !disabledIds.includes(c.id)).reduce((s, c) => s + (Number(c.price) || 0), 0);
}
export function priceEntry(entry, ctx = {}, kindKey = 'binding', opts = {}) {
  const tiersList = opts.cover && normTierList(entry.coverTiers).length ? entry.coverTiers : entry.tiers;
  const formula = (entry.formula && entry.formula.trim()) || (opts.partner && PARTNER_FORMULAS[kindKey]) || (kindKey === 'offset' && normTierList(tiersList).length ? TIER_FORMULA : DEFAULT_FORMULAS[kindKey]);
  const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };
  const vars = {
    تیراژ: num(ctx.qty), ورق: num(ctx.sheets), ورق_خالص: num(ctx.netSheets ?? ctx.sheets), فرم: num(ctx.forms), زینک: num(ctx.plates), رنگ: num(ctx.colors),
    رو: num(ctx.sides) || 1, دور: num(ctx.impressions), صفحه: num(ctx.pages), متر_مربع: num(ctx.area), متر: num(ctx.meters), ساعت: num(ctx.hours), مقدار: num(ctx.amount ?? ctx.qty),
    نرخ: num(entry.rate), راه_اندازی: num(entry.setup), حداقل: num(entry.minCharge), اجزا: entryParts(entry, opts.disabledComponents || []),
    پله: tierPrice(tiersList, ctx.run ?? ctx.qty), فرم_صحافی: num(ctx.bindForms), مساحت_جلد: num(ctx.coverArea), مساحت_جلد_سانتیمتر: num(ctx.coverAreaCm2),
  };
  const r = evalFormula(formula, vars);
  return r.ok ? { ok: true, amount: Math.max(0, Math.round(r.value)), formula, vars } : { ok: false, error: r.error, formula, amount: 0, vars };
}
export const entryHasPrice = (e) => !!(normTierList(e.tiers).length || Number(e.rate) > 0 || Number(e.setup) > 0 || Number(e.minCharge) > 0 || (e.components || []).some(c => Number(c.price) > 0));
