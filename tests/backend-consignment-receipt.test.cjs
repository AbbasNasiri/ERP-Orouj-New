'use strict';
/* بند ۵/الف: رسید «تحویل کالا از مشتری».
   راستی‌آزمایی‌ها: فقط مدیر و انباردار ثبت می‌کنند، تاریخ/ساعت/تحویل‌گیرنده را سرور می‌نویسد،
   موجودی و کاردکس همان‌جا بزرگ می‌شود، و هیچ ایستگاهی نمی‌تواند رسید را جعل یا ویرایش کند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const INV = 'printshop_inventory_v3';
const CON = 'printshop_consignments_v1';
const PASS = 'strong-consign-pass';
const today = () => new Date().toISOString().slice(0, 10);

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-consign-'));
  const b = createBackend({ dataDir: dir, openDb });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, PASS);
  const users = b.listUsers(manager).users;
  users.push(
    { id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', _plain: PASS },
    { id: 'money', name: 'مدیر مالی', username: 'money', role: 'مدیر مالی', _plain: PASS },
  );
  assert.equal(b.saveUsers(manager, users).ok, true);
  const store = b.login('store', PASS).token;
  const money = b.login('money', PASS).token;
  assert.equal(b.set(manager, 'printshop_customers_v2', [{ id: 'c1', name: 'مشتری الف' }]).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c1', 'approve', { reason: 'معتبر' }).ok, true, 'مشتری از چرخهٔ بررسی می‌گذرد');
  assert.equal(b.partyAction(manager, 'customer', 'c1', 'issue_number').ok, true, 'کد یکتا پس از تأیید صادر می‌شود');
  assert.equal(b.set(manager, INV, [{
    id: 'p1', name: 'تحریر ۷۰گرم', category: 'کاغذ', unitMode: 'band_sheet', bandCount: '4', sheetsPerBand: '500',
    ownerType: 'مشتری', ownerCustomerId: 'c1', purposeScope: 'all', movements: [{ id: 'm0', date: '2026-01-01', type: 'in', qty: 4, note: 'موجودی اولیه' }],
  }, {
    id: 'k1', name: 'مقوای جلد', category: 'مقوا', unitMode: 'simple', quantity: '10', simpleUnit: 'بسته', ownerType: 'چاپخانه', movements: [],
  }]).ok, true);
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const receipt = (token, payload) => b.consignReceipt(token, payload);
  return { b, dir, manager, store, money, receipt };
}

test('انباردار رسید ثبت می‌کند: سرور شماره، ساعت و تحویل‌گیرنده را می‌نویسد و موجودی و کاردکس بزرگ می‌شود', t => {
  const { b, manager, store, receipt } = fixture(t);
  const r = receipt(store, { inventoryItemId: 'p1', date: today(), time: '۱۴:۳۰', qty: '۲', unit: 'بند', receivedBy: 'انباردار' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.receipt.receiptNumber, '8001', 'شماره رسید از شمارندگر جدایِ خودش شروع می‌شود');
  assert.equal(r.receipt.time, '14:30', 'ارقام فارسی به لاتین یکسان می‌شود');
  assert.equal(r.receipt.qty, 2);
  assert.equal(r.receipt.unit, 'بند');
  assert.equal(r.receipt.actorRole, 'انباردار', 'ثبت‌کننده از نشست می‌آید، نه از متن درخواست');
  const item = b.get(manager, INV).value.find(i => i.id === 'p1');
  assert.equal(item.bandCount, 6, 'موجودی به اندازهٔ همان مقدار افزایش یافت');
  const last = item.movements[item.movements.length - 1];
  assert.equal(last.type, 'in');
  assert.equal(last.unit, 'بند', 'گردشِ دستیِ بی‌واحد نیست');
  assert.equal(last.actorId, 'store', 'گردش می‌داند چه کسی آن را نوشت');
  const rows = b.get(manager, CON).value;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itemName, 'تحریر ۷۰گرم', 'برچسب کالا در خودِ رسید قفل می‌شود');
  assert.ok(b.auditRows(20).some(a => a.action === 'consignment_receipt'), 'حسابرسی ثبت شد');
});

test('واحد ورق به بند تبدیل و رول به کیلوگرم تبدیل می‌شود؛ واحد ناهمخوان رد می‌شود', t => {
  const { b, manager, store, receipt } = fixture(t);
  const sheets = receipt(store, { inventoryItemId: 'p1', date: today(), time: '10:05', qty: '1500', unit: 'ورق' });
  assert.equal(sheets.ok, true, sheets.error);
  assert.equal(sheets.receipt.qty, 3, '۱۵۰۰ ورق با ۵۰۰ ورق در هر بند = ۳ بند');
  assert.equal(b.get(manager, INV).value.find(i => i.id === 'p1').bandCount, 7);
  assert.equal(receipt(store, { inventoryItemId: 'p1', date: today(), time: '10:06', qty: '5', unit: 'کیلوگرم' }).code, 'VALIDATION_FAILED', 'کاغذ با واحد رول نمی‌آید');
  assert.equal(receipt(store, { inventoryItemId: 'p1', date: today(), time: '10:07', qty: '5' }).code, 'VALIDATION_FAILED', 'بدون واحد');
  assert.equal(receipt(store, { inventoryItemId: 'p1', date: today(), time: '10:08', qty: '0', unit: 'بند' }).code, 'VALIDATION_FAILED', 'مقدار صفر');
  assert.equal(receipt(store, { inventoryItemId: 'p1', date: today(), time: '25:00', qty: '1', unit: 'بند' }).code, 'VALIDATION_FAILED', 'ساعت نامعتبر');
  assert.equal(receipt(store, { inventoryItemId: 'p1', date: '2999-01-01', time: '10:00', qty: '1', unit: 'بند' }).code, 'VALIDATION_FAILED', 'تاریخ آینده');
  assert.equal(b.get(manager, INV).value.find(i => i.id === 'p1').bandCount, 7, 'هیچ‌کدام از ردشدنها موجودی را تکان نداد');
});

test('کنترل منفی دسترسی: مالی و تولید نوشتن ندارند؛ نوشتن دستی فهرست رسید و حذفش ممنوع است', t => {
  const { b, manager, money, store, receipt } = fixture(t);
  assert.equal(receipt(money, { inventoryItemId: 'p1', date: today(), time: '09:00', qty: '1', unit: 'بند' }).code, 'FORBIDDEN', 'مدیر مالی رسید امانت ثبت نمی‌کند');
  assert.equal(receipt(manager, { inventoryItemId: 'p1', date: today(), time: '09:00', qty: '1', unit: 'بند' }).ok, true, 'مدیر و انباردار مجازند');
  assert.equal(b.set(store, CON, [{ id: 'x1', date: today(), time: '09:00', qty: 1, inventoryItemId: 'p1', ownerCustomerId: 'c1' }]).code, 'FORBIDDEN', 'ایستگاه نمی‌تواند رسید را مستقیم بنویسد');
  assert.equal(b.del(store, CON).ok, false, 'حذف فهرست رسید مجاز نیست');
  assert.equal(b.set(manager, CON, [{ id: 'x1', date: today(), time: '۹:۰۰', qty: 1, inventoryItemId: 'p1', ownerCustomerId: 'c1' }]).ok, false, 'دروازۀ ساختار هم بسته است');
  assert.equal(b.get(manager, CON).value.length, 1, 'هیچ رکورد جعلی به فهرست اضافه نشد');
});

test('مالکیت: کالای چاپخانه، مشتری نامعتبر و سفارش ناموجود رد می‌شوند', t => {
  const { b, manager, store, receipt } = fixture(t);
  assert.equal(receipt(store, { inventoryItemId: 'k1', date: today(), time: '11:00', qty: '1', unit: 'بسته' }).code, 'FORBIDDEN', 'رسید فقط برای کالای امانی مشتری');
  assert.equal(receipt(store, { inventoryItemId: 'p1', ownerCustomerId: 'c9', date: today(), time: '11:00', qty: '1', unit: 'بند' }).code, 'FORBIDDEN', 'مشتری باید با مالک واقعی کالا بخورد');
  assert.equal(receipt(store, { inventoryItemId: 'p1', orderNumber: '4455667788', date: today(), time: '11:00', qty: '1', unit: 'بند' }).code, 'NOT_FOUND', 'سفارشِ متصل باید در بانک باشد');
  const forged = receipt(store, { inventoryItemId: 'p1', date: today(), time: '11:00', qty: '1', unit: 'بند', receivedBy: ' «مدیر چاپخانه» ', actorRole: 'مدیر چاپخانه' });
  assert.equal(forged.ok, true);
  assert.equal(forged.receipt.actorRole, 'انباردار', 'فیلدهای جعلی نشست در درخواست اثر ندارند');
  assert.equal(b.get(manager, INV).value.find(i => i.id === 'p1').movements.length, 2);
});

test('حساب مشتری فقط رسید کالای خودش را می‌بیند و در تنظیمات شماره‌گذاری شمارندگر دارد', t => {
  const { b, manager, store, receipt } = fixture(t);
  assert.equal(receipt(store, { inventoryItemId: 'p1', date: today(), time: '12:15', qty: '1', unit: 'بند' }).ok, true);
  assert.equal(b.set(manager, 'printshop_customers_v2', [...b.get(manager, 'printshop_customers_v2').value, { id: 'c2', name: 'مشتری ب' }]).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c2', 'approve', { reason: 'معتبر' }).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c2', 'issue_number').ok, true);
  const users = b.listUsers(manager).users;
  users.push({ id: 'cust1', name: 'مشتری الف', username: 'cust1', role: 'مشتری', customerId: 'c1', _plain: PASS });
  assert.equal(b.saveUsers(manager, users).ok, true);
  const cust = b.login('cust1', PASS).token;
  const rows = b.get(cust, CON).value;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customerName, 'مشتری الف');
  assert.equal(b.set(cust, CON, []).code, 'FORBIDDEN');
  const settings = b.numberingSettings(manager).settings;
  assert.equal(settings.consignmentreceipt.next, 8002, 'شمارندگر با هر رسید یک عدد جلو می‌رود');
});

test('کنترل منفی لایهٔ انتقال: کانال ناشناخته رد می‌شود و کانال رسید توکن معتبر می‌خواهد', t => {
  const { b, manager, store } = fixture(t);
  const backend = { consignReceipt: () => ({ ok: true, spy: true }) };
  assert.equal(invoke('be:unknown', backend, {}, store, []).code, 'FORBIDDEN');
  assert.equal(invoke('be:consignReceipt', backend, {}, 'x'.repeat(12), [{}]).code, 'UNAUTHENTICATED', 'بی‌توکنِ معتبر به موتور نمی‌رسد');
  assert.equal(invoke('be:consignReceipt', backend, {}, store, [{ inventoryItemId: 'p1' }]).spy, true, 'فقط آرگومان‌های اعلام‌شده منتقل می‌شوند');
  assert.equal(invoke('be:set', b, { origin: 'network' }, store, [CON, []]).code, 'FORBIDDEN', 'نوشتن از راه شبکه هم همان دروازۀ نقش را دارد');
  assert.equal(b.get(manager, CON).value, null, 'هیچ رکورد جعلی به فهرست نرسیده — کلید هنوز ساخته نشده');
});

test('ارتقای سازگار: بانکِ بی‌رسید، فهرست خالی می‌دهد و رسید قدیمیِ بی‌شماره دست‌نخورده می‌ماند', t => {
  const { b, manager } = fixture(t);
  assert.equal(b.get(manager, CON).value, null, 'تا نخستین رسید، کلیدی وجود ندارد');
  assert.equal(b.numberingSettings(manager).settings.consignmentreceipt.next, 8001);
});
