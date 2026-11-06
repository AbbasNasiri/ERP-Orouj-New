'use strict';
/* اصلاحات ۱۷/بند ۱: پروندهٔ اعتباری مشتری از دید سرور.
   اعداد از نمونهٔ کارفرما گرفته شده‌اند (سقف ۱۰۰M / بدهی فاکتور ۵۰M / تعهد ۲۵M / پیش‌پرداخت ۱۰M)
   و همان‌جا که ممکن است، کنترل منفی هم دارد: چه کسی رقم نمی‌بیند، چه کسی مجوز نمی‌سازد،
   و این‌که سند مجوز هیچ‌وقت حذف نمی‌شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');

const ORDERS = 'printshop_orders_v5';
const CUSTOMERS = 'printshop_customers_v2';
const M = 'مدیر چاپخانه', C = 'کارشناس سفارشات', F = 'مدیر مالی', S = 'انباردار';
const DAY = 86400000;
const clock0 = Date.parse('2026-11-02T09:00:00Z');
const MILLION = 1000000;

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
  id, orderNumber: id.replace(/\D/g, ''), customerId: over.customerId || 'c1', status, date: '2026-10-01',
  items: [{ id: id + '-i1', qty: '1', unitPrice: '0', services: [] }], payments: [], history: [], ...over,
});
/* پیش‌فاکتورِ ذخیره‌شده دقیقاً همان شکلی است که pricing.js می‌گذارد: مبلغ و پول داخل result. */
const priced = total => ({ schemaVersion: 1, revision: 1, result: { total, currency: 'IRR' } });

