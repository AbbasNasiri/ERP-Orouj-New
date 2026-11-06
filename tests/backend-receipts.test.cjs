'use strict';
/* اصلاحات ۱۷/بند ۲/۱: مهاجرتِ ردیف‌های پرداختِ قدیمی به «رسید افتتاحیه» و بازتابِ سرور.
   آزمون با بازبازکردنِ همان بانک انجام می‌شود، چون مهاجرت در مسیرِ واقعیِ بازِشدنِ برنامه است.
   سه چیز کنترل می‌شود: هیچ عددِ پرونده‌ای با مهاجرت تکان نمی‌خورد، هیچ ردیفی دوباره
   مهاجرت نمی‌شود (با بازبازکردنِ سوم)، و ردیفِ بی‌اعتبار بی‌صدا حذف نمی‌شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');

const ORDERS = 'printshop_orders_v5';
const CUSTOMERS = 'printshop_customers_v2';
const M = 'مدیر چاپخانه';
const DAY = 86400000;
const clock0 = Date.parse('2026-11-02T09:00:00Z');
const MILLION = 1000000;
/* رمزِ پیش‌فرضِ سرور تا تغییر نیابد هیچ نوشتنی را نمی‌پذیرد؛ همان کاری که کاربرِ واقعی در
   اولین ورود می‌کند، اینجا هم باید انجام شود. */
const ADMIN_PASS = 'strong-receipts-pass';
const adminToken = b => b.login('admin', ADMIN_PASS).token;

function openDb(file) {
  const raw = new DatabaseSync(file);
  return {
    exec: sql => raw.exec(sql), run: (sql, ...p) => raw.prepare(sql).run(...p),
    get: (sql, ...p) => raw.prepare(sql).get(...p), all: (sql, ...p) => raw.prepare(sql).all(...p),
    tx(fn) { raw.exec('BEGIN'); try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
    close: () => raw.close(),
  };
}

const order = (id, status, over = {}) => ({
  id, orderNumber: id.replace(/\D/g, ''), customerId: 'c1', status, date: '2026-10-01',
  items: [{ id: id + '-i1', qty: '1', unitPrice: '0', services: [] }], payments: [], history: [], ...over,
});
const priced = total => ({ schemaVersion: 1, revision: 1, result: { total, currency: 'IRR' } });

/* بانک را یک‌بار می‌سازد، ردیف‌ها را از راهِ مستقیم می‌گذارد و دوباره باز می‌کند؛
   مهاجرت فقط در همان بازِ دوم اجرا می‌شود — همان چیزی که روی بانکِ کارفرما رخ می‌دهد.
   بستنِ همهٔ connectionها پیش از پاک‌کردنِ پوشه در ویندوز لازمی است، وگرنه
   فایلِ قفل‌شده با EPERM می‌ماند و آزمونِ بعدی بانکِ قبلی را نمی‌بیند. */
function seeded(t, orders, invoices = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-receipts-'));
  const opened = [];
  const close = b => { const i = opened.indexOf(b); if (i >= 0) opened.splice(i, 1); b.close(); };
  t.after(() => { while (opened.length) opened.pop().close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const first = createBackend({ dataDir: dir, openDb, now: () => clock0 });
  for (const key of [ORDERS, CUSTOMERS]) first._db.run("INSERT OR REPLACE INTO kinds(key, kind) VALUES(?, 'array')", key);
  assert.equal(first.setOwnPassword(first.login('admin', '1234').token, ADMIN_PASS).ok, true);
  assert.equal(first.set(adminToken(first), CUSTOMERS, [{ id: 'c1', name: 'نمونهٔ کارفرما', phone: '09120000000' }]).ok, true);
  orders.forEach((o, i) => first._db.run('INSERT OR REPLACE INTO records(collection,id,ord,data,updated_at,rev) VALUES(?,?,?,?,?,?)',
    ORDERS, o.id, i, JSON.stringify(o), clock0, 1));
  invoices.forEach(inv => first._db.run('INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)',
    'doc_' + inv.number, 'invoice', inv.orderId, 1, inv.number, 'issued',
    JSON.stringify({ snapshot: { invoice: { totals: { total: inv.total } } }, createdAt: inv.issuedAt }), inv.issuedAt));
  close(first);
  return { close, reopen: at => { const b = createBackend({ dataDir: dir, openDb, now: () => at === undefined ? clock0 : at }); opened.push(b); return b; } };
}

const storedOrder = (b, id) => JSON.parse(b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, id).data);
const exampleOrders = () => [
  order('oOld', 'تحویل شده', { date: '2026-09-20', pricing: priced(50 * MILLION), payments: [
    { id: 'p1', amount: 20 * MILLION, method: 'نقد', date: '2026-10-02' },
    { id: 'p2', amount: 'بیست میلیون', method: 'کارت', date: '2026-10-04' },
  ] }),
  order('oLive', 'تایید شده', { pricing: priced(25 * MILLION) }),
];
const exampleInvoices = () => [{ orderId: 'oOld', number: 'I-1', total: 50 * MILLION, issuedAt: clock0 - 5 * DAY }];

test('مهاجرت: هر ردیفِ پرداختِ قدیمی یک رسید افتتاحیه با شمارهٔ خودش می‌شود', t => {
  const { reopen, close } = seeded(t, exampleOrders(), exampleInvoices());
  const b = reopen();
  assert.deepEqual(b.receiptLedger, { migrated: 1, kept: 1 }, 'یک ردیف مهاجرت می‌کند و ردیفِ بی‌اعتبار مهاجرت نمی‌کند');
  const receipts = b._db.all('SELECT * FROM receipts ORDER BY number');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].number, '9001', 'رشتهٔ شمارهٔ رسید وجه از ۹۰۰۱ شروع می‌شود');
  assert.equal(receipts[0].opening, 1);
  assert.equal(receipts[0].legacy_payment_id, 'p1');
  assert.equal(receipts[0].amount, 20 * MILLION);
  assert.equal(receipts[0].status, 'cleared');
  assert.equal(receipts[0].received_at, '2026-10-02');
  const allocations = b._db.all('SELECT * FROM receipt_allocations');
  assert.deepEqual(allocations.map(a => [a.order_id, a.document_id, a.kind, a.amount]),
    [['oOld', 'doc_I-1', 'definite', 20 * MILLION]], 'تخصیص به همان فاکتورِ صادرشده گره می‌خورد');
  assert.equal(b.numberingSettings(adminToken(b)).settings.moneyreceipt.next, 9002);
});

