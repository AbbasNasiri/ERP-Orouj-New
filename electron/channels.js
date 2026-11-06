'use strict';
/* یک جدول، دو مصرف: همان کانال‌ها از IPC فرایند اصلی و از HTTP سرور می‌گذرند.
   هیچ نامی جز این جدول پذیرفته نمی‌شود، پس هیچ‌وقت چیزی مثل _db یا close بیرون از برنامه باز نمی‌شود.
   در هر دو مسیر، نخستین آرگومان توکن نشست است و دروازهٔ دسترسی همان backend.js می‌ماند. */

const CHANNELS = {
  'be:info': { auth: false, arity: 0, call: (b, ctx, t, a) => b.info() },
  'be:login': { auth: false, arity: 2, call: (b, ctx, t, [u, p]) => b.login(u, p) },
  'be:logout': { arity: 0, call: (b, ctx, t, a) => ({ ok: b.logout(t) }) },
  /* بند پ: فهرست‌هایی که این ایستگاه از این پس دیدهِ آنها را به‌روز می‌شمارد. «live» یا فهرست
     ثابت است یا تابعی از آرگومان‌های همان درخواست؛ خواندن هم یک «دیده شد» است. */
  'be:changes': { arity: 0, call: (b, ctx, t, a) => b.changes(t) },
  'be:get': { arity: 1, live: (a) => [a[0]], call: (b, ctx, t, [k]) => b.get(t, k) },
  'be:set': { arity: 3, live: (a) => [a[0]], call: (b, ctx, t, [k, v, expected]) => b.set(t, k, v, expected, ctx && ctx.origin) },
  'be:del': { arity: 1, live: (a) => [a[0]], call: (b, ctx, t, [k]) => b.del(t, k) },
  'be:orderAction': { arity: 3, live: () => [ORDERS, INVENTORY, RECEIPTS], call: (b, ctx, t, [id, action, payload]) => b.orderAction(t, id, action, payload) },
  /* بند ۵/الف: رسید امانت — مسیر نوشتن فقط همین است؛ be:set روی این کلید بسته است. */
  'be:consignReceipt': { arity: 1, live: () => [CONSIGNMENTS, INVENTORY], call: (b, ctx, t, [payload]) => b.consignReceipt(t, payload) },
  'be:previewQuote': { arity: 2, call: (b, ctx, t, [id, input]) => b.previewQuote(t, id, input) },
  'be:customerAction': { arity: 3, live: () => [CUSTOMERS], call: (b, ctx, t, [id, action, payload]) => b.customerAction(t, id, action, payload) },
  'be:partyAction': { arity: 4, live: (a) => [a[0] === 'customer' ? CUSTOMERS : SUPPLIERS], call: (b, ctx, t, [kind, id, action, payload]) => b.partyAction(t, kind, id, action, payload) },
  'be:catalogImport': { arity: 3, call: (b, ctx, t, [dataset, rows, options]) => b.catalogImport(t, dataset, rows, options) },
  'be:numberingSettings': { arity: 0, call: (b, ctx, t, a) => b.numberingSettings(t) },
  'be:saveNumberingSettings': { arity: 1, live: () => [SETTINGS], call: (b, ctx, t, [settings]) => b.saveNumberingSettings(t, settings) },
  'be:previewOrderReset': { arity: 0, call: (b, ctx, t, a) => b.previewOrderReset(t) },
  'be:resetOrders': { arity: 1, live: () => [ORDERS, INVENTORY, RECEIPTS], call: (b, ctx, t, [payload]) => b.resetOrders(t, payload) },
  'be:documents': { arity: 0, call: (b, ctx, t, a) => b.documents(t) },
  'be:documentAction': { arity: 3, live: () => [ORDERS, RECEIPTS, DOCUMENTS], call: (b, ctx, t, [id, action, payload]) => b.documentAction(t, id, action, payload) },
  /* اصلاحات ۱۷/بند ۳: پیشنهادِ صورتحسابِ تحویلی — فقط‌خواندنی و فقط مدیر/مالی؛ عددها را
     خودِ سرور از سفارش و دفترِ صورتحساب می‌شمارد. دروازه در backend.js است. */
  'be:invoiceProposal': { arity: 1, live: () => [ORDERS, DOCUMENTS], call: (b, ctx, t, [id]) => b.invoiceProposal(t, id) },
  'be:customerProfile': { arity: 0, call: (b, ctx, t, a) => b.customerProfile(t) },
  'be:customerFinance': { arity: 0, call: (b, ctx, t, a) => b.customerFinance(t) },
  /* بند ۵/ب: کاردکس — خواندنی؛ فیلترها و ماندهٔ تجمعی سمت سرور حساب می‌شوند. */
  'be:stockCardex': { arity: 1, live: () => [INVENTORY], call: (b, ctx, t, [input]) => b.stockCardex(t, input) },
  /* بند ۵/پ: گزارش کارهای ناتمام — خواندنی؛ مرحله، تحرک، موعد و بدهی سمت سرور حساب می‌شود. */
  'be:unfinishedWork': { arity: 1, live: () => [ORDERS], call: (b, ctx, t, [input]) => b.unfinishedWork(t, input) },
  /* اصلاحات ۱۴/۵: کادر معلق تابلو — خواندنی؛ سه دلیل سمت سرور از رکورد واقعی سفارش و سند پیش‌فاکتور حساب می‌شود. */
  'be:productionBoard': { arity: 0, live: () => [ORDERS, DOCUMENTS], call: (b, ctx, t) => b.productionBoard(t) },
  /* اصلاحات ۱۷/بند ۰: کدینگ و نگاشت رویداد→سند — فقط‌خواندنی و فقط مدیر چاپخانه/مدیر مالی؛ دروازه در backend.js است. */
  'be:ledgerCoding': { arity: 0, call: (b, ctx, t) => b.ledgerCoding(t) },
  /* اصلاحات ۱۷/بند ۱: پروندهٔ اعتباری. خواندن برای مدیر/مالی/کارشناس سفارشات (رقم‌ها فقط برای
     دو نقش اول)، سیاست اعتبار را مدیر و مدیر مالی می‌نویسند و مجوز استثنایی فقط مدیر چاپخانه.
     همهٔ دروازه‌ها در backend.js است؛ این جدول فقط نام‌ها را باز می‌گذارد. */
  'be:creditFiles': { arity: 0, call: (b, ctx, t) => b.creditFiles(t) },
  'be:customerCreditFile': { arity: 1, call: (b, ctx, t, [input]) => b.customerCreditFile(t, input) },
  'be:saveCreditPolicy': { arity: 1, live: () => [CUSTOMERS], call: (b, ctx, t, [input]) => b.saveCreditPolicy(t, input) },
  'be:approveCreditException': { arity: 1, live: () => [ORDERS], call: (b, ctx, t, [input]) => b.approveCreditException(t, input) },
  /* اصلاحات ۱۷/بند ۲: دفترِ رسیدهای وجه — نوشتن فقط مدیر/مالی، بازتابِ paymentsِ سفارش
     را خودِ سرور می‌سازد و از راه be:set بسته است. */
  'be:receipts': { arity: 1, call: (b, ctx, t, [input]) => b.receiptsFor(t, input) },
  'be:recordReceipt': { arity: 1, live: () => [ORDERS], call: (b, ctx, t, [payload]) => b.recordReceipt(t, payload) },
  'be:receiptCheque': { arity: 2, live: () => [ORDERS], call: (b, ctx, t, [id, action]) => b.chequeAction(t, id, action) },
  'be:voidReceipt': { arity: 1, live: () => [ORDERS], call: (b, ctx, t, [input]) => b.voidReceipt(t, input) },
  /* بند ۵/ت: گزارش تحویل — خواندنی؛ دو جدول «باید تحویل شود» و «تحویل‌شده» سمت سرور حساب می‌شوند. */
  'be:deliveryReport': { arity: 1, live: () => [ORDERS], call: (b, ctx, t, [input]) => b.deliveryReport(t, input) },
  /* بند ۵/ث: گزارش مالی و تسویه — خواندنی و فقط برای مدیر/مالی؛ مبالغ از snapshot سفارش خوانده می‌شود. */
  'be:financeReport': { arity: 1, live: () => [ORDERS, DOCUMENTS], call: (b, ctx, t, [input]) => b.financeReport(t, input) },
  'be:notifications': { arity: 0, call: (b, ctx, t, a) => b.getNotifications(t) },
  'be:notificationRead': { arity: 1, call: (b, ctx, t, [id]) => b.markRead(t, id) },
  'be:listUsers': { arity: 0, call: (b, ctx, t, a) => b.listUsers(t) },
  'be:saveUsers': { arity: 1, call: (b, ctx, t, [u]) => b.saveUsers(t, u) },
  'be:setOwnPassword': { arity: 1, call: (b, ctx, t, [p]) => b.setOwnPassword(t, p) },
  'be:whoami': { arity: 0, call: (b, ctx, t, a) => b.currentUser(t) },
  'be:verifyPin': { arity: 1, call: (b, ctx, t, [pin]) => b.verifyPin(t, pin) },
  'be:submitRequest': { arity: 2, live: () => [ORDERS], call: (b, ctx, t, [text, phone]) => b.submitRequest(t, text, phone) },
  'be:audit': { arity: 1, call: (b, ctx, t, [n]) => b.auditFor(t, n) },
  'be:backupNow': { arity: 0, call: (b, ctx, t, a) => b.backupNow(t, ctx.backupDir) },
  'be:backupStatus': { arity: 0, call: (b, ctx, t, a) => b.backupStatus(t, ctx.backupDir) },
};
const ORDERS = 'printshop_orders_v5';
const CUSTOMERS = 'printshop_customers_v2';
const SUPPLIERS = 'printshop_suppliers_v2';
const INVENTORY = 'printshop_inventory_v3';
const RECEIPTS = 'printshop_receipts_v1';
const CONSIGNMENTS = 'printshop_consignments_v1';
const SETTINGS = 'printshop_settings_v1';
const DOCUMENTS = 'printshop_documents_v1';

/* پاسخ هر کانال در دو مسیر یکی است: یا نتیجهٔ موتور، یا یک شیء خطا. هیچ استثنا از تابع
   بیرون نمی‌رود؛ متن خطا به شکل همان کدهایی برمی‌گردد که رابط کاربری امروز می‌شناسد.
   آرگومان‌های پایینی که رابط کاربری نمی‌فرستد undefined می‌مانند (همان رفتار IPC امروز)؛
   بیشتر از مقدارِ تعریف‌شده هر کانال پذیرفته نمی‌شود. */
function invoke(name, backend, ctx, token, args) {
  const c = CHANNELS[name];
  if (!c) return { ok: false, code: 'FORBIDDEN', error: 'این درخواست شناخته شده نیست.' };
  const session = c.auth !== false; // فقط be:info و be:login بدون نشست‌اند؛ بقیه باید توکن درست بیاورند
  const list = Array.isArray(args) ? args.slice(0, c.arity) : [];
  while (list.length < c.arity) list.push(undefined);
  if (!session && !list.every(x => x === undefined || typeof x === 'string')) {
    return { ok: false, code: 'VALIDATION_FAILED', error: 'آرگومان‌های درخواست معتبر نیست.' };
  }
  if (session && (typeof token !== 'string' || !TOKEN_PATTERN.test(token))) {
    return { ok: false, code: 'UNAUTHENTICATED', error: 'نشست معتبر نیست؛ دوباره وارد شوید.' };
  }
  try {
    const result = c.call(backend, ctx, session ? token : null, list);
    /* بند پ: هر کاری که این ایستگاه خودش انجام داد (یا خواند) برای خودش «دیده شد» حساب می‌شود،
       تا نوار خبردادنِ تغییر، نوشتنِ خودِ اپراتور را به خودش برنگرداند. خطای این کار هرگز
       نباید نتیجهٔ درخواست را خراب کند، پس بی‌صدا نادیده گرفته می‌شود. */
    if (session && c.live && result && result.ok !== false && typeof backend.markSeen === 'function') {
      try { backend.markSeen(token, c.live(list)); } catch (_) { /* نشانهٔ زنده ارزش شکستِ کار را ندارد */ }
    }
    return result;
  } catch (err) {
    return { ok: false, code: 'REQUEST_FAILED', error: String((err && err.message) || err) };
  }
}

const TOKEN_PATTERN = /^[A-Za-z0-9]{16,128}$/;
module.exports = { CHANNELS, invoke, TOKEN_PATTERN };
