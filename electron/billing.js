'use strict';
/* اصلاحات ۱۷/بند ۳: صورتحسابِ جزئی بر مبنایِ مقدارِ تحویلی.
   این ماژول پاک است — نه بانک می‌خواند، نه چیزی می‌نویسد؛ همان قاعدهٔ receipts.js و credit.js.

   سه عددِ هر قلم از هم جدا می‌ماند (تصمیمِ کارفرما): «سفارش‌شده» از item.qty،
   «سالم» از رکوردِ کنترلِ کیفیت، و «تحویل‌قابل‌صورتحساب» از رسیدهای تحویل.
   پول فقط از عددِ سوم می‌آید: تعدادِ سالمِ توی انبار، طلبِ مشتری را زیاد نمی‌کند.

   قاعدهٔ صورتحساب (تصمیمِ کارفرما): ردیفی که واحدش واحدِ تحویلِ همان قلم است با
   تعدادِ تحویلی مقیاس می‌شود (چاپ متن، صحافی) و ردیفِ ثابت یک‌بارِ کامل طلب می‌شود
   (زینک، کاغذِ ورق، جلدِ ورق). پس تحویلِ بخشی، هزینهٔ یک‌بارِ زینک را تکرار نمی‌کند.

   حالتِ قرارداد سقف را تعیین می‌کند، نه حسابِ ریاضی را: در «ثابت» تحویلِ بیشتر از
   سفارش هیچ ریالی اضافه نمی‌سازد؛ در «تعداد واقعی» هر نسخهٔ پذیرفته‌شده نرخِ خودش را دارد.

   هیچ ریالی گم یا دوبار طلب نمی‌شود: برای هر ردیف «هدفِ انباشته» حساب می‌شود و
   سودِ خدمات، تخفیف و مالیات همه تابعِ یکسانِ مبلغِ انباشته‌اند؛ صورتحسابِ تازه
   اختلافِ هدف با آنچه پیش‌تر در دفترِ صورتحساب ثبت شده می‌گیرد. پس جمعِ فاکتورهای
   جزئی، سر به سر، به مبلغِ تأییدشده می‌رسد. همه‌جا ریالِ صحیح. */

const { percentOf } = require('./pricing');

const CONTRACT_MODES = ['ثابت', 'تعداد واقعی'];
const FIXED_PRICE = 'ثابت';
const REAL_COUNT = 'تعداد واقعی';
const COPY_UNIT = 'نسخه';
const PER_COPY = 'per_copy';
const FIXED = 'fixed';

function whole(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : (Number.isFinite(n) ? Math.round(n) : 0);
}
/* تقسیمِ صحیح رو به پایین: ریالی که هنوز تحویل نشده، طلب نمی‌شود. */
function floorDiv(numerator, denominator) {
  if (!(whole(denominator) > 0)) return 0;
  return Number(BigInt(whole(numerator)) / BigInt(whole(denominator)));
}
function text(value, label, max) {
  const out = String(value ?? '').trim();
  if (out.length > max) throw new Error(`${label} بیش از ${max} نویسه است.`);
  return out;
}
function copies(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12) throw new Error(`${label} باید عددِ صحیحِ صفر یا مثبت باشد.`);
  return n;
}
function isoDay(value, label) {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new Error(`${label} باید تاریخ روز باشد.`);
  return day;
}

/* حالتِ قرارداد از خودِ پیش‌فاکتورِ تأییدشده می‌آید، نه از سفارشِ باز: عوض‌کردنِ حالت
   نسخهٔ جدید پیش‌فاکتور و تأییدِ دوبارهٔ مشتری را می‌خواهد (همان قاعدهٔ save_quote). */
function contractMode(pricing) {
  const mode = pricing && pricing.input ? pricing.input.contractMode : undefined;
  return CONTRACT_MODES.includes(mode) ? mode : FIXED_PRICE;
}

/* سه عددِ هر قلم، بدون حدس. good = null یعنی «هنوز ثبت نشده»، که با صفر فرق دارد. */
function itemQuantities(item) {
  const source = item && typeof item === 'object' ? item : {};
  const ordered = copies(source.qty ?? 0, 'تعداد سفارش‌شده');
  const raw = source.quality ? source.quality.good : undefined;
  const good = raw === undefined || raw === null || raw === '' ? null : copies(raw, 'تعداد سالم');
  const delivered = (source.deliveries || []).reduce((sum, row) => sum + copies((row && row.billable) || 0, 'تعداد تحویلی'), 0);
  return { ordered, good, delivered, remaining: Math.max(0, ordered - delivered) };
}

/* واحدِ ردیف == واحدِ تحویلِ قلم ← ردیفِ «هر نسخه‌ای»؛ در غیر آن ثابت.
   ردیفی که به قلمی وصل نیست ثابت حساب می‌شود: بی‌مبنای قلم، مقیاس معنا ندارد. */
function lineRole(line, item) {
  const unit = String((line && line.unit) || '').trim();
  const copyUnit = String((item && item.qtyUnit) || COPY_UNIT).trim();
  return item && unit && unit === copyUnit ? PER_COPY : FIXED;
}

