/* ثبت هوشمند کالای انبار: «چی آمده/چی دارم» را بنویس، برنامه فهرست پیش‌نویس می‌دهد.
   بدون اینترنت هم کار می‌کند؛ اگر هوش مصنوعی فعال باشد دقت برداشت بالاتر می‌رود و در صورت خطا خودکار آفلاین می‌شود. */
import { normalizeDigits } from './smart.js';
import { parseAiJson } from './smartorder.js';
import { bandValueFromKg } from './kgprice.js';

export const PAPER_CATS = ['کاغذ', 'مقوا'];
/* هر دسته فقط فیلدهای مرتبط خودش را می‌خواهد */
export const CATEGORY_FIELDS = {
  'کاغذ': ['gramaj', 'size', 'brand'],
  'مقوا': ['gramaj', 'size', 'brand'],
  'مرکب': ['color', 'brand'],
  'زینک': ['size', 'brand'],
  'سلفون': ['finish', 'size', 'brand'],
  'فویل طلا': ['color', 'size', 'brand'],
  'سایر': ['brand'],
};
export const FIELD_LABELS = { gramaj: 'گراماژ (گرم)', size: 'سایز / عرض', brand: 'برند', color: 'رنگ', finish: 'نوع (مات / براق)' };
export const SIZE_LABEL_BY_CAT = { 'کاغذ': 'سایز ورق (مثلاً 70×100)', 'مقوا': 'سایز ورق (مثلاً 70×100)', 'زینک': 'سایز زینک (مثلاً 52×46)', 'سلفون': 'عرض رول (سانتی‌متر)', 'فویل طلا': 'عرض رول (سانتی‌متر)' };
export const NAME_PLACEHOLDER = { 'کاغذ': 'مثلاً گلاسه یا تحریر', 'مقوا': 'مثلاً گلاسه یا دوپلکس', 'مرکب': 'مثلاً مرکب قرمز', 'زینک': 'مثلاً زینک ۲ ورقی', 'سلفون': 'مثلاً سلفون مات', 'فویل طلا': 'مثلاً فویل طلایی', 'سایر': 'مثلاً چسب گرم' };
export const CATEGORY_DEFAULT_UNIT = { 'مرکب': 'کیلوگرم', 'زینک': 'عدد', 'سلفون': 'متر مربع', 'فویل طلا': 'متر', 'سایر': 'عدد' };
export const fieldsFor = (cat) => CATEGORY_FIELDS[cat] || ['brand'];

/* ---------- برداشت آفلاین ---------- */
const COLORS_FA = ['قرمز', 'آبی', 'زرد', 'مشکی', 'سیاه', 'سبز', 'نارنجی', 'بنفش', 'صورتی', 'طلایی', 'نقره‌ای', 'نقره ای', 'سایان', 'مجنتا', 'سفید', 'قهوه‌ای', 'طوسی', 'کرم', 'سرخابی'];
const PAPER_KINDS_FA = ['تحریر', 'گلاسه', 'بالک', 'کرافت', 'روزنامه', 'کتان', 'دوپلکس', 'ایندکس', 'تیراژ', 'کاهی', 'اندونزی'];
const UNIT_RE = '(بند|رول|زینک|کیلوگرم|کیلو|کگ|kg|متر\\s*مربع|مترمربع|متر|لیتر|رم|برگ|ورق|قوطی|بسته|حلقه|دست|پلیت|تکه|قطعه|عدد)';
const toSimple = (u) => (/کیلو|کگ|kg/.test(u) ? 'کیلوگرم' : /متر\s*مربع|مترمربع/.test(u) ? 'متر مربع' : /متر/.test(u) ? 'متر' : /لیتر/.test(u) ? 'لیتر' : 'عدد');
const num = (s) => Number(String(s).replace(/,/g, ''));