function fixture(t, { orders = [], customer = { id: 'c1', name: 'نمونهٔ کارفرما', phone: '09120000000' } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-credit-'));
  const b = createBackend({ dataDir: dir, openDb, now: () => clock0 });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const admin = b.login('admin', '1234').token;
  assert.equal(b.setOwnPassword(admin, 'admin-credit-strong').ok, true);
  assert.equal(b.set(admin, 'printshop_manager_pin', '246810').ok, true);
  const users = b.listUsers(admin).users;
  for (const [id, role] of [['clerk', C], ['finance', F], ['store', S]]) users.push({ id, username: id, name: id, role, active: true, _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(admin, users).ok, true);
  const tokens = Object.fromEntries(['clerk', 'finance', 'store'].map(id => [id, b.login(id, 'strong-test-pass').token]));
  /* ردیف‌های نمونه از راهِ ذخیره‌گاه مستقیم می‌آیند (پیش‌فاکتور و فاکتورِ صادرشده را هیچ
     فرمی نمی‌تواند در یک لحظه بسازد)؛ kinds می‌گوید این کلید فهرست است نه مقدارِ تکی. */
  for (const key of [ORDERS, CUSTOMERS]) b._db.run("INSERT OR REPLACE INTO kinds(key, kind) VALUES(?, 'array')", key);
  assert.equal(b.set(admin, CUSTOMERS, [customer]).ok, true);
  orders.forEach((o, i) => b._db.run('INSERT OR REPLACE INTO records(collection,id,ord,data,updated_at,rev) VALUES(?,?,?,?,?,?)',
    ORDERS, o.id, i, JSON.stringify(o), clock0, 1));
  const invoice = (row) => b._db.run('INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)',
    'doc_' + row.number, 'invoice', row.orderId, 1, row.number, row.status || 'issued',
    JSON.stringify({ snapshot: { invoice: { totals: { total: row.total } } }, createdAt: row.issuedAt }), row.issuedAt);
  return { b, admin, ...tokens, invoice };
}

/* نمونهٔ کارفرما: فاکتورِ صادرشده ۵۰M، سفارش تأییدشدهٔ بی‌فاکتور ۲۵M، پیش‌پرداخت مصرف‌نشده ۱۰M */
const example = () => [
  order('oOld', 'تحویل شده', { date: '2026-09-20', pricing: priced(50 * MILLION) }),
  order('oLive', 'تایید شده', { pricing: priced(25 * MILLION) }),
  order('oAdv', 'تایید شده', { pricing: priced(20 * MILLION), payments: [{ id: 'p1', amount: 30 * MILLION, method: 'کارت', date: '2026-10-02' }] }),
];
const exampleInvoices = [
  { orderId: 'oOld', number: 'I-1', total: 50 * MILLION, issuedAt: clock0 - 5 * DAY },
];

test('نمونهٔ کارفرما سرِهم از سرور: تعهد خالص ۶۵M، اعتبار آزاد ۳۵M، عبورِ سفارشِ ۴۵M برابر ۱۰M', t => {
  const { b, admin, finance, invoice } = fixture(t, { orders: example() });
  exampleInvoices.forEach(invoice);
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  const res = b.customerCreditFile(admin, { customerId: 'c1', newAmount: 45 * MILLION });
  assert.equal(res.ok, true, res.error);
  const f = res.file;
  assert.equal(f.ceiling, 100 * MILLION, 'سقف از جدول پروندهٔ اعتباری خوانده می‌شود');
  assert.equal(f.definiteDebt, 50 * MILLION, 'بدهی قطعی = ماندهٔ فاکتور صادرشده');
  assert.equal(f.overdueDebt, 0, 'با مهلت ۳۰ روزه و فاکتور پنج‌روزِ پیش، چیزی سررسید نگذشته است');
  assert.equal(f.commitment, 25 * MILLION, 'تعهد = سفارش تأییدشدهٔ بی‌فاکتور');
  assert.equal(f.advance, 10 * MILLION, 'پیش‌پرداخت = دریافتِ بیشتر از مبلغ');
  assert.equal(f.netCommitment, 65 * MILLION, '۵۰ + ۲۵ − ۱۰ = ۶۵');
  assert.equal(f.available, 35 * MILLION, '۱۰۰ − ۶۵ = ۳۵');
  assert.equal(f.usedPercent, 65);
  assert.equal(f.status, 'آزاد');
  assert.equal(f.policySource, 'جدول پروندهٔ اعتباری');
  assert.equal(f.openTotal, 75 * MILLION, 'دست‌به‌نقدِ باز پیش از کسرِ پیش‌پرداخت — مبنای دروازهٔ سرور');
  const v = res.verdict;
  assert.equal(v.projected, 110 * MILLION);
  assert.equal(v.overBy, 10 * MILLION, 'همان ۱۰M عبور از سقف که کارفرما گفت');
  assert.equal(v.needsApproval, true);
  assert.equal(v.status, 'نیازمند مجوز');
  assert.match(v.text, /از سقف اعتبار عبور می‌کند/);
  /* بدهی قطعی و تعهد هرگز در یک عدد قاطی نمی‌شوند: هر دو ردیف، با منبعِ مبلغ. */
  const rows = f.lines.map(l => [l.orderId, l.kind, l.source, l.open]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  assert.deepEqual(rows, [
    ['oAdv', 'committed', 'بدون فاکتور', 0],
    ['oLive', 'committed', 'بدون فاکتور', 25 * MILLION],
    ['oOld', 'definite', 'فاکتور I-1', 50 * MILLION],
  ]);
});

test('کنترل منفی: فاکتورِ صادرشدهٔ ابطال‌شده بدهی قطعی نمی‌سازد', t => {
  const { b, admin, finance, invoice } = fixture(t, { orders: example() });
  invoice({ orderId: 'oOld', number: 'I-2', total: 50 * MILLION, issuedAt: clock0 - 5 * DAY, status: 'void' });
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  const f = b.customerCreditFile(admin, { customerId: 'c1' }).file;
  assert.equal(f.definiteDebt, 0, 'سند بی‌اعتبار رقم نمی‌سازد');
  assert.equal(f.lines.find(l => l.orderId === 'oOld').kind, 'committed', 'خودِ سفارش همچنان تعهد است');
});

test('مهلت پرداخت سررسید را می‌سازد و بدهی سررسیدگذشته جدا شمرده می‌شود', t => {
  const { b, admin, finance, invoice } = fixture(t, { orders: example() });
  invoice({ orderId: 'oOld', number: 'I-3', total: 50 * MILLION, issuedAt: clock0 - 40 * DAY });
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  const f = b.customerCreditFile(admin, { customerId: 'c1' }).file;
  assert.equal(f.overdueDebt, 50 * MILLION);
  assert.equal(f.overdueCount, 1);
  assert.equal(f.lines.find(l => l.orderId === 'oOld').dueDate, '2026-10-23', 'موعد = تاریخ فاکتور + مهلت');
  assert.equal(f.lines.find(l => l.orderId === 'oOld').overdue, true);
  /* تعهد بی‌فاکتور موعد ندارد: سررسیدگذشته فقط از فاکتور حساب می‌شود. */
  assert.equal(f.lines.find(l => l.orderId === 'oLive').dueDate, '');
});

test('کنترل منفی: کارشناس سفارشات وضعیت و تصمیم را می‌بیند، رقم‌ها را نه', t => {
  const { b, admin, clerk, finance, invoice } = fixture(t, { orders: example() });
  exampleInvoices.forEach(invoice);
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  const full = b.customerCreditFile(admin, { customerId: 'c1', newAmount: 45 * MILLION });
  const bare = b.customerCreditFile(clerk, { customerId: 'c1', newAmount: 45 * MILLION });
  assert.equal(bare.ok, true);
  assert.equal(JSON.stringify(bare).includes(String(100 * MILLION)), false, 'سقف در پاسخ کارشناس نیست');
  for (const key of ['ceiling', 'definiteDebt', 'overdueDebt', 'advance', 'commitment', 'netCommitment', 'available', 'openTotal', 'lines', 'policy']) {
    assert.equal(bare.file[key], undefined, `${key} سانسور شد`);
  }
  assert.equal(bare.file.status, full.file.status, 'وضعیت اعتبار برای تصمیم‌گیری لازم است');
  assert.equal(bare.verdict.newAmount, undefined, 'مبلغ سفارشِ در حال ثبت را فقط نقشِ پول‌دار می‌فرستد');
  /* کنترل منفی: کارشناس با ادعای مبلغِ بزرگ تصمیم را بزرگ‌تر نمی‌کند — رقمش خوانده نمی‌شود
     و تصمیم از همان پروندهٔ ثبت‌شده می‌آید (ذیلِ سقف: مجوز لازم نیست). */
  assert.equal(bare.verdict.needsApproval, false, 'ادعای مبلغ از سمت کارشناس تصمیم را عوض نمی‌کند');
  assert.equal(b.customerCreditFile(admin, { customerId: 'c1', newAmount: 0 }).verdict.needsApproval, false);
  assert.equal(b.customerCreditFile(admin, { customerId: 'c1', newAmount: 45 * MILLION }).verdict.needsApproval, true);
  assert.match(bare.verdict.shortText, /سقف/);
  assert.equal(bare.verdict.text, undefined);
  /* بی‌سقف: تصمیم «مجوز لازم است» بدون هیچ رقمی به کارشناس می‌رسد. */
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 0, termDays: 30 }).ok, true);
  const bareNoCeiling = b.customerCreditFile(clerk, { customerId: 'c1' });
  assert.equal(bareNoCeiling.verdict.needsApproval, true, 'ماندهٔ باز بی‌فاکتور هم مجوز می‌خواهد');
  assert.match(bareNoCeiling.verdict.shortText, /مجوز مستند مدیر لازم است/);
  assert.equal(/[0-9۰-۹]/.test(bareNoCeiling.verdict.shortText), false, 'جملهٔ تصمیم بی‌رقم است');
  assert.equal(bareNoCeiling.canDecide, false, 'کارشناس حق ثبت مجوز استثنایی ندارد');
  assert.equal(full.canDecide, true);
});

