/* ثبت سفارش هوشمند: شکستن متن به چند قلم، تحلیل آنلاین (هوش مصنوعی) با پشتیبان آفلاین، پیشنهاد ماشین و طرح اجرا.
   هر بخش بدون اینترنت هم کار می‌کند؛ هوش مصنوعی فقط دقت برداشت از متن را بالا می‌برد. */
import { parseOrderText, lexicon, normalizeDigits } from './smart.js';

export const AI_DEFAULT_MODEL = 'claude-sonnet-5-5';
export const PLAN_STEPS = [
  { key: 'design', label: 'طراحی', unit: 'design' },
  { key: 'litho', label: 'لیتوگرافی', unit: 'litho' },
  { key: 'print', label: 'چاپ', unit: null },
  { key: 'binding', label: 'صحافی و تکمیلی', unit: 'binding' },
];
export const emptyPlan = () => ({
  design: { mode: 'داخلی', partnerId: '' },
  litho: { mode: 'داخلی', partnerId: '' },
  print: { mode: 'داخلی', machineId: '', partnerId: '' },
  binding: { mode: 'داخلی', partnerId: '' },
});
export const OUTSOURCE = 'برون‌سپاری';

/* ---------- شکستن متن آفلاین ---------- */
const NUMW = 'یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده';
export function splitOrderText(raw, { productTypes = [] } = {}) {
  let t = normalizeDigits(String(raw || '')).replace(/\r/g, '');
  const names = [...new Set([...productTypes.filter(x => x && x !== 'سایر'), 'پوستر', 'تراکت', 'فلایر', 'لیبل', 'بنر', 'پاکت', 'سربرگ', 'کاتالوگ', 'بروشور', 'کتاب', 'مجله', 'جعبه', 'کارت ویزیت'])];
  const pt = names.sort((a, b) => b.length - a.length).join('|');
  // جداکننده‌های صریح
  let parts = t.split(/\n+|[؛;]+|(?<![0-9])\.(?=\s|$)/).map(s => s.trim()).filter(Boolean);
  // «... و ۵۰۰ بروشور ...» داخل یک جمله
  const re = new RegExp(`\\s+(?:و|همچنین|بعلاوه|به‌علاوه|علاوه بر این)\\s+(?=(?:\\d+|${NUMW})\\s*(?:عدد|نسخه|برگ|جلد|تا)?\\s*(?:${pt}))`);
  parts = parts.flatMap(p => p.split(re));
  // تکه‌ای که نوع محصول ندارد ادامه‌ی تکه‌ی قبلی است؛ «تعداد: ۲۰۰۰» و «مشخصات: …» به‌تنهایی قلم جدید نمی‌سازند
  const merged = [];
  parts.forEach(p => {
    const q = parseOrderText(p, { productTypes });
    if (!q.productType && merged.length) merged[merged.length - 1] += ' ' + p; else merged.push(p);
  });
  return merged;
}
export function parseOfflineItems(raw, opts = {}) {
  return splitOrderText(raw, opts).map(seg => ({ segment: seg, parsed: parseOrderText(seg, opts) })).filter(x => x.parsed.productType || x.parsed.qty || x.parsed.pages || x.parsed.text.kind);
}
/* هشدارهای متن‌خوان آفلاین به پرسش تبدیل می‌شوند تا پیش از ثبت، کاربر تأیید کند */
export function offlineQuestions(items) {
  return [...new Set(items.flatMap(x => (x.parsed && x.parsed.notes) || []))];
}