export function splitInventoryText(raw) {
  const t = normalizeDigits(String(raw || '')).replace(/\r/g, '');
  let parts = t.split(/\n+|[؛;]+|(?<![0-9])\.(?=\s|$)/).map(s => s.trim()).filter(Boolean);
  const NC = UNIT_RE.replace(/^\(/, '(?:');
  const re = new RegExp(`\\s+و\\s+(?=\\d+(?:\\.\\d+)?\\s*${NC})|[،,]\\s*(?=\\d+(?:\\.\\d+)?\\s*${NC})`);
  parts = parts.flatMap(p => p.split(re));
  return parts.map(s => s.trim()).filter(Boolean);
}

function detectCategory(t, categories, gsm) {
  for (const c of categories || []) { if (c && !['سایر'].includes(c) && !PAPER_CATS.includes(c) && t.includes(c)) return { cat: c }; }
  if (/زینک|پلیت/.test(t)) return { cat: 'زینک' };
  if (/مرکب/.test(t)) return { cat: 'مرکب' };
  if (/سلفون|لمینت/.test(t)) return { cat: 'سلفون' };
  if (/فویل|طلاکوب/.test(t)) return { cat: 'فویل طلا' };
  if (/مقوا|دوپلکس|کارتن|ایندکس/.test(t)) return { cat: 'مقوا' };
  if (/کاغذ|تحریر|گلاسه|بالک|کرافت|روزنامه|کتان|اندونزی|کاهی/.test(t) || (gsm && /بند|رم/.test(t))) {
    if (gsm && gsm >= 230 && !/کاغذ/.test(t)) return { cat: 'مقوا', note: `گراماژ ${gsm} بالاست؛ «مقوا» فرض شد — اگر کاغذ است دسته را تغییر دهید.` };
    return { cat: 'کاغذ' };
  }
  return { cat: 'سایر' };
}

/* فیلدهای خام یک تکه‌ی متن */
export function extractFields(chunk, { customers = [], suppliers = [], categories = [] } = {}) {
  let t = normalizeDigits(chunk);
  const f = { raw: chunk };
  const sz = t.match(/(\d+(?:\.\d+)?)\s*(?:[×xX*]|در)\s*(\d+(?:\.\d+)?)/);
  if (sz) { f.size = `${sz[1]}×${sz[2]}`; t = t.replace(sz[0], ' '); }
  const g = t.match(/(\d+)\s*(?:گرمی|گرم|gr|g)(?![\u0600-\u06FFa-zA-Z])/i);
  if (g) { f.gsm = Number(g[1]); t = t.replace(g[0], ' '); }
  const perBand = t.match(/هر\s*بند\s*(\d+)\s*(?:برگ|ورق)/) || t.match(/(\d+)\s*(?:برگ|ورق)\s*در\s*هر\s*بند/);
  if (perBand) { f.sheetsPerBand = Number(perBand[1]); t = t.replace(perBand[0], ' '); }
  const price = t.match(/(?:به\s*قیمت|قیمت|فی)\s*(?:هر\s*\S+\s*)?(\d[\d,]*(?:\.\d+)?)\s*(هزار|میلیون)?\s*(تومان|ریال)?/);
  if (price) {
    let p = num(price[1]); if (price[2] === 'هزار') p *= 1e3; if (price[2] === 'میلیون') p *= 1e6; if (price[3] === 'تومان') p *= 10;
    f.unitPrice = p; if (/کیلو|کگ|kg/i.test(price[0])) f.priceKg = true; t = t.replace(price[0], ' ');
  }
  // رول + کیلو
  const roll = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*رول`));
  const kg = t.match(/(\d+(?:\.\d+)?)\s*(?:کیلوگرم|کیلو|کگ|kg)(?![\u0600-\u06FFa-zA-Z])/i);
  if (roll && kg) { f.rollCount = num(roll[1]); f.kg = num(kg[1]); t = t.replace(roll[0], ' ').replace(kg[0], ' '); f.unit = 'roll_kg'; }
  else {
    const q = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}`, 'i'));
    if (q) { f.qty = num(q[1]); f.unit = q[2].replace(/\s+/g, ' '); t = t.replace(q[0], ' '); }
  }
  const cat = detectCategory(chunk, categories, f.gsm); f.category = cat.cat; if (cat.note) f.note = cat.note;
  const color = COLORS_FA.find(c => t.includes(c)); if (color) f.color = color.replace('نقره ای', 'نقره‌ای');
  const fin = t.match(/مات|براق/); if (fin) f.finish = fin[0];
  f.kind = PAPER_KINDS_FA.find(k => t.includes(k)) || '';
  const sup = suppliers.find(s => s.name && chunk.includes(s.name)); if (sup) f.supplierName = sup.name;
  const cus = customers.find(c => c.name && chunk.includes(c.name)); if (cus) f.customerName = cus.name;
  if (/مشتری|آورده|آوردند|آورد\b/.test(chunk)) f.ownerHint = 'مشتری';
  const loc = chunk.match(/(?:در|محل)\s*(قفسه\s*\S+|انبار\s*\S+|سالن\s*\S+)/); if (loc) f.location = loc[1];
  f.leftover = t.replace(/[،,.\-—]/g, ' ').replace(/\b(و|از|به|برای|آورده|آوردند|مشتری|قیمت|عدد)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return f;
}