test('تصمیمِ اعتبار یکی است: برای سفارشِ ثبت‌شده، سرور مبلغ را از خودِ رکورد می‌خواند نه از رابط', t => {
  const { b, admin, clerk, finance, invoice } = fixture(t, { orders: example().concat([
    order('oNext', 'در انتظار تایید', { pricing: priced(45 * MILLION) }),
  ]) });
  exampleInvoices.forEach(invoice);
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  /* oNext هنوز در پرونده نشسته (تأیید نشده) و مبلغش از snapshot خودش خوانده می‌شود → ۱۰M عبور. */
  const asManager = b.customerCreditFile(admin, { customerId: 'c1', orderId: 'oNext', newAmount: 45 * MILLION });
  const asClerk = b.customerCreditFile(clerk, { customerId: 'c1', orderId: 'oNext' });
  assert.equal(asManager.ok, true, asManager.error);
  assert.equal(asClerk.ok, true, asClerk.error);
  assert.equal(asManager.verdict.needsApproval, true, 'عبور از سقف برای مدیر');
  assert.equal(asClerk.verdict.needsApproval, true, 'همان تصمیم برای کارشناس — بدون این‌که رقمی ببیند');
  for (const key of ['newAmount', 'freshAmount', 'projected', 'overBy', 'reasons', 'text']) assert.equal(asClerk.verdict[key], undefined, `${key} در تصمیم سانسور شد`);
  assert.equal(JSON.stringify(asClerk).includes(String(45 * MILLION)), false, 'مبلغ سفارش به پاسخ بی‌رقم راه نمی‌یابد');
  assert.match(asClerk.verdict.shortText, /مجوز مستند مدیر لازم است/);
  /* oLive از قبل در تعهد شمرده شده؛ ویرایشِ دوبارهٔ آن نباید دو بار شمار شود. */
  assert.equal(b.customerCreditFile(clerk, { customerId: 'c1', orderId: 'oLive' }).verdict.needsApproval, false, 'مبلغِ همان سفارش از fresh کم می‌شود');
  assert.equal(b.customerCreditFile(admin, { customerId: 'c1', orderId: 'oLive', newAmount: 25 * MILLION }).verdict.needsApproval, false);
  /* کنترل منفی: سفارشِ بی‌رکورد مبلغی از سرور نمی‌گیرد و تصمیمِ «بی‌مبلغ» می‌ماند. */
  assert.equal(b.customerCreditFile(clerk, { customerId: 'c1', orderId: 'nope' }).verdict.needsApproval, false);
});

test('کنترل منفی: نوشتن سیاست اعتبار فقط برای مدیر چاپخانه و مدیر مالی است', t => {
  const { b, admin, clerk, store, finance } = fixture(t);
  assert.equal(b.saveCreditPolicy(clerk, { customerId: 'c1', ceiling: 1000 }).code, 'FORBIDDEN');
  assert.equal(b.saveCreditPolicy(store, { customerId: 'c1', ceiling: 1000 }).code, 'FORBIDDEN');
  assert.equal(b.saveCreditPolicy(admin, { customerId: 'c1', ceiling: -5 }).ok, false);
  assert.equal(b.saveCreditPolicy(admin, { customerId: 'c1', ceiling: 1.5 }).ok, false);
  assert.equal(b.saveCreditPolicy(admin, { customerId: 'c1', ceiling: 1000, termDays: 99999 }).ok, false);
  assert.equal(b.saveCreditPolicy(admin, { customerId: 'nope', ceiling: 1000 }).code, 'NOT_FOUND');
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 4000, termDays: 15, warnPercent: 70 }).ok, true);
  const f = b.customerCreditFile(admin, { customerId: 'c1' }).file;
  assert.equal(f.ceiling, 4000);
  assert.equal(f.termDays, 15);
  assert.equal(f.warnPercent, 70);
  /* سقفِ بی‌ردیفِ جدول از رکورد مشتری خوانده می‌شود، تا سیاستِ قدیمی گم نشود. */
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 0, termDays: 0 }).ok, true);
  assert.equal(b.customerCreditFile(admin, { customerId: 'c1' }).file.policy.source, 'جدول پروندهٔ اعتباری');
  assert.equal(b.customerCreditFile(admin, { customerId: 'c1' }).file.status, 'سقف تعیین‌نشده');
});

