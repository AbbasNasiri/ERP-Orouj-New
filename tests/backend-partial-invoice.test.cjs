'use strict';
/* اصلاحات ۱۷/بند ۳/۲: داورِ سرور برای «چند نسخه تحویل رفته» و «چند ریال صورتحساب شده».
   آزمون روی بانکی ساخته می‌شود که جدول اسنادش را نسخهٔ قبلیِ برنامه با قیدِ
   UNIQUE(order_id,quote_revision,type) ساخته است — یعنی همان بانکِ کارفرما. پس هر خطِ این
   فایل همِین را ثابت می‌کند: مهاجرت ردیف‌های پیشین را نگه می‌دارد و دو فاکتورِ تحویلی روی
   یک نسخه دیگر خطایِ بانک نمی‌دهد (با قیدِ کهنه، صدورِ دوم SqliteError می‌شد).
   مثالِ سندِ کارفرما: ۱۰۰۰ سفارش، ۱۰۵۰ سالم، ۶۰۰ + ۴۰۰ تحویل. مبلغِ تأییدشده ۷۰٬۱۸۰٬۰۰۰ ریال.
   کنترل‌های منفی عمدی: (۱) عددِ مالیِ فرستاده‌شدهٔ ایستگاه در سند نمی‌نشیند؛
   (۲) انباردار و سرپرست صحافی عددهای کنترل کیفیت/تحویل را ثبت نمی‌کنند؛ (۳) نوشتنِ خامِ
   quality/deliveries روی سفارش رد می‌شود؛ (۴) فاکتورِ کامل روی نسخه‌ای که فاکتور تحویلی
   خورده رد می‌شود؛ (۵) تخصیص وجه به سندی که برای این سفارش صادر نشده رد می‌شود؛
   (۶) بی‌تحویلِ ثبت‌شده فاکتورِ تحویلی صادر نمی‌شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');

const ORDERS = 'printshop_orders_v5';
const CUSTOMERS = 'printshop_customers_v2';
const FINAL_STAGE = 'کنترل کیفیت و تحویل به مشتری';
const M = 1000000;
/* کاغذ و زینک و جلد ثابت‌اند (وازشان واحدِ تحویلِ قلم نیست)؛ چاپ و صحافی «هر نسخه‌ای». */
const QUOTE_INPUT = {
  currency: 'IRR', effectiveDate: '2026-11-02',
  materials: [{ id: 'm-paper', itemId: 'i1', description: 'کاغذ و مقوا — تحریر ۷۰', itemCode: '0000000000123', unit: 'ورق', qty: 600, rate: 50000 }],
  services: [
    { id: 's-print', itemId: 'i1', description: 'چاپ متن — افست', unit: 'نسخه', qty: 1100, rate: 10000 },
    { id: 's-binding', itemId: 'i1', description: 'صحافی — چسب گرم', unit: 'نسخه', qty: 1000, rate: 5000 },
    { id: 's-zinc', itemId: 'i1', description: 'زینک', unit: 'عدد', qty: 4, rate: 2 * M },
    { id: 's-cover', itemId: 'i1', description: 'چاپ جلد — ۲ ورقی', unit: 'ورق', qty: 50, rate: 100000 },
  ],
  offers: [{ id: 'o1', description: 'طرح جلد — رایگان' }],
  serviceMarkupPercent: 20, taxPercent: 10, discount: 1 * M,
};
/* جمعِ ردیف‌ها: کاغذ ۳۰M + چاپ ۱۱M + صحافی ۵M + زینک ۸M + جلد ۵M = ۵۹M هزینه.
   سودِ خدمات ۲۰٪ از ۲۹M = ۵٫۸M ← جمعِ ۶۴٫۸M − تخفیفِ ۱M = ۶۳٫۸M + مالیاتِ ۱۰٪ = ۷۰٬۱۸۰٬۰۰۰. */
const APPROVED = 70180000;
/* برشِ ۶۰۰ از ۱۰۰۰ نسخه: هزینهٔ انباشته ۵۲٫۶M (کاغذ/زینک/جلد کامل + ۰٫۶ چاپ و صحافی)،
   سود = ⌊۵٫۸M × ۲۲٫۶M ÷ ۲۹M⌋ = ۴٫۵۲M ← جمعِ ۵۷٫۱۲M؛ تخفیف = ⌊۱M × ۵۷٫۱۲M ÷ ۶۴٫۸M⌋ = ۸۸۱٬۴۸۱
   ← مالیاتِ ۱۰٪ از ۵۶٬۲۳۸٬۵۱۹ = ۵٬۶۲۳٬۸۵۲ → ۶۱٬۸۶۲٬۳۷۱. */
const FIRST_INVOICE = 61862371;
const SECOND_INVOICE = APPROVED - FIRST_INVOICE; // ۸٬۳۱۷٬۶۲۹ ← جمعِ دو فاکتور سر به سر مبلغِ تأییدشده
/* حالتِ «تعداد واقعی» با ۱۰۲۰ تحویل: هزینه ۵۹٫۳۲M، سود ۵٫۸۶۴M، تخفیفِ کامل ۱M
   ← مبنای ۶۴٬۱۸۴٬۰۰۰ + مالیات ۶٬۴۱۸٬۴۰۰ = ۷۰٬۶۰۲٬۴۰۰ (از مبلغِ تأییدشده جلو می‌زند). */
const REAL_COUNT_TOTAL = 70602400;
/* بیست نسخهٔ تازه روی همان حالت: هزینهٔ انباشته ۵۹٫۶۴M، سود ۵٫۹۲۸M، تخفیفِ کامل ← ۶۴٬۵۶۸٬۰۰۰
   + مالیات ۶٬۴۵۶٬۸۰۰ = ۷۱٬۰۲۴٬۸۰۰؛ برشِ تازه فقط ۳۲۰٬۰۰۰ ریالِ خام (چاپ ۲۲۰٬۰۰۰ + صحافی ۱۰۰٬۰۰۰). */
