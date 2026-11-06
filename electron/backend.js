'use strict';
/* هسته‌ی داده و امنیت (فرایند اصلی Electron، نه صفحه‌ی وب):
   - پایگاه‌داده‌ی SQLite (هر رکورد یک ردیف، ایندکس‌دار، آماده برای حجم بالا) به‌جای یک فایل JSON
   - ورود با رمز scrypt + قفل موقت بعد از چند بار رمز اشتباه، نشست‌ها با توکن تصادفی
   - کنترل دسترسی بر اساس نقش *همین‌جا* (نه فقط در رابط کاربری) + حذف فیلدهای مالی از داده‌ی نقش‌های غیرمالی
   - جلوگیری از پاک‌شدن رکوردهایی که نفر دیگری بعد از آخرین خواندنِ شما ثبت کرده (مثلاً درخواست تازه‌ی مشتری)
   - دفتر ثبت وقایع (audit log) برای نوشتن/حذف و ورود */
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { schemas: catalogSchemas, prepareCatalogImport } = require('./catalog-transfer.js');
const coa = require('./coa.js');
/* اصلاحات ۱۷/بند ۱: پروندهٔ اعتباری و قاعدهٔ یکتای بدهی — ماژول پاک، همان‌جا که coa هم پاک است. */
const credit = require('./credit.js');
/* اصلاحات ۱۷/بند ۲: رسید وصول‌شونده و تخصیص وجه — ماژول پاک؛ جدول‌ها را همین فایل پر می‌کند.
   نام «receiptEngine» است چون در همین فایل رسیدِ کالای امانی هم محلی با نام receipts دارد. */
const receiptEngine = require('./receipts.js');
/* اصلاحات ۱۷/بند ۳: صورتحسابِ جزئی بر مبنای مقدارِ تحویلی — ماژول پاک؛ عددها را همین فایل
   از جدول‌ها می‌خواند و مبلغ را همان‌جا می‌نویسد. ایستگاه هرگز رقمِ سند را نمی‌فرستد. */
const billingEngine = require('./billing.js');

const M = 'مدیر چاپخانه', C = 'کارشناس سفارشات', S = 'انباردار', F = 'مدیر مالی', CUS = 'مشتری', QC = 'ناظر کیفیت';
const SUP = ['سرپرست لیتوگرافی', 'سرپرست چاپ دیجیتال', 'سرپرست چاپ', 'سرپرست صحافی'];
const STAFF = [M, C, S, F, QC, ...SUP];
const REQUEST_STATUS = 'درخواست مشتری';

/* خواندن/نوشتن هر کلید برای هر نقش. کلیدی که اینجا نباشد برای همه ممنوع است. */
const ACCESS = {
  /* انباردار خواننده است: نوشتن سفارش‌ها را ندارد و چون در FULL_MONEY نیست،
     redactOrders همهٔ مبالغ را پیش از رسیدن به او پاک می‌کند. */
  printshop_orders_v5: { r: [M, C, F, S, QC, ...SUP], w: [M, C, F] },
  printshop_customers_v2: { r: STAFF, w: [M, C, S] },
  printshop_inventory_v3: { r: STAFF, w: [M, S] },
  printshop_inv_categories: { r: STAFF, w: [M, S] },
  printshop_suppliers_v2: { r: [M, F, S], w: [M, F, S] },
  printshop_receipts_v1: { r: [M, F, S], w: [M, F, S] },
  /* بند ۵/الف: رسید «تحویل کالا از مشتری». نوشتن فقط از مسیر خودِ سرور مجاز است
     (w: []) تا ساعت و تحویل‌گیرنده را هیچ ایستگاهی نتواند دست‌کاری کند. */
  printshop_consignments_v1: { r: [M, F, S, CUS], w: [] },
  printshop_units_v1: { r: [M, F, C], w: [M] },
  printshop_settings_v1: { r: STAFF, w: [M] },
  printshop_ai_v1: { r: STAFF, w: [M] },
  printshop_marketer_pay_v1: { r: [M, F], w: [M, F] },
  printshop_letters_v1: { r: STAFF, w: STAFF },
  printshop_documents_v1: { r: [M, F], w: [] },
  printshop_manager_pin: { r: [M], w: [M] },
  printshop_product_types: { r: STAFF, w: [M, C, S, F] },
  printshop_qty_units: { r: STAFF, w: [M, C, S, F] },
  printshop_service_types: { r: STAFF, w: [M, C, S, F] },
  printshop_binding_types: { r: STAFF, w: [M, C, S, F] },
  printshop_paper_kinds: { r: STAFF, w: [M, C, S, F] },
  printshop_book_like_types: { r: STAFF, w: [M] },
  printshop_trim_sizes: { r: STAFF, w: [M] },
  printshop_print_colors: { r: STAFF, w: [M] },
  printshop_engine_cuts: { r: STAFF, w: [M] },
  printshop_engine_presses: { r: STAFF, w: [M] },
};
const FULL_MONEY = [M, F];

