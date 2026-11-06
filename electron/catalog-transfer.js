'use strict';
const crypto = require('node:crypto');
const schemas = require('./catalog-schema.json');
const digits = value => String(value ?? '').replace(/[۰-۹]/g, x => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(x))).replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[,٬،\s]/g, '').replace(/٫/g, '.');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function prepareCatalogImport(dataset, incoming, existing, customers, timestamp) {
  if (!Object.hasOwn(schemas, dataset) || !Array.isArray(incoming) || !incoming.length || incoming.length > 2000) return { ok: false, error: 'بخش معتبر و ۱ تا ۲۰۰۰ ردیف لازم است.' };
  const schema = schemas[dataset], keys = new Set(schema.fields.map(field => field[0]));
  const used = new Set(existing.map(row => row.id)), errors = [], records = [];
  incoming.forEach((raw, index) => {
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !keys.has(key))) throw new Error('ستون ناشناخته یا ساختار نامعتبر است.');
      const row = {};
      for (const [key, label, type] of schema.fields) {
        const value = raw[key] ?? '';
        if (/^(id|ownerCustomerId|nationalCode|nationalId|registerNo|economicCode|postalCode|phone|mobile|repPhone)$/.test(key) && typeof value === 'number') throw new Error(`${label}: ستون شناسه و تلفن باید در اکسل از نوع متن باشد.`);
        if (!['string', 'number'].includes(typeof value)) throw new Error(`${label}: مقدار ساده لازم است.`);
        if (type === 'number') {
          const text = digits(value);
          if (text && !/^\d+(\.\d+)?$/.test(text)) throw new Error(`${label}: عدد صفر یا مثبت لازم است.`);
          row[key] = text ? Number(text) : 0;
          if (!Number.isFinite(row[key]) || row[key] > Number.MAX_SAFE_INTEGER) throw new Error(`${label}: عدد بیش از محدوده است.`);
        } else { row[key] = String(value).trim(); if (row[key].length > 2000) throw new Error(`${label}: متن بیش از حد بلند است.`); }
      }
      if (!row.name) throw new Error('نام یا شرح الزامی است.');
      row.id ||= `import-${dataset}-${hash(row).slice(0, 24)}`;
      if (!/^[\w:-]{1,120}$/.test(row.id)) throw new Error('شناسه معتبر نیست.');
      if (used.has(row.id)) throw new Error('شناسه تکراری است؛ ورود اطلاعات فقط ردیف جدید می‌افزاید.');
      used.add(row.id);
      if (dataset === 'inventory') {
        if (!row.category || !['band_sheet', 'roll_kg', 'simple'].includes(row.unitMode)) throw new Error('دسته و نوع موجودی band_sheet، roll_kg یا simple لازم است.');
        if (!['چاپخانه', 'مشتری'].includes(row.ownerType)) throw new Error('مالک باید چاپخانه یا مشتری باشد.');
        if (row.ownerType === 'مشتری' && !customers.some(customer => customer.id === row.ownerCustomerId)) throw new Error('ابتدا مشتری مالک را با همین شناسه وارد کنید.');
        if (row.ownerType === 'چاپخانه') row.ownerCustomerId = '';
        if (row.unitMode === 'band_sheet' && !(Number.isSafeInteger(row.sheetsPerBand) && row.sheetsPerBand > 0)) throw new Error('ورق در بند باید عدد صحیح مثبت باشد.');
        if (row.unitMode === 'simple' && !row.simpleUnit) throw new Error('واحد موجودی لازم است.');
        if (!Number.isSafeInteger(row.unitValue)) throw new Error('ارزش ریالی واحد باید عدد صحیح باشد.');
        const qty = row.unitMode === 'band_sheet' ? row.bandCount : row.unitMode === 'roll_kg' ? row.weightKg : row.quantity;
        row.movements = [{ id: `${row.id}:opening`, date: new Date(timestamp).toISOString().slice(0, 10), type: 'in', qty, note: 'موجودی اولیه از ورود اکسل' }];
      } else {
        row.entityType ||= 'حقیقی';
        if (!['حقیقی', 'حقوقی'].includes(row.entityType)) throw new Error('نوع شخص باید حقیقی یا حقوقی باشد.');
      }
      records.push(row);
    } catch (failure) { errors.push({ row: index + 2, error: failure.message }); }
  });
  if (errors.length) return { ok: false, code: 'VALIDATION_FAILED', error: 'خطاهای ردیف‌ها را اصلاح کنید؛ هیچ داده‌ای ثبت نشده است.', errors };
  return { ok: true, records, fingerprint: hash({ dataset, incoming: records, existing }), count: records.length };
}
module.exports = { schemas, prepareCatalogImport };
