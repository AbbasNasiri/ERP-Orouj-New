import * as XLSX from 'xlsx';
import schemas from '../electron/catalog-schema.json';
export { schemas as catalogSchemas };
export function catalogSheets(dataset, records = []) {
  const schema = schemas[dataset];
  if (!schema) throw new Error('بخش انتقال نامعتبر است.');
  return [
    { name: schema.label, rows: [schema.fields.map(field => field[1]), ...records.map(row => schema.fields.map(([key, , type]) => type === 'number' ? Number(row[key] || 0) : String(row[key] ?? '')))] },
    { name: 'راهنما', rows: [['قالب', 'printshop-catalog-v1'], ['بخش', dataset], ['روش', 'فقط افزودن؛ شناسه تکراری رد می‌شود.'], ['مشتری', 'شماره و تأیید صلاحیت از مسیر مدیر صادر می‌شود.'], ['انبار', 'مقدار ورودی، موجودی اولیه قلم جدید است؛ گردش آغاز دوره ثبت می‌شود.'], ['شناسه‌ها', 'شناسه، کد ملی و تلفن را به صورت متن نگه دارید.'], ['نوع موجودی', 'band_sheet = بند؛ roll_kg = وزن؛ simple = تعداد'] ] },
  ];
}

const normalizeLabel = value => String(value ?? '')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[\u200c\u200e\u200f]/g, '')
  .replace(/[\s:：_\-–—()\[\]{}«»]/g, '')
  .toLowerCase();

const guideSheet = book => book.SheetNames.find(name => normalizeLabel(name) === normalizeLabel('راهنما'));
function guideDataset(book) {
  const name = guideSheet(book);
  if (!name) return null;
  const meta = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, sheetRows: 20 });
  if (String(meta?.[0]?.[1] ?? '').trim() !== 'printshop-catalog-v1') return null;
  const dataset = String(meta?.[1]?.[1] ?? '').trim();
  return Object.hasOwn(schemas, dataset) ? dataset : null;
}

function headerOf(grid, labels) {
  const wanted = labels.map(normalizeLabel);
  let best = null;
  for (let index = 0; index < Math.min(grid.length, 12); index++) {
    const cells = (grid[index] || []).map(normalizeLabel);
    const matched = wanted.filter(label => cells.includes(label)).length;
    if (!best || matched > best.matched) best = { index, matched };
  }
  return best && best.matched >= Math.min(3, labels.length) ? best : null;
}

function sheetGrid(book, name) {
  return XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: '', sheetRows: 2050 });
}

export function readCatalogWorkbookDetails(bytes, dataset) {
  if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('فایل باید کمتر از ۵ مگابایت باشد.');
  const schema = schemas[dataset]; if (!schema) throw new Error('بخش انتقال نامعتبر است.');
  const book = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false });
  const declared = guideDataset(book);
  if (declared && declared !== dataset) throw new Error(`قالب این فایل برای بخش «${schemas[declared].label}» است؛ بخش درست را انتخاب کنید.`);
  const labels = schema.fields.map(field => field[1]);
  const named = book.SheetNames.find(name => normalizeLabel(name) === normalizeLabel(schema.label));
  const candidates = named ? [named] : book.SheetNames.filter(name => name !== guideSheet(book));
  let target = null;
  for (const name of candidates) {
    const grid = sheetGrid(book, name);
    const header = headerOf(grid, labels);
    if (!header) continue;
    if (!target || header.matched > target.header.matched) target = { name, grid, header };
    if (named) break;
  }
  if (!target) throw new Error(`شمای مربوط به «${schema.label}» در فایل پیدا نشد؛ حداقل ستون‌های نام، دسته و شرح لازم است.`);
  const headerRow = target.grid[target.header.index].map(normalizeLabel);
  const columnOf = new Map();
  schema.fields.forEach(([key, label]) => {
    const index = headerRow.indexOf(normalizeLabel(label));
    if (index >= 0) columnOf.set(key, index);
  });
  const rows = target.grid.slice(target.header.index + 1)
    .filter(row => (row || []).some(cell => cell !== '' && cell !== null && cell !== undefined))
    .map(row => Object.fromEntries(schema.fields.map(([key]) => [key, columnOf.has(key) ? row[columnOf.get(key)] ?? '' : ''])));
  if (!rows.length || rows.length > 2000) throw new Error('فایل باید بین ۱ تا ۲۰۰۰ ردیف داده داشته باشد.');
  const headerCells = target.grid[target.header.index] || [];
  const known = new Set(labels.map(normalizeLabel));
  return {
    rows,
    sheet: target.name,
    headerRow: target.header.index + 1,
    recognized: schema.fields.filter(([key]) => columnOf.has(key)).map(([, label]) => label),
    missing: schema.fields.filter(([key]) => !columnOf.has(key)).map(([, label]) => label),
    ignored: [...new Set(headerCells.map(cell => String(cell ?? '').trim()).filter(cell => cell && !known.has(normalizeLabel(cell))))],
  };
}

export function readCatalogWorkbook(bytes, dataset) {
  return readCatalogWorkbookDetails(bytes, dataset).rows;
}
