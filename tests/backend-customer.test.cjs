'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend, legacyHash, REQUEST_STATUS } = require('../electron/backend');
const KEY = 'printshop_customers_v2';
function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
const OK_REASON = 'مدارک ثبتی کامل و قابل اتکا است';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-customer-'));
  const b = createBackend({ dataDir: dir, openDb });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-customer-pass');
  const users = b.listUsers(manager).users;
  users.push({ id: 'clerk', name: 'clerk', username: 'clerk', role: 'کارشناس سفارشات', _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const clerk = b.login('clerk', 'strong-test-pass').token;
  assert.equal(b.set(manager, KEY, [{ id: 'c1', name: 'مشتری اول', mobile: '09120000000', debt: 800, secret: 'private' }, { id: 'c2', name: 'مشتری دوم' }]).ok, true);
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const action = (id, name, payload) => b.customerAction(manager, id, name, payload);
  /* چرخهٔ تأیید‌شدهٔ کارفرما: ۱ تعریف ۲ تأیید ۳ کد یکتا */
  const approve = (id = 'c1') => { assert.equal(action(id, 'approve', { reason: OK_REASON }).ok, true); assert.equal(action(id, 'issue_number').ok, true); };
  return { b, dir, manager, clerk, action, approve, account: (id = 'account1', customerId = 'c1') => ({ id, name: id, username: id, role: 'مشتری', customerId, _plain: 'customer-test-pass', active: true }) };
}
test('new customers await review; approval comes first and the unique code is issued only after it', t => {
  const { b, manager, clerk, action } = fixture(t);
  assert.equal(b.get(manager, KEY).value[0].eligibility.status, 'pending');
  assert.equal(action('c1', 'approve').ok, false, 'تأیید بدون شرح تصمیم مدیر ثبت نمی‌شود');
  assert.equal(b.customerAction(clerk, 'c1', 'approve', { reason: OK_REASON }).code, 'FORBIDDEN');
  assert.equal(b.customerAction('invalid', 'c1', 'approve', { reason: OK_REASON }).code, 'UNAUTHENTICATED');
  assert.equal(action('c1', 'issue_number').ok, false, 'کد یکتا پیش از تأیید صادر نمی‌شود');
  assert.equal(b.get(manager, KEY).value[0].customerCode, '', 'رد شدنِ درخواست کد، شماره را مصرف نمی‌کند');
  assert.equal(b._db.get('SELECT value FROM meta WHERE key = ?', 'customer_code_sequence'), undefined);
  const approved = action('c1', 'approve', { customerCode: 'INJECTED', eligibility: { status: 'rejected' }, reason: OK_REASON });
  assert.equal(approved.customer.customerCode, '');
  assert.equal(approved.customer.eligibility.status, 'approved');
  assert.equal(approved.customer.eligibility.reviewedBy.id, 'u_admin');
  const numbered = action('c1', 'issue_number');
  assert.equal(numbered.customer.customerCode, 'C-000001');
  assert.equal(numbered.customer.eligibility.status, 'approved');
  assert.equal(action('c1', 'issue_number').ok, false, 'کد دوم برای همان رکورد صادر نمی‌شود');
  assert.equal(action('c1', 'reject').ok, false, 'رد بدون دلیل ثبت نمی‌شود');
  const rejected = action('c1', 'reject', { reason: 'مدارک ناقص است' });
  assert.equal(rejected.customer.eligibility.status, 'rejected');
  assert.equal(rejected.customer.active, false, 'رد شدن یعنی غیرفعال شدن در بانک');
});
test('a rejected party consumes no number: the next serial still goes to the next person', t => {
  const { b, manager, action, approve } = fixture(t);
  approve('c1');
  assert.equal(action('c2', 'reject', { reason: 'مدارک نامعتبر' }).customer.active, false);
  assert.equal(action('c2', 'issue_number').ok, false, 'رکورد رد/غیرفعال کد نمی‌گیرد');
  assert.equal(b._db.get('SELECT value FROM meta WHERE key = ?', 'customer_code_sequence').value, '1');
  approve('c2');
  assert.equal(b.get(manager, KEY).value.find(c => c.id === 'c2').customerCode, 'C-000002');
});
test('manager can activate or deactivate any party in any review state', t => {
  const { b, manager, clerk, action, approve } = fixture(t);
  assert.equal(b.customerAction(clerk, 'c1', 'activate').code, 'FORBIDDEN');
  assert.equal(action('c1', 'deactivate').customer.active, false, 'رکورد در انتظار بررسی قابل غیرفعال کردن است');
  assert.equal(action('c1', 'activate').customer.active, true, 'و قابل فعال کردن');
  action('c1', 'deactivate');
  approve('c1');
  const coded = b.get(manager, KEY).value[0];
  assert.equal(coded.active, true, 'تأیید، رکورد را به بانک کاری برمی‌گرداند');
  assert.equal(coded.customerCode, 'C-000001');
  assert.equal(action('c1', 'deactivate').customer.active, false, 'غیرفعال کردن پس از صدور کد هم ممکن است');
  assert.equal(action('c1', 'reject', { reason: 'رد مجدد' }).customer.eligibility.status, 'rejected');
  assert.equal(action('c1', 'activate').customer.active, true, 'در هر وضعیتی فعال/غیرفعال کردن ممکن است');
});
test('generic writes cannot forge, remove or overwrite eligibility, numbers or active state, even for manager', t => {
  const { b, manager, clerk, approve } = fixture(t);
  const initial = b.get(manager, KEY).value;
  assert.equal(b.set(manager, KEY, [...initial, { id: 'forged', customerCode: 'C-000099', eligibility: { status: 'approved' } }]).ok, false);
  approve();
  const original = b.get(manager, KEY).value;
  for (const token of [manager, clerk]) for (const mutate of [c => { c.customerCode = 'C-000099'; }, c => { c.eligibility.status = 'pending'; }, c => { delete c.eligibility; }, c => { c.active = false; }]) {
    const forged = structuredClone(original); mutate(forged[0]); assert.equal(b.set(token, KEY, forged).code, 'FORBIDDEN');
  }
  assert.equal(b.set(manager, KEY, original.slice(1)).ok, false);
  assert.equal(b.del(manager, KEY).ok, false);
  const edited = structuredClone(original); edited[0].name = 'نام اصلاح‌شده';
  assert.equal(b.set(clerk, KEY, edited).ok, true);
  assert.equal(b.get(manager, KEY).value[0].eligibility.status, 'approved');
});
test('number allocation reads latest state across backend instances and does not reuse issued numbers', t => {
  const { b, dir, manager, action, approve } = fixture(t);
  approve('c1');
  const second = createBackend({ dataDir: dir, openDb });
  try {
    const otherManager = second.login('admin', 'strong-customer-pass').token;
    assert.equal(action('c1', 'issue_number').ok, false, 'کد صادرشده جایگزین نمی‌شود');
    assert.equal(b.get(manager, KEY).value[0].customerCode, 'C-000001');
    assert.equal(action('c2', 'approve', { reason: OK_REASON }).ok, true);
    assert.equal(second.customerAction(otherManager, 'c2', 'issue_number').customer.customerCode, 'C-000002');
    assert.equal(b._db.get('SELECT value FROM meta WHERE key = ?', 'customer_code_sequence').value, '2');
    assert.equal(b.get(manager, KEY).value[1].customerCode, 'C-000002');
  } finally { second.close(); }
});
test('customer account creation, activation and relinking require an approved numbered customer atomically', t => {
  const { b, manager, approve, action, account } = fixture(t);
  const originalUsers = b.listUsers(manager).users;
  assert.equal(b.saveUsers(manager, [...originalUsers, account()]).ok, false);
  assert.equal(b.login('account1', 'customer-test-pass').ok, false);
  approve();
  assert.equal(b.saveUsers(manager, [...originalUsers, account()]).ok, true);
  let users = b.listUsers(manager).users; users.find(u => u.id === 'account1').customerId = 'c2';
  assert.equal(b.saveUsers(manager, users).ok, false);
  assert.equal(b.listUsers(manager).users.find(u => u.id === 'account1').customerId, 'c1');
  users = b.listUsers(manager).users; users.find(u => u.id === 'account1').active = false;
  assert.equal(b.saveUsers(manager, users).ok, true);
  action('c1', 'reject', { reason: 'صلاحیت مجدد لازم است' });
  users = b.listUsers(manager).users; users.find(u => u.id === 'account1').active = true;
  assert.equal(b.saveUsers(manager, users).ok, false);
  assert.equal(b.listUsers(manager).users.find(u => u.id === 'account1').active, false);
});
test('a deactivated but approved customer cannot hold a linked account or submit a request', t => {
  const { b, manager, approve, action, account } = fixture(t);
  approve();
  assert.equal(b.saveUsers(manager, [...b.listUsers(manager).users, account()]).ok, true);
  const token = b.login('account1', 'customer-test-pass').token;
  assert.equal(b.submitRequest(token, 'سفارش چاپ کتاب با پرونده تأییدشده', '').ok, true);
  action('c1', 'deactivate');
  assert.equal(b.submitRequest(token, 'درخواست پس از غیرفعال شدن', '').code, 'CUSTOMER_NOT_APPROVED');
  assert.equal(b.customerProfile(token).customer.eligibility.status, 'approved', 'وضعیت صلاحیت با غیرفعال شدن بازنویسی نمی‌شود');
});
test('customer reads only their minimal profile and can submit only a request with the issued customer number', t => {
  const { b, manager, approve, action, account } = fixture(t);
  approve(); assert.equal(b.saveUsers(manager, [...b.listUsers(manager).users, account()]).ok, true);
  const token = b.login('account1', 'customer-test-pass').token;
  const profile = b.customerProfile(token);
  assert.deepEqual(Object.keys(profile.customer).sort(), ['id', 'name', 'customerCode', 'eligibility', 'phone', 'mobile'].sort());
  assert.equal(profile.customer.id, 'c1'); assert.equal(profile.customer.debt, undefined);
  assert.equal(b.customerProfile(manager).code, 'FORBIDDEN');
  assert.equal(b.get(token, KEY).code, 'FORBIDDEN');
  assert.equal(b.submitRequest(token, 'لطفاً سفارش چاپ کتاب را بررسی کنید', '02100000000').ok, true);
  const order = b.get(manager, 'printshop_orders_v5').value[0];
  assert.equal(order.customerCode, 'C-000001'); assert.equal(order.customerId, 'c1'); assert.equal(order.status, REQUEST_STATUS);
  assert.equal(order.workflow, undefined); assert.equal(order.approvedAt, undefined);
  action('c1', 'reject', { reason: 'مدارک مجدد بررسی شود' });
  assert.equal(b.submitRequest(token, 'درخواست بعدی چاپ کتاب', '').code, 'CUSTOMER_NOT_APPROVED');
  assert.equal(b.customerProfile(token).customer.eligibility.status, 'rejected');
});
test('customer finance shows only their own money lines: no other customer, no internal cost, no document snapshot', t => {
  const ORDERS = 'printshop_orders_v5';
  const { b, manager, clerk, approve, action, account } = fixture(t);
  approve();
  assert.equal(b.saveUsers(manager, [...b.listUsers(manager).users, account(), account('account2', 'c2')]).ok, false, 'حساب دوم به مشتری بدون کد وصل نمی‌شود');
  assert.equal(action('c2', 'approve', { reason: OK_REASON }).ok, true);
  assert.equal(action('c2', 'issue_number').ok, true);
  assert.equal(b.saveUsers(manager, [...b.listUsers(manager).users, account(), account('account2', 'c2')]).ok, true);
  const mine = id => ({ id, orderNumber: '100' + id.slice(-1), date: '2026-10-01', deliveryDate: '2026-10-20', title: 'کتاب آزمون', status: 'در انتظار تایید', quoteRev: 1,
    items: [{ id: 'i1', stage: 'ثبت سفارش', productName: 'کتاب', productType: 'کتاب', qty: '1000', qtyUnit: 'نسخه', unitPrice: 4500, designPrice: 200000,
      papers: [{ cost: 4242 }], materialsDeducted: false, services: [{ id: 's1', serviceType: 'صحافی', price: 90000 }] }],
    payments: [],
    discount: 20000, vatPercent: 10, shippingCost: 100000, otherCost: '', otherLabel: '', history: [], paymentsNote: '', createdAt: 1 });
  assert.equal(b.set(manager, ORDERS, [{ ...mine('o1'), customerId: 'c1', customerCode: 'C-000001', customerName: 'مشتری اول' }, { ...mine('o2'), customerId: 'c2', customerCode: 'C-000002', customerName: 'مشتری دوم' }]).ok, true);
  /* ردیف پرداخت از مسیر be:set نوشته نمی‌شود (بند ۲/۲)؛ این «قدیمی» مثل بانکِ صاحب کار
     بی‌واسطه در همان رکورد کاشته می‌شود تا دیدِ مالی مشتری با رقمِ واقعی بسنجیم. */
  for (const id of ['o1', 'o2']) b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?',
    JSON.stringify({ ...JSON.parse(b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, id).data),
      payments: [{ id: 'p1', amount: 100000, method: 'کارت', date: '2026-10-05' }] }), ORDERS, id);
  b._db.run('INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)',
    'd1', 'quote', 'o1', 1, 'Q-000001', 'issued', JSON.stringify({ id: 'd1', type: 'quote', number: 'Q-000001', status: 'issued', orderId: 'o1', orderNumber: '1001', quoteRevision: 1, createdAt: 5, createdBy: { name: 'مدیر چاپخانه' }, snapshot: { order: { internalCost: 4242 } } }), 5);

  const token = b.login('account1', 'customer-test-pass').token;
  const result = b.customerFinance(token);
  assert.equal(result.ok, true);
  assert.deepEqual(result.customer, { id: 'c1', name: 'مشتری اول', customerCode: 'C-000001' });
  assert.equal(result.orders.length, 1, 'سفارش مشتری دیگر به این حساب رسید');
  assert.equal(result.orders[0].id, 'o1');
  assert.deepEqual(Object.keys(result.orders[0]).sort(), ['date', 'deliveryDate', 'discount', 'id', 'items', 'orderNumber', 'otherCost', 'otherLabel', 'payments', 'quoteRev', 'shippingCost', 'status', 'title', 'vatPercent'].sort());
  assert.deepEqual(Object.keys(result.orders[0].items[0]).sort(), ['designPrice', 'id', 'productType', 'productName', 'qty', 'qtyUnit', 'services', 'unitPrice'].sort());
  assert.deepEqual(Object.keys(result.orders[0].items[0].services[0]), ['serviceType', 'price']);
  assert.equal(result.orders[0].items[0].unitPrice, 4500, 'بهای خودِ مشتری از دید خودش پنهان شد');
  assert.deepEqual(result.documents.map(d => [d.type, d.number, d.status]), [['quote', 'Q-000001', 'issued']]);
  assert.equal(result.documents[0].snapshot, undefined, 'snapshot سند به مشتری رسید');
  const wire = JSON.stringify(result);
  assert.equal(wire.includes('4242'), false, 'هزینهٔ داخلی کاغذ/سند به مشتری رسید');
  assert.equal(wire.includes('C-000002'), false, 'کد مشتری دیگر در پاسخ ماند');
  assert.equal(wire.includes('مدیر چاپخانه'), false, 'نام کارکنان در پاسخ مشتری ماند');
  assert.equal(b.customerFinance(manager).code, 'FORBIDDEN', 'مدیر از مسیر مشتری خواند');
  assert.equal(b.customerFinance(clerk).code, 'FORBIDDEN', 'کارشناس از مسیر مشتری خواند');
  assert.equal(b.customerFinance(b.login('account2', 'customer-test-pass').token).orders.map(o => o.id).join(), 'o2', 'حساب دوم سفارش خودش را ندید');
  action('c1', 'deactivate');
  assert.equal(b.customerFinance(token).code, 'CUSTOMER_NOT_APPROVED', 'مشتری غیرفعال مالی نمی‌بیند');
});
test('a priced quote reaches its customer as the numbers the shop confirmed: snapshot totals, never an internal cost', async t => {
  const ORDERS = 'printshop_orders_v5';
  const { b, manager, approve, account } = fixture(t);
  approve();
  assert.equal(b.saveUsers(manager, [...b.listUsers(manager).users, account()]).ok, true);
  assert.equal(b.set(manager, ORDERS, [{ id: 'o1', orderNumber: '1001', date: '2026-10-01', title: 'کتاب آزمون', status: 'در انتظار تایید', quoteRev: 1, customerId: 'c1', items: [], payments: [], history: [], createdAt: 1 }]).ok, true);
  const { calculateQuote } = require('../electron/pricing');
  const result = calculateQuote({
    materials: [{ description: 'کاغذ تحریر ۷۰ گرم', qty: 1000, rate: 500 }, { description: 'کاغذ خود مشتری', qty: 500, rate: 500, customerSupplied: true }],
    services: [{ description: 'صحافی گرم', qty: 1, rate: 900000 }],
    serviceMarkupPercent: 10, taxPercent: 9, discount: 100000,
    offers: [{ description: 'چاپ رایگان بنر', qty: 2, internalCost: 777000 }],
  });
  /* نوشتن عمومی، snapshot ساختگی را رد می‌کند (طراحی سرور)؛ برای همین رکورد مستقیم در بانک نشسته است. */
  const stored = JSON.parse(b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, 'o1').data);
  b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify({ ...stored, pricing: { schemaVersion: 1, revision: 1, input: {}, result } }), ORDERS, 'o1');
  const finance = b.customerFinance(b.login('account1', 'customer-test-pass').token);
  assert.equal(finance.ok, true);
  const order = finance.orders[0];
  assert.equal(order.pricing.result.total, result.total, 'مبلغ تأییدشدهٔ چاپخانه به دست مشتری نرسید');
  assert.equal(order.pricing.result.offers[0].internalCost, undefined, 'هزینهٔ داخلی خدمت رایگان به مشتری رسید');
  assert.equal(order.pricing.result.materials[0].consumedQty, undefined, 'مصرف انبار از snapshot به مشتری رسید');
  assert.equal(JSON.stringify(finance).includes('777000'), false, 'هزینهٔ داخلی در پاسخ مشتری ماند');
  const money = await import('../src/quote-money.mjs');
  assert.equal(money.moneyError(order), null, 'snapshotِ تحویلی را موتور مبالغ مشتری رد می‌کند');
  assert.equal(money.orderPayable(order), result.total);
  assert.equal(money.orderBalance(order), result.total, 'سفارش بی‌پرداخت، تمام مبلغ را بدهکار نشان می‌دهد');
});
test('legacy customer login and unchanged account save stay functional without automatic eligibility migration', t => {
  const { b, manager } = fixture(t);
  b._db.run('INSERT INTO users(id,username,name,role,customer_id,legacy_hash,active,must_change,created_at) VALUES(?,?,?,?,?,?,1,0,?)', 'legacy', 'legacy', 'قدیمی', 'مشتری', 'c2', legacyHash('old-strong-pass'), Date.now());
  const login = b.login('legacy', 'old-strong-pass');
  assert.equal(login.ok, true); assert.equal(login.user.mustChange, false);
  assert.equal(b.saveUsers(manager, b.listUsers(manager).users).ok, true);
  assert.equal(b.currentUser(login.token).ok, true);
  assert.equal(b.customerProfile(login.token).customer.customerCode, '');
  assert.equal(b.submitRequest(login.token, 'یک درخواست چاپ کتاب قدیمی', '').code, 'CUSTOMER_NOT_APPROVED');
  assert.equal(b.login('legacy', 'old-strong-pass').ok, true);
});
test('allocation rollback preserves sequence and customer when persistence fails', t => {
  const { b, manager, action } = fixture(t);
  assert.equal(action('c1', 'approve', { reason: OK_REASON }).ok, true);
  assert.equal(b.get(manager, KEY).value[0].customerCode, '', 'تأیید به‌تنهایی کد نمی‌سازد');
  b._db.exec("CREATE TRIGGER fail_customer_update BEFORE UPDATE ON records WHEN NEW.collection = 'printshop_customers_v2' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal(action('c1', 'issue_number').ok, false);
  assert.equal(b._db.get('SELECT value FROM meta WHERE key = ?', 'customer_code_sequence'), undefined);
  assert.equal(b.get(manager, KEY).value[0].customerCode, '');
  b._db.exec('DROP TRIGGER fail_customer_update');
  assert.equal(action('c1', 'issue_number').customer.customerCode, 'C-000001');
});
