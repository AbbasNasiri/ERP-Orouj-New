'use strict';
/* اصلاحات ۱۷/بند ۲/۲: مسیر نوشتنِ رسید وجه — IPC، مجوزها و کنترل‌های منفی.
   چهار چیز سنجیده می‌شود:
   (۱) پولِ دریافتی فقط از سه مسیرِ «ثبت رسید / وضعیت چک / ابطال» وارد بانک می‌شود و
       شماره، تاریخ وصول و ثبت‌کننده را سرور می‌نویسد، نه متنِ درخواستِ ایستگاه؛
   (۲) رقم‌ها را هیچ ایستگاهی نمی‌سازد: تخصیص از پروندهٔ همان لحظه خوانده می‌شود و هر
       ردیفی که با ماندهٔ واقعیِ سفارشِ همان مشتری نخواند، کل درخواست را رد می‌کند —
       بدون نوشتن و بدون سوزاندنِ شماره؛
   (۳) چکِ در دست مطالبه را کم می‌کند ولی نقدِ صندوق نیست (تصمیم کارفرما) و برگشتی/باطل
       هیچ اثری روی هیچ‌کدام ندارند؛
   (۴) ردیف paymentsِ سفارش بازتاب است: از راه be:set نوشتنش بسته است و رقمش هرگز به
       نقشِ بی‌رقم نمی‌رسد. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const ORDERS = 'printshop_orders_v5';
const CUSTOMERS = 'printshop_customers_v2';
const M = 'مدیر چاپخانه', C = 'کارشناس سفارشات', F = 'مدیر مالی', S = 'انباردار';
const PASS = 'strong-receipt-write-pass';
const MILLION = 1000000;
const DAY = 86400000;
const clock0 = Date.parse('2026-11-02T09:00:00Z');
const TODAY = '2026-11-02';
const GOOD_REASON = 'واریز به حسابِ مشتریِ اشتباه؛ وصل شد';

function openDb(file) {
  const raw = new DatabaseSync(file);
  return {
    exec: sql => raw.exec(sql), run: (sql, ...p) => raw.prepare(sql).run(...p),
    get: (sql, ...p) => raw.prepare(sql).get(...p), all: (sql, ...p) => raw.prepare(sql).all(...p),
    tx(fn) { raw.exec('BEGIN'); try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
    close: () => raw.close(),
  };
}

const priced = total => ({ schemaVersion: 1, revision: 1, result: { total, currency: 'IRR' } });

/* دو مشتریِ تأییدشدهٔ شماره‌دار: c1 با یک فاکتور ۵۰M (o1) و یک سفارشِ تأییدشدهٔ ۲۵M (o2)،
   c2 با یک فاکتور ۴۰M (o3) — و یک مشتریِ هنوز بررسی‌نشده (c3).
   pricing و فاکتور همان‌طور که در آزمون‌های گزارش مالی مرسوم است مستقیم روی رکورد نوشته
   می‌شوند؛ ردیف پرداخت هیچ‌جا کاشته نمی‌شود، چون از این پس فقط بازتابِ رسید است. */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-receipt-write-'));
  const b = createBackend({ dataDir: dir, openDb, now: () => clock0 });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const admin = b.login('admin', '1234').token;
  assert.equal(b.setOwnPassword(admin, PASS).ok, true);
  const users = b.listUsers(admin).users;
  for (const [id, name, role] of [['fin', 'مدیر مالی', F], ['clerk', 'کارشناس سفارشات', C], ['store', 'انباردار', S]]) {
    users.push({ id, name, username: id, role, _plain: PASS });
  }
  assert.equal(b.saveUsers(admin, users).ok, true);
  const tokens = Object.fromEntries(['fin', 'clerk', 'store'].map(id => [id, b.login(id, PASS).token]));
  assert.equal(b.set(admin, CUSTOMERS, [
    { id: 'c1', name: 'کتاب نور' }, { id: 'c2', name: 'مدرسه مهدی' }, { id: 'c3', name: 'شرکت تازه' },
  ]).ok, true);
  for (const id of ['c1', 'c2']) {
    assert.equal(b.partyAction(admin, 'customer', id, 'approve', { reason: 'معتبر' }).ok, true);
    assert.equal(b.partyAction(admin, 'customer', id, 'issue_number').ok, true);
  }
  const seed = [
    { id: 'o1', number: '1001', customerId: 'c1', status: 'تحویل شده', total: 50 * MILLION, invoice: ['doc_I-1', 'I-1'] },
    { id: 'o2', number: '1002', customerId: 'c1', status: 'تایید شده', total: 25 * MILLION },
    { id: 'o3', number: '1003', customerId: 'c2', status: 'تحویل شده', total: 40 * MILLION, invoice: ['doc_I-3', 'I-3'] },
  ];
  const base = s => ({
    id: s.id, orderNumber: s.number, customerId: s.customerId, status: 'در انتظار تایید', date: '2026-10-01', quoteRev: 1,
    items: [{ id: s.id + '-i1', qty: '1', unitPrice: '0', services: [] }], payments: [], history: [],
  });
  assert.equal(b.set(admin, ORDERS, seed.map(base)).ok, true, 'پایهٔ سفارش‌ها نوشته شد');
  /* مرحله و مبلغِ ثبت‌شده از مسیر عام نوشتنی نیستند (همان قاعدهٔ همیشه)، پس مثل
     آزمون‌های گزارش مالی مستقیم روی رکوردِ ذخیره‌شده نوشته می‌شوند. */
  const write = s => b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?',
    JSON.stringify({ ...base(s), status: s.status, pricing: priced(s.total) }), ORDERS, s.id);
  seed.forEach(write);
  for (const s of seed) if (s.invoice) b._db.run(
    'INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)',
    s.invoice[0], 'invoice', s.id, 1, s.invoice[1], 'issued',
    JSON.stringify({ snapshot: { invoice: { totals: { total: s.total } } }, createdAt: clock0 - 5 * DAY }), clock0 - 5 * DAY);
  const stored = id => JSON.parse(b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, id).data);
  return {
    b, admin, ...tokens, stored,
    receipts: () => b._db.all('SELECT * FROM receipts ORDER BY number'),
    allocations: () => b._db.all('SELECT * FROM receipt_allocations ORDER BY id'),
    file: () => b.customerCreditFile(admin, { customerId: 'c1' }).file,
    nextMoney: () => b.numberingSettings(admin).settings.moneyreceipt.next,
  };
}