/* فیلدهای خام (از آفلاین یا هوش مصنوعی) → پیش‌نویس کالا + هشدارها */
export function buildDraft(f, { customers = [], suppliers = [] } = {}) {
  const warnings = []; if (f.note) warnings.push(f.note);
  const category = f.category || 'سایر';
  const paper = PAPER_CATS.includes(category);
  const d = { category, gramaj: '', size: '', color: '', finish: '', brand: f.brand || '', location: f.location || '', unitValue: f.unitPrice ? String(Math.round(f.unitPrice)) : '',
    ownerType: 'چاپخانه', ownerCustomerId: '', supplierSource: 'چاپخانه', supplierId: '', unitMode: paper ? 'band_sheet' : 'simple', bandCount: '', sheetsPerBand: '', weightKg: '', rollCount: '', kgPerRoll: '', quantity: '', simpleUnit: CATEGORY_DEFAULT_UNIT[category] || 'عدد' };
  const has = fieldsFor(category);
  if (f.priceKg && paper && f.unitPrice) { d.priceBasis = 'kg'; d.pricePerKg = String(Math.round(f.unitPrice)); d.unitValue = ''; }
  if (has.includes('gramaj') && f.gsm) d.gramaj = String(f.gsm);
  if (has.includes('size') && f.size) d.size = f.size;
  if (has.includes('color') && f.color) d.color = f.color;
  if (has.includes('finish') && f.finish) d.finish = f.finish;
  // نام
  const kindWord = f.kind || '';
  d.name = f.name && String(f.name).trim() ? String(f.name).trim()
    : paper ? (kindWord || category)
    : category === 'مرکب' ? `مرکب ${f.color || ''}`.trim()
    : category === 'زینک' ? `زینک ${f.size || ''}`.trim()
    : category === 'سلفون' ? `سلفون ${f.finish || ''}`.trim()
    : category === 'فویل طلا' ? `فویل ${f.color || ''}`.trim()
    : (f.leftover || 'کالای جدید');
  // موجودی
  const u = f.unit || '';
  if (u === 'roll_kg') { d.unitMode = 'roll_kg'; d.rollCount = String(f.rollCount || ''); d.weightKg = String(f.kg || ''); if (f.rollCount && f.kg) d.kgPerRoll = String(Math.round((f.kg / f.rollCount) * 1000) / 1000); }
  else if (f.qty || f.qty === 0) {
    if (paper && /بند|رم/.test(u)) { d.unitMode = 'band_sheet'; d.bandCount = String(f.qty); d.sheetsPerBand = String(f.sheetsPerBand || 500); if (!f.sheetsPerBand) warnings.push('تعداد ورق در هر بند ۵۰۰ فرض شد؛ اگر فرق دارد اصلاح کنید.'); }
    else if (paper && /برگ|ورق/.test(u)) { d.unitMode = 'band_sheet'; d.bandCount = '1'; d.sheetsPerBand = String(f.qty); warnings.push(`${f.qty} ورق به‌صورت «یک بند با ${f.qty} ورق» ثبت می‌شود.`); }
    else if (paper && /کیلو|کگ|kg/.test(u)) { d.unitMode = 'roll_kg'; d.weightKg = String(f.qty); }
    else if (paper) { d.unitMode = 'band_sheet'; d.bandCount = String(f.qty); d.sheetsPerBand = String(f.sheetsPerBand || 500); warnings.push(`واحد «${u}» برای کاغذ بند فرض شد و ۵۰۰ ورق در هر بند.`); }
    else { d.unitMode = 'simple'; d.quantity = String(f.qty); d.simpleUnit = toSimple(u); if (/بند|رم|رول/.test(u)) warnings.push(`واحد «${u}» برای این دسته «عدد» ثبت شد.`); }
  } else warnings.push('مقدار تشخیص داده نشد؛ قبل از ثبت اصلاح کنید.');
  if (f.sheetsPerBand && d.unitMode === 'band_sheet' && !d.sheetsPerBand) d.sheetsPerBand = String(f.sheetsPerBand);
  if (paper && !d.gramaj) warnings.push('گراماژ تشخیص داده نشد.');
  if (paper && !d.size) warnings.push('سایز تشخیص داده نشد (مثلاً 70×100).');
  if (category === 'مرکب' && !d.color) warnings.push('رنگ مرکب تشخیص داده نشد.');
  // مالکیت و تامین
  const cus = f.customerName && customers.find(c => c.name === f.customerName);
  if (cus) { d.ownerType = 'مشتری'; d.ownerCustomerId = cus.id; d.supplierSource = 'مشتری'; d.purposeScope = 'all'; d.purpose = 'همه کارهای این مشتری'; }
  else if (f.ownerHint === 'مشتری') { d.ownerType = 'مشتری'; d.supplierSource = 'مشتری'; warnings.push('گفته‌اید مشتری آورده؛ مشتری را انتخاب کنید.'); }
  const sup = f.supplierName && suppliers.find(s => s.name === f.supplierName);
  if (sup && d.ownerType !== 'مشتری') { d.supplierSource = 'تامین‌کننده'; d.supplierId = sup.id; }
  if (d.priceBasis === 'kg') { if (d.unitMode !== 'band_sheet') { d.priceBasis = 'unit'; d.unitValue = d.pricePerKg; d.pricePerKg = ''; } else { const v = bandValueFromKg(d, d.pricePerKg); if (v > 0) d.unitValue = String(v); else warnings.push('برای محاسبهٔ ارزش هر بند از فی کیلوگرم، سایز و گراماژ لازم است.'); } }
  return { draft: d, warnings };
}