test('مجوز استثنایی: فقط مدیر، با رمزِ دوباره‌تاییدشده و دلیلِ مستند — و سند حذف نمی‌شود', t => {
  const { b, admin, finance, clerk, invoice } = fixture(t, { orders: example().concat([
    order('oNew', 'در انتظار تایید', { items: [{ id: 'n1', qty: '45', unitPrice: '1000000', services: [] }] }),
  ]) });
  exampleInvoices.forEach(invoice);
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  const input = { customerId: 'c1', orderId: 'oNew', reason: 'مشتری چکِ هفتهٔ آینده را کتباً تضمین کرده است', pin: '246810' };
  assert.equal(b.approveCreditException(clerk, input).code, 'FORBIDDEN', 'کارشناس نمی‌تواند مجوز بسازد');
  assert.equal(b.approveCreditException(finance, input).code, 'FORBIDDEN', 'مدیر مالی هم خارج از این تصمیم است');
  assert.equal(b.approveCreditException(admin, { ...input, pin: '111111' }).ok, false, 'رمز اشتباه مجوز نمی‌سازد');
  assert.equal(b.approveCreditException(admin, { ...input, pin: '' }).ok, false, 'بی‌رمز هم نه');
  assert.equal(b.approveCreditException(admin, { ...input, reason: 'قبول است' }).ok, false, 'دلیلِ کوتاه سند نیست');
  assert.equal(b.approveCreditException(admin, { ...input, orderId: '' }).ok, false, 'بی‌سفارش، سند بی‌صاحب است');
  assert.equal(b._db.get('SELECT COUNT(*) n FROM credit_approvals').n, 0, 'هیچ‌کدام از رداهای بالا ردیف نساخت');
  const first = b.approveCreditException(admin, input);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.approval.openTotal, 75 * MILLION, 'مبلغِ سند از پروندهٔ سرور گرفته می‌شود، نه از فراخوان');
  assert.equal(first.approval.definiteDebt, 50 * MILLION);
  assert.equal(first.approval.commitment, 25 * MILLION);
  assert.equal(first.approval.overBy, 10 * MILLION, 'عبور از سقفِ همین سفارش ثبت می‌شود');
  assert.equal(first.approval.decidedRole, M);
  const second = b.approveCreditException(admin, { ...input, reason: 'تضمین کتبی جدید با مهلت کوتاه‌تر از سوی مشتری' });
  assert.equal(second.ok, true, second.error);
  const rows = () => b._db.all('SELECT id, state, superseded_by FROM credit_approvals WHERE order_id = ? ORDER BY rowid', 'oNew');
  assert.equal(rows().length, 2, 'سند حذف نمی‌شود؛ نسخهٔ دوم جای اول را جایگزین‌شده می‌کند');
  assert.deepEqual(rows().map(r => r.state), ['superseded', 'active']);
  assert.equal(rows()[0].superseded_by, rows()[1].id);
  /* تصمیمِ سوم در همان میلی‌ثانیه (ساعتِ آزمون ایستاده) خطا نمی‌دهد: یکتا بودنِ «فعال»
     قاعدهٔ واقعی است، نه یکتا بودنِ (سفارش، زمان، تصمیم‌گیرنده). */
  const third = b.approveCreditException(admin, { ...input, reason: 'مدیر پس از تماس با مشتری تصمیم را دوباره ثبت کرد' });
  assert.equal(third.ok, true, third.error);
  assert.equal(third.approval.supersededBy, null);
  assert.deepEqual(rows().map(r => r.state), ['superseded', 'superseded', 'active'], 'همیشه فقط یک مجوز فعال است');
  assert.equal(b._db.get("SELECT COUNT(*) n FROM credit_approvals WHERE order_id = ? AND state = 'active'", 'oNew').n, 1);
  assert.ok(b.auditRows(50).filter(e => e.action === 'credit_approval').length >= 2);
  assert.ok(b.auditRows(50).some(e => e.action === 'pin_failed'));
});

