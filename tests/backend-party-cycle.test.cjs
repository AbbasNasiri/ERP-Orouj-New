'use strict';
/* چرخهٔ تعریف ← تأیید ← کد یکتا برای تأمین‌کننده، plus فعال/غیرفعال و «حذف از بانک» */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const SUP = 'printshop_suppliers_v2';
const CUS = 'printshop_customers_v2';
const OK_REASON = 'محوال و آدرس قابل بررسی است';
function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-party-'));
  const b = createBackend({ dataDir: dir, openDb });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-party-pass');
  const users = b.listUsers(manager).users;
  users.push({ id: 'storekeeper', name: 'انباردار', username: 'storekeeper', role: 'انباردار', _plain: 'strong-party-pass' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const store = b.login('storekeeper', 'strong-party-pass').token;
  assert.equal(b.set(manager, SUP, [{ id: 's1', name: 'تأمین‌کننده اول', phone: '02100000001' }, { id: 's2', name: 'تأمین‌کننده دوم' }]).ok, true);
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const act = (kind, id, action, payload) => b.partyAction(manager, kind, id, action, payload);
  const approve = (kind, id) => { assert.equal(act(kind, id, 'approve', { reason: OK_REASON }).ok, true); assert.equal(act(kind, id, 'issue_number').ok, true); };
  return { b, dir, manager, store, act, approve };
}
test('suppliers follow the same cycle: definition, approval, then a unique S code', t => {
  const { b, manager, store, act } = fixture(t);
  assert.equal(b.get(manager, SUP).value[0].eligibility.status, 'pending', 'رکورد تازه در انتظار بررسی است');
  assert.equal(b.get(manager, SUP).value[0].supplierCode, '');
  assert.equal(b.partyAction(store, 'supplier', 's1', 'approve', { reason: OK_REASON }).code, 'FORBIDDEN');
  assert.equal(act('supplier', 's1', 'issue_number').ok, false, 'کد پیش از تأیید صادر نمی‌شود');
  assert.equal(act('supplier', 's1', 'approve', { reason: OK_REASON }).supplier.eligibility.status, 'approved');
  const coded = act('supplier', 's1', 'issue_number');
  assert.equal(coded.supplier.supplierCode, 'S-000001');
  assert.equal(coded.supplier.active, true);
  assert.equal(act('supplier', 's1', 'issue_number').ok, false, 'کد دوم برای همان رکورد');
  assert.equal(act('supplier', 's1', 'reject').ok, false, 'رد بدون دلیل');
  const rejected = act('supplier', 's1', 'reject', { reason: 'محل عرضه نامعتبر است' });
  assert.equal(rejected.supplier.active, false, 'رد شدن یعنی غیرفعال');
  assert.equal(b._db.get('SELECT value FROM meta WHERE key = ?', 'supplier_code_sequence').value, '1');
});
test('customer and supplier code series are independent', t => {
  const { b, manager, approve, act } = fixture(t);
  assert.equal(b.set(manager, CUS, [{ id: 'c1', name: 'مشتری الف' }]).ok, true);
  approve('customer', 'c1');
  approve('supplier', 's2');
  assert.equal(b.get(manager, CUS).value[0].customerCode, 'C-000001');
  assert.equal(b.get(manager, SUP).value.find(s => s.id === 's2').supplierCode, 'S-000001');
  assert.equal(act('supplier', 's1', 'approve', { reason: OK_REASON }).ok, true);
  assert.equal(act('supplier', 's1', 'issue_number').supplier.supplierCode, 'S-000002');
});
test('generic writes cannot forge supplier codes, eligibility or active state', t => {
  const { b, manager, store, approve } = fixture(t);
  const initial = b.get(manager, SUP).value;
  assert.equal(b.set(manager, SUP, [...initial, { id: 'forged', supplierCode: 'S-000077', eligibility: { status: 'approved' } }]).ok, false);
  approve('supplier', 's1');
  const original = b.get(manager, SUP).value;
  for (const token of [manager, store]) for (const mutate of [s => { s.supplierCode = 'S-000099'; }, s => { s.eligibility.status = 'pending'; }, s => { delete s.eligibility; }, s => { s.active = false; }]) {
    const forged = structuredClone(original); mutate(forged[0]);
    assert.equal(b.set(token, SUP, forged).code, 'FORBIDDEN', 'تولیدِ مجددِ کد/صلاحیت/فعال از مسیر عمومی مسدود است');
  }
  assert.equal(b.set(manager, SUP, original.filter(s => s.id !== 's1')).ok, false, 'تأمین‌کننده کددار از مسیر عمومی حذف نمی‌شود');
  assert.equal(b.del(manager, SUP).ok, false, 'حذف کل مجموعهٔ بررسی‌شده مسدود است');
  const edited = structuredClone(original); edited[1].name = 'نام اصلاح‌شده';
  assert.equal(b.set(store, SUP, edited).ok, true, 'ویرایش اطلاعات معمولی تأمین‌کننده مجاز است');
});
test('active or inactive toggling works for suppliers in any review state', t => {
  const { b, manager, act } = fixture(t);
  assert.equal(act('supplier', 's2', 'deactivate').supplier.active, false);
  assert.equal(act('supplier', 's2', 'activate').supplier.active, true);
  assert.equal(act('supplier', 's2', 'approve', { reason: OK_REASON }).supplier.active, true);
  assert.equal(act('supplier', 's2', 'deactivate').supplier.active, false);
  assert.equal(act('supplier', 's2', 'issue_number').ok, false, 'تأمین‌کننده غیرفعال کد نمی‌گیرد');
  assert.equal(act('supplier', 's2', 'activate').ok, true);
  assert.equal(act('supplier', 's2', 'issue_number').supplier.supplierCode, 'S-000001');
});
test('erase is refused for approved or coded parties and allowed for a rejected one', t => {
  const { b, manager, act, approve } = fixture(t);
  approve('supplier', 's1');
  assert.equal(act('supplier', 's1', 'erase').ok, false, 'دارای کد حذف کامل نمی‌شود');
  assert.equal(act('supplier', 's2', 'approve', { reason: OK_REASON }).ok, true);
  assert.equal(act('supplier', 's2', 'erase').ok, false, 'تأییدشده حذف کامل نمی‌شود؛ مسیر صحیح غیرفعال کردن است');
  assert.equal(act('supplier', 's2', 'reject', { reason: 'مدرک معتبر ارائه نشد' }).ok, true);
  assert.equal(act('supplier', 's2', 'erase').ok, true, 'ردشده و بدون کد از بانک حذف می‌شود');
  assert.deepEqual(b.get(manager, SUP).value.map(s => s.id), ['s1']);
  assert.equal(b._db.get('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?', 'supplier_erase').n, 1, 'حذف از بانک در گزارش ممیزی ثبت می‌شود');
});
test('a party used by orders, stock or receipts cannot be erased', t => {
  const { b, manager, act, approve } = fixture(t);
  assert.equal(b.set(manager, 'printshop_inventory_v3', [{ id: 'i1', name: 'کاغذ A4', supplierId: 's1', supplierSource: 'تامین‌کننده' }]).ok, true);
  assert.equal(b.set(manager, 'printshop_receipts_v1', [{ id: 'r1', supplierId: 's1', date: '2026-01-01' }]).ok, true);
  assert.equal(act('supplier', 's1', 'reject', { reason: 'همکاری متوقف شد' }).ok, true);
  const denied = act('supplier', 's1', 'erase');
  assert.equal(denied.ok, false);
  assert.match(denied.error, /حذف کامل ممکن نیست/);
  assert.equal(b.get(manager, SUP).value.some(s => s.id === 's1'), true, 'رکورد ارجاع‌شده در بانک می‌ماند');
  assert.equal(act('supplier', 's1', 'deactivate').supplier.active, false, 'غیرفعال کردن تنها مسیر مجاز است');
  assert.equal(b.get(manager, 'printshop_inventory_v3').value[0].supplierId, 's1', 'هیچ اطلاعات انباری پاک نمی‌شود');
});
test('legacy suppliers are grandfathered once, without codes, and new records still await review', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-legacy-sup-'));
  const first = createBackend({ dataDir: dir, openDb });
  first.login('admin', '1234');
  first.close();
  const file = path.join(dir, 'printshop.db');
  const raw = new DatabaseSync(file);
  raw.prepare("INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)").run(SUP, 'old1', 0, JSON.stringify({ id: 'old1', name: 'تأمین‌کننده قدیمی', phone: '02111111111' }), Date.now());
  raw.prepare("INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)").run(SUP, 'old2', 1, JSON.stringify({ id: 'old2', name: 'تأمین‌کننده قدیمی دوم' }), Date.now());
  raw.prepare("INSERT INTO kinds(key,kind) VALUES(?,?)").run(SUP, 'array');
  raw.prepare('DELETE FROM meta WHERE key = ?').run('party_cycle');
  raw.close();
  const b = createBackend({ dataDir: dir, openDb });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal(b.partyCycle.suppliers, 2, 'دو تأمین‌کنندهٔ پیشین محسوب شدند');
  assert.equal(b.partyCycle.customers, 0, 'بانک مشتری در این آزمون خالی است');
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-legacy-pass');
  const bank = b.get(manager, SUP).value;
  assert.deepEqual(bank.map(s => s.eligibility.status), ['approved', 'approved'], 'هیچ تأمین‌کنندهٔ فعلی از فهرست کاری حذف نمی‌شود');
  assert.deepEqual(bank.map(s => s.supplierCode), ['', ''], 'تأیید خودکار، کد صادر نمی‌کند');
  assert.equal(b.set(manager, SUP, [...bank, { id: 'new1', name: 'تأمین‌کننده جدید' }]).ok, true);
  assert.equal(b.get(manager, SUP).value.find(s => s.id === 'new1').eligibility.status, 'pending', 'رکورد جدید همچنان در انتظار بررسی است');
  const reopened = createBackend({ dataDir: dir, openDb });
  try { assert.equal(reopened.partyCycle.backfilled, 0, 'بک‌فیلد یک‌بار انجام می‌شود'); } finally { reopened.close(); }
});
test('legacy customers keep working: grandfathered as approved, coded ones stay linkable, no code collision', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-legacy-cus-'));
  const first = createBackend({ dataDir: dir, openDb });
  first.login('admin', '1234');
  first.close();
  const raw = new DatabaseSync(path.join(dir, 'printshop.db'));
  raw.prepare('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)').run(CUS, 'oldA', 0, JSON.stringify({ id: 'oldA', name: 'مشتری قدیمی الف', phone: '02122222222' }), Date.now());
  raw.prepare('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)').run(CUS, 'oldB', 1, JSON.stringify({ id: 'oldB', name: 'مشتری قدیمی ب', customerCode: 'C-000009' }), Date.now());
  raw.prepare('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)').run(CUS, 'wait', 2, JSON.stringify({ id: 'wait', name: 'در انتظارِ واقعی', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' } }), Date.now());
  raw.prepare('INSERT INTO kinds(key,kind) VALUES(?,?)').run(CUS, 'array');
  raw.prepare('DELETE FROM meta WHERE key = ?').run('party_cycle');
  raw.close();
  const b = createBackend({ dataDir: dir, openDb });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-legacy-pass');
  assert.equal(b.partyCycle.customers, 2, 'فقط رکوردهای بی‌eligibility شمارش می‌شوند');
  const bank = b.get(manager, CUS).value;
  assert.deepEqual(bank.map(c => c.eligibility.status), ['approved', 'approved', 'pending']);
  assert.equal(bank.find(c => c.id === 'oldB').customerCode, 'C-000009', 'کد پیشین دست‌نخورده می‌ماند');
  assert.equal(b.saveUsers(manager, [...b.listUsers(manager).users, { id: 'acc', name: 'حساب قدیمی', username: 'acc', role: 'مشتری', customerId: 'oldB', _plain: 'legacy-pass-1', active: true }]).ok, true, 'حساب مشتری قدیمی همچنان اتصال‌پذیر است');
  assert.equal(b.partyAction(manager, 'customer', 'oldA', 'issue_number').customer.customerCode, 'C-000010', 'شمارهٔ جدید با کد پیشین برخورد نمی‌کند');
  assert.equal(b.partyAction(manager, 'customer', 'wait', 'issue_number').ok, false, 'رکورد صریحاً در انتظار، کد نمی‌گیرد');
});
test('unknown kind and malformed requests are rejected without touching the bank', t => {
  const { b, manager, act } = fixture(t);
  assert.equal(act('marketer', 's1', 'approve', { reason: OK_REASON }).code, 'VALIDATION_FAILED');
  assert.equal(act('supplier', '', 'approve', { reason: OK_REASON }).code, 'VALIDATION_FAILED');
  assert.equal(act('supplier', 's1', 'approve', { reason: 42 }).code, 'VALIDATION_FAILED');
  assert.equal(act('supplier', 's1', 'reset_code').code, 'VALIDATION_FAILED');
  assert.equal(act('supplier', 'missing', 'approve', { reason: OK_REASON }).code, 'NOT_FOUND');
  assert.equal(b.get(manager, SUP).value[0].eligibility.status, 'pending');
});
