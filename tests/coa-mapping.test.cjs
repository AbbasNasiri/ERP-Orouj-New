'use strict';
/* اصلاحات ۱۷/بند ۰: کدینگ انتخابی + نگاشت رویداد→سند + سه جدول دفترکل.
   سه چیز سنجیده می‌شود:
   ۱) ساختار: هر قاعدهٔ ثبتی متوازن است و اگر یک مبلغ عمداً خراب شود، اعتبارسنجی همان را می‌گیرد
      (کنترل منفی؛ بدون این سطر، «متوازن است» فقط یک ادعاست).
   ۲) fail‑closed: با عددِ غایب هیچ پیش‌نویسی ساخته نمی‌شود و پیام، جزءِ غایب را نام می‌برد نه عبارت مرکب را.
   ۳) نوشتن: امروز هیچ سطری در دفترکل نیست، کدینگ فقط «پیشنهاد سیستم» است و تا تأیید کارفرما
      هیچ سندی ثبت نمی‌شود؛ با یک سطرِ ثبت‌شده، پاکسازی آزمایشی سفارش‌ها رد می‌شود (سند حذف نمی‌شود). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');
const coa = require('../electron/coa');

const PASS = 'strong-coa-pass';

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-coa-'));
  const b = createBackend({ dataDir: dir, openDb, now: () => Date.parse('2026-06-15T12:00:00Z') });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, PASS);
  const users = b.listUsers(manager).users;
  users.push(
    { id: 'fin', name: 'مدیر مالی', username: 'fin', role: 'مدیر مالی', _plain: PASS },
    { id: 'clerk', name: 'کارشناس سفارشات', username: 'clerk', role: 'کارشناس سفارشات', _plain: PASS },
    { id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', _plain: PASS },
  );
  assert.equal(b.saveUsers(manager, users).ok, true);
  const fin = b.login('fin', PASS).token;
  const clerk = b.login('clerk', PASS).token;
  const store = b.login('store', PASS).token;
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, manager, fin, clerk, store, dir };
}

/* ---------- ۱) ساختار ---------- */
test('کدینگ گزیده و نگاشت رویدادها معتبرند و هر قاعدهٔ ثبتی در دو طرف یک مبلغ می‌نویسد', () => {
  const check = coa.validateCoding();
  assert.equal(check.ok, true, check.errors.join(' | '));
  assert.deepEqual(check.errors, []);
  assert.deepEqual(check.stats, {
    accounts: 46, rules: 43, posting: 38, mechanisms: 5, balanced: 38, readyNow: 3, waiting: 35,
    unusedAccounts: ['1202', '1302', '1304', '1305', '1401', '1501', '1502', '3101', '3201', '3301', '3401', '6201', '6202', '6301', '6601', '7103'],
  });
  assert.equal(check.stats.balanced, check.stats.posting, 'هر ۳۸ قاعدهٔ ثبتی متوازن است');
  assert.equal(new Set(coa.ACCOUNTS.map(a => a.code)).size, coa.ACCOUNTS.length, 'کد حساب تکراری نیست');
  assert.equal(new Set(coa.MAPPINGS.map(r => r.event)).size, coa.MAPPINGS.length, 'رویداد دوبار تعریف نشده است');
});

test('کنترل منفی: با یک مبلغِ دست‌کاری‌شده در قاعده، اعتبارسنجی توازن را می‌شکند و بازگرداندن آن درست می‌کند', () => {
  const rule = coa.MAPPINGS.find(r => r.event === 'invoice_issued');
  const vat = rule.lines.find(l => l.account === '2203');
  const original = vat.amount;
  try {
    vat.amount = 'invoice.net';   // بستانکار دو بار «خالص» می‌شود در حالی که بدهکار «خالص + مالیات» است
    const broken = coa.validateCoding();
    assert.equal(broken.ok, false, 'قاعدهٔ نابرابر باید رد شود');
    assert.match(broken.errors.join(' '), /متوازن نیست/);
  } finally {
    vat.amount = original;
  }
  assert.equal(coa.validateCoding().ok, true, 'با بازگرداندن مبلغ، ساختار دوباره معتبر است');
});

