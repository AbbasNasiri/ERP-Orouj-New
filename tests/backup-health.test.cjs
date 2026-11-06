'use strict';
/* سلامت پشتیبان: این آزمون‌ها چهار نقصی را که در بررسی «مرجع داده» پیدا شد بست می‌کنند —
   ۱) فایل روز قبلاً اگر موجود بود بی‌بازنویسی رد می‌شد، ۲) نام فایل هیچ شناسهٔ ایستگاهی نداشت،
   ۳) خطا بی‌صدا بلعیده می‌شد، ۴) برچسب روز UTC بود نه تهران.
   همه روی پوشهٔ موقت و با موتور SQLite خودِ Node؛ هیچ دادهٔ واقعی دست نمی‌خورد. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');

const ORDERS = 'printshop_orders_v5';

function openDb(file) {
  const db = new DatabaseSync(file);
  return {
    exec: s => db.exec(s),
    run: (s, ...p) => db.prepare(s).run(...p),
    get: (s, ...p) => db.prepare(s).get(...p),
    all: (s, ...p) => db.prepare(s).all(...p),
    close: () => db.close(),
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}

function fixture(t, { clock = Date.UTC(2026, 9, 22, 12, 0), station = 'STATION-A' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-backup-'));
  const backups = path.join(dir, 'backups');
  const realHostname = os.hostname;
  os.hostname = () => station; // stationTag() هر بار صدا می‌زند، پس همین کافی است
  let now = clock;
  const b = createBackend({ dataDir: dir, openDb, now: () => now });
  t.after(() => { os.hostname = realHostname; b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-backup-pass');
  const users = b.listUsers(manager).users;
  users.push({ id: 'clerk', username: 'clerk', name: 'کارشناس', role: 'کارشناس سفارشات', _plain: 'strong-clerk-pass' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const clerk = b.login('clerk', 'strong-clerk-pass').token;
  const addOrder = (id) => {
    const orders = b.get(manager, ORDERS).value || [];
    const saved = b.set(manager, ORDERS, [...orders, {
      id, orderNumber: `backup-${id}`, customerId: 'c1', customerName: 'آزمایشی',
      status: 'در انتظار تایید', quoteRev: 1, items: [{ id: `${id}-i1`, stage: 'ثبت سفارش', qty: 1, services: [] }],
      payments: [], history: [],
    }]);
    assert.equal(saved.ok, true, saved.error);
    return saved.value.find(o => o.id === id);
  };
  const daily = (tag = station) => fs.readdirSync(backups).filter(f => new RegExp(`^printshop-${tag}-\\d{4}-\\d{2}-\\d{2}\\.db$`).test(f)).sort();
  return { b, dir, backups, manager, clerk, addOrder, daily, advance: ms => { now += ms; }, station };
}

test('the same day backup is rewritten, so a whole day of work is never left unprotected', t => {
  const { b, backups, addOrder, daily, advance } = fixture(t);
  const first = b.backup(backups);
  assert.equal(first.ok, true, first.error);
  addOrder('before-backup');
  advance(60 * 60 * 1000); // یک تیک بعدی، همان روز
  const second = b.backup(backups);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.file, first.file, 'same day must reuse one file, not accumulate skipped duplicates');
  assert.equal(daily().length, 1);
  const copy = new DatabaseSync(path.join(backups, second.file), { readOnly: true });
  const rows = copy.prepare('SELECT data FROM records WHERE collection = ?').all(ORDERS).map(r => String(r.data)).join('');
  assert.ok(rows.includes('before-backup'), 'a record written after the first backup is missing from the refreshed backup');
  copy.close();
});

test('station name is part of the file name and pruning never touches another station copy', t => {
  const { b, backups, daily, advance, station } = fixture(t);
  const foreign = 'printshop-STATION-B-2026-10-20.db';
  fs.mkdirSync(backups, { recursive: true });
  fs.writeFileSync(path.join(backups, foreign), 'not-mine');
  for (let day = 1; day <= 18; day++) {
    const name = `printshop-${station}-2026-10-${String(day).padStart(2, '0')}.db`;
    fs.writeFileSync(path.join(backups, name), `old-${day}`);
  }
  advance(24 * 3600 * 1000);
  const record = b.backup(backups);
  assert.equal(record.ok, true, record.error);
  assert.ok(record.file.startsWith(`printshop-${station}-`), `file name lost the station tag: ${record.file}`);
  assert.equal(daily().length, 14, 'own daily copies must be kept at 14');
  assert.equal(fs.readFileSync(path.join(backups, foreign), 'utf8'), 'not-mine', 'pruning deleted another station backup');
});

test('the backup day follows Tehran calendar, not UTC', t => {
  // ۲۱:۰۰ UTC همان ۰۰:۳۰ روز بعد در تهران است؛ برچسب UTC کارِ بعدازظهر را در فایل «فردا» می‌انداخت.
  const { b, backups } = fixture(t, { clock: Date.UTC(2026, 9, 22, 21, 0) });
  const record = b.backup(backups);
  assert.equal(record.ok, true, record.error);
  assert.equal(record.day, '2026-10-23');
  assert.equal(record.file, `printshop-STATION-A-${record.day}.db`);
  assert.equal(fs.existsSync(path.join(backups, 'printshop-STATION-A-2026-10-22.db')), false);
});

test('a failed backup is reported and audited instead of being swallowed', t => {
  const { b, backups, manager, addOrder } = fixture(t);
  addOrder('kept-live');
  fs.writeFileSync(backups, 'this path is a file, so the backup directory cannot be created');
  const record = b.backup(backups);
  assert.equal(record.ok, false);
  assert.ok(record.error.length > 0, 'a failed backup reported no reason');
  assert.equal(b.backupStatus(manager).last.ok, false, 'the failure is not visible through backupStatus');
  assert.equal(b.backupStatus(manager).last.error, record.error);
  assert.ok(b.auditRows().some(row => row.action === 'backup_failed'), 'no audit trail for the failed backup');
  assert.equal(b.get(manager, ORDERS).value.some(o => o.id === 'kept-live'), true, 'a backup failure disturbed the live database');
});

test('a backup is restorable: integrity clean, foreign keys satisfied and the payload present', t => {
  const { b, backups, addOrder } = fixture(t);
  addOrder('restore-me');
  const record = b.backup(backups);
  assert.equal(record.ok, true, record.error);
  assert.equal(record.bytes, record.pages * record.pageSize, 'the file size does not match its own SQLite header');
  const copy = new DatabaseSync(path.join(backups, record.file), { readOnly: true });
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(copy.prepare('PRAGMA foreign_key_check').all().length, 0);
  const text = copy.prepare('SELECT data FROM records').all().map(r => String(r.data)).join('');
  assert.ok(text.includes('restore-me'), 'the backup copy does not contain the committed order');
  copy.close();
});

test('only the manager can read backup health, and a manual copy keeps its own name', t => {
  const { b, backups, manager, clerk } = fixture(t);
  assert.equal(b.backupStatus(clerk).ok, false);
  assert.equal(b.backupNow(clerk, backups).ok, false);
  assert.equal(b.backupStatus(manager).ok, true);
  const manual = b.backupNow(manager, backups);
  assert.equal(manual.ok, true, manual.error);
  assert.match(manual.file, /^printshop-STATION-A-manual-\d{4}-\d{2}-\d{2}-\d+\.db$/);
  assert.equal(b.backupStatus(manager).own, 1);
  assert.equal(b.auditRows().some(row => row.action === 'manual_backup'), true);
});
