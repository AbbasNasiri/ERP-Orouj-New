'use strict';
/* اصلاحات ۱۷/بند ۲: آزمونِ ماژول پاکِ رسید وجه.
   نمونه‌ها از سند کارفرما گرفته شده‌اند: چک ۲۰Mِ در دست ذیلِ فاکتور ۵۰M، دو فاکتور با
   سررسیدهای مختلف، و باقی‌مانده‌ای که به هیچ فاکتوری نمی‌خورد.
   سه چیز اینجا کنترل منفی است: (۱) مبلغِ بی‌اعتبار عدد نمی‌سازد، (۲) چکِ وصول‌نشده
   مطالبه را کم می‌کند ولی نقد شمرده نمی‌شود، (۳) برگشتی و باطل از هیچ جمعی بیرون نمی‌مانند
   و هیچ اثری هم ندارند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../electron/receipts.js');

const M = 1000000;
const base = { id: 'r1', number: '9001', customerId: 'c1', orderId: 'o1', receivedAt: '2026-11-01' };
const receipt = (over = {}) => R.receiptOf({ ...base, method: 'نقد', amount: 10 * M, ...over });

test('دریافتِ نقدِ همان‌جا وصول‌شده است و پولِ صندوق شمرده می‌شود', () => {
  const r = receipt();
  assert.equal(r.status, R.STATUS.CLEARED);
  assert.equal(R.isLive(r.status), true, 'ماندهٔ مشتری را کم می‌کند');
  assert.equal(R.isCash(r), true);
  assert.equal(R.isPendingCheque(r), false);
});

test('چکِ تازه‌گرفته‌شده «در دست» است: زنده برای بدهی، نه‌نقد برای خزانه', () => {
  const r = receipt({ method: 'چک', chequeNumber: '۱۲۳۴۵', chequeBank: 'ملت', chequeBranch: 'شعبه ۱۲', chequeDue: '2026-12-01' });
  assert.equal(r.status, R.STATUS.HELD);
  assert.equal(R.isLive(r.status), true, 'کارفرما: مطالبه کم می‌شود');
  assert.equal(R.isCash(r), false, 'کارفرما: تا روز وصول نقدِ صندوق نیست');
  assert.equal(R.isPendingCheque(r), true);
  assert.deepEqual(r.cheque, { number: '۱۲۳۴۵', bank: 'ملت', branch: 'شعبه ۱۲', due: '2026-12-01' });
});

test('چکِ بدون شماره یا بدون سررسید رد می‌شود؛ وضعیتِ ناشناخته عدد نمی‌سازد', () => {
  assert.throws(() => receipt({ method: 'چک', chequeNumber: '' }), /شمارهٔ چک/);
  assert.throws(() => receipt({ method: 'چک', chequeNumber: '۱', chequeDue: '' }), /سررسید/);
  assert.throws(() => receipt({ status: 'در_دست' }), /وضعیت/);
  assert.throws(() => receipt({ method: 'صری' }), /فهرست مجاز/);
});

test('مبلغِ بی‌اعتبار (صفر، منفی، غیرصحیح، رشته) رسید نمی‌سازد', () => {
  for (const amount of [0, -5 * M, 'abc', null, undefined, 10 * M + 0.5, 1e20]) {
    assert.throws(() => receipt({ amount }), /مبلغ رسید/, `مبلغ ${String(amount)} نباید رسید بسازد`);
  }
});

test('دریافتِ غیرچکی فقط می‌تواند وصول‌شده یا باطل باشد', () => {
  assert.equal(receipt({ method: 'حواله بانکی', status: R.STATUS.CLEARED }).status, 'cleared');
  assert.equal(receipt({ method: 'نقد', status: R.STATUS.VOID }).status, 'void');
  assert.throws(() => receipt({ method: 'نقد', status: R.STATUS.IN_TRANSIT }), /غیرچکی/);
  assert.throws(() => receipt({ method: 'کارت به کارت', status: R.STATUS.BOUNCED }), /غیرچکی/);
});

test('برگشتی و باطل از زنده بیرون‌اند؛ وصول‌شده زنده است', () => {
  for (const status of [R.STATUS.BOUNCED, R.STATUS.VOID]) {
    assert.equal(R.isLive(status), false, status);
  }
  for (const status of [R.STATUS.HELD, R.STATUS.IN_TRANSIT, R.STATUS.CLEARED]) {
    assert.equal(R.isLive(status), true, status);
  }
});

/* ---- پیشنهادِ تخصیص ---- */
const lines = [
  { orderId: 'o3', orderNumber: '1003', kind: 'committed', source: 'بدون فاکتور', documentId: '', payable: 30 * M, open: 30 * M, dueDate: '' },
  { orderId: 'o1', orderNumber: '1001', kind: 'definite', source: 'فاکتور 3001', documentId: 'd1', payable: 50 * M, open: 50 * M, dueDate: '2026-11-20' },
  { orderId: 'o2', orderNumber: '1002', kind: 'definite', source: 'فاکتور 3002', documentId: 'd2', payable: 20 * M, open: 20 * M, dueDate: '2026-10-10' },
];

test('تخصیص اول از سررسیدِ گذشته شروع می‌شود و فاکتور بر سفارشِ بی‌فاکتور مقدم است', () => {
  const p = R.proposeAllocations(lines, 25 * M);
  assert.deepEqual(p.rows.map(r => [r.documentId, r.amount]), [['d2', 20 * M], ['d1', 5 * M]]);
  assert.equal(p.advance, 0);
});