/* ---------- ۲) fail-closed ---------- */
test('پیش‌نویس سند با دادهٔ واقعی ساخته می‌شود: فاکتور سه سطر و متوازن از خالص به‌اضافهٔ مالیات', () => {
  const draft = coa.draftFor('invoice_issued', { 'invoice.net': 800, 'invoice.vat': 100 });
  assert.equal(draft.ok, true, draft.error || '');
  assert.deepEqual(draft.lines.map(l => [l.code, l.side, l.amount]), [['1201', 'dr', 900], ['5101', 'cr', 800], ['2203', 'cr', 100]]);
  assert.equal(draft.total, 900);
});

test('عددِ غایب یعنی «چیزی ساخته نمی‌شود»: پیام نام جزءِ غایب را می‌برد نه عبارت مرکب را', () => {
  const missingVat = coa.draftFor('invoice_issued', { 'invoice.net': 800 });
  assert.equal(missingVat.ok, false);
  assert.equal(missingVat.code, 'VALIDATION_FAILED');
  assert.match(missingVat.error, /invoice\.vat/, 'باید بگوید کدام جزء کم است');
  assert.doesNotMatch(missingVat.error, /invoice\.gross/);
  assert.equal(coa.draftFor('invoice_issued', { 'invoice.net': 800, 'invoice.vat': -1 }).code, 'VALIDATION_FAILED', 'منفی مبلغ نمی‌تواند');
  assert.equal(coa.draftFor('invoice_issued', { 'invoice.net': 800, 'invoice.vat': 1.5 }).code, 'VALIDATION_FAILED', 'کسری ریال نمی‌تواند');
});

test('رویدادِ بی‌نگاشت و قاعدهٔ مکانیزمی پیش‌نویس نمی‌دهند؛ راهِ جایگزین با توضیح خودش برمی‌گردد', () => {
  assert.equal(coa.draftFor('nothing_like_this', { 'receipt.amount': 10 }).code, 'UNMAPPED');
  const mechanism = coa.draftFor('correction_document', {});
  assert.equal(mechanism.ok, false);
  assert.equal(mechanism.code, 'MECHANISM');
  assert.ok(mechanism.error.length > 20, 'توضیح مکانیزم باید خواندنی باشد');
});

test('حساب گردگیر از خودِ رویداد تعیین می‌شود؛ روش پرداخت یا وضعیت چکِ نامعلوم سند را می‌بندد', () => {
  assert.deepEqual(coa.draftFor('prepayment_received', { 'receipt.amount': 500, method: 'نقد' }).lines.map(l => l.code), ['1101', '2201']);
  assert.deepEqual(coa.draftFor('prepayment_received', { 'receipt.amount': 500, method: 'چک' }).lines.map(l => l.code), ['1103', '2201']);
  assert.equal(coa.draftFor('prepayment_received', { 'receipt.amount': 500, method: 'صرافی' }).code, 'VALIDATION_FAILED');
  const cleared = coa.draftFor('cheque_cleared', { 'cheque.net': 950, 'cheque.fee': 50, chequeState: 'near_box' });
  assert.equal(cleared.ok, true, cleared.error || '');
  assert.deepEqual(cleared.lines.map(l => [l.code, l.side, l.amount]), [['1102', 'dr', 950], ['7102', 'dr', 50], ['1103', 'cr', 1000]]);
  assert.equal(coa.draftFor('cheque_cleared', { 'cheque.net': 950, 'cheque.fee': 50 }).code, 'VALIDATION_FAILED', 'بی‌وضعیتِ چک، حساب بستانکار مشخص نیست');
});