test('سندِ مجوز، دروازهٔ اجازهٔ تولید را باز می‌کند؛ نبودِ سند آن را بسته می‌گذارد', t => {
  const { b, admin, clerk, finance, invoice } = fixture(t, { orders: example().concat([
    order('oNew', 'در انتظار تایید', { items: [{ id: 'n1', qty: '45', unitPrice: '1000000', services: [] }] }),
  ]) });
  exampleInvoices.forEach(invoice);
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  assert.equal(b.orderAction(clerk, 'oNew', 'confirm_customer', { evidence: 'تأیید کتبی مشتری' }).ok, true);
  const material = { materialReview: { checked: true, shortages: [] } };
  assert.equal(b.orderAction(admin, 'oNew', 'release_production', material).ok, false, 'بی‌اجازهٔ صریح مدیر');
  assert.equal(b.orderAction(admin, 'oNew', 'release_production', { ...material, debtApproved: true }).ok, false, 'اجازهٔ صریح بی‌سند هم کافی نیست');
  const approved = b.approveCreditException(admin, { customerId: 'c1', orderId: 'oNew', reason: 'عبور ۱۰M از سقف با تضمین کتبی تسویه', pin: '246810' });
  assert.equal(approved.ok, true, approved.error);
  /* این‌جا دیگر دلیلی فرستاده نمی‌شود: سرور همان ردیفِ فعالِ پرونده را پیدا می‌کند. */
  const released = b.orderAction(admin, 'oNew', 'release_production', { ...material, debtApproved: true });
  assert.equal(released.ok, true, released.error);
  const stamp = released.order.workflow.productionAuthorization;
  assert.equal(stamp.debtApproved, true);
  assert.equal(stamp.creditApproval.id, approved.approval.id, 'اجازهٔ تولید به همان سند وصل است');
  assert.equal(stamp.creditApproval.amount, 75 * MILLION);
  assert.equal(stamp.creditApproval.reason, 'عبور ۱۰M از سقف با تضمین کتبی تسویه');
  assert.equal(b.get(admin, ORDERS).value.find(o => o.id === 'oNew').managerOverrideDebt, true);
});

test('سندِ فعالِ پرونده مرجع است: دلیلِ همان‌لحظه جای آن را نمی‌گیرد و دوباره سند نمی‌سازد', t => {
  const { b, admin, clerk, finance, invoice } = fixture(t, { orders: example().concat([
    order('oNew', 'در انتظار تایید', { items: [{ id: 'n1', qty: '45', unitPrice: '1000000', services: [] }] }),
  ]) });
  exampleInvoices.forEach(invoice);
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  assert.equal(b.orderAction(clerk, 'oNew', 'confirm_customer', { evidence: 'تأیید تلفنی مشتری' }).ok, true);
  const material = { materialReview: { checked: true, shortages: [] }, debtApproved: true };
  const stored = 'تضمین کتبی قبلی برای تسویهٔ هفتهٔ بعد';
  assert.equal(b.approveCreditException(admin, { customerId: 'c1', orderId: 'oNew', reason: stored, pin: '246810' }).ok, true);
  const released = b.orderAction(admin, 'oNew', 'release_production', { ...material, creditReason: 'مشتری بخشی را نقد داد و مدیر اجازه داد' });
  assert.equal(released.ok, true, released.error);
  const rows = b._db.all('SELECT id, state, reason FROM credit_approvals WHERE order_id = ? ORDER BY id', 'oNew');
  assert.equal(rows.length, 1, 'سندِ فعال از قبل بود؛ اجازهٔ تولید سند تازه نساخت');
  assert.equal(rows[0].state, 'active');
  assert.equal(released.order.workflow.productionAuthorization.creditApproval.id, rows[0].id);
  assert.equal(released.order.workflow.productionAuthorization.creditApproval.reason, stored, 'متنِ همان سندِ معتبر مهر می‌خورد');
});

