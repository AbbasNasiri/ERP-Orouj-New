'use strict';
/* بند ۵/پ: گزارش کارهای ناتمام سمت سرور. راستی‌آزمایی‌ها: فقط سفارش‌های «باز» (نه تحویل/لغو/بایگانی)،
   مرحلهٔ فعلی = کمترین مرحلهٔ میان اقلام، واحد مسئول، آخرین تحرک و روز بی‌تحرک از تاریخِ گردشِ سروری،
   گذشته‌بودن از موعد، KPIها، فیلترها، و مهم‌تر از همه حذف ستون بدهی برای نقش‌های غیرمالی.
   «علت انتظار»/«مسئول پیگیری» عمداً سنجیده نمی‌شوند: فیلد ندارند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const ORDERS = 'printshop_orders_v5';
const PASS = 'strong-report-pass';
const TODAY = '2026-06-15';
const NOW = () => Date.parse(TODAY + 'T12:00:00Z');

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

/* سفارش‌ها از مسیر عامِ «set» فقط با فیلدهای مجاز (وضعیتِ «در انتظار تایید»/«بایگانی»، قلم در
   مرحلهٔ «ثبت سفارش»، تاریخ/گردش/پرداخت) کاشته می‌شوند؛ سپس فیلدهای حفاظت‌شدهٔ گردش کار
   (workflow، deliveredAt، پیشروی مرحله) همان‌طور که در backend-workflow.test.cjs مرسوم است
   مستقیم روی رکوردِ ذخیره‌شده نوشته می‌شوند تا حالت‌های واقعیِ تولید/تحویل بازسازی شود. */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-unfinished-'));
  const b = createBackend({ dataDir: dir, openDb, now: NOW });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, PASS);
  const users = b.listUsers(manager).users;
  users.push(
    { id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', _plain: PASS },
    { id: 'press', name: 'سرپرست چاپ', username: 'press', role: 'سرپرست چاپ', _plain: PASS },
  );
  assert.equal(b.saveUsers(manager, users).ok, true);
  // دو مشتریِ شماره‌دار و تأییدشده؛ برای آزمون کنترل‌منفیِ نقش «مشتری» لازم است.
  assert.equal(b.set(manager, 'printshop_customers_v2', [{ id: 'c1', name: 'کتاب نور' }, { id: 'c2', name: 'مدرسه مهدی' }]).ok, true);
  for (const id of ['c1', 'c2']) {
    assert.equal(b.partyAction(manager, 'customer', id, 'approve', { reason: 'معتبر' }).ok, true);
    assert.equal(b.partyAction(manager, 'customer', id, 'issue_number').ok, true);
  }
  const item = (id, productName, qty, unitPrice) => ({ id, productName, stage: 'ثبت سفارش', qty, unitPrice, services: [] });
  const seed = [
    { id: 'o1', orderNumber: '1001', date: '2026-06-01', deliveryDate: '2026-06-10', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1,
      items: [item('i1', 'کتاب ۴۰۰صفحه', 2, 100)], payments: [{ id: 'p1', amount: 50, method: 'cash', date: '2026-06-02' }],
      history: [{ id: 'h1', date: '2026-06-05', text: 'آمادهٔ چاپ', by: 'سرپرست چاپ' }] },
    { id: 'o2', orderNumber: '1002', date: '2026-06-02', deliveryDate: '2026-06-20', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'در انتظار تایید', quoteRev: 1,
      items: [item('i2', 'جزوه ۶۴صفحه', 1, 0)], payments: [], history: [] },
    { id: 'o3', orderNumber: '1003', date: '2026-06-01', deliveryDate: '2026-06-12', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1,
      items: [item('i3', 'بروشور', 1, 0)], payments: [], history: [] },
    { id: 'o4', orderNumber: '1004', date: '2026-06-01', deliveryDate: '2026-06-12', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'در انتظار تایید', quoteRev: 1,
      items: [item('i4', 'پوستر', 1, 0)], payments: [], history: [] },
    { id: 'o5', orderNumber: '1005', date: '2026-06-03', deliveryDate: '2026-06-14', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1,
      items: [item('i5', 'جلد مقوایی', 1, 0)], payments: [], history: [] },
    { id: 'o6', orderNumber: '1006', date: '2026-06-01', deliveryDate: '2026-06-12', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'بایگانی', quoteRev: 1,
      items: [item('i6', 'ستاره', 1, 0)], payments: [], history: [] },
  ];
  assert.equal(b.set(manager, ORDERS, seed.map(o => ({ ...o, payments: [] }))).ok, true);
  const write = o => b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify(o), ORDERS, o.id);
  /* بند ۲/۲: ردیف پرداخت دیگر از مسیر عام نوشته نمی‌شود؛ دریافتی‌ها مثل رکوردِ واقعیِ بانکِ
     صاحب کار بی‌واسطه روی همان رکورد کاشته می‌شوند تا بدهی با رقمِ واقعی بسنجد. */
  seed.forEach(write);
  const withStage = (o, stage) => ({ ...o, items: o.items.map(it => ({ ...it, stage })) });
  // o1: باز، در چاپ، گذشته از موعد، بی‌تحرک ۱۰ روز، دارای مجوز، کسری مادهٔ بازِ pending، بدهی ۱۵۰
  write({ ...withStage(seed[0], 'چاپ'), status: 'تایید شده', workflow: { productionAuthorization: { at: 1, by: { id: 'manager' } }, materialReview: { at: 1, by: {}, shortages: [{ description: 'کاغذ', qty: 70, state: 'pending' }] } } });
  // o3: تحویل شده + deliveredAt → باید از گزارش حذف شود
  write({ ...withStage(seed[2], 'تحویل'), status: 'تحویل شده', deliveredAt: '2026-06-12' });
  // o4: لغو شده → حذف
  write({ ...seed[3], status: 'لغو شده' });
  // o5: آماده تحویل (مرحلهٔ تحویل)، گذشته از موعد، دارای مجوز → ready
  write({ ...withStage(seed[4], 'تحویل'), status: 'آماده تحویل', workflow: { productionAuthorization: { at: 1, by: { id: 'manager' } } } });
  const press = b.login('press', PASS).token;
  const store = b.login('store', PASS).token;
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, manager, press, store };
}

