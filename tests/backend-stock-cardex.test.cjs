'use strict';
/* بند ۵/ب: کاردکس سمت سرور. راستی‌آزمایی‌ها: فیلتر مالک/کالا/بازه، «مانده پس از گردش»
   که از ابتدای بازه جمع می‌شود، بازکردن نام ثبت‌کننده از شناسهٔ کاربر، و کنترل منفی
   دسترسی (نقشی که موجودی را نمی‌خواند کاردکس هم نمی‌گیرد). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const INV = 'printshop_inventory_v3';
const PASS = 'strong-cardex-pass';

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-cardex-'));
  const b = createBackend({ dataDir: dir, openDb });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, PASS);
  const users = b.listUsers(manager).users;
  users.push(
    { id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', _plain: PASS },
    { id: 'money', name: 'مدیر مالی', username: 'money', role: 'مدیر مالی', _plain: PASS },
  );
  assert.equal(b.saveUsers(manager, users).ok, true);
  const store = b.login('store', PASS).token;
  assert.equal(b.set(manager, 'printshop_customers_v2', [{ id: 'c1', name: 'مشتری الف' }]).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c1', 'approve', { reason: 'معتبر' }).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c1', 'issue_number').ok, true);
  const move = (id, date, type, qty, actorId, orderNumber) => ({ id, date, type, qty, unit: 'بند', actorId, orderNumber });
  assert.equal(b.set(manager, INV, [
    { id: 'p1', name: 'تحریر ۷۰گرم', category: 'کاغذ', unitMode: 'band_sheet', bandCount: '5', sheetsPerBand: '500', ownerType: 'مشتری', ownerCustomerId: 'c1', purposeScope: 'all',
      movements: [move('a', '2026-01-01', 'in', 4, 'store'), move('b', '2026-02-01', 'out', 1, 'money', '2401'), move('c', '2026-03-01', 'in', 2, 'store')] },
    { id: 'k1', name: 'مقوای جلد', category: 'مقوا', unitMode: 'simple', quantity: '10', simpleUnit: 'بسته', ownerType: 'چاپخانه',
      movements: [move('d', '2026-01-05', 'in', 10, 'store')] },
  ]).ok, true);
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, manager, store };
}

test('کاردکس ردیف‌ها را با ماندهٔ تجمعی هر کالا و نام ثبت‌کننده برمی‌گرداند', t => {
  const { b, store } = fixture(t);
  const res = b.stockCardex(store, {});
  assert.equal(res.ok, true, res.error);
  const p1 = res.rows.filter(r => r.itemId === 'p1');
  assert.equal(p1.length, 3);
  assert.deepEqual(p1.map(r => r.running), [5, 3, 4], 'نمایش نزولیِ تاریخ است؛ پس مانده‌ها معکوسِ ۴/۳/۵');
  const byDate = Object.fromEntries(p1.map(r => [r.date, r]));
  assert.equal(byDate['2026-01-01'].running, 4);
  assert.equal(byDate['2026-02-01'].running, 3, '۴ ورود منهای ۱ خروج = ۳');
  assert.equal(byDate['2026-03-01'].running, 5);
  assert.equal(byDate['2026-02-01'].actorName, 'مدیر مالی', 'نام از شناسهٔ کاربر باز می‌شود، نه از متن درخواست');
  assert.equal(byDate['2026-02-01'].orderNumber, '2401');
  assert.equal(byDate['2026-02-01'].type, 'out');
  assert.equal(res.rows.find(r => r.itemId === 'k1').running, 10);
});

test('فیلترها: مالک، کالا و بازهٔ تاریخ؛ مانده از ابتدای همان بازه شروع می‌شود', t => {
  const { b, store } = fixture(t);
  assert.equal(b.stockCardex(store, { ownerType: 'مشتری' }).rows.every(r => r.ownerType === 'مشتری'), true);
  assert.equal(b.stockCardex(store, { ownerType: 'مشتری' }).rows.length, 3);
  assert.equal(b.stockCardex(store, { ownerType: 'چاپخانه' }).rows.length, 1);
  assert.deepEqual(b.stockCardex(store, { itemId: 'k1' }).rows.map(r => r.itemId), ['k1']);
  const ranged = b.stockCardex(store, { itemId: 'p1', from: '2026-02-01' }).rows;
  assert.equal(ranged.length, 2, 'گردشِ پیش از بازه حذف می‌شود');
  const asc = [...ranged].sort((a, c) => a.date.localeCompare(c.date));
  assert.deepEqual(asc.map(r => r.running), [-1, 1], 'جمع تدریجی از ابتدای بازه: خروج ۱− سپس ورود ۱+');
});

test('کنترل منفی: نقشی که موجودی را نمی‌خواند کاردکس هم نمی‌گیرد؛ بی‌توکن به موتور نمی‌رسد', t => {
  const { b, manager, store } = fixture(t);
  const users = b.listUsers(manager).users;
  users.push({ id: 'cust1', name: 'مشتری الف', username: 'cust1', role: 'مشتری', customerId: 'c1', _plain: PASS });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const cust = b.login('cust1', PASS).token;
  assert.equal(b.stockCardex(cust, {}).code, 'FORBIDDEN', 'حساب مشتری به کاردکس انبار دسترسی ندارد');
  assert.equal(invoke('be:stockCardex', { stockCardex: () => ({ ok: true, spy: true }) }, {}, 'x'.repeat(12), [{}]).code, 'UNAUTHENTICATED');
  assert.equal(invoke('be:stockCardex', { stockCardex: () => ({ ok: true, spy: true }) }, {}, store, [{ itemId: 'p1' }]).spy, true, 'کانال در جدول allow-list ثبت است');
});

test('ثبت‌کنندهٔ ناشناس خالی می‌ماند؛ هیچ عددی برای نام ساخته نمی‌شود', t => {
  const { b, manager, store } = fixture(t);
  assert.equal(b.set(manager, INV, [...b.get(manager, INV).value, {
    id: 'z1', name: 'مرکب', category: 'مرکب', unitMode: 'simple', quantity: '0', simpleUnit: 'قوطی', ownerType: 'چاپخانه',
    movements: [{ id: 'g', date: '2026-01-01', type: 'in', qty: 3, unit: 'قوطی', actorId: 'ghost-user' }],
  }]).ok, true);
  const row = b.stockCardex(store, { itemId: 'z1' }).rows[0];
  assert.equal(row.actorName, '', 'شناسه‌ای که کاربر ندارد نام دروغین نمی‌گیرد');
  assert.equal(row.running, 3);
});
