'use strict';
/* بند ت: نام ایستگاه روی حساب کاربر. هر میز نشانی دارد که در فهرست کاربران دیده و
   ویرایش می‌شود و پس از ورود همان ایستگاه در رابط کاربری نشان داده می‌شود.
   این آزمون‌ها قرارداد را با موتور واقعی می‌سنجند: ذخیره و بازخوانی، پاک‌سازی نویسه‌ها،
   رد نام بلند بدون هیچ نوشتنی، و این‌که تغییر نام نشست را باطل نمی‌کند در حالی که
   تغییر نقش همچنان باطل می‌کند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const PASS = 'station-strong-pass';
const MAX = 40;

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-station-'));
  const b = createBackend({ dataDir: dir, openDb });
  const ctx = { backupDir: path.join(dir, 'backups'), origin: 'network' };
  const call = (name, token, ...args) => invoke(name, b, ctx, token, args);
  const admin = b.login('admin', '1234').token;
  assert.equal(b.setOwnPassword(admin, PASS).ok, true);
  const users = b.listUsers(admin).users;
  users.push({ id: 'finance', name: 'مدیر مالی', username: 'finance', role: 'مدیر مالی', station: 'مالی', _plain: PASS });
  assert.equal(b.saveUsers(admin, users).ok, true);
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, b, call, admin, users: () => b.listUsers(admin).users };
}

test('a station name round-trips through save, list and login', t => {
  const { call, users } = fixture(t);
  const finance = users().find(u => u.id === 'finance');
  assert.equal(finance.station, 'مالی');
  const session = call('be:login', null, 'finance', PASS);
  assert.equal(session.ok, true, JSON.stringify(session));
  assert.equal(session.user.station, 'مالی', 'ورود باید نام ایستگاه همان حساب را برگرداند');
});

test('station names are trimmed and collapsed, never stored raw', t => {
  const { b, admin, users } = fixture(t);
  const list = users().map(u => u.id === 'finance' ? { ...u, station: '  مالی\tو  انبار  ' } : u);
  assert.equal(b.saveUsers(admin, list).ok, true);
  assert.equal(users().find(u => u.id === 'finance').station, 'مالی و انبار');
});

test('a station name longer than the limit is refused and nothing is written', t => {
  const { b, admin, users } = fixture(t);
  const before = users().map(u => ({ ...u }));
  const list = users().map(u => u.id === 'finance' ? { ...u, station: 'x'.repeat(MAX + 1), name: 'نام عوض‌شده' } : u);
  const result = b.saveUsers(admin, list);
  assert.equal(result.ok, false);
  assert.match(result.error, new RegExp(String(MAX)));
  const after = users();
  assert.equal(after.find(u => u.id === 'finance').station, 'مالی', 'نام بلند نباید بخشی از خود را بنشاند');
  assert.equal(after.find(u => u.id === 'finance').name, before.find(u => u.id === 'finance').name, 'رد شدن یک فیلد نباید بقیهٔ همان درخواست را بنشاند');
});

test('a station name at exactly the limit is accepted', t => {
  const { b, admin, users } = fixture(t);
  const exact = 'ی'.repeat(MAX);
  assert.equal(b.saveUsers(admin, users().map(u => u.id === 'finance' ? { ...u, station: exact } : u)).ok, true);
  assert.equal(users().find(u => u.id === 'finance').station, exact);
});

test('changing a station keeps the station signed in; changing its role still revokes it', t => {
  const { b, call, admin, users } = fixture(t);
  const token = call('be:login', null, 'finance', PASS).token;
  assert.equal(call('be:changes', token).ok, true, 'نشست پیش از تغییر معتبر نیست');
  assert.equal(b.saveUsers(admin, users().map(u => u.id === 'finance' ? { ...u, station: 'مالی ۲' } : u)).ok, true);
  assert.equal(call('be:changes', token).ok, true, 'تغییر نام ایستگاه نباید نشست همان ایستگاه را باطل کند');
  assert.equal(b.saveUsers(admin, users().map(u => u.id === 'finance' ? { ...u, role: 'انباردار' } : u)).ok, true);
  const after = call('be:changes', token);
  assert.equal(after.ok, false, 'تغییر نقش باید نشست را باطل کند');
  assert.equal(after.code, 'UNAUTHENTICATED');
});

test('a bank made before this field existed gains it empty instead of failing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-station-migrate-'));
  const first = createBackend({ dataDir: dir, openDb });
  const admin = first.login('admin', '1234').token;
  assert.equal(first.setOwnPassword(admin, PASS).ok, true);
  const added = first.listUsers(admin).users;
  added.push({ id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', station: 'انبار', _plain: PASS });
  assert.equal(first.saveUsers(admin, added).ok, true);
  first.close();

  const raw = new DatabaseSync(path.join(dir, 'printshop.db'));
  raw.exec('ALTER TABLE users DROP COLUMN station');
  assert.equal(raw.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'station'), false, 'ستون ایستگاه برای ساخت بانک قدیمی حذف نشد');
  raw.close();

  const older = createBackend({ dataDir: dir, openDb });
  t.after(() => { older.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const token = older.login('admin', PASS).token;
  const list = older.listUsers(token);
  assert.equal(list.ok, true, JSON.stringify(list));
  assert.equal(list.users.find(u => u.id === 'store').station, '', 'کاربر بانک قدیمی باید بدون ایستگاه خوانده شود');
  assert.equal(older.saveUsers(token, list.users.map(u => u.id === 'store' ? { ...u, station: 'انبار' } : u)).ok, true);
  assert.equal(older.listUsers(token).users.find(u => u.id === 'store').station, 'انبار');
});
