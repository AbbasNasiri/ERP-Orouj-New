'use strict';
/* بند ۵/ت: گزارش تحویل سمت سرور. دو جدول: «باید تحویل شود» = بازِ تحویل‌نشده (نه لغو/بایگانی) با موعد،
   «تحویل‌شده» = سفارش‌های دارای deliveredAt. فیلدهای واقعی: method/address/receiver/phone از فرم و
   deliveredAt/deliveredBy از سرور. ستون پولی ندارد. تاریخ نامعلوم → «—» نه صفر.
   سفارش‌ها از مسیر عام «set» با فیلدهای مجاز کاشته و سپس deliveredAt/deliveredBy/وضعیت/مرحله
   (فیلدهای حفاظت‌شده) همان‌طور که در backend-workflow.test.cjs مرسوم است مستقیم روی رکورد نوشته می‌شوند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const ORDERS = 'printshop_orders_v5';
const PASS = 'strong-delivery-pass';
const TODAY = '2026-06-15';
const NOW = () => Date.parse(TODAY + 'T12:00:00Z');

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-delivery-'));
  const b = createBackend({ dataDir: dir, openDb, now: NOW });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, PASS);
  const users = b.listUsers(manager).users;
  users.push(
    { id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', _plain: PASS },
    { id: 'press', name: 'سرپرست چاپ', username: 'press', role: 'سرپرست چاپ', _plain: PASS },
  );
  assert.equal(b.saveUsers(manager, users).ok, true);
  assert.equal(b.set(manager, 'printshop_customers_v2', [{ id: 'c1', name: 'کتاب نور' }, { id: 'c2', name: 'مدرسه مهدی' }]).ok, true);
  for (const id of ['c1', 'c2']) {
    assert.equal(b.partyAction(manager, 'customer', id, 'approve', { reason: 'معتبر' }).ok, true);
    assert.equal(b.partyAction(manager, 'customer', id, 'issue_number').ok, true);
  }
  const item = (id, productName, qty, unitPrice) => ({ id, productName, stage: 'ثبت سفارش', qty, unitPrice, services: [] });
  const seed = [
    { id: 'o1', orderNumber: '1001', date: '2026-06-01', deliveryDate: '2026-06-10', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1,
      delivery: { method: 'ارسال به نشانی مشتری', address: 'تهران، خیابان ولیعصر', receiver: 'رضا محمدی', phone: '09121112233' },
      items: [item('i1', 'کتاب ۴۰۰صفحه', 2, 100)], payments: [], history: [] },
    { id: 'o2', orderNumber: '1002', date: '2026-06-02', deliveryDate: '2026-06-20', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'در انتظار تایید', quoteRev: 1,
      delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' },
      items: [item('i2', 'جزوه ۶۴صفحه', 1, 0)], payments: [], history: [] },
    { id: 'o3', orderNumber: '1003', date: '2026-06-01', deliveryDate: '2026-06-12', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1,
      delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: 'سمیرا', phone: '' },
      items: [item('i3', 'بروشور', 1, 0)], payments: [], history: [] },
    { id: 'o4', orderNumber: '1004', date: '2026-06-01', deliveryDate: '2026-06-12', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'در انتظار تایید', quoteRev: 1,
      delivery: { method: 'ارسال به نشانی مشتری', address: 'کرج', receiver: '', phone: '02612345678' },
      items: [item('i4', 'پوستر', 1, 0)], payments: [], history: [] },
    { id: 'o5', orderNumber: '1005', date: '2026-06-03', deliveryDate: '2026-06-14', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1,
      delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' },
      items: [item('i5', 'جلد مقوایی', 1, 0)], payments: [], history: [] },
    { id: 'o6', orderNumber: '1006', date: '2026-06-01', deliveryDate: '2026-06-12', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'بایگانی', quoteRev: 1,
      delivery: { method: '', address: '', receiver: '', phone: '' },
      items: [item('i6', 'ستاره', 1, 0)], payments: [], history: [] },
  ];
  assert.equal(b.set(manager, ORDERS, seed).ok, true);
  const write = o => b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify(o), ORDERS, o.id);
  const withStage = (o, stage) => ({ ...o, items: o.items.map(it => ({ ...it, stage })) });
  // o1: باز، در چاپ، گذشته از موعد → جدول «باید تحویل شود»
  write({ ...withStage(seed[0], 'چاپ'), status: 'تایید شده', workflow: { productionAuthorization: { at: 1, by: { id: 'manager' } } } });
  // o3: تحویل‌شده به‌موقع (12 = موعد)
  write({ ...withStage(seed[2], 'تحویل'), status: 'تحویل شده', deliveredAt: '2026-06-12', deliveredBy: { id: 'manager', name: 'مدیر', role: 'مدیر چاپخانه' } });
  // o4: تحویل‌شده با تأخیر (14 > موعد 12)
  write({ ...withStage(seed[3], 'تحویل'), status: 'تحویل شده', deliveredAt: '2026-06-14', deliveredBy: { id: 'press', name: 'سرپرست چاپ', role: 'سرپرست چاپ' } });
  // o5: آماده تحویل (همهٔ اقلام در مرحلهٔ تحویل)، گذشته از موعد → due + ready
  write({ ...withStage(seed[4], 'تحویل'), status: 'آماده تحویل', workflow: { productionAuthorization: { at: 1, by: { id: 'manager' } } } });
  // o6 بایگانی و o2 در انتظار تاییدِ موعد-آینده از seed می‌مانند.
  const press = b.login('press', PASS).token;
  const store = b.login('store', PASS).token;
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, manager, press, store };
}

test('دو جدول: «باید تحویل شود» فقط باز و «تحویل‌شده» فقط با deliveredAt؛ بایگانی/لغو حذف', t => {
  const { b, manager } = fixture(t);
  const res = b.deliveryReport(manager, {});
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.due.map(r => r.orderId), ['o1', 'o5', 'o2'], 'بر اساس موعد صعودی: ۱۰،۱۴،۲۰');
  assert.deepEqual(res.delivered.map(r => r.orderId), ['o4', 'o3'], 'بر اساس تاریخ تحویل نزولی: ۱۴،۱۲');
  const o1 = res.due.find(r => r.orderId === 'o1');
  assert.equal(o1.dueDate, '2026-06-10');
  assert.equal(o1.daysToDue, -5);
  assert.equal(o1.overdue, true);
  assert.equal(o1.ready, false);
  assert.equal(o1.stage, 'چاپ');
  assert.equal(o1.method, 'ارسال به نشانی مشتری');
  assert.equal(o1.receiver, 'رضا محمدی');
  assert.equal(o1.address, 'تهران، خیابان ولیعصر');
  assert.equal(res.due.find(r => r.orderId === 'o5').ready, true);
  assert.equal(res.due.find(r => r.orderId === 'o2').overdue, false);
  const o3 = res.delivered.find(r => r.orderId === 'o3');
  assert.equal(o3.deliveredAt, '2026-06-12');
  assert.equal(o3.deliveredByName, 'مدیر');
  assert.equal(o3.deliveredByRole, 'مدیر چاپخانه');
  assert.equal(o3.late, false, '۱۲ نه بزرگ‌تر از موعد ۱۲');
  assert.equal(res.delivered.find(r => r.orderId === 'o4').late, true, '۱۴ > ۱۲');
});

test('KPIها: بازشماری due/delivered و تأخیر؛ بدون ستون پولی', t => {
  const { b, manager } = fixture(t);
  const { kpis } = b.deliveryReport(manager, {});
  assert.equal(kpis.totalRecords, 6);
  assert.equal(kpis.dueCount, 3);
  assert.equal(kpis.dueOverdue, 2, 'o1 و o5 گذشته از موعد');
  assert.equal(kpis.dueReady, 1, 'فقط o5 آمادهٔ تحویل');
  assert.equal(kpis.deliveredCount, 2);
  assert.equal(kpis.deliveredLate, 1, 'فقط o4 دیرکرد');
});

test('فیلترها: بازه روی موعدِ due و تاریخِ delivered؛ مشتری و فقط-گذشته', t => {
  const { b, manager } = fixture(t);
  const from13 = b.deliveryReport(manager, { from: '2026-06-13' });
  assert.deepEqual(from13.due.map(r => r.orderId), ['o5', 'o2'], 'موعد ۱۰ حذف');
  assert.deepEqual(from13.delivered.map(r => r.orderId), ['o4'], 'تحویل ۱۲ پیش از بازه حذف');
  assert.equal(from13.kpis.dueCount, 2, 'KPI روی دامنهٔ فیلترشده');
  assert.deepEqual(b.deliveryReport(manager, { to: '2026-06-13' }).due.map(r => r.orderId), ['o1']);
  assert.deepEqual(b.deliveryReport(manager, { to: '2026-06-13' }).delivered.map(r => r.orderId), ['o3']);
  assert.deepEqual(b.deliveryReport(manager, { customerId: 'c1' }).due.map(r => r.orderId), ['o1', 'o5']);
  assert.deepEqual(b.deliveryReport(manager, { customerId: 'c1' }).delivered.map(r => r.orderId), ['o3']);
  assert.deepEqual(b.deliveryReport(manager, { onlyOverdue: true }).due.map(r => r.orderId), ['o1', 'o5']);
});

test('کنترل منفی: انباردار و مشتری دسترسی ندارند؛ سرپرست چاپ می‌خواند؛ بی‌توکن رد؛ کانال در allow-list', t => {
  const { b, manager, press, store } = fixture(t);
  assert.equal(b.deliveryReport(store, {}).code, 'FORBIDDEN', 'انباردار در دامنهٔ گزارش تحویل نیست');
  assert.equal(b.deliveryReport(press, {}).ok, true, 'سرپرست چاپ حق خواندن دارد');
  assert.equal('debt' in (b.deliveryReport(press, {}).due[0] || {}), false, 'هیچ ستون پولی وجود ندارد');
  const users = b.listUsers(manager).users;
  users.push({ id: 'cust1', name: 'کتاب نور', username: 'cust1', role: 'مشتری', customerId: 'c1', _plain: PASS });
  assert.equal(b.saveUsers(manager, users).ok, true);
  assert.equal(b.deliveryReport(b.login('cust1', PASS).token, {}).code, 'FORBIDDEN');
  assert.equal(invoke('be:deliveryReport', { deliveryReport: () => ({ ok: true, spy: true }) }, {}, 'x'.repeat(12), [{}]).code, 'UNAUTHENTICATED');
  assert.equal(invoke('be:deliveryReport', { deliveryReport: () => ({ ok: true, spy: true }) }, {}, manager, [{}]).spy, true, 'کانال در جدول allow-list ثبت است');
});
