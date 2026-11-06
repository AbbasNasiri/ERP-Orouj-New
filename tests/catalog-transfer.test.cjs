const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../electron/backend');
const { prepareCatalogImport } = require('../electron/catalog-transfer');
function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-catalog-'));
  const b = createBackend({ dataDir });
  const token = b.login('admin', '1234').token;
  b.setOwnPassword(token, 'catalog-secure-password');
  t.after(() => { b.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const importRows = (dataset, rows) => { const p = b.catalogImport(token, dataset, rows); assert.equal(p.ok, true, p.error); return b.catalogImport(token, dataset, rows, { commit: true, fingerprint: p.fingerprint }); };
  return { b, token, importRows };
}
test('catalog validation rejects bad rows and preserves text identifiers including leading zeroes', () => {
  const input = [{ name: 'مشتری', phone: '۰۲۱۱۲۳۴۵۶۷۸', nationalCode: '0012345678' }];
  const one = prepareCatalogImport('customers', input, [], [], 0), two = prepareCatalogImport('customers', input, [], [], 0);
  assert.equal(one.ok, true); assert.equal(one.records[0].nationalCode, '0012345678');
  assert.equal(one.records[0].id, two.records[0].id);
  assert.equal(prepareCatalogImport('customers', input, one.records, [], 0).ok, false);
  for (const bad of [{ name: 'x', eligibility: { status: 'approved' } }, { name: 'x', phone: 1234 }, { name: '' }]) assert.equal(prepareCatalogImport('customers', [bad], [], [], 0).ok, false);
});
test('manager preview writes nothing, import backs up and preserves customer eligibility gates', t => {
  const { b, token, importRows } = fixture(t);
  const rows = [{ id: 'c1', name: 'مشتری تست', phone: '02112345678' }];
  assert.equal(b.catalogImport(null, 'customers', rows).ok, false);
  const users = b.listUsers(token).users;
  b.saveUsers(token, [...users, { id: 'f', username: 'finance', name: 'مالی', role: 'مدیر مالی', _plain: 'catalog-finance-pass' }]);
  const finance = b.login('finance', 'catalog-finance-pass').token;
  assert.equal(b.catalogImport(finance, 'customers', rows).code, 'FORBIDDEN');
  assert.equal(b.catalogImport(token, 'orders', rows).ok, false);
  assert.equal(b.catalogImport(token, 'customers', rows).ok, true);
  assert.equal((b.get(token, 'printshop_customers_v2').value || []).length, 0);
  const result = importRows('customers', rows); assert.equal(result.ok, true, result.error);
  assert.ok(fs.existsSync(result.backupFile));
  assert.equal(result.value[0].customerCode, ''); assert.equal(result.value[0].eligibility.status, 'pending');
  assert.equal(b.catalogImport(token, 'customers', rows).ok, false);
  const stock = [{ id: 'paper', name: 'کاغذ', category: 'کاغذ', ownerType: 'مشتری', ownerCustomerId: 'c1', unitMode: 'band_sheet', sheetsPerBand: '۵۰۰', bandCount: '۲', unitValue: '۱٬۰۰۰' }];
  const inventory = importRows('inventory', stock); assert.equal(inventory.ok, true, inventory.error);
  assert.equal(inventory.value[0].bandCount, 2); assert.equal(inventory.value[0].movements[0].qty, 2);
  assert.ok(inventory.value[0].movements[0].movementNumber);
});
test('import rights equal the write rights of each list, and roles without a write right stay blocked', t => {
  const { b, token } = fixture(t);
  const users = b.listUsers(token).users;
  b.saveUsers(token, [...users,
    { id: 'u_clerk', username: 'clerk', name: 'کارشناس', role: 'کارشناس سفارشات', _plain: 'clerk-pass' },
    { id: 'u_stock', username: 'stock', name: 'انبار', role: 'انباردار', _plain: 'stock-pass' },
    { id: 'u_fin', username: 'fin', name: 'مالی', role: 'مدیر مالی', _plain: 'fin-pass' },
    { id: 'u_sup', username: 'sup', name: 'سرپرست', role: 'سرپرست چاپ', _plain: 'sup-pass' },
  ]);
  const login = user => b.login(user, `${user}-pass`).token;
  const clerk = login('clerk'), stock = login('stock'), fin = login('fin'), sup = login('sup');
  const customers = [{ id: 'c1', name: 'مشتری اکسل' }];
  const suppliers = [{ id: 's1', name: 'تأمین‌کننده اکسل' }];
  const inventory = [{ id: 'p1', name: 'کاغذ', category: 'کاغذ', ownerType: 'چاپخانه', unitMode: 'simple', simpleUnit: 'کیلوگرم', quantity: '5', unitValue: '1000' }];
  assert.equal(b.catalogImport(clerk, 'customers', customers).ok, true);
  assert.equal(b.catalogImport(clerk, 'inventory', inventory).code, 'FORBIDDEN');
  assert.equal(b.catalogImport(clerk, 'suppliers', suppliers).code, 'FORBIDDEN');
  assert.equal(b.catalogImport(stock, 'customers', customers).ok, true);
  assert.equal(b.catalogImport(stock, 'inventory', inventory).ok, true);
  assert.equal(b.catalogImport(stock, 'suppliers', suppliers).ok, true);
  assert.equal(b.catalogImport(fin, 'suppliers', suppliers).ok, true);
  assert.equal(b.catalogImport(fin, 'customers', customers).code, 'FORBIDDEN');
  assert.equal(b.catalogImport(fin, 'inventory', inventory).code, 'FORBIDDEN');
  assert.equal(b.catalogImport(sup, 'customers', customers).code, 'FORBIDDEN');
  assert.equal(b.catalogImport(sup, 'suppliers', suppliers).code, 'FORBIDDEN');
  assert.equal(b.catalogImport(sup, 'inventory', inventory).code, 'FORBIDDEN');
  const preview = b.catalogImport(clerk, 'customers', customers);
  const done = b.catalogImport(clerk, 'customers', customers, { commit: true, fingerprint: preview.fingerprint });
  assert.equal(done.ok, true, done.error);
  assert.ok(fs.existsSync(done.backupFile));
  assert.equal(done.value[0].eligibility.status, 'pending');
});
test('stale previews, invalid rows, backup failure and audit failure leave the catalog unchanged', t => {
  const { b, token, importRows } = fixture(t);
  const rows = [{ id: 's1', name: 'تأمین‌کننده' }];
  const p = b.catalogImport(token, 'suppliers', rows);
  assert.equal(importRows('suppliers', [{ id: 's2', name: 'دیگری' }]).ok, true);
  assert.equal(b.catalogImport(token, 'suppliers', rows, { commit: true, fingerprint: p.fingerprint }).code, 'STALE_IMPORT');
  const before = b.get(token, 'printshop_suppliers_v2').value;
  assert.equal(b.catalogImport(token, 'suppliers', [...rows, { id: 's3', name: '' }]).ok, false);
  const exec = b._db.exec;
  b._db.exec = sql => { if (/^VACUUM INTO/.test(sql)) throw new Error('backup unavailable'); return exec(sql); };
  assert.equal(importRows('suppliers', rows).ok, false); b._db.exec = exec;
  const run = b._db.run;
  b._db.run = (sql, ...args) => { if (/INSERT INTO audit_log/.test(sql) && args.includes('catalog_import')) throw new Error('audit unavailable'); return run(sql, ...args); };
  assert.equal(importRows('suppliers', rows).ok, false); b._db.run = run;
  assert.deepEqual(b.get(token, 'printshop_suppliers_v2').value, before);
});
