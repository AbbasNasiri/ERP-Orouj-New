'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const ORDERS = 'printshop_orders_v5';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-order-reset-'));
  let failBackup = false, clock = Date.now();
  function openDb(file) {
    const db = new DatabaseSync(file);
    return { exec(sql) { if (failBackup && /^VACUUM INTO/.test(sql)) throw new Error('backup disk unavailable'); return db.exec(sql); }, run: (sql, ...p) => db.prepare(sql).run(...p), get: (sql, ...p) => db.prepare(sql).get(...p), all: (sql, ...p) => db.prepare(sql).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  }
  const peers = [];
  const b = createBackend({ dataDir: dir, openDb, now: () => clock });
  let manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'reset-manager-password');
  const users = b.listUsers(manager).users;
  for (const [id, role] of [['finance', 'مدیر مالی'], ['clerk', 'کارشناس سفارشات'], ['store', 'انباردار'], ['supervisor', 'سرپرست چاپ']]) users.push({ id, username: id, name: id, role, _plain: 'reset-other-password' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const tokens = Object.fromEntries(['finance', 'clerk', 'store', 'supervisor'].map(id => [id, b.login(id, 'reset-other-password').token]));
  t.after(() => { for (const peer of peers) peer.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const login = () => b.login('admin', 'reset-manager-password').token;
  const create = (token = manager, id = 'old-order') => {
    const result = b.set(token, ORDERS, [...(b.get(token, ORDERS).value || []), { id, customerId: 'c1', customerName: 'مشتری نمونه', status: 'در انتظار تایید', quoteRev: 1, items: [], history: [], payments: [] }]);
    assert.equal(result.ok, true, result.error); return result.value.at(-1);
  };
  const payload = (token = manager) => { const p = b.previewOrderReset(token); assert.equal(p.ok, true, p.error); return { previewToken: p.previewToken, expectedCount: p.expectedCount, confirmation: p.confirmationPhrase, reason: 'پاکسازی داده‌های آزمایشی' }; };
  return { b, dir, manager, ...tokens, create, payload, login, peer: () => { const peer = createBackend({ dataDir: dir, openDb, now: () => clock }); peers.push(peer); return peer; }, failBackup: () => { failBackup = true; }, advance: amount => { clock += amount; } };
}

test('reset preview and execution require manager, exact confirmation, current preview and reason', t => {
  const f = fixture(t); const { b, manager } = f; f.create();
  for (const token of [null, f.finance, f.clerk, f.store, f.supervisor]) {
    assert.equal(b.previewOrderReset(token).ok, false);
    assert.equal(b.resetOrders(token, {}).ok, false);
  }
  const p = f.payload();
  for (const bad of [{ ...p, confirmation: 'yes' }, { ...p, expectedCount: '1' }, { ...p, reason: '' }, null]) assert.equal(b.resetOrders(manager, bad).code, 'VALIDATION_FAILED');
  assert.equal(b.resetOrders(manager, { ...p, expectedCount: 0 }).code, 'RESET_PREVIEW_STALE');
  f.advance(300001);
  assert.equal(b.resetOrders(manager, p).code, 'RESET_PREVIEW_EXPIRED');
  assert.equal(b.get(manager, ORDERS).value.length, 1);
  assert.equal(fs.existsSync(path.join(f.dir, 'backups')), false);
});

test('backup failure and stale previews leave every order and document intact', t => {
  const f = fixture(t); const { b, manager } = f; f.create();
  const p = f.payload(); f.create(manager, 'newer-order');
  assert.equal(b.resetOrders(manager, p).code, 'RESET_PREVIEW_STALE');
  const before = b.get(manager, ORDERS).value;
  const fresh = f.payload(); f.failBackup();
  assert.equal(b.resetOrders(manager, fresh).code, 'RESET_BACKUP_FAILED');
  assert.deepEqual(b.get(manager, ORDERS).value, before);
  assert.equal(b._db.get('SELECT count(*) n FROM order_reset_tombstones').n, 0);
  assert.equal(b.currentUser(manager).ok, true);
});

test('successful reset preserves unrelated raw rows, stock quantities, reservations and a restorable full backup', t => {
  const f = fixture(t); const { b, manager } = f; const order = f.create();
  assert.equal(order.orderNumber, '', 'a draft is suspended without a number');
  assert.equal(b.orderAction(manager, order.id, 'confirm_customer', { evidence: 'تأیید مشتری' }).ok, true);
  const numbered = b.get(manager, ORDERS).value[0];
  assert.match(String(numbered.orderNumber), /^\d+$/, 'confirmation must issue the order number');
  const preserved = ['printshop_customers_v2', 'printshop_inventory_v3', 'printshop_suppliers_v2', 'printshop_receipts_v1', 'printshop_marketer_pay_v1', 'printshop_letters_v1'];
  preserved.forEach((key, index) => {
    b._db.run('INSERT INTO kinds(key,kind) VALUES(?,?)', key, 'array');
    b._db.run('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)', key, 'keep-' + index, 2, JSON.stringify({ id: 'keep-' + index, qty: 7, customerId: 'c1', orderId: order.id, movements: [{ id: 'consumed', qty: -3, orderId: order.id }] }), 123);
  });
  b._db.run('INSERT INTO kv(key,value,updated_at) VALUES(?,?,?)', 'printshop_settings_v1', '{"company":{"name":"حفظ شود"}}', 456);
  const doc = { id: 'old-invoice', orderId: order.id, type: 'invoice', status: 'issued', snapshot: { order, total: 100 } };
  b._db.run('INSERT INTO financial_documents VALUES(?,?,?,?,?,?,?,?)', doc.id, 'invoice', order.id, 1, '3001', 'issued', JSON.stringify(doc), 1);
  b._db.run('INSERT INTO order_events VALUES(?,?,?,?)', 'event', order.id, 1, '{"action":"consumed"}');
  b._db.run('INSERT INTO notification_outbox VALUES(?,?,?)', 'order-note', 1, JSON.stringify({ orderId: order.id }));
  b._db.run('INSERT INTO notification_outbox VALUES(?,?,?)', 'keep-note', 2, '{"type":"general"}');
  for (const id of ['order-note', 'keep-note']) b._db.run('INSERT INTO notification_reads VALUES(?,?,?)', id, 'u_admin', 3);
  const rowsBefore = b._db.all('SELECT * FROM records WHERE collection != ? ORDER BY collection,id', ORDERS);
  const kvBefore = b._db.all('SELECT * FROM kv WHERE key != ? ORDER BY key', ORDERS);
  const usersBefore = b._db.all('SELECT * FROM users ORDER BY id');
  const reservations = b._db.all('SELECT * FROM numbering_reservations ORDER BY type,number');
  const numbers = b.numberingSettings(manager).settings;
  const staleOrders = b.get(f.clerk, ORDERS).value;
  const result = b.resetOrders(manager, f.payload());
  assert.equal(result.ok, true, result.error); assert.equal(result.requiresLogin, true);
  assert.equal(result.counts.orders, 1); assert.equal(result.counts.documents, 1);
  assert.deepEqual(b._db.all('SELECT * FROM records WHERE collection != ? ORDER BY collection,id', ORDERS), rowsBefore);
  assert.deepEqual(b._db.all('SELECT * FROM kv WHERE key != ? ORDER BY key', ORDERS), kvBefore);
  assert.deepEqual(b._db.all('SELECT * FROM users ORDER BY id'), usersBefore);
  assert.deepEqual(b._db.all('SELECT * FROM numbering_reservations ORDER BY type,number'), reservations);
  assert.equal(b._db.get('SELECT count(*) n FROM financial_documents').n, 0);
  assert.equal(b._db.get('SELECT count(*) n FROM order_events').n, 0);
  assert.deepEqual(b._db.all('SELECT id FROM notification_outbox').map(row => row.id), ['keep-note']);
  assert.equal(b._db.get('SELECT count(*) n FROM notification_reads').n, 1);
  assert.equal(b.set(f.clerk, ORDERS, staleOrders).ok, false);
  assert.equal(b.get(manager, ORDERS).ok, false);
  const fresh = f.login();
  assert.deepEqual(b.get(fresh, ORDERS).value, []);
  assert.equal(b.set(fresh, ORDERS, staleOrders).code, 'STALE_ORDER_DATA');
  assert.deepEqual(b.numberingSettings(fresh).settings, numbers);
  const next = f.create(fresh, 'fresh-order');
  assert.equal(next.orderNumber, '');
  assert.equal(b.orderAction(fresh, 'fresh-order', 'confirm_customer', { evidence: 'تأیید مشتری' }).ok, true);
  const numberedNext = b.get(fresh, ORDERS).value[0];
  assert.equal(Number(numberedNext.orderNumber), Number(numbered.orderNumber) + 1, 'the sequence continues after the reset');
  const backup = new DatabaseSync(result.backupFile, { readOnly: true });
  try {
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(JSON.parse(backup.prepare('SELECT data FROM records WHERE collection=?').get(ORDERS).data).id, order.id);
    assert.deepEqual(JSON.parse(backup.prepare('SELECT record FROM financial_documents').get().record), doc);
    assert.equal(backup.prepare('SELECT count(*) n FROM order_events').get().n, 2, 'the seeded event plus the customer confirmation event');
  } finally { backup.close(); }
  const audit = b.auditRows().find(row => row.action === 'test_orders_reset');
  assert.equal(audit.user_id, 'u_admin'); assert.equal(JSON.parse(audit.detail).backupFile, result.backupFile);
});

test('failure inside reset transaction rolls all deletion and tombstones back, retaining backup', t => {
  const f = fixture(t); const { b, manager } = f; f.create();
  const p = f.payload();
  b._db.exec("CREATE TRIGGER block_reset_audit BEFORE INSERT ON audit_log WHEN NEW.action='test_orders_reset' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  const result = b.resetOrders(manager, p);
  assert.equal(result.ok, false); assert.equal(result.code, 'ORDER_RESET_FAILED');
  assert.equal(b.get(manager, ORDERS).value.length, 1);
  assert.equal(b._db.get('SELECT count(*) n FROM order_reset_tombstones').n, 0);
  assert.equal(fs.existsSync(result.backupFile), true);
});

test('unreserved legacy high numbers and IDs are never reused after reset', t => {
  const f = fixture(t); const { b, manager } = f;
  b._db.run('INSERT INTO kinds(key,kind) VALUES(?,?)', ORDERS, 'array');
  b._db.run('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)', ORDERS, 'legacy', 0, JSON.stringify({ id: 'legacy', orderNumber: '9000', status: 'در انتظار تایید', items: [] }), 1);
  assert.equal(b.resetOrders(manager, f.payload()).ok, true);
  const fresh = f.login();
  assert.equal(b.set(fresh, ORDERS, [{ id: 'legacy', items: [] }]).code, 'STALE_ORDER_DATA');
  assert.equal(f.create(fresh, 'new-id').orderNumber, '');
  assert.equal(b.orderAction(fresh, 'new-id', 'confirm_customer', { evidence: 'تأیید مشتری' }).orderNumber, '9001');
});

test('reset invalidates sessions in another running backend and backups never collide at the same clock time', t => {
  const f = fixture(t); const { b, manager } = f; f.create();
  const peer = f.peer();
  const peerToken = peer.login('clerk', 'reset-other-password').token;
  const stale = peer.get(peerToken, ORDERS).value;
  const first = b.resetOrders(manager, f.payload());
  assert.equal(first.ok, true, first.error);
  assert.equal(peer.set(peerToken, ORDERS, stale).ok, false);
  assert.equal(peer.currentUser(peerToken).ok, false);
  const fresh = f.login(); f.create(fresh, 'second-order');
  const second = b.resetOrders(fresh, f.payload(fresh));
  assert.equal(second.ok, true, second.error);
  assert.notEqual(first.backupFile, second.backupFile);
  assert.equal(fs.existsSync(first.backupFile), true);
  assert.equal(fs.existsSync(second.backupFile), true);
});
