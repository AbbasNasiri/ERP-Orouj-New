'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend, REQUEST_STATUS } = require('../electron/backend');
const M = 'مدیر چاپخانه', C = 'کارشناس سفارشات', F = 'مدیر مالی', S = 'انباردار';
const ORDERS = 'printshop_orders_v5';
function openDb(file) {
  const raw = new DatabaseSync(file);
  return {
    exec: sql => raw.exec(sql), run: (sql, ...p) => raw.prepare(sql).run(...p),
    get: (sql, ...p) => raw.prepare(sql).get(...p), all: (sql, ...p) => raw.prepare(sql).all(...p),
    tx(fn) { raw.exec('BEGIN'); try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
    close: () => raw.close(),
  };
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-security-'));
  let clock = Date.now();
  const b = createBackend({ dataDir: dir, openDb, now: () => clock });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const admin = b.login('admin', '1234').token;
  assert.equal(b.setOwnPassword(admin, 'admin-test-strong').ok, true);
  const users = b.listUsers(admin).users;
  for (const [id, role] of [['clerk', C], ['finance', F], ['store', S]]) users.push({ id, username: id, name: id, role, active: true, _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(admin, users).ok, true);
  const tokens = Object.fromEntries(['clerk', 'finance', 'store'].map(id => [id, b.login(id, 'strong-test-pass').token]));
  return { b, admin, ...tokens, advance: ms => { clock += ms; } };
}
function order(id = 'o1') {
  return { id, orderNumber: '1001', status: 'در انتظار تایید', customerId: 'c1', createdAt: 1,
    items: [{ id: 'i1', stage: 'ثبت سفارش', materialsDeducted: false, qty: '2000', unitPrice: '', designPrice: '', services: [{ id: 's1', serviceType: 'چاپ', price: '' }] }],
    payments: [], discount: '', history: [], managerOverrideDebt: false };
}
test('forced initial password change blocks reads, writes, PIN and user management but permits password change', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-password-'));
  const b = createBackend({ dataDir: dir, openDb });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const token = b.login('admin', '1234').token;
  assert.equal(b.get(token, ORDERS).ok, false);
  assert.equal(b.set(token, ORDERS, []).ok, false);
  assert.equal(b.listUsers(token).ok, false);
  assert.equal(b.verifyPin(token, '1234').ok, false);
  assert.equal(b.setOwnPassword(token, 'new-strong-pass').ok, true);
  assert.equal(b.get(token, ORDERS).ok, true);
});
test('disabled, deleted, role-changed and reset-password users lose existing sessions', t => {
  const { b, admin } = fixture(t);
  for (const mutation of ['disable', 'role', 'reset', 'delete']) {
    let users = b.listUsers(admin).users;
    users = users.map(u => u.id === 'clerk' ? { ...u, active: true, role: C, _plain: 'strong-test-pass' } : u);
    assert.equal(b.saveUsers(admin, users).ok, true);
    const token = b.login('clerk', 'strong-test-pass').token;
    const changed = users.filter(u => mutation !== 'delete' || u.id !== 'clerk').map(u => {
      const v = { ...u }; delete v._plain;
      if (u.id === 'clerk') {
        if (mutation === 'disable') v.active = false;
        if (mutation === 'role') v.role = F;
        if (mutation === 'reset') v._plain = 'reset-strong-pass';
      }
      return v;
    });
    assert.equal(b.saveUsers(admin, changed).ok, true);
    assert.equal(b.get(token, ORDERS).ok, false, mutation);
    if (mutation === 'delete') break;
  }
});
test('changing own password preserves current session and revokes other sessions', t => {
  const { b, admin } = fixture(t);
  const second = b.login('admin', 'admin-test-strong').token;
  assert.equal(b.setOwnPassword(admin, 'another-strong-pass').ok, true);
  assert.equal(b.currentUser(admin).ok, true);
  assert.equal(b.get(second, ORDERS).ok, false);
});
test('each session use rechecks the database even when user management is bypassed', t => {
  const { b, clerk, finance, store } = fixture(t);
  b._db.run('UPDATE users SET active = 0 WHERE id = ?', 'clerk');
  b._db.run('UPDATE users SET role = ? WHERE id = ?', M, 'finance');
  b._db.run('DELETE FROM users WHERE id = ?', 'store');
  for (const token of [clerk, finance, store]) assert.equal(b.currentUser(token).ok, false);
});
test('PIN has no default, is manager-only, and rate limit spans multiple manager sessions', t => {
  const { b, admin, clerk, finance, advance } = fixture(t);
  assert.equal(b.verifyPin(admin, '1234').valid, false);
  assert.equal(b.verifyPin(clerk, '1234').ok, false);
  assert.equal(b.verifyPin(finance, '1234').ok, false);
  assert.equal(b.set(admin, 'printshop_manager_pin', '8765').ok, true);
  for (let i = 0; i < 4; i++) assert.equal(b.verifyPin(admin, '0000').valid, false);
  const second = b.login('admin', 'admin-test-strong').token;
  assert.equal(b.verifyPin(second, '8765').code, 'RATE_LIMITED');
  advance(61000);
  assert.equal(b.verifyPin(second, '8765').valid, true);
});
test('known collection schemas reject malformed writes without corrupting prior data', t => {
  const { b, admin } = fixture(t);
  const saved = { ...order(), orderNumber: '' };
  assert.equal(b.set(admin, ORDERS, [order()]).ok, true);
  for (const invalid of [{ bad: true }, null, [{ id: 'o1', items: {} }], [{ id: 'o1' }, { id: 'o1' }]]) {
    assert.equal(b.set(admin, ORDERS, invalid).code, 'VALIDATION_FAILED');
    assert.deepEqual(b.get(admin, ORDERS).value, [saved]);
  }
  assert.equal(b.set(admin, 'printshop_settings_v1', []).ok, false);
  assert.equal(b.set(admin, 'printshop_qty_units', {}).ok, false);
});
test('clerk can create and archive but cannot change existing details, money, production, debt or delete', t => {
  const { b, admin, clerk } = fixture(t);
  assert.equal(b.set(clerk, ORDERS, [order()]).ok, true);
  const visible = b.get(clerk, ORDERS).value;
  const change = mutate => { const value = structuredClone(visible); mutate(value[0]); return b.set(clerk, ORDERS, value); };
  assert.equal(change(o => { o.status = 'تایید شده'; }).ok, false);
  assert.equal(change(o => { o.customerId = 'other'; }).ok, false);
  assert.equal(change(o => { o.managerOverrideDebt = true; }).ok, false);
  assert.equal(change(o => { o.items[0].qty = '9000'; }).ok, false);
  assert.equal(change(o => { o.items[0].unitPrice = 900; }).ok, false);
  assert.equal(b.set(clerk, ORDERS, []).ok, false);
  assert.equal(change(o => { o.status = 'بایگانی'; o.archive = { reason: 'انصراف مشتری' }; }).ok, true);
  assert.equal(b.get(admin, ORDERS).value[0].status, 'بایگانی');
});
test('clerk cannot create orders with injected financial or approved production fields', t => {
  const { b, clerk } = fixture(t);
  for (const mutate of [o => { o.items[0].unitPrice = 100; }, o => { o.status = 'تایید شده'; }, o => { o.items[0].stage = 'چاپ'; }, o => { o.managerOverrideDebt = true; }, o => { o.approvedAt = 'today'; }]) {
    const o = order(); mutate(o);
    assert.equal(b.set(clerk, ORDERS, [o]).ok, false);
  }
});
test('finance can price existing orders but cannot create, delete or approve production', t => {
  const { b, admin, finance } = fixture(t);
  assert.equal(b.set(admin, ORDERS, [order()]).ok, true);
  const value = b.get(finance, ORDERS).value;
  value[0].items[0].unitPrice = 350; value[0].items[0].services[0].price = 40;
  assert.equal(b.set(finance, ORDERS, value).ok, true);
  for (const mutate of [o => { o.status = 'تایید شده'; }, o => { o.items[0].stage = 'چاپ'; }, o => { o.managerOverrideDebt = true; }]) {
    const next = structuredClone(value); mutate(next[0]); assert.equal(b.set(finance, ORDERS, next).ok, false);
  }
  assert.equal(b.set(finance, ORDERS, [...value, order('o2')]).ok, false);
  assert.equal(b.set(finance, ORDERS, []).ok, false);
});
test('non-financial reads hide free-text financial history while preserving classified operations', t => {
  const { b, admin, clerk } = fixture(t);
  const o = order();
  o.history = [{ id: 'h1', text: 'پیش فاکتور مبلغ 123456 ریال' }, { id: 'h2', text: 'ارجاع به چاپ', visibility: 'operational' }, { id: 'h3', text: 'ویرایش مشخصات سفارش' }];
  o.items[0].unitPrice = 777;
  assert.equal(b.set(admin, ORDERS, [o]).ok, true);
  const result = b.get(clerk, ORDERS).value[0];
  assert.equal(result.items[0].unitPrice, '');
  assert.deepEqual(result.history.map(h => h.id), ['h2', 'h3']);
  assert.equal(JSON.stringify(result).includes('123456'), false);
});
test('warehouse reads orders for the board but sees no money and cannot write', t => {
  const { b, admin, store } = fixture(t);
  const o = order();
  o.items[0].unitPrice = 450000;
  o.discount = 20000;
  assert.equal(b.set(admin, ORDERS, [o]).ok, true);
  /* pricing و ردیف پرداختِ «قدیمی» هر دو از مسیر be:set پذیرفته نمی‌شوند؛
     همان چیزی است که موتور قیمت و مهاجرتِ بانکِ صاحب کار در رکورد می‌گذارند. */
  const stored = JSON.parse(b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, 'o1').data);
  b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify({
    ...stored,
    payments: [{ id: 'p1', amount: 100000, method: 'نقد', date: '2026-10-20' }],
    pricing: { schemaVersion: 1, revision: 1, result: { internalCost: 999, grandTotal: 12345 } },
  }), ORDERS, 'o1');
  const read = b.get(store, ORDERS);
  assert.equal(read.ok, true, 'انباردار باید فهرست سفارش‌ها را برای دیدن تابلو بخواند');
  const seen = read.value[0];
  assert.equal(seen.items[0].unitPrice, '', 'بهای قلم به انباردار رسید');
  assert.equal(seen.items[0].services[0].price, '', 'بهای خدمت به انباردار رسید');
  assert.equal(seen.discount, '', 'تخفیف به انباردار رسید');
  assert.deepEqual(seen.payments, [], 'پرداخت‌ها به انباردار رسید');
  assert.equal(seen.pricing, undefined, 'موتور قیمت و هزینهٔ داخلی به انباردار رسید');
  assert.equal(JSON.stringify(read.value).includes('999'), false, 'هزینهٔ داخلی در دادهٔ انباردار ماند');
  assert.equal(b.set(store, ORDERS, [o]).ok, false, 'انباردار نوشتن سفارش را ندارد');
});
test('warehouse cannot mark receipts paid, alter payment date, revert paid state or delete financial receipt', t => {
  const { b, admin, store, finance } = fixture(t);
  const key = 'printshop_receipts_v1';
  assert.equal(b.set(store, key, [{ id: 'r1', payStatus: 'paid' }]).ok, false);
  assert.equal(b.set(store, key, [{ id: 'r1', payStatus: 'unpaid' }]).ok, true);
  assert.equal(b.set(store, key, [{ id: 'r1', payStatus: 'unpaid', payDate: '2026-10-22' }]).ok, false);
  assert.equal(b.set(finance, key, [{ id: 'r1', payStatus: 'paid', payDate: '2026-10-22' }]).ok, true);
  assert.equal(b.set(store, key, [{ id: 'r1', payStatus: 'unpaid' }]).ok, false);
  assert.equal(b.set(store, key, []).ok, false);
  assert.equal(b.get(admin, key).value[0].payStatus, 'paid');
});
test('legacy debt flag reconciles to the neutral value while the manager decision stays exclusive to its action', t => {
  const { b, admin, clerk, finance } = fixture(t);
  const legacy = order(); delete legacy.managerOverrideDebt;
  assert.equal(b.set(admin, ORDERS, [legacy]).ok, true);
  const stored = b.get(admin, ORDERS).value[0];
  const drifted = [{ ...stored, managerOverrideDebt: false, title: 'ویرایش مشخصات' }];
  assert.equal(b.set(admin, ORDERS, drifted).ok, true, 'neutral legacy write must not be rejected');
  assert.equal(b.get(admin, ORDERS).value[0].managerOverrideDebt, false);
  for (const token of [admin, clerk, finance]) {
    const forged = structuredClone(b.get(token, ORDERS).value);
    forged[0].managerOverrideDebt = true;
    const result = b.set(token, ORDERS, forged);
    assert.equal(result.ok, false);
    assert.match(result.error, /گردش کار/);
  }
  const other = order('o2');
  const withDebtOrder = b.set(admin, ORDERS, [...b.get(admin, ORDERS).value, { ...other, items: [{ ...other.items[0], unitPrice: 5000 }] }]);
  assert.equal(withDebtOrder.ok, true, withDebtOrder.error);
  const release = (id, creditReason) => {
    assert.equal(b.orderAction(clerk, id, 'confirm_customer', { evidence: 'تأیید تلفنی مشتری' }).ok, true);
    return b.orderAction(admin, id, 'release_production', { materialReview: { checked: true, shortages: [] }, debtApproved: true, ...(creditReason ? { creditReason } : {}) });
  };
  assert.equal(release('o2').ok, true);
  assert.equal(b.orderAction(admin, 'o1', 'release_production', { materialReview: { checked: true, shortages: [] } }).ok, false);
  /* اصلاحات ۱۷/بند ۱: تعهدِ بی‌فاکتورِ o2 هم «بدهی باز» شمرده می‌شود و تیک تنها کافی نیست. */
  assert.equal(b.orderAction(admin, 'o1', 'release_production', { materialReview: { checked: true, shortages: [] }, debtApproved: true }).ok, false);
  const withDebt = release('o1', 'مشتری بازپرداخت را کتباً تضمین کرده و مدیر اجازه داد');
  assert.equal(withDebt.ok, true, withDebt.error);
  const approved = b.get(admin, ORDERS).value.find(o => o.id === 'o1');
  assert.equal(approved.managerOverrideDebt, true);
  assert.equal(approved.workflow.productionAuthorization.debtApproved, true);
  assert.equal(approved.workflow.productionAuthorization.creditApproval.id, b._db.get('SELECT id FROM credit_approvals WHERE order_id = ? AND state = ?', 'o1', 'active').id);
  const editable = structuredClone(b.get(admin, ORDERS).value);
  editable.find(o => o.id === 'o1').phone = '09120001122';
  assert.equal(b.set(admin, ORDERS, editable).ok, true, 'approved order must stay editable through the general save');
  assert.equal(b.get(admin, ORDERS).value.find(o => o.id === 'o1').managerOverrideDebt, true);
  for (const token of [admin, finance, clerk]) {
    const cleared = structuredClone(b.get(token, ORDERS).value);
    cleared.find(o => o.id === 'o1').managerOverrideDebt = false;
    const result = b.set(token, ORDERS, cleared);
    assert.equal(result.ok, false, token);
    assert.match(result.error, /گردش کار/);
  }
});