const REAL_COUNT_CUM_1040 = 71024800;

function openDb(file) {
  const db = new DatabaseSync(file);
  return {
    exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p),
    all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(),
    tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
}
/* جدول اسنادِ نسخهٔ قبلی، عیناً با همان قیدِ که دو فاکتور را روی یک نسخه می‌کشت. */
const LEGACY_DOCUMENTS_DDL = `CREATE TABLE financial_documents (id TEXT PRIMARY KEY, type TEXT NOT NULL, order_id TEXT NOT NULL,
quote_revision INTEGER NOT NULL, number TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL, created_at INTEGER NOT NULL,
UNIQUE(order_id,quote_revision,type));`;
/* شماره‌ها بیرونِ رشته‌شماره‌گذاریِ امروز (۲۰۰۱/۳۰۰۱) می‌آیند تا جایِ سندِ تازه را نگیرند. */
const legacyRow = (id, type, number, total) => [id, type, 'o-legacy', 1, number, 'issued',
  JSON.stringify({ id, type, number, orderId: 'o-legacy', quoteRevision: 1, createdAt: 1760000000000, snapshot: { invoice: { totals: { total } } } }), 1760000000000];
const LEGACY_INSERT = 'INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)';

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-partial-'));
  const opened = [];
  const backend = () => { const x = createBackend({ dataDir: dir, openDb }); opened.push(x); return x; };
  if (options.legacy !== false) {
    const raw = new DatabaseSync(path.join(dir, 'printshop.db'));
    raw.exec(LEGACY_DOCUMENTS_DDL);
    raw.prepare(LEGACY_INSERT).run(...legacyRow('doc_legacy_quote', 'quote', 'ق-۹۰۰۱', 0));
    raw.prepare(LEGACY_INSERT).run(...legacyRow('doc_legacy_invoice', 'invoice', 'ف-۹۰۰۲', 12 * M));
    raw.close();
  }
  const b = backend();
  const close = () => { while (opened.length) opened.pop().close(); };
  t.after(() => { close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const manager = b.login('admin', '1234').token;
  assert.equal(b.setOwnPassword(manager, 'strong-partial-pass').ok, true);
  const users = b.listUsers(manager).users;
  for (const [id, role] of [['finance', 'مدیر مالی'], ['clerk', 'کارشناس سفارشات'], ['store', 'انباردار'], ['bind', 'سرپرست صحافی'], ['qc', 'ناظر کیفیت']]) users.push({ id, username: id, name: id, role, _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const tokens = Object.fromEntries(['finance', 'clerk', 'store', 'bind', 'qc'].map(id => [id, b.login(id, 'strong-test-pass').token]));
  assert.equal(b.set(manager, CUSTOMERS, [{ id: 'c1', name: 'نمونهٔ کارفرما', phone: '09120000000' }]).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c1', 'approve', { reason: 'مدارک ثبتی کامل است' }).ok, true);
  assert.equal(b.set(manager, ORDERS, [{
    id: 'o1', orderNumber: '1001', customerId: 'c1', customerName: 'نمونهٔ کارفرما', status: 'در انتظار تایید', quoteRev: 1,
    date: '2026-11-01', items: [{ id: 'i1', stage: 'ثبت سفارش', productName: 'کتاب', qty: 1000, qtyUnit: 'نسخه', services: [] }], payments: [], history: [],
  }]).ok, true);
  /* قیمت، تأیید و مجوز تولید از خودِ مسیرِ سرور می‌آیند، تا پیش‌فاکتور روی بانک معتبر بماند
     (سرور مبلغ را دوباره حساب و با عددِ ذخیره‌شده مقایسه می‌کند). حالتِ قرارداد هم همان‌جا
     در فرمِ پیش‌فاکتور تعیین می‌شود؛ عوضکردنش نسخهٔ تازه و تأییدِ دوبارهٔ مشتری می‌خواهد. */
  const input = options.contractMode ? { ...QUOTE_INPUT, contractMode: options.contractMode } : QUOTE_INPUT;
  assert.equal(b.orderAction(tokens.finance, 'o1', 'save_quote', { input, expectedRevision: 1 }).ok, true);
  assert.equal(b.orderAction(tokens.clerk, 'o1', 'confirm_customer', { evidence: 'تأیید تلفنی مشتری' }).ok, true);
  assert.equal(b.orderAction(manager, 'o1', 'release_production', { materialReview: { checked: true, shortages: [] } }).ok, true);
  const revision = b.get(manager, ORDERS).value[0].quoteRev;

  /* قلم را به مرحلهٔ کنترل کیفیت می‌برد. تنها جایِ آزمون که رکورد را مستقیم می‌نویسد
     همین است: «تمام‌کردنِ مرحله» ردیفِ تحویلِ واقعی و مصرف مواد را می‌خواهد و هدفِ
     این فایل عددهای بند ۳ است، نه رژهٔ مراحل. */
  const moveToQc = (orderId = 'o1', itemId = 'i1') => {
    const row = b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, orderId);
    const o = JSON.parse(row.data);
    o.items.find(i => i.id === itemId).stage = FINAL_STAGE;
    b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify(o), ORDERS, orderId);
  };
  moveToQc();
  /* اولین پارامتر در هر دو helper نشانهٔ نشست است — همان شکلِ واقعیِ IPC.
     پیش‌فرضِ «سالم» نشستِ «ناظر کیفیت» است: از اصلاحات ۱۷/بند ۳ (تصمیم کارفرما به پرسش ۱)
     این عدد را فقط همان نقش می‌نویسد؛ بقیه در کنترلِ منفیِ زیر رد می‌شوند. */
  const quality = (token = tokens.qc, payload = { itemId: 'i1', good: 1050 }) => b.orderAction(token, 'o1', 'record_quality', payload);
  const deliver = (token = tokens.clerk, payload = { itemId: 'i1', billable: 600 }) => b.orderAction(token, 'o1', 'record_delivery', payload);
  const partial = (token = tokens.finance) => b.documentAction(token, 'o1', 'issue_partial_invoice');
  /* rowهای node:sqlite بی‌prototypeاند؛ برای deepStrictEqual به شیءِ معمولی تبدیل می‌شوند. */
  const ledger = documentId => b._db.all('SELECT line_id lineId, qty, amount FROM invoice_billings WHERE document_id = ? ORDER BY line_id', documentId).map(r => ({ ...r }));
  const ledgerTotal = orderId => b._db.get('SELECT COALESCE(SUM(amount),0) n FROM invoice_billings WHERE order_id = ?', orderId).n;
  const orderRow = () => JSON.parse(b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, 'o1').data);
  const docsFor = id => b._db.all('SELECT id, number, type, status FROM financial_documents WHERE order_id = ? ORDER BY created_at', id);
  /* نوشتنِ عددها را همیشه یک‌بار انجام می‌دهیم: فراخوانیِ دوباره در «پیامِ خطا»ی assert
     می‌تواند ردیفِ تازه بسازد و عددِ شمارش‌شده در خطِ بعدی را عوض کند. */
  const ok = (result, label = '') => { assert.equal(result.ok, true, `${label} → ${result.error || ''}`.trim()); return result; };
  return { b, dir, reopen: backend, manager, revision, moveToQc, quality, deliver, partial, ledger, ledgerTotal, orderRow, docsFor, ok, close, ...tokens };
}

test('بانکِ قدیمی: قیدِ «یک فاکتور به ازای هر نسخه» برداشته می‌شود و ردیف‌های سند می‌مانند', t => {
  const { b, dir, close } = fixture(t);
  const sql = b._db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='financial_documents'").sql;
  assert.equal(sql.includes('UNIQUE(order_id,quote_revision,type)'), false, 'قیدِ کهنه در متنِ جدول مانده است');
  assert.match(sql, /UNIQUE\(type,number\)/, 'یکتاییِ شمارهٔ سند جایش را نگه داشته است');
  assert.equal(b._db.get("SELECT count(*) n FROM sqlite_master WHERE name='financial_documents_rebuilt'").n, 0, 'جدولِ میانیِ بازسازی پاک شده');
  assert.equal(b._db.get("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name='idx_financial_documents_order'").n, 1, 'نمایِ جدول اسناد پس از بازسازی برگشته است');
  assert.equal(b._db.get("SELECT count(*) n FROM sqlite_master WHERE name='invoice_billings'").n, 1, 'دفترِ صورتحساب ساخته می‌شود');
  const legacy = b._db.all("SELECT id, number, status FROM financial_documents WHERE order_id = 'o-legacy' ORDER BY id");
  assert.deepEqual(legacy.map(r => [r.id, r.number, r.status]), [['doc_legacy_invoice', 'ف-۹۰۰۲', 'issued'], ['doc_legacy_quote', 'ق-۹۰۰۱', 'issued']], 'هیچ سندِ پیشینی جا نیفتاده');
  close();
  const again = createBackend({ dataDir: dir, openDb });
  assert.equal(again._db.get("SELECT count(*) n FROM financial_documents WHERE order_id='o-legacy'").n, 2, 'بازکردنِ دوباره ردیفی نمی‌سازد و نمی‌شکند');
  assert.equal(again._db.get("SELECT sql FROM sqlite_master WHERE name='financial_documents'").sql.includes('UNIQUE(order_id'), false, 'مهاجرت یک‌بار است');
  again.close();
});

test('بانکِ تازه: بدونِ مهاجرت ساخته می‌شود و بی‌سند هیچ ردیفی نمی‌نویسد', t => {
  const { b } = fixture(t, { legacy: false });
  assert.equal(b._db.get('SELECT count(*) n FROM financial_documents').n, 0, 'مهاجرتِ بی‌داده سند نمی‌سازد');
  assert.equal(b._db.get("SELECT sql FROM sqlite_master WHERE name='financial_documents'").sql.includes('UNIQUE(order_id'), false);
});

test('سه عددِ هر قلم: سفارش‌شده از فرم، سالم از کنترل کیفیت، تحویلی از رسیدِ تحویل', t => {
  const { b, manager, clerk, qc, quality, deliver, ok, orderRow } = fixture(t);
  ok(quality());
  ok(deliver());
  ok(deliver(clerk, { itemId: 'i1', billable: 420 }), 'تحویلِ دوم ردیفِ تازه است نه ویرایشِ اولی');
  const item = orderRow().items[0];
  assert.equal(item.qty, 1000, 'سفارش‌شده دست نخورد');
  assert.equal(item.quality.good, 1050, 'سالم در رکوردِ کنترل کیفیت ثبت شد');
  assert.deepEqual([item.quality.by.role, item.quality.at], ['ناظر کیفیت', item.quality.at], 'ثبت‌کننده و تاریخ در خودِ رکورد است');
  assert.deepEqual(item.deliveries.map(d => d.billable), [600, 420], 'هیچ ردیفِ تحویلی بازنویسی نشد');
  assert.equal(new Set(item.deliveries.map(d => d.id)).size, 2, 'شناسهٔ هر رسید را سرور ساخته است');
  /* کنترل منفی: شناسه‌ای که ایستگاه بفرستد ردیفِ پیشین را بازنویسی نمی‌کند. */
  ok(b.orderAction(clerk, 'o1', 'record_delivery', { itemId: 'i1', billable: 10, id: item.deliveries[0].id }));
  const after = orderRow().items[0];
  assert.equal(after.deliveries.length, 3);
  assert.equal(after.deliveries[0].billable, 600, 'ردیفِ اول دست‌نخورده ماند');
  assert.notEqual(after.deliveries[2].id, item.deliveries[0].id, 'شناسهٔ فرستاده‌شده جای شناسهٔ سرور را نمی‌گیرد');
  /* کنترل منفی: نوشتنِ خامِ همین عددها روی سفارش، حتی با رمزِ مدیر. */
  const forged = b.get(manager, ORDERS).value;
  forged[0].items[0].quality = { good: 1, note: '', at: '2026-11-03', by: { id: 'x', name: 'x', role: 'x' } };
  assert.equal(b.set(manager, ORDERS, forged).ok, false, 'مدیر هم «سالم» را از مسیرِ ذخیره نمی‌نویسد');
  const dropped = b.get(manager, ORDERS).value;
  dropped[0].items[0].deliveries = [];
  assert.equal(b.set(manager, ORDERS, dropped).ok, false, 'پاک‌کردنِ ردیف‌های تحویل هم از این مسیر بسته است');
});

test('عددهای تولید را فقط نقشِ تعیین‌کنندهٔ همان مرحله ثبت می‌کند و بی‌مجوزِ تولید معنا ندارد', t => {
  const { b, manager, store, bind, finance, clerk, qc, quality, deliver, ok, orderRow } = fixture(t);
  /* «کار کنترل کیفیت جزو شرح وظایف ناظر کیفیت هست نه شخص دیگر» — فهرستِ ردشده‌ها
     کامل است: انباردار، سرپرستِ مرحلهٔ بعدی، کارشناس سفارشات، مدیر مالی و خودِ مدیر.
     مدیر چاپخانه بر خلافِ بقیهٔ عملیات، این عدد را امضا نمی‌کند. */
  for (const [token, label] of [[store, 'انباردار'], [bind, 'سرپرست صحافی'], [clerk, 'کارشناس سفارشات'], [finance, 'مدیر مالی'], [manager, 'مدیر چاپخانه']]) {
    const refused = quality(token);
    assert.equal(refused.code, 'FORBIDDEN', `${label} تعداد سالم ثبت نمی‌کند`);
    assert.match(refused.error, /ناظر کیفیت/, `${label} دلیلِ رد را می‌فهمد`);
  }
  assert.equal(deliver(store).code, 'FORBIDDEN', 'انباردار رسیدِ تحویل ثبت نمی‌کند');
  assert.equal(orderRow().items[0].quality, undefined, 'هیچ‌کدام از ردشده‌ها چیزی در قلم نگذاشت');
  assert.equal(orderRow().items[0].deliveries, undefined, 'رسیدِ تحویلِ ردشده هم ردیفی نساخت');
  assert.equal(b._db.get('SELECT count(*) n FROM invoice_billings').n, 0, 'درخواستِ ردشده ردیفِ دفتری هم ندارد');
  ok(quality(qc), 'ناظر کیفیت عددِ کنترل کیفیت را می‌نویسد');
  assert.equal(orderRow().items[0].quality.by.role, 'ناظر کیفیت', 'امضایِ رکورد همان نقش است');
  ok(deliver(manager), 'مدیر هم می‌تواند تحویل ثبت کند');
  /* بی‌مجوزِ تولید عدد ثبت نمی‌شود. */
  ok(b.set(manager, ORDERS, [...b.get(manager, ORDERS).value, {
    id: 'o2', orderNumber: '1002', customerId: 'c1', status: 'در انتظار تایید', quoteRev: 1,
    items: [{ id: 'i2', stage: 'ثبت سفارش', productName: 'بروشور', qty: 10, qtyUnit: 'نسخه', services: [] }], payments: [], history: [],
  }]), 'افزودنِ سفارشِ دوم');
  const tooEarly = b.orderAction(qc, 'o2', 'record_quality', { itemId: 'i2', good: 10 });
  assert.equal(tooEarly.ok, false);
  assert.match(tooEarly.error, /اجازهٔ معتبر مدیر/, 'بی‌مجوزِ تولید و بی‌تأیید مشتری، شمارهِ تولید ثبت نمی‌شود');
  assert.equal(b.orderAction(qc, 'o1', 'record_quality', { itemId: 'i9', good: 5 }).code, 'NOT_FOUND', 'قلمِ ناشناخته عدد نمی‌گیرد');
  /* سفارشِ دوم تأیید و مجوز می‌گیرد — با سندِ بدهی، چون سفارشِ اول هنوز فاکتور ندارد و
     تعهدِ باز دارد — و همان‌جا که در «ثبت سفارش» است، تحویلِ آن ثبت نمی‌شود. */
  ok(b.orderAction(clerk, 'o2', 'confirm_customer', { evidence: 'تأیید تلفنی مشتری' }));
  ok(b.orderAction(manager, 'o2', 'release_production', {
    materialReview: { checked: true, shortages: [] }, debtApproved: true, creditReason: 'مشتری تسویهٔ هفتهٔ آینده را کتباً متعهد شده است',
  }), 'مجوز تولیدِ سفارشِ دوم با سندِ بدهی');
  const wrongStage = b.orderAction(manager, 'o2', 'record_delivery', { itemId: 'i2', billable: 4 });
  assert.equal(wrongStage.ok, false);
  assert.match(wrongStage.error, /کنترل کیفیت یا تحویل/, 'تحویل پیش از مرحلهٔ تحویل ثبت نمی‌شود');
  assert.equal(JSON.parse(b._db.get('SELECT data FROM records WHERE collection = ? AND id = ?', ORDERS, 'o2').data).items[0].deliveries, undefined);
});

test('تعدادِ سالم یک‌بار ثبت می‌شود، تحویل از آن جلو نمی‌زند و صفر طلب نمی‌سازد', t => {
  const { clerk, qc, finance, quality, deliver, ok, orderRow } = fixture(t);
  assert.equal(quality(qc, { itemId: 'i1', good: -5 }).ok, false, 'تعدادِ منفی ثبت نمی‌شود');
  assert.equal(quality(qc, { itemId: 'i1', good: 1050.5 }).ok, false, 'عددِ کسری ثبت نمی‌شود');
  assert.equal(quality(qc, { itemId: 'i1', good: 'صد و پنج' }).ok, false, 'متنِ بی‌عدد ثبت نمی‌شود');
  assert.equal(orderRow().items[0].quality, undefined, 'ردیفِ ردشده چیزی در قلم نگذاشت');
  ok(quality());
  const twice = quality();
  assert.equal(twice.ok, false);
  assert.match(twice.error, /سند اصلاحی/, 'تغییرِ عددِ ثبت‌شده راهِ دیگری می‌خواهد (بند ۴)');
  assert.equal(orderRow().items[0].quality.good, 1050, 'کلیکِ دوباره عددِ پیشین را عوض نکرد');
  /* کنترلِ منفیِ دروازه: نقشِ دیگر حتی برای بازنویسیِ عددِ ثبت‌شده هم به خانهٔ «سالم» راه ندارد. */
  assert.equal(quality(finance, { itemId: 'i1', good: 999 }).code, 'FORBIDDEN', 'مدیر مالی عددِ ثبت‌شده را عوض نمی‌کند');
  assert.equal(orderRow().items[0].quality.good, 1050, 'ردِ بی‌مجوز، عددِ کنترل کیفیت را دست‌نخورده گذاشت');
  assert.equal(deliver(clerk, { itemId: 'i1', billable: 0 }).ok, false, 'تحویلِ صفر ریالی طلب نمی‌کند');
  const over = deliver(clerk, { itemId: 'i1', billable: 1051 });
  assert.equal(over.ok, false, 'جمعِ تحویل از سالمِ ثبت‌شده جلو نمی‌زند');
  assert.match(over.error, /تعداد سالم/);
  assert.equal(orderRow().items[0].deliveries, undefined, 'ردیفِ ردشده در قلم نمی‌نشیند');
  assert.equal(deliver(null, { itemId: 'i1', billable: 5 }).code, 'UNAUTHENTICATED', 'بی‌نشست عدد ثبت نمی‌شود');
});

test('پیشنهادِ سرور: ردیفِ ثابت یک‌بار، ردیفِ هر نسخه‌ای به نسبتِ تحویل — و بی‌تحویل هیچ', t => {
  const { b, finance, quality, deliver, ok } = fixture(t);
  const none = b.invoiceProposal(finance, 'o1');
  assert.equal(none.ok, true, none.error);
  assert.equal(none.canIssue, false, 'بی‌تحویلِ ثبت‌شده فاکتورِ تحویلی صادرشدنی نیست');
  assert.match(none.issueBlock, /تحویلِ ثبت‌شده/);
  assert.deepEqual(none.items.map(i => [i.ordered, i.good, i.delivered]), [[1000, null, 0]], '«سالمِ ثبت‌نشده» صفر نیست');
  assert.equal(none.rows.length, 3, 'سه ردیفِ ثابت مبنایِ مقیاس ندارند');
  assert.equal(b._db.get("SELECT count(*) n FROM financial_documents WHERE order_id = 'o1'").n, 0, 'خواندنِ پیشنهاد هیچ سندی نمی‌سازد');
  assert.equal(b._db.get('SELECT count(*) n FROM invoice_billings').n, 0, 'پیشنهادِ دیدنی ردیفِ دفتری نمی‌نویسد');
  assert.equal(none.contractMode, 'ثابت', 'حالتِ قرارداد از خودِ پیش‌فاکتورِ تأییدشده خوانده می‌شود');
  assert.equal(none.approvedTotal, APPROVED);
  ok(quality());
  ok(deliver());
  const proposal = b.invoiceProposal(finance, 'o1');
  assert.equal(proposal.canIssue, true, proposal.issueBlock);
  assert.equal(proposal.issueBlock, '');
  assert.deepEqual(proposal.rows.map(r => [r.lineId, r.qty, r.amount]), [
    ['m-paper', 600, 30000000], ['s-print', 600, 6600000], ['s-binding', 600, 3000000], ['s-zinc', 4, 8000000], ['s-cover', 50, 5000000],
  ]);
  assert.deepEqual(proposal.items.map(i => [i.ordered, i.good, i.delivered, i.remaining]), [[1000, 1050, 600, 400]]);
  assert.equal(proposal.totals.totalAmount, FIRST_INVOICE);
  assert.equal(proposal.totals.discountAmount, 881481, 'تخفیف به نسبتِ برشِ این صورتحساب کم می‌شود');
  assert.deepEqual(proposal.warnings, [], 'ردیف‌های وصل‌شده به قلم هشدار ندارند');
});

test('دفترِ صورتحساب: هر سند ردیف‌های خودش را ردیف‌به‌ردیف ثبت می‌کند', t => {
  const { b, finance, revision, quality, deliver, ledger, partial, ok } = fixture(t);
  ok(quality());
  ok(deliver());
  const one = partial();
  ok(one, 'صدورِ فاکتورِ تحویلیِ اول');
  const doc = one.document;
  assert.equal(doc.type, 'invoice', 'فاکتورِ تحویلی همان نوعِ فاکتور است، با حالتِ صورتحسابِ جدا');
  assert.equal(doc.snapshot.billingMode, 'partial');
  assert.equal(doc.snapshot.contractMode, 'ثابت');
  assert.equal(doc.quoteRevision, revision, 'سند به نسخهٔ فعلیِ پیش‌فاکتور گره می‌خورد');
  assert.equal(doc.snapshot.invoice.totals.total, FIRST_INVOICE, 'جمعِ سند همان برشِ این صورتحساب است');
  assert.deepEqual(doc.snapshot.invoice.rows.filter(r => !r.freeOffer).map(r => r.id).sort(),
    ['m-paper', 's-binding', 's-cover', 's-print', 's-zinc'], 'ردیف‌های پولیِ فاکتور همان پنج ردیف‌اند');
  assert.equal(doc.snapshot.invoice.rows.filter(r => r.freeOffer).length, 1, 'خطِ «طرح جلد — رایگان» روی فاکتورِ تحویلی می‌ماند');
  assert.equal(doc.snapshot.billedTotals.totalAmount, FIRST_INVOICE);
  assert.equal(doc.snapshot.cumulativeTotals.total, FIRST_INVOICE);
  assert.deepEqual(doc.snapshot.items.map(i => [i.ordered, i.good, i.delivered]), [[1000, 1050, 600]], 'اثرِ انگشتِ سه عدد در خودِ سند است');
  assert.deepEqual(doc.snapshot.deliveries.map(d => [d.itemId, d.billable]), [['i1', 600]]);
  assert.deepEqual(ledger(doc.id), [
    { lineId: 'm-paper', qty: 600, amount: 30000000 }, { lineId: 's-binding', qty: 600, amount: 3000000 },
    { lineId: 's-cover', qty: 50, amount: 5000000 }, { lineId: 's-print', qty: 600, amount: 6600000 }, { lineId: 's-zinc', qty: 4, amount: 8000000 },
  ], 'دفترِ صورتحساب ردیف‌به‌ردیف همان مبلغِ سند را نگه داشته است');
  assert.equal(b._db.get('SELECT SUM(amount) n FROM invoice_billings WHERE document_id = ?', doc.id).n, doc.snapshot.billedTotals.grossAmount, 'جمعِ دفتر = هزینهٔ این سند');
  const after = b.invoiceProposal(finance, 'o1');
  assert.equal(after.rows.length, 0, 'با همین تحویل، فاکتورِ تازه چیزی برای طلب ندارد');
  assert.equal(after.canIssue, false);
  assert.match(after.issueBlock, /همهٔ ردیف‌ها/);
  assert.equal(after.cumulative.total, FIRST_INVOICE);
  assert.deepEqual(after.invoices.map(i => [i.billingMode, i.total]), [['partial', FIRST_INVOICE]]);
});

test('بی‌تحویلِ ثبت‌شده فاکتورِ تحویلی صادر نمی‌شود (ردیفِ ثابت پولِ تنها نمی‌سازد)', t => {
  const { b, finance, partial, docsFor, ok } = fixture(t);
  const first = partial();
  assert.equal(first.ok, false);
  assert.match(first.error, /تحویلِ ثبت‌شده/);
  assert.deepEqual(docsFor('o1'), [], 'سندِ ردشده در بانک ننشسته است');
  assert.equal(b._db.get('SELECT count(*) n FROM invoice_billings').n, 0, 'دفترِ صورتحساب هم ردیفی نگرفته است');
  /* فاکتورِ کامل همان سفارش در همان وضعیت می‌نشیند — راهِ امروز برای تحویلِ بی‌عدد. */
  const full = ok(b.documentAction(finance, 'o1', 'issue_invoice'), 'فاکتورِ کامل بی‌تحویل');
  assert.equal(full.document.snapshot.billingMode, 'full');
  assert.equal(full.document.snapshot.invoice.totals.total, APPROVED);
});

test('فاکتور دوم فقط باقی‌مانده را می‌گیرد و جمعِ جزئی‌ها سر به سر مبلغِ تأییدشده است', t => {
  const { b, finance, quality, deliver, ledger, ledgerTotal, partial, ok } = fixture(t);
  ok(quality());
  ok(deliver());
  const one = ok(partial(), 'فاکتورِ اول').document;
  ok(deliver(finance, { itemId: 'i1', billable: 400 }));
  const two = ok(partial(), 'فاکتورِ دوم').document;
  assert.deepEqual(ledger(two.id).map(r => [r.lineId, r.qty, r.amount]), [['s-binding', 400, 2000000], ['s-print', 400, 4400000]],
    'کاغذ/زینک/جلد که یک‌بار طلب شده‌اند دوباره نمی‌آیند');
  assert.equal(two.snapshot.invoice.totals.total, SECOND_INVOICE);
  assert.equal(two.snapshot.billedTotals.grossAmount, 6400000);
  assert.equal(two.snapshot.cumulativeTotals.total, APPROVED, 'انباشتهٔ دو فاکتور دقیقاً مبلغِ تأییدشده است');
  assert.equal(ledgerTotal('o1'), 59000000, 'جمعِ ردیف‌های دفتر = جمعِ ردیف‌های پیش‌فاکتور، نه بیشتر');
  assert.equal(b._db.get("SELECT count(*) n FROM invoice_billings WHERE order_id='o1'").n, 7, 'پنج ردیفِ اول + دو ردیفِ دوم');
  assert.notEqual(one.number, two.number, 'دو سندِ دو شماره');
  const third = partial();
  assert.equal(third.ok, false);
  assert.match(third.error, /همهٔ ردیف‌ها/, 'فاکتورِ سوم چیزی برای طلب ندارد');
  /* تحویلِ اضافه (۵۰ نسخهٔ بیشتر از سفارش) در حالتِ «ثابت» ریالی اضافه نمی‌سازد. */
  ok(b.orderAction(finance, 'o1', 'record_delivery', { itemId: 'i1', billable: 50 }));
  assert.equal(b.invoiceProposal(finance, 'o1').rows.length, 0, 'در حالت ثابت، تحویلِ بیشتر از سفارش طلبِ تازه نمی‌سازد');
});

test('در حالت «تعداد واقعی» تحویلِ ۱۰۲۰ نرخِ خودش را طلب می‌کند و از مبلغِ تأییدشده جلو می‌زند', t => {
  const { b, finance, manager, qc, revision, docsFor, ok } = fixture(t, { legacy: false, contractMode: 'تعداد واقعی' });
  assert.equal(b.invoiceProposal(finance, 'o1').contractMode, 'تعداد واقعی');
  ok(b.orderAction(qc, 'o1', 'record_quality', { itemId: 'i1', good: 1050 }));
  ok(b.orderAction(manager, 'o1', 'record_delivery', { itemId: 'i1', billable: 1020 }));
  const proposal = b.invoiceProposal(finance, 'o1');
  assert.equal(proposal.canIssue, true, proposal.issueBlock);
  assert.deepEqual(proposal.rows.map(r => [r.lineId, r.qty, r.amount]), [
    ['m-paper', 600, 30000000], ['s-print', 1020, 11220000], ['s-binding', 1020, 5100000], ['s-zinc', 4, 8000000], ['s-cover', 50, 5000000],
  ], 'در این حالت تحویلِ بیشتر از سفارش نرخِ خودش را می‌گیرد');
  assert.equal(proposal.totals.totalAmount, REAL_COUNT_TOTAL);
  assert.equal(proposal.totals.totalAmount > APPROVED, true, 'سقفِ این حالت مبلغِ تأییدشده نیست');
  const issued = ok(b.documentAction(finance, 'o1', 'issue_partial_invoice'), 'صدورِ فاکتور در حالت تعداد واقعی');
  assert.equal(issued.document.snapshot.contractMode, 'تعداد واقعی');
  assert.equal(issued.document.quoteRevision, revision, 'سند به نسخهٔ پیش‌فاکتورِ فعلی گره می‌خورد');
  assert.equal(docsFor('o1').length, 1, 'یک فاکتورِ زنده در بانک است');
  /* بیست نسخهٔ تازه، فاکتورِ دوم می‌سازد (نه ویرایشِ فاکتورِ پیشین). */
  ok(b.orderAction(manager, 'o1', 'record_delivery', { itemId: 'i1', billable: 20 }));
  const next = b.invoiceProposal(finance, 'o1');
  assert.equal(next.rows.length, 2, 'فقط ردیف‌های هر‌نسخه‌ای دوباره طلب می‌شوند');
  assert.equal(next.rows.reduce((sum, r) => sum + r.amount, 0), 320000, 'چاپ ۲۲۰٬۰۰۰ + صحافی ۱۰۰٬۰۰۰');
  assert.equal(next.cumulative.total, REAL_COUNT_CUM_1040);
});

test('فاکتورِ کامل روی نسخه‌ای که فاکتور تحویلی خورده رد می‌شود (کنترلِ دوبار‌طلبی)', t => {
  const { b, finance, quality, deliver, partial, docsFor, ok } = fixture(t);
  ok(quality());
  ok(deliver());
  ok(partial());
  const full = b.documentAction(finance, 'o1', 'issue_invoice');
  assert.equal(full.ok, false);
  assert.match(full.error, /همان ردیف‌ها را دوباره می‌طلبد/);
  assert.equal(docsFor('o1').length, 1, 'سندِ ردشده در بانک ننشسته است');
  /* دوبارِ «فاکتور تحویلی» با همان تحویل هم چیزی اضافه نمی‌کند. */
  const again = partial();
  assert.equal(again.ok, false);
  assert.match(again.error, /همهٔ ردیف‌ها/);
});

test('هیچ رقمِ دستِ client در سند نمی‌نشیند و دروازهٔ مبلغ بسته است', t => {
  const { b, finance, clerk, store, manager, quality, deliver, ok } = fixture(t);
  ok(quality());
  ok(deliver());
  for (const key of ['rows', 'amount', 'totals', 'invoice']) {
    const answer = b.documentAction(finance, 'o1', 'issue_partial_invoice', { [key]: key === 'amount' ? 1 : [] });
    assert.equal(answer.ok, false, `کلید «${key}» در درخواست سند پذیرفته شد`);
    assert.match(answer.error, /سرور می‌سازد/);
  }
  assert.equal(b.documentAction(finance, 'o1', 'issue_unknown_action', {}).ok, false);
  /* تحویلِ جعلی هم منبع پول نمی‌شود: از مسیرِ ذخیرهٔ سفارش رد است. */
  const tampered = b.get(manager, ORDERS).value;
  tampered[0].items[0].deliveries = [{ id: 'x1', billable: 999999, at: '2026-11-03', note: '', by: { id: 'x', name: 'x', role: 'x' } }];
  assert.equal(b.set(manager, ORDERS, tampered).ok, false, 'ایستگاه نمی‌تواند تحویلِ جعلی بنویسد تا فاکتورِ بزرگ‌تر بسازد');
  assert.equal(b.documentAction(clerk, 'o1', 'issue_partial_invoice').code, 'FORBIDDEN', 'کارشناس سفارشات سند صادر نمی‌کند');
  assert.equal(b.documentAction(store, 'o1', 'issue_invoice').code, 'FORBIDDEN');
  assert.equal(b.invoiceProposal(clerk, 'o1').code, 'FORBIDDEN', 'پیشنهاد صورتحساب فقط مدیر و مالی است');
  assert.equal(b.invoiceProposal(store, 'o1').code, 'FORBIDDEN');
  assert.equal(b.invoiceProposal(finance, 'o-legacy').code, 'NOT_FOUND', 'سفارشِ بی‌رکورد پیشنهاد ندارد');
  assert.equal(b.invoiceProposal(finance, '').ok, false);
  assert.equal(b.invoiceProposal(finance, 'x'.repeat(65)).ok, false);
  assert.equal(b.invoiceProposal('nope', 'o1').code, 'UNAUTHENTICATED', 'بی‌نشست پیشنهاد خوانده نمی‌شود');
  assert.equal(JSON.stringify(b.get(clerk, ORDERS).value).includes(String(APPROVED)), false, 'پاک‌سازیِ مبلغ برای نقشِ بی‌دسترسی هنوز کار می‌کند');
});

test('ابطالِ فاکتورِ تحویلی ردیف‌هایش را از سقفِ امروز بیرون می‌برد و شماره‌اش بازنشر نمی‌شود', t => {
  const { b, finance, quality, deliver, partial, docsFor, ledgerTotal, ok } = fixture(t);
  ok(quality());
  ok(deliver());
  const one = ok(partial(), 'فاکتورِ اول').document;
  ok(deliver(finance, { itemId: 'i1', billable: 400 }));
  const two = ok(partial(), 'فاکتورِ دوم').document;
  assert.equal(b.invoiceProposal(finance, 'o1').rows.length, 0);
  ok(b.documentAction(finance, 'o1', 'void', { documentId: two.id, reason: 'عددِ تحویل اشتباه ثبت شد' }));
  const after = b.invoiceProposal(finance, 'o1');
  assert.equal(after.invoices.length, 1, 'سندِ باطل از فهرستِ فاکتورهای زنده بیرون رفت');
  assert.equal(after.rows.length, 2, 'باقی‌ماندهٔ همان دو ردیف دوباره قابل طلب است');
  assert.equal(after.rows.reduce((sum, r) => sum + r.amount, 0), 6400000);
  assert.equal(after.totals.totalAmount, SECOND_INVOICE, 'برشِ تازه همان جایِ خالیِ سندِ باطل را می‌گیرد');
  assert.equal(after.cumulative.total, APPROVED, 'مبنایِ انباشته از تعدادِ تحویل خوانده می‌شود، نه از اسناد');
  assert.equal(b._db.get('SELECT count(*) n FROM invoice_billings').n, 7, 'ردیفِ دفترِ سندِ باطل پاک نمی‌شود؛ زنده‌بودن از خودِ سند خوانده می‌شود');
  const three = ok(partial(), 'پس از ابطال، همان برش دوباره طلب می‌شود');
  assert.equal(three.document.snapshot.invoice.totals.total, SECOND_INVOICE);
  assert.notEqual(three.document.number, two.number, 'شمارهٔ سندِ باطل بازنشر نمی‌شود');
  const numbers = docsFor('o1').map(d => d.number);
  assert.equal(new Set(numbers).size, 3, 'سه سند، سه شماره');
  assert.equal(b._db.get("SELECT count(*) n FROM numbering_reservations WHERE type = 'invoice'").n, 3, 'هر شماره یک بار رزرو شده است');
  assert.equal(b.documents(finance).documents.filter(d => d.orderId === 'o1').length, 3);
  assert.equal(ledgerTotal('o1'), 65400000, 'دفتر سه سند را نگه داشته است، باطلِ خود را هم');
  assert.equal(one.snapshot.invoice.totals.total, FIRST_INVOICE, 'سندِ زندهٔ اول دست نخورد');
});

test('پروندهٔ اعتباری، چند فاکتورِ یک سفارش را جمع می‌کند نه آخرین را', t => {
  const { b, manager, finance, quality, deliver, partial, ok } = fixture(t);
  ok(quality());
  ok(deliver());
  const one = ok(partial(), 'فاکتورِ اول').document;
  ok(deliver(finance, { itemId: 'i1', billable: 400 }));
  const two = ok(partial(), 'فاکتورِ دوم').document;
  const file = b.customerCreditFile(manager, { customerId: 'c1' });
  ok(file, 'پروندهٔ اعتباری');
  const line = file.file.lines.find(l => l.orderId === 'o1');
  assert.equal(line.kind, 'definite', 'با فاکتورِ صادرشده، بدهی قطعی است');
  assert.equal(line.payable, APPROVED, 'بدهیِ قطعی = جمعِ دو فاکتورِ زنده، نه مبلغِ آخرین');
  assert.equal(line.open, APPROVED, 'بی‌پرداختی، کلِ صورتحساب باز است');
  assert.equal(line.documentId, two.id, 'تخصیصِ وجه به آخرین سندِ صادرشده گره می‌خورد');
  assert.match(line.source, /۱ فاکتور تحویلی/, 'منشأِ مبلغ تعدادِ فاکتورهای تحویلی را نشان می‌دهد');
  assert.equal(file.file.definiteDebt, APPROVED, 'جمعِ پرونده هم از همان یک منبع می‌آید');
  /* سندِ باطل بدهی نمی‌سازد. */
  ok(b.documentAction(finance, 'o1', 'void', { documentId: two.id, reason: 'تعدادِ تحویل اشتباه بود' }));
  const voided = b.customerCreditFile(manager, { customerId: 'c1' }).file;
  assert.equal(voided.definiteDebt, FIRST_INVOICE, 'بدهی به اندازهٔ سندِ باطل کم می‌شود');
  assert.equal(voided.lines.find(l => l.orderId === 'o1').documentId, one.id, 'سندِ هدفِ تخصیص به فاکتورِ زنده برمی‌گردد');
});

test('تخصیصِ وجه فقط به فاکتورِ صادرشدهٔ همان سفارش می‌نشیند', t => {
  const { b, finance, quality, deliver, partial, ok } = fixture(t);
  ok(quality());
  ok(deliver());
  const one = ok(partial(), 'فاکتورِ تحویلی').document;
  const receipt = documentId => b.recordReceipt(finance, {
    customerId: 'c1', orderId: 'o1', amount: 5000000, method: 'نقد',
    allocations: [{ orderId: 'o1', documentId, amount: 5000000 }],
  });
  ok(receipt(one.id), 'رسید با تخصیص به فاکتورِ زنده');
  /* کنترل منفی: شناسهٔ سندی که برای این سفارش صادر نشده. */
  const invented = receipt('doc_ghost');
  assert.equal(invented.ok, false);
  assert.match(invented.error, /با فاکتورهای صادرشده/);
  const otherOrder = receipt('doc_legacy_invoice');
  assert.equal(otherOrder.ok, false, 'فاکتورِ سفارشِ دیگر پذیرفته نمی‌شود');
  assert.equal(b._db.get('SELECT count(*) n FROM receipts').n, 1, 'رسیدِ ردشده در دفترِ پول ننشسته است');
  const line = b.customerCreditFile(finance, { customerId: 'c1' }).file.lines.find(l => l.orderId === 'o1');
  assert.equal(line.open, FIRST_INVOICE - 5000000, 'مانده به اندازهٔ تخصیصِ همان رسید کم می‌شود');
});