test('فقط سفارش‌های باز با مرحلهٔ فعلی، واحد مسئول و بدهیِ مدیر؛ ردیف‌های بسته حذف', t => {
  const { b, manager } = fixture(t);
  const res = b.unfinishedWork(manager, {});
  assert.equal(res.ok, true, res.error);
  assert.equal(res.moneyIncluded, true);
  const ids = res.rows.map(r => r.orderId).sort();
  assert.deepEqual(ids, ['o1', 'o2', 'o5'], 'تحویل‌شده/لغوشده/بایگانی نمی‌آیند');
  const o1 = res.rows.find(r => r.orderId === 'o1');
  assert.equal(o1.stage, 'چاپ');
  assert.equal(o1.unit, 'چاپ');
  assert.equal(o1.product, 'کتاب ۴۰۰صفحه');
  assert.equal(o1.lastMovement, '2026-06-05');
  assert.equal(o1.idleDays, 10, '۱۵ منهای ۵');
  assert.equal(o1.daysToDue, -5, '۱۰ منهای ۱۵ → گذشته');
  assert.equal(o1.overdue, true);
  assert.equal(o1.awaitingMaterial, true);
  assert.equal(o1.noLicense, false);
  assert.equal(o1.debt, 150, '۲۰۰ payable منهای ۵0 پرداختی');
  const o2 = res.rows.find(r => r.orderId === 'o2');
  assert.equal(o2.idleDays, null, 'بی‌گردش → روز بی‌تحرک نامعلوم، نه صفر');
  assert.equal(o2.noLicense, true);
  assert.equal(o2.overdue, false);
  assert.equal(res.rows.find(r => r.orderId === 'o5').ready, true);
});

test('KPIها روی مجموعهٔ بازِ دامنه حساب می‌شوند', t => {
  const { b, manager } = fixture(t);
  const { kpis } = b.unfinishedWork(manager, {});
  assert.equal(kpis.totalRecords, 6);
  assert.equal(kpis.open, 3);
  assert.equal(kpis.overdue, 2, 'o1 و o5 گذشته از موعد');
  assert.equal(kpis.noLicense, 1, 'فقط o2 بدون مجوز');
  assert.equal(kpis.ready, 1);
  assert.equal(kpis.awaitingMaterial, 1);
  assert.equal(kpis.idle7, 1, 'فقط o1 بیش از ۷ روز بی‌تحرک');
});

test('فیلترها: مرحله، مشتری، بازهٔ تاریخ و کلیدهای فقط-عقب‌افتاده / بدون مجوز', t => {
  const { b, manager } = fixture(t);
  assert.deepEqual(b.unfinishedWork(manager, { stage: 'چاپ' }).rows.map(r => r.orderId), ['o1']);
  assert.deepEqual(b.unfinishedWork(manager, { customerId: 'c1' }).rows.map(r => r.orderId).sort(), ['o1', 'o5']);
  assert.deepEqual(b.unfinishedWork(manager, { from: '2026-06-02' }).rows.map(r => r.orderId).sort(), ['o2', 'o5'], 'o1 پیش از بازه حذف');
  const overdue = b.unfinishedWork(manager, { onlyOverdue: true });
  assert.deepEqual(overdue.rows.map(r => r.orderId).sort(), ['o1', 'o5']);
  assert.equal(overdue.kpis.open, 3, 'KPI روی دامنه می‌ماند، نه روی جدولِ فیلترشده');
  assert.deepEqual(b.unfinishedWork(manager, { onlyNoLicense: true }).rows.map(r => r.orderId), ['o2']);
});

test('بدهی فقط برای مدیر و مدیر مالی؛ سرپرست چاپ ردیف را بدون ستون پولی می‌گیرد', t => {
  const { b, press } = fixture(t);
  const res = b.unfinishedWork(press, {});
  assert.equal(res.ok, true, res.error);
  assert.equal(res.moneyIncluded, false);
  assert.equal('debt' in res.rows.find(r => r.orderId === 'o1'), false, 'سرپرست چاپ مبلغ بدهی نمی‌بیند');
});

test('کنترل منفی: انباردار و مشتری به گزارش کارهای ناتمام دسترسی ندارند؛ بی‌توکن رد', t => {
  const { b, manager, store } = fixture(t);
  assert.equal(b.unfinishedWork(store, {}).code, 'FORBIDDEN', 'انباردار در دامنهٔ این گزارش نیست');
  const users = b.listUsers(manager).users;
  users.push({ id: 'cust1', name: 'کتاب نور', username: 'cust1', role: 'مشتری', customerId: 'c1', _plain: PASS });
  assert.equal(b.saveUsers(manager, users).ok, true);
  assert.equal(b.unfinishedWork(b.login('cust1', PASS).token, {}).code, 'FORBIDDEN');
  assert.equal(invoke('be:unfinishedWork', { unfinishedWork: () => ({ ok: true, spy: true }) }, {}, 'x'.repeat(12), [{}]).code, 'UNAUTHENTICATED');
  assert.equal(invoke('be:unfinishedWork', { unfinishedWork: () => ({ ok: true, spy: true }) }, {}, manager, [{}]).spy, true, 'کانال در جدول allow-list ثبت است');
});
