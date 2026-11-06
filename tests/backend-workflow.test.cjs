'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const KEY = 'printshop_orders_v5';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-workflow-'));
  const openDb = file => {
    const db = new DatabaseSync(file);
    return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  };
  const b = createBackend({ dataDir: dir, openDb });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-workflow-pass');
  const users = b.listUsers(manager).users;
  for (const [id, role] of [['clerk', 'کارشناس سفارشات'], ['finance', 'مدیر مالی'], ['store', 'انباردار']]) users.push({ id, name: id, username: id, role, _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const tokens = Object.fromEntries(['clerk', 'finance', 'store'].map(id => [id, b.login(id, 'strong-test-pass').token]));
  const o = { id: 'o1', orderNumber: '1001', customerId: 'c1', status: 'در انتظار تایید', quoteRev: 1, items: [{ id: 'i1', qty: 10, unitPrice: 100, services: [] }], payments: [], history: [] };
  assert.equal(b.set(manager, KEY, [o]).ok, true);
  const confirm = () => b.orderAction(tokens.clerk, 'o1', 'confirm_customer', { evidence: 'تایید تلفنی مشتری' });
  const release = () => b.orderAction(manager, 'o1', 'release_production', { materialReview: { checked: true, shortages: [] } });
  return { b, manager, ...tokens, confirm, release };
}
test('production requires customer confirmation and manager authorization; raw writes cannot bypass', t => {
  const { b, manager, finance, clerk, confirm, release } = fixture(t);
  assert.equal(release().ok, false);
  assert.equal(confirm().ok, true);
  assert.equal(b.orderAction(finance, 'o1', 'release_production', { materialReview: { checked: true, shortages: [] } }).code, 'FORBIDDEN');
  const forged = b.get(manager, KEY).value;
  forged[0].status = 'تایید شده';
  assert.equal(b.set(manager, KEY, forged).ok, false);
  const result = release();
  assert.equal(result.ok, true); assert.equal(result.notificationStatus, 'queued');
  assert.equal(b.get(manager, KEY).value[0].status, 'تایید شده');
  assert.equal(b._db.get('SELECT count(*) n FROM order_events').n, 2);
  const redacted = b.get(clerk, KEY).value;
  redacted[0].items[0].stage = 'چاپ';
  assert.equal(b.set(clerk, KEY, redacted).ok, false);
});
test('every department can immediately stop, manager alone can resume and latest state is checked', t => {
  const { b, manager, store, finance, confirm, release } = fixture(t);
  confirm(); release();
  const result = b.orderAction(store, '1001', 'stop', { kind: 'pause', reason: 'درخواست تلفنی مشتری', customerRequest: true });
  assert.equal(result.ok, true); assert.equal(result.status, 'متوقف');
  /* بند ۱: انباردار حق خواندن سفارش‌ها را برای تابلو دارد، پس پاسخ عملیات می‌تواند
     رکورد را برگرداند — اما فقط با مبالغ پاک‌شده. */
  assert.equal(result.order.items[0].unitPrice, '', 'بهای قلم در پاسخ عملیات توقف به انباردار رسید');
  assert.equal(result.order.status, 'متوقف', 'تابلوی انباردار باید وضعیت تازه را در همان پاسخ ببیند');
  assert.equal(b.orderAction(store, 'o1', 'stop', { kind: 'pause', reason: 'توقف دوباره', customerRequest: true }).ok, false);
  assert.equal(b.orderAction(finance, 'o1', 'resume', { reason: 'ادامه کار مشتری' }).code, 'FORBIDDEN');
  const forged = b.get(manager, KEY).value; forged[0].items[0].qty = 99;
  assert.equal(b.set(manager, KEY, forged).ok, false);
  assert.equal(b.orderAction(manager, 'o1', 'resume', { reason: 'اجازه ادامه مشتری' }).ok, true);
  assert.equal(b.get(manager, KEY).value[0].status, 'تایید شده');
});
test('debt is computed from persisted financial records, not caller claims', t => {
  const { b, manager, clerk, confirm } = fixture(t);
  const orders = b.get(manager, KEY).value;
  orders.push({ id: 'debt', orderNumber: '1002', customerId: 'c1', status: 'در انتظار تایید', items: [{ id: 'd1', qty: 2, unitPrice: 100 }], payments: [], history: [] });
  assert.equal(b.set(manager, KEY, orders).ok, true);
  const debt = { ...orders[1], status: 'تایید شده' };
  b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify(debt), KEY, 'debt');
  confirm();
  const payload = { hasOpenDebt: false, materialReview: { checked: true, shortages: [] } };
  assert.equal(b.orderAction(manager, 'o1', 'release_production', payload).ok, false);
  /* اصلاحات ۱۷/بند ۱: کنترل منفی — اجازهٔ صریح مدیر بدون سند، دروازه را باز نمی‌کند. */
  assert.equal(b.orderAction(manager, 'o1', 'release_production', { ...payload, debtApproved: true }).ok, false);
  assert.match(b.orderAction(manager, 'o1', 'release_production', { ...payload, debtApproved: true }).error, /مجوز مستند/);
  /* کنترل منفی: کارشناس سفارشات نمی‌تواند با نوشتن دلیل، مجوز اعتبار بسازد. */
  assert.equal(b.orderAction(clerk, 'o1', 'release_production', { ...payload, debtApproved: true, creditReason: 'مشتری قول تسویه داده است' }).code, 'FORBIDDEN');
  const result = b.orderAction(manager, 'o1', 'release_production', { ...payload, debtApproved: true, creditReason: 'مشتری تسویهٔ هفتهٔ آینده را کتباً متعهد شده است', openTotal: 0 });
  assert.equal(result.ok, true, result.error);
  /* عددِ پرونده از بانک خوانده می‌شود، نه از ادعای فراخوان: ۲×۱۰۰ = ۲۰۰ ریال ماندهٔ باز. */
  const row = b._db.get('SELECT * FROM credit_approvals WHERE order_id = ?', 'o1');
  assert.equal(row.open_total, 200);
  assert.equal(row.state, 'active');
  assert.equal(row.reason, 'مشتری تسویهٔ هفتهٔ آینده را کتباً متعهد شده است');
  assert.equal(b.get(manager, KEY).value.find(o => o.id === 'o1').workflow.productionAuthorization.creditApproval.id, row.id);
  assert.ok(b.auditRows(50).some(e => e.action === 'credit_approval' && e.target === 'o1'));
});
test('cancellation settlement is finance authority and is redacted from non-financial reads', t => {
  const { b, manager, finance, store, clerk } = fixture(t);
  assert.equal(b.orderAction(store, 'o1', 'stop', { kind: 'cancel', reason: 'انصراف قطعی مشتری', customerRequest: true }).ok, true);
  const payload = { services: 123456, materials: 200, partners: 300, paid: 400, explanation: 'تسویه هزینه انجام شده' };
  assert.equal(b.orderAction(clerk, 'o1', 'settle_cancellation', payload).code, 'FORBIDDEN');
  assert.equal(b.orderAction(finance, 'o1', 'settle_cancellation', payload).ok, true);
  assert.equal(b.get(manager, KEY).value[0].workflow.cancellationSettlement.services, 123456);
  assert.equal(JSON.stringify(b.get(clerk, KEY).value).includes('123456'), false);
  assert.equal(b.orderAction(manager, 'o1', 'resume', { reason: 'شروع دوباره مشتری' }).ok, false);
});
test('notification visibility and read receipts are enforced per user without claiming delivery', t => {
  const { b, manager, store, confirm } = fixture(t);
  confirm();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(b.orderAction(manager, 'o1', 'release_production', { materialReview: { checked: true, shortages: [{ description: 'کاغذ تحریر', qty: 10, unit: 'بند', dueDate: tomorrow }] } }).ok, true);
  const management = b.getNotifications(manager).notifications;
  const warehouse = b.getNotifications(store).notifications;
  assert.ok(warehouse.length > 0); assert.ok(warehouse.every(n => n.audience === 'staff'));
  assert.ok(management.every(n => n.status === 'queued'));
  assert.equal(b.markRead(store, management.find(n => n.audience === 'finance').id).ok, false);
  assert.equal(b.markRead(store, warehouse[0].id).ok, true);
  assert.equal(b.getNotifications(store).notifications[0].read, true);
  assert.equal(b.getNotifications(manager).notifications.find(n => n.id === warehouse[0].id).read, false);
});
test('order, event and notification queue roll back together when persistence fails', t => {
  const { b, manager, confirm } = fixture(t);
  confirm();
  const original = b._db.run;
  b._db.run = (sql, ...args) => { if (sql.startsWith('INSERT INTO notification_outbox')) throw new Error('Simulated disk write failure'); return original(sql, ...args); };
  assert.equal(b.orderAction(manager, 'o1', 'release_production', { materialReview: { checked: true, shortages: [] } }).ok, false);
  b._db.run = original;
  assert.equal(b.get(manager, KEY).value[0].status, 'در انتظار تایید');
  assert.equal(b._db.get('SELECT count(*) n FROM order_events').n, 1);
  assert.equal(b._db.get('SELECT count(*) n FROM notification_outbox').n, 1);
});
function materialsSetup(b, manager, { ownerCustomerId = 'c1', bandCount = 105, sheetsPerBand = 500 } = {}) {
  const orders = b.get(manager, KEY).value;
  orders[0].items[0].stage = 'ثبت سفارش';
  orders[0].items[0].lithoMaterials = [{ id: 'm-z', inventoryItemId: 'zink', qty: 2, unitLabel: 'عدد', owner: 'چاپخانه' }];
  orders[0].items[0].papers = [{ id: 'm-p', inventoryItemId: 'paper', qty: 52500, qtyUnit: 'ورق', owner: 'مشتری', ownerCustomerId: 'c1' }];
  assert.equal(b.set(manager, KEY, orders).ok, true);
  assert.equal(b.set(manager, 'printshop_inventory_v3', [
    { id: 'zink', name: 'زینک', ownerType: 'چاپخانه', unitMode: 'simple', simpleUnit: 'عدد', quantity: 5, movements: [] },
    { id: 'paper', name: 'کاغذ مشتری', ownerType: 'مشتری', ownerCustomerId, purposeScope: 'all', unitMode: 'band_sheet', bandCount, sheetsPerBand, movements: [] },
  ]).ok, true);
}
test('stage consumption is atomic, stage-specific, converts sheets to bands, and never consumes twice', t => {
  const { b, manager, confirm, release } = fixture(t);
  materialsSetup(b, manager); confirm(); release();
  const stage = newStage => b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage, reason: 'عبور از مراحل بدون عملیات موردنیاز' });
  assert.equal(stage('لیتوگرافی و زینک').ok, true);
  let inv = b.get(manager, 'printshop_inventory_v3').value;
  assert.equal(inv.find(i => i.id === 'zink').quantity, 3);
  assert.equal(inv.find(i => i.id === 'paper').bandCount, 105);
  assert.equal(stage('چاپ افست').ok, true);
  inv = b.get(manager, 'printshop_inventory_v3').value;
  assert.equal(inv.find(i => i.id === 'paper').bandCount, 0);
  assert.equal(inv.find(i => i.id === 'paper').movements[0].qty, 105);
  assert.equal(stage('چاپ افست').ok, false);
  assert.equal(b.get(manager, 'printshop_inventory_v3').value.find(i => i.id === 'paper').movements.length, 1);
  const item = b.get(manager, KEY).value[0].items[0];
  assert.equal(item.materialConsumption['چاپ افست'].entries[0].qty, 105);
});
test('paper shortage blocks printing without blocking prior lithography or consuming partial quantities', t => {
  const { b, manager, confirm, release } = fixture(t);
  materialsSetup(b, manager, { bandCount: 100 }); confirm(); release();
  assert.equal(b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage: 'لیتوگرافی و زینک', reason: 'آماده بودن زینک' }).ok, true);
  const print = b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage: 'چاپ افست' });
  assert.equal(print.code, 'MATERIALS_NOT_READY');
  const inv = b.get(manager, 'printshop_inventory_v3').value;
  assert.equal(inv.find(i => i.id === 'zink').quantity, 3);
  assert.equal(inv.find(i => i.id === 'paper').bandCount, 100);
  assert.equal(b.get(manager, KEY).value[0].items[0].stage, 'لیتوگرافی و زینک');
});
test('stock owned by another customer and unknown sheet conversion cannot be consumed', t => {
  const { b, manager, confirm, release } = fixture(t);
  materialsSetup(b, manager, { ownerCustomerId: 'another-customer' }); confirm(); release();
  const change = () => b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage: 'چاپ افست', reason: 'آمادگی مراحل قبلی' });
  assert.equal(change().code, 'FORBIDDEN');
  let inv = b.get(manager, 'printshop_inventory_v3').value;
  assert.equal(inv.find(i => i.id === 'zink').quantity, 5);
  inv = inv.map(i => i.id === 'paper' ? { ...i, ownerCustomerId: 'c1', sheetsPerBand: '' } : i);
  b.set(manager, 'printshop_inventory_v3', inv);
  assert.equal(change().code, 'MATERIALS_NOT_READY');
  assert.equal(b.get(manager, 'printshop_inventory_v3').value.find(i => i.id === 'zink').quantity, 5);
});
test('stage role, stop state, approved revision, and inventory rollback are enforced', t => {
  const { b, manager, finance, store, confirm, release } = fixture(t);
  materialsSetup(b, manager); confirm(); release();
  const payload = { itemId: 'i1', newStage: 'لیتوگرافی و زینک', reason: 'عبور از طراحی و پروف' };
  assert.equal(b.orderAction(finance, 'o1', 'change_stage', payload).code, 'FORBIDDEN');
  const run = b._db.run;
  b._db.run = (sql, ...p) => { if (sql.startsWith('INSERT INTO order_events')) throw new Error('Simulated event persistence failure'); return run(sql, ...p); };
  assert.equal(b.orderAction(manager, 'o1', 'change_stage', payload).ok, false);
  b._db.run = run;
  assert.equal(b.get(manager, 'printshop_inventory_v3').value.find(i => i.id === 'zink').quantity, 5);
  assert.equal(b.get(manager, KEY).value[0].items[0].stage, 'ثبت سفارش');
  b.orderAction(store, 'o1', 'stop', { kind: 'pause', reason: 'مشتری دستور توقف داد', customerRequest: true });
  assert.equal(b.orderAction(manager, 'o1', 'change_stage', payload).ok, false);
});
test('quote changes invalidate confirmation by requiring a new quote revision; payment rows are not writable here', t => {
  const { b, manager, confirm, release } = fixture(t);
  confirm();
  let orders = b.get(manager, KEY).value;
  orders[0].items[0].unitPrice = 200;
  assert.equal(b.set(manager, KEY, orders).ok, false);
  /* بند ۲/۲: ردیف پرداخت بازتابِ رسیدِ وجه است؛ از این مسیر عام نه افزوده می‌شود نه کم. */
  orders = b.get(manager, KEY).value;
  orders[0].payments.push({ id: 'pay1', amount: 10 });
  assert.equal(b.set(manager, KEY, orders).code, 'FORBIDDEN');
  assert.deepEqual(b.get(manager, KEY).value[0].payments, [], 'ردیف پرداخت از راهِ نوشتنِ سفارش ثبت شد');
  orders = b.get(manager, KEY).value;
  orders[0].items[0].unitPrice = 200; orders[0].quoteRev = 2;
  assert.equal(b.set(manager, KEY, orders).ok, true);
  assert.equal(release().ok, false);
  assert.equal(confirm().ok, true);
  assert.equal(release().ok, true);
});
test('supervisors can enter only their own next stage and rolls convert to kilograms', t => {
  const { b, manager, confirm, release } = fixture(t);
  const users = b.listUsers(manager).users;
  users.push({ id: 'print-supervisor', username: 'print-supervisor', name: 'سرپرست', role: 'سرپرست چاپ', _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const supervisor = b.login('print-supervisor', 'strong-test-pass').token;
  const orders = b.get(manager, KEY).value;
  orders[0].items[0].papers = [{ id: 'm-roll', inventoryItemId: 'roll', qty: 2, unitLabel: 'رول', owner: 'چاپخانه' }];
  assert.equal(b.set(manager, KEY, orders).ok, true);
  assert.equal(b.set(manager, 'printshop_inventory_v3', [{ id: 'roll', ownerType: 'چاپخانه', unitMode: 'roll_kg', weightKg: 100, kgPerRoll: 25, movements: [] }]).ok, true);
  confirm(); release();
  assert.equal(b.orderAction(supervisor, 'o1', 'change_stage', { itemId: 'i1', newStage: 'لیتوگرافی و زینک' }).code, 'FORBIDDEN');
  assert.equal(b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage: 'لیتوگرافی و زینک', reason: 'بدون نیاز طراحی' }).ok, true);
  assert.equal(b.orderAction(supervisor, 'o1', 'change_stage', { itemId: 'i1', newStage: 'چاپ افست' }).ok, true);
  assert.equal(b.get(manager, 'printshop_inventory_v3').value[0].weightKg, 50);
  assert.equal(b.orderAction(supervisor, 'o1', 'change_stage', { itemId: 'i1', newStage: 'صحافی و تکمیلی' }).code, 'FORBIDDEN');
});
test('section completion advances one stage, books the entered stage materials, and rejects a stale click', t => {
  const { b, manager, confirm, release } = fixture(t);
  materialsSetup(b, manager); confirm(); release();
  const complete = stage => b.orderAction(manager, 'o1', 'complete_stage', { itemId: 'i1', stage });
  assert.equal(complete('ثبت سفارش').ok, true);
  let item = b.get(manager, KEY).value[0].items[0];
  assert.equal(item.stage, 'طراحی و پروف');
  assert.equal(item.stageCompletions['ثبت سفارش'].by.role, 'مدیر چاپخانه');
  assert.equal(complete('ثبت سفارش').code, 'STAGE_CONFLICT');
  assert.equal(complete('طراحی و پروف').ok, true);
  let inv = b.get(manager, 'printshop_inventory_v3').value;
  assert.equal(inv.find(i => i.id === 'zink').quantity, 3);
  assert.equal(complete('لیتوگرافی و زینک').ok, true);
  inv = b.get(manager, 'printshop_inventory_v3').value;
  assert.equal(inv.find(i => i.id === 'paper').bandCount, 0);
  item = b.get(manager, KEY).value[0].items[0];
  assert.equal(item.stage, 'چاپ افست');
  assert.equal(item.materialConsumption['لیتوگرافی و زینک'].entries[0].qty, 2);
  const forged = b.get(manager, KEY).value;
  forged[0].items[0].stageCompletions['چاپ افست'] = { fake: true };
  assert.equal(b.set(manager, KEY, forged).ok, false, 'stage completion must not be writable through the generic order form');
  assert.equal(b.get(manager, KEY).value[0].items[0].stage, 'چاپ افست');
});
test('section completion roles are enforced by the server, not by the visible button', t => {
  const { b, manager, clerk, finance, confirm, release } = fixture(t);
  confirm(); release();
  assert.equal(b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage: 'چاپ افست', reason: 'عبور از مراحل بدون عملیات موردنیاز' }).ok, true);
  assert.equal(b.orderAction(clerk, 'o1', 'complete_stage', { itemId: 'i1', stage: 'چاپ افست' }).code, 'FORBIDDEN');
  assert.equal(b.orderAction(finance, 'o1', 'complete_stage', { itemId: 'i1', stage: 'چاپ افست' }).code, 'FORBIDDEN');
  assert.equal(b.orderAction(manager, 'o1', 'complete_stage', { itemId: 'i1', stage: 'چاپ افست' }).ok, true);
  assert.equal(b.get(manager, KEY).value[0].items[0].stage, 'صحافی و تکمیلی');
});
test('delivery through the board closes the order; no action or generic write touches it afterwards', t => {
  const { b, manager, clerk, confirm, release } = fixture(t);
  confirm(); release();
  const stages = ['ثبت سفارش', 'طراحی و پروف', 'لیتوگرافی و زینک', 'چاپ افست', 'صحافی و تکمیلی', 'کنترل کیفیت و تحویل به مشتری'];
  for (const stage of stages.slice(0, -1)) assert.equal(b.orderAction(manager, 'o1', 'complete_stage', { itemId: 'i1', stage }).ok, true, stage);
  assert.equal(b.get(manager, KEY).value[0].status, 'آماده تحویل');
  assert.equal(b.orderAction(clerk, 'o1', 'complete_stage', { itemId: 'i1', stage: 'کنترل کیفیت و تحویل به مشتری' }).ok, true);
  const delivered = b.get(manager, KEY).value[0];
  assert.equal(delivered.status, 'تحویل شده');
  assert.ok(delivered.deliveredAt);
  assert.equal(delivered.deliveredBy.role, 'کارشناس سفارشات');
  assert.equal(b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage: 'کنترل کیفیت و تحویل به مشتری', reason: 'دوباره' }).code, 'FORBIDDEN');
  assert.equal(b.orderAction(manager, 'o1', 'stop', { kind: 'pause', reason: 'درخواست مشتری', customerRequest: true }).code, 'FORBIDDEN');
  const forged = b.get(manager, KEY).value;
  forged[0].items[0].stage = 'چاپ افست';
  assert.equal(b.set(manager, KEY, forged).ok, false);
  forged[0].items[0].stage = 'کنترل کیفیت و تحویل به مشتری';
  forged[0].deliveredAt = '';
  assert.equal(b.set(manager, KEY, forged).ok, false);
  const trail = JSON.stringify(b.auditFor(manager, 200));
  assert.match(trail, /complete_stage/);
});
test('the server keeps a digital item out of the offset path and books its paper at چاپ دیجیتال', t => {
  const { b, manager, confirm, release } = fixture(t);
  materialsSetup(b, manager);
  const drafted = b.get(manager, KEY).value;
  drafted[0].items[0].spec = { printMethod: 'دیجیتال' };
  assert.equal(b.set(manager, KEY, drafted).ok, true);
  confirm(); release();
  const complete = stage => b.orderAction(manager, 'o1', 'complete_stage', { itemId: 'i1', stage });
  assert.equal(complete('ثبت سفارش').ok, true);
  assert.equal(b.get(manager, KEY).value[0].items[0].stage, 'طراحی و پروف');
  const wrongPath = b.orderAction(manager, 'o1', 'change_stage', { itemId: 'i1', newStage: 'لیتوگرافی و زینک', reason: 'کنترل منفی: قلم دیجیتال به لیتوگرافی' });
  assert.equal(wrongPath.ok, false);
  assert.match(wrongPath.error, /در مسیر دیجیتال/);
  assert.equal(complete('طراحی و پروف').ok, true);
  assert.equal(b.get(manager, KEY).value[0].items[0].stage, 'چاپ دیجیتال');
  assert.equal(b.get(manager, 'printshop_inventory_v3').value.find(i => i.id === 'zink').quantity, 5, 'زینک قلم دیجیتال مصرف نمی‌شود');
  assert.equal(complete('چاپ دیجیتال').ok, true);
  assert.equal(b.get(manager, KEY).value[0].items[0].stage, 'برش و تکمیلی');
  assert.equal(b.get(manager, 'printshop_inventory_v3').value.find(i => i.id === 'paper').bandCount, 0, 'کاغذ چاپ دیجیتال باید مصرف شده باشد');
});
test('an unconfirmed draft is deletable, while confirmed or stopped orders and consumed materials cannot be erased through generic set or collection delete', t => {
  const { b, manager, store, confirm } = fixture(t);
  const untouched = b.get(manager, KEY).value;
  assert.equal(untouched[0].orderNumber, '', 'a draft is suspended without a number');
  const read = b.get(manager, KEY);
  assert.equal(b.set(manager, KEY, [], read.revs).ok, true, 'an unconfirmed draft must be deletable');
  assert.deepEqual(b.get(manager, KEY).value, []);
  assert.equal(b.set(manager, KEY, untouched).ok, true, 'the deleted draft can be entered again as a new draft');
  confirm();
  assert.equal(b.set(manager, KEY, []).code, 'FORBIDDEN');
  assert.equal(b.del(manager, KEY).code, 'FORBIDDEN');
  assert.equal(b.get(manager, KEY).value.length, 1);
  assert.equal(b.orderAction(store, 'o1', 'stop', { kind: 'cancel', reason: 'انصراف مشتری', customerRequest: true }).ok, true);
  assert.equal(b.set(manager, KEY, []).code, 'FORBIDDEN');
  assert.equal(b.del(manager, KEY).code, 'FORBIDDEN');
  assert.equal(b.get(manager, KEY).value[0].status, 'لغو شده');
  assert.equal(b._db.get('SELECT count(*) n FROM order_events').n, 2);
});
test('the warehouse role reads orders for the board but writes, deletes and money stay refused and audited', t => {
  const { b, manager, store } = fixture(t);
  const before = b.get(manager, KEY).value;
  const read = b.get(store, KEY);
  assert.equal(read.ok, true, 'انباردار باید فهرست سفارش‌ها را برای تابلو بخواند');
  assert.equal(read.value[0].items[0].unitPrice, '', 'بهای قلم به انباردار رسید');
  assert.deepEqual(read.value[0].payments, [], 'پرداخت‌ها به انباردار رسید');
  const forged = [{ id: 'voice-attempt', orderNumber: '9999', status: 'در انتظار تایید', items: [], payments: [], history: [] }];
  assert.equal(b.set(store, KEY, forged).code, 'FORBIDDEN', 'orders must not be writable without rights');
  assert.equal(b.del(store, KEY).ok, false, 'orders must not be deletable without rights');
  assert.deepEqual(b.get(manager, KEY).value, before, 'every rejected mutation must leave the collection untouched');
  const trail = JSON.stringify(b.auditFor(manager, 120));
  assert.match(trail, /denied_write/, 'refused write is missing from the audit trail');
});