export function parseInventoryText(raw, ctx = {}) {
  const chunks = splitInventoryText(raw);
  const drafts = []; const skipped = [];
  chunks.forEach(c => {
    const f = extractFields(c, ctx);
    const meaningful = f.qty || f.rollCount || f.size || f.gsm || f.category !== 'سایر' || f.color;
    if (!meaningful) { skipped.push(c); return; }
    const b = buildDraft(f, ctx); drafts.push({ raw: c, ...b });
  });
  return { drafts, skipped };
}

/* ---------- هوش مصنوعی ---------- */
export function buildInvAiPrompt({ categories = [] }) {
  return [
    'تو دستیار انبار یک چاپخانه‌ی ایرانی هستی. متن فارسی را به فهرست کالاهای وارد‌شده یا موجود تبدیل کن.',
    'فقط یک شیء JSON معتبر برگردان، بدون توضیح یا بلوک کد. هر چیزی که در متن نیست را خالی بگذار؛ حدس نزن.',
    `دسته (category) فقط از این‌ها: ${categories.join('، ')}.`,
    'unit یکی از: بند، رم، رول، کیلوگرم، عدد، متر، متر مربع، لیتر، برگ. اگر رول و وزن هر دو گفته شده، rollCount و kg را پر کن.',
    'ساختار: {"items":[{"name":"","category":"","gsm":0,"size":"70×100","color":"","finish":"مات|براق|","brand":"","qty":0,"unit":"","sheetsPerBand":0,"rollCount":0,"kg":0,"customerName":"","supplierName":"","unitPrice":0,"location":""}]}',
  ].join('\n');
}
export async function aiExtractInventory(text, ai, ctx, bridge) {
  const api = bridge || (typeof window !== 'undefined' ? window.printshopApi : null);
  if (!ai || !ai.enabled || !ai.apiKey) throw new Error('هوش مصنوعی فعال نیست.');
  if (!api || !api.aiComplete) throw new Error('اتصال هوش مصنوعی فقط در نسخه‌ی نصبی کار می‌کند.');
  const r = await api.aiComplete({ apiKey: ai.apiKey, model: ai.model || 'claude-sonnet-5-5', system: buildInvAiPrompt(ctx), user: String(text || '') });
  if (!r || !r.ok) throw new Error((r && r.error) || 'پاسخی نیامد.');
  const j = parseAiJson(r.text);
  const items = (Array.isArray(j.items) ? j.items : []).filter(x => x && (x.qty || x.rollCount || x.name));
  if (!items.length) throw new Error('هوش مصنوعی کالایی تشخیص نداد.');
  const cats = ctx.categories || [];
  return items.map(x => {
    const f = { raw: '', name: String(x.name || ''), category: cats.includes(x.category) ? x.category : undefined, gsm: Number(x.gsm) || 0, size: String(x.size || '').replace(/\s+/g, ''), color: String(x.color || ''), finish: String(x.finish || ''), brand: String(x.brand || ''), qty: Number(x.qty) || 0, unit: String(x.unit || ''), sheetsPerBand: Number(x.sheetsPerBand) || 0, rollCount: Number(x.rollCount) || 0, kg: Number(x.kg) || 0, customerName: String(x.customerName || ''), supplierName: String(x.supplierName || ''), unitPrice: Number(x.unitPrice) || 0, location: String(x.location || '') };
    if (f.rollCount && f.kg) f.unit = 'roll_kg';
    if (!f.category) f.category = detectCategory(`${f.name} ${f.unit}`, cats, f.gsm).cat;
    f.kind = PAPER_KINDS_FA.find(k => f.name.includes(k)) || '';
    return f;
  });
}
export async function extractInventory(text, { ai, ctx, bridge }) {
  if (ai && ai.enabled && ai.apiKey) {
    try {
      const fl = await aiExtractInventory(text, ai, ctx, bridge);
      return { source: 'ai', drafts: fl.map(f => ({ raw: '', ...buildDraft(f, ctx) })), skipped: [], note: '' };
    } catch (e) {
      const off = parseInventoryText(text, ctx);
      return { source: 'offline', ...off, note: `هوش مصنوعی در دسترس نبود (${e.message}) — تحلیل آفلاین انجام شد.` };
    }
  }
  return { source: 'offline', ...parseInventoryText(text, ctx), note: '' };
}