/* ---------- رمز ---------- */
function legacyHash(p) { // همان تابع قدیمیِ رابط کاربری؛ فقط برای ورود اولِ کاربران قدیمی و ارتقا به scrypt
  let h1 = 0xdeadbeef ^ 7, h2 = 0x41c6ce57 ^ 7;
  const str = 'ps|' + String(p);
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'h' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function scryptHash(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  return crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function safeEq(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }

/* ---------- آداپتور SQLite (better-sqlite3 در برنامه؛ node:sqlite برای آزمایش) ---------- */
function adapt(raw, kind) {
  if (kind === 'better') {
    return { exec: (sql) => raw.exec(sql), run: (sql, ...p) => raw.prepare(sql).run(...p), get: (sql, ...p) => raw.prepare(sql).get(...p), all: (sql, ...p) => raw.prepare(sql).all(...p), tx: (fn) => raw.transaction(fn)(), close: () => raw.close() };
  }
  return {
    exec: (sql) => raw.exec(sql), run: (sql, ...p) => raw.prepare(sql).run(...p), get: (sql, ...p) => raw.prepare(sql).get(...p), all: (sql, ...p) => raw.prepare(sql).all(...p),
    tx: (fn) => { raw.exec('BEGIN'); try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { try { raw.exec('ROLLBACK'); } catch (_) { /* ignore */ } throw e; } },
    close: () => raw.close(),
  };
}
function openSqlite(file) {
  let err1 = null;
  try { const Database = require('better-sqlite3'); const raw = new Database(file); raw.pragma('journal_mode = WAL'); raw.pragma('synchronous = NORMAL'); return adapt(raw, 'better'); } catch (e) { err1 = e; }
  try { const { DatabaseSync } = require('node:sqlite'); const raw = new DatabaseSync(file); raw.exec('PRAGMA journal_mode = WAL'); return adapt(raw, 'node'); } catch (e2) { throw new Error(`SQLite در دسترس نیست (${err1 && err1.message}) / (${e2.message})`); }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (collection, id));
CREATE INDEX IF NOT EXISTS idx_records_collection_ord ON records (collection, ord);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kinds (key TEXT PRIMARY KEY, kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, role TEXT NOT NULL, customer_id TEXT, station TEXT, pass_hash TEXT, salt TEXT, legacy_hash TEXT, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user_id TEXT, user_name TEXT, role TEXT, action TEXT NOT NULL, target TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS order_events (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, ts INTEGER NOT NULL, record TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, ts);
CREATE TABLE IF NOT EXISTS notification_outbox (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, record TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_reads (notification_id TEXT NOT NULL, user_id TEXT NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY(notification_id, user_id));
CREATE TABLE IF NOT EXISTS numbering_reservations (type TEXT NOT NULL, number TEXT NOT NULL, serial INTEGER NOT NULL, record_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(type,number), UNIQUE(type,record_id));
CREATE TABLE IF NOT EXISTS financial_documents (id TEXT PRIMARY KEY, type TEXT NOT NULL, order_id TEXT NOT NULL, quote_revision INTEGER NOT NULL, number TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(type,number));
CREATE INDEX IF NOT EXISTS idx_financial_documents_order ON financial_documents (order_id, type, status);
CREATE TABLE IF NOT EXISTS order_reset_tombstones (id TEXT PRIMARY KEY, reset_id TEXT NOT NULL, ts INTEGER NOT NULL);
/* اصلاحات ۱۷/بند ۰: ستون فقرات دفترکل. این سه جدول real هستند، پس قیدهای SQLite در آنها
   معنا دارد (خلاف جدول records که هر چیز یک blob است). امروز هیچ سندی در آنها نوشته نمی‌شود:
   status پیش‌فرض 'draft' است و نگاشت رویدادها تا تأیید کارفرما فقط نمایش داده می‌شود. */
CREATE TABLE IF NOT EXISTS accounts (code TEXT PRIMARY KEY, title TEXT NOT NULL, group_title TEXT NOT NULL, nature TEXT NOT NULL CHECK(nature IN ('بدهکار','بستانکار')), source TEXT NOT NULL, approved_at INTEGER);
CREATE TABLE IF NOT EXISTS journal_entries (id TEXT PRIMARY KEY, entry_date TEXT NOT NULL, event TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, order_id TEXT, customer_id TEXT, supplier_id TEXT, description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0), currency TEXT NOT NULL DEFAULT 'IRR', status TEXT NOT NULL CHECK(status IN ('draft','posted','corrected')) DEFAULT 'draft', corrects TEXT, created_at INTEGER NOT NULL, created_by TEXT NOT NULL, UNIQUE(source_type, source_id, event));
CREATE TABLE IF NOT EXISTS journal_lines (entry_id TEXT NOT NULL REFERENCES journal_entries(id), position INTEGER NOT NULL, account_code TEXT NOT NULL REFERENCES accounts(code), side TEXT NOT NULL CHECK(side IN ('dr','cr')), amount INTEGER NOT NULL CHECK(amount >= 0), expression TEXT NOT NULL, PRIMARY KEY (entry_id, position));
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines (account_code, side);
CREATE INDEX IF NOT EXISTS idx_journal_entries_event ON journal_entries (event, entry_date);
/* اصلاحات ۱۷/بند ۱: پروندهٔ اعتباری مشتری. سیاست اعتبار (سقف/مهلت/درصد هشدار) و
   مجوز استثنایی مدیر دو جدول real هستند تا قیدها معنا داشته باشند: مبلغ نمی‌تواند منفی
   باشد، مهلت نمی‌تواند خارج از بازهٔ منطقی باشد، و یک مجوز هیچ‌وقت حذف نمی‌شود —
   نسخهٔ جدید آن جای قبلی را «جایگزین‌شده» می‌کند و هر دو ردیف در بانک می‌مانند. */
CREATE TABLE IF NOT EXISTS credit_policies (customer_id TEXT PRIMARY KEY, ceiling INTEGER NOT NULL DEFAULT 0 CHECK(ceiling >= 0), term_days INTEGER NOT NULL DEFAULT 0 CHECK(term_days >= 0 AND term_days <= 3650), warn_percent INTEGER NOT NULL DEFAULT 80 CHECK(warn_percent BETWEEN 1 AND 100), note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_approvals (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, order_id TEXT NOT NULL, quote_revision INTEGER, ceiling INTEGER NOT NULL CHECK(ceiling >= 0), open_total INTEGER NOT NULL CHECK(open_total >= 0), definite_debt INTEGER NOT NULL CHECK(definite_debt >= 0), overdue_debt INTEGER NOT NULL CHECK(overdue_debt >= 0), commitment INTEGER NOT NULL CHECK(commitment >= 0), advance INTEGER NOT NULL CHECK(advance >= 0), over_by INTEGER NOT NULL CHECK(over_by >= 0), reason TEXT NOT NULL CHECK(length(reason) >= 10 AND length(reason) <= 2000), state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','superseded')), superseded_by TEXT, decided_at INTEGER NOT NULL, decided_by TEXT NOT NULL, decided_role TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_credit_approvals_order ON credit_approvals (order_id, state);
CREATE INDEX IF NOT EXISTS idx_credit_approvals_customer ON credit_approvals (customer_id, state, decided_at);
/* قاعده‌ای که واقعاً لازم است: روی هر سفارش فقط یک مجوز «فعال» می‌ماند. تاریخچه نامحدود است
   و ردیف جایگزین‌شده هیچ‌وقت حذف نمی‌شود، پس یکتا بودنِ (سفارش، زمان، تصمیم‌گیرنده) نه لازم بود
   و نه درست — تصمیمِ دومِ مدیر در همان میلی‌ثانیه خطای بانک می‌داد. */
CREATE UNIQUE INDEX IF NOT EXISTS ux_credit_approvals_active ON credit_approvals (order_id) WHERE state = 'active';
/* اصلاحات ۱۷/بند ۲: رسید وجه و تخصیص آن. نام جدول «receipts» طبق سند کارفرماست و با
   رسیدِ تحویل کالای امانی (کلید printshop_receipts_v1) اشتباه نشود: این جدول پول است، نه کالا.
   قاعدهٔ یکتای «پولِ دریافتی»: ردیفِ داخل آرایهٔ paymentsِ سفارش دیگر منبع عدد نیست؛
   این جدول منبع است و payments بازتابِ سرور می‌شود. قیدهای SQLite مبلغِ مثبت، وضعیتِ شناخته‌شده
   و یکتا بودنِ شماره را نگه می‌دارند؛ ردیفِ مهاجرت‌شده با legacy_payment_id هیچ‌وقت دوباره
   مهاجرت نمی‌شود (indexِ یکتای جزئی). */
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL DEFAULT '', order_id TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL CHECK(length(method) BETWEEN 1 AND 40),
  amount INTEGER NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL CHECK(status IN ('held','in_transit','cleared','bounced','void')),
  received_at TEXT NOT NULL CHECK(length(received_at) = 10),
  cheque_number TEXT NOT NULL DEFAULT '', cheque_bank TEXT NOT NULL DEFAULT '', cheque_branch TEXT NOT NULL DEFAULT '', cheque_due TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', legacy_payment_id TEXT NOT NULL DEFAULT '', opening INTEGER NOT NULL DEFAULT 0 CHECK(opening IN (0,1)),
  created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  cleared_at TEXT NOT NULL DEFAULT '', voided_by TEXT, void_reason TEXT NOT NULL DEFAULT '', voided_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_receipts_legacy ON receipts (order_id, legacy_payment_id) WHERE legacy_payment_id <> '';
CREATE INDEX IF NOT EXISTS idx_receipts_customer ON receipts (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_receipts_order ON receipts (order_id);
CREATE TABLE IF NOT EXISTS receipt_allocations (
  id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id),
  order_id TEXT NOT NULL, document_id TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK(amount > 0),
  kind TEXT NOT NULL CHECK(kind IN ('definite','committed')), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_receipt ON receipt_allocations (receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_allocations_order ON receipt_allocations (order_id, document_id);
`;

/* اصلاحات ۱۷/بند ۳: دفترِ صورتحساب. جایِ کلیدِ یکتای قدیمیِ «سند» (سفارش، نسخهٔ پیش‌فاکتور، نوع)
   را این جدول می‌گیرد: هر ردیفِ پیش‌فاکتور در هر سندِ فاکتور یک‌بار طلب می‌شود
   (PRIMARY KEY(document_id,line_id)) و ردیفِ جدید چیزی جز باقی‌ماندهٔ موتور صورتحساب نیست.
   پس یک نسخهٔ پیش‌فاکتور می‌تواند چند فاکتورِ تحویلی داشته باشد، ولی هیچ ریالی دوبار طلب
   نمی‌شود و از هر رقمِ فاکتور می‌توان به ردیفِ پیش‌فاکتور و قلمِ سفارش رسید.
   این جدول پس از مهاجرتِ جدول اسناد ساخته می‌شود (پیش از آن نامِ جدول اسناد عوض می‌شود). */
const SCHEMA_BILLING = `
CREATE TABLE IF NOT EXISTS invoice_billings (
  document_id TEXT NOT NULL, line_id TEXT NOT NULL, order_id TEXT NOT NULL, quote_revision INTEGER NOT NULL,
  item_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('materials','services')),
  qty INTEGER NOT NULL CHECK(qty >= 0), amount INTEGER NOT NULL CHECK(amount >= 0), created_at INTEGER NOT NULL,
  PRIMARY KEY(document_id,line_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_billings_line ON invoice_billings (order_id, quote_revision, line_id);
/* بازسازیِ جدول اسناد با DROP TABLE همهٔ نماهای آن را هم می‌برد، پس این نمایِ همانِ
   جدول اینجا دوباره کاشته می‌شود (برای بانکِ تازه IF NOT EXISTS بی‌اثر است). */
CREATE INDEX IF NOT EXISTS idx_financial_documents_order ON financial_documents (order_id, type, status);
`;

/* ---------- حذف فیلدهای مالی از داده‌ی نقش‌هایی که نباید مبلغ ببینند ---------- */
function redactOrders(arr) {
  return arr.map(o => {
    const { payments, discount, shippingCost, otherCost, vatPercent, pricing, quoteHistory, ...rest } = o;
    // Legacy free-text history can contain arbitrary financial amounts. Keep
    // classified operations and exact known legacy messages; fail closed on others.
    const safeLegacy = new Set(['ویرایش مشخصات سفارش', 'درخواست سفارش توسط مشتری ثبت شد', 'تبدیل درخواست مشتری به سفارش — منتظر قیمت‌گذاری و تایید', 'ثبت سفارش — معلق تا تامین مواد', 'ثبت سفارش — منتظر قیمت‌گذاری و تایید مشتری', 'بازگشایی از بایگانی — پیش‌فاکتور جدید']);
    const workflow = o.workflow ? { ...o.workflow, cancellationSettlement: o.workflow.cancellationSettlement ? { settled: true, at: o.workflow.cancellationSettlement.at, revision: o.workflow.cancellationSettlement.revision } : undefined } : undefined;
    return { ...rest, ...(workflow ? { workflow } : {}), history: (o.history || []).filter(h => h.visibility === 'operational' || (!h.visibility && safeLegacy.has(h.text))), payments: [], discount: '', items: (o.items || []).map(it => { const { unitPrice, designPrice, ...r } = it; return { ...r, unitPrice: '', designPrice: '', services: (it.services || []).map(s => ({ ...s, price: '' })) }; }) };
  });
}
function redactInventory(arr) { return arr.map(i => ({ ...i, unitValue: '' })); }
function redactUnits(u) {
  if (!u || typeof u !== 'object') return u;
  const out = {};
  Object.keys(u).forEach(k => {
    const sec = u[k] || {};
    out[k] = { ...sec,
      items: (sec.items || []).map(e => ({ ...e, rate: '', setup: '', minCharge: '', formula: '', tiers: [], coverTiers: [], components: (e.components || []).map(c => ({ ...c, price: '' })) })),
      outsource: (sec.outsource || []).map(p => ({ ...p, rate: '', setup: '', formula: '' })) };
  });
  return out;
}
function redactSettings(s) {
  if (!s || typeof s !== 'object') return s;
  const calc = { ...(s.calc || {}), plateCostFallback: 0, printRatePer1000: 0, digitalRatePerSide: 0, cellophaneRate: {}, bindingRates: {}, marginPercent: 0 };
  return { ...s, calc };
}

function createBackend({ dataDir, legacyJsonFile, openDb = openSqlite, now = () => Date.now() }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'printshop.db');
  const db = openDb(dbFile);
  db.exec(SCHEMA);
  /* بانک‌هایی که پیش از این ساخته شده‌اند ستون نسخه ندارند. ALTER TABLE آن را با
     مقدار ۱ پر می‌کند، پس هر رکورد موجود دست‌کم یک نسخه دارد و مقایسه معنا دارد. */
  for (const table of ['records', 'kv']) {
    if (!db.all(`PRAGMA table_info(${table})`).some(c => c.name === 'rev')) db.exec(`ALTER TABLE ${table} ADD COLUMN rev INTEGER NOT NULL DEFAULT 1`);
  }
  /* بند ت: نام ایستگاه روی خودِ حساب می‌نشیند. بانک‌های قدیمی این ستون را ندارند و
     مقدار خالی معنایش «ایستگاه نام‌گذاری نشده» است، نه ایستگاه بی‌نام. */
  if (!db.all('PRAGMA table_info(users)').some(c => c.name === 'station')) db.exec('ALTER TABLE users ADD COLUMN station TEXT');
  /* اصلاحات ۱۷/بند ۳: بانک‌های قدیمی جدول اسناد را با قیدِ «یک سند به ازای هر
     (سفارش، نسخهٔ پیش‌فاکتور، نوع)» ساخته‌اند؛ با آن قید دو فاکتورِ تحویلی روی یک نسخه
     خطایِ بانک می‌دهد. SQLite قیدِ درونِ CREATE TABLE را با ALTER TABLE نمی‌شکند، پس
     جدول بازسازی می‌شود: همان ستون‌ها و همان ردیف‌ها، بدون آن قید. UNIQUE(type,number)
     می‌ماند — شمارهٔ سند یکتاست — و نگهبانِ «صورتحسابِ دوبار» دفترِ صورتحساب می‌شود.
     اجرای دوبارهٔ برنامه روی بانکِ تازه‌شده هیچ کاری نمی‌کند (سنجش از متنِ خودِ جدول). */
  const documentsSql = (db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='financial_documents'") || {}).sql || '';
  if (documentsSql.includes('UNIQUE(order_id,quote_revision,type)')) {
    db.tx(() => {
      db.exec(`CREATE TABLE financial_documents_rebuilt (id TEXT PRIMARY KEY, type TEXT NOT NULL, order_id TEXT NOT NULL, quote_revision INTEGER NOT NULL, number TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(type,number));
INSERT INTO financial_documents_rebuilt(id,type,order_id,quote_revision,number,status,record,created_at) SELECT id,type,order_id,quote_revision,number,status,record,created_at FROM financial_documents;
DROP TABLE financial_documents;
ALTER TABLE financial_documents_rebuilt RENAME TO financial_documents;`);
    });
  }
  db.exec(SCHEMA_BILLING);
  /* اصلاحات ۱۷/بند ۰: کدینگ حساب‌ها از پیشنهاد سیستم کاشته می‌شود. source ثبت می‌شود و
     approved_at خالی می‌ماند، یعنی این عنوان‌ها هنوز تأیید کارفرما یا حسابدار را نگرفته‌اند.
     INSERT OR IGNORE: اگر بعداً حسابدار کدی را ویرایش کرد، اجرای دوبارهٔ برنامه آن را بازنویسی نمی‌کند. */
  for (const account of coa.ACCOUNTS) {
    db.run('INSERT OR IGNORE INTO accounts(code,title,group_title,nature,source,approved_at) VALUES(?,?,?,?,?,NULL)',
      account.code, account.title, account.group, account.nature, 'پیشنهاد سیستم');
  }
  const sessions = new Map();           // token -> { user, lastRead:{}, created, last }
  const SESSION_IDLE_MS = 8 * 3600 * 1000;
  const MAX_FAILED = 5;
  const pinFailures = new Map(); // per-user, shared across that user's sessions
  const authStamp = u => JSON.stringify([u.role, u.customer_id, u.pass_hash, u.salt, u.legacy_hash, u.must_change]);
  function revokeUser(id, exceptToken) {
    for (const [token, session] of sessions) if (session.user.id === id && token !== exceptToken) sessions.delete(token);
  }

  const meta = {
    get: (k) => { const r = db.get('SELECT value FROM meta WHERE key = ?', k); return r ? r.value : null; },
    set: (k, v) => db.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v)),
  };
  function audit(sess, action, target, detail) {
    try { db.run('INSERT INTO audit_log(ts,user_id,user_name,role,action,target,detail) VALUES(?,?,?,?,?,?,?)', now(), sess ? sess.user.id : null, sess ? sess.user.name : null, sess ? sess.user.role : null, action, target || null, detail ? String(detail).slice(0, 500) : null); } catch (_) { /* audit must never break the app */ }
  }

  /* ---------- کاربران ---------- */
  function ensureDefaultAdmin() {
    const n = db.get('SELECT COUNT(*) AS n FROM users').n;
    if (n > 0) return;
    const salt = newSalt();
    db.run('INSERT INTO users(id,username,name,role,pass_hash,salt,active,must_change,created_at) VALUES(?,?,?,?,?,?,1,1,?)', 'u_admin', 'admin', 'مدیر چاپخانه', M, scryptHash('1234', salt), salt, now());
    meta.set('default_admin', '1');
  }
  const pubUser = (r) => ({ id: r.id, name: r.name, username: r.username, role: r.role, customerId: r.customer_id || '', station: r.station || '', active: !!r.active, mustChange: !!r.must_change });
  /* نام ایستگاه فقط برچسبِ شناسایی است: کوتاه، تک‌خطی و بدون نویسهٔ کنترلی. تغییرش نشست‌ها را
     باطل نمی‌کند (در authStamp نیست)، چون نام است نه سطح دسترسی. */
  const MAX_STATION = 40;
  function cleanStation(value, name) {
    const raw = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (raw.length > MAX_STATION) throw new Error(`نام ایستگاهِ «${name || 'کاربر'}» بیش از ${MAX_STATION} نویسه است.`);
    return raw;
  }

  function info() { return { backend: 'sqlite', defaultAdmin: meta.get('default_admin') === '1', loginSeen: meta.get('login_seen') === '1' }; }

  function login(username, password) {
    const u = db.get('SELECT * FROM users WHERE lower(username) = lower(?)', String(username || '').trim());
    const fail = (msg) => { audit(null, 'login_failed', String(username || '').slice(0, 60)); return { ok: false, error: msg }; };
    if (!u) { crypto.scryptSync('x', 'y', 8); return fail('نام کاربری یا رمز عبور اشتباه است.'); }
    if (u.locked_until > now()) return { ok: false, error: `حساب به‌دلیل چند بار رمز اشتباه موقتاً قفل است؛ ${Math.ceil((u.locked_until - now()) / 1000)} ثانیه‌ی دیگر دوباره تلاش کنید.` };
    let good = false;
    if (u.pass_hash && u.salt) good = safeEq(scryptHash(password, u.salt), u.pass_hash);
    else if (u.legacy_hash) good = safeEq(legacyHash(password), u.legacy_hash);
    if (!good) {
      const failed = u.failed + 1;
      const lock = failed >= MAX_FAILED ? now() + Math.min(15 * 60, 30 * (failed - MAX_FAILED + 1)) * 1000 : 0;
      db.run('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', failed, lock, u.id);
      return fail('نام کاربری یا رمز عبور اشتباه است.');
    }
    if (!u.active) return fail('این کاربر غیرفعال شده است؛ با مدیر چاپخانه تماس بگیرید.');
    let mustChange = !!u.must_change;
    if (!u.pass_hash) { // ارتقای رمز قدیمی به scrypt در اولین ورود
      const salt = newSalt();
      db.run('UPDATE users SET pass_hash = ?, salt = ?, legacy_hash = NULL WHERE id = ?', scryptHash(password, salt), salt, u.id);
      if (safeEq(legacyHash('1234'), legacyHash(password))) { mustChange = true; db.run('UPDATE users SET must_change = 1 WHERE id = ?', u.id); }
    }
    db.run('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?', u.id);
    const token = crypto.randomBytes(24).toString('hex');
    const user = { ...pubUser({ ...u, must_change: mustChange ? 1 : 0 }), mustChange };
    const current = db.get('SELECT * FROM users WHERE id = ?', u.id);
    sessions.set(token, { user, authStamp: authStamp(current), orderResetGeneration: meta.get('order_reset_generation') || '', lastRead: {}, liveSeen: {}, created: now(), last: now() });
    meta.set('login_seen', '1');
    audit(sessions.get(token), 'login', user.username);
    return { ok: true, token, user };
  }
  function logout(token) { const s = sessions.get(token); if (s) audit(s, 'logout', s.user.username); sessions.delete(token); return true; }
  function sess(token, allowPasswordChange = false) {
    const s = sessions.get(token); if (!s) return null;
    if (s.orderResetGeneration !== (meta.get('order_reset_generation') || '')) { sessions.delete(token); return null; }
    if (now() - s.last > SESSION_IDLE_MS) { sessions.delete(token); return null; }
    const current = db.get('SELECT * FROM users WHERE id = ?', s.user.id);
    if (!current || !current.active || s.authStamp !== authStamp(current)) { sessions.delete(token); return null; }
    s.user = pubUser(current);
    if (current.must_change && !allowPasswordChange) return null;
    s.last = now(); return s;
  }
  function authFailure(token) {
    const s = sessions.get(token);
    return s && s.user.mustChange
      ? { ok: false, code: 'PASSWORD_CHANGE_REQUIRED', error: 'ابتدا رمز اولیه خود را تغییر دهید.' }
      : { ok: false, code: 'UNAUTHENTICATED', error: 'نشست معتبر نیست؛ دوباره وارد شوید.' };
  }
  function setOwnPassword(token, newPassword) {
    const s = sess(token, true); if (!s) return authFailure(token);
    const p = String(newPassword || '');
    if (p.length < 6) return { ok: false, error: 'رمز جدید باید حداقل ۶ کاراکتر باشد.' };
    if (p === '1234' || p.toLowerCase() === 'admin') return { ok: false, error: 'این رمز قابل حدس است.' };
    const salt = newSalt();
    db.run('UPDATE users SET pass_hash = ?, salt = ?, legacy_hash = NULL, must_change = 0 WHERE id = ?', scryptHash(p, salt), salt, s.user.id);
    s.user.mustChange = false;
    s.authStamp = authStamp(db.get('SELECT * FROM users WHERE id = ?', s.user.id));
    revokeUser(s.user.id, token);
    meta.set('default_admin', '0');
    audit(s, 'password_changed', s.user.username);
    return { ok: true };
  }
  function listUsers(token) {
    const s = sess(token); if (!s || s.user.role !== M) return { ok: false, error: 'دسترسی مجاز نیست.' };
    return { ok: true, users: db.all('SELECT * FROM users ORDER BY created_at').map(pubUser) };
  }
  /* مدیر فهرست کاربران را می‌فرستد؛ رمز فقط وقتی عوض می‌شود که _plain همراه باشد (در همین‌جا هش می‌شود) */
  function saveUsers(token, users) {
    const s = sess(token); if (!s || s.user.role !== M) return { ok: false, error: 'دسترسی مجاز نیست.' };
    if (!Array.isArray(users)) return { ok: false, error: 'داده نامعتبر است.' };
    if (users.some(u => !u || typeof u !== 'object') || new Set(users.map(u => u.id)).size !== users.length) return { ok: false, error: 'اطلاعات کاربران نامعتبر است.' };
    const before = new Map(db.all('SELECT * FROM users').map(u => [u.id, u]));
    const incomingIds = new Set(users.map(u => u.id));
    const managers = users.filter(u => u.role === M && u.active !== false);
    if (!managers.length) return { ok: false, error: 'حداقل یک مدیر چاپخانه‌ی فعال باید وجود داشته باشد.' };
    const ALLOWED = new Set([...STAFF, CUS]);
    try {
      db.tx(() => {
        db.all('SELECT id FROM users').forEach(r => { if (!incomingIds.has(r.id)) { db.run('DELETE FROM users WHERE id = ?', r.id); audit(s, 'user_deleted', r.id); } });
        users.forEach(u => {
          if (!u.id || !u.username || !ALLOWED.has(u.role)) throw new Error('اطلاعات کاربر نامعتبر است.');
          const ex = db.get('SELECT * FROM users WHERE id = ?', u.id);
          const station = u.role === CUS ? '' : cleanStation(u.station, u.name);
          const customerLinkChanged = u.role === CUS && (!ex || ex.role !== CUS || (!ex.active && u.active !== false) || (ex.customer_id || '') !== (u.customerId || ''));
          if (customerLinkChanged && !eligibleCustomer(u.customerId)) throw new Error('حساب مشتری فقط به مشتری شماره‌دار و تأییدشده قابل اتصال است.');
          if (!ex) {
            if (!u._plain || String(u._plain).length < 4) throw new Error(`برای کاربر «${u.name}» رمز لازم است.`);
            const salt = newSalt();
            db.run('INSERT INTO users(id,username,name,role,customer_id,station,pass_hash,salt,active,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,?)', u.id, String(u.username).trim(), u.name, u.role, u.customerId || null, station || null, scryptHash(u._plain, salt), salt, u.active === false ? 0 : 1, now());
            audit(s, 'user_created', u.username, u.role);
          } else {
            db.run('UPDATE users SET name = ?, role = ?, customer_id = ?, station = ?, active = ? WHERE id = ?', u.name, u.role, u.customerId || null, station || null, u.active === false ? 0 : 1, u.id);
            if (u._plain) { if (String(u._plain).length < 4) throw new Error('رمز جدید خیلی کوتاه است.'); const salt = newSalt(); db.run('UPDATE users SET pass_hash = ?, salt = ?, legacy_hash = NULL, failed = 0, locked_until = 0 WHERE id = ?', scryptHash(u._plain, salt), salt, u.id); audit(s, 'password_reset', u.username); }
          }
        });
      });
    } catch (e) { return { ok: false, error: e.message.includes('UNIQUE') ? 'این نام کاربری قبلاً ثبت شده است.' : e.message }; }
    for (const [id, old] of before) {
      const current = db.get('SELECT * FROM users WHERE id = ?', id);
      if (!current || !current.active || authStamp(old) !== authStamp(current)) revokeUser(id);
    }
    // A manager may revoke their own session by changing their role/password.
    // Report the committed mutation accurately; subsequent calls require login.
    return { ok: true, users: db.all('SELECT * FROM users ORDER BY created_at').map(pubUser) };
  }

  /* ---------- ذخیره‌سازی ---------- */
  const isRecordArray = (v) => Array.isArray(v) && v.every(x => x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && x.id);
  const RECORD_KEYS = new Set(['printshop_orders_v5', 'printshop_customers_v2', 'printshop_inventory_v3', 'printshop_suppliers_v2', 'printshop_receipts_v1', 'printshop_consignments_v1', 'printshop_marketer_pay_v1', 'printshop_letters_v1']);
  const LIST_KEYS = new Set(['printshop_inv_categories', 'printshop_product_types', 'printshop_qty_units', 'printshop_service_types', 'printshop_binding_types', 'printshop_paper_kinds', 'printshop_book_like_types']);
  const OBJECT_KEYS = new Set(['printshop_units_v1', 'printshop_settings_v1', 'printshop_ai_v1', 'printshop_trim_sizes', 'printshop_print_colors', 'printshop_engine_cuts', 'printshop_engine_presses']);
  const plainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
  function validValue(key, value) {
    if (RECORD_KEYS.has(key)) {
      if (!isRecordArray(value) || new Set(value.map(r => r.id)).size !== value.length) return false;
      if (key === 'printshop_orders_v5') return value.every(o =>
        (!('items' in o) || isRecordArray(o.items)) &&
        (!('payments' in o) || isRecordArray(o.payments)) &&
        (!('history' in o) || isRecordArray(o.history)) &&
        (o.items || []).every(it => !('services' in it) || isRecordArray(it.services)));
      /* بند ۵/الف: رسید امانت فقط با فیلدهای خودِ سرور اعتبار دارد؛ ایستگاه هرگز این
         فهرست را ذخیره نمی‌کند (w: [])، پس این بررسی دروازهٔ دوم است نه اولین. */
      if (key === 'printshop_consignments_v1') return value.every(r =>
        /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.time || '')) &&
        Number.isFinite(Number(r.qty)) && Number(r.qty) > 0 &&
        typeof r.inventoryItemId === 'string' && r.inventoryItemId &&
        typeof r.ownerCustomerId === 'string' && r.ownerCustomerId);
      return true;
    }
    if (LIST_KEYS.has(key)) return Array.isArray(value) && value.every(v => typeof v === 'string');
    // ابعاد قطع و کد رنگ چاپ در محاسبه‌ی مواد و قیمت وارد می‌شوند؛ پس ساختارشان اینجا هم سخت بررسی می‌شود.
    if (key === 'printshop_trim_sizes') return plainObject(value) && Object.values(value).every(d => Array.isArray(d) && d.length === 2 && d.every(n => Number.isFinite(n) && n > 0 && n <= 200));
    const dim2 = d => Array.isArray(d) && d.length === 2 && d.every(n => Number.isFinite(n) && n > 0 && n <= 200);
    const posInt = n => Number.isInteger(n) && n > 0 && n <= 128;
    if (key === 'printshop_engine_cuts') return plainObject(value) && Object.values(value).every(c => plainObject(c) && posInt(c.formPages) && posInt(c.paperPages) && c.paperPages % c.formPages === 0 && Array.isArray(c.partials) && c.partials.every(p => posInt(p) && p < c.formPages) && dim2(c.trim));
    if (key === 'printshop_engine_presses') return plainObject(value) && Object.values(value).every(p => plainObject(p) && typeof p.offset === 'boolean' && Number.isFinite(p.plateFactor) && p.plateFactor >= 0 && p.plateFactor <= 4 && (p.offset ? p.plateFactor > 0 && dim2(p.sheet) : p.plateFactor === 0 && !('sheet' in p)));
    if (key === 'printshop_print_colors') return plainObject(value) && Object.keys(value).every(c => /^\d{1,2}$/.test(c)) && Object.values(value).every(l => typeof l === 'string' && l.trim().length > 0 && l.length <= 40);
    if (OBJECT_KEYS.has(key)) return plainObject(value);
    if (key === 'printshop_manager_pin') return typeof value === 'string' && /^\d{4,12}$/.test(value);
    return false;
  }

  const ORDER_MONEY = new Set(['payments', 'discount', 'shippingCost', 'otherCost', 'otherLabel', 'vatPercent']);
  const ITEM_MONEY = new Set(['unitPrice', 'designPrice']);
  const ORDER_CREATE = new Set(['id', 'orderNumber', 'date', 'deliveryDate', 'title', 'description', 'customerId', 'customerCode', 'customerName', 'phone', 'mobile', 'status', 'items', 'discount', 'payments', 'managerOverrideDebt', 'createdAt', 'source', 'intent', 'onHold', 'holdReason', 'procurement', 'smartText', 'requestText', 'requestedBy', 'quoteRev', 'history', 'vatPercent', 'archive', 'marketerCode', 'delivery', 'shippingCost', 'otherCost', 'otherLabel']);
  const blankMoney = v => v === undefined || v === null || v === '' || v === 0 || v === '0';
  function unpriced(o) {
    if ([...ORDER_MONEY].some(k => k !== 'payments' && k !== 'otherLabel' && !blankMoney(o[k]))) return false;
    if ((o.payments || []).length || o.managerOverrideDebt || o.approvedAt || o.archive || o.procurement) return false;
    if (Object.keys(o).some(k => !ORDER_CREATE.has(k))) return false;
    return (o.items || []).every(it =>
      (!it.stage || it.stage === 'ثبت سفارش') && !it.materialsDeducted && !it.materialConsumption &&
      [...ITEM_MONEY].every(k => blankMoney(it[k])) && (it.services || []).every(sv => blankMoney(sv.price)));
  }
  function without(obj, keys) { return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.has(k))); }
  function safeOrderWrite(s, incoming) {
    const existing = readKey('printshop_orders_v5') || [];
    const prev = new Map(existing.map(o => [o.id, o]));
    const ids = new Set(incoming.map(o => o.id));
    if (existing.some(o => !ids.has(o.id))) throw new Error('حذف سفارش فقط در اختیار مدیر است.');
    return incoming.map(o => {
      const p = prev.get(o.id);
      if (s.user.role === C) {
        const conversion = p && p.status === REQUEST_STATUS && o.status === 'در انتظار تایید';
        if (!p || conversion) {
          if (!['در انتظار تایید', REQUEST_STATUS].includes(o.status) || !unpriced(o)) throw new Error('ثبت سفارش مجوز تایید تولید یا ثبت مبالغ نمی‌دهد.');
          if (conversion && (o.orderNumber !== p.orderNumber || o.customerId !== p.customerId || o.customerCode !== p.customerCode || o.createdAt !== p.createdAt)) throw new Error('هویت درخواست مشتری قابل تغییر نیست.');
          return { ...o, history: [...(p ? p.history || [] : []), { id: crypto.randomBytes(8).toString('hex'), date: new Date(now()).toISOString().slice(0, 10), text: conversion ? 'درخواست مشتری به سفارش تبدیل شد' : 'سفارش ثبت شد', by: s.user.name, visibility: 'operational' }] };
        }
        const visible = redactOrders([p])[0];
        const skip = new Set(['history', 'status', 'archive']);
        if (!isDeepStrictEqual(without(o, skip), without(visible, skip))) throw new Error('ویرایش سفارش موجود در اختیار کارشناس نیست.');
        const archiving = o.status === 'بایگانی' && p.status !== 'بایگانی';
        if (!archiving && (!isDeepStrictEqual(o.archive, p.archive) || o.status !== p.status || !isDeepStrictEqual(o.history || [], visible.history || []))) throw new Error('تغییر وضعیت سفارش مجاز نیست.');
        if (archiving && !plainObject(o.archive)) throw new Error('دلیل بایگانی لازم است.');
        return archiving ? { ...p, status: 'بایگانی', archive: o.archive, history: [...(p.history || []), { id: crypto.randomBytes(8).toString('hex'), date: new Date(now()).toISOString().slice(0, 10), text: 'سفارش بایگانی شد', by: s.user.name, visibility: 'operational' }] } : p;
      }
      if (s.user.role === F) {
        if (!p) throw new Error('مدیر مالی اجازه ایجاد سفارش ندارد.');
        const skip = new Set([...ORDER_MONEY, 'items', 'history', 'quoteRev']);
        if (!isDeepStrictEqual(without(o, skip), without(p, skip))) throw new Error('مدیر مالی فقط اطلاعات مالی سفارش را تغییر می‌دهد.');
        if ((o.items || []).length !== (p.items || []).length) throw new Error('تغییر اقلام سفارش مجاز نیست.');
        (o.items || []).forEach((it, i) => {
          const pi = p.items[i];
          if (!isDeepStrictEqual(without(it, new Set([...ITEM_MONEY, 'services'])), without(pi, new Set([...ITEM_MONEY, 'services']))) || (it.services || []).length !== (pi.services || []).length) throw new Error('تغییر مشخصات تولید مجاز نیست.');
          (it.services || []).forEach((sv, j) => { if (!isDeepStrictEqual(without(sv, new Set(['price'])), without(pi.services[j], new Set(['price'])))) throw new Error('تغییر خدمات سفارش مجاز نیست.'); });
        });
        const oldHistory = p.history || [], newHistory = o.history || [];
        if (newHistory.length < oldHistory.length || !isDeepStrictEqual(newHistory.slice(0, oldHistory.length), oldHistory)) throw new Error('تاریخچه قابل حذف یا بازنویسی نیست.');
        return { ...o, history: [...oldHistory, ...newHistory.slice(oldHistory.length).map(h => ({ ...h, visibility: 'financial' }))] };
      }
      return o;
    });
  }
  function readKey(key) {
    if (key === 'printshop_documents_v1') return db.all('SELECT record FROM financial_documents ORDER BY created_at DESC, rowid DESC').map(r => JSON.parse(r.record));
    const kind = db.get('SELECT kind FROM kinds WHERE key = ?', key);
    if (kind && kind.kind === 'array') return db.all('SELECT data FROM records WHERE collection = ? ORDER BY ord, updated_at DESC', key).map(r => JSON.parse(r.data));
    const r = db.get('SELECT value FROM kv WHERE key = ?', key);
    return r ? JSON.parse(r.value) : null;
  }
  /* ---------- بند ب: نسخهٔ هر رکورد ----------
     «rev» شمارهٔ نسخه است. با هر تغییر واقعیِ داده یکی بالا می‌رود؛ جابه‌جایی ترتیب
     نسخه را عوض نمی‌کند. کلیدهای تک‌مقداری با کلید خالی «» نشان داده می‌شوند. */
  function keyRevs(key) {
    if (key === 'printshop_documents_v1') return {}; // نوشتن از مسیر عمومی ممکن نیست (ACCESS w: [])
    const kind = db.get('SELECT kind FROM kinds WHERE key = ?', key);
    if (kind && kind.kind === 'array') {
      const map = {};
      for (const r of db.all('SELECT id, rev FROM records WHERE collection = ?', key)) map[r.id] = r.rev;
      return map;
    }
    const row = db.get('SELECT rev FROM kv WHERE key = ?', key);
    return row ? { '': row.rev } : {}; // کلیدی که هرگز نوشته نشده: چیزی برای مقایسه نیست
  }
  const isVersionVector = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.values(v).every(n => Number.isInteger(n) && n >= 0);
  /* رکوردی که متنش با بانک مو نمی‌خورد بی‌تغییر است و نیازی به نسخه ندارد؛ همین
     باعث می‌شود نتیجهٔ یک «اقدام» سمت سرور (تأیید، صدور کد، تأیید سفارش) که رابط
     عیناً پذیرفته، به‌اشتباه تضاد حساب نشود. تضاد واقعی فقط جایی است که فرستادهٔ شما
     با بانک فرق دارد و بانک از آخرین خواندنِ شما تکان خورده است. */
  function versionConflicts(key, incoming, expected) {
    if (!isVersionVector(expected)) return []; // بی‌بردارِ نسخه همان رفتار پیشین است؛ سرور شبکه فرستادنش را اجباری می‌کند
    if (!isRecordArray(incoming)) {
      const row = db.get('SELECT rev FROM kv WHERE key = ?', key);
      return (expected[''] ?? 0) === (row ? row.rev : 0) ? [] : [''];
    }
    const stored = new Map(db.all('SELECT id, data, rev FROM records WHERE collection = ?', key).map(r => [r.id, r]));
    const stale = new Set();
    const ids = new Set();
    for (const rec of incoming) {
      if (!rec || typeof rec.id !== 'string' || ids.has(rec.id)) continue;
      ids.add(rec.id);
      const ex = stored.get(rec.id);
      if (!ex) { if (Number.isInteger(expected[rec.id])) stale.add(rec.id); continue; } // رکورد پس از خواندنِ شما حذف شده
      if (ex.data === JSON.stringify(rec)) continue;
      if (!Number.isInteger(expected[rec.id]) || expected[rec.id] !== ex.rev) stale.add(rec.id);
    }
    for (const [id, ex] of stored) if (!ids.has(id) && expected[id] !== ex.rev) stale.add(id); // حذف، آن هم با نسخهٔ درست
    return [...stale];
  }
  /* ---------- بند پ: نشانهٔ زندهٔ تغییر ----------
     «مُهر» هر فهرست از خودِ جدول‌ها ساخته می‌شود (تعداد + تازه‌ترین updated_at)، پس هیچ مسیر
     نوشتنی لازم نیست یادش بماند ما را خبر کند: ذخیرهٔ ایستگاه، تأیید مدیر، ایمپورت کاتالوگ،
     نامه و هر اقدام دیگر همان مُهر را جابه‌جا می‌کند. مقایسه در هر نشست نگه داشته می‌شود، پس
     هر ایستگاه فقط تغییرِ *بعد از آخرین کار خودش* را می‌بیند و نوشتنِ خودش را به خودش خبر نمی‌دهد.
     جابه‌جایی ترتیب رکوردها مُهر را تکان نمی‌دهد (همان تصمیمِ بند ب): فهرست‌ها جابه‌جا شده‌اند،
     نه تغییر کرده‌اند، و اپراتور چیزی را از دست نمی‌دهد. */
  function liveStamps() {
    const map = new Map();
    for (const r of db.all('SELECT collection AS key, COUNT(*) AS n, MAX(updated_at) AS m FROM records GROUP BY collection')) map.set(r.key, `${r.n}:${r.m}`);
    for (const r of db.all('SELECT key, updated_at AS m, rev FROM kv')) map.set(r.key, `kv:${r.m}:${r.rev}`);
    return map;
  }
  function markSeen(token, keys) {
    const s = sessions.get(token); if (!s) return;
    const list = Array.isArray(keys) ? keys : (keys ? [keys] : []);
    if (!list.length) return;
    const stamps = liveStamps();
    for (const key of list) if (key in ACCESS) s.liveSeen[key] = stamps.get(key) || '';
  }
  function changes(token) {
    const s = sess(token); if (!s) return authFailure(token);
    const stamps = liveStamps();
    const changed = [];
    for (const key of Object.keys(ACCESS)) {
      if (!canRead(s.user.role, key)) { delete s.liveSeen[key]; continue; } // فهرستی که این نقش نمی‌بیند، خبر هم نمی‌گیرد
      const stamp = stamps.get(key) || '';
      const seen = s.liveSeen[key];
      if (seen === undefined) { s.liveSeen[key] = stamp; continue; } // نخستین پرسش فقط پایه‌گذاری است، نه خبر
      if (seen !== stamp) { s.liveSeen[key] = stamp; changed.push(key); }
    }
    return { ok: true, changed };
  }
  /* ---------- چرخهٔ تعریف ← تأیید ← کد یکتا (مشتری / بازاریاب / تأمین‌کننده) ----------
     ترتیب مورد تأیید کارفرما: اول رکورد تعریف می‌شود، سپس مدیر آن را تأیید یا رد می‌کند،
     و کد یکتا فقط پس از تأیید صادر می‌شود. رد شدن یعنی «غیرفعال» و هیچ شماره‌ای مصرف نمی‌شود،
     بنابراین همان شماره به نفر بعدی می‌رسد. حذف کامل از بانک، دکمهٔ جدا و محدود است. */
  const CUSTOMER_KEY = 'printshop_customers_v2';
  const SUPPLIER_KEY = 'printshop_suppliers_v2';
  const pendingEligibility = () => ({ status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' });
  const PARTIES = {
    customer: { key: CUSTOMER_KEY, label: 'مشتری', codeField: 'customerCode', codePattern: /^C-\d{6}$/, prefix: 'C', sequence: 'customer_code_sequence', otherLabel: 'مشتری' },
    supplier: { key: SUPPLIER_KEY, label: 'تامین‌کننده', codeField: 'supplierCode', codePattern: /^S-\d{6}$/, prefix: 'S', sequence: 'supplier_code_sequence', otherLabel: 'موجودی و رسید' },
  };
  const CUSTOMER_CODE = PARTIES.customer.codePattern;
  const reviewStatus = p => ['approved', 'rejected'].includes(p?.eligibility?.status) ? p.eligibility.status : 'pending';
  const partyActive = p => p.active !== false;
  const usableParty = p => !!p && reviewStatus(p) === 'approved' && partyActive(p);
  const managerRef = s => ({ id: s.user.id, name: s.user.name, role: s.user.role });
  function nextPartyCode(kind, records) {
    const c = PARTIES[kind];
    const highest = records.reduce((n, r) => c.codePattern.test(String(r[c.codeField] || '')) ? Math.max(n, Number(String(r[c.codeField]).slice(2))) : n, 0);
    const serial = Math.max(Number(meta.get(c.sequence)) || 0, highest) + 1;
    if (serial > 999999) throw new Error(`ظرفیت شماره ${c.label} تکمیل شده است.`);
    return { code: `${c.prefix}-${String(serial).padStart(6, '0')}`, serial };
  }
  function eligibleCustomer(id) {
    const customers = readKey(CUSTOMER_KEY) || [];
    const customer = customers.find(c => c.id === id);
    return customer && CUSTOMER_CODE.test(customer.customerCode || '') && usableParty(customer)
      && customers.filter(c => c.customerCode === customer.customerCode).length === 1 ? customer : null;
  }
  function protectedParty(p, kind) {
    return !!p[PARTIES[kind].codeField] || (!!p.eligibility && p.eligibility.status !== 'pending');
  }
  const protectedCustomer = c => protectedParty(c, 'customer');
  function safePartyWrite(kind, incoming) {
    const c = PARTIES[kind];
    const previous = new Map((readKey(c.key) || []).map(r => [r.id, r]));
    const ids = new Set(incoming.map(r => r.id));
    if ([...previous.values()].some(r => !ids.has(r.id) && protectedParty(r, kind))) throw new Error(`${c.label} شماره‌دار یا بررسی‌شده قابل حذف نیست؛ برای حذف کامل از «حذف از بانک» استفاده کنید.`);
    return incoming.map(r => {
      const old = previous.get(r.id);
      if (old) {
        if (!isDeepStrictEqual(r[c.codeField], old[c.codeField])) throw new Error(`کد ${c.label} فقط با صدور مدیر تغییر می‌کند.`);
        if (!isDeepStrictEqual(r.eligibility, old.eligibility)) throw new Error(`صلاحیت ${c.label} فقط از مسیر بررسی مدیر تغییر می‌کند.`);
        if (partyActive(r) !== partyActive(old)) throw new Error(`فعال یا غیرفعال بودن ${c.label} فقط از مسیر بررسی مدیر تغییر می‌کند.`);
        return r;
      }
      if (r[c.codeField] || (r.eligibility && !isDeepStrictEqual(r.eligibility, pendingEligibility()))) throw new Error(`${c.label} جدید باید در انتظار بررسی و بدون کد باشد.`);
      return { ...r, [c.codeField]: '', eligibility: pendingEligibility(), active: true };
    });
  }
  const PARTY_KIND_BY_KEY = Object.fromEntries(Object.entries(PARTIES).map(([kind, c]) => [c.key, kind]));
  const PARTY_ACTIONS = ['approve', 'reject', 'issue_number', 'activate', 'deactivate', 'erase'];
  function partyReferences(kind, id) {
    if (kind === 'customer') return {
      'سفارش': (readKey('printshop_orders_v5') || []).filter(o => o.customerId === id).length,
      'حساب کاربری': db.get('SELECT COUNT(*) AS n FROM users WHERE customer_id = ?', id).n,
    };
    return {
      'کالای انبار': (readKey('printshop_inventory_v3') || []).filter(i => i.supplierId === id).length,
      'رسید': (readKey('printshop_receipts_v1') || []).filter(r => r.supplierId === id).length,
    };
  }
  function partyAction(token, kind, id, action, payload = {}) {
    const s = sess(token); if (!s) return authFailure(token);
    const c = PARTIES[kind];
    if (!c) return { ok: false, code: 'VALIDATION_FAILED', error: 'نوع طرف معتبر نیست.' };
    if (s.user.role !== M) return { ok: false, code: 'FORBIDDEN', error: `بررسی و کد ${c.label} فقط در اختیار مدیر چاپخانه است.` };
    if (typeof id !== 'string' || !id || !PARTY_ACTIONS.includes(action) || !plainObject(payload)) return { ok: false, code: 'VALIDATION_FAILED', error: `درخواست بررسی ${c.label} معتبر نیست.` };
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (reason.length > 2000 || (action === 'reject' || action === 'approve') && reason.length < 3) {
      return { ok: false, code: 'VALIDATION_FAILED', error: action === 'approve' ? 'برای تأیید، شرح تصمیم مدیر لازم است.' : `برای رد ${c.label}، دلیل معتبر لازم است.` };
    }
    try {
      let party, removed = false;
      db.tx(() => {
        const records = readKey(c.key) || [];
        const original = records.find(r => r.id === id);
        if (!original) throw Object.assign(new Error(`${c.label} یافت نشد.`), { code: 'NOT_FOUND' });
        party = { ...original, eligibility: original.eligibility || pendingEligibility() };
        const hasCode = c.codePattern.test(String(party[c.codeField] || ''));
        if (action === 'approve') {
          party.eligibility = { status: 'approved', reviewedBy: managerRef(s), reviewedAt: now(), reason };
          party.active = true;
        } else if (action === 'reject') {
          party.eligibility = { status: 'rejected', reviewedBy: managerRef(s), reviewedAt: now(), reason };
          party.active = false;
        } else if (action === 'issue_number') {
          if (reviewStatus(party) !== 'approved') throw new Error(`ابتدا ${c.label} را تأیید کنید؛ کد یکتا پس از تأیید صادر می‌شود.`);
          if (!partyActive(party)) throw new Error(`${c.label} غیرفعال نمی‌تواند کد یکتا بگیرد؛ ابتدا آن را فعال کنید.`);
          if (hasCode) throw new Error('این رکورد کد یکتا دارد و شماره جایگزین نمی‌شود.');
          const next = nextPartyCode(kind, records);
          if (records.some(r => r.id !== id && r[c.codeField] === next.code)) throw new Error('شماره انتخابی تکراری است.');
          party[c.codeField] = next.code;
          meta.set(c.sequence, next.serial);
        } else if (action === 'activate') {
          party.active = true;
        } else if (action === 'deactivate') {
          party.active = false;
        } else {
          if (hasCode) throw new Error(`${c.label} دارای کد یکتا حذف کامل نمی‌شود؛ آن را غیرفعال کنید.`);
          if (reviewStatus(party) === 'approved') throw new Error('رکورد تأیید‌شده را با «غیرفعال کردن» از فهرست کاری خارج کنید، نه حذف کامل.');
          const refs = partyReferences(kind, id);
          const used = Object.entries(refs).filter(([, n]) => n > 0);
          if (used.length) throw new Error(`${c.label} در ${used.map(([k, n]) => `${n} ${k}`).join(' و ')} استفاده شده و حذف کامل ممکن نیست؛ آن را غیرفعال کنید.`);
          db.run('DELETE FROM records WHERE collection = ? AND id = ?', c.key, id);
          removed = true;
        }
        if (!removed) db.run('UPDATE records SET data = ?, updated_at = ?, rev = rev + 1 WHERE collection = ? AND id = ?', JSON.stringify(party), now(), c.key, id);
        audit(s, `${kind}_${action}`, id, reason || party[c.codeField] || '');
      });
      if (removed) return { ok: true, removed: true, id };
      return { ok: true, party, customer: kind === 'customer' ? party : undefined, supplier: kind === 'supplier' ? party : undefined };
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  const customerAction = (token, id, action, payload = {}) => partyAction(token, 'customer', id, action, payload);
  /* بانک پیشین: رکوردهایی که پیش از این چرخه ثبت شده‌اند «eligibility» ندارند.
     برای آن‌که هیچ مشتری یا تأمین‌کنندهٔ فعلی از فهرست کاری حذف نشود، یک‌بار تأییدشده محسوب می‌شوند
     می‌شوند (بدون کد). رکوردهای صریحاً «در انتظار بررسی» دست‌نخورده می‌مانند. */
  const legacyApproval = stamp => ({ status: 'approved', reviewedBy: { id: 'system', name: 'بانک پیشین', role: 'system' }, reviewedAt: stamp, reason: 'تأیید خودکار: این رکورد پیش از فعال شدن چرخهٔ بررسی در بانک بود.' });
  function backfillPartyCycle() {
    if (meta.get('party_cycle') === '1') return { backfilled: 0, customers: 0, suppliers: 0 };
    let customers = 0, suppliers = 0;
    try {
      for (const kind of ['customer', 'supplier']) {
        const key = PARTIES[kind].key;
        const records = readKey(key) || [];
        const legacy = records.filter(r => !r.eligibility);
        if (kind === 'customer') customers = legacy.length; else suppliers = legacy.length;
        if (legacy.length) {
          const stamp = now();
          writeKey(key, records.map(r => r.eligibility ? r : { ...r, [PARTIES[kind].codeField]: r[PARTIES[kind].codeField] || '', active: r.active !== false, eligibility: legacyApproval(stamp) }), 0);
        }
      }
    } catch (_) { return { backfilled: -1, customers, suppliers, error: true }; }
    meta.set('party_cycle', '1');
    return { backfilled: customers + suppliers, customers, suppliers };
  }
  function customerProfile(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (s.user.role !== CUS) return { ok: false, code: 'FORBIDDEN', error: 'این مسیر ویژه حساب مشتری است.' };
    const customer = (readKey(CUSTOMER_KEY) || []).find(c => c.id === s.user.customerId);
    if (!customer) return { ok: false, code: 'NOT_FOUND', error: 'پرونده مشتری به این حساب متصل نیست.' };
    return { ok: true, customer: { id: customer.id, name: customer.name || '', customerCode: customer.customerCode || '', eligibility: { status: customer.eligibility?.status || 'pending', reason: customer.eligibility?.reason || '' }, phone: customer.phone || '', mobile: customer.mobile || '' } };
  }
  /* دسترسی مالی مشتری: سرور ردیف‌ها را با customerIdِ خودِ نشست می‌پالاید و تنها فیلدهایی
     را می‌دهد که روی فاکتور خودِ مشتری هم نوشته شده است. هیچ هزینهٔ داخلی، موتور قیمت،
     تاریخچهٔ آزاد یا snapshot سند از این در بیرون نمی‌رود. */
  const CUSTOMER_ORDER_FIELDS = ['id', 'orderNumber', 'date', 'deliveryDate', 'title', 'status', 'deliveredAt', 'quoteRev', 'discount', 'vatPercent', 'shippingCost', 'otherCost', 'otherLabel'];
  const CUSTOMER_ITEM_FIELDS = ['id', 'productName', 'productType', 'qty', 'qtyUnit', 'unitPrice', 'designPrice'];
  const CUSTOMER_SERVICE_FIELDS = ['serviceType', 'name', 'price', 'description'];
  const CUSTOMER_PAYMENT_FIELDS = ['id', 'amount', 'method', 'date'];
  const CUSTOMER_DOCUMENT_FIELDS = ['id', 'type', 'number', 'status', 'orderId', 'orderNumber', 'quoteRevision', 'createdAt'];
  /* ردیف‌های قیمت فقط همان ستونهایی را می‌برند که روی فاکتور مشتری چاپ می‌شود.
     هزینهٔ داخلی هدایا (internalCost) و هر فیلد دیگری از snapshot بیرون می‌ماند. */
  const CUSTOMER_PRICING_LINE_FIELDS = ['description', 'name', 'qty', 'rate', 'cost', 'customerSupplied'];
  const CUSTOMER_PRICING_TOTAL_FIELDS = ['currency', 'materialsCost', 'servicesCost', 'baseCost', 'serviceMarkupAmount', 'subtotal', 'discount', 'taxAmount', 'total'];
  const pickFields = (row, fields) => Object.fromEntries(fields.filter(k => plainObject(row) && row[k] !== undefined).map(k => [k, structuredClone(row[k])]));
  const customerPricing = order => {
    const result = order?.pricing?.result;
    if (!plainObject(result)) return undefined;
    return {
      schemaVersion: order.pricing.schemaVersion, revision: order.pricing.revision,
      result: {
        ...pickFields(result, CUSTOMER_PRICING_TOTAL_FIELDS),
        materials: (result.materials || []).map(line => pickFields(line, CUSTOMER_PRICING_LINE_FIELDS)),
        services: (result.services || []).map(line => pickFields(line, CUSTOMER_PRICING_LINE_FIELDS)),
        offers: (result.offers || []).map(offer => ({ ...pickFields(offer, ['description', 'name', 'qty']), customerCharge: 0 })),
      },
    };
  };
  function customerFinance(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (s.user.role !== CUS) { audit(s, 'denied_read', 'customer_finance'); return { ok: false, code: 'FORBIDDEN', error: 'این مسیر ویژهٔ حساب مشتری است.' }; }
    const customer = eligibleCustomer(s.user.customerId);
    if (!customer) { audit(s, 'denied_read', 'customer_finance'); return { ok: false, code: 'CUSTOMER_NOT_APPROVED', error: 'دیدن مالی به شمارهٔ مشتری و تأیید صلاحیت مدیر نیاز دارد.' }; }
    const orders = (readKey('printshop_orders_v5') || [])
      .filter(o => o && o.customerId === customer.id)
      .map(o => {
        const pricing = customerPricing(o);
        return {
          ...pickFields(o, CUSTOMER_ORDER_FIELDS),
          items: (o.items || []).map(it => ({ ...pickFields(it, CUSTOMER_ITEM_FIELDS), services: (it.services || []).map(sv => pickFields(sv, CUSTOMER_SERVICE_FIELDS)) })),
          payments: (o.payments || []).map(p => pickFields(p, CUSTOMER_PAYMENT_FIELDS)),
          ...(pricing ? { pricing } : {}),
        };
      });
    const mine = new Set(orders.map(o => o.id));
    const documents = (readKey('printshop_documents_v1') || [])
      .filter(d => d && mine.has(d.orderId))
      .map(d => pickFields(d, CUSTOMER_DOCUMENT_FIELDS));
    return { ok: true, customer: { id: customer.id, name: customer.name || '', customerCode: customer.customerCode || '' }, orders, documents };
  }
  /* بند ۵/ب: کاردکس — همان هفت ستون + مالک، ثبت‌کننده و «مانده پس از گردش».
     هیچ عددی در رابط ساخته نمی‌شود: سرور ردیف‌ها را فیلتر می‌کند، نام تحویل‌گیرنده را
     از شناسهٔ کاربر باز می‌کند و ماندهٔ تجمعی هر کالا را از ابتدای بازهٔ انتخابی می‌شمارد.
     کاردکس مبلغ ندارد، پس ستون پولی هم برای حذف وجود ندارد. */
  function stockCardex(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!canRead(s.user.role, 'printshop_inventory_v3')) { audit(s, 'denied_read', 'stock_cardex'); return { ok: false, code: 'FORBIDDEN', error: 'دسترسی مجاز نیست.' }; }
    const q = plainObject(input) ? input : {};
    const ownerType = q.ownerType === 'چاپخانه' || q.ownerType === 'مشتری' ? q.ownerType : '';
    const itemId = typeof q.itemId === 'string' ? q.itemId : '';
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? q.from : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? q.to : '';
    const names = new Map(db.all('SELECT id, name FROM users').map(u => [u.id, u.name || '']));
    const rows = [];
    for (const it of (readKey('printshop_inventory_v3') || [])) {
      if (itemId && it.id !== itemId) continue;
      if (ownerType === 'مشتری' && it.ownerType !== 'مشتری') continue;
      if (ownerType === 'چاپخانه' && it.ownerType === 'مشتری') continue;
      const unitDefault = it.unitMode === 'band_sheet' ? 'بند' : it.unitMode === 'roll_kg' ? 'کیلوگرم' : (it.simpleUnit || '');
      let running = 0;
      const mv = (it.movements || []).filter(m => m && m.date).filter(m => (!from || m.date >= from) && (!to || m.date <= to))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (const m of mv) {
        const qty = Number(m.qty) || 0;
        running += m.type === 'in' ? qty : -qty;
        rows.push({
          itemId: it.id, itemName: it.name || '', ownerType: it.ownerType === 'مشتری' ? 'مشتری' : 'چاپخانه',
          movementNumber: m.movementNumber || '', date: m.date, type: m.type === 'in' ? 'in' : 'out', qty, unit: m.unit || unitDefault,
          orderNumber: m.orderNumber || '', actorName: names.get(m.actorId) || '', note: m.note || '', running,
        });
      }
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.movementNumber).localeCompare(String(a.movementNumber)));
    return { ok: true, rows };
  }
  /* بند ۵/پ: گزارش کارهای ناتمام. «باز» یعنی هنوز به تحویل/لغو/بایگانی نرسیده. سرور خودش
     مرحلهٔ فعلی (کمترین مرحلهٔ میان اقلام)، واحد مسئول، آخرین تحرک (از تاریخِ گردشِ سروری)،
     روز بی‌تحرک، فاصله تا موعد و بدهی را حساب می‌کند؛ رابط فقط می‌خواند و چیزی نمی‌سازد.
     بدهی فقط برای مدیر و مدیر مالی (FULL_MONEY) می‌آید؛ برای بقیهٔ ستون پولی وجود ندارد.
     «علت انتظار» و «مسئول پیگیری» عمداً نیامده‌اند: چنین فیلدی در سفارش ثبت نمی‌شود. */
  const REPORT_ROLES = [M, C, F, QC, ...SUP];
  const STAGE_UNIT = { 'ثبت سفارش': 'دفتر سفارشات', 'طراحی و پروف': 'طراحی', 'لیتوگرافی و زینک': 'لیتوگرافی', 'چاپ افست': 'چاپ', 'چاپ دیجیتال': 'چاپ دیجیتال', 'صحافی و تکمیلی': 'صحافی', 'برش و تکمیلی': 'صحافی', 'کنترل کیفیت و تحویل به مشتری': 'تحویل', 'طراحی': 'طراحی', 'پروف': 'طراحی', 'لیتوگرافی': 'لیتوگرافی', 'چاپ': 'چاپ', 'صحافی': 'صحافی', 'خدمات تکمیلی': 'خدمات تکمیلی', 'کنترل کیفیت': 'کنترل کیفیت', 'تحویل': 'تحویل' };
  const CLOSED_STATUSES = ['تحویل شده', 'لغو شده', 'بایگانی'];
  function unfinishedWork(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!REPORT_ROLES.includes(s.user.role)) { audit(s, 'denied_read', 'unfinished_work'); return { ok: false, code: 'FORBIDDEN', error: 'دسترسی مجاز نیست.' }; }
    const money = FULL_MONEY.includes(s.user.role);
    const { ALL_STAGES, orderStage, isDeliveryStage } = require('./workflow');
    const q = plainObject(input) ? input : {};
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? q.from : '';
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? q.to : '';
    const stage = ALL_STAGES.includes(q.stage) ? q.stage : '';
    const customerId = typeof q.customerId === 'string' ? q.customerId : '';
    const onlyOverdue = q.onlyOverdue === true;
    const onlyNoLicense = q.onlyNoLicense === true;
    const today = new Date(now()).toISOString().slice(0, 10);
    const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
    const currentStage = o => orderStage(o).stage;
    const all = readKey('printshop_orders_v5') || [];
    const open = all.filter(o => o && !o.deliveredAt && !CLOSED_STATUSES.includes(o.status));
    const enriched = open.filter(o => {
      const d = String(o.date || '').slice(0, 10);
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      if (customerId && o.customerId !== customerId) return false;
      if (stage && currentStage(o) !== stage) return false;
      return true;
    }).map(o => {
      const cs = currentStage(o);
      const hist = (o.history || []).map(h => String(h.date || '').slice(0, 10)).filter(Boolean).sort();
      const lastMovement = hist.length ? hist[hist.length - 1] : '';
      const due = String(o.deliveryDate || '').slice(0, 10);
      const shortages = o.workflow && o.workflow.materialReview && Array.isArray(o.workflow.materialReview.shortages) ? o.workflow.materialReview.shortages : [];
      const row = {
        orderId: o.id, orderNumber: String(o.orderNumber || ''), customerName: o.customerName || '',
        product: [...new Set((o.items || []).map(it => it && it.productName).filter(Boolean))].join('، ') || '—',
        stage: cs, unit: STAGE_UNIT[cs] || cs, lastMovement,
        idleDays: lastMovement ? dayDiff(today, lastMovement) : null,
        dueDate: due, daysToDue: due ? dayDiff(due, today) : null,
        overdue: due ? due < today : false,
        awaitingMaterial: shortages.some(sh => sh && sh.state === 'pending'),
        ready: o.status === 'آماده تحویل' || isDeliveryStage(cs),
        noLicense: !(o.workflow && o.workflow.productionAuthorization),
      };
      if (money) { let debt = null; try { debt = rawOrderBalance(o); } catch (_) { debt = null; } row.debt = debt; }
      return row;
    });
    const kpis = {
      totalRecords: all.length, open: enriched.length,
      overdue: enriched.filter(r => r.overdue).length,
      awaitingMaterial: enriched.filter(r => r.awaitingMaterial).length,
      idle7: enriched.filter(r => r.idleDays !== null && r.idleDays > 7).length,
      ready: enriched.filter(r => r.ready).length,
      noLicense: enriched.filter(r => r.noLicense).length,
    };
    let rows = enriched;
    if (onlyOverdue) rows = rows.filter(r => r.overdue);
    if (onlyNoLicense) rows = rows.filter(r => r.noLicense);
    rows.sort((a, b) => {
      const ad = a.daysToDue === null ? Number.POSITIVE_INFINITY : a.daysToDue;
      const bd = b.daysToDue === null ? Number.POSITIVE_INFINITY : b.daysToDue;
      if (ad !== bd) return ad - bd;
      return (b.idleDays || 0) - (a.idleDays || 0);
    });
    return { ok: true, rows, kpis, moneyIncluded: money, today };
  }
  /* اصلاحات ۱۴/۵ — دادهٔ کادر معلق تابلوی تولید. سه دلیل فقط از رکوردهای واقعی خوانده می‌شود:
     مدیر ← workflow.productionAuthorization؛ سفارش ← workflow.customerConfirmation و ارجاع قلم‌ها؛
     مالی ← سند پیش‌فاکتورِ صادرشده برای همین نسخه در financial_documents، چون صادر کردن سند فقط در اختیار مدیر و مالی است.
     «تأیید مالی» فیلدی در سفارش نیست، پس همان رکورد سند مرجع است و ایستگاه چیزی نمی‌سازد.
     `primary` دلیل اصلی است (اولین حلقهٔ بازِ زنجیرهٔ مالی ← سفارش ← مدیر) تا هر سفارش در یک ستونِ کادر معلق بنشیند. */
  function productionBoard(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!STAFF.includes(s.user.role)) { audit(s, 'denied_read', 'production_board'); return { ok: false, code: 'FORBIDDEN', error: 'دسترسی مجاز نیست.' }; }
    const { holdState, stageIndex } = require('./workflow');
    const today = new Date(now()).toISOString().slice(0, 10);
    const quoted = new Set(db.all("SELECT order_id oid, quote_revision rev FROM financial_documents WHERE type = 'quote' AND status = 'issued'")
      .map(r => `${r.oid}|${r.rev}`));
    const lastMove = o => {
      const days = (o.history || []).map(h => String(h.date || '').slice(0, 10)).filter(Boolean).sort();
      return days.length ? days[days.length - 1] : String(o.date || '').slice(0, 10);
    };
    const holds = (readKey('printshop_orders_v5') || [])
      .filter(o => o && !o.deliveredAt && !['تحویل شده', 'لغو شده', 'بایگانی', 'متوقف'].includes(o.status) && !(o.workflow && o.workflow.productionAuthorization))
      .map(o => {
        const state = holdState(o, { financeApproved: quoted.has(`${o.id}|${Number(o.quoteRev) || 1}`) });
        const moved = lastMove(o);
        const pick = key => state.reasons.find(r => r.key === key) || null;
        const primary = pick('finance') || pick('order') || pick('manager');
        return {
          orderId: o.id, orderNumber: String(o.orderNumber || ''), customerName: o.customerName || '',
          status: o.status || '', date: String(o.date || '').slice(0, 10), lastMovement: moved,
          idleDays: moved ? Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(moved + 'T00:00:00Z')) / 86400000) : null,
          held: state.held, primary: primary ? primary.key : '', reasons: state.reasons,
          unreferredItems: (o.items || []).filter(it => stageIndex(it) === 0).length,
        };
      });
    return { ok: true, today, holds };
  }
  /* اصلاحات ۱۷/بند ۰: میز کدینگ و نگاشت رویداد→سند، فقط‌خواندنی و فقط برای مدیر چاپخانه و مدیر مالی.
     این متد چیزی نمی‌نویسد. حساب‌ها از جدول accounts خوانده می‌شوند (همان‌ها که هنگام ساخت بانک
     کاشته شده‌اند) و قواعد از coa.js؛ تعداد زندهٔ سطرها از خودِ بانک می‌آید، پس اگر روزی سندی
     ثبت شد این میز عدد واقعی را نشان می‌دهد نه شمارِ قواعد. */
  function ledgerCoding(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!FULL_MONEY.includes(s.user.role)) { audit(s, 'denied_read', 'ledger_coding'); return { ok: false, code: 'FORBIDDEN', error: 'دسترسی مجاز نیست.' }; }
    const usage = coa.usageByAccount();
    const rows = db.all('SELECT code, title, group_title, nature, source, approved_at FROM accounts ORDER BY code');
    const count = sql => { try { return Number(db.get(sql).n) || 0; } catch (_) { return null; } };
    const check = coa.validateCoding();
    return {
      ok: true,
      approval: { approved: rows.filter(r => r.approved_at).length, total: rows.length, state: 'پیش‌نویس — تا تأیید شما هیچ سندی در دفترکل ثبت نمی‌شود' },
      accounts: rows.map(r => ({ code: r.code, title: r.title, group: r.group_title, nature: r.nature, source: r.source, approvedAt: r.approved_at || null, rules: (usage[r.code] || []).length })),
      rules: coa.MAPPINGS.map(coa.ruleView),
      resolvers: coa.RESOLVERS,
      check: { ok: check.ok, errors: check.errors, stats: check.stats },
      live: {
        accounts: count('SELECT COUNT(*) AS n FROM accounts'),
        entries: count("SELECT COUNT(*) AS n FROM journal_entries WHERE status = 'posted'"),
        drafts: count("SELECT COUNT(*) AS n FROM journal_entries WHERE status = 'draft'"),
        lines: count('SELECT COUNT(*) AS n FROM journal_lines'),
      },
    };
  }
  /* ---------- اصلاحات ۱۷/بند ۱: پروندهٔ اعتباری مشتری ----------
     یک منبع عدد برای همه: بدهی قطعی از فاکتورِ صادرشدهٔ همان نسخه، تعهد از سفارشِ تأییدشدهٔ
     بی‌فاکتور، و پیش‌پرداخت از پرداختی که از مبلغ بیشتر است. فاکتور ابطال‌شده بدهی نمی‌سازد.
     امروز فقط خوانده می‌شود؛ جایِ دو خطای قبلی را می‌گیرد: «بدهی» در رابط کاربری با فیلترِ
     خودش حساب می‌شد و مجوز بدهیِ مدیر فقط یک کلیکِ بی‌سند بود. */
  function invoicesByOrder() {
    const out = {};
    const rows = db.all("SELECT id, order_id, quote_revision, number, record FROM financial_documents WHERE type = 'invoice' AND status = 'issued' ORDER BY quote_revision, created_at");
    for (const row of rows) {
      let doc = null;
      try { doc = JSON.parse(row.record); } catch (_) { continue; }
      const total = doc && doc.snapshot && doc.snapshot.invoice && doc.snapshot.invoice.totals ? doc.snapshot.invoice.totals.total : null;
      if (!Number.isSafeInteger(total) || total < 0) continue; // سند خراب عدد نمی‌سازد
      /* اصلاحات ۱۷/بند ۲: تخصیص وجه «به کدام فاکتور» را با شناسهٔ سند می‌پوندد، نه با
         شمارهٔ متنى؛ پس id فاکتور هم در همین خط خوانده می‌شود.
         بند ۳: «فاکتورِ این سفارش» دیگر یک سند نیست — یک نسخه می‌تواند چند فاکتورِ
         تحویلی داشته باشد. پس مبلغِ همهٔ فاکتورهای زنده جمع می‌شود (بدهی قطعی)، فهرست
         documents می‌گوید پول به کدام‌یک خورده است و documentId آخرینِ صادرشده است. */
      const previous = out[row.order_id];
      const document = { id: row.id, number: row.number, total, revision: Number(row.quote_revision), issuedAt: doc.createdAt,
        billingMode: (doc.snapshot && doc.snapshot.billingMode) || 'full' };
      out[row.order_id] = {
        documentId: row.id, number: row.number, revision: Number(row.quote_revision), issuedAt: doc.createdAt,
        total: (previous ? previous.total : 0) + total,
        documents: [...(previous ? previous.documents : []), document],
      };
    }
    return out;
  }
  /* ---------- اصلاحات ۱۷/بند ۲: رسید وجه و تخصیص آن به فاکتور ----------
     پولِ دریافتی دیگر یک ردیفِ آزاد داخل سفارش نیست: جدول receipts سندِ آن است و
     receipt_allocations می‌گوید هر ریال به کدام فاکتور یا سفارش خورده است. آرایهٔ
     paymentsِ سفارش «بازتاب» است — همان عددی که پروندهٔ اعتباری، گزارش مالی و پنلِ
     مشتری می‌بینند — و فقط سرور آن را می‌نویسد، پس هیچ ایستگاهی عددِ پولِ خودش را نمی‌سازد.
     چکِ وصول‌نشده طبق تصمیم کارفرما مطالبه را کم می‌کند (وضعیت «در دست» زنده است) ولی
     نقدِ صندوق شمرده نمی‌شود؛ برگشتی و باطل هیچ اثری روی هیچ‌کدام ندارند. */
  function mapReceipt(r) {
    return {
      id: r.id, number: r.number, customerId: r.customer_id, orderId: r.order_id,
      method: r.method, amount: r.amount, status: r.status, receivedAt: r.received_at,
      cheque: r.method === receiptEngine.CHEQUE
        ? { number: r.cheque_number, bank: r.cheque_bank, branch: r.cheque_branch, due: r.cheque_due } : null,
      note: r.note, legacyPaymentId: r.legacy_payment_id, opening: !!r.opening,
      createdBy: r.created_by, createdAt: r.created_at, clearedAt: r.cleared_at,
      voidedBy: r.voided_by, voidReason: r.void_reason, voidedAt: r.voided_at,
    };
  }
  function mapAllocation(a) {
    return { id: a.id, receiptId: a.receipt_id, orderId: a.order_id, documentId: a.document_id, amount: a.amount, kind: a.kind, createdAt: a.created_at };
  }
  function placeholders(list) { return list.map(() => '?').join(','); }
  function moneyReceiptRows(where, params) {
    return db.all(`SELECT * FROM receipts${where ? ` WHERE ${where}` : ''} ORDER BY received_at, number`, ...(params || [])).map(mapReceipt);
  }
  function moneyAllocationRows(receiptIds) {
    if (!receiptIds.length) return [];
    return db.all(`SELECT * FROM receipt_allocations WHERE receipt_id IN (${placeholders(receiptIds)}) ORDER BY created_at, id`, ...receiptIds).map(mapAllocation);
  }
  /* پولِ یک مشتری از روی سند، نه از روی آرایهٔ سفارش: جمعِ دریافت‌ها، تخصیص‌خورده و
     باقی‌ماندهٔ «پیش‌پرداخت» که به هیچ فاکتوری نخورده است. */
  function customerMoney(customerId) {
    const rows = moneyReceiptRows('customer_id = ?', [customerId]);
    const allocations = moneyAllocationRows(rows.map(r => r.id));
    return { receipts: rows, allocations, totals: receiptEngine.totals(rows, allocations, customerId) };
  }
  /* بازتابِ یک سفارش: ردیف‌های زندهٔ تخصیص + ردیف‌های قدیمی که به‌دلایلِ امن مهاجرت
     نکرده‌اند (مثلاً مبلغِ غیرصحیح). هیچ ریالی با این جایگزینی گم نمی‌شود. */
  function orderPaymentRows(order) {
    const allocations = db.all('SELECT * FROM receipt_allocations WHERE order_id = ? ORDER BY created_at, id', order.id).map(mapAllocation);
    const receiptRows = allocations.length ? moneyReceiptRows(`id IN (${placeholders([...new Set(allocations.map(a => a.receiptId))])})`, [...new Set(allocations.map(a => a.receiptId))]) : [];
    const mirrored = receiptEngine.mirrorOf(receiptRows, allocations, order.id);
    /* شناسهٔ تخصیص (حتی اگر رسیدش برگشته باشد) و اثرانگشتِ ردیفِ مهاجرت‌شده نشانه‌اند که
       این ردیف را سرور ساخته؛ پس ردیفِ بازتابِ بی‌اعتبارشده به‌جای ماندن در «قدیمی‌ها»،
       از فهرست بیرون می‌رود و بدهی به پرونده برمی‌گردد. */
    const known = new Set([...mirrored.map(m => m.id), ...allocations.map(a => a.id),
      ...db.all("SELECT legacy_payment_id FROM receipts WHERE order_id = ? AND legacy_payment_id <> ''", order.id).map(r => r.legacy_payment_id)]);
    const carried = (order.payments || []).filter(p => p && p.id && !known.has(String(p.id)));
    /* ترتیبِ پایدار: تاریخ، بعد شمارهٔ رسید. شناسهٔ تصادفیِ تخصیص هرگز نباید معیارِ
       چیدمان باشد، وگرنه ردیف‌های هم‌روز در بانکِ سفارش بی‌قاعده جابه‌جا می‌شوند. */
    return [...mirrored, ...carried].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.receiptNumber || '').localeCompare(String(b.receiptNumber || '')) || String(a.id).localeCompare(String(b.id)));
  }
  /* نوشتنِ بازتاب داخل رکورد سفارش — همان مسیری که سرور برای تأیید سفارش هم طی می‌کند:
     نسخهٔ رکورد بالا می‌رود تا ایستگاهِ دیگر بداند عددِ پول تغییر کرده است. */
  function syncOrderPayments(orderIds) {
    const ids = new Set(orderIds);
    for (const order of readKey('printshop_orders_v5') || []) {
      if (!ids.has(order.id)) continue;
      const rows = orderPaymentRows(order);
      if (isDeepStrictEqual(rows, order.payments || [])) continue;
      db.run('UPDATE records SET data = ?, updated_at = ?, rev = rev + 1 WHERE collection = ? AND id = ?',
        JSON.stringify({ ...order, payments: rows }), now(), 'printshop_orders_v5', order.id);
    }
  }
  /* شناسهٔ اثرانگشتِ ردیفِ قدیمی: ردیفی که id ندارد با چکیدهٔ خودِ ردیف نام‌گذاری می‌شود،
     پس اجرای دوبارهٔ مهاجرت (حتی پس از جابه‌جایی ترتیب) همان ردیف را دوباره نمی‌سازد. */
  function legacyIdOf(order, payment) {
    const id = String(payment && payment.id || '');
    if (id) return id.slice(0, 64);
    return 'x' + crypto.createHash('sha1').update(JSON.stringify([order.id, payment && payment.amount, payment && payment.date, payment && payment.method])).digest('hex').slice(0, 24);
  }
  /* مهاجرتِ بانکِ کارفرما + همگام‌سازی بازتاب: هر ردیفِ پرداختِ پیشین یک «رسید افتتاحیه»
     می‌شود. کارفرما انتخاب کرد همین ردیف‌ها خودکار مهاجرت کنند تا یک قاعدهٔ شماره بماند.
     مبلغِ رسید با همان گردکردِ قاعدهٔ قبلی (credit.paidOf) خوانده می‌شود، پس هیچ عددِ
     پرونده‌ای با مهاجرت تکان نمی‌خورد. تاریخِ بی‌اعتبار از خودِ سفارش گرفته می‌شود؛ اگر
     آن هم بی‌اعتبار بود ردیف مهاجرت نمی‌کند و در بازتاب می‌ماند (بی‌صدا حذف نمی‌شود).
     idempotent است: ردیفِ مهاجرت‌شده با legacy_payment_id شناخته می‌شود و دوباره ساخته
     نمی‌شود؛ در همان اجرا سفارش‌های دارایِ تخصیص هم بازتاب‌شان تازه می‌شود، پس اگر
     برنامه پیش از نوشتنِ بازتاب بسته شده باشد، بازبارگذاری خود را درست می‌کند. */
  function syncReceiptLedger() {
    let migrated = 0, kept = 0;
    db.tx(() => {
      const orders = readKey('printshop_orders_v5') || [];
      const invoices = invoicesByOrder();
      const affected = new Set(db.all("SELECT DISTINCT order_id FROM receipt_allocations WHERE order_id <> ''").map(r => r.order_id));
      for (const order of orders) {
        if (!(order.payments || []).length) continue;
        affected.add(order.id);
        /* ردیفی که خودِ سرور ساخته (شناسه‌اش شناسهٔ تخصیص است) یا پیش‌تر مهاجرت کرده،
           دوباره پولِ تازه نمی‌سازد؛ وگرنه هر بازبارگذاری یک رسیدِ تکراری می‌آفرید. */
        const ledgerIds = new Set([
          ...db.all('SELECT id FROM receipt_allocations WHERE order_id = ?', order.id).map(r => r.id),
          ...db.all("SELECT legacy_payment_id FROM receipts WHERE order_id = ? AND legacy_payment_id <> ''", order.id).map(r => r.legacy_payment_id),
        ]);
        for (const p of order.payments) {
          const legacyPaymentId = legacyIdOf(order, p);
          if (ledgerIds.has(legacyPaymentId)) continue;
          const amount = receiptEngine.whole(p && p.amount);
          const day = (typeof (p && p.date) === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) ? p.date
            : (typeof order.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(order.date) ? order.date : '');
          if (!Number.isSafeInteger(amount) || amount <= 0 || !day) { kept++; continue; }
          const id = crypto.randomBytes(16).toString('hex');
          const method = String((p && p.method) || '').trim().slice(0, 40) || receiptEngine.METHODS[0];
          const invoice = invoices[order.id];
          db.run('INSERT INTO receipts(id,number,customer_id,order_id,method,amount,status,received_at,note,legacy_payment_id,opening,created_at,created_by,cleared_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            id, reserveNumber('moneyreceipt', id),
            order.customerId || '', order.id, method, amount, receiptEngine.STATUS.CLEARED, day,
            'رسید افتتاحیه — از ردیف پرداخت پیشین', legacyPaymentId, 1, now(), 'مهاجرت خودکار', day);
          db.run('INSERT INTO receipt_allocations(id,receipt_id,order_id,document_id,amount,kind,created_at) VALUES(?,?,?,?,?,?,?)',
            id + '-a1', id, order.id, invoice ? invoice.documentId : '', amount, invoice ? 'definite' : 'committed', now());
          migrated++;
        }
      }
      syncOrderPayments(affected);
    });
    if (migrated || kept) audit(null, 'receipts_migration', 'receipts', `${migrated} رسید افتتاحیه${kept ? ` — ${kept} ردیف مهاجرت‌ناکردنی` : ''}`);
    return { migrated, kept };
  }
  function mapApproval(r) {
    return {
      id: r.id, customerId: r.customer_id, orderId: r.order_id, quoteRevision: r.quote_revision, reason: r.reason, state: r.state,
      supersededBy: r.superseded_by || null, decidedAt: r.decided_at, decidedBy: r.decided_by, decidedRole: r.decided_role,
      ceiling: r.ceiling, openTotal: r.open_total, definiteDebt: r.definite_debt, overdueDebt: r.overdue_debt,
      commitment: r.commitment, advance: r.advance, overBy: r.over_by,
    };
  }
  function approvalRows(customerId) {
    return db.all('SELECT * FROM credit_approvals WHERE customer_id = ? ORDER BY decided_at DESC, id', typeof customerId === 'string' ? customerId : '').map(mapApproval);
  }
  function activeApprovalFor(orderId, customerId) {
    if (typeof orderId !== 'string' || !orderId || typeof customerId !== 'string' || !customerId) return null;
    const row = db.get('SELECT * FROM credit_approvals WHERE order_id = ? AND customer_id = ? AND state = ? ORDER BY decided_at DESC, id LIMIT 1', orderId, customerId, 'active');
    return row ? mapApproval(row) : null;
  }
  /* «برای کدام سفارش» در سند باید خوانده شود، نه شناسهٔ داخلی: شماره و عنوان از خودِ رکورد سفارش. */
  function withOrderRef(rows, orders) {
    const byId = new Map((orders || []).filter(o => o && o.id).map(o => [o.id, o]));
    return rows.map(a => {
      const o = byId.get(a.orderId);
      return o ? { ...a, orderNumber: o.orderNumber || null, orderLabel: o.title || '' } : a;
    });
  }
  /* سیاست اعتبار: جدول پرونده معتبرتر از رکورد مشتری است؛ نبودِ ردیف یعنی هنوز سقفی تعیین نشده. */
  function policyFor(customer) {
    const row = db.get('SELECT customer_id, ceiling, term_days, warn_percent, note, updated_at, updated_by FROM credit_policies WHERE customer_id = ?', customer.id);
    if (row) return { ceiling: row.ceiling, termDays: row.term_days, warnPercent: row.warn_percent, note: row.note, updatedAt: row.updated_at, updatedBy: row.updated_by, source: 'جدول پروندهٔ اعتباری' };
    if (Number.isSafeInteger(Number(customer.creditLimit)) || Number.isSafeInteger(Number(customer.paymentTermDays))) {
      return { ceiling: Math.max(0, Number(customer.creditLimit) || 0), termDays: Math.max(0, Number(customer.paymentTermDays) || 0), warnPercent: null, note: '', updatedAt: null, updatedBy: '', source: 'رکورد مشتری' };
    }
    return { ceiling: 0, termDays: 0, warnPercent: null, note: '', updatedAt: null, updatedBy: '', source: 'تنظیم نشده' };
  }
  function creditFileOf(customerId, options = {}) {
    const customer = (readKey(CUSTOMER_KEY) || []).find(c => c.id === customerId) || (options.allowGhost ? { id: customerId, name: '' } : null);
    if (!customer) return null;
    const policy = policyFor(customer);
    const scoped = { ...customer, creditLimit: policy.ceiling, paymentTermDays: policy.termDays, ...(policy.warnPercent === null ? {} : { creditWarnPercent: policy.warnPercent }) };
    const all = readKey('printshop_orders_v5') || [];
    const orders = options.excludeOrderId ? all.filter(o => o.id !== options.excludeOrderId) : all;
    const today = new Date(now()).toISOString().slice(0, 10);
    /* اصلاحات ۱۷/بند ۲: باقی‌ماندهٔ رسیدی که به هیچ فاکتوری نخورده، پیش‌پرداختِ پرونده است.
       ردیف‌های تخصیص‌خورده از همان lines خوانده می‌شوند، پس این عدد دوبار شمرده نمی‌شود. */
    const file = credit.creditFileOf(scoped, orders, invoicesByOrder(), today, {
      approvals: withOrderRef(approvalRows(customerId), orders), policySource: policy.source,
      reservedAdvance: customerMoney(customerId).totals.advance,
    });
    file.policy = policy;
    return file;
  }
  /* نقش‌هایی که مبلغ نمی‌بینند شمارهٔ وضعیت و دلیل را می‌گیرند، نه رقم‌ها را. */
  function creditView(file, verdict, fullMoney) {
    if (fullMoney) return { file, verdict };
    return { file: credit.withoutMoney(file, credit.MONEY_KEYS), verdict: verdict ? credit.withoutMoney(verdict, credit.VERDICT_MONEY_KEYS) : null };
  }
  /* مبلغِ قابل‌پرداختِ یک سفارشِ ثبت‌شده، آن‌طور که خودِ سرور از رکورد می‌خواند.
     سفارشِ ناموجود یا پیش‌فاکتورِ سازگارنبوده صفر برمی‌گرداند، نه خطا. */
  function ownPayable(orderId) {
    const order = (readKey('printshop_orders_v5') || []).find(o => o && o.id === orderId);
    if (!order) return 0;
    try { return Math.max(0, credit.payableOf(order)); } catch (_) { return 0; }
  }
  function customerCreditFile(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (![M, F, C].includes(s.user.role)) { audit(s, 'denied_read', 'credit_file'); return { ok: false, code: 'FORBIDDEN', error: 'پروندهٔ اعتباری فقط برای مدیر چاپخانه، مدیر مالی و کارشناس سفارشات است.' }; }
    const q = plainObject(input) ? input : {};
    if (typeof q.customerId !== 'string' || !q.customerId || q.customerId.length > 64) return { ok: false, code: 'VALIDATION_FAILED', error: 'مشتری معتبر نیست.' };
    const file = creditFileOf(q.customerId);
    if (!file) return { ok: false, code: 'NOT_FOUND', error: 'مشتری پیدا نشد.' };
    const full = FULL_MONEY.includes(s.user.role);
    /* مبلغِ سفارشِ در حال ثبت را فقط نقشی می‌فرستد که خودش قیمت را می‌بیند. برای سفارشی که
       پیش‌تر در بانک است، سرور مبلغ را از snapshotِ خودِ همان سفارش می‌خواند تا تصمیم
       «نیازمند مجوز» بین ایستگاه‌ها یکی باشد — رقمی به رابطِ بی‌رقم نشان داده نمی‌شود. */
    const orderId = typeof q.orderId === 'string' ? q.orderId : undefined;
    const claimed = full && Number.isSafeInteger(q.newAmount) && q.newAmount >= 0 ? q.newAmount : 0;
    const amount = claimed || (orderId ? ownPayable(orderId) : 0);
    const verdict = credit.verdictOf(file, amount, orderId);
    const approval = typeof q.orderId === 'string' ? activeApprovalFor(q.orderId, q.customerId) : null;
    const view = creditView(file, verdict, full);
    return {
      ok: true, ...view,
      approval: approval && !full ? credit.withoutMoney(approval, credit.APPROVAL_MONEY_KEYS) : approval,
      fields: credit.FILE_FIELDS,
      canDecide: s.user.role === M,
    };
  }
  /* جدول همهٔ پرونده‌ها (جای CustomerBalancesِ رابط): یک‌بار خوانده می‌شود تا هیچ ایستگاهی
     عددِ خودش را نسازد. مشتری‌های بی‌سفارش و بی‌سیاست فهرست نمی‌آیند. */
  function creditFiles(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (![M, F, C].includes(s.user.role)) { audit(s, 'denied_read', 'credit_files'); return { ok: false, code: 'FORBIDDEN', error: 'پروندهٔ اعتباری فقط برای مدیر چاپخانه، مدیر مالی و کارشناس سفارشات است.' }; }
    const full = FULL_MONEY.includes(s.user.role);
    const orders = readKey('printshop_orders_v5') || [];
    const invoices = invoicesByOrder();
    const today = new Date(now()).toISOString().slice(0, 10);
    const policies = new Map(db.all('SELECT customer_id, ceiling, term_days, warn_percent, note, updated_at, updated_by FROM credit_policies').map(r => [r.customer_id, r]));
    const approvalsByCustomer = new Map();
    for (const a of db.all('SELECT * FROM credit_approvals ORDER BY decided_at DESC, id').map(mapApproval)) {
      const list = approvalsByCustomer.get(a.customerId);
      if (list) list.push(a); else approvalsByCustomer.set(a.customerId, [a]);
    }
    const rows = [];
    const counted = [];
    /* اصلاحات ۱۷/بند ۲: پیش‌پرداختِ تخصیص‌نیافتهٔ هر مشتری یک‌بار از جدول رسید خوانده
       می‌شود؛ جدول میز پرونده‌ها نباید برای هر مشتری دوباره بانک را بگردد. */
    const allReceipts = moneyReceiptRows('', []);
    const allAllocations = moneyAllocationRows(allReceipts.map(r => r.id));
    const advanceByCustomer = new Map();
    for (const id of new Set(allReceipts.map(r => r.customerId))) {
      advanceByCustomer.set(id, receiptEngine.totals(allReceipts, allAllocations, id).advance);
    }
    for (const c of readKey(CUSTOMER_KEY) || []) {
      const policy = policies.get(c.id);
      /* بی‌کاربرد‌ها فهرست نمی‌آیند: نه سیاستی دارند، نه سفارشی که ردیف پرونده بسازد. */
      const hasActivity = orders.some(o => o.customerId === c.id && credit.classify(o, invoices[o.id]) !== 'ignored');
      if (!policy && !hasActivity) continue;
      const scoped = { ...c, creditLimit: policy ? policy.ceiling : Number(c.creditLimit) || 0, paymentTermDays: policy ? policy.term_days : Number(c.paymentTermDays) || 0, ...(policy && policy.warn_percent ? { creditWarnPercent: policy.warn_percent } : {}) };
      const file = credit.creditFileOf(scoped, orders, invoices, today, { policySource: policy ? 'جدول پروندهٔ اعتباری' : 'تنظیم نشده', reservedAdvance: advanceByCustomer.get(c.id) || 0 });
      counted.push(file);
      const withDocs = { ...file, approvals: withOrderRef(approvalsByCustomer.get(c.id) || [], orders) };
      const row = full ? withDocs : credit.withoutMoney(withDocs, credit.MONEY_KEYS);
      rows.push({ ...row, phone: c.phone || '', address: c.address || '', policyNote: policy ? policy.note : '', policyUpdatedBy: policy ? policy.updated_by : '', policyUpdatedAt: policy ? policy.updated_at : null });
    }
    rows.sort((a, b) => (full ? b.openTotal - a.openTotal : 0) || String(a.customerName).localeCompare(String(b.customerName), 'fa'));
    /* شمارش‌ها از پروندهٔ کامل می‌آیند، هرچند رقم‌ها برای این نقش سانسور شده باشد. */
    const total = key => counted.reduce((s, f) => s + f[key], 0);
    return { ok: true, today, money: full, fields: credit.FILE_FIELDS, rows, kpis: {
      customers: counted.length,
      withCeiling: counted.filter(r => r.ceiling > 0).length,
      blocked: counted.filter(r => r.status === credit.CREDIT.BLOCKED).length,
      warning: counted.filter(r => r.status === credit.CREDIT.WARNING).length,
      openDebt: counted.filter(r => r.openTotal > 0).length,
      overdue: counted.filter(r => r.overdueCount > 0).length,
      noPolicy: counted.filter(r => r.status === credit.CREDIT.NO_POLICY).length,
      /* جمع‌های ریالی فقط برای نقش‌های دارایِ حسابداری برگردانده می‌شود — کارشناس سفارشات
         از این جدول هم نباید «جمع مطالبات» چاپخانه را ببیند. */
      ...(full ? { totalDefinite: total('definiteDebt'), totalOverdue: total('overdueDebt'), totalCommitment: total('commitment'), totalAdvance: total('advance'), totalNet: total('netCommitment') } : {}),
    } };
  }
  function saveCreditPolicy(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!FULL_MONEY.includes(s.user.role)) { audit(s, 'denied_write', 'credit_policy'); return { ok: false, code: 'FORBIDDEN', error: 'سیاست اعتبار فقط در اختیار مدیر چاپخانه و مدیر مالی است.' }; }
    if (!plainObject(input)) return { ok: false, code: 'VALIDATION_FAILED', error: 'درخواست نامعتبر است.' };
    try {
      const customerId = typeof input.customerId === 'string' ? input.customerId : '';
      if (!customerId || customerId.length > 64) throw new Error('مشتری معتبر نیست.');
      const customer = (readKey(CUSTOMER_KEY) || []).find(c => c.id === customerId);
      if (!customer) return { ok: false, code: 'NOT_FOUND', error: 'مشتری پیدا نشد.' };
      const whole = (value, label, max) => {
        const n = Number(value);
        if (!Number.isSafeInteger(n) || n < 0 || (max !== undefined && n > max)) throw new Error(`${label} معتبر نیست.`);
        return n;
      };
      const ceiling = whole(input.ceiling, 'سقف اعتبار', 100000000000000);
      const termDays = whole(input.termDays, 'مهلت پرداخت (روز)', 3650);
      const warnPercent = input.warnPercent === undefined || input.warnPercent === null || input.warnPercent === '' ? credit.DEFAULT_WARN_PERCENT : whole(input.warnPercent, 'درصد هشدار', 100);
      if (warnPercent < 1) throw new Error('درصد هشدار معتبر نیست.');
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
      db.tx(() => {
        db.run('INSERT INTO credit_policies(customer_id,ceiling,term_days,warn_percent,note,updated_at,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(customer_id) DO UPDATE SET ceiling = excluded.ceiling, term_days = excluded.term_days, warn_percent = excluded.warn_percent, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
          customerId, ceiling, termDays, warnPercent, note, now(), s.user.name);
        audit(s, 'credit_policy_save', customer.name || customerId, `سقف ${ceiling} — مهلت ${termDays} روز — هشدار ${warnPercent}٪`);
      });
      const file = creditFileOf(customerId);
      return { ok: true, policy: file.policy, status: file.status };
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  /* مجوز استثنایی مدیر = سند، نه فقط رمز. چه کسی / چه زمانی / کدام سفارش / چه مبلغی / چه دلیلی.
     ردیف حذف نمی‌شود؛ نسخهٔ جدید، ردیف فعال قبلی را superseded می‌کند و هر دو می‌مانند. */
  function approveCreditException(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (s.user.role !== M) { audit(s, 'denied_write', 'credit_approval'); return { ok: false, code: 'FORBIDDEN', error: 'مجوز استثنایی اعتبار فقط با مدیر چاپخانه ثبت می‌شود.' }; }
    if (!plainObject(input)) return { ok: false, code: 'VALIDATION_FAILED', error: 'درخواست نامعتبر است.' };
    try {
      const customerId = typeof input.customerId === 'string' ? input.customerId : '';
      const orderId = typeof input.orderId === 'string' && input.orderId.length <= 64 ? input.orderId : '';
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (!customerId || !orderId) throw new Error('مشتری و سفارش لازم است.');
      if (reason.length < 10) throw new Error('دلیل مجوز باید حداقل ۱۰ نویسه باشد؛ «مجوز» یک سند است نه یک کلیک.');
      if (reason.length > 2000) throw new Error('دلیل مجوز خیلی بلند است.');
      const pin = typeof input.pin === 'string' ? input.pin : '';
      const verified = verifyPin(token, pin);
      if (!verified.ok || verified.valid !== true) throw Object.assign(new Error(verified.error || 'رمز مدیر تأیید نشد.'), { code: 'FORBIDDEN' });
      const file = creditFileOf(customerId, { excludeOrderId: orderId });
      if (!file) return { ok: false, code: 'NOT_FOUND', error: 'مشتری پیدا نشد.' };
      const order = (readKey('printshop_orders_v5') || []).find(o => o.id === orderId);
      const verdict = credit.verdictOf(file, order ? credit.payableOf(order) : 0, orderId);
      let row = null;
      db.tx(() => {
        const active = db.all('SELECT id FROM credit_approvals WHERE order_id = ? AND customer_id = ? AND state = ?', orderId, customerId, 'active');
        const id = crypto.randomBytes(16).toString('hex');
        row = { id, customerId, orderId, quoteRevision: order ? Number(order.quoteRev) || 1 : null, reason,
          ceiling: file.ceiling, openTotal: file.openTotal, definiteDebt: file.definiteDebt, overdueDebt: file.overdueDebt,
          commitment: file.commitment, advance: file.advance, overBy: verdict.overBy, decidedAt: now(), decidedBy: s.user.name, decidedRole: s.user.role };
        for (const previous of active) {
          db.run('UPDATE credit_approvals SET state = ?, superseded_by = ? WHERE id = ?', 'superseded', id, previous.id);
        }
        db.run('INSERT INTO credit_approvals(id,customer_id,order_id,quote_revision,ceiling,open_total,definite_debt,overdue_debt,commitment,advance,over_by,reason,state,decided_at,decided_by,decided_role) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          row.id, row.customerId, row.orderId, row.quoteRevision, row.ceiling, row.openTotal, row.definiteDebt, row.overdueDebt, row.commitment, row.advance, row.overBy, row.reason, 'active', row.decidedAt, row.decidedBy, row.decidedRole);
        /* پاسخ از همان ردیفِ بانک خوانده می‌شود تا شکلش با فهرستِ مجوزهای پرونده یکی باشد. */
        row = mapApproval(db.get('SELECT * FROM credit_approvals WHERE id = ?', row.id));
        audit(s, 'credit_approval', orderId, `مشتری ${customerId} — باز ${row.openTotal} — عبور ${row.overBy}`);
      });
      return { ok: true, approval: row };
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  /* ---- اصلاحات ۱۷/بند ۲/۲: دفترِ رسیدهای وجه ----
     پولِ دریافتی فقط از همین سه مسیر (ثبت رسید / وضعیت چک / ابطال) وارد بانک می‌شود.
     ردیفِ paymentsِ سفارش چیزی نیست جز بازتابِ خواندنیِ همین رسیدها؛ نوشتنِ مستقیمِ آن
     از راه be:set بسته است (پایینِ همان تابع). دروازهٔ نوشتن مثل سیاستِ اعتبار، فقط
     مدیر چاپخانه و مدیر مالی است — کارشناس سفارشات رقمِ رسید را نمی‌بیند. */
  const RECEIPT_WRITE = [M, F];
  /* هیچ‌کس از بیرون نمی‌تواند وضعیتی بسازد که موتور نمی‌شناسد؛ تبدیل‌ها هم یک‌طرفه‌اند:
     وصول‌شده و باطل دیگر وضعیتی ندارند (کارفرما: سندِ قطعی را اصلاحیه می‌کندن نه ویرایش). */
  const CHEQUE_ACTIONS = { held: ['in_transit', 'cleared', 'bounced'], in_transit: ['cleared', 'bounced'], cleared: [], bounced: ['held', 'in_transit', 'cleared'], void: [] };
  /* سه عملیتِ رو به جلو، نه بیشتر: «در دست» مقصد نیست، چون بازگشتِ پول فقط با ابطالِ سندِ
     رسید انجام می‌شود. همین فهرست به رابط داده می‌شود تا دکمه‌ها را از جدولِ خودش نسازد. */
  const CHEQUE_TARGETS = ['in_transit', 'cleared', 'bounced'];
  const faAmount = value => {
    const text = String(value === undefined || value === null ? '' : value)
      .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫،\s]/g, '');
    return /^-?\d+$/.test(text) ? Number(text) : NaN;
  };
  function moneyLedgerOf(customerId) {
    const rows = moneyReceiptRows('customer_id = ?', [customerId]);
    const allocations = moneyAllocationRows(rows.map(r => r.id));
    const byReceipt = new Map();
    for (const a of allocations) { const list = byReceipt.get(a.receiptId); if (list) list.push(a); else byReceipt.set(a.receiptId, [a]); }
    return {
      totals: receiptEngine.totals(rows, allocations, customerId),
      receipts: rows.map(r => ({ ...r, allocations: (byReceipt.get(r.id) || []).map(mapAllocation) })),
    };
  }
  function receiptOfId(id) {
    if (typeof id !== 'string' || !id || id.length > 64) return null;
    const row = db.get('SELECT * FROM receipts WHERE id = ?', id);
    return row ? mapReceipt(row) : null;
  }
  function receiptsFor(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!RECEIPT_WRITE.includes(s.user.role)) { audit(s, 'denied_read', 'money_receipts'); return { ok: false, code: 'FORBIDDEN', error: 'دفتر رسیدهای وجه فقط در اختیار مدیر چاپخانه و مدیر مالی است.' }; }
    const q = plainObject(input) ? input : {};
    const customerId = typeof q.customerId === 'string' ? q.customerId : '';
    if (!customerId || customerId.length > 64) return { ok: false, code: 'VALIDATION_FAILED', error: 'مشتری معتبر نیست.' };
    const ledger = moneyLedgerOf(customerId);
    /* پیشنهادِ تخصیص هم همین‌جا ساخته می‌شود: رقم‌ها را فقط سرور می‌شمارد، پس ایستگاه
       چیزی را که خودش حساب کرده نمی‌فرستد — فقط مبلغِ تایپ‌شده را. */
    const amount = faAmount(q.amount);
    const file = creditFileOf(customerId);
    const proposal = Number.isSafeInteger(amount) && amount > 0 && file
      ? receiptEngine.proposeAllocations(file.lines, amount) : null;
    return {
      ok: true, receipts: ledger.receipts, totals: ledger.totals,
      lines: file ? file.lines : [], proposal, advance: proposal ? proposal.advance : 0,
      methods: receiptEngine.METHODS, statuses: receiptEngine.STATUS_LABELS, fields: receiptEngine.RECEIPT_FIELDS,
      chequeActions: Object.fromEntries(Object.entries(CHEQUE_ACTIONS).map(([from, list]) => [from, list.filter(a => CHEQUE_TARGETS.includes(a))])),
    };
  }
  /* ردیف‌های تخصیص از پروندهٔ همان لحظه خوانده می‌شوند؛ هر مبلغ یا سندی که با
     ماندهٔ واقعیِ سفارشِ همان ایستگاه نخواند، کل درخواست رد می‌شود (fail‑closed). */
  function resolveAllocations(file, requested, amount) {
    const perLine = new Map();
    const liveInvoices = invoicesByOrder();
    const rows = [];
    for (const raw of requested) {
      const orderId = String(raw && raw.orderId || '');
      const line = (file.lines || []).find(l => l.orderId === orderId);
      if (!line) throw new Error('سفارشِ تخصیص در پروندهٔ اعتباریِ این مشتری نیست یا مانده‌ای ندارد.');
      const take = faAmount(raw && raw.amount);
      if (!Number.isSafeInteger(take) || take <= 0) throw new Error('مبلغ تخصیص باید عدد صحیح مثبت به ریال باشد.');
      const used = (perLine.get(orderId) || 0) + take;
      if (used > line.open) throw new Error(`تخصیص از ماندهٔ سفارش ${line.orderNumber || ''} (${line.open.toLocaleString('fa-IR')}) بیشتر است.`);
      const documentId = raw && raw.documentId !== undefined && raw.documentId !== null && raw.documentId !== ''
        ? String(raw.documentId) : (line.documentId || '');
      /* بند ۳: پول می‌تواند به هر یک از فاکتورهای زندهٔ همین سفارش بخورد، ولی به سندی
         که در بانک نیست یا ابطال شده نیست — فهرست را خودِ سرور همان لحظه می‌خواند. */
      const docs = liveInvoices[orderId];
      if (documentId && !(docs && docs.documents.some(d => d.id === documentId))) throw new Error('سندِ تخصیص با فاکتورهای صادرشدهٔ این سفارش یکی نیست.');
      perLine.set(orderId, used);
      rows.push({ orderId, documentId, amount: take, kind: line.kind });
    }
    const allocated = rows.reduce((sum, r) => sum + r.amount, 0);
    if (allocated > amount) throw new Error('جمع تخصیص‌ها از مبلغ رسید بیشتر است.');
    return { rows, allocated, advance: amount - allocated };
  }
  function recordReceipt(token, payload) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!RECEIPT_WRITE.includes(s.user.role)) { audit(s, 'denied_write', 'money_receipt'); return { ok: false, code: 'FORBIDDEN', error: 'ثبت رسید وجه فقط در اختیار مدیر چاپخانه و مدیر مالی است.' }; }
    if (!plainObject(payload)) return { ok: false, code: 'VALIDATION_FAILED', error: 'درخواست نامعتبر است.' };
    try {
      const customerId = typeof payload.customerId === 'string' ? payload.customerId : '';
      if (!customerId || customerId.length > 64) throw new Error('مشتری معتبر نیست.');
      const customer = (readKey(CUSTOMER_KEY) || []).find(c => c.id === customerId);
      if (!customer) return { ok: false, code: 'NOT_FOUND', error: 'مشتری پیدا نشد.' };
      if (!usableParty(customer)) throw Object.assign(new Error('مشتری رسید باید ثبت و تأیید شده باشد.'), { code: 'FORBIDDEN' });
      const file = creditFileOf(customerId);
      if (!file) return { ok: false, code: 'NOT_FOUND', error: 'مشتری پیدا نشد.' };
      const amount = faAmount(payload.amount);
      const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';
      if (orderId && !(readKey('printshop_orders_v5') || []).some(o => o && o.id === orderId && o.customerId === customerId)) {
        throw Object.assign(new Error('سفارشِ متصل به رسید مالِ همین مشتری نیست.'), { code: 'FORBIDDEN' });
      }
      const requested = payload.allocations === undefined || payload.allocations === null
        ? receiptEngine.proposeAllocations(file.lines, amount).rows : (Array.isArray(payload.allocations) ? payload.allocations : null);
      if (!requested) throw new Error('ردیف‌های تخصیص معتبر نیستند.');
      const resolved = resolveAllocations(file, requested, amount);
      const draft = {
        customerId, orderId, amount, method: payload.method, status: payload.status,
        receivedAt: payload.receivedAt || payload.date, chequeNumber: payload.chequeNumber, chequeBank: payload.chequeBank,
        chequeBranch: payload.chequeBranch, chequeDue: payload.chequeDue, note: payload.note, createdAt: now(),
      };
      let result;
      db.tx(() => {
        const id = crypto.randomBytes(12).toString('hex');
        const number = reserveNumber('moneyreceipt', id);
        const record = receiptEngine.receiptOf({ ...draft, id, number }, { id: s.user.id, name: s.user.name, role: s.user.role });
        db.run('INSERT INTO receipts(id,number,customer_id,order_id,method,amount,status,received_at,cheque_number,cheque_bank,cheque_branch,cheque_due,note,legacy_payment_id,opening,created_at,created_by,cleared_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          record.id, record.number, record.customerId, record.orderId, record.method, record.amount, record.status, record.receivedAt,
          record.cheque ? record.cheque.number : '', record.cheque ? record.cheque.bank : '', record.cheque ? record.cheque.branch : '', record.cheque ? record.cheque.due : '',
          record.note, '', 0, record.createdAt, s.user.name, record.status === receiptEngine.STATUS.CLEARED ? record.receivedAt : '');
        for (const row of resolved.rows) {
          db.run('INSERT INTO receipt_allocations(id,receipt_id,order_id,document_id,amount,kind,created_at) VALUES(?,?,?,?,?,?,?)',
            crypto.randomBytes(12).toString('hex'), id, row.orderId, row.documentId, row.amount, row.kind, now());
        }
        const affected = new Set([...resolved.rows.map(r => r.orderId), record.orderId].filter(Boolean));
        syncOrderPayments(affected);
        audit(s, 'money_receipt', record.number, `${record.method} ${record.amount.toLocaleString('fa-IR')} — تخصیص ${resolved.allocated.toLocaleString('fa-IR')}${resolved.advance ? ` — پیش‌پرداخت ${resolved.advance.toLocaleString('fa-IR')}` : ''}`);
        result = { ok: true, receipt: { ...mapReceipt(db.get('SELECT * FROM receipts WHERE id = ?', id)), allocations: resolved.rows },
          allocated: resolved.allocated, advance: resolved.advance, file: creditFileOf(customerId) };
      });
      return result;
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  /* وضعیت چک: گرفتن → در جریان وصول → وصول/برگشت. وصولِ نهایی و ابطال بازگشت‌ناپذیرند؛
     برگشتی دوباره قابل ارائه است، و همان لحظه بدهی به پرونده برمی‌گردد (آزمون بند ۲/۱). */
  function receiptStatusWrite(s, id, next, patch) {
    const row = db.get('SELECT * FROM receipts WHERE id = ?', id);
    if (!row) return { ok: false, code: 'NOT_FOUND', error: 'رسید پیدا نشد.' };
    if (row.status === next) return { ok: false, code: 'VALIDATION_FAILED', error: 'رسید همین حالا در این وضعیت است.' };
    if (!CHEQUE_ACTIONS[row.status].includes(next)) {
      throw Object.assign(new Error(`وضعیت «${receiptEngine.STATUS_LABELS[row.status] || row.status}» به «${receiptEngine.STATUS_LABELS[next] || next}» تغییر نمی‌کند؛ برای بازگشتِ پول، رسید را باطل کنید.`), { code: 'FORBIDDEN' });
    }
    db.run('UPDATE receipts SET status = ?, cleared_at = ? WHERE id = ?', next, patch.clearedAt || '', id);
    const affected = new Set([
      ...db.all('SELECT DISTINCT order_id FROM receipt_allocations WHERE receipt_id = ? AND order_id <> \'\'', id).map(r => r.order_id),
      row.order_id,
    ].filter(Boolean));
    syncOrderPayments(affected);
    audit(s, 'money_receipt_status', row.number, `${receiptEngine.STATUS_LABELS[row.status]} ← ${receiptEngine.STATUS_LABELS[next]}`);
    return { ok: true, receipt: mapReceipt(db.get('SELECT * FROM receipts WHERE id = ?', id)), file: creditFileOf(row.customer_id) };
  }
  function chequeAction(token, id, action) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!RECEIPT_WRITE.includes(s.user.role)) { audit(s, 'denied_write', 'money_receipt_status'); return { ok: false, code: 'FORBIDDEN', error: 'وضعیت چک فقط توسط مدیر چاپخانه و مدیر مالی تغییر می‌کند.' }; }
    try {
      const record = receiptOfId(id);
      if (!record) return { ok: false, code: 'NOT_FOUND', error: 'رسید پیدا نشد.' };
      if (record.method !== receiptEngine.CHEQUE) throw Object.assign(new Error('تنها چک دست‌به‌دست می‌شود؛ دریافتِ نقدی یا حواله همان لحظه وصول شده است.'), { code: 'FORBIDDEN' });
      const next = String(action);
      if (!CHEQUE_TARGETS.includes(next)) throw new Error('عملیت چک شناخته‌شده نیست.');
      const today = new Date(now()).toISOString().slice(0, 10);
      return db.tx(() => receiptStatusWrite(s, record.id, next, { clearedAt: next === receiptEngine.STATUS.CLEARED ? today : '' }));
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  /* ابطال رسید = سند، نه کلیک: دلیل نوشته می‌شود و ردیف در بانک می‌ماند.
     تخصیص‌هایش از بازتاب بیرون می‌روند، پس بدهیِ مشتری برمی‌گردد و عدد دوباره شمرده نمی‌شود. */
  function voidReceipt(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!RECEIPT_WRITE.includes(s.user.role)) { audit(s, 'denied_write', 'money_receipt_void'); return { ok: false, code: 'FORBIDDEN', error: 'ابطال رسید وجه فقط در اختیار مدیر چاپخانه و مدیر مالی است.' }; }
    const q = plainObject(input) ? input : {};
    try {
      const record = receiptOfId(typeof q.id === 'string' ? q.id : '');
      if (!record) return { ok: false, code: 'NOT_FOUND', error: 'رسید پیدا نشد.' };
      const reason = typeof q.reason === 'string' ? q.reason.trim() : '';
      if (reason.length < 10) throw new Error('دلیل ابطال باید حداقل ۱۰ نویسه باشد؛ ابطالِ رسید یک سند است نه یک کلیک.');
      if (reason.length > 2000) throw new Error('دلیل ابطال خیلی بلند است.');
      if (record.status === receiptEngine.STATUS.VOID) throw new Error('این رسید پیش‌تر باطل شده است.');
      let result;
      db.tx(() => {
        db.run("UPDATE receipts SET status = 'void', voided_by = ?, void_reason = ?, voided_at = ? WHERE id = ?", s.user.name, reason, now(), record.id);
        const affected = new Set([
          ...db.all("SELECT DISTINCT order_id FROM receipt_allocations WHERE receipt_id = ? AND order_id <> ''", record.id).map(r => r.order_id),
          record.orderId,
        ].filter(Boolean));
        syncOrderPayments(affected);
        audit(s, 'money_receipt_void', record.number, reason);
        result = { ok: true, receipt: mapReceipt(db.get('SELECT * FROM receipts WHERE id = ?', record.id)), file: creditFileOf(record.customerId) };
      });
      return result;
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  /* ۵/ت گزارش تحویل: دو جدول سمت سرور حساب می‌شوند تا هر ایستگاه یک عدد ببیند.
     «باید تحویل شود» = سفارش‌های باز (تحویل‌نشده و نه لغو/بایگانی) با موعد ثبت‌شده؛ «تحویل‌شده» = سفارش‌هایی که deliveredAt دارند.
     فیلدهای واقعی: method/address/receiver/phone از فرمِ سفارش و deliveredAt/deliveredBy از سرور.
     ستون پولی ندارد (طبق طرح، گزارش تحویل مبلغ نمی‌خواهد). «تاریخ آماده‌سازی» و «امضای تحویل‌گیرنده» فیلد ندارند؛
     پس «تحویل‌گیرنده» همان مقدار فرم است نه امضای واقعی. */
  function deliveryReport(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!REPORT_ROLES.includes(s.user.role)) { audit(s, 'denied_read', 'delivery_report'); return { ok: false, code: 'FORBIDDEN', error: 'دسترسی مجاز نیست.' }; }
    const { orderStage, isDeliveryStage } = require('./workflow');
    const q = plainObject(input) ? input : {};
    const isoDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v).slice(0, 10) : '';
    const from = isoDay(q.from), to = isoDay(q.to);
    const customerId = typeof q.customerId === 'string' ? q.customerId : '';
    const onlyOverdue = q.onlyOverdue === true;
    const today = new Date(now()).toISOString().slice(0, 10);
    const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
    const currentStage = o => orderStage(o).stage;
    const dv = o => o.delivery || {};
    const product = o => [...new Set((o.items || []).map(it => it && it.productName).filter(Boolean))].join('، ') || '—';
    const matchCustomer = o => !customerId || o.customerId === customerId;
    const all = readKey('printshop_orders_v5') || [];
    const due = all.filter(o => o && !o.deliveredAt && !CLOSED_STATUSES.includes(o.status) && matchCustomer(o))
      .map(o => {
        const dueDate = isoDay(o.deliveryDate);
        const cs = currentStage(o);
        return {
          orderId: o.id, orderNumber: String(o.orderNumber || ''), customerName: o.customerName || '', product: product(o),
          dueDate, daysToDue: dueDate ? dayDiff(dueDate, today) : null, overdue: dueDate ? dueDate < today : false,
          stage: cs, status: o.status || '', ready: o.status === 'آماده تحویل' || isDeliveryStage(cs),
          method: dv(o).method || '', address: dv(o).address || '', receiver: dv(o).receiver || '', phone: dv(o).phone || '',
        };
      }).filter(r => {
        if (from && (!r.dueDate || r.dueDate < from)) return false;
        if (to && (!r.dueDate || r.dueDate > to)) return false;
        if (onlyOverdue && !r.overdue) return false;
        return true;
      });
    due.sort((a, b) => {
      const ad = a.dueDate || '9999-12-31', bd = b.dueDate || '9999-12-31';
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
    const delivered = all.filter(o => o && o.deliveredAt && matchCustomer(o))
      .map(o => {
        const deliveredAt = isoDay(o.deliveredAt), dueDate = isoDay(o.deliveryDate);
        return {
          orderId: o.id, orderNumber: String(o.orderNumber || ''), customerName: o.customerName || '', product: product(o),
          deliveredAt, deliveredByName: (o.deliveredBy && o.deliveredBy.name) || '', deliveredByRole: (o.deliveredBy && o.deliveredBy.role) || '',
          dueDate, late: dueDate && deliveredAt ? deliveredAt > dueDate : false,
          method: dv(o).method || '', address: dv(o).address || '', receiver: dv(o).receiver || '', phone: dv(o).phone || '',
        };
      }).filter(r => {
        if (from && (!r.deliveredAt || r.deliveredAt < from)) return false;
        if (to && (!r.deliveredAt || r.deliveredAt > to)) return false;
        return true;
      });
    delivered.sort((a, b) => (a.deliveredAt < b.deliveredAt ? 1 : a.deliveredAt > b.deliveredAt ? -1 : 0));
    const kpis = {
      totalRecords: all.length, dueCount: due.length, dueOverdue: due.filter(r => r.overdue).length, dueReady: due.filter(r => r.ready).length,
      deliveredCount: delivered.length, deliveredLate: delivered.filter(r => r.late).length,
    };
    return { ok: true, due, delivered, kpis, today };
  }
  /* ۵/ث گزارش مالی و تسویه. فقط مدیر چاپخانه و مدیر مالی (FULL_MONEY) می‌خوانند؛ بقیه FORBIDDEN.
     قاعدهٔ عدد (PRC-12): هر مبلغ از همان snapshot ذخیره‌شده روی سفارش خوانده می‌شود؛ هیچ بازمحاسبه‌ای
     روی نرخ‌ها انجام نمی‌شود. «فروش» = totalِ snapshot؛ «پیش از مالیات» = subtotal؛ «مالیات سند» = taxAmount.
     «مالیات ۱۰٪ فرضی» فقط یک پیش‌نمایش سمت سرور است (عدد قانونی نیست، OPEN-11) و هیچ‌جا نوشته نمی‌شود.
     «اتمام سفارش» تعریف‌نشده است (OPEN-07)؛ پس «وضعیت سند» واقعیتِ سند را می‌گوید (فاکتور/پیش‌فاکتور/بی‌سند)
     و «فروش» همهٔ سفارش‌های دارای snapshot معتبر در بازه است، نه فقط بسته‌شده‌ها. */
  function financeReport(token, input) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!FULL_MONEY.includes(s.user.role)) { audit(s, 'denied_read', 'finance_report'); return { ok: false, code: 'FORBIDDEN', error: 'گزارش مالی فقط در اختیار مدیر چاپخانه و مدیر مالی است.' }; }
    const q = plainObject(input) ? input : {};
    const isoDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v).slice(0, 10) : '';
    const from = isoDay(q.from), to = isoDay(q.to);
    const customerId = typeof q.customerId === 'string' ? q.customerId : '';
    const docStatus = ['invoice', 'quote', 'none'].includes(q.docStatus) ? q.docStatus : '';
    const onlyDebt = q.onlyDebt === true;
    const taxPreview = q.taxPreview === true;
    const today = new Date(now()).toISOString().slice(0, 10);
    const number = x => Number.isFinite(Number(x)) ? Number(x) : 0;
    const docs = readKey('printshop_documents_v1') || [];
    const issuedByOrder = new Map();
    for (const d of docs) {
      if (!d || d.status !== 'issued' || !d.orderId) continue;
      const entry = issuedByOrder.get(d.orderId) || { invoice: false, quote: false };
      if (d.type === 'invoice') entry.invoice = true; else if (d.type === 'quote') entry.quote = true;
      issuedByOrder.set(d.orderId, entry);
    }
    const all = readKey('printshop_orders_v5') || [];
    const scoped = all.filter(o => o).filter(o => {
      const d = isoDay(o.date);
      if (from && (!d || d < from)) return false;
      if (to && (!d || d > to)) return false;
      if (customerId && o.customerId !== customerId) return false;
      return true;
    }).map(o => {
      const result = o.pricing && o.pricing.result;
      const valid = !!result && Number.isSafeInteger(result.total) && result.total >= 0 && result.currency === 'IRR';
      const paid = (o.payments || []).reduce((sum, p) => sum + number(p.amount), 0);
      const issued = issuedByOrder.get(o.id) || { invoice: false, quote: false };
      const doc = issued.invoice ? 'invoice' : issued.quote ? 'quote' : 'none';
      const preTax = valid ? (Number.isSafeInteger(result.subtotal) ? result.subtotal : result.total - number(result.taxAmount)) : null;
      const row = {
        orderId: o.id, orderNumber: String(o.orderNumber || ''), customerId: o.customerId || '', customerName: o.customerName || '',
        date: isoDay(o.date), sales: valid ? result.total : null, preTax, snapshotTax: valid ? number(result.taxAmount) : null,
        received: paid, balance: valid ? result.total - paid : null,
        docStatus: doc, customerConfirmed: !!(o.workflow && o.workflow.customerConfirmation), hasLicense: !!(o.workflow && o.workflow.productionAuthorization),
      };
      if (taxPreview && preTax !== null) { row.previewTax = Math.round(preTax * 0.10); row.previewTotal = preTax + row.previewTax; }
      return row;
    });
    const kpiRows = scoped.filter(r => !docStatus || r.docStatus === docStatus);
    const kpis = {
      totalRecords: kpiRows.length,
      salesPreTax: kpiRows.reduce((sum, r) => sum + (r.preTax || 0), 0),
      received: kpiRows.reduce((sum, r) => sum + r.received, 0),
      openDebt: kpiRows.reduce((sum, r) => sum + Math.max(0, r.balance || 0), 0),
      invoiceCount: kpiRows.filter(r => r.docStatus === 'invoice').length,
      unansweredQuotes: kpiRows.filter(r => r.docStatus === 'quote' && !r.customerConfirmed).length,
      debtors: new Set(kpiRows.filter(r => r.balance !== null && r.balance > 0 && r.customerId).map(r => r.customerId)).size,
    };
    let rows = kpiRows;
    if (onlyDebt) rows = rows.filter(r => r.balance !== null && r.balance > 0);
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.orderNumber).localeCompare(String(b.orderNumber)));
    return { ok: true, rows, kpis, moneyIncluded: true, taxPreview, today };
  }
  const NUMBERED_KEYS = { printshop_orders_v5: ['order', 'orderNumber'], printshop_letters_v1: ['letter', 'number'], printshop_receipts_v1: ['receipt', 'receiptNumber'], printshop_consignments_v1: ['consignmentreceipt', 'receiptNumber'] };
  function existingNumbers(type) {
    if (type === 'stockmovement') return (readKey('printshop_inventory_v3') || []).flatMap(i => (i.movements || []).map(m => m.movementNumber)).filter(Boolean);
    /* اصلاحات ۱۷/بند ۲: شمارهٔ رسید وجه در جدولِ خودش است، نه در جدول اسناد مالی. */
    if (type === 'moneyreceipt') return db.all('SELECT number FROM receipts').map(r => r.number);
    const pair = Object.entries(NUMBERED_KEYS).find(([, spec]) => spec[0] === type);
    return pair ? (readKey(pair[0]) || []).map(r => r[pair[1][1]]).filter(v => v !== undefined && v !== '')
      : db.all('SELECT number FROM financial_documents WHERE type = ?', type).map(r => r.number);
  }
  function readNumberingSettings() {
    const { TYPES, defaults, serialOf } = require('./numbering');
    const settings = defaults();
    for (const type of TYPES) {
      const saved = meta.get('numbering:' + type);
      if (saved) settings[type] = { ...settings[type], ...JSON.parse(saved) };
      const highest = existingNumbers(type).reduce((max, number) => Math.max(max, serialOf(number, settings[type]) || 0), 0);
      const reserved = db.get('SELECT MAX(serial) AS n FROM numbering_reservations WHERE type = ?', type);
      settings[type].next = Math.max(settings[type].next, settings[type].start, highest + 1, (reserved.n || 0) + 1);
    }
    return settings;
  }
  function numberingSettings(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (s.user.role !== M) return { ok: false, code: 'FORBIDDEN', error: 'تنظیم شماره‌گذاری فقط در اختیار مدیر است.' };
    return { ok: true, settings: readNumberingSettings() };
  }
  function saveNumberingSettings(token, configs) {
    const s = sess(token); if (!s) return authFailure(token);
    if (s.user.role !== M) return { ok: false, code: 'FORBIDDEN', error: 'تنظیم شماره‌گذاری فقط در اختیار مدیر است.' };
    try {
      const { TYPES, validateConfig } = require('./numbering');
      if (!plainObject(configs) || Object.keys(configs).length !== TYPES.length || Object.keys(configs).some(k => !TYPES.includes(k))) throw new Error(`تنظیمات هر ${TYPES.length} نوع شماره لازم است.`);
      let settings;
      db.tx(() => {
        const previous = readNumberingSettings();
        settings = Object.fromEntries(TYPES.map(type => {
          const config = validateConfig(configs[type]);
          if (config.next < previous[type].next) throw new Error('شماره بعدی قابل عقب‌بردن نیست؛ تنظیمات تازه را دریافت کنید.');
          return [type, config];
        }));
        for (const type of TYPES) {
          meta.set('numbering:' + type, JSON.stringify(settings[type]));
          if (!isDeepStrictEqual(previous[type], settings[type])) audit(s, 'numbering_settings_changed', type, JSON.stringify({ before: previous[type], after: settings[type] }));
        }
      });
      return { ok: true, settings: readNumberingSettings() };
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  // Called only inside the transaction that commits the owning record.
  function reserveNumber(type, recordId) {
    const { formatNumber, MAX_SERIAL } = require('./numbering');
    const previous = db.get('SELECT number FROM numbering_reservations WHERE type = ? AND record_id = ?', type, recordId);
    if (previous) throw new Error('شناسه رکورد شماره‌دار قبلاً استفاده شده است.');
    const config = readNumberingSettings()[type];
    if (!config.enabled) throw Object.assign(new Error('شماره‌گذاری این نوع غیرفعال است.'), { code: 'NUMBERING_DISABLED' });
    const used = new Set(existingNumbers(type).map(String));
    let serial = config.next;
    while (serial <= MAX_SERIAL && (used.has(formatNumber(config, serial)) || db.get('SELECT number FROM numbering_reservations WHERE type = ? AND number = ?', type, formatNumber(config, serial)))) serial++;
    if (serial > MAX_SERIAL) throw new Error('ظرفیت شماره‌گذاری تکمیل شده است.');
    const number = formatNumber(config, serial);
    db.run('INSERT INTO numbering_reservations(type,number,serial,record_id,created_at) VALUES(?,?,?,?,?)', type, number, serial, recordId, now());
    meta.set('numbering:' + type, JSON.stringify({ ...config, next: serial + 1 }));
    return number;
  }
  /* سفارش تا تأیید مشتری «معلق» است: نه شماره دارد، نه شماره‌ای برایش رزرو می‌شود.
     شماره فقط در عملیات confirm_customer تعلق می‌گیرد. */
  function prepareNumberedWrite(key, incoming, released = []) {
    const spec = NUMBERED_KEYS[key];
    if (!spec && key !== 'printshop_inventory_v3') return incoming;
    const previous = new Map((readKey(key) || []).map(r => [r.id, r]));
    const ids = new Set(incoming.map(r => r.id));
    if (spec) {
      const [type, field] = spec;
      for (const old of previous.values()) {
        if (ids.has(old.id)) continue;
        const reservation = db.get('SELECT number FROM numbering_reservations WHERE type = ? AND record_id = ?', type, old.id);
        if (!reservation) continue;
        /* حذف سفارش معلق مجاز است و رزرو شماره‌اش آزاد می‌شود؛ شماره دوباره صادر نمی‌شود.
           سفارش دارای قیمت، تأیید یا تولید همچنان قابل حذف نیست. */
        if (type !== 'order' || protectedOrder(old)) throw new Error('رکورد شماره‌دار قابل حذف نیست.');
        released.push({ id: old.id, number: reservation.number });
      }
      return incoming.map(record => {
        const old = previous.get(record.id);
        if (old) {
          if (record[field] !== undefined && !isDeepStrictEqual(record[field], old[field])) throw new Error('شماره ثبت‌شده قابل تغییر نیست.');
          return { ...record, ...(old[field] === undefined ? {} : { [field]: old[field] }) };
        }
        if (type === 'order') return { ...record, [field]: '' };
        return { ...record, [field]: reserveNumber(type, record.id) };
      });
    }
    for (const old of previous.values()) if (!ids.has(old.id) && (old.movements || []).some(m => db.get('SELECT number FROM numbering_reservations WHERE type = ? AND record_id = ?', 'stockmovement', old.id + '/' + m.id))) throw new Error('کالای دارای گردش شماره‌دار قابل حذف نیست.');
    return incoming.map(record => {
      const oldMovementList = previous.get(record.id)?.movements || [];
      if (record.movements !== undefined && (!Array.isArray(record.movements) || record.movements.some(m => !plainObject(m) || (!m.id && !oldMovementList.some(old => isDeepStrictEqual(old, m)))) || new Set(record.movements.filter(m => m.id).map(m => m.id)).size !== record.movements.filter(m => m.id).length)) throw new Error('ساختار گردش مواد معتبر نیست.');
      const oldMoves = new Map(oldMovementList.map(m => [m.id, m]));
      const moveIds = new Set((record.movements || []).map(m => m.id));
      for (const old of oldMoves.values()) if (!moveIds.has(old.id) && db.get('SELECT number FROM numbering_reservations WHERE type = ? AND record_id = ?', 'stockmovement', record.id + '/' + old.id)) throw new Error('گردش شماره‌دار قابل حذف نیست.');
      return { ...record, ...(record.movements ? { movements: record.movements.map(m => {
        if (!m.id) return m; // Preserve unchanged imported movements without inventing historical numbers.
        if (typeof m.id !== 'string') throw new Error('شناسه گردش معتبر نیست.');
        const old = oldMoves.get(m.id);
        if (old) {
          if (!isDeepStrictEqual(m.movementNumber, old.movementNumber)) throw new Error('شماره گردش ثبت‌شده قابل تغییر نیست.');
          return m;
        }
        return { ...m, movementNumber: reserveNumber('stockmovement', record.id + '/' + m.id) };
      }) } : {}) };
    });
  }
  function writeKey(key, value, readAt, afterWrite, options = {}) {
    const t = now();
    if (isRecordArray(value)) {
      db.tx(() => {
        const released = [];
        value = prepareNumberedWrite(key, value, released);
        const releasedIds = new Map(released.map(r => [r.id, r]));
        const known = isVersionVector(options.knownVersions) ? options.knownVersions : null;
        db.run('INSERT INTO kinds(key,kind) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind', key, 'array');
        db.run('DELETE FROM kv WHERE key = ?', key);
        const existing = new Map(db.all('SELECT id, ord, data, updated_at, rev FROM records WHERE collection = ?', key).map(r => [r.id, r]));
        const seen = new Set();
        value.forEach((rec, i) => {
          if (seen.has(rec.id)) return; seen.add(rec.id);
          const text = JSON.stringify(rec); const ex = existing.get(rec.id);
          /* نسخه فقط با تغییر داده بالا می‌رود؛ جابه‌جایی ترتیب، کار ایستگاه دیگری را بی‌دلیل باطل نمی‌کند. */
          if (!ex) db.run('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)', key, rec.id, i, text, t);
          else if (ex.data !== text) db.run('UPDATE records SET data = ?, ord = ?, updated_at = ?, rev = rev + 1 WHERE collection = ? AND id = ?', text, i, t, key, rec.id);
          else if (ex.ord !== i) db.run('UPDATE records SET ord = ? WHERE collection = ? AND id = ?', i, key, rec.id);
        });
        existing.forEach((ex, id) => {
          if (seen.has(id)) return;
          /* رکوردی که این ایستگاه در نسخهٔ خوانده‌شده دیده و از آن پس تغییر نکرده، واقعاً حذف می‌شود؛
             رکورد تازهٔ ایستگاه دیگر (که نسخه‌اش را ندیده‌ایم) پاک نمی‌شود و فقط از ترتیب بیرون می‌رود. */
          const seenByClient = !!known && Object.prototype.hasOwnProperty.call(known, id) && known[id] === ex.rev;
          if (ex.updated_at <= readAt || seenByClient) {
            db.run('DELETE FROM records WHERE collection = ? AND id = ?', key, id);
            const rel = releasedIds.get(id);
            if (rel) {
              db.run('DELETE FROM numbering_reservations WHERE type = ? AND record_id = ?', 'order', id);
              if (options.onDraftRemoved) options.onDraftRemoved(rel);
            }
          } else if (ex.ord !== -1) db.run('UPDATE records SET ord = -1 WHERE collection = ? AND id = ?', key, id);
        }); // رکوردی که بعد از آخرین خواندنِ شما ثبت شده پاک نمی‌شود
        if (afterWrite) afterWrite();
      });
    } else {
      db.tx(() => {
        db.run('INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, rev = kv.rev + 1 WHERE kv.value <> excluded.value', key, JSON.stringify(value), t);
        db.run('DELETE FROM records WHERE collection = ?', key);
        db.run('DELETE FROM kinds WHERE key = ?', key);
        if (afterWrite) afterWrite();
      });
    }
    return value;
  }

  function canRead(role, key) { const a = ACCESS[key]; return !!a && a.r.includes(role); }
  function canWrite(role, key) { const a = ACCESS[key]; return !!a && a.w.includes(role); }

  function get(token, key) {
    const s = sess(token); if (!s) return authFailure(token);
    const role = s.user.role;
    if (!canRead(role, key)) { audit(s, 'denied_read', key); return { ok: false, code: 'FORBIDDEN', error: 'دسترسی مجاز نیست.' }; }
    s.lastRead[key] = now();
    let v = readKey(key);
    if (v === null) return { ok: true, value: null, revs: keyRevs(key) };
    const money = FULL_MONEY.includes(role);
    if (key === 'printshop_orders_v5' && !money) v = redactOrders(v);
    if (key === 'printshop_inventory_v3' && ![M, F, S].includes(role)) v = redactInventory(v);
    /* حساب مشتری فقط رسیدهای کالای خودش را می‌بیند، آن هم با فیلدهای تحویل. */
    if (key === 'printshop_consignments_v1') v = (role === CUS ? (v || []).filter(r => r.ownerCustomerId === s.user.customerId) : v);
    if (key === 'printshop_units_v1' && !money) v = redactUnits(v);
    if (key === 'printshop_settings_v1' && !money) v = redactSettings(v);
    if (key === 'printshop_letters_v1' && role !== M) v = v.filter(l => l.createdBy === s.user.id);
    if (key === 'printshop_ai_v1' && role !== M) v = { enabled: !!(v && v.enabled && v.apiKey), apiKey: v && v.apiKey ? '********' : '', model: (v && v.model) || '' };
    return { ok: true, value: v, revs: keyRevs(key) };
  }
  function set(token, key, value, expected, origin) {
    const s = sess(token); if (!s) return authFailure(token);
    const role = s.user.role;
    if (!canWrite(role, key)) { audit(s, 'denied_write', key); return { ok: false, code: 'FORBIDDEN', error: 'اجازه‌ی ذخیره‌ی این اطلاعات را ندارید.' }; }
    if (!validValue(key, value)) return { ok: false, code: 'VALIDATION_FAILED', error: 'Invalid data structure.' };
    if (key === 'printshop_orders_v5') {
      if (value.some(order => db.get('SELECT id FROM order_reset_tombstones WHERE id = ?', order.id))) return { ok: false, code: 'STALE_ORDER_DATA', error: 'این اطلاعات متعلق به سفارش‌های پاکسازی‌شده است؛ برنامه را دوباره بارگذاری کنید.' };
      try { validateWorkflowWrite(value, role); }
      catch (e) { return { ok: false, code: 'FORBIDDEN', error: e.message }; }
    }
    let v = value;
    if (PARTY_KIND_BY_KEY[key]) {
      try { v = safePartyWrite(PARTY_KIND_BY_KEY[key], v); }
      catch (e) { return { ok: false, code: 'FORBIDDEN', error: e.message }; }
    }
    if (key === 'printshop_orders_v5' && role !== M) {
      try { v = safeOrderWrite(s, v); }
      catch (e) { audit(s, 'denied_write', key, e.message); return { ok: false, code: 'FORBIDDEN', error: e.message }; }
    }
    if (key === 'printshop_receipts_v1' && !FULL_MONEY.includes(role)) {
      const prev = new Map((readKey(key) || []).map(r => [r.id, r]));
      const incoming = new Set(v.map(r => r.id));
      if ([...prev.values()].some(r => !incoming.has(r.id)) || v.some(r => {
        const old = prev.get(r.id);
        return old ? (r.payStatus || 'unpaid') !== (old.payStatus || 'unpaid') || (r.payDate || '') !== (old.payDate || '') : (r.payStatus || 'unpaid') !== 'unpaid' || !!r.payDate;
      })) return { ok: false, code: 'FORBIDDEN', error: 'Only manager and finance can change payment status or delete receipts.' };
    }
    if (key === 'printshop_inventory_v3' && ![M, F, S].includes(role)) return { ok: false, error: 'اجازه‌ی ذخیره‌ی این اطلاعات را ندارید.' };
    if (key === 'printshop_letters_v1' && role !== M) {
      const others = (readKey(key) || []).filter(l => l.createdBy !== s.user.id);
      const mine = (Array.isArray(v) ? v : []).filter(l => l.createdBy === s.user.id).map(l => ({ ...l, status: 'sent', managerNote: '' }));
      const prevMine = new Map((readKey(key) || []).filter(l => l.createdBy === s.user.id).map(l => [l.id, l]));
      v = [...mine.map(l => { const p = prevMine.get(l.id); return p ? { ...l, status: p.status, managerNote: p.managerNote, decidedAt: p.decidedAt, decidedBy: p.decidedBy } : l; }), ...others];
    }
    if (key === 'printshop_ai_v1' && v && v.apiKey === '********') { const old = readKey(key) || {}; v = { ...v, apiKey: old.apiKey || '' }; }
    if (!validValue(key, v)) return { ok: false, code: 'VALIDATION_FAILED', error: 'ساختار نهایی داده معتبر نیست.' };
    /* بند ب: از راه شبکه نوشتنِ کور ممنوع است — ایستگاه باید بردار نسخه‌ای را که از
       آخرین خواندن گرفته پس بفرستد. این بررسی عمداً پس از دروازۀ نقش می‌آید تا حسابِ
       بی‌اجازه همان «FORBIDDEN» همیشگی را ببیند، نه چیز دیگر. اگر همان رکورد پس از
       خواندنِ این ایستگاه جای دیگری تغییر کرده باشد هیچ چیزی نوشته نمی‌شود.
       آرگومانِ نگذشته روی سیم به شکل null می‌آید (JSON آن را در فهرست نگه می‌دارد). */
    const vector = expected === null ? undefined : expected;
    if (vector === undefined && origin === 'network') return { ok: false, code: 'MISSING_VERSION', error: 'برای ذخیره از راه شبکه باید نسخهٔ اطلاعات خوانده‌شده فرستاده شود.' };
    if (vector !== undefined && !isVersionVector(vector)) return { ok: false, code: 'VALIDATION_FAILED', error: 'بردار نسخهٔ فرستاده‌شده معتبر نیست.' };
    const stale = versionConflicts(key, v, vector);
    if (stale.length) { audit(s, 'stale_write', key, `${stale.length} رکورد`); return { ok: false, code: 'STALE_RECORD', error: 'این اطلاعات پس از خواندنِ شما در جای دیگری تغییر کرده است؛ فهرست تازه می‌شود و هیچ چیزی ذخیره نمی‌گردد.', stale }; }
    /* اصلاحات ۱۷/بند ۲/۲: ردیف‌های پرداختِ سفارش «بازتاب»اند، نه ورودی. ریالی که از این
       مسیر به جای رسیدِ وجه نوشته شود، دو بار شمرده می‌شود یا بی‌سند می‌ماند. عمداً پس از
       بررسیِ نسخه می‌آید تا تغییرِ همزمانِ ایستگاهِ دیگر همان STALE_RECORD همیشگی را
       ببیند، نه خطایِ دسترسی. نقشِ بی‌رقم (کارشناس سفارشات) رقم‌ها را نمی‌بیند و
       safeOrderWrite ردیفِ ذخیره‌شده را نگه می‌دارد؛ مدیر و مدیر مالی باید دقیقاً همان
       بازتابِ تازه را پس بفرستند، وگرنه هیچ چیزی نوشته نمی‌شود. */
    if (key === 'printshop_orders_v5') {
      const mirrorKey = rows => JSON.stringify((rows || []).map(r => [String(r && r.id || ''), receiptEngine.whole(r && r.amount),
        String(r && r.date || ''), String(r && r.method || ''), String(r && r.status || ''), String(r && r.receiptNumber || '')]).sort());
      const before = new Map((readKey('printshop_orders_v5') || []).map(o => [o.id, o]));
      const invented = v.filter(o => o && !before.has(o.id) && (o.payments || []).length);
      if (invented.length) { audit(s, 'denied_write', key, 'پرداخت همراه سفارشِ تازه'); return { ok: false, code: 'FORBIDDEN', error: 'ردیف پرداخت نمی‌تواند همراه سفارشِ تازه ثبت شود؛ دریافت را از «رسید وجه» ثبت کنید.' }; }
      if (FULL_MONEY.includes(role)) {
        const altered = v.filter(o => { const p = before.get(o.id); return p && mirrorKey(o.payments) !== mirrorKey(p.payments); });
        if (altered.length) {
          audit(s, 'denied_write', key, `بازنویسی پرداختِ ${altered.length} سفارش`);
          return { ok: false, code: 'FORBIDDEN', error: `ردیف‌های پرداختِ ${altered.map(o => o.orderNumber || o.id).join('، ')} بازتابِ رسیدهای وجه است و از این مسیر تغییر نمی‌کند؛ رسید را باطل کنید یا رسیدِ تازه ثبت کنید.` };
        }
      }
    }
    try { v = writeKey(key, v, s.lastRead[key] || 0, null, { knownVersions: vector, onDraftRemoved: rel => audit(s, 'draft_order_deleted', rel.number, rel.id) }); }
    catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
    audit(s, 'write', key, Array.isArray(v) ? `${v.length} رکورد` : 'مقدار');
    return { ok: true, revs: keyRevs(key), ...((NUMBERED_KEYS[key] || key === 'printshop_inventory_v3') ? { value: key === 'printshop_orders_v5' && !FULL_MONEY.includes(role) ? redactOrders(v) : v } : {}) };
  }
  function del(token, key) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!canWrite(s.user.role, key) || s.user.role !== M) { audit(s, 'denied_delete', key); return { ok: false, error: 'دسترسی مجاز نیست.' }; }
    if (key === 'printshop_orders_v5' && (readKey(key) || []).some(protectedOrder)) return { ok: false, code: 'FORBIDDEN', error: 'سفارش دارای تأیید، تولید، توقف یا مصرف مواد قابل حذف نیست؛ از مسیر توقف و لغو استفاده کنید.' };
    if (key === CUSTOMER_KEY && (readKey(key) || []).some(protectedCustomer)) return { ok: false, code: 'FORBIDDEN', error: 'مشتری شماره‌دار یا بررسی‌شده قابل حذف نیست.' };
    if (key === SUPPLIER_KEY && (readKey(key) || []).some(p => protectedParty(p, 'supplier'))) return { ok: false, code: 'FORBIDDEN', error: 'تامین‌کننده کددار یا بررسی‌شده قابل حذف نیست.' };
    const numberedType = NUMBERED_KEYS[key]?.[0] || (key === 'printshop_inventory_v3' ? 'stockmovement' : null);
    if (numberedType && db.get('SELECT number FROM numbering_reservations WHERE type = ? LIMIT 1', numberedType)) return { ok: false, code: 'FORBIDDEN', error: 'مجموعه دارای شماره ثبت‌شده قابل حذف نیست.' };
    db.tx(() => { db.run('DELETE FROM kv WHERE key = ?', key); db.run('DELETE FROM records WHERE collection = ?', key); db.run('DELETE FROM kinds WHERE key = ?', key); });
    audit(s, 'delete_key', key); return { ok: true };
  }
  function verifyPin(token, pin) {
    const s = sess(token); if (!s || s.user.role !== M) return { ok: false, error: 'دسترسی مجاز نیست.' };
    const attempts = pinFailures.get(s.user.id) || { count: 0, until: 0 };
    if (attempts.until > now()) return { ok: false, code: 'RATE_LIMITED', error: 'Too many failed PIN attempts. Try again later.' };
    const stored = readKey('printshop_manager_pin');
    const good = stored !== null && safeEq(String(pin || '').trim(), String(stored));
    if (good) pinFailures.delete(s.user.id);
    else { attempts.count++; if (attempts.count >= MAX_FAILED) { attempts.until = now() + 60 * 1000; attempts.count = 0; } pinFailures.set(s.user.id, attempts); }
    audit(s, good ? 'pin_ok' : 'pin_failed', 'manager_pin');
    return { ok: true, valid: good };
  }
  /* مشتری فقط می‌تواند «درخواست سفارش» بفرستد؛ رکورد در همین‌جا ساخته می‌شود و مشتری هیچ داده‌ای نمی‌خواند */
  function submitRequest(token, text, phone) {
    const s = sess(token); if (!s || s.user.role !== CUS) return { ok: false, error: 'دسترسی مجاز نیست.' };
    const t = String(text || '').trim();
    if (t.length < 8 || t.length > 4000) return { ok: false, error: 'متن درخواست معتبر نیست.' };
    const cust = eligibleCustomer(s.user.customerId);
    if (!cust) return { ok: false, code: 'CUSTOMER_NOT_APPROVED', error: 'ثبت درخواست به شماره مشتری و تأیید صلاحیت مدیر نیاز دارد.' };
    const date = new Date(now()).toISOString().slice(0, 10);
    const o = { id: 'req_' + crypto.randomBytes(8).toString('hex'), orderNumber: '', status: REQUEST_STATUS, customerCode: cust.customerCode, customerId: cust ? cust.id : '', customerName: cust ? cust.name : s.user.name, phone: String(phone || '').slice(0, 40), mobile: cust ? (cust.mobile || '') : '', title: t.slice(0, 60), smartText: t, requestText: t, date, deliveryDate: '', items: [], discount: '', payments: [], source: 'مشتری', requestedBy: s.user.id, createdAt: now(),
      history: [{ id: crypto.randomBytes(4).toString('hex'), date, text: 'درخواست سفارش توسط مشتری ثبت شد', by: s.user.name }] };
    try { db.tx(() => {
      db.run('INSERT INTO kinds(key,kind) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind', 'printshop_orders_v5', 'array');
      db.run('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)', 'printshop_orders_v5', o.id, -1, JSON.stringify(o), now());
    }); } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
    audit(s, 'request_submitted', o.id);
    return { ok: true, orderNumber: o.orderNumber };
  }
  /* کلید هوش مصنوعی فقط داخل همین فرایند استفاده می‌شود و به صفحه‌ی غیرمدیر نمی‌رسد */
  function aiKeyFor(token, reqKey) {
    const s = sess(token); if (!s || !STAFF.includes(s.user.role)) return null;
    const cfg = readKey('printshop_ai_v1') || {};
    if (s.user.role === M && reqKey && reqKey !== '********') return { apiKey: reqKey, model: cfg.model };
    return cfg.apiKey ? { apiKey: cfg.apiKey, model: cfg.model } : null;
  }

  /* ---------- انتقال از فایل JSON قدیمی ---------- */
  function migrateLegacy() {
    if (!legacyJsonFile || meta.get('migrated_json') === '1' || !fs.existsSync(legacyJsonFile)) return { migrated: false };
    let legacy; try { legacy = JSON.parse(fs.readFileSync(legacyJsonFile, 'utf8')); } catch (_) { return { migrated: false, error: 'خواندن فایل قدیمی ممکن نشد' }; }
    let count = 0;
    db.tx(() => {
      Object.keys(legacy).forEach(key => {
        let val = legacy[key]; if (typeof val === 'string') { try { val = JSON.parse(val); } catch (_) { return; } }
        if (key === 'printshop_users_v1' && Array.isArray(val)) {
          val.forEach(u => {
            if (!u || !u.id || !u.username || db.get('SELECT id FROM users WHERE id = ? OR lower(username) = lower(?)', u.id, u.username)) return;
            const isDefault = u.passHash === legacyHash('1234');
            db.run('INSERT INTO users(id,username,name,role,customer_id,legacy_hash,active,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,?)', u.id, u.username, u.name || u.username, u.role, u.customerId || null, u.passHash || null, u.active === false ? 0 : 1, isDefault ? 1 : 0, now());
          });
          return;
        }
        if (key === 'printshop_login_seen_v1') return;
        if (!(key in ACCESS)) return;
        if (isRecordArray(val)) { db.run('INSERT INTO kinds(key,kind) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind', key, 'array'); val.forEach((rec, i) => db.run('INSERT OR REPLACE INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)', key, rec.id, i, JSON.stringify(rec), now())); }
        else db.run('INSERT OR REPLACE INTO kv(key,value,updated_at) VALUES(?,?,?)', key, JSON.stringify(val), now());
        count++;
      });
    });
    meta.set('migrated_json', '1');
    try { fs.copyFileSync(legacyJsonFile, legacyJsonFile + '.migrated.bak'); } catch (_) { /* ignore */ }
    if (db.get('SELECT COUNT(*) AS n FROM users').n > 0) meta.set('default_admin', db.get("SELECT COUNT(*) AS n FROM users WHERE id = 'u_admin' AND must_change = 1").n ? '1' : '0');
    return { migrated: true, keys: count };
  }

  /* پشتیبان روزانه با VACUUM INTO (فایل کامل و سازگار). دو قاعده که قبلاً نبود:
     ۱) هر تیک روی همان فایلِ روز بازنویسی می‌شود (نوشتن در فایل موقت و سپس rename)، تا کارِ همان روز بی‌پشتیبان نماند؛
     ۲) نام فایل نام ماشین را دارد، پس چند ایستگاه روی یک پوشهٔ مشترک نسخهٔ یکدیگر را پاک یا جایگزین نمی‌کنند. */
  const backupDir = () => path.join(dataDir, 'backups');
  const stationTag = () => String(os.hostname() || 'station').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 32) || 'station';
  /* برچسب روز بر اساس تقویم تهران است، نه UTC؛ وگرنه کارِ بعدازظهرِ ایران در فایلِ «فردا» ذخیره می‌شد. */
  function tehranDay(ms) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ms)).replace(/\//g, '-');
  }
  /* ساختار فایل را بدون باز کردن پایگاه می‌سنجد: امضای SQLite و تناسب اندازه با تعداد صفحه‌ها، تا فایلِ ناقصِ
     روی share به‌جای «پشتیبان موفق» گزارش شود. */
  function inspectSqlite(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(100);
      fs.readSync(fd, head, 0, 100, 0);
      const bytes = fs.fstatSync(fd).size;
      if (head.slice(0, 15).toString('latin1') !== 'SQLite format 3') return { ok: false, error: 'امضای SQLite در فایل پشتیبان نیست.' };
      let pageSize = head.readUInt16BE(16);
      if (pageSize === 1) pageSize = 65536;
      const pages = head.readUInt32BE(28);
      if (!pageSize || !pages) return { ok: false, error: 'سربرگ SQLite خوانا نیست.' };
      if (bytes !== pages * pageSize) return { ok: false, error: `فایل پشتیبان ناقص است: ${bytes} بایت، انتظار ${pages * pageSize} بایت` };
      return { ok: true, bytes, pageSize, pages };
    } finally { fs.closeSync(fd); }
  }
  function remember(record) { try { meta.set('backup_last', JSON.stringify(record)); } catch (_) { /* پایگاه زنده اولویت دارد */ } }
  function prune(dir) {
    const tag = stationTag().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const daily = new RegExp(`^printshop-${tag}-\\d{4}-\\d{2}-\\d{2}\\.db$`);
    const files = fs.readdirSync(dir).filter(f => daily.test(f)).sort();
    files.slice(0, Math.max(0, files.length - 14)).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ممکن است پاک شده باشد */ } });
  }
  function writeBackup(dir, name) {
    const target = path.join(dir, name);
    const temp = path.join(dir, `.tmp-${name}.${process.pid}`);
    db.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`);
    try { fs.renameSync(temp, target); }
    catch (e) { try { fs.unlinkSync(temp); } catch (_) { /* موقت پاک نشد */ } throw e; }
    return target;
  }
  function backup(dir = backupDir(), { manual = false } = {}) {
    const at = now();
    const day = tehranDay(at);
    const name = manual ? `printshop-${stationTag()}-manual-${day}-${at}.db` : `printshop-${stationTag()}-${day}.db`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const target = writeBackup(dir, name);
      const shape = inspectSqlite(target);
      if (!shape.ok) throw new Error(shape.error);
      if (!manual) prune(dir);
      const record = { ok: true, at, day, station: stationTag(), file: name, path: target, bytes: shape.bytes, pages: shape.pages, pageSize: shape.pageSize, error: '', manual };
      remember(record); audit(null, manual ? 'manual_backup' : 'backup', target);
      return record;
    } catch (e) {
      const record = { ok: false, at, day, station: stationTag(), file: name, path: path.join(dir, name), bytes: 0, error: String((e && e.message) || e), manual };
      remember(record); audit(null, 'backup_failed', path.join(dir, name), record.error);
      return record;
    }
  }
  function backupNow(token, dir = backupDir()) {
    const s = sess(token); if (!s || s.user.role !== M) return { ok: false, error: 'دسترسی مجاز نیست.' };
    return backup(dir, { manual: true });
  }
  function catalogImport(token, dataset, rows, options = {}) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!Array.isArray(rows) || JSON.stringify(rows).length > 4 * 1024 * 1024) return { ok: false, code: 'VALIDATION_FAILED', error: 'حجم ردیف‌های ورودی بیش از حد مجاز است.' };
    if (typeof dataset !== 'string' || !Object.hasOwn(catalogSchemas, dataset)) return { ok: false, code: 'VALIDATION_FAILED', error: 'بخش انتقال معتبر نیست.' };
    // مجوز ورود اکسل دقیقاً همان مجوز ویرایش همان فهرست است؛ هیچ نقشی بیش از نوشتن دستی نمی‌گیرد.
    if (!(catalogSchemas[dataset].writeRoles || []).includes(s.user.role)) return { ok: false, code: 'FORBIDDEN', error: `ورود اطلاعات «${catalogSchemas[dataset].label}» برای نقش شما مجاز نیست.` };
    const key = catalogSchemas[dataset].key;
    const existing = readKey(key) || [];
    const preview = prepareCatalogImport(dataset, rows, existing, readKey(CUSTOMER_KEY) || [], now());
    if (!preview.ok) return preview;
    if (options?.commit !== true) return { ok: true, count: preview.count, fingerprint: preview.fingerprint };
    if (options.fingerprint !== preview.fingerprint) return { ok: false, code: 'STALE_IMPORT', error: 'اطلاعات تغییر کرده است؛ فایل را دوباره بررسی کنید.' };
    try {
      let value = [...existing, ...preview.records];
      if (PARTY_KIND_BY_KEY[key]) value = safePartyWrite(PARTY_KIND_BY_KEY[key], value);
      if (!validValue(key, value)) throw new Error('ساختار اطلاعات پایه معتبر نیست.');
      fs.mkdirSync(backupDir(), { recursive: true });
      const backupFile = writeBackup(backupDir(), `printshop-before-import-${now()}-${crypto.randomBytes(6).toString('hex')}.db`);
      if (!inspectSqlite(backupFile).ok) throw new Error('پشتیبان کامل ساخته نشد؛ ورود لغو شد.');
      value = writeKey(key, value, now(), () => db.run('INSERT INTO audit_log(ts,user_id,user_name,role,action,target,detail) VALUES(?,?,?,?,?,?,?)', now(), s.user.id, s.user.name, s.user.role, 'catalog_import', key, `${preview.count} ردیف؛ پشتیبان: ${path.basename(backupFile)}`));
      markSeen(token, [key]); // بند پ: نام کلید را فقط همین مسیر می‌داند، پس خودِ موتور مُهرِ ایستگاه را جابه‌جا می‌کند
      return { ok: true, value, count: preview.count, backupFile };
    } catch (failure) { return { ok: false, code: 'IMPORT_FAILED', error: failure.message }; }
  }
  // Maintenance-only removal of test orders. Ordinary invoice deletion remains
  // forbidden. No stock reversal, person deletion or counter reset happens here.
  const RESET_PHRASE = 'پاکسازی سفارش‌های آزمایشی';
  function resetSnapshot() {
    /* اصلاحات ۱۷/بند ۰: با یک سندِ ثبت‌شده در دفترکل، پاکسازی آزمایشی سفارش‌ها مجاز نیست.
       سند حسابداری حذف نمی‌شود؛ یا سند اصلاحی می‌خورد یا پیش از پاکسازی دفترکل منتقل/بایگانی می‌شود.
       برای همین اینجا باز می‌گردیم و رد می‌کنیم، نه اینکه سطرهای journal_entries را پاک کنیم. */
    const ledgerRows = Number(db.get('SELECT COUNT(*) AS n FROM journal_entries').n) || 0;
    if (ledgerRows > 0) throw new Error(`${ledgerRows} سند در دفترکل ثبت شده است؛ تا انتقال یا اصلاحِ این اسناد، پاکسازی آزمایشی سفارش‌ها مجاز نیست.`);
    const orders = db.all('SELECT * FROM records WHERE collection = ? ORDER BY id', 'printshop_orders_v5');
    const legacy = db.get('SELECT * FROM kv WHERE key = ?', 'printshop_orders_v5') || null;
    const documents = db.all('SELECT * FROM financial_documents ORDER BY id');
    const events = db.all('SELECT * FROM order_events ORDER BY id');
    const notifications = db.all('SELECT * FROM notification_outbox ORDER BY id').filter(row => !!JSON.parse(row.record).orderId);
    const notificationIds = new Set(notifications.map(row => row.id));
    const reads = db.all('SELECT * FROM notification_reads ORDER BY notification_id,user_id').filter(row => notificationIds.has(row.notification_id));
    const orderValues = readKey('printshop_orders_v5') || [];
    if (!Array.isArray(orderValues)) throw new Error('ساختار سفارش‌ها معتبر نیست؛ پاکسازی انجام نشد.');
    const numbering = readNumberingSettings();
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ orders, legacy, documents, events, notifications, reads, numbering })).digest('hex');
    return { fingerprint, orderValues, notifications, documents, events, numbering, counts: { orders: orderValues.length, documents: documents.length, events: events.length, notifications: notifications.length, notificationReads: reads.length } };
  }
  function previewOrderReset(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (s.user.role !== M) return { ok: false, code: 'FORBIDDEN', error: 'پاکسازی آزمایشی سفارش‌ها فقط در اختیار مدیر چاپخانه است.' };
    try {
      const snapshot = resetSnapshot();
      const previewToken = crypto.randomBytes(24).toString('hex');
      s.orderResetPreview = { token: previewToken, at: now(), fingerprint: snapshot.fingerprint };
      return { ok: true, previewToken, expectedCount: snapshot.counts.orders, counts: snapshot.counts, confirmationPhrase: RESET_PHRASE, expiresAt: now() + 5 * 60 * 1000 };
    } catch (e) { return { ok: false, code: 'RESET_PREVIEW_FAILED', error: e.message }; }
  }
  function resetOrders(token, payload = {}) {
    const s = sess(token); if (!s) return authFailure(token);
    if (s.user.role !== M) { audit(s, 'order_reset_denied', 'orders'); return { ok: false, code: 'FORBIDDEN', error: 'پاکسازی آزمایشی سفارش‌ها فقط در اختیار مدیر چاپخانه است.' }; }
    const preview = s.orderResetPreview;
    if (!plainObject(payload) || payload.confirmation !== RESET_PHRASE || !Number.isSafeInteger(payload.expectedCount) || payload.expectedCount < 0 || typeof payload.reason !== 'string' || payload.reason.trim().length < 8 || payload.reason.trim().length > 1000) return { ok: false, code: 'VALIDATION_FAILED', error: 'عبارت تأیید، تعداد سفارش و دلیل حداقل ۸ کاراکتری لازم است.' };
    if (!preview || payload.previewToken !== preview.token || now() - preview.at > 5 * 60 * 1000) return { ok: false, code: 'RESET_PREVIEW_EXPIRED', error: 'پیش‌نمایش پاکسازی منقضی شده است؛ دوباره بررسی کنید.' };
    let snapshot, backupFile = '', phase = 'backup';
    try {
      snapshot = resetSnapshot();
      if (snapshot.fingerprint !== preview.fingerprint || snapshot.counts.orders !== payload.expectedCount) return { ok: false, code: 'RESET_PREVIEW_STALE', error: 'داده‌ها پس از پیش‌نمایش تغییر کرده‌اند؛ دوباره بررسی کنید.' };
      const resetId = crypto.randomBytes(16).toString('hex');
      const dir = backupDir(); fs.mkdirSync(dir, { recursive: true });
      backupFile = writeBackup(dir, `printshop-before-order-reset-${now()}-${resetId}.db`);
      const shape = inspectSqlite(backupFile);
      if (!shape.ok) throw new Error(shape.error);
      phase = 'transaction';
      db.tx(() => {
        if (resetSnapshot().fingerprint !== snapshot.fingerprint) throw Object.assign(new Error('داده‌ها هنگام آماده‌سازی پشتیبان تغییر کردند؛ دوباره بررسی کنید.'), { code: 'RESET_PREVIEW_STALE' });
        // Keep the high-water mark of unreserved legacy numbers as well.
        for (const type of ['order', 'quote', 'invoice', 'statement']) meta.set('numbering:' + type, JSON.stringify(snapshot.numbering[type]));
        const retired = new Set([...snapshot.orderValues.map(order => order.id), ...snapshot.documents.map(row => row.order_id), ...snapshot.events.map(row => row.order_id)]);
        for (const id of retired) if (typeof id === 'string' && id) db.run('INSERT INTO order_reset_tombstones(id,reset_id,ts) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING', id, resetId, now());
        for (const row of snapshot.notifications) {
          db.run('DELETE FROM notification_reads WHERE notification_id = ?', row.id);
          db.run('DELETE FROM notification_outbox WHERE id = ?', row.id);
        }
        db.run('DELETE FROM financial_documents');
        db.run('DELETE FROM order_events');
        db.run('DELETE FROM records WHERE collection = ?', 'printshop_orders_v5');
        db.run('DELETE FROM kv WHERE key = ?', 'printshop_orders_v5');
        db.run('INSERT INTO kinds(key,kind) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind', 'printshop_orders_v5', 'array');
        meta.set('order_reset_generation', resetId);
        // Audit is mandatory for this destructive maintenance action; unlike
        // routine diagnostics, an audit failure rolls the whole reset back.
        db.run('INSERT INTO audit_log(ts,user_id,user_name,role,action,target,detail) VALUES(?,?,?,?,?,?,?)', now(), s.user.id, s.user.name, s.user.role, 'test_orders_reset', resetId, JSON.stringify({ reason: payload.reason.trim(), counts: snapshot.counts, backupFile, inventoryReversed: false, numberingPreserved: true }));
      });
      sessions.clear();
      return { ok: true, counts: snapshot.counts, backupFile, requiresLogin: true };
    } catch (e) {
      audit(s, 'order_reset_failed', 'orders', e.message);
      return { ok: false, code: e.code === 'RESET_PREVIEW_STALE' ? e.code : phase === 'backup' ? 'RESET_BACKUP_FAILED' : 'ORDER_RESET_FAILED', error: 'پاکسازی انجام نشد: ' + e.message, ...(backupFile ? { backupFile } : {}) };
    }
  }
  function backupStatus(token, dir = backupDir()) {
    const s = sess(token); if (!s || s.user.role !== M) return { ok: false, error: 'دسترسی مجاز نیست.' };
    let last = null;
    try { last = JSON.parse(meta.get('backup_last') || 'null'); } catch (_) { last = null; }
    let copies = [];
    try {
      copies = fs.readdirSync(dir).filter(f => /^printshop-.*\.db$/.test(f))
        .map(f => { const st = fs.statSync(path.join(dir, f)); return { file: f, bytes: st.size, mtime: st.mtimeMs }; })
        .sort((a, b) => b.mtime - a.mtime);
    } catch (_) { copies = []; }
    const own = copies.filter(c => c.file.startsWith(`printshop-${stationTag()}-`));
    return { ok: true, station: stationTag(), last, own: own.length, otherStations: copies.length - own.length, newest: own[0] || null };
  }
  function auditFor(token, n) {
    const s = sess(token); if (!s || s.user.role !== M) return { ok: false, error: 'دسترسی مجاز نیست.' };
    return { ok: true, rows: db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', Math.min(Number(n) || 200, 1000)) };
  }

  function currentUser(token) {
    const s = sess(token);
    return s ? { ok: true, user: { ...s.user } } : authFailure(token);
  }

  const WORKFLOW_FIELDS = new Set(['workflow', 'customerConfirmation', 'productionAuthorization', 'stopInfo', 'settlement', 'cancellation', 'approvedAt', 'managerOverrideDebt', 'onHold', 'holdReason', 'pricing', 'quoteHistory', 'deliveredAt', 'deliveredBy']);
  function protectedOrder(order) {
    const w = order.workflow || {};
    return !!(order.pricing || (order.quoteHistory || []).length || w.customerConfirmation || w.productionAuthorization || w.stop || w.cancellationSettlement || order.deliveredAt || order.status === 'تحویل شده' || (order.items || []).some(it => it.materialsDeducted || it.materialConsumption));
  }
  function validateWorkflowWrite(incoming, role) {
    const existing = new Map((readKey('printshop_orders_v5') || []).map(o => [o.id, o]));
    const incomingIds = new Set(incoming.map(o => o.id));
    if ([...existing.values()].some(o => !incomingIds.has(o.id) && protectedOrder(o))) throw new Error('سفارش دارای تأیید، تولید، توقف یا مصرف مواد قابل حذف نیست؛ از مسیر توقف و لغو استفاده کنید.');
    for (const o of incoming) {
      const previous = existing.get(o.id);
      const visiblePrevious = previous && !FULL_MONEY.includes(role) ? redactOrders([previous])[0] : previous;
      for (const k of WORKFLOW_FIELDS) {
        const next = o[k], old = visiblePrevious && visiblePrevious[k];
        if (['pricing', 'quoteHistory'].includes(k) && (!visiblePrevious || !Object.prototype.hasOwnProperty.call(visiblePrevious, k)) && Object.prototype.hasOwnProperty.call(o, k)) throw new Error('ثبت پیش‌فاکتور و سوابق آن فقط از مسیر قیمت‌گذاری مجاز است.');
        const harmlessDefault = !previous && (next === undefined || next === null || next === false || next === '' || (k === 'onHold' && next === true) || (k === 'holdReason' && typeof next === 'string'));
        const neutralLegacyDrift = !!previous && k === 'managerOverrideDebt' && next === false && !Object.prototype.hasOwnProperty.call(previous, k);
        if (!harmlessDefault && !neutralLegacyDrift && !isDeepStrictEqual(next, old)) throw new Error('گردش کار فقط از عملیات اختصاصی قابل تغییر است.');
      }
      if (previous && previous.pricing) {
        const quoteFields = ['items', 'title', 'description', 'customerId', 'customerCode', 'customerName', 'mobile', 'phone', 'deliveryDate', 'delivery', 'discount', 'shippingCost', 'otherCost', 'otherLabel', 'vatPercent', 'quoteRev', 'smartText', 'requestText', 'intent', 'marketerCode', 'source'];
        if (quoteFields.some(k => !isDeepStrictEqual(o[k], visiblePrevious[k]))) throw new Error('برای تغییر مشخصات یا قیمت سفارش دارای پیش‌فاکتور ثبت‌شده، مسیر اختصاصی بازنگری لازم است.');
      }
      for (const it of o.items || []) {
        const oldItem = previous && (previous.items || []).find(p => p.id === it.id);
        /* اصلاحات ۱۷/بند ۳: عددهای «سالم» و ردیف‌های تحویل هم مثل مصرف مواد فقط از
           عملیاتِ اختصاصیِ تولید نوشته می‌شوند. اگر ایستگاهی سفارش را از روی نسخهٔ
           قدیمیِ خودش ذخیره کند، این خانه‌ها باید بمانند و ذخیره رد شود — وگرنه
           تعدادی که فاکتورِ بعدی رویش حساب می‌شود بی‌صدا پاک می‌شود. */
        for (const k of ['materialConsumption', 'materialsDeducted', 'stageCompletions', 'quality', 'deliveries']) {
          const harmlessDefault = !oldItem && (it[k] === undefined || it[k] === null || it[k] === false || (Array.isArray(it[k]) && it[k].length === 0));
          if (!harmlessDefault && !isDeepStrictEqual(it[k], oldItem && oldItem[k])) throw new Error('ثبت مصرف مواد، پایان مراحل و عددهای کنترل کیفیت و تحویل فقط از عملیات اختصاصی تولید انجام می‌شود.');
        }
        if (!oldItem && it.stage && it.stage !== 'ثبت سفارش') throw new Error('قلم جدید باید از مرحلهٔ ثبت سفارش شروع شود.');
        if (oldItem && (it.stage || 'ثبت سفارش') !== (oldItem.stage || 'ثبت سفارش')) throw new Error('تغییر مرحله فقط از عملیات اختصاصی تولید انجام می‌شود.');
      }
      if (previous && previous.workflow && previous.workflow.customerConfirmation && !previous.workflow.productionAuthorization) {
        const quoteFields = ['items', 'title', 'description', 'customerId', 'customerCode', 'customerName', 'deliveryDate', 'delivery', 'discount', 'shippingCost', 'otherCost', 'otherLabel', 'vatPercent'];
        if (quoteFields.some(k => !isDeepStrictEqual(o[k], visiblePrevious[k])) && (!Number.isSafeInteger(Number(o.quoteRev)) || Number(o.quoteRev) <= (Number(previous.quoteRev) || 1))) throw new Error('تغییر مشخصات یا قیمت پس از تایید مشتری نیازمند نسخهٔ جدید پیش‌فاکتور و تایید مجدد است.');
      }
      if (o.status !== (previous && previous.status) && !['در انتظار تایید', REQUEST_STATUS, 'بایگانی'].includes(o.status)) throw new Error('تایید، توقف و شروع مجدد فقط از عملیات اختصاصی انجام می‌شود.');
      if (previous && previous.workflow && (previous.workflow.productionAuthorization || previous.workflow.stop)) {
        const locked = ['customerId', 'customerCode', 'customerName', 'title', 'description', 'deliveryDate', 'delivery', 'quoteRev', 'items', 'status'];
        if (locked.some(k => !isDeepStrictEqual(o[k], visiblePrevious[k]))) throw new Error('تغییر سفارش در حال تولید یا متوقف نیازمند مسیر بازنگری و مجوز مدیر است.');
      }
    }
  }
  /* اصلاحات ۱۷/بند ۱: قاعدهٔ یکتای بدهی در electron/credit.js نشسته است. تا پیش از این همین
     تابع در سرور و سه مسیر در رابط کاربری چهار جور عدد می‌ساختند (راه جدید/راه قدیمی،
     فیلتر وضعیت‌های متفاوت، و صفر شدنِ مانده وقتی پیش‌فاکتور هنوز فاکتور نشده بود).
     fail‑closed ماند: مبلغ پیش‌فاکتورِ نامعتبر خطا می‌دهد نه عدد. */
  function rawOrderBalance(o) { return credit.balanceOf(o); }
  function requireQuoteAccess(s, order) {
    const fail = (message, code) => { const e = new Error(message); e.code = code; throw e; };
    if (!FULL_MONEY.includes(s.user.role)) fail('قیمت‌گذاری فقط در اختیار مدیر و مدیر مالی است.', 'FORBIDDEN');
    if (!order) fail('سفارش پیدا نشد.', 'NOT_FOUND');
    if (db.get('SELECT id FROM financial_documents WHERE order_id = ? AND quote_revision = ? AND type = ? AND status = ?', order.id, Number(order.quoteRev) || 1, 'invoice', 'issued')) fail('برای نسخهٔ دارای فاکتور صادرشده، تغییر پیش‌فاکتور مجاز نیست؛ ابتدا وضعیت فاکتور باید تعیین تکلیف شود.', 'INVOICE_LOCKED');
    if (order.status !== 'در انتظار تایید' || order.workflow && (order.workflow.productionAuthorization || order.workflow.stop) || (order.items || []).some(it => it.materialsDeducted || it.materialConsumption)) fail('قیمت‌گذاری فقط پیش از اجازهٔ تولید و در وضعیت انتظار تأیید مجاز است.', 'FORBIDDEN');
  }
  function previewQuote(token, idOrNumber, input) {
    const s = sess(token); if (!s) return authFailure(token);
    try {
      if (typeof idOrNumber !== 'string') return { ok: false, code: 'VALIDATION_FAILED', error: 'شناسه سفارش نامعتبر است.' };
      const orders = readKey('printshop_orders_v5') || [];
      const order = orders.find(o => o.id === idOrNumber) || orders.find(o => String(o.orderNumber) === idOrNumber);
      requireQuoteAccess(s, order);
      const { computeQuote } = require('./quote');
      const computed = computeQuote(input, { now });
      return { ok: true, result: computed.result };
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  function applySaveQuote(s, original, payload) {
    requireQuoteAccess(s, original);
    const currentRevision = Number(original.quoteRev) || 1;
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision !== currentRevision) {
      const error = new Error('نسخهٔ سفارش تغییر کرده است؛ اطلاعات تازه را دریافت و دوباره بررسی کنید.'); error.code = 'REVISION_CONFLICT'; throw error;
    }
    if (!Number.isSafeInteger(currentRevision + 1)) throw new Error('شماره نسخه معتبر نیست.');
    const { computeQuote } = require('./quote');
    const computed = computeQuote(payload.input, { now });
    const order = structuredClone(original);
    const actor = { id: s.user.id, name: s.user.name, role: s.user.role };
    const revision = currentRevision + 1;
    order.quoteHistory = [...(order.quoteHistory || []), ...(order.pricing ? [order.pricing] : [])];
    order.quoteRev = revision;
    order.pricing = { schemaVersion: 1, revision, createdAt: now(), createdBy: actor, input: computed.input, result: computed.result };
    order.workflow = { ...(order.workflow || {}), revision: ((order.workflow || {}).revision || 0) + 1 };
    delete order.workflow.customerConfirmation;
    const message = 'نسخهٔ جدید پیش‌فاکتور ثبت شد؛ تأیید مجدد مشتری لازم است.';
    order.history = [...(order.history || []), { id: crypto.randomBytes(12).toString('hex'), date: new Date(now()).toISOString().slice(0, 10), text: message, by: actor.name, visibility: 'operational' }];
    return { order, event: { action: 'save_quote', quoteRevision: revision, revision: order.workflow.revision, message }, notifications: [
      { audience: 'management', message, orderNumber: String(order.orderNumber || '') },
      { audience: 'customer', message: 'پیش‌فاکتور نسخهٔ جدید برای ارائه و تأیید شما آماده است.', orderNumber: String(order.orderNumber || '') },
    ] };
  }
  function consumeStageMaterials(original, changed, payload, actor) {
    const { stagesFor } = require('./workflow');
    const originalItem = (original.items || []).find(it => it.id === payload.itemId);
    const item = changed.items.find(it => it.id === payload.itemId);
    const list = stagesFor(originalItem);
    const before = list.indexOf(originalItem.stage || 'ثبت سفارش'), after = list.indexOf(payload.newStage);
    const stageFields = {
      'لیتوگرافی و زینک': ['lithoMaterials'], 'چاپ افست': ['papers', 'coverPapers'], 'چاپ دیجیتال': ['papers', 'coverPapers'],
      'صحافی و تکمیلی': ['bindingMaterials', 'coverLining', 'coverCellophane'], 'برش و تکمیلی': ['bindingMaterials', 'coverLining', 'coverCellophane'],
      'لیتوگرافی': ['lithoMaterials'], 'چاپ': ['papers', 'coverPapers'], 'صحافی': ['bindingMaterials', 'coverLining'], 'خدمات تکمیلی': ['coverCellophane'],
    };
    const stages = list.slice(before + 1, after + 1).filter(stage => stageFields[stage]);
    if (!stages.length) return;
    const fail = (message, code = 'MATERIALS_NOT_READY') => { const e = new Error(message); e.code = code; throw e; };
    if (originalItem.materialsDeducted && !plainObject(originalItem.materialConsumption)) fail('مصرف قدیمی این قلم باید قبل از ادامه با کاردکس تطبیق داده شود.', 'LEGACY_CONSUMPTION_REVIEW');
    const inventory = new Map((readKey('printshop_inventory_v3') || []).map(i => [i.id, i]));
    const consumed = structuredClone(originalItem.materialConsumption || {});
    const requirements = new Map();
    const stock = i => Number(i.unitMode === 'band_sheet' ? i.bandCount : i.unitMode === 'roll_kg' ? i.weightKg : i.quantity);
    const rounded = n => Math.round(n * 1e9) / 1e9;
    for (const stage of stages) {
      if (consumed[stage]) continue;
      const entries = [];
      for (const field of stageFields[stage]) {
        const materials = item[field] || [];
        if (!Array.isArray(materials)) fail('ساختار مواد مرحله معتبر نیست.');
        for (const m of materials) {
          if (!plainObject(m)) fail('مشخصات ماده معتبر نیست.');
          if (!m.inventoryItemId && !m.description && (m.qty === undefined || m.qty === '' || Number(m.qty) === 0)) continue;
          const qty = Number(m.qty);
          if (!Number.isFinite(qty) || qty <= 0 || typeof m.inventoryItemId !== 'string') fail('مقدار مصرف و کالای انبار مرحله باید مشخص باشند.');
          const inv = inventory.get(m.inventoryItemId);
          if (!inv) fail('مادهٔ موردنیاز هنوز در انبار ثبت نشده است.');
          if (!['چاپخانه', 'مشتری'].includes(inv.ownerType)) fail('مالکیت مادهٔ انبار مشخص نیست.');
          if (m.owner && m.owner !== inv.ownerType) fail('مالک انتخاب‌شده با مالک واقعی موجودی هماهنگ نیست.', 'FORBIDDEN');
          if (inv.ownerType === 'مشتری') {
            if (!original.customerId || !inv.ownerCustomerId || inv.ownerCustomerId !== original.customerId) fail('مصرف موجودی اختصاصی مشتری دیگر مجاز نیست.', 'FORBIDDEN');
            if (inv.purposeScope === 'order' && (!inv.linkedOrderNumber || String(inv.linkedOrderNumber) !== String(original.orderNumber))) fail('این ماده به سفارش دیگری اختصاص دارد یا تخصیص آن مشخص نیست.', 'FORBIDDEN');
          }
          if (m.owner === 'مشتری' && (inv.ownerType !== 'مشتری' || m.ownerCustomerId && m.ownerCustomerId !== original.customerId)) fail('مالک انتخاب‌شده با مالک واقعی موجودی هماهنگ نیست.', 'FORBIDDEN');
          let used = qty, unit;
          if (inv.unitMode === 'band_sheet') {
            unit = 'بند';
            const requestedUnit = m.qtyUnit || m.unitLabel;
            if (['ورق', 'برگ'].includes(requestedUnit)) {
              const perBand = Number(inv.sheetsPerBand);
              if (!Number.isFinite(perBand) || perBand <= 0) fail('تعداد ورق در هر بند مشخص نیست.');
              used = qty / perBand;
            } else if (requestedUnit !== 'بند') fail('واحد مصرف کاغذ باید بند یا ورق باشد.');
          } else if (inv.unitMode === 'roll_kg') {
            unit = 'کیلوگرم';
            const requestedUnit = m.unitLabel || m.qtyUnit;
            if (requestedUnit === 'رول') {
              const kgPerRoll = Number(inv.kgPerRoll);
              if (!Number.isFinite(kgPerRoll) || kgPerRoll <= 0) fail('وزن هر رول مشخص نیست.');
              used = qty * kgPerRoll;
            } else if (!['کیلوگرم', 'کیلو'].includes(requestedUnit)) fail('واحد مصرف رول باید کیلوگرم یا رول با وزن مشخص باشد.');
          } else {
            unit = inv.simpleUnit;
            if (!unit || (m.unitLabel || m.qtyUnit) !== unit) fail('واحد مصرف با واحد موجودی هماهنگ نیست.');
          }
          if (!Number.isFinite(used) || used <= 0) fail('مقدار تبدیل‌شدهٔ مصرف معتبر نیست.');
          used = rounded(used);
          if (used <= 0) fail('مقدار مصرف از دقت قابل ثبت کوچک‌تر است.');
          requirements.set(inv.id, rounded((requirements.get(inv.id) || 0) + used));
          entries.push({ inventoryItemId: inv.id, materialId: m.id || '', field, qty: used, unit, ownerType: inv.ownerType, ownerCustomerId: inv.ownerCustomerId || '' });
        }
      }
      consumed[stage] = { at: now(), by: { id: actor.id, name: actor.name, role: actor.role }, entries };
    }
    for (const [id, needed] of requirements) {
      const inv = inventory.get(id), available = stock(inv);
      if (!Number.isFinite(available) || available < 0 || available + 1e-9 < needed) fail(`موجودی «${inv.name || id}» برای این مرحله کافی نیست؛ سایر مراحل آماده قابل ادامه‌اند.`);
    }
    for (const [id, needed] of requirements) {
      const inv = inventory.get(id);
      const field = inv.unitMode === 'band_sheet' ? 'bandCount' : inv.unitMode === 'roll_kg' ? 'weightKg' : 'quantity';
      const movements = [...(inv.movements || [])];
      for (const stage of stages) for (const e of consumed[stage] && consumed[stage].entries || []) if (e.inventoryItemId === id) {
        const movementId = crypto.randomBytes(12).toString('hex');
        movements.push({ id: movementId, movementNumber: reserveNumber('stockmovement', id + '/' + movementId), date: new Date(now()).toISOString().slice(0, 10), type: 'out', qty: e.qty, unit: e.unit, orderId: original.id, orderNumber: original.orderNumber, itemId: item.id, stage, actorId: actor.id, note: `سفارش ${original.orderNumber} — ${stage}` });
      }
      const updated = { ...inv, [field]: Math.max(0, rounded(stock(inv) - needed)), movements };
      db.run('UPDATE records SET data = ?, updated_at = ?, rev = rev + 1 WHERE collection = ? AND id = ?', JSON.stringify(updated), now(), 'printshop_inventory_v3', id);
    }
    item.materialConsumption = consumed;
    item.materialsDeducted = item.materialsDeducted || requirements.size > 0;
  }
  /* بند ۵/الف: رسید «تحویل کالا از مشتری». تاریخ و ساعت را خودِ سرور می‌گیرد و
     تحویل‌گیرنده از نشست می‌آید، پس هیچ ایستگاهی نمی‌تواند ساعت امانت را عوض کند؛
     شمارش «روز نزد چاپخانه» از همین رکورد تاریخ‌دار حساب می‌شود. */
  function consignReceipt(token, payload = {}) {
    const s = sess(token); if (!s) return authFailure(token);
    if (![M, S].includes(s.user.role)) { audit(s, 'denied_write', 'consignment_receipt'); return { ok: false, code: 'FORBIDDEN', error: 'ثبت رسید امانت فقط در اختیار مدیر چاپخانه و انباردار است.' }; }
    if (!plainObject(payload)) return { ok: false, code: 'VALIDATION_FAILED', error: 'درخواست نامعتبر است.' };
    const digits = v => String(v === undefined || v === null ? '' : v).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const clean = v => digits(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    const iso = clean(payload.date), tm = clean(payload.time), fail = (message, code = 'VALIDATION_FAILED') => { const e = new Error(message); e.code = code; throw e; };
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) fail('تاریخ رسید معتبر نیست.');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tm)) fail('ساعت رسید را به شکل ۱۴:۳۰ وارد کنید.');
      const today = new Date(now()).toISOString().slice(0, 10);
      if (iso > today) fail('تاریخ رسید نمی‌تواند به آینده برود.');
      const items = readKey('printshop_inventory_v3') || [];
      const item = items.find(i => i && i.id === clean(payload.inventoryItemId));
      if (!item) fail('کالای انبار پیدا نشد.', 'NOT_FOUND');
      if (item.ownerType !== 'مشتری') fail('رسید امانت فقط برای کالایی که مشتری آورده است ثبت می‌شود.', 'FORBIDDEN');
      const customerId = clean(payload.ownerCustomerId || item.ownerCustomerId);
      if (!customerId || customerId !== item.ownerCustomerId) fail('مشتریِ رسید با مالک واقعی موجودی هماهنگ نیست.', 'FORBIDDEN');
      const customers = readKey('printshop_customers_v2') || [];
      const customer = customers.find(c => c.id === customerId);
      if (!customer || !usableParty(customer)) fail('مشتری رسید باید ثبت و تأیید شده باشد.', 'FORBIDDEN');
      const orderNumber = clean(payload.orderNumber).replace(/\D/g, '');
      if (orderNumber && !(readKey('printshop_orders_v5') || []).some(o => String(o.orderNumber) === orderNumber)) fail('سفارش متصل به رسید در بانک نیست.', 'NOT_FOUND');
      if (orderNumber && (item.purposeScope === 'order' || item.linkedOrderNumber) && String(item.linkedOrderNumber || '') !== orderNumber) fail('این کالا به سفارش دیگری اختصاص دارد.', 'FORBIDDEN');
      const stockField = item.unitMode === 'band_sheet' ? 'bandCount' : item.unitMode === 'roll_kg' ? 'weightKg' : 'quantity';
      let qty = Number(digits(payload.qty));
      let unit;
      if (item.unitMode === 'band_sheet') {
        const perBand = Number(item.sheetsPerBand);
        if (clean(payload.unit) === 'ورق') { if (!Number.isFinite(perBand) || perBand <= 0) fail('تعداد ورق در هر بند مشخص نیست.'); qty = qty / perBand; unit = 'بند'; }
        else if (clean(payload.unit) === 'بند') unit = 'بند';
        else fail('واحد ورودی کاغذ باید بند یا ورق باشد.');
      } else if (item.unitMode === 'roll_kg') {
        const kgPerRoll = Number(item.kgPerRoll);
        if (clean(payload.unit) === 'رول') { if (!Number.isFinite(kgPerRoll) || kgPerRoll <= 0) fail('وزن هر رول مشخص نیست.'); qty = qty * kgPerRoll; unit = 'کیلوگرم'; }
        else if (['کیلوگرم', 'کیلو'].includes(clean(payload.unit))) unit = 'کیلوگرم';
        else fail('واحد ورودی رول باید کیلوگرم یا رول با وزن مشخص باشد.');
      } else {
        unit = item.simpleUnit;
        if (!unit || clean(payload.unit) !== unit) fail('واحد ورودی با واحد موجودی هماهنگ نیست.');
      }
      if (!Number.isFinite(qty) || qty <= 0) fail('مقدار رسید باید عددی بزرگ‌تر از صفر باشد.');
      qty = Math.round(qty * 1e9) / 1e9;
      if (qty <= 0) fail('مقدار رسید از دقت قابل ثبت کوچک‌تر است.');
      const receivedBy = clean(payload.receivedBy) || s.user.name || '';
      const note = clean(payload.note);
      if (receivedBy.length > 80 || note.length > 200) fail('نام تحویل‌گیرنده یا شرح رسید بیش از اندازه بلند است.');
      let result;
      db.tx(() => {
        const receipts = readKey('printshop_consignments_v1') || [];
        const movementId = crypto.randomBytes(12).toString('hex');
        const movements = [...(item.movements || [])];
        movements.push({ id: movementId, date: iso, type: 'in', qty, unit, orderNumber: orderNumber || undefined, actorId: s.user.id, note: note || `رسید تحویل کالا از ${customer.name || 'مشتری'} — ${tm}` });
        const updatedItem = { ...item, [stockField]: Math.round((Number(item[stockField] || 0) + qty) * 1000) / 1000, movements };
        db.run('UPDATE records SET data = ?, updated_at = ?, rev = rev + 1 WHERE collection = ? AND id = ?', JSON.stringify(updatedItem), now(), 'printshop_inventory_v3', item.id);
        const receiptId = crypto.randomBytes(12).toString('hex');
        const receipt = {
          id: receiptId,
          receiptNumber: reserveNumber('consignmentreceipt', receiptId),
          date: iso, time: tm, at: now(),
          inventoryItemId: item.id, itemName: item.name || '',
          ownerCustomerId: customerId, customerName: customer.name || '',
          qty, unit, orderNumber: orderNumber || '', receivedBy, note,
          actorId: s.user.id, actorName: s.user.name || '', actorRole: s.user.role,
        };
        if (!validValue('printshop_consignments_v1', [receipt])) fail('رسید ساخته‌شده معتبر نیست.');
        db.run('INSERT INTO records(collection,id,ord,data,updated_at) VALUES(?,?,?,?,?)', 'printshop_consignments_v1', receipt.id, receipts.length, JSON.stringify(receipt), now());
        db.run('INSERT INTO kinds(key,kind) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET kind = excluded.kind', 'printshop_consignments_v1', 'array');
        audit(s, 'consignment_receipt', receipt.receiptNumber, `${item.name} — ${qty} ${unit}`);
        result = { ok: true, receipt, inventoryItem: updatedItem, movementId };
      });
      return result;
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  function orderAction(token, idOrNumber, action, payload = {}) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!STAFF.includes(s.user.role)) return { ok: false, code: 'FORBIDDEN', error: 'این عملیات برای کارکنان مجاز است.' };
    if (typeof idOrNumber !== 'string' || typeof action !== 'string' || !plainObject(payload)) return { ok: false, code: 'VALIDATION_FAILED', error: 'درخواست نامعتبر است.' };
    try {
      let result;
      db.tx(() => {
        const orders = readKey('printshop_orders_v5') || [];
        const order = orders.find(o => o.id === idOrNumber) || orders.find(o => String(o.orderNumber) === idOrNumber);
        if (!order) { const e = new Error('سفارش پیدا نشد.'); e.code = 'NOT_FOUND'; throw e; }
        /* اصلاحات ۱۷/بند ۱: «بدهی باز» از پروندهٔ اعتباریِ همان مشتری خوانده می‌شود —
           بدهی قطعی + تعهدِ تأییدشده، پیش از کسرِ پیش‌پرداخت. تا پیش از این، همین فهرستِ
           وضعیت‌ها را هر صفحه جور دیگری می‌شمرد.
           allowGhost: مشتریِ حذف‌شده یا بی‌رکورد باید مانده‌اش از همان سفارش‌ها حساب شود،
           نه این‌که نبودِ رکورد معنی «بدهی ندارد» بگیرد و دروازه خودبه‌خود باز بماند. */
        const file = order.customerId ? creditFileOf(order.customerId, { excludeOrderId: order.id, allowGhost: true }) : null;
        const hasOpenDebt = !!file && file.openTotal > 0;
        /* مجوز بدهی سند می‌خواهد: ردیفِ فعالِ credit_approvals، یا دلیلی که مدیر همین‌جا می‌نویسد
           و سرور همان لحظه به‌همراه مبلغ‌های واقعیِ پرونده در همان جدول می‌نویسد. */
        let creditApproval = null;
        if (action === 'release_production' && hasOpenDebt) {
          creditApproval = activeApprovalFor(order.id, order.customerId);
          const reason = typeof payload.creditReason === 'string' ? payload.creditReason.trim() : '';
          if (!creditApproval && reason.length >= 10 && s.user.role === M) {
            const verdict = credit.verdictOf(file, credit.payableOf(order), order.id);
            creditApproval = { id: null, inline: true, reason, ceiling: file.ceiling, openTotal: file.openTotal,
              definiteDebt: file.definiteDebt, overdueDebt: file.overdueDebt, commitment: file.commitment,
              advance: file.advance, overBy: verdict.overBy, decidedAt: now(), decidedBy: s.user.name, decidedRole: s.user.role };
          }
        }
        if (['confirm_customer', 'release_production', 'resume', 'change_stage', 'complete_stage'].includes(action) && order.pricing !== undefined && (!order.pricing || order.pricing.schemaVersion !== 1 || order.pricing.revision !== (Number(order.quoteRev) || 1))) throw new Error('پیش‌فاکتور نسخهٔ فعلی باید دوباره ثبت شود.');
        const { applyOrderAction } = require('./workflow');
        const applied = action === 'save_quote' ? applySaveQuote(s, order, payload) : applyOrderAction(order, action, payload, { id: s.user.id, name: s.user.name, role: s.user.role }, { now, hasOpenDebt, creditApproval });
        if (creditApproval && creditApproval.inline) {
          const approvalId = crypto.randomBytes(16).toString('hex');
          /* جایگزین‌کردن پیش از درج: روی هر سفارش فقط یک مجوز فعال می‌ماند (قیدِ یکتای جزئی). */
          for (const prev of db.all('SELECT id FROM credit_approvals WHERE order_id = ? AND customer_id = ? AND state = ?', order.id, order.customerId, 'active')) {
            db.run('UPDATE credit_approvals SET state = ?, superseded_by = ? WHERE id = ?', 'superseded', approvalId, prev.id);
          }
          db.run('INSERT INTO credit_approvals(id,customer_id,order_id,quote_revision,ceiling,open_total,definite_debt,overdue_debt,commitment,advance,over_by,reason,state,decided_at,decided_by,decided_role) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            approvalId, order.customerId, order.id, Number(order.quoteRev) || 1, creditApproval.ceiling, creditApproval.openTotal,
            creditApproval.definiteDebt, creditApproval.overdueDebt, creditApproval.commitment, creditApproval.advance,
            creditApproval.overBy, creditApproval.reason, 'active', creditApproval.decidedAt, creditApproval.decidedBy, creditApproval.decidedRole);
          if (applied.order.workflow && applied.order.workflow.productionAuthorization) applied.order.workflow.productionAuthorization.creditApproval.id = approvalId;
          audit(s, 'credit_approval', order.id, `همراه اجازهٔ تولید — ماندهٔ باز ${creditApproval.openTotal} ریال`);
        }
        /* شمارهٔ سفارش در لحظهٔ تأیید مشتری صادر می‌شود؛ پیش از آن سفارش معلق و بی‌شماره است. */
        if (action === 'confirm_customer' && !applied.order.orderNumber) {
          const reserved = db.get('SELECT number FROM numbering_reservations WHERE type = ? AND record_id = ?', 'order', applied.order.id);
          const number = reserved ? reserved.number : reserveNumber('order', applied.order.id);
          applied.order.orderNumber = number;
          const message = `تأیید مشتری ثبت شد؛ شمارهٔ سفارش ${number} صادر شد — منتظر اجازهٔ مدیر چاپخانه`;
          if (applied.event) applied.event.message = message;
          const last = applied.order.history && applied.order.history[applied.order.history.length - 1];
          if (last && last.id === applied.event.id) last.text = message;
          for (const n of applied.notifications || []) n.orderNumber = number;
        }
        if (action === 'change_stage') consumeStageMaterials(order, applied.order, payload, s.user);
        if (action === 'complete_stage') {
          const entered = (applied.order.items || []).find(it => it.id === payload.itemId);
          if (entered) consumeStageMaterials(order, applied.order, { itemId: payload.itemId, newStage: entered.stage || 'تحویل' }, s.user);
        }
        const eventHistory = applied.order.history && applied.order.history[applied.order.history.length - 1];
        if (eventHistory) eventHistory.visibility = 'operational';
        if (!validValue('printshop_orders_v5', [applied.order]) || applied.order.id !== order.id) throw new Error('خروجی گردش کار نامعتبر است.');
        const eventId = crypto.randomBytes(12).toString('hex');
        const event = { ...applied.event, id: eventId, orderId: order.id, action, actor: { id: s.user.id, name: s.user.name, role: s.user.role }, createdAt: now() };
        db.run('UPDATE records SET data = ?, updated_at = ?, rev = rev + 1 WHERE collection = ? AND id = ?', JSON.stringify(applied.order), now(), 'printshop_orders_v5', order.id);
        db.run('INSERT INTO order_events(id,order_id,ts,record) VALUES(?,?,?,?)', eventId, order.id, now(), JSON.stringify(event));
        const notifications = (applied.notifications || []).map(n => ({ ...n, id: crypto.randomBytes(12).toString('hex'), orderId: order.id, customerId: order.customerId || '', createdAt: now(), status: 'queued' }));
        for (const n of notifications) db.run('INSERT INTO notification_outbox(id,ts,record) VALUES(?,?,?)', n.id, now(), JSON.stringify(n));
        audit(s, 'order_action', order.id, action);
        result = { ok: true, orderNumber: applied.order.orderNumber, status: applied.order.status, eventId, notificationStatus: 'queued' };
        if (canRead(s.user.role, 'printshop_orders_v5')) result.order = FULL_MONEY.includes(s.user.role) ? applied.order : redactOrders([applied.order])[0];
      });
      return result;
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  function documents(token) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!FULL_MONEY.includes(s.user.role)) return { ok: false, code: 'FORBIDDEN', error: 'اسناد مالی فقط در اختیار مدیر و مدیر مالی است.' };
    return { ok: true, documents: readKey('printshop_documents_v1') };
  }
  /* اصلاحات ۱۷/بند ۳: یک قاعده، دو مصرف. همِ «پیشنهادِ دیدنی» و هم صدورِ فاکتورِ تحویلی
     از این تابع می‌پرسند «چرا هنوز نه» — تا پنلِ مالی عددی را نشان ندهد که سرور رد می‌کند.
     تحویلِ ثبت‌نشده یعنی هنوز چیزی دستِ مشتری نرسیده، پس ردیفِ ثابتِ کاغذ و زینک هم
     طلب نمی‌شود: فاکتورِ تحویلی بی‌تحویل صادر نمی‌شود (فاکتورِ کامل جای دیگری است). */
  function partialInvoiceBlock(proposal, billedRows) {
    if (!(proposal.items || []).some(i => i.delivered > 0)) return 'برای این سفارش هنوز تحویلِ ثبت‌شده‌ای نیست؛ ابتدا تعداد تحویل‌قابل‌صورتحساب را در مرحلهٔ تحویل ثبت کنید.';
    if (!proposal.rows.length) return billedRows.length
      ? 'همهٔ ردیف‌های این نسخه صورتحساب شده است؛ فاکتورِ تازه چیزی برای طلب ندارد.'
      : 'این پیش‌فاکتور ردیفِ قابل‌صورتحسابی ندارد؛ پیش از صدور سند بازنگری لازم است.';
    return '';
  }
  /* اصلاحات ۱۷/بند ۳: «الان روی این سفارش چند ریال قابل صورتحساب است» را فقط سرور می‌شمارد —
     از پیش‌فاکتورِ تأییدشده، سه عددِ هر قلم و ردیف‌های دفترِ صورتحساب. این تابع فقط‌خواندنی
     است و هیچ چیزی ذخیره نمی‌کند؛ ایستگاه رقمی نمی‌فرستد تا عددِ خودش را منبع پول نکند. */
  function invoiceProposal(token, orderId) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!FULL_MONEY.includes(s.user.role)) return { ok: false, code: 'FORBIDDEN', error: 'پیشنهاد صورتحساب فقط در اختیار مدیر و مدیر مالی است.' };
    if (typeof orderId !== 'string' || !orderId || orderId.length > 64) return { ok: false, code: 'VALIDATION_FAILED', error: 'شناسه سفارش نامعتبر است.' };
    try {
      const order = (readKey('printshop_orders_v5') || []).find(o => o.id === orderId);
      if (!order) return { ok: false, code: 'NOT_FOUND', error: 'سفارش پیدا نشد.' };
      const pricing = validatedPricing(order);
      const billedRows = billedInvoiceRows(order.id, pricing.revision);
      const proposal = billingEngine.invoiceProposal(order, pricing, billedRows);
      const block = partialInvoiceBlock(proposal, billedRows);
      return {
        ok: true, orderId: order.id, orderNumber: order.orderNumber, quoteRevision: pricing.revision,
        contractMode: proposal.mode, approvedTotal: billingEngine.whole(pricing.result.total),
        items: proposal.items, rows: proposal.rows, totals: proposal.totals, cumulative: proposal.cumulative, warnings: proposal.warnings,
        /* «چرا هنوز نه» هم از همان قاعدهٔ صدور می‌آید، تا پنلِ مالی چیزی را که سرور
           رد می‌کند پیش‌فاکتورِ آماده نشان ندهد. */
        canIssue: !block, issueBlock: block,
        invoices: invoiceDocuments(order.id, pricing.revision).map(d => ({
          id: d.id, number: d.number, billingMode: (d.snapshot && d.snapshot.billingMode) || 'full',
          total: d.snapshot && d.snapshot.invoice && d.snapshot.invoice.totals ? billingEngine.whole(d.snapshot.invoice.totals.total) : 0,
          createdAt: d.createdAt, status: d.status,
        })),
      };
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  function validatedPricing(order) {
    const pricing = order.pricing;
    if (!pricing || pricing.schemaVersion !== 1 || pricing.revision !== (Number(order.quoteRev) || 1)) throw new Error('صدور سند به پیش‌فاکتور معتبر نسخه فعلی نیاز دارد.');
    const computed = require('./quote').computeQuote(pricing.input, { now });
    if (!isDeepStrictEqual(computed.result, pricing.result) || !isDeepStrictEqual(computed.input, pricing.input)) throw new Error('مبالغ پیش‌فاکتور با محاسبه معتبر سرور سازگار نیست.');
    return pricing;
  }
  function documentPrintSettings() {
    const settings = readKey('printshop_settings_v1') || {};
    const pick = (value, keys) => Object.fromEntries(keys.filter(k => plainObject(value) && Object.prototype.hasOwnProperty.call(value, k)).map(k => [k, structuredClone(value[k])]));
    return {
      company: pick(settings.company, ['name', 'entityType', 'nationalCode', 'registerNo', 'province', 'city', 'fax', 'logo', 'phone', 'mobile', 'address', 'postalCode', 'economicCode', 'nationalId', 'email', 'website', 'footer']),
      quote: pick(settings.quote, ['validityDays', 'vatPercent', 'terms']),
    };
  }
  /* اصلاحات ۱۷/بند ۳: «این ردیف چقدر طلب شده» فقط از دفترِ صورتحساب خوانده می‌شود، و
     فقط فاکتورهای زنده (ابطال‌شده بدهی نمی‌سازد). ایستگاه هیچ‌وقت مبلغ نمی‌فرستد؛ سرور
     خودِ عدد را از همین ردیف‌ها و از تعدادِ تحویلِ امروز حساب می‌کند. */
  function billedInvoiceRows(orderId, revision) {
    return db.all(`SELECT b.line_id lineId, b.amount, b.qty FROM invoice_billings b
      JOIN financial_documents d ON d.id = b.document_id
      WHERE b.order_id = ? AND b.quote_revision = ? AND d.status = 'issued'`, orderId, revision);
  }
  function invoiceDocuments(orderId, revision) {
    return db.all("SELECT record FROM financial_documents WHERE order_id = ? AND quote_revision = ? AND type = 'invoice' AND status = 'issued' ORDER BY created_at", orderId, revision)
      .map(row => { try { return JSON.parse(row.record); } catch (_) { return null; } }).filter(Boolean);
  }
  function documentAction(token, orderId, action, payload = {}) {
    const s = sess(token); if (!s) return authFailure(token);
    if (!FULL_MONEY.includes(s.user.role)) return { ok: false, code: 'FORBIDDEN', error: 'صدور و ابطال سند فقط در اختیار مدیر و مدیر مالی است.' };
    if (typeof orderId !== 'string' || !['issue_quote', 'issue_invoice', 'issue_partial_invoice', 'issue_statement', 'void'].includes(action) || !plainObject(payload)) return { ok: false, code: 'VALIDATION_FAILED', error: 'عملیات سند معتبر نیست.' };
    /* هیچ رقمِ دستِ client در درخواست سند معنا ندارد: ردیف‌ها و مبلغ‌ها را موتور صورتحساب
       از خودِ سفارش و دفترِ صورتحساب می‌سازد. اگر کسی آنها را بفرستد، درخواست رد می‌شود
       تا «عددِ فرستاده‌شدهٔ ایستگاه» هرگز منبع پول نشود. */
    if (['rows', 'amount', 'totals', 'invoice'].some(k => Object.prototype.hasOwnProperty.call(payload, k))) {
      return { ok: false, code: 'VALIDATION_FAILED', error: 'مبلغ و ردیف‌های سند را سرور می‌سازد؛ request نباید عددِ مالی داشته باشد.' };
    }
    try {
      let result;
      db.tx(() => {
        const actor = { id: s.user.id, name: s.user.name, role: s.user.role };
        if (action === 'void') {
          if (typeof payload.documentId !== 'string' || typeof payload.reason !== 'string' || !payload.reason.trim() || payload.reason.trim().length > 2000) throw new Error('شناسه سند و دلیل ابطال لازم است.');
          const row = db.get('SELECT record FROM financial_documents WHERE id = ? AND order_id = ?', payload.documentId, orderId);
          if (!row) throw Object.assign(new Error('سند پیدا نشد.'), { code: 'NOT_FOUND' });
          const old = JSON.parse(row.record);
          if (old.status === 'void') { result = { ok: true, document: old, idempotent: true }; return; }
          const document = { ...old, status: 'void', voidedAt: now(), voidedBy: actor, voidReason: payload.reason.trim() };
          db.run('UPDATE financial_documents SET status = ?, record = ? WHERE id = ?', 'void', JSON.stringify(document), old.id);
          audit(s, 'document_void', old.id, document.voidReason);
          result = { ok: true, document, idempotent: false }; return;
        }
        const order = (readKey('printshop_orders_v5') || []).find(o => o.id === orderId);
        if (!order) throw Object.assign(new Error('سفارش پیدا نشد.'), { code: 'NOT_FOUND' });
        const pricing = validatedPricing(order);
        const type = action === 'issue_partial_invoice' ? 'invoice' : action.slice(6);
        const isInvoice = type === 'invoice';
        const billedRows = isInvoice ? billedInvoiceRows(order.id, pricing.revision) : [];
        if (!isInvoice) {
          const existing = db.get('SELECT record FROM financial_documents WHERE order_id = ? AND quote_revision = ? AND type = ? ORDER BY created_at', order.id, pricing.revision, type);
          if (existing) { result = { ok: true, document: JSON.parse(existing.record), idempotent: true }; return; }
        }
        if (isInvoice && order.workflow?.customerConfirmation?.quoteRevision !== pricing.revision) throw new Error('صدور فاکتور به تأیید مشتری برای نسخه فعلی پیش‌فاکتور نیاز دارد.');
        /* دو راهِ صدور فاکتور، دو قاعدهٔ جدا:
           «فاکتور» (کامل) کلِ پیش‌فاکتورِ تأییدشده را یک‌بار طلب می‌کند — همان رفتارِ امروز،
           تا سفارش‌های بی‌عدَدِ تحویل هیچ‌وقت نصفه صورتحساب نشوند.
           «فاکتور تحویلی» فقط باقی‌ماندهٔ ردیف‌های هر‌نسخه‌ای را بر مبنای تعدادِ تحویلِ
           ثبت‌شده می‌گیرد و ردیفِ ثابت (زینک، کاغذِ ورق، جلدِ ورق) را یک‌بار طلب می‌کند. */
        let billing = null;
        if (isInvoice && action === 'issue_invoice') {
          if (billedRows.length) {
            const full = invoiceDocuments(order.id, pricing.revision).find(d => d.snapshot && d.snapshot.billingMode === 'full');
            if (full) { result = { ok: true, document: full, idempotent: true }; return; }
            throw new Error('برای این نسخه فاکتور تحویلی صادر شده است؛ فاکتورِ کامل همان ردیف‌ها را دوباره می‌طلبد. برای باقی‌مانده «فاکتور تحویلی» را بزنید.');
          }
        }
        if (isInvoice && action === 'issue_partial_invoice') {
          billing = billingEngine.invoiceProposal(order, pricing, billedRows);
          const block = partialInvoiceBlock(billing, billedRows);
          if (block) throw new Error(block);
        }
        const id = crypto.randomBytes(16).toString('hex');
        const printSettings = documentPrintSettings();
        const invoiceResult = billing ? billingEngine.partialQuoteResult(pricing, billing) : pricing.result;
        const document = { id, type, number: reserveNumber(type, id), status: 'issued', orderId: order.id, orderNumber: order.orderNumber,
          quoteRevision: pricing.revision, createdAt: now(), createdBy: actor,
          snapshot: { order: structuredClone(order), customer: structuredClone((readKey(CUSTOMER_KEY) || []).find(c => c.id === order.customerId) || { id: order.customerId || '', name: order.customerName || '', customerCode: order.customerCode || '' }),
            seller: structuredClone(printSettings.company), printSettings,
            ...(isInvoice ? {
              invoice: require('./invoice').buildInvoiceData(invoiceResult),
              billingMode: billing ? 'partial' : 'full',
              /* اثرِ انگشتِ صورتحساب: حالت قرارداد، سه عددِ هر قلم، تحویل‌هایی که این سند
                 از آنها شمارد و هشدارهای موتور. بیرون از خودِ سند هم در دفترِ صورتحساب
                 ردیف به ردیف ثبت می‌شود، پس از هر رقمِ فاکتور می‌توان به ردیفِ پیش‌فاکتور رسید. */
              contractMode: billingEngine.contractMode(pricing),
              ...(billing ? { billedTotals: billing.totals, cumulativeTotals: billing.cumulative, items: billing.items, warnings: billing.warnings,
                deliveries: (order.items || []).flatMap(it => (it.deliveries || []).map(d => ({ itemId: it.id, id: d.id, billable: d.billable, at: d.at }))) } : {}),
            } : {}) } };
        db.run('INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)', id, type, order.id, pricing.revision, document.number, document.status, JSON.stringify(document), document.createdAt);
        if (isInvoice) {
          const ledgerRows = billing ? billing.rows
            : billingEngine.linesOf(pricing).map(line => ({ lineId: line.id, itemId: line.itemId || '', kind: line.kind, qty: line.qty, amount: billingEngine.whole(line.cost) }));
          for (const row of ledgerRows) {
            db.run('INSERT INTO invoice_billings(document_id,line_id,order_id,quote_revision,item_id,kind,qty,amount,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
              id, row.lineId, order.id, pricing.revision, row.itemId || '', row.kind, billingEngine.whole(row.qty), billingEngine.whole(row.amount), document.createdAt);
          }
        }
        audit(s, 'document_issued', id, `${type}:${document.number}${isInvoice ? ` — ${billing ? 'فاکتور تحویلی' : 'فاکتور کامل'} ${document.snapshot.invoice.totals.total.toLocaleString('fa-IR')} ریال` : ''}`);
        result = { ok: true, document, idempotent: false };
      });
      return result;
    } catch (e) { return { ok: false, code: e.code || 'VALIDATION_FAILED', error: e.message }; }
  }
  function visibleNotification(s, n) {
    if (s.user.role === M) return true;
    if (n.audience === 'staff') return STAFF.includes(s.user.role);
    if (n.audience === 'finance') return s.user.role === F;
    if (n.audience === 'customer') return s.user.role === CUS && !!s.user.customerId && n.customerId === s.user.customerId;
    return false;
  }
  function getNotifications(token) {
    const s = sess(token); if (!s) return authFailure(token);
    const rows = db.all('SELECT n.record, r.read_at FROM notification_outbox n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ? ORDER BY n.ts DESC, n.rowid DESC', s.user.id);
    return { ok: true, notifications: rows.map(row => ({ ...JSON.parse(row.record), read: !!row.read_at })).filter(n => visibleNotification(s, n)).slice(0, 200) };
  }
  function markRead(token, id) {
    const s = sess(token); if (!s) return authFailure(token);
    if (typeof id !== 'string') return { ok: false, code: 'VALIDATION_FAILED', error: 'شناسه نامعتبر است.' };
    const row = db.get('SELECT record FROM notification_outbox WHERE id = ?', id);
    if (!row || !visibleNotification(s, JSON.parse(row.record))) return { ok: false, code: 'FORBIDDEN', error: 'دسترسی مجاز نیست.' };
    db.run('INSERT INTO notification_reads(notification_id,user_id,read_at) VALUES(?,?,?) ON CONFLICT(notification_id,user_id) DO UPDATE SET read_at = excluded.read_at', id, s.user.id, now());
    return { ok: true };
  }

  const migration = migrateLegacy();
  const partyCycle = backfillPartyCycle();
  /* اصلاحات ۱۷/بند ۲: پس از ورودِ دادهٔ قدیمی، ردیف‌های پرداختِ داخل سفارش به «رسید
     افتتاحیه» تبدیل می‌شوند و بازتابِ paymentsِ هر سفارش از خودِ رسیدها ساخته می‌شود.
     idempotent است و اگر چیزی برای مهاجرت نباشد هیچ ردیفی نمی‌نویسد. */
  const receiptLedger = syncReceiptLedger();
  ensureDefaultAdmin();
  audit(null, 'backend_started', dbFile);

  return {
    info, login, logout, get, set, del, listUsers, saveUsers, setOwnPassword, verifyPin, submitRequest, customerAction, partyAction, customerProfile, customerFinance, stockCardex, unfinishedWork, productionBoard, ledgerCoding, customerCreditFile, creditFiles, saveCreditPolicy, approveCreditException, receiptsFor, recordReceipt, chequeAction, voidReceipt, deliveryReport, financeReport, aiKeyFor, audit, backup, backupNow, auditFor, currentUser, orderAction, getNotifications, markRead, previewQuote, numberingSettings, saveNumberingSettings, documents, documentAction, invoiceProposal, consignReceipt,
    migration, partyCycle, receiptLedger, dbFile, backupStatus, previewOrderReset, resetOrders, catalogImport, changes, markSeen, liveStamps, close: () => db.close(),
    _db: db, _sessions: sessions,
    auditRows: (limit = 100) => db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit),
  };
}

module.exports = { createBackend, ACCESS, legacyHash, openSqlite, REQUEST_STATUS };
