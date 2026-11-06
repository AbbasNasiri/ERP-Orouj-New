'use strict';
/* بند پ: نشانهٔ زندهٔ تغییر. هر ایستگاه از سرور می‌پرسد «بعد از آخرین کارِ من جایی
   تغییر کرده؟» و فقط نامِ فهرست‌ها را می‌گیرد، نه داده. این آزمون‌ها همان قراداد را
   با موتور واقعی می‌سنجند: پایه‌گذاریِ نخستین پرسش، خبرِ یک‌باره، نامرئی‌بودنِ نوشتنِ
   خودِ ایستگاه، و نام‌برده‌نشدنِ فهرستی که آن نقش اجازهٔ خواندنش را ندارد. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const PASS = 'live-changes-strong-pass';
const SUP = 'printshop_suppliers_v2';
const UNITS = 'printshop_units_v1';

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-live-'));
  const b = createBackend({ dataDir: dir, openDb });
  const ctx = { backupDir: path.join(dir, 'backups'), origin: 'network' };
  const call = (name, token, ...args) => invoke(name, b, ctx, token, args);
  const admin = b.login('admin', '1234').token;
  assert.equal(b.setOwnPassword(admin, PASS).ok, true);
  const users = b.listUsers(admin).users;
  users.push({ id: 'finance', name: 'ایستگاه مالی', username: 'finance', role: 'مدیر مالی', _plain: PASS });
  users.push({ id: 'storekeeper', name: 'انباردار', username: 'storekeeper', role: 'انباردار', _plain: PASS });
  assert.equal(b.saveUsers(admin, users).ok, true);
  const login = (u) => { const r = call('be:login', null, u, PASS); assert.equal(r.ok, true, JSON.stringify(r)); return r.token; };
  const finance = login('finance');
  const store = login('storekeeper');
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, call, admin, finance, store };
}

function addSupplier(call, token, id) {
  const read = call('be:get', token, SUP);
  assert.equal(read.ok, true, JSON.stringify(read));
  const next = (read.value || []).concat({ id, name: 'تأمین‌کنندهٔ ' + id, phone: '0210000000' });
  const write = call('be:set', token, SUP, next, read.revs);
  assert.equal(write.ok, true, JSON.stringify(write));
  return write.revs;
}

test('the first poll only sets the baseline; the next real change is reported exactly once', t => {
  const { call, admin, finance } = fixture(t);
  assert.deepEqual(call('be:changes', finance).changed, [], 'نخستین پرسش نباید چیزی را «تازه» اعلام کند');
  addSupplier(call, admin, 's1');
  assert.deepEqual(call('be:changes', finance).changed, [SUP], 'تغییر ایستگاه دیگر خبر داده نشد');
  assert.deepEqual(call('be:changes', finance).changed, [], 'همان تغییر دو بار خبر داده شد');
});

test('a station is never told about its own write, only the others are', t => {
  const { call, admin, finance } = fixture(t);
  call('be:changes', admin);
  call('be:changes', finance);
  addSupplier(call, admin, 's1');
  assert.deepEqual(call('be:changes', admin).changed, [], 'ایستگاه نوشتنِ خودش را «تغییر دیگری» دید');
  assert.deepEqual(call('be:changes', finance).changed, [SUP], 'ایستگاه دیگر خبر نگرفت');
});

test('a station that joins after the change is not alarmed on its first poll', t => {
  const { call, b, admin, finance } = fixture(t);
  assert.deepEqual(call('be:changes', finance).changed, []);
  addSupplier(call, admin, 's1');
  const late = b.login('finance', PASS).token; // نشست تازه، بعد از تغییر
  assert.deepEqual(call('be:changes', late).changed, [], 'ایستگاه تازه‌وارد تغییرِ پیش از ورودش را تازه دید');
  addSupplier(call, admin, 's2');
  assert.deepEqual(call('be:changes', late).changed, [SUP]);
  assert.deepEqual(call('be:changes', finance).changed, [SUP], 'خبر برای هر نشست جداست');
});

test('a list the role cannot read is never named, even when it changes', t => {
  const { call, admin, store } = fixture(t);
  call('be:changes', store);
  assert.equal(call('be:get', admin, UNITS).ok, true);
  assert.equal(call('be:get', store, UNITS).ok, false, 'انباردار نباید این فهرست را بخواند');
  const write = call('be:set', admin, UNITS, { sheet: 'A4' }, call('be:get', admin, UNITS).revs);
  assert.equal(write.ok, true, JSON.stringify(write));
  assert.deepEqual(call('be:changes', store).changed, [], 'فهرستِ ناخواندنی برای انباردار نام برده شد');
});

test('reordering records neither advances a version nor raises a change', t => {
  const { call, admin, finance } = fixture(t);
  addSupplier(call, admin, 's1');
  addSupplier(call, admin, 's2');
  const read = call('be:get', admin, SUP);
  call('be:changes', finance);
  const reorder = call('be:set', admin, SUP, read.value.slice().reverse(), read.revs);
  assert.equal(reorder.ok, true, JSON.stringify(reorder));
  assert.deepEqual(reorder.revs, read.revs, 'جابه‌جایی ترتیب نسخه را جلو برد');
  assert.deepEqual(call('be:changes', finance).changed, [], 'جابه‌جایی ترتیب خبرِ تغییر داد');
});

test('a token that cannot be a session is refused before any list is named', t => {
  const { call } = fixture(t);
  for (const token of ['', 'tok', 'x'.repeat(200)]) {
    const r = call('be:changes', token);
    assert.equal(r.ok, false, token);
    assert.equal(r.code, 'UNAUTHENTICATED', token);
    assert.equal(Object.hasOwn(r, 'changed'), false, token);
  }
});
