'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { normalizeQuote } = require('../electron/quote');
const KEY = 'printshop_orders_v5';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-pricing-'));
  const openDb = file => {
    const db = new DatabaseSync(file);
    return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  };
  const b = createBackend({ dataDir: dir, openDb });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-pricing-pass');
  const users = b.listUsers(manager).users;
  for (const [id, role] of [['clerk', 'کارشناس سفارشات'], ['finance', 'مدیر مالی'], ['store', 'انباردار']]) users.push({ id, name: id, username: id, role, _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const tokens = Object.fromEntries(['clerk', 'finance', 'store'].map(id => [id, b.login(id, 'strong-test-pass').token]));
  const o = { id: 'o1', orderNumber: '1001', customerId: 'c1', status: 'در انتظار تایید', quoteRev: 1,
    items: [{ id: 'i1', stage: 'ثبت سفارش', qty: 10, unitPrice: 999999, services: [] }], payments: [], history: [] };
  assert.equal(b.set(manager, KEY, [o]).ok, true);
  /* بند ۲/۲: ردیف پرداخت از این پس بازتابِ رسیدِ وجه است و از مسیر be:set نوشته نمی‌شود.
     برای همین این «پرداخت قدیمی» مثل بانکِ واقعیِ صاحب کار، بی‌واسطه در همان رکورد کاشته می‌شود. */
  b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify({ ...o, payments: [{ id: 'p1', amount: 10 }] }), KEY, 'o1');
  return { b, manager, ...tokens,
    save: (input = quoteInput(), expectedRevision = 1) => b.orderAction(tokens.finance, 'o1', 'save_quote', { input, expectedRevision }),
    confirm: () => b.orderAction(tokens.clerk, 'o1', 'confirm_customer', { evidence: 'تایید تلفنی مشتری' }),
    release: (id = 'o1', debtApproved = false) => b.orderAction(manager, id, 'release_production', { materialReview: { checked: true, shortages: [] }, debtApproved }),
  };
}
function quoteInput() {
  return { currency: 'IRR', effectiveDate: '2026-10-22',
    materials: [{ id: 'm1', description: 'کاغذ با نرخ فروش روز', qty: 2, unit: 'بند', rate: 500, customerSupplied: false }],
    services: [{ id: 's1', description: 'خدمات چاپ', qty: 1, unit: 'نوبت', rate: 1000 }], offers: [], serviceMarkupPercent: 20, taxPercent: 10, discount: 200 };
}
test('preview is read-only, financial-only, and computes markup only on services', t => {
  const { b, manager, finance, clerk, store } = fixture(t);
  for (const token of [clerk, store]) assert.equal(b.previewQuote(token, 'o1', quoteInput()).code, 'FORBIDDEN');
  assert.equal(b.previewQuote('invalid', 'o1', quoteInput()).code, 'UNAUTHENTICATED');
  const preview = b.previewQuote(finance, 'o1', quoteInput());
  assert.equal(preview.ok, true); assert.equal(preview.result.materialsCost, 1000); assert.equal(preview.result.serviceMarkupAmount, 200);
  assert.equal(preview.result.discount, 200); assert.equal(preview.result.discountedSubtotal, 2000); assert.equal(preview.result.total, 2200);
  assert.equal(b.get(manager, KEY).value[0].pricing, undefined);
  assert.equal(b._db.get('SELECT count(*) n FROM order_events').n, 0);
});
test('save recomputes server-side, freezes whitelisted rates and preserves payments', t => {
  const { b, manager, save } = fixture(t);
  const input = quoteInput(); input.result = { total: 0 }; input.materials[0].cost = 0; input.services[0].privateJunk = 'do not persist';
  const response = save(input);
  assert.equal(response.ok, true); assert.equal(response.order.quoteRev, 2);
  const order = b.get(manager, KEY).value[0];
  assert.equal(order.pricing.schemaVersion, 1); assert.equal(order.pricing.revision, 2); assert.equal(order.pricing.result.total, 2200);
  assert.equal(order.pricing.input.result, undefined); assert.equal(order.pricing.input.materials[0].cost, undefined); assert.equal(order.pricing.input.services[0].privateJunk, undefined);
  assert.equal(order.pricing.input.materials[0].rate, 500); assert.deepEqual(order.payments, [{ id: 'p1', amount: 10 }]);
  assert.deepEqual(order.quoteHistory, []); assert.equal(response.notificationStatus, 'queued');
});
test('reprice invalidates customer confirmation, archives prior snapshot, and rejects stale duplicate saves', t => {
  const { b, manager, save, confirm, release } = fixture(t);
  confirm(); assert.equal(save().ok, true);
  assert.equal(b.get(manager, KEY).value[0].workflow.customerConfirmation, undefined); assert.equal(release().ok, false);
  confirm(); const next = quoteInput(); next.services[0].rate = 1500;
  assert.equal(save(next, 2).ok, true);
  let order = b.get(manager, KEY).value[0];
  assert.equal(order.quoteRev, 3); assert.equal(order.quoteHistory.length, 1); assert.equal(order.quoteHistory[0].result.total, 2200);
  assert.equal(order.workflow.customerConfirmation, undefined);
  const events = b._db.get('SELECT count(*) n FROM order_events').n;
  assert.equal(save(next, 2).code, 'REVISION_CONFLICT');
  assert.equal(b._db.get('SELECT count(*) n FROM order_events').n, events);
  order = b.get(manager, KEY).value[0]; assert.equal(order.quoteRev, 3); assert.equal(order.quoteHistory.length, 1);
});
test('snapshot and quote-relevant fields cannot be injected through generic writes; payment rows are a server mirror', t => {
  const { b, manager, finance, clerk, save } = fixture(t);
  const emptySnapshot = b.get(manager, KEY).value; emptySnapshot[0].pricing = null;
  assert.equal(b.set(manager, KEY, emptySnapshot).ok, false);
  assert.equal(save().ok, true);
  const original = b.get(manager, KEY).value;
  for (const mutate of [o => { o.pricing.result.total = 0; }, o => { o.quoteHistory.push({ injected: true }); }, o => { delete o.pricing; }, o => { o.items[0].qty = 100; o.quoteRev++; }, o => { o.discount = 100; }]) {
    const forged = structuredClone(original); mutate(forged[0]); assert.equal(b.set(manager, KEY, forged).ok, false);
  }
  /* ردیفِ تازهٔ پرداخت از هر دو مسیر ممنوع است: بازنویسیِ ردیفِ سفارشِ موجود و کاشتنِ رقم در سفارشِ نو. */
  const paid = structuredClone(original); paid[0].payments.push({ id: 'p2', amount: 20 });
  assert.equal(b.set(finance, KEY, paid).code, 'FORBIDDEN');
  assert.equal(b.set(manager, KEY, paid).code, 'FORBIDDEN');
  assert.deepEqual(b.get(manager, KEY).value[0].payments, [{ id: 'p1', amount: 10 }], 'هیچ رقمی نوشته نشد');
  const fresh = structuredClone(b.get(manager, KEY).value);
  fresh.push({ id: 'o9', orderNumber: '1099', customerId: 'c1', status: 'در انتظار تایید', quoteRev: 1, items: [], history: [], payments: [{ id: 'p9', amount: 500 }] });
  assert.equal(b.set(manager, KEY, fresh).code, 'FORBIDDEN');
  assert.equal(b.get(manager, KEY).value.length, 1, 'سفارشِ تازه با پرداخت کاشته‌شده ثبت نشد');
  const visible = b.get(clerk, KEY).value[0]; assert.equal('pricing' in visible, false); assert.equal('quoteHistory' in visible, false);
});
test('offset block charging recomputes cost and customer materials retain consumption quantities without sale cost', t => {
  const { b, finance } = fixture(t);
  const input = quoteInput(); input.discount = 0; input.taxPercent = 0;
  input.materials[0].customerSupplied = true; input.materials[0].qty = 105;
  input.services = [{ id: 's1', description: 'چاپ متن افست', qty: 999, unit: 'عملیات', rate: 0, offset: { plates: 200, run: 2000, ratePerBlock: 20000000, blockSize: 5000 } }];
  const result = b.previewQuote(finance, 'o1', input).result;
  assert.equal(result.servicesCost, 4000000000); assert.equal(result.materialsCost, 0); assert.equal(result.materials[0].consumedQty, 105);
  assert.equal(result.serviceMarkupAmount, 800000000); assert.equal(result.total, 4800000000);
});
test('pricing becomes immutable after production and debt uses saved quote total rather than legacy item prices', t => {
  const { b, manager, finance, save, confirm, release } = fixture(t);
  const paidQuote = quoteInput(); paidQuote.services[0].rate = 0; paidQuote.materials[0].rate = 0; paidQuote.discount = 0; paidQuote.taxPercent = 0;
  assert.equal(save(paidQuote).ok, true); confirm(); assert.equal(release().ok, true);
  assert.equal(b.previewQuote(finance, 'o1', quoteInput()).code, 'FORBIDDEN');
  assert.equal(save(quoteInput(), 2).code, 'FORBIDDEN');
  const orders = b.get(manager, KEY).value;
  orders.push({ id: 'o2', orderNumber: '1002', customerId: 'c1', status: 'در انتظار تایید', quoteRev: 1, items: [], history: [], payments: [] });
  assert.equal(b.set(manager, KEY, orders).ok, true);
  assert.equal(b.orderAction(finance, 'o2', 'confirm_customer', { evidence: 'تایید مشتری دوم' }).ok, true);
  assert.equal(release('o2').ok, true, 'the old order has a zero quote total, despite high legacy item prices');
});
test('normalizer rejects duplicate IDs, invalid dates, unreasonable inputs and unsafe amounts', () => {
  for (const mutate of [i => { i.services[0].id = 'm1'; }, i => { i.effectiveDate = '2026-02-30'; }, i => { i.currency = 'USD'; }, i => { i.materials[0].qty = Infinity; }, i => { i.taxPercent = 101; }, i => { i.services[0].description = ''; }, i => { i.materials = Array.from({ length: 501 }, () => ({})); }]) {
    const input = quoteInput(); mutate(input); assert.throws(() => normalizeQuote(input));
  }
});
test('save quote rolls back snapshot and confirmation when event persistence fails', t => {
  const { b, manager, confirm, save } = fixture(t);
  confirm(); const before = b.get(manager, KEY).value[0];
  const run = b._db.run;
  b._db.run = (sql, ...p) => { if (sql.startsWith('INSERT INTO order_events')) throw new Error('Simulated event persistence failure'); return run(sql, ...p); };
  assert.equal(save().ok, false); b._db.run = run;
  assert.deepEqual(b.get(manager, KEY).value[0], before);
});
test('actual persisted snapshots pass frontend money validation and drive invoice totals without leaking offer internal cost', async t => {
  const { b, manager, save } = fixture(t);
  const input = quoteInput(); input.offers = [{ id: 'free1', description: 'ارسال رایگان', internalCost: 987654321 }];
  assert.equal(save(input).ok, true);
  const order = b.get(manager, KEY).value[0];
  const { pathToFileURL } = require('node:url');
  const helpers = await import(pathToFileURL(path.resolve(__dirname, '../src/quote-money.mjs')).href);
  assert.equal(helpers.moneyError(order), null);
  assert.equal(helpers.orderPayable(order), 2200); assert.equal(helpers.orderBalance(order), 2190);
  for (const detailed of [true, false]) {
    const rows = helpers.invoiceRows(order, detailed);
    assert.equal(rows.reduce((sum, row) => sum + row.total, 0), order.pricing.result.subtotal);
    assert.equal(JSON.stringify(rows).includes('987654321'), false);
  }
  assert.equal(b.set(manager, KEY, []).code, 'FORBIDDEN');
  assert.equal(b.del(manager, KEY).code, 'FORBIDDEN');
});