test('مهاجرت هیچ عددِ پروندهٔ اعتباری را تکان نمی‌دهد و ردیفِ بی‌اعتبار را حذف نمی‌کند', t => {
  const { reopen, close } = seeded(t, exampleOrders(), exampleInvoices());
  const b = reopen();
  const admin = adminToken(b);
  assert.equal(b.saveCreditPolicy(admin, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  const file = b.customerCreditFile(admin, { customerId: 'c1' }).file;
  assert.equal(file.definiteDebt, 30 * MILLION, '۵۰M فاکتور منهای ۲۰M دریافت — همان عددِ پیش از مهاجرت');
  assert.equal(file.commitment, 25 * MILLION);
  assert.equal(file.netCommitment, 55 * MILLION);
  assert.equal(file.available, 45 * MILLION);
  const payments = storedOrder(b, 'oOld').payments;
  assert.equal(payments.length, 2, 'ردیفِ مهاجرت‌ناکردنی در بازتاب می‌ماند، بی‌صدا حذف نمی‌شود');
  const mirrored = payments.find(p => p.receiptNumber === '9001');
  assert.equal(mirrored.amount, 20 * MILLION);
  assert.equal(mirrored.status, 'cleared');
  assert.equal(mirrored.statusLabel, 'وصول‌شده');
  assert.equal(mirrored.allocatedTo, 'فاکتور');
  assert.equal(mirrored.legacyPaymentId, 'p1');
  assert.equal(payments.find(p => p.id === 'p2').amount, 'بیست میلیون', 'ردیفِ قدیمی دست‌نخورده می‌ماند');
});

test('بازبازکردنِ سوم چیزی را دوباره مهاجرت نمی‌کند و پول را دو برابر نمی‌کند', t => {
  const { reopen, close } = seeded(t, exampleOrders(), exampleInvoices());
  const second = reopen();
  const before = JSON.stringify(storedOrder(second, 'oOld').payments);
  const receiptsBefore = second._db.all('SELECT id FROM receipts').length;
  close(second);
  const third = reopen();
  assert.equal(third.receiptLedger.migrated, 0, 'رسیدِ تکراری ساخته نمی‌شود');
  assert.equal(third._db.all('SELECT id FROM receipts').length, receiptsBefore);
  assert.equal(JSON.stringify(storedOrder(third, 'oOld').payments), before, 'بازتاب بی‌تغییر است، پس نسخهٔ رکورد هم بیهوده بالا نمی‌رود');
  const admin = adminToken(third);
  third.saveCreditPolicy(admin, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 });
  assert.equal(third.customerCreditFile(admin, { customerId: 'c1' }).file.definiteDebt, 30 * MILLION, 'هیچ ریالی دوباره شمرده نمی‌شود');
});

test('چکِ در دست در پرونده مطالبه را کم می‌کند و با برگشتن، بدهی برمی‌گردد', t => {
  const { reopen, close } = seeded(t, [order('oOld', 'تحویل شده', { date: '2026-09-20', pricing: priced(50 * MILLION) })], exampleInvoices());
  const b = reopen();
  const admin = adminToken(b);
  b.saveCreditPolicy(admin, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 });
  assert.equal(b.customerCreditFile(admin, { customerId: 'c1' }).file.definiteDebt, 50 * MILLION, 'پیش از هر دریافت');
  /* رسیدِ چک از همان دو جدول نوشته می‌شود که بند ۲/۲ از راه IPC می‌نویسدشان. */
  b._db.run('INSERT INTO receipts(id,number,customer_id,order_id,method,amount,status,received_at,cheque_number,cheque_bank,cheque_due,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    'rCheque', '9001', 'c1', 'oOld', 'چک', 20 * MILLION, 'held', '2026-11-01', 'چ-۷۷', 'ملت', '2026-12-01', clock0, 'مدیر مالی');
  b._db.run('INSERT INTO receipt_allocations(id,receipt_id,order_id,document_id,amount,kind,created_at) VALUES(?,?,?,?,?,?,?)',
    'aCheque', 'rCheque', 'oOld', 'doc_I-1', 20 * MILLION, 'definite', clock0);
  close(b);
  const after = reopen(clock0 + DAY);
  const payments = storedOrder(after, 'oOld').payments;
  assert.deepEqual(payments.map(p => [p.receiptNumber, p.statusLabel, p.amount]), [['9001', 'در دست', 20 * MILLION]]);
  assert.equal(payments[0].chequeNumber, 'چ-۷۷');
  const admin2 = adminToken(after);
  const file = after.customerCreditFile(admin2, { customerId: 'c1' }).file;
  assert.equal(file.definiteDebt, 30 * MILLION, 'کارفرما: چکِ وصول‌نشده مطالبه را کم می‌کند');
  assert.equal(file.lines[0].paid, 20 * MILLION);
  after._db.run("UPDATE receipts SET status = 'bounced' WHERE id = 'rCheque'");
  close(after);
  const bouncedAgain = reopen(clock0 + 2 * DAY);
  const bouncedAdmin = adminToken(bouncedAgain);
  assert.deepEqual(storedOrder(bouncedAgain, 'oOld').payments, [], 'چکِ برگشتی از بازتاب بیرون می‌رود');
  assert.equal(bouncedAgain.customerCreditFile(bouncedAdmin, { customerId: 'c1' }).file.definiteDebt, 50 * MILLION, 'بدهی به پرونده برمی‌گردد');
});

test('باقی‌ماندهٔ رسیدِ بی‌تخصیص در پرونده پیش‌پرداخت می‌شود', t => {
  const { reopen, close } = seeded(t, [order('oLive', 'تایید شده', { pricing: priced(25 * MILLION) })]);
  const b = reopen();
  b._db.run('INSERT INTO receipts(id,number,customer_id,order_id,method,amount,status,received_at,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
    'rAdv', '9001', 'c1', '', 'نقد', 15 * MILLION, 'cleared', '2026-11-01', clock0, 'مدیر مالی');
  close(b);
  const second = reopen();
  const admin = adminToken(second);
  second.saveCreditPolicy(admin, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 });
  const file = second.customerCreditFile(admin, { customerId: 'c1' }).file;
  assert.equal(file.advance, 15 * MILLION, 'پولِ تخصیص‌نیافته از دست نمی‌رود');
  assert.equal(file.commitment, 25 * MILLION);
  assert.equal(file.netCommitment, 10 * MILLION, 'تعهد خالص = ۲۵M − ۱۵M پیش‌پرداخت');
  assert.equal(second.creditFiles(admin).kpis.totalAdvance, 15 * MILLION, 'میز پرونده‌ها هم همین عدد را می‌گیرد');
});