/* ردیف‌های پولیِ پیش‌فاکتور (آفر مبلغ ندارد، پس در صورتحساب جایی ندارد). */
function linesOf(pricing) {
  const result = (pricing && pricing.result) || {};
  return [
    ...(result.materials || []).map(line => ({ ...line, kind: 'materials' })),
    ...(result.services || []).map(line => ({ ...line, kind: 'services' })),
  ];
}

/* هدفِ انباشتهٔ یک ردیف تا امروز: چند ریال و چند عدد از این ردیف باید طلب شده باشد. */
function lineTarget(line, role, quantities, mode) {
  const cost = whole(line.cost);
  if (role === FIXED || !whole(quantities.ordered)) return { amount: cost, qty: line.qty };
  const counted = mode === REAL_COUNT ? quantities.delivered : Math.min(quantities.delivered, quantities.ordered);
  return { amount: floorDiv(cost * counted, quantities.ordered), qty: counted };
}

/* رکوردِ کنترلِ کیفیت: فقط «سالم» و شرح. تعدادِ سالم سقفِ سفارش ندارد (تولیدِ اضافه ممکن است). */
function qualityOf(input, actor = {}) {
  if (!input || typeof input !== 'object') throw new Error('اطلاعات کنترل کیفیت معتبر نیست.');
  return {
    good: copies(input.good, 'تعداد سالم'),
    note: text(input.note, 'شرح کنترل کیفیت', 2000),
    at: isoDay(input.at, 'تاریخ کنترل کیفیت'),
    by: { id: String(actor.id || ''), name: String(actor.name || ''), role: String(actor.role || '') },
  };
}
/* رسیدِ تحویل: هر تحویلِ بخشی یک ردیفِ تازه است و هیچ ردیفِ قبلی عوض نمی‌شود؛
   پس «چه چیزی و کِی تحویل شده» در خودِ قلم می‌ماند و قابل ردیابی است. */
function deliveryOf(input, actor = {}) {
  if (!input || typeof input !== 'object') throw new Error('اطلاعات تحویل معتبر نیست.');
  const id = text(input.id, 'شناسهٔ تحویل', 100);
  if (!id) throw new Error('شناسهٔ تحویل را سرور می‌سازد؛ درخواستِ بی‌شناسه رد می‌شود.');
  return {
    id,
    billable: copies(input.billable, 'تعداد تحویل‌قابل‌صورتحساب'),
    note: text(input.note, 'شرح تحویل', 2000),
    at: isoDay(input.at, 'تاریخ تحویل'),
    by: { id: String(actor.id || ''), name: String(actor.name || ''), role: String(actor.role || '') },
  };
}

/* جمع‌های سند از یک قاعدهٔ واحد می‌آید: تابعِ مبلغِ انباشتهٔ ردیف‌ها. همِین باعث
   می‌شود اختلافِ دو حالت، همیشه عددِ صحیحِ همان صورتحساب باشد. */
function totalsAt(approved, grossCost, serviceCost) {
  const approvedSubtotal = whole(approved.subtotal);
  const markup = whole(approved.servicesCost) ? floorDiv(whole(approved.serviceMarkupAmount) * serviceCost, whole(approved.servicesCost)) : 0;
  const subtotal = grossCost + markup;
  const discount = approvedSubtotal ? Math.min(whole(approved.discount), floorDiv(whole(approved.discount) * subtotal, approvedSubtotal)) : 0;
  const taxable = subtotal - discount;
  const tax = percentOf(taxable, approved.taxPercent || 0, 'مالیات');
  return { grossCost, markup, subtotal, discount, taxable, tax, total: taxable + tax, serviceCost };
}

/* ردیف به کدام قلم تعلق دارد؟ شناسهٔ صریح مقدم است؛ در سفارشِ تک‌قلمی همان یک قلم
   مبناست (پیش‌فاکتورهای امروز همه بی‌شناسه‌اند و باید فاکتور جزئی بگیرند)، و در
   سفارشِ چندقلمی بی‌شناسه یعنی «ردیفِ کلِ سفارش» که یک‌بار طلب می‌شود. */
function itemOfLine(line, items) {
  if (line.itemId) return items.get(line.itemId) || null;
  return items.size === 1 ? [...items.values()][0] : null;
}

/* پیشنهادِ صورتحسابِ بعدی.
   billedRows: ردیف‌های دفترِ صورتحسابِ همین نسخه از فاکتورهای زنده — { lineId, amount, qty }. */