/* ---------- هوش مصنوعی ---------- */
export function buildAiSystemPrompt({ productTypes = [], serviceTypes = [], bindingTypes = [] }) {
  return [
    'تو دستیار ثبت سفارش یک چاپخانه‌ی ایرانی هستی. متن فارسی مشتری را به اقلام ساختاریافته تبدیل کن.',
    'فقط و فقط یک شیء JSON معتبر برگردان، بدون هیچ توضیح یا بلوک کد.',
    'اگر متن چند محصول مستقل دارد، هر کدام یک ردیف در items باشد. هر مقداری که در متن نیست را خالی (null یا "") بگذار؛ حدس نزن.',
    `نوع محصول (productType) فقط از این‌ها: ${productTypes.join('، ')}.`,
    `قطع (size) یکی از: ${Object.keys(lexicon.trimSizes).join('، ')} یا شیء {"w":عدد,"h":عدد} به سانتی‌متر.`,
    `نوع کاغذ (kind) از: ${lexicon.paperKinds.join('، ')}.`,
    `صحافی (binding) از: ${bindingTypes.join('، ')}.`,
    `خدمات تکمیلی (services) از: ${serviceTypes.join('، ')}.`,
    `رنگ چاپ (colors): ${lexicon.printColors.map(c => `${c[0]} ${c[1]}`).join('، ')}، ۵ چهاررنگ با رنگ اضافه. sides: ۱ یک‌رو یا ۲ دورو. سلفون: «براق» یا «مات» یا "". celloKind: «حرارتی» یا «واتربیس». celloVariant فقط برای حرارتی: «مخملی»، «شنی»، «هولوگرام»، «متالایز» یا "".`,
    'اگر بخشی از متنِ کتاب رنگی‌تر از بقیه است («۴ صفحه اول ۴ رنگ، مابقی ۲ رنگ»)، صفحه‌های ابتدایی را در frontColorPages و رنگشان را در frontColors بگذار و رنگ بقیه را در textColors. تعداد کل صفحات (pages) همیشه مجموع صفحه‌های ابتدایی و بقیه است.',
    'قاعدهٔ فرم چاپ (برای هشدار، نه محاسبه): رحلی و سلطانی هر ۸ صفحه یک فرم، رقعی و وزیری هر ۱۶ صفحه، خشتی هر ۱۲ صفحه. کسر نیم‌فرم ۴ صفحه‌ای روی خودش دورو با تیراژ کمتر چاپ می‌شود؛ اگر تعداد صفحات با این قاعده جور نیست در questions بپرس.',
    'ساختار: {"items":[{"productType":"","productName":"","qty":0,"size":"","pages":0,"textPaper":{"kind":"","gsm":0},"textColors":0,"textSides":0,"frontColorPages":0,"frontColors":0,"cover":{"enabled":false,"kind":"","gsm":0,"colors":0,"sides":0,"cellophane":""},"cellophane":"","binding":"","services":[],"printMethod":"افست|دیجیتال|","notes":""}],"questions":["پرسش‌هایی که برای کامل شدن سفارش باید از مشتری پرسید"]}',
  ].join('\n');
}
export function parseAiJson(str) {
  let s = String(str || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('پاسخ هوش مصنوعی JSON نبود.');
  return JSON.parse(s.slice(a, b + 1));
}
const numOrNull = (v) => { const n = Number(normalizeDigits(String(v ?? ''))); return v === null || v === undefined || v === '' || isNaN(n) || n <= 0 ? null : n; };
const pickEnum = (v, list) => (list.includes(v) ? v : '');
const colorCodes = () => lexicon.printColors.map(c => c[0]);
export function aiItemToParsed(it, { productTypes = [], serviceTypes = [], bindingTypes = [] } = {}) {
  const i = it || {};
  const out = { printMethod: pickEnum(i.printMethod, ['افست', 'دیجیتال']), productType: pickEnum(i.productType, productTypes), productName: '', sizeKey: '', custom: null, pages: numOrNull(i.pages), qty: numOrNull(i.qty),
    text: { kind: pickEnum(i.textPaper && i.textPaper.kind, lexicon.paperKinds), gsm: numOrNull(i.textPaper && i.textPaper.gsm), colors: pickEnum(Number(i.textColors), colorCodes()) || null, sides: pickEnum(Number(i.textSides), [1, 2]) || null, frontPages: numOrNull(i.frontColorPages), frontColors: pickEnum(Number(i.frontColors), colorCodes()) || null },
    cover: { enabled: false, kind: '', gsm: null, colors: null, sides: null, cellophane: '', celloKind: '', celloVariant: '' }, binding: pickEnum(i.binding, bindingTypes), services: (Array.isArray(i.services) ? i.services : []).filter(s => serviceTypes.includes(s)), notes: String(i.notes || '') };
  out.productName = String(i.productName || '').trim() || out.productType;
  if (typeof i.size === 'string' && lexicon.trimSizes[i.size]) out.sizeKey = i.size;
  else if (i.size && typeof i.size === 'object' && numOrNull(i.size.w) && numOrNull(i.size.h)) out.custom = [numOrNull(i.size.w), numOrNull(i.size.h)];
  const c = i.cover || {};
  if (c.enabled) {
    out.cover = { enabled: true, kind: pickEnum(c.kind, lexicon.paperKinds), gsm: numOrNull(c.gsm), colors: pickEnum(Number(c.colors), colorCodes()) || null, sides: pickEnum(Number(c.sides), [1, 2]) || null, cellophane: pickEnum(c.cellophane, ['براق', 'مات']), celloKind: pickEnum(c.celloKind, ['حرارتی', 'واتربیس']) || '', celloVariant: ['مخملی', 'شنی', 'هولوگرام', 'متالایز'].includes(c.celloVariant) ? c.celloVariant : '' };
  } else { out.cover.cellophane = pickEnum(i.cellophane, ['براق', 'مات']); out.cover.celloKind = pickEnum(i.celloKind, ['حرارتی', 'واتربیس']) || ''; out.cover.celloVariant = ['مخملی', 'شنی', 'هولوگرام', 'متالایز'].includes(i.celloVariant) ? i.celloVariant : ''; }
  return out;
}
export async function aiExtract(text, ai, opts, bridge) {
  const api = bridge || (typeof window !== 'undefined' ? window.printshopApi : null);
  if (!ai || !ai.enabled || !ai.apiKey) throw new Error('هوش مصنوعی فعال نیست.');
  if (!api || !api.aiComplete) throw new Error('اتصال هوش مصنوعی فقط در نسخه‌ی نصبی برنامه کار می‌کند.');
  const r = await api.aiComplete({ apiKey: ai.apiKey, model: ai.model || AI_DEFAULT_MODEL, system: buildAiSystemPrompt(opts), user: String(text || '') });
  if (!r || !r.ok) throw new Error((r && r.error) || 'پاسخی از هوش مصنوعی نیامد.');
  const j = parseAiJson(r.text);
  const items = (Array.isArray(j.items) ? j.items : []).map(x => aiItemToParsed(x, opts)).filter(p => p.productType || p.qty || p.pages);
  if (!items.length) throw new Error('هوش مصنوعی هیچ قلمی تشخیص نداد.');
  return { items, questions: (Array.isArray(j.questions) ? j.questions : []).map(String).filter(Boolean).slice(0, 6) };
}
/* هوش مصنوعی اگر کار نکرد، تحلیل آفلاین جای آن می‌نشیند */
export async function extractItems(text, { ai, opts, bridge }) {
  if (ai && ai.enabled && ai.apiKey) {
    try { const r = await aiExtract(text, ai, opts, bridge); return { source: 'ai', items: r.items.map(p => ({ segment: '', parsed: p })), questions: r.questions, note: '' }; }
    catch (e) { const off = parseOfflineItems(text, opts); return { source: 'offline', items: off, questions: offlineQuestions(off), note: `هوش مصنوعی در دسترس نبود (${e.message}) — تحلیل آفلاین انجام شد.` }; }
  }
  const off = parseOfflineItems(text, opts);
  return { source: 'offline', items: off, questions: offlineQuestions(off), note: '' };
}

/* ---------- پیشنهاد روش چاپ و ماشین ---------- */
export function suggestMethod(item, analysis) {
  const n = (analysis && analysis.numbers) || {};
  const sheets = (n.textSheetsTotal || 0) + (n.coverSheetsTotal || 0);
  const qty = Number(item.qty) || 0;
  if (!analysis || !analysis.ok) return null;
  if (sheets > 0 && sheets <= 400) return { method: 'دیجیتال', reason: `کل کار حدود ${sheets.toLocaleString('en-US')} ورق است؛ تیراژ کم با چاپ دیجیتال (بدون زینک و راه‌اندازی سریع) معمولاً به‌صرفه‌تر است.` };
  if (qty >= 500 || sheets > 400) return { method: 'افست', reason: 'تیراژ/حجم کار بالاست؛ چاپ افست هزینه‌ی هر نسخه را پایین می‌آورد.' };
  return null;
}
export function suggestPrinters(item, analysis, units, hasPriceFn) {
  const method = (item.spec && item.spec.printMethod) || 'افست';
  const kind = method === 'دیجیتال' ? 'digital' : 'offset';
  const n = (analysis && analysis.numbers) || {};
  const needColors = Math.max(Number(n.textColors) || 1, n.coverSheetsTotal ? Number(n.coverColors) || 1 : 1);
  const sheet = n.pressSheet || n.sheet || null;
  const list = ((units && units[kind] && units[kind].items) || []).filter(e => e.active !== false && (e.kind || '') === 'ماشین چاپ');
  const scored = list.map(e => {
    let score = 0; const reasons = [];
    const col = Number(e.colors) || 0;
    if (col && col >= needColors) { score += 10 - Math.min(5, col - needColors); reasons.push(col === needColors ? 'تعداد رنگ دقیقاً مطابق' : `${col} رنگ`); } else if (col) { score -= 4; reasons.push(`${col} رنگ؛ کار در چند عبور چاپ می‌شود`); }
    const w = Number(e.w) || 0, h = Number(e.h) || 0;
    if (sheet && w && h) { const ok = (sheet[0] <= Math.max(w, h) && sheet[1] <= Math.min(w, h)) || (sheet[1] <= Math.max(w, h) && sheet[0] <= Math.min(w, h)); if (ok) { score += 5; reasons.push(`ورق ${sheet[0]}×${sheet[1]} روی دستگاه جا می‌شود`); } else { score -= 6; reasons.push(`ورق ${sheet[0]}×${sheet[1]} بزرگ‌تر از ظرفیت دستگاه است`); } }
    if (e.perfecting && (Number(n.textSides) === 2)) { score += 2; reasons.push('پشت‌ورو'); }
    if (hasPriceFn && hasPriceFn(e)) { score += 1; }
    return { entry: e, kind, score, reasons };
  }).sort((a, b) => b.score - a.score);
  return scored;
}
/* نگاشت نام ماشین افست به برچسب قدیمی «دستگاه» که محاسبه‌ی زینک/فرم از آن استفاده می‌کند */
export function pressLabelFor(entry) {
  const nm = normalizeDigits(entry.name || '').toLowerCase();
  if (/gto/.test(nm)) return 'GTO';
  if (/sm 74|2 ورقی|ryobi 5[0-9]+|ryobi/.test(nm)) return '2 ورقی';
  if (/102|4\.5 ورقی|xl 1|105|106|roland|rapida/.test(nm)) return '4.5 ورقی';
  const w = Number(entry.w) || 0, h = Number(entry.h) || 0; const big = Math.max(w, h);
  return big >= 90 ? '4.5 ورقی' : big >= 70 ? '2 ورقی' : 'GTO';
}
export function partnersFor(units, stepKey, method) {
  if (!units) return [];
  const unit = stepKey === 'print' ? (method === 'دیجیتال' ? 'digital' : 'offset') : stepKey;
  return ((units[unit] && units[unit].outsource) || []).filter(p => p.name);
}