test('رسیدِ بی‌تاریخِ معتبر مهاجرت نمی‌کند؛ سفارشِ بی‌فاکتور تخصیصِ «سفارش» می‌گیرد', t => {
  const { reopen, close } = seeded(t, [
    order('oNoDate', 'تایید شده', { date: '', pricing: priced(10 * MILLION), payments: [{ id: 'pX', amount: 4 * MILLION, method: 'نقد' }] }),
    order('oNoInvoice', 'تایید شده', { pricing: priced(8 * MILLION), payments: [{ id: 'pY', amount: 3 * MILLION, method: 'کارت به کارت', date: '2026-10-06' }] }),
  ]);
  const b = reopen();
  assert.deepEqual(b.receiptLedger, { migrated: 1, kept: 1 });
  const rows = b._db.all('SELECT * FROM receipts ORDER BY number');
  assert.deepEqual(rows.map(r => [r.order_id, r.method, r.received_at]), [['oNoInvoice', 'کارت به کارت', '2026-10-06']]);
  assert.deepEqual(b._db.all('SELECT order_id, document_id, kind FROM receipt_allocations').map(a => [a.order_id, a.document_id, a.kind]),
    [['oNoInvoice', '', 'committed']], 'بدون فاکتور، تخصیص به خودِ سفارش است');
  assert.deepEqual(storedOrder(b, 'oNoDate').payments.map(p => p.id), ['pX'], 'ردیفِ بی‌تاریخ در همان شکل می‌ماند');
});