/* اعتبارسنجی مشترک بین فرم و ثبت گروهی */
export function inventoryErrors(v, isNew, { paperLike = PAPER_CATS } = {}) {
  const errs = [];
  if (!v.category) errs.push('دسته (جنس کالا) را انتخاب کنید.');
  if (!String(v.name || '').trim()) errs.push('شرح کالا را وارد کنید.');
  if (v.ownerType === 'مشتری') {
    if (!v.ownerCustomerId) errs.push('مشتری مالک این موجودی را انتخاب کنید.');
    if (v.purposeScope === 'order' && !String(v.linkedOrderNumber || '').trim() && !String(v.purpose || '').trim()) errs.push('مشخص کنید این موجودی برای کدام سفارش / چه کاری آورده شده است.');
  }
  if (v.supplierSource === 'تامین‌کننده' && !v.supplierId) errs.push('تامین‌کننده را انتخاب کنید.');
  const pos = (x) => (isNew ? Number(x) > 0 : (String(x).trim() !== '' && Number(x) >= 0));
  if (v.unitMode === 'band_sheet') {
    if (!pos(v.bandCount)) errs.push('تعداد بند را وارد کنید.');
    if (!(Number(v.sheetsPerBand) > 0)) errs.push('تعداد ورق در هر بند را وارد کنید.');
  } else if (v.unitMode === 'roll_kg') {
    if (!pos(v.weightKg)) errs.push('وزن کل رول‌ها (کیلوگرم) را وارد کنید.');
  } else {
    if (!pos(v.quantity)) errs.push('مقدار موجودی را وارد کنید.');
    if (!v.simpleUnit) errs.push('واحد موجودی را انتخاب کنید.');
  }
  return errs;
}
