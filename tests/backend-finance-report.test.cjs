'use strict';
/* بند ۵/ث: گزارش مالی و تسویه سمت سرور. راستی‌آزمایی‌ها: مبالغ فقط از snapshotِ سفارش خوانده می‌شوند
   (PRC-12 — بدون بازمحاسبه)، «فروش/پیش‌ازمالیات/دریافتی/باقی‌مانده»، وضعیتِ سند از جدول financial_documents،
   «پیش‌فاکتور بی‌پاسخ»، KPIها روی دامنهٔ فیلترشده، فیلترها، پیش‌نمایش مالیاتِ فرضی (نوشته نمی‌شود)،
   و مهم‌تر از همه: فقط مدیر چاپخانه و مدیر مالی دسترسی دارند و بقیه FORBIDDEN.
   سفارش‌ها از مسیر عام «set» کاشته و snapshot قیمت/گردش‌کار (فیلدهای حفاظت‌شده) و اسناد مستقیم نوشته می‌شوند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const ORDERS = 'printshop_orders_v5';
const PASS = 'strong-finance-pass';
const TODAY = '2026-06-15';
const NOW = () => Date.parse(TODAY + 'T12:00:00Z');

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-finance-'));
  const b = createBackend({ dataDir: dir, openDb, now: NOW });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, PASS);
  const users = b.listUsers(manager).users;
  users.push(
    { id: 'fin', name: 'مدیر مالی', username: 'fin', role: 'مدیر مالی', _plain: PASS },
    { id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', _plain: PASS },
    { id: 'press', name: 'سرپرست چاپ', username: 'press', role: 'سرپرست چاپ', _plain: PASS },
  );
  assert.equal(b.saveUsers(manager, users).ok, true);
  assert.equal(b.set(manager, 'printshop_customers_v2', [{ id: 'c1', name: 'کتاب نور' }, { id: 'c2', name: 'مدرسه مهدی' }]).ok, true);
  for (const id of ['c1', 'c2']) {
    assert.equal(b.partyAction(manager, 'customer', id, 'approve', { reason: 'معتبر' }).ok, true);
    assert.equal(b.partyAction(manager, 'customer', id, 'issue_number').ok, true);
  }
  const item = (id, pn, qty, up) => ({ id, productName: pn, stage: 'ثبت سفارش', qty, unitPrice: up, services: [] });
  const seed = [
    { id: 'o1', orderNumber: '1001', date: '2026-06-01', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1, items: [item('i1', 'کتاب', 2, 100)], payments: [{ id: 'p1', amount: 300000, method: 'cash', date: '2026-06-02' }], history: [] },
    { id: 'o2', orderNumber: '1002', date: '2026-06-05', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'در انتظار تایید', quoteRev: 1, items: [item('i2', 'جزوه', 1, 0)], payments: [], history: [] },
    { id: 'o3', orderNumber: '1003', date: '2026-06-10', customerId: 'c1', customerName: 'کتاب نور', status: 'در انتظار تایید', quoteRev: 1, items: [item('i3', 'بروشور', 1, 0)], payments: [{ id: 'p3', amount: 200000, method: 'cash', date: '2026-06-11' }], history: [] },
    { id: 'o4', orderNumber: '1004', date: '2026-06-12', customerId: 'c2', customerName: 'مدرسه مهدی', status: 'در انتظار تایید', quoteRev: 1, items: [item('i4', 'پوستر', 1, 0)], payments: [{ id: 'p4', amount: 50000, method: 'cash', date: '2026-06-12' }], history: [] },
  ];
  assert.equal(b.set(manager, ORDERS, seed.map(o => ({ ...o, payments: [] }))).ok, true);
  const write = o => b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify(o), ORDERS, o.id);
  /* بند ۲/۲: ردیف پرداخت از مسیر عام پذیرفته نمی‌شود؛ دریافتی‌های «قدیمی» مثل رکوردِ واقعیِ
     بانکِ صاحب کار بی‌واسطه در همان رکورد نوشته می‌شوند تا گزارش مالی با رقمِ واقعی بسنجد. */
  seed.forEach(write);
  const price = (total, subtotal, tax) => ({ schemaVersion: 1, revision: 1, result: { total, subtotal, taxAmount: tax, currency: 'IRR' } });
  // o1: snapshot با مالیات، فاکتور صادر، تأیید مشتری + مجوز تولید، بدهی ۷۰۰٬۰۰
  write({ ...seed[0], pricing: price(1000000, 900000, 100000), workflow: { customerConfirmation: { quoteRevision: 1 }, productionAuthorization: {} } });
  // o2: snapshot بدون مالیات، فقط پیش‌فاکتور صادر، بی‌پاسخ، بدهی ۵۰۰٬۰۰
  write({ ...seed[1], pricing: price(500000, 500000, 0) });
  // o3: snapshot، بدون سند، تسویه‌شده (باقی‌مانده صفر)
  write({ ...seed[2], pricing: price(200000, 200000, 0) });
  // o4: بدون snapshot (قدیمی/بی‌سند) → مبلغ null، فقط دریافتی
  const doc = (id, type, orderId, number) => b._db.run('INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)', id, type, orderId, 1, number, 'issued', JSON.stringify({ id, type, orderId, status: 'issued' }), NOW());
  doc('d1', 'invoice', 'o1', 'INV-1');
  doc('d2', 'quote', 'o2', 'QTE-1');
  const fin = b.login('fin', PASS).token;
  const press = b.login('press', PASS).token;
  const store = b.login('store', PASS).token;
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, manager, fin, press, store };
}