test('مشتریِ بی‌بدهی بدون سندِ مدیر هم اجازهٔ تولید می‌گیرد — دروازه بی‌دلیل بازتر نشده', t => {
  const { b, admin, clerk, finance } = fixture(t, {
    orders: [order('oClean', 'در انتظار تایید', { customerId: 'c2' })],
    customer: { id: 'c2', name: 'مشتری تازه', phone: '09130000000' },
  });
  /* سیاستی روی این مشتری نشسته و پرونده هم خالی است: دروازه باز می‌ماند. */
  const file = b.customerCreditFile(admin, { customerId: 'c2' });
  assert.equal(file.ok, true, file.error);
  assert.equal(file.file.policy.source, 'تنظیم نشده');
  assert.equal(file.file.openTotal, 0);
  assert.equal(file.verdict.needsApproval, false);
  assert.equal(b.orderAction(clerk, 'oClean', 'confirm_customer', { evidence: 'تأیید تلفنی' }).ok, true);
  const result = b.orderAction(admin, 'oClean', 'release_production', { materialReview: { checked: true, shortages: [] } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.order.workflow.productionAuthorization.debtApproved, false);
  assert.equal(result.order.workflow.productionAuthorization.creditApproval, undefined);
});

test('جدول همهٔ پرونده‌ها یک عدد برای همهٔ ایستگاه‌ها می‌سازد و سانسور را نگه می‌دارد', t => {
  const { b, admin, clerk, finance, invoice } = fixture(t, { orders: example().concat([
    order('oOther', 'تایید شده', { customerId: 'c2', pricing: priced(7 * MILLION) }),
  ]), customer: { id: 'c1', name: 'نمونهٔ کارفرما', phone: '09120000000' } });
  exampleInvoices.forEach(invoice);
  b._db.run('INSERT OR REPLACE INTO records(collection,id,ord,data,updated_at,rev) VALUES(?,?,?,?,?,?)',
    CUSTOMERS, 'c2', 1, JSON.stringify({ id: 'c2', name: 'مشتری دوم', phone: '09130000000' }), clock0, 1);
  assert.equal(b.saveCreditPolicy(finance, { customerId: 'c1', ceiling: 100 * MILLION, termDays: 30 }).ok, true);
  const money = b.creditFiles(admin);
  assert.equal(money.ok, true);
  assert.equal(money.money, true);
  assert.deepEqual(money.rows.map(r => r.customerId), ['c1', 'c2']);
  assert.equal(money.rows[0].openTotal, 75 * MILLION, 'بزرگ‌ترین مانده اول می‌آید');
  assert.deepEqual(money.kpis, { customers: 2, withCeiling: 1, blocked: 0, warning: 0, openDebt: 2, overdue: 0, noPolicy: 1,
    totalDefinite: 50 * MILLION, totalOverdue: 0, totalCommitment: 32 * MILLION, totalAdvance: 10 * MILLION, totalNet: 72 * MILLION });
  const bare = b.creditFiles(clerk);
  assert.equal(bare.money, false);
  assert.equal(Object.keys(bare.kpis).some(k => k.startsWith('total')), false, 'جمعِ ریالیِ مطالبات به کارشناس سفارشات نشان داده نمی‌شود');
  assert.equal(JSON.stringify(bare.rows).includes(String(75 * MILLION)), false);
  assert.equal(bare.rows[0].lines, undefined);
  const byId = id => bare.rows.find(r => r.customerId === id);
  assert.equal(byId('c1').status, money.rows[0].status, 'وضعیت برای کارشناس می‌ماند');
  assert.equal(byId('c1').customerName, money.rows[0].customerName);
  assert.ok(bare.rows.every(r => r.available === undefined && r.openTotal === undefined && r.usedPercent === undefined));
  assert.equal(bare.kpis.openDebt, 2, 'شمارش‌ها از پروندهٔ کامل می‌آیند نه از نسخهٔ سانسورشده');
  assert.equal(b.creditFiles(b.login('store', 'strong-test-pass').token).code, 'FORBIDDEN', 'انباردار پروندهٔ اعتباری نمی‌خواند');
});
