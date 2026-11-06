'use strict';
const { calculateQuote, offsetPrintCost } = require('./pricing');
const { CONTRACT_MODES } = require('./billing');
const fail = message => { const error = new Error(message); error.code = 'VALIDATION_FAILED'; throw error; };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} معتبر نیست.`);
  return value.trim();
}
function numeric(value, label, { integer = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || integer && !Number.isSafeInteger(value)) fail(`${label} معتبر نیست.`);
  return value;
}
function normalizeQuote(input, { now = Date.now } = {}) {
  if (!object(input)) fail('اطلاعات پیش‌فاکتور باید ساختار معتبر داشته باشد.');
  if (input.currency !== undefined && input.currency !== 'IRR') fail('واحد مالی پیش‌فاکتور باید ریال باشد.');
  const effectiveDate = input.effectiveDate === undefined ? new Date(now()).toISOString().slice(0, 10) : input.effectiveDate;
  if (typeof effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(effectiveDate)) || new Date(effectiveDate).toISOString().slice(0, 10) !== effectiveDate) fail('تاریخ مبنای نرخ معتبر نیست.');
  const ids = new Set();
  function lines(value, kind) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 500) fail('تعداد ردیف‌های پیش‌فاکتور معتبر نیست.');
    return value.map((line, index) => {
      if (!object(line)) fail('ردیف پیش‌فاکتور معتبر نیست.');
      const id = text(line.id, 'شناسه ردیف', 100);
      if (ids.has(id)) fail('شناسه ردیف‌های پیش‌فاکتور نباید تکراری باشد.');
      ids.add(id);
      const out = { id, description: text(line.description, 'شرح ردیف') };
      /* اصلاحات ۱۷/بند ۳: ردیف می‌گوید به کدام قلمِ سفارش تعلق دارد تا صورتحسابِ جزئی
         بداند کدام مبلغ با تعدادِ تحویلی مقیاس می‌شود. کلید فقط وقتی نوشته می‌شود که
         داده شده باشد — وگرنه پیش‌فاکتورهای ذخیره‌شده در بازرسیِ «سازگار با محاسبهٔ سرور»
         رد می‌شوند، چون آن کلید را ندارند. */
      if (line.itemId !== undefined && line.itemId !== null && line.itemId !== '') out.itemId = text(line.itemId, 'شناسه قلم ردیف', 100);
      if (line.itemCode !== undefined && line.itemCode !== null && line.itemCode !== '') {
        if (typeof line.itemCode !== 'string') fail('شناسه کالا یا خدمت باید متن رقمی باشد؛ خالی به معنی ثبت نشده است.');
        const code = line.itemCode.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).trim();
        if (!/^\d{1,13}$/.test(code)) fail('شناسه کالا یا خدمت باید فقط رقم و حداکثر ۱۳ رقم باشد؛ کدهای کوتاه‌تر با صفر تکمیل می‌شوند.');
        out.itemCode = code.padStart(13, '0');
      }
      if (kind === 'offers') {
        if (line.internalCost !== undefined && line.internalCost !== null) out.internalCost = numeric(line.internalCost, 'هزینه داخلی آفر', { integer: true });
        return out;
      }
      out.unit = text(line.unit, 'واحد ردیف', 80);
      if (kind === 'services' && line.offset !== undefined) {
        if (!object(line.offset)) fail('مشخصات چاپ افست معتبر نیست.');
        const offset = {
          plates: numeric(line.offset.plates, 'تعداد زینک', { integer: true, max: 1000000 }),
          run: numeric(line.offset.run, 'تیراژ چاپ', { integer: true, max: 1e12 }),
          ratePerBlock: numeric(line.offset.ratePerBlock, 'نرخ نوبت چاپ', { integer: true }),
          blockSize: line.offset.blockSize === undefined ? 5000 : numeric(line.offset.blockSize, 'حد نوبت چاپ', { integer: true, max: 1e12 }),
        };
        if (line.offset.mode !== undefined) offset.mode = line.offset.mode;
        try { out.rate = offsetPrintCost(offset); } catch (e) { fail(e.message); }
        out.qty = 1;
        out.offset = offset;
      } else {
        out.qty = numeric(line.qty, `مقدار ردیف ${index + 1}`, { max: 1e12 });
        out.rate = numeric(line.rate, `نرخ ردیف ${index + 1}`, { integer: true });
      }
      if (kind === 'materials') {
        if (line.customerSupplied !== undefined && typeof line.customerSupplied !== 'boolean') fail('مالکیت مواد باید مشخص باشد.');
        out.customerSupplied = line.customerSupplied === true;
      }
      return out;
    });
  }
  if (input.contractMode !== undefined && !CONTRACT_MODES.includes(input.contractMode)) fail('حالت قرارداد باید «ثابت» یا «تعداد واقعی» باشد.');
  const normalized = {
    currency: 'IRR', effectiveDate,
    materials: lines(input.materials, 'materials'), services: lines(input.services, 'services'), offers: lines(input.offers, 'offers'),
    serviceMarkupPercent: numeric(input.serviceMarkupPercent === undefined ? 0 : input.serviceMarkupPercent, 'سود خدمات', { max: 1000 }),
    taxPercent: numeric(input.taxPercent === undefined ? 0 : input.taxPercent, 'درصد مالیات', { max: 100 }),
    discount: numeric(input.discount === undefined ? 0 : input.discount, 'تخفیف', { integer: true }),
    /* همان ملاحظهٔ backward-compatible: بدونِ این کلید یعنی پیش‌فاکتورِ قدیمی، که
       قاعدهٔ کارفرما آن را «قیمت ثابت» می‌گیرد (billing.contractMode). */
    ...(input.contractMode === undefined ? {} : { contractMode: input.contractMode }),
  };
  if (!normalized.materials.length && !normalized.services.length && !normalized.offers.length) fail('حداقل یک ردیف پیش‌فاکتور لازم است.');
  return normalized;
}
function computeQuote(input, options) {
  const normalized = normalizeQuote(input, options);
  try { return { input: normalized, result: calculateQuote(normalized) }; }
  catch (e) { fail(e.message); }
}
module.exports = { normalizeQuote, computeQuote };