test('هر باقی‌مانده پیش‌پرداخت می‌ماند و در هیچ ردیفی نمی‌نشیند', () => {
  const p = R.proposeAllocations(lines, 120 * M);
  assert.equal(p.rows.reduce((s, r) => s + r.amount, 0), 100 * M, 'جمعِ تخصیص از بازِ خطوط بیشتر نمی‌شود');
  assert.equal(p.advance, 20 * M);
  assert.deepEqual(p.rows.map(r => r.kind), ['definite', 'definite', 'committed']);
});

test('بی‌خطِ باز، همهٔ پول پیش‌پرداخت است', () => {
  const p = R.proposeAllocations([{ orderId: 'o1', kind: 'definite', open: 0 }], 10 * M);
  assert.deepEqual(p.rows, []);
  assert.equal(p.advance, 10 * M);
});

/* ---- بازتاب و جمع‌ها ---- */
const held = receipt({ id: 'r9', number: '9009', method: 'چک', amount: 20 * M, chequeNumber: 'چ-۱', chequeBank: 'ملت', chequeDue: '2026-12-01' });
const cash = receipt({ id: 'r10', number: '9010', method: 'نقد', amount: 10 * M, receivedAt: '2026-11-03' });
const bounced = receipt({ id: 'r11', number: '9011', method: 'چک', amount: 5 * M, chequeNumber: 'چ-۲', chequeDue: '2026-11-05', status: R.STATUS.BOUNCED });
const allocations = [
  { id: 'a1', receiptId: 'r9', orderId: 'o1', documentId: 'd1', amount: 20 * M, kind: 'definite' },
  { id: 'a2', receiptId: 'r10', orderId: 'o1', documentId: '', amount: 10 * M, kind: 'committed' },
  { id: 'a3', receiptId: 'r11', orderId: 'o1', documentId: 'd1', amount: 5 * M, kind: 'definite' },
];

test('بازتابِ سفارش: هر تخصیصِ زنده یک ردیف، با شمارهٔ رسید و وضعیتِ فارسی؛ برگشتی نه', () => {
  const rows = R.mirrorOf([held, cash, bounced], allocations, 'o1');
  assert.deepEqual(rows.map(r => r.id), ['a1', 'a2'], 'به ترتیب تاریخِ دریافت');
  assert.deepEqual(rows.map(r => r.receiptNumber), ['9009', '9010']);
  assert.equal(rows[0].statusLabel, 'در دست');
  assert.equal(rows[0].allocatedTo, 'فاکتور');
  assert.equal(rows[1].allocatedTo, 'سفارش');
  assert.equal(rows[0].chequeNumber, 'چ-۱');
  assert.equal(rows[0].chequeBank, 'ملت');
  assert.equal(rows[0].chequeDue, '2026-12-01');
  assert.equal(rows[0].date, '2026-11-01');
  assert.equal(rows.some(r => r.id === 'a3'), false, 'چکِ برگشتی به بدهی برمی‌گردد و در بازتاب نیست');
});

test('سفارشِ دیگری ردیفِ این سفارش را نمی‌گیرد', () => {
  assert.deepEqual(R.mirrorOf([held, cash], allocations, 'o7'), []);
});

test('جمع‌های مشتری: نقدِ صندوق با چکِ در دست یکی نیست', () => {
  const t = R.totals([held, cash, bounced], allocations, 'c1');
  assert.equal(t.gross, 30 * M, 'دو رسیدِ زنده، برگشتی شمرده نمی‌شود');
  assert.equal(t.allocated, 30 * M);
  assert.equal(t.advance, 0);
  assert.equal(t.cleared, 10 * M, 'فقط نقد');
  assert.equal(t.pendingCheque, 20 * M, 'چکِ در دست');
});

test('رسیدِ بی‌تخصیص کاملش پیش‌پرداخت است', () => {
  const t = R.totals([cash], [], 'c1');
  assert.deepEqual([t.gross, t.allocated, t.advance], [10 * M, 0, 10 * M]);
});

test('مشتریِ دیگر از این رسیدها عدد نمی‌گیرد', () => {
  assert.deepEqual(R.totals([cash], allocations, 'c2'), { gross: 0, allocated: 0, advance: 0, pendingCheque: 0, cleared: 0 });
});

test('تاریخِ بی‌اعتبارِ رسید با فرمِ روز نمی‌گذرد', () => {
  assert.throws(() => receipt({ receivedAt: '۱۴۰۵/۰۸/۱۰' }), /تاریخ دریافت/);
  assert.throws(() => receipt({ method: 'چک', chequeNumber: '۱' }), /سررسید/);
  assert.equal(receipt({ receivedAt: '2026-11-01T12:30:00Z' }).receivedAt, '2026-11-01', 'برچسبِ روز از ساعت جدا می‌شود');
});

test('برچسبِ وضعیت‌ها همان پنج وضعیتی است که کارفرما نوشت', () => {
  assert.deepEqual(Object.values(R.STATUS), ['held', 'in_transit', 'cleared', 'bounced', 'void']);
  assert.deepEqual(Object.values(R.STATUS_LABELS), ['در دست', 'در جریان وصول', 'وصول‌شده', 'برگشتی', 'باطل']);
  assert.deepEqual(R.METHODS, ['نقد', 'کارت به کارت', 'چک', 'حواله بانکی']);
});
