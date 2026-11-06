const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const XLSX = require('xlsx');
const compiled = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/catalog-workbook.mjs')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['xlsx'] }).outputFiles[0].text;
const mod = { exports: {} }; new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports);
const { catalogSheets, readCatalogWorkbook, readCatalogWorkbookDetails } = mod.exports;
function bytes(sheets) {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
test('catalog workbook round trip preserves string identifiers and numeric stock quantities', () => {
  const customers = [{ id: 'c1', name: 'مشتری', phone: '02100001234', nationalCode: '0012345678' }];
  const result = readCatalogWorkbook(bytes(catalogSheets('customers', customers)), 'customers');
  assert.equal(result[0].nationalCode, '0012345678'); assert.equal(result[0].phone, customers[0].phone);
  const inventory = readCatalogWorkbook(bytes(catalogSheets('inventory', [{ id: 'p1', name: 'کاغذ', bandCount: 1.25, unitValue: 4500000 }])), 'inventory');
  assert.equal(inventory[0].bandCount, 1.25); assert.equal(inventory[0].unitValue, 4500000);
});
test('catalog workbook rejects another dataset, empty templates and oversized row sets', () => {
  const sheets = catalogSheets('customers', [{ id: 'c1', name: 'مشتری' }]);
  assert.throws(() => readCatalogWorkbook(bytes(sheets), 'suppliers'), /قالب/);
  assert.throws(() => readCatalogWorkbook(bytes(catalogSheets('customers')), 'customers'), /۲۰۰۰/);
  assert.throws(() => readCatalogWorkbook(bytes(catalogSheets('customers', Array.from({ length: 2001 }, (_, i) => ({ id: `c${i}`, name: 'مشتری' })))), 'customers'), /۲۰۰۰/);
});

test('catalog workbook tolerates a missing column and leaves it blank for correction in the form', () => {
  const sheets = catalogSheets('customers', [{ id: 'c1', name: 'مشتری', phone: '02100001234' }]);
  sheets[0].rows[0][0] = 'تغییر';
  const result = readCatalogWorkbook(bytes(sheets), 'customers');
  assert.equal(result[0].id, '');
  assert.equal(result[0].name, 'مشتری');
  assert.equal(result[0].phone, '02100001234');
});

test('catalog workbook finds the header below a title row and accepts reordered extra columns without a guide sheet', () => {
  const rows = [
    ['گزارش مشتریان کارگاه'],
    ['ردیف', ' نام ', 'تلفن', 'شناسه', 'ستون اضافه'],
    [1, 'مشتری الف', '02100001234', 'c1', 'دورریز'],
  ];
  const result = readCatalogWorkbook(bytes([{ name: 'Sheet1', rows }]), 'customers');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'مشتری الف');
  assert.equal(result[0].phone, '02100001234');
  assert.equal(result[0].id, 'c1');
  assert.equal(Object.hasOwn(result[0], 'ستون اضافه'), false);
  assert.equal(result[0].nationalCode, '');
});

test('catalog workbook explains a legacy export: sheet, header row, ignored and missing columns', () => {
  const rows = [
    ['فهرست مشتریان — سیستم قدیم'],
    ['نام', 'تلفن', 'شناسه', 'یادداشت اضافه', 'نشانی', 'کد ملی'],
    ['کتابسرای فرهنگ', '02112345678', 'ext-1001', 'واردشده از اکسل قدیم', 'تهران، خیابان انقلاب', '0012345678'],
    ['فروشگاه لوازم تحریر روشن', 9123456789, 'ext-1002', 'شماره به صورت عدد', 'تهران، بازار', ''],
  ];
  const details = readCatalogWorkbookDetails(bytes([{ name: 'مشتریان', rows }]), 'customers');
  assert.equal(details.sheet, 'مشتریان');
  assert.equal(details.headerRow, 2);
  assert.deepEqual(details.ignored, ['یادداشت اضافه']);
  assert.deepEqual(details.missing, ['نوع شخص', 'همراه', 'شناسه ملی', 'شماره ثبت', 'کد اقتصادی', 'کد پستی', 'یادداشت']);
  assert.equal(details.rows.length, 2);
  assert.equal(details.rows[0].nationalCode, '0012345678');
  assert.equal(details.rows[1].phone, 9123456789);
  assert.equal(details.rows[1].postalCode, '');
});