function invoiceProposal(order, pricing, billedRows = []) {
  const mode = contractMode(pricing);
  const approved = (pricing && pricing.result) || {};
  const items = new Map((order.items || []).map(item => [item.id, item]));
  const lines = linesOf(pricing);
  const kindOf = new Map(lines.map(line => [line.id, line.kind]));
  const billedByLine = new Map();
  const warnings = [];
  for (const row of billedRows) {
    if (!kindOf.has(row.lineId)) { warnings.push('ردیفِ صورتحسابِ پیشین در پیش‌فاکتورِ این نسخه نیست؛ مبلغش در سقفِ امروز حساب نمی‌شود.'); continue; }
    const previous = billedByLine.get(row.lineId) || { amount: 0, qty: 0 };
    billedByLine.set(row.lineId, { amount: previous.amount + whole(row.amount), qty: previous.qty + whole(row.qty) });
  }
  const rows = [];
  let cumGross = 0, cumService = 0, billedGross = 0, billedService = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(whole(line.cost))) throw new Error(`مبلغ ردیف «${line.description}» عددِ صحیحِ ریالی نیست.`);
    const item = itemOfLine(line, items);
    if (!line.itemId && items.size > 1) warnings.push(`ردیف «${line.description}» به هیچ قلم سفارش وصل نیست و یک‌بارِ کامل صورتحساب می‌شود.`);
    if (line.itemId && !item) warnings.push(`ردیف «${line.description}» به قلمی وصل است که در سفارش نیست؛ پیش از صدور فاکتور باید اصلاح شود.`);
    const role = lineRole(line, item);
    const target = lineTarget(line, role, itemQuantities(item || {}), mode);
    const already = billedByLine.get(line.id) || { amount: 0, qty: 0 };
    cumGross += target.amount;
    if (line.kind === 'services') cumService += target.amount;
    billedGross += already.amount;
    if (line.kind === 'services') billedService += already.amount;
    if (already.amount > target.amount) warnings.push(`ردیف «${line.description}» بیشتر از مقدارِ تحویلیِ امروز صورتحساب شده است؛ پیش از فاکتورِ بعدی باید سندِ اصلاحی بخواند (بند ۴).`);
    const amount = Math.max(0, target.amount - already.amount);
    if (amount <= 0) continue;
    rows.push({
      itemId: line.itemId || '', lineId: line.id, kind: line.kind, role,
      description: line.description, itemCode: line.itemCode || '', unit: line.unit || '',
      qty: role === PER_COPY ? Math.max(0, whole(target.qty) - whole(already.qty)) : line.qty,
      cumulativeQty: target.qty, cumulativeAmount: target.amount, amount,
      rate: line.rate, cost: line.cost, customerSupplied: line.customerSupplied === true,
    });
  }
  const cumulative = totalsAt(approved, cumGross, cumService);
  const previous = totalsAt(approved, billedGross, billedService);
  const slice = {
    grossAmount: cumulative.grossCost - previous.grossCost,
    markupAmount: cumulative.markup - previous.markup,
    subtotal: cumulative.subtotal - previous.subtotal,
    discountAmount: cumulative.discount - previous.discount,
    taxableAmount: cumulative.taxable - previous.taxable,
    taxAmount: cumulative.tax - previous.tax,
    totalAmount: cumulative.total - previous.total,
  };
  return {
    mode, rows, totals: slice, cumulative, warnings: [...new Set(warnings)],
    items: [...items.values()].map(item => ({ itemId: item.id, label: item.productName || item.productType || '', ...itemQuantities(item) })),
  };
}

/* خروجی به شکلِ یک resultِ پیش‌فاکتور، تا سازندهٔ فاکتورِ موجود (buildInvoiceData)
   بدون تغییرِ تازه‌ای تخصیصِ بزرگ‌ترین‌باقی‌مانده را انجام دهد و جمعِ ردیف‌ها با
   جمعِ سند یکی بماند. */
function partialQuoteResult(pricing, proposal) {
  const approved = pricing.result;
  const pick = kind => proposal.rows.filter(row => row.kind === kind).map(row => ({
    id: row.lineId, description: row.description, itemCode: row.itemCode, unit: row.unit,
    qty: row.qty, rate: row.rate, cost: row.amount, customerSupplied: row.customerSupplied,
  }));
  const materials = pick('materials');
  const services = pick('services');
  return {
    currency: approved.currency || 'IRR', materials, services,
    /* ردیف‌های «آفر» مبلغ ندارند، پس در هیچ برشی طلب نمی‌شوند؛ اما در فاکتور می‌آیند
       تا خطِ «طرح جلد — رایگان» روی فاکتورِ تحویلی از میان نرود. */
    offers: approved.offers || [],
    materialsCost: materials.reduce((sum, row) => sum + row.cost, 0),
    servicesCost: services.reduce((sum, row) => sum + row.cost, 0),
    serviceMarkupPercent: approved.serviceMarkupPercent, serviceMarkupAmount: proposal.totals.markupAmount,
    taxPercent: approved.taxPercent, discount: proposal.totals.discountAmount,
    subtotal: proposal.totals.subtotal, discountedSubtotal: proposal.totals.taxableAmount,
    taxAmount: proposal.totals.taxAmount, total: proposal.totals.totalAmount,
  };
}

module.exports = {
  CONTRACT_MODES, FIXED_PRICE, REAL_COUNT, PER_COPY, FIXED, contractMode, itemQuantities, lineRole,
  linesOf, lineTarget, qualityOf, deliveryOf, totalsAt, invoiceProposal, partialQuoteResult, whole,
};