test('مبالغ از snapshot خوانده می‌شوند؛ وضعیت سند از جدول اسناد؛ سفارش بی‌snapshot مبلغ null', t => {
  const { b, manager } = fixture(t);
  const res = b.financeReport(manager, {});
  assert.equal(res.ok, true, res.error);
  assert.equal(res.moneyIncluded, true);
  assert.deepEqual(res.rows.map(r => r.orderId), ['o4', 'o3', 'o2', 'o1'], 'تاریخ نزولی');
  const o1 = res.rows.find(r => r.orderId === 'o1');
  assert.equal(o1.sales, 1000000); assert.equal(o1.preTax, 900000); assert.equal(o1.snapshotTax, 100000);
  assert.equal(o1.received, 300000); assert.equal(o1.balance, 700000);
  assert.equal(o1.docStatus, 'invoice'); assert.equal(o1.customerConfirmed, true); assert.equal(o1.hasLicense, true);
  const o2 = res.rows.find(r => r.orderId === 'o2');
  assert.equal(o2.docStatus, 'quote'); assert.equal(o2.customerConfirmed, false); assert.equal(o2.balance, 500000);
  assert.equal(res.rows.find(r => r.orderId === 'o3').balance, 0);
  const o4 = res.rows.find(r => r.orderId === 'o4');
  assert.equal(o4.sales, null); assert.equal(o4.balance, null); assert.equal(o4.received, 50000); assert.equal(o4.docStatus, 'none');
});

test('KPIها روی دامنهٔ فیلترشده: فروش پیش‌ازمالیات، دریافتی، بدهی باز، فاکتور، پیش‌فاکتور بی‌پاسخ، مشتری بدهکار', t => {
  const { b, manager } = fixture(t);
  const { kpis } = b.financeReport(manager, {});
  assert.equal(kpis.totalRecords, 4);
  assert.equal(kpis.salesPreTax, 1600000, '۹۰k+۵۰k+۲۰۰k؛ o4 بی‌snapshot صفر');
  assert.equal(kpis.received, 550000);
  assert.equal(kpis.openDebt, 1200000, '۷۰k+۵۰۰k؛ بدهی منفی شمارش نمی‌شود');
  assert.equal(kpis.invoiceCount, 1);
  assert.equal(kpis.unansweredQuotes, 1, 'فقط o2');
  assert.equal(kpis.debtors, 2, 'c1 و c2');
});

test('فیلترها: وضعیت سند، فقط‌بدهی، بازهٔ تاریخ، مشتری؛ و پیش‌نمایش مالیاتِ فرضی', t => {
  const { b, manager } = fixture(t);
  assert.deepEqual(b.financeReport(manager, { docStatus: 'invoice' }).rows.map(r => r.orderId), ['o1']);
  const debt = b.financeReport(manager, { onlyDebt: true });
  assert.deepEqual(debt.rows.map(r => r.orderId), ['o2', 'o1'], 'o3 صفر و o4 بی‌snapshot حذف');
  assert.deepEqual(b.financeReport(manager, { from: '2026-06-05' }).rows.map(r => r.orderId), ['o4', 'o3', 'o2']);
  assert.equal(b.financeReport(manager, { from: '2026-06-05' }).kpis.totalRecords, 3, 'KPI روی دامنه');
  assert.deepEqual(b.financeReport(manager, { customerId: 'c1' }).rows.map(r => r.orderId), ['o3', 'o1']);
  const tax = b.financeReport(manager, { taxPreview: true }).rows.find(r => r.orderId === 'o1');
  assert.equal(tax.previewTax, 90000, '۱۰٪ روی subtotalِ پیش‌ازمالیات');
  assert.equal(tax.previewTotal, 990000);
  assert.equal(b.financeReport(manager, {}).rows.find(r => r.orderId === 'o1').previewTax, undefined, 'بدون کلید، ستون فرضی ساخته نمی‌شود');
});

test('کنترل منفی: فقط مدیر و مدیر مالی؛ انباردار/سرپرست/مشتری FORBIDDEN؛ بی‌توکن رد؛ کانال در allow-list', t => {
  const { b, manager, fin, press, store } = fixture(t);
  assert.equal(b.financeReport(fin, {}).ok, true, 'مدیر مالی دسترسی دارد');
  assert.equal(b.financeReport(fin, {}).moneyIncluded, true);
  assert.equal(b.financeReport(press, {}).code, 'FORBIDDEN', 'سرپرست چاپ گزارش مالی نمی‌بیند');
  assert.equal(b.financeReport(store, {}).code, 'FORBIDDEN', 'انباردار گزارش مالی نمی‌بیند');
  const users = b.listUsers(manager).users;
  users.push({ id: 'cust1', name: 'کتاب نور', username: 'cust1', role: 'مشتری', customerId: 'c1', _plain: PASS });
  assert.equal(b.saveUsers(manager, users).ok, true);
  assert.equal(b.financeReport(b.login('cust1', PASS).token, {}).code, 'FORBIDDEN');
  assert.equal(invoke('be:financeReport', { financeReport: () => ({ ok: true, spy: true }) }, {}, 'x'.repeat(12), [{}]).code, 'UNAUTHENTICATED');
  assert.equal(invoke('be:financeReport', { financeReport: () => ({ ok: true, spy: true }) }, {}, manager, [{}]).spy, true, 'کانال در جدول allow-list ثبت است');
});