test('ثبت رسید نقد: شماره و ثبت‌کننده را سرور می‌نویسد، تخصیص را سرور پیشنهاد می‌کند و بازتابِ سفارش تازه می‌شود', t => {
  const { b, admin, fin, stored, receipts, allocations, file, nextMoney } = fixture(t);
  assert.equal(b.receiptLedger.migrated, 0, 'ردیفِ پرداختِ کاشته‌شده‌ای نیست؛ دفتر از صفر شروع می‌شود');
  const view = b.receiptsFor(fin, { customerId: 'c1' });
  assert.equal(view.ok, true, view.error);
  assert.deepEqual(view.receipts, []);
  assert.equal(view.lines.length, 2, 'دو خطِ پرونده: فاکتور ۵۰M و تعهد ۲۵M');
  assert.equal(view.proposal, null, 'بی‌مبلغِ تایپ‌شده هیچ پیشنهادی نیست');
  assert.deepEqual(view.methods, ['نقد', 'کارت به کارت', 'چک', 'حواله بانکی']);
  assert.equal(view.totals.gross, 0);
  /* پیشنهادِ تخصیص سمت سرور ساخته می‌شود: اول فاکتورِ صادرشده، بعد سفارشِ تأییدشده،
     و هر باقی‌مانده پیش‌پرداخت می‌ماند — ایستگاه فقط مبلغ را می‌فرستد. */
  const peek = b.receiptsFor(fin, { customerId: 'c1', amount: '۳۰۰۰۰۰۰۰' });
  assert.deepEqual(peek.proposal.rows.map(r => [r.orderId, r.documentId, r.amount, r.kind]),
    [['o1', 'doc_I-1', 30 * MILLION, 'definite']], 'ارقام فارسی یکسان می‌شوند');
  assert.equal(peek.advance, 0);
  const big = b.receiptsFor(fin, { customerId: 'c1', amount: '۸۰۰۰۰۰۰۰' });
  assert.deepEqual(big.proposal.rows.map(r => [r.orderId, r.amount]), [['o1', 50 * MILLION], ['o2', 25 * MILLION]]);
  assert.equal(big.advance, 5 * MILLION, 'باقیِ پول پیش‌پرداخت می‌ماند، گم نمی‌شود');
  const r = b.recordReceipt(fin, { customerId: 'c1', method: 'نقد', amount: '۳۰۰۰۰۰۰۰', receivedAt: TODAY, note: 'واریز ۳۰ میلیون' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.receipt.number, '9001', 'رشتهٔ رسید وجه از ۹۰۰۱ و از شمارندگرِ جدایِ خودش');
  assert.equal(r.receipt.amount, 30 * MILLION);
  assert.equal(r.receipt.status, 'cleared', 'دریافتِ غیرچکی همان لحظه وصول‌شده است');
  assert.equal(r.receipt.clearedAt, TODAY);
  assert.equal(r.receipt.opening, false);
  assert.equal(r.receipt.createdBy, 'مدیر مالی', 'ثبت‌کننده از نشست می‌آید، نه از متن درخواست (مثل voidedBy)');
  assert.equal(r.receipt.orderId, '', 'رسیدِ بی‌سفارشِ متصل، به پیشنهادِ موتور تخصیص خورد');
  assert.deepEqual(r.receipt.allocations, [{ orderId: 'o1', documentId: 'doc_I-1', amount: 30 * MILLION, kind: 'definite' }]);
  assert.equal(r.allocated, 30 * MILLION); assert.equal(r.advance, 0);
  assert.equal(nextMoney(), 9002, 'شمارهٔ بعدی جابه‌جا شد');
  assert.equal(receipts().length, 1); assert.equal(allocations().length, 1);
  const mirror = stored('o1').payments;
  assert.equal(mirror.length, 1);
  assert.deepEqual([mirror[0].amount, mirror[0].receiptNumber, mirror[0].statusLabel, mirror[0].allocatedTo, mirror[0].method, mirror[0].date],
    [30 * MILLION, '9001', 'وصول‌شده', 'فاکتور', 'نقد', TODAY]);
  assert.deepEqual(stored('o2').payments, [], 'سفارشِ بی‌تخصیص دست‌نخورده است');
  const after = file();
  assert.equal(after.definiteDebt, 20 * MILLION, '۵۰M فاکتور منهای ۳۰M تخصیص');
  assert.equal(after.lines.find(l => l.orderId === 'o1').paid, 30 * MILLION);
  assert.equal(b.auditRows(50).some(e => e.action === 'money_receipt' && e.target === '9001' && e.role === F), true, 'ثبتِ رسید در دفتر گزارش ماند');
  const ledger = b.receiptsFor(fin, { customerId: 'c1' });
  assert.deepEqual([ledger.totals.gross, ledger.totals.allocated, ledger.totals.advance, ledger.totals.cleared],
    [30 * MILLION, 30 * MILLION, 0, 30 * MILLION]);
  assert.equal(ledger.receipts[0].allocations.length, 1, 'دفترِ رسید تخصیص‌های خودش را هم می‌آورد');
});

test('کنترل منفی: تخصیصِ بیش از مانده، سندِ ناهمخوان، سفارشِ مشتریِ دیگر و رقمِ بی‌اعتبار — نه ریالی نوشته می‌شود نه شماره‌ای می‌سوزد', t => {
  const { b, fin, stored, receipts, allocations, file, nextMoney } = fixture(t);
  const base = { customerId: 'c1', method: 'نقد', receivedAt: TODAY };
  const rejected = (over, code, pattern) => {
    const r = b.recordReceipt(fin, { ...base, ...over });
    assert.equal(r.ok, false, `پذیرفته شد: ${JSON.stringify(over)}`);
    if (code) assert.equal(r.code, code, r.error);
    if (pattern) assert.match(String(r.error), pattern);
  };
  /* تخصیص از پروندهٔ همان لحظه خوانده می‌شود، پس هر رقمِ ساختگی رد می‌شود. */
  rejected({ amount: 30 * MILLION, allocations: [{ orderId: 'o1', amount: 55 * MILLION }] }, 'VALIDATION_FAILED', /مانده/);
  rejected({ amount: 40 * MILLION, allocations: [{ orderId: 'o1', amount: 30 * MILLION }, { orderId: 'o1', amount: 25 * MILLION }] }, 'VALIDATION_FAILED', /مانده/, 'جمعِ دو ردیف روی یک سفارش');
  rejected({ amount: 30 * MILLION, allocations: [{ orderId: 'o1', amount: 30 * MILLION, documentId: 'doc-ديگر' }] }, 'VALIDATION_FAILED', /سند/);
  rejected({ amount: 20 * MILLION, allocations: [{ orderId: 'o2', amount: 20 * MILLION, documentId: 'doc_I-1' }] }, 'VALIDATION_FAILED', /سند/, 'تعهدِ بی‌فاکتور را نمی‌توان به فاکتورِ دیگری وصل کرد');
  rejected({ amount: 30 * MILLION, allocations: [{ orderId: 'o3', amount: 30 * MILLION }] }, null, /پرونده/, 'سفارشِ مشتریِ دیگر');
  rejected({ amount: 40 * MILLION, allocations: [{ orderId: 'o1', amount: 50 * MILLION }] }, 'VALIDATION_FAILED', /بیشتر است/);
  for (const amount of [0, -5, 1.5, 'بیست میلیون', '۱۲ab']) rejected({ amount }, 'VALIDATION_FAILED');
  rejected({ amount: 30 * MILLION, method: 'منتن' }, 'VALIDATION_FAILED');
  rejected({ amount: 30 * MILLION, receivedAt: '۱۴۰۵-۰۸-۱۱' }, 'VALIDATION_FAILED', /تاریخ/, 'تاریخِ شمسیِ خام پذیرفته نمی‌شود');
  rejected({ amount: 30 * MILLION, status: 'paid' }, 'VALIDATION_FAILED', /وضعیت/);
  rejected({ amount: 30 * MILLION, method: 'چک', chequeBank: 'ملت', chequeDue: '2026-12-01' }, null, /چک/, 'چک بی‌شماره');
  rejected({ amount: 30 * MILLION, method: 'چک', chequeNumber: 'چ-۷۷', chequeBank: 'ملت' }, null, /سررسید/, 'چکِ در دست بی‌سررسید');
  rejected({ amount: 30 * MILLION, allocations: 'همه به فاکتور' }, 'VALIDATION_FAILED');
  rejected({ customerId: 'cX', amount: 5 * MILLION }, 'NOT_FOUND');
  rejected({ customerId: 'c3', amount: 5 * MILLION }, 'FORBIDDEN', null, 'مشتریِ تأییدنشده رسید ندارد');
  assert.equal(b.recordReceipt(fin, { ...base, amount: 5 * MILLION, method: 'نقد', orderId: 'o3' }).code, 'FORBIDDEN', 'سفارشِ متصل به رسید مالِ همین مشتری نیست');
  assert.equal(b.recordReceipt(fin, 'متن بی‌شکل').code, 'VALIDATION_FAILED');
  assert.equal(b.recordReceipt('نامعلوم'.padEnd(20, 'x'), { ...base, amount: 5 * MILLION }).code, 'UNAUTHENTICATED');
  assert.deepEqual(receipts(), [], 'هیچ رسیدی نوشته نشد');
  assert.deepEqual(allocations(), [], 'هیچ تخصیصی نوشته نشد');
  assert.equal(nextMoney(), 9001, 'درخواستِ ردشده شماره نمی‌سوزاند');
  assert.deepEqual(stored('o1').payments, [], 'بازتابِ سفارش دست‌نخورده است');
  assert.equal(file().definiteDebt, 50 * MILLION, 'بدهیِ پرونده تکان نخورد');
});

test('چک: مطالبه را کم می‌کند و نقدِ صندوق نه؛ وصول قطعی است، برگشتی بدهی را برمی‌گرداند و دوباره قابل ارائه است', t => {
  const { b, fin, stored, receipts, file, nextMoney } = fixture(t);
  const r = b.recordReceipt(fin, { customerId: 'c1', method: 'چک', amount: 20 * MILLION, receivedAt: TODAY, chequeNumber: '۷۷', chequeBank: 'ملت', chequeBranch: 'چراغ', chequeDue: '2026-12-01' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.receipt.status, 'held', 'چکِ تازه‌گرفته‌شده در دست است');
  assert.equal(r.receipt.clearedAt, '');
  assert.equal(r.receipt.cheque.number, '۷۷', 'شمارهٔ چک همان‌طور که تایپ شده می‌ماند؛ فقط مبلغ یکسان‌سازی می‌شود');
  assert.equal(r.receipt.cheque.due, '2026-12-01');
  assert.equal(b.receiptsFor(fin, { customerId: 'c1' }).totals.pendingCheque, 20 * MILLION);
  assert.deepEqual(b.receiptsFor(fin, { customerId: 'c1' }).chequeActions,
    { held: ['in_transit', 'cleared', 'bounced'], in_transit: ['cleared', 'bounced'], cleared: [], bounced: ['in_transit', 'cleared'], void: [] },
    'دکمه‌های رابط از همان جدولِ تبدیلِ سرور ساخته می‌شود؛ «در دست» مقصد نیست و وصولِ قطعی و باطل هیچ دکمه‌ای ندارند');
  assert.equal(b.receiptsFor(fin, { customerId: 'c1' }).totals.cleared, 0, 'چکِ وصول‌نشده نقدِ صندوق نیست (تصمیم کارفرما)');
  assert.equal(file().definiteDebt, 30 * MILLION, 'ولی مطالبه را کم می‌کند');
  assert.equal(stored('o1').payments[0].statusLabel, 'در دست');
  assert.equal(b.chequeAction(fin, r.receipt.id, 'in_transit').ok, true);
  assert.equal(b.chequeAction(fin, r.receipt.id, 'in_transit').code, 'VALIDATION_FAILED', 'همان وضعیت دوباره ثبت نمی‌شود');
  const cleared = b.chequeAction(fin, r.receipt.id, 'cleared');
  assert.equal(cleared.ok, true, cleared.error);
  assert.equal(cleared.receipt.status, 'cleared');
  assert.equal(cleared.receipt.clearedAt, TODAY, 'تاریخ وصول را سرور می‌نویسد');
  assert.equal(b.receiptsFor(fin, { customerId: 'c1' }).totals.cleared, 20 * MILLION);
  assert.equal(stored('o1').payments[0].statusLabel, 'وصول‌شده');
  assert.equal(b.chequeAction(fin, r.receipt.id, 'bounced').code, 'FORBIDDEN', 'وصولِ قطعی برگشت‌پذیر نیست');
  assert.equal(b.chequeAction(fin, r.receipt.id, 'held').code, 'VALIDATION_FAILED', '«در دست» عملیتِ چک نیست؛ بازگشتِ پول فقط با ابطالِ سند است');
  const cash = b.recordReceipt(fin, { customerId: 'c1', method: 'نقد', amount: 5 * MILLION, receivedAt: TODAY });
  assert.equal(b.chequeAction(fin, cash.receipt.id, 'cleared').code, 'FORBIDDEN', 'دریافتِ غیرچکی دست‌به‌دست نمی‌شود');
  assert.equal(b.chequeAction(fin, 'شناسهٔ بی‌رسید', 'cleared').code, 'NOT_FOUND');
  /* برگشتی: ردیف از بازتاب بیرون می‌رود و بدهی برمی‌گردد؛ ارائهٔ دوباره مجاز است. */
  const second = b.recordReceipt(fin, { customerId: 'c1', method: 'چک', amount: 10 * MILLION, receivedAt: TODAY, chequeNumber: '۸۸', chequeBank: 'سامان', chequeDue: '2026-12-05' });
  assert.equal(file().definiteDebt, 15 * MILLION, '۵۰ − ۲۰ وصول − ۵ نقد − ۱۰ در دست');
  const bounced = b.chequeAction(fin, second.receipt.id, 'bounced');
  assert.equal(bounced.ok, true, bounced.error);
  assert.equal(file().definiteDebt, 25 * MILLION, 'چکِ برگشتی بدهی را برمی‌گرداند');
  assert.equal(stored('o1').payments.some(p => p.receiptNumber === bounced.receipt.number), false, 'ردیفِ برگشتی در بازتاب نمی‌ماند');
  assert.equal(stored('o2').payments.length, 0, 'هیچ تخصیصی سرِ جایش مانده است');
  const again = b.chequeAction(fin, second.receipt.id, 'in_transit');
  assert.equal(again.ok, true, again.error);
  assert.equal(file().definiteDebt, 15 * MILLION, 'ارائهٔ دوبارهٔ همان چک، همان عدد را یک بار می‌شمارد');
  assert.equal(receipts().length, 3);
  assert.equal(nextMoney(), 9004, 'سه رسید، سه شماره');
  assert.equal(b.auditRows(50).some(e => e.action === 'money_receipt_status'), true);
});

test('ابطال رسید: سند است نه کلیک؛ تخصیص از بازتاب بیرون می‌رود، ردیف در بانک می‌ماند و بدهی برمی‌گردد', t => {
  const { b, fin, stored, receipts, file } = fixture(t);
  const r = b.recordReceipt(fin, { customerId: 'c1', method: 'حواله بانکی', amount: 30 * MILLION, receivedAt: TODAY });
  assert.equal(r.ok, true, r.error);
  assert.equal(file().definiteDebt, 20 * MILLION);
  assert.equal(b.voidReceipt(fin, { id: r.receipt.id, reason: 'اشتباه' }).code, 'VALIDATION_FAILED', 'دلیلِ کوتاه پذیرفته نمی‌شود');
  assert.equal(b.voidReceipt(fin, { id: r.receipt.id }).code, 'VALIDATION_FAILED');
  assert.equal(b.voidReceipt(fin, { id: 'شناسهٔ بی‌رسید', reason: GOOD_REASON }).code, 'NOT_FOUND');
  assert.equal(receipts()[0].status, 'cleared', 'کوششِ ابطالِ بی‌دلیل چیزی را عوض نکرد');
  assert.equal(file().definiteDebt, 20 * MILLION, 'بدهی هم تکان نخورد');
  const voided = b.voidReceipt(fin, { id: r.receipt.id, reason: GOOD_REASON });
  assert.equal(voided.ok, true, voided.error);
  assert.equal(voided.receipt.status, 'void');
  assert.equal(voided.receipt.voidReason, GOOD_REASON);
  assert.equal(voided.receipt.voidedBy, 'مدیر مالی', 'ابطال‌کننده از نشست می‌آید');
  assert.equal(receipts().length, 1, 'ردیف حذف نمی‌شود؛ سندِ باطل در بانک می‌ماند');
  assert.equal(b._db.all('SELECT id FROM receipt_allocations').length, 1, 'تخصیص هم پاک نمی‌شود');
  assert.deepEqual(stored('o1').payments, [], 'بازتاب، رسیدِ باطل را نمی‌شمارد');
  assert.equal(file().definiteDebt, 50 * MILLION, 'بدهی به پرونده برمی‌گردد');
  assert.equal(b.receiptsFor(fin, { customerId: 'c1' }).totals.gross, 0, 'رسیدِ باطل هیچ جمعِ زنده‌ای ندارد');
  assert.equal(b.voidReceipt(fin, { id: r.receipt.id, reason: GOOD_REASON }).ok, false, 'ابطالِ مکرر');
  assert.equal(b.chequeAction(fin, r.receipt.id, 'cleared').code, 'FORBIDDEN', 'رسیدِ باطل وضعیتی ندارد');
});

test('دروازهٔ نقش‌ها: دفتر رسید و هر سه مسیر نوشتن فقط مدیر چاپخانه و مدیر مالی؛ رقمِ بازتاب به بی‌رقم نمی‌رسد', t => {
  const { b, admin, fin, clerk, store, stored, receipts, nextMoney } = fixture(t);
  const payload = { customerId: 'c1', method: 'نقد', amount: 30 * MILLION, receivedAt: TODAY };
  assert.equal(b.receiptsFor(fin, { customerId: 'c1' }).ok, true, 'مدیر مالی دفتر را می‌خواند');
  assert.equal(b.receiptsFor(clerk, { customerId: 'c1' }).code, 'FORBIDDEN', 'کارشناس سفارشات دفتر رسید را نمی‌خواند');
  assert.equal(b.receiptsFor(store, { customerId: 'c1' }).code, 'FORBIDDEN');
  assert.equal(b.receiptsFor('نامعلوم'.padEnd(20, 'x'), { customerId: 'c1' }).code, 'UNAUTHENTICATED');
  for (const token of [clerk, store]) {
    assert.equal(b.recordReceipt(token, payload).code, 'FORBIDDEN', 'ثبت رسید از ایستگاهِ بی‌اجازه');
    assert.equal(b.chequeAction(token, 'هرشناسه', 'cleared').code, 'FORBIDDEN');
    assert.equal(b.voidReceipt(token, { id: 'هرشناسه', reason: GOOD_REASON }).code, 'FORBIDDEN');
  }
  assert.equal(b.recordReceipt('نامعلوم'.padEnd(20, 'x'), payload).code, 'UNAUTHENTICATED');
  assert.deepEqual(receipts(), [], 'هیچ‌کدام از این کوشش‌ها چیزی ننوشت');
  assert.equal(nextMoney(), 9001, 'هیچ شماره‌ای هم نسوخت');
  assert.equal(b.recordReceipt(admin, payload).ok, true, 'مدیر چاپخانه هم می‌نویسد');
  assert.equal(stored('o1').payments.length, 1, 'بازتاب روی رکورد نوشته شد');
  assert.deepEqual(b.get(clerk, ORDERS).value.find(o => o.id === 'o1').payments, [], 'رقمِ وصولی به کارشناس سفارشات رسید');
  assert.deepEqual(b.get(store, ORDERS).value.find(o => o.id === 'o1').payments, [], 'رقمِ وصولی به انباردار رسید');
  assert.equal(b.get(fin, ORDERS).value.find(o => o.id === 'o1').payments.length, 1, 'مدیر مالی بازتاب را می‌بیند');
  const peek = b.customerCreditFile(clerk, { customerId: 'c1' });
  assert.equal(peek.ok, true, 'کارشناس پرونده را بی‌رقم می‌بیند');
  assert.equal(peek.file.lines, undefined, 'خط‌های مبلغ‌دار از دیدِ بی‌رقم بیرون رفت');
  assert.equal(JSON.stringify(peek.file).includes(String(30 * MILLION)), false, 'رقمِ پرونده از مسیرِ بی‌رقم بیرون رفت');
});

test('راه‌های سیم: هر چهار کانال در جدول allow-list‌اند و همان دروازه را روی HTTP هم دارند', t => {
  const { b, admin, fin, clerk, nextMoney } = fixture(t);
  assert.equal(invoke('be:receipts', b, {}, fin, [{ customerId: 'c1' }]).ok, true, 'کانالِ خواندن از سیم باز است');
  assert.equal(invoke('be:receipts', b, {}, clerk, [{ customerId: 'c1' }]).code, 'FORBIDDEN', 'کانال هم نقش را می‌پرسد');
  assert.equal(invoke('be:receipts', b, {}, 'نامعتبر', [{ customerId: 'c1' }]).code, 'UNAUTHENTICATED');
  assert.equal(invoke('be:receipts', b, {}, fin, [{}]).code, 'VALIDATION_FAILED', 'بی‌مشتری پذیرفته نمی‌شود');
  const peek = invoke('be:receipts', b, {}, fin, [{ customerId: 'c1', amount: '۳۰۰۰۰۰۰۰' }]);
  assert.equal(peek.proposal.rows.length, 1, 'پیشنهادِ تخصیص از راهِ سیم هم سمت سرور حساب می‌شود');
  const cheque = invoke('be:recordReceipt', b, {}, fin, [{ customerId: 'c1', method: 'چک', amount: '۲۰۰۰۰۰۰۰', receivedAt: TODAY, chequeNumber: '۷۷', chequeDue: '2026-12-01' }]);
  assert.equal(cheque.ok, true, cheque.error);
  assert.equal(invoke('be:recordReceipt', b, {}, clerk, [{ customerId: 'c1', method: 'نقد', amount: 10, receivedAt: TODAY }]).code, 'FORBIDDEN');
  assert.equal(invoke('be:receiptCheque', b, {}, clerk, [cheque.receipt.id, 'cleared']).code, 'FORBIDDEN');
  assert.equal(invoke('be:voidReceipt', b, {}, clerk, [{ id: cheque.receipt.id, reason: GOOD_REASON }]).code, 'FORBIDDEN');
  assert.equal(cheque.receipt.number, '9001', 'شماره را سرور داده است');
  assert.equal(invoke('be:receiptCheque', b, {}, fin, [cheque.receipt.id, 'bounced']).ok, true);
  assert.equal(invoke('be:voidReceipt', b, {}, fin, [{ id: cheque.receipt.id, reason: GOOD_REASON }]).ok, true);
  assert.equal(nextMoney(), 9002);
  const spy = { receiptsFor: () => ({ ok: true, spy: true }), recordReceipt: () => ({ ok: true, spy: true }), chequeAction: () => ({ ok: true, spy: true }), voidReceipt: () => ({ ok: true, spy: true }) };
  for (const name of ['be:receipts', 'be:recordReceipt', 'be:receiptCheque', 'be:voidReceipt']) {
    assert.equal(invoke(name, spy, {}, 'x'.repeat(12), [{}]).code, 'UNAUTHENTICATED', name + ' نشست می‌خواهد');
    assert.equal(invoke(name, spy, {}, admin, [{}]).spy, true, name + ' در جدول کانال‌ها ثبت است');
  }
});

test('بازتاب نوشتنی نیست: ردیف پرداخت از راه be:set نه افزوده می‌شود نه کم؛ و مسیرِ عادیِ ذخیره نمی‌شکند', t => {
  const { b, admin, fin, stored, receipts } = fixture(t);
  assert.equal(b.recordReceipt(fin, { customerId: 'c1', method: 'نقد', amount: 30 * MILLION, receivedAt: TODAY }).ok, true);
  const rows = b.get(admin, ORDERS).value;
  assert.equal(rows.find(o => o.id === 'o1').payments.length, 1, 'ایستگاه بازتابِ تازه را خوانده است');
  /* همان بردارِ خوانده‌شده را پس بفرستیم — مسیرِ عادیِ ذخیره نباید بشکند. */
  assert.equal(b.set(admin, ORDERS, structuredClone(rows)).ok, true, 'ذخیرهٔ دوبارهٔ همان اطلاعات شکست');
  for (const mutate of [
    o => { o.payments = [{ id: 's1', amount: 99 * MILLION }]; },
    o => { o.payments = []; },
    o => { o.payments[0].amount = 1; },
    o => { o.payments[0].receiptNumber = '9999'; },
    o => { o.payments[0].status = 'bounced'; },
  ]) {
    const forged = structuredClone(rows); mutate(forged.find(o => o.id === 'o1'));
    assert.equal(b.set(admin, ORDERS, forged).code, 'FORBIDDEN', 'بازنویسیِ بازتاب از راهِ سفارش');
  }
  const fresh = structuredClone(rows);
  fresh.push({ id: 'o9', orderNumber: '1099', customerId: 'c1', status: 'در انتظار تایید', quoteRev: 1, date: '2026-10-01', items: [], payments: [{ id: 'injected', amount: 500 * MILLION }], history: [] });
  assert.equal(b.set(admin, ORDERS, fresh).code, 'FORBIDDEN', 'سفارشِ تازه با پرداختِ کاشته‌شده');
  assert.equal(stored('o1').payments[0].amount, 30 * MILLION, 'هیچ رقمی عوض نشد');
  assert.equal(b._db.get('SELECT count(*) n FROM receipts').n, 1, 'و هیچ رسیدی ساخته نشد');
  assert.equal(b.get(admin, ORDERS).value.length, 3, 'سفارشِ تازه هم ثبت نشد');
  assert.equal(receipts().length, 1);
});
test('بازتابِ هم‌روزها به ترتیبِ شمارهٔ رسید می‌نشیند؛ شناسهٔ تصادفیِ تخصیص معیارِ چیدمان نیست', t => {
  const { b, fin, stored } = fixture(t);
  for (const amount of [7 * MILLION, 3 * MILLION, 5 * MILLION, MILLION]) {
    assert.equal(b.recordReceipt(fin, { customerId: 'c1', method: 'نقد', amount, receivedAt: TODAY }).ok, true);
  }
  /* چهار رسید در یک روز، و idِ هر تخصیپ تصادفی است: تنها ترتیبِ پایدار «شمارهٔ رسید» است.
     پنج دور تکرار می‌شود تا اگر روزی ترتیب دوباره به id تکیه کرد، آزمون حتماً بگیردش. */
  for (let round = 0; round < 5; round++) {
    assert.equal(b.recordReceipt(fin, { customerId: 'c1', method: 'حواله بانکی', amount: 2 * MILLION, receivedAt: TODAY }).ok, true);
    assert.deepEqual(stored('o1').payments.map(p => p.receiptNumber),
      ['9001', '9002', '9003', '9004', ...Array.from({ length: round + 1 }, (_, i) => String(9005 + i))],
      'دور ' + round);
  }
});