/* ---------- ۳) نوشتن و دسترسی ---------- */
test('کدینگ هنگام ساخت بانک کاشته می‌شود، همه «پیشنهاد سیستم»‌اند و دفترکل هنوز خالی است', t => {
  const { b, manager } = fixture(t);
  const out = b.ledgerCoding(manager);
  assert.equal(out.ok, true, out.error || '');
  assert.equal(out.check.ok, true);
  assert.equal(out.live.accounts, coa.ACCOUNTS.length);
  assert.equal(out.live.entries, 0, 'هیچ سند قطعی ثبت نشده است');
  assert.equal(out.live.drafts, 0);
  assert.equal(out.live.lines, 0);
  assert.deepEqual([out.approval.approved, out.approval.total], [0, coa.ACCOUNTS.length]);
  assert.match(out.approval.state, /پیش‌نویس/);
  assert.ok(out.accounts.every(a => a.source === 'پیشنهاد سیستم' && !a.approvedAt));
  assert.equal(out.accounts.filter(a => a.rules > 0).length, coa.ACCOUNTS.length - coa.validateCoding().stats.unusedAccounts.length);
});

test('مدیر چاپخانه و مدیر مالی کدینگ را می‌خوانند؛ کارشناس، انباردار و بی‌توکن رد می‌شوند', t => {
  const { b, manager, fin, clerk, store } = fixture(t);
  assert.equal(b.ledgerCoding(fin).ok, true);
  assert.equal(b.ledgerCoding(clerk).code, 'FORBIDDEN');
  assert.equal(b.ledgerCoding(store).code, 'FORBIDDEN');
  assert.equal(b.ledgerCoding('x'.repeat(12)).ok, false);
  const spy = { ledgerCoding: () => ({ ok: true, spy: true }) };
  assert.equal(invoke('be:ledgerCoding', spy, {}, 'x'.repeat(12), []).code, 'UNAUTHENTICATED');
  assert.equal(invoke('be:ledgerCoding', spy, {}, manager, []).spy, true, 'کانال در جدول allow-list ثبت است');
});

test('سازندهٔ میز، نام فیلدها را می‌برد نه رقم؛ هیچ مبلغی در payload نگاشت نیست', t => {
  const { b, fin } = fixture(t);
  const out = b.ledgerCoding(fin);
  for (const rule of out.rules) {
    assert.doesNotMatch(rule.debit, /\d{4}[.,]?\d/, `مبلغ در قاعدهٔ ${rule.event}: ${rule.debit}`);
    assert.doesNotMatch(rule.credit, /\d{4}[.,]?\d/, `مبلغ در قاعدهٔ ${rule.event}: ${rule.credit}`);
  }
  assert.ok(out.rules.every(r => r.kind === 'posting' ? r.debit && r.credit : r.note.length > 20));
});

test('با حتی یک سندِ ثبت‌شده در دفترکل، پاکسازی آزمایشی سفارش‌ها رد می‌شود و سطرِ سند دست نمی‌خورد', t => {
  const { b, manager } = fixture(t);
  const preview = b.previewOrderReset(manager);
  assert.equal(preview.ok, true, 'بی‌سندِ دفترکل، پیش‌نمایش پاکسازی کار می‌کند');
  b._db.run(`INSERT INTO journal_entries(id,entry_date,event,source_type,source_id,description,amount,status,created_at,created_by)
    VALUES('je-1','2026-06-15','invoice_issued','financial_document','d-1','سند آزمایشی',900,'posted',1,'u_admin')`);
  const blocked = b.previewOrderReset(manager);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /دفترکل/);
  assert.equal(b._db.get('SELECT COUNT(*) AS n FROM journal_entries').n, 1, 'رد شدن یعنی حذف نکردن؛ سابقه می‌ماند');
  assert.equal(b.ledgerCoding(manager).live.entries, 1, 'میز همان عددِ واقعی را نشان می‌دهد');
});
