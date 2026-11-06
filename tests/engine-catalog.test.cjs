'use strict';
/* کاتالوگ قطع و ماشین موتور محاسبه: فقط مدیر می‌نویسد، ساختار سخت بررسی می‌شود و موتور از آن می‌خواند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

test('ذخیرهٔ کاتالوگ موتور: ساختار نامعتبر رد و ساختار درست پذیرفته می‌شود', () => {
  const b = createBackend({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-engcat-')), openDb });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, 'strong-engine-pass');
  const good = { 'خشتی': { formPages: 16, paperPages: 32, partials: [8, 4], trim: [20, 20] } };
  const r = b.set(manager, 'printshop_engine_cuts', good); assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(b.set(manager, 'printshop_engine_cuts', { x: { formPages: 16, paperPages: 30, partials: [], trim: [20, 20] } }).code, 'VALIDATION_FAILED', 'ورق مادر مضرب فرم نیست');
  assert.equal(b.set(manager, 'printshop_engine_cuts', { x: { formPages: 16, paperPages: 32, partials: [16], trim: [20, 20] } }).code, 'VALIDATION_FAILED', 'نیم‌فرم بزرگ‌تر یا برابر فرم');
  assert.equal(b.set(manager, 'printshop_engine_presses', { 'دیجیتال': { offset: false, plateFactor: 0 }, 'GTO': { offset: true, plateFactor: 0.25, sheet: [35, 50] } }).ok, true);
  assert.equal(b.set(manager, 'printshop_engine_presses', { p: { offset: true, plateFactor: 0, sheet: [35, 50] } }).code, 'VALIDATION_FAILED', 'افست بدون ضریب زینک');
  assert.equal(b.set(manager, 'printshop_engine_presses', { p: { offset: false, plateFactor: 0.5 } }).code, 'VALIDATION_FAILED', 'دیجیتال با زینک');
});

test('موتور قطع و ماشین سفارشی کاتالوگ را به کار می‌برد', async () => {
  const { planBook } = await import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'print-engine.mjs')).href);
  const catalog = {
    cuts: { 'خشتی': { formPages: 12, paperPages: 24, partials: [6], trim: [20, 20] } },
    presses: { 'سه‌چهارم': { plateFactor: 0.75, offset: true, sheet: [60, 90] } },
  };
  const ok = planBook({ cut: 'خشتی', pages: 120, qty: 1000, colors: 1, press: 'سه‌چهارم', catalog });
  assert.equal(ok.ok, true);
  assert.equal(planBook({ cut: 'خشتی', pages: 125, qty: 1000, colors: 1, press: 'سه‌چهارم', catalog }).ok, false, 'باقی‌مانده ۵ مجاز نیست');
  assert.equal(planBook({ cut: 'وزیری', pages: 320, qty: 1000, colors: 1, press: 'سه‌چهارم', catalog }).ok, false, 'قطع پیش‌فرض در کاتالوگ سفارشی نیست');
});