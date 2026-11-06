'use strict';
/* اصلاحات ۱۷/بند ۲: رسید وصول‌شونده و تخصیص وجه به فاکتور.
   این ماژول پاک است — نه بانک می‌خواند، نه چیزی می‌نویسد؛ همان قاعدهٔ credit.js.
   دو چیز اینجا عوض می‌شود: (۱) پولِ دریافتی یک سند مستقل دارد، نه یک ردیفِ آزاد داخل سفارش؛
   (۲) هر ریالِ دریافتی یا به یک فاکتور/سفارش تخصیص می‌خورد یا «پیش‌پرداخت» می‌ماند،
   و هیچ‌کدام از دو حالت با عددِ دیگری جمع نمی‌شود.
   واحد پول همه‌جا ریالِ صحیح است. */

/* تنها منبعِ نامِ روش‌ها همین فهرست است؛ رابط پنلِ رسید را با ledger.methodsِ سرور
   می‌سازد تا آرایهٔ paymentsِ سفارش (که حالا فقط بازتابِ همین رسیدهاست) دو جور نام‌گذاری نشود. */
const METHODS = ['نقد', 'کارت به کارت', 'چک', 'حواله بانکی'];
const CHEQUE = 'چک';

/* وضعیت چک همان پنج وضعیتی است که کارفرما خواست؛ بی‌اعتباریِ سند هم یک وضعیت است، نه حذفِ ردیف. */
const STATUS = { HELD: 'held', IN_TRANSIT: 'in_transit', CLEARED: 'cleared', BOUNCED: 'bounced', VOID: 'void' };
const STATUS_LABELS = { held: 'در دست', in_transit: 'در جریان وصول', cleared: 'وصول‌شده', bounced: 'برگشتی', void: 'باطل' };
/* سه وضعیت اول «ماندهٔ مشتری را کم می‌کند»: به گفتهٔ کارفرما چکی که گرفته‌ایم مطالبه را
   تسویه می‌کند ولی تا روز وصول نقدِ صندوق نیست. برگشتی و باطل هیچ اثری ندارند. */
const DEBT_LIVE = [STATUS.HELD, STATUS.IN_TRANSIT, STATUS.CLEARED];

function whole(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : (Number.isFinite(n) ? Math.round(n) : 0);
}

function isLive(status) { return DEBT_LIVE.includes(status); }
/* پولِ نقدشده: هر چیزی که وصول شده، و هر دریافتِ غیرچکی که سند خورده است. */
function isCash(receipt) { return receipt.status === STATUS.CLEARED || (receipt.method !== CHEQUE && receipt.status !== STATUS.VOID && receipt.status !== STATUS.BOUNCED); }
function isPendingCheque(receipt) { return receipt.method === CHEQUE && (receipt.status === STATUS.HELD || receipt.status === STATUS.IN_TRANSIT); }

function isoDay(value, label) {
  const text = typeof value === 'string' ? value.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} باید تاریخ روز به شکل ۱۴۰۵-۰۸-۱۱ باشد.`);
  return text;
}

function text(value, label, max) {
  const out = String(value ?? '').trim();
  if (out.length > max) throw new Error(`${label} بیش از ${max} نویسه است.`);
  return out;
}

/* ورودیِ ثبت رسید: مبلغِ معتبر، روشِ شناخته‌شده، و برای چک شماره/بانک/سررسید.
   هیچ‌کدام عددِ سازگارنبوده را بی‌صدا نمی‌سازد — همان درسِ بند ۱ (fail‑closed). */
function receiptOf(input, actor = {}) {
  if (!plain(input)) throw new Error('رسید معتبر نیست.');
  const amount = Number(input.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('مبلغ رسید باید عدد صحیح مثبت به ریال باشد.');
  const method = text(input.method, 'روش دریافت', 40);
  if (!METHODS.includes(method)) throw new Error('روش دریافت در فهرست مجاز نیست.');
  const status = input.status === undefined || input.status === null ? null : String(input.status);
  if (status !== null && !Object.values(STATUS).includes(status)) throw new Error('وضعیت رسید شناخته‌شده نیست.');
  const receivedAt = isoDay(input.receivedAt || input.date || today(), 'تاریخ دریافت');
  const cheque = method === CHEQUE
    ? { number: text(input.chequeNumber, 'شماره چک', 40), bank: text(input.chequeBank, 'بانک', 80), branch: text(input.chequeBranch, 'شعبه', 60), due: input.chequeDue ? isoDay(input.chequeDue, 'سررسید چک') : '' }
    : null;
  if (cheque && !cheque.number) throw new Error('برای چک، شمارهٔ چک لازم است.');
  /* چکِ تازه‌گرفته‌شده «در دست» است؛ نقد و حواله و کارت همان لحظه در صندوق/بانک نشسته‌اند. */
  const state = status || (method === CHEQUE ? STATUS.HELD : STATUS.CLEARED);
  if (method === CHEQUE && (state === STATUS.CLEARED) === false && !cheque.due) throw new Error('برای چک، تاریخ سررسید لازم است.');
  if (method !== CHEQUE && state !== STATUS.CLEARED && state !== STATUS.VOID) throw new Error('دریافتِ غیرچکی فقط می‌تواند وصول‌شده یا باطل باشد.');
  return {
    id: text(input.id, 'شناسه رسید', 64),
    number: text(input.number, 'شماره رسید', 40),
    customerId: text(input.customerId, 'مشتری', 64),
    orderId: text(input.orderId, 'سفارش', 64),
    method, amount, status: state, receivedAt,
    cheque,
    note: text(input.note, 'یادداشت رسید', 500),
    legacyPaymentId: input.legacyPaymentId ? text(input.legacyPaymentId, 'شناسه پرداخت پیشین', 64) : '',
    createdBy: { id: text(actor.id, 'کاربر', 64), name: text(actor.name, 'نام کاربر', 80), role: text(actor.role, 'نقش', 40) },
    createdAt: Number(input.createdAt) || 0,
    clearedAt: input.clearedAt ? isoDay(input.clearedAt, 'تاریخ وصول') : '',
    voidedBy: input.voidedBy || null, voidReason: text(input.voidReason, 'دلیل ابطال', 500), voidedAt: Number(input.voidedAt) || 0,
  };
}

function plain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function today() { return new Date().toISOString().slice(0, 10); }

/* پیشنهادِ تخصیص: اول فاکتورهای صادرشده، از سررسیدِ گذشته به امروز؛ بعد سفارش‌های
   تأییدشدهٔ بی‌فاکتور به ترتیب تاریخ؛ و هر باقی‌مانده «پیش‌پرداخت» می‌ماند.
   این فقط پیشنهاد است — رابط در همان ردیف قابل تغییرش می‌کند، سرور جمع را کنترل می‌کند. */
function proposeAllocations(lines, amount) {
  const target = whole(amount);
  const open = (lines || []).filter(l => l && whole(l.open) > 0);
  const rank = l => (l.kind === 'definite' ? 0 : 1);
  const ordered = open.slice().sort((a, b) =>
    rank(a) - rank(b)
    || String(a.dueDate || a.documentDate || '').localeCompare(String(b.dueDate || b.documentDate || ''))
    || String(a.orderNumber || '').localeCompare(String(b.orderNumber || '')));
  let left = target;
  const rows = [];
  for (const line of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, whole(line.open));
    if (take <= 0) continue;
    rows.push({ orderId: line.orderId, documentId: line.documentId || '', amount: take, kind: line.kind, source: line.source, dueDate: line.dueDate || '' });
    left -= take;
  }
  return { rows, advance: Math.max(0, left) };
}

/* بازتابِ paymentsِ سفارش: هر تخصیصِ زنده یک ردیفِ پرداخت. هیچ ایستگاهی جز خودِ سرور
   این را نمی‌نویسد، پس عددِ «پرداخت‌شده» در پروندهٔ اعتباری، گزارش مالی و پنل مشتری یکی است. */
function mirrorOf(receipts, allocations, orderId) {
  const byReceipt = new Map((receipts || []).filter(r => r && r.id).map(r => [r.id, r]));
  const rows = [];
  for (const a of allocations || []) {
    if (!a || a.orderId !== orderId) continue;
    const r = byReceipt.get(a.receiptId);
    if (!r || !isLive(r.status)) continue;
    rows.push({
      id: a.id, amount: whole(a.amount), method: r.method, date: r.receivedAt,
      receiptNumber: r.number, status: r.status, statusLabel: STATUS_LABELS[r.status] || '',
      chequeNumber: r.cheque ? r.cheque.number : '', chequeBank: r.cheque ? r.cheque.bank : '', chequeDue: r.cheque ? r.cheque.due : '',
      allocatedTo: a.documentId ? 'فاکتور' : 'سفارش', legacyPaymentId: r.legacyPaymentId || '',
    });
  }
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.receiptNumber).localeCompare(String(b.receiptNumber)));
}

/* جمع‌های یک مشتری از روی سند، نه از روی آرایهٔ سفارش. */
function totals(receipts, allocations, customerId) {
  const mine = (receipts || []).filter(r => r && r.customerId === customerId);
  const live = mine.filter(r => isLive(r.status));
  const byId = new Map(live.map(r => [r.id, r]));
  let allocated = 0, pendingCheque = 0, cleared = 0;
  for (const a of allocations || []) {
    if (!byId.has(a.receiptId)) continue;
    allocated += whole(a.amount);
  }
  for (const r of live) {
    if (isPendingCheque(r)) pendingCheque += whole(r.amount);
    if (isCash(r)) cleared += whole(r.amount);
  }
  const gross = live.reduce((s, r) => s + whole(r.amount), 0);
  return { gross, allocated, advance: Math.max(0, gross - allocated), pendingCheque, cleared };
}

const RECEIPT_FIELDS = [
  ['number', 'شماره رسید'], ['receivedAt', 'تاریخ دریافت'], ['method', 'روش'], ['amount', 'مبلغ'],
  ['statusLabel', 'وضعیت'], ['chequeNumber', 'شماره چک'], ['chequeBank', 'بانک و شعبه'], ['chequeDue', 'سررسید چک'],
];

module.exports = {
  METHODS, CHEQUE, STATUS, STATUS_LABELS, DEBT_LIVE, RECEIPT_FIELDS,
  isCash, isLive, isPendingCheque, mirrorOf, proposeAllocations, receiptOf, today, totals, whole,
};
