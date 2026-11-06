'use strict';
/* اصلاحات ۱۷/بند ۱: پروندهٔ اعتباری مشتری و یکنواختی قاعدهٔ بدهی.
   این ماژول پاک است — نه بانک می‌خواند، نه چیزی می‌نویسد. هر صفحه‌ای که عدد بدهی نشان می‌دهد
   باید از همین‌جا بگیرد؛ تا پیش از این، چهار مسیر مستقلِ مختلف عدد می‌ساختند.
   واحد پول همه‌جا ریالِ صحیح است. */

const REQUEST_STATUS = 'درخواست مشتری';
const PENDING_STATUS = 'در انتظار تایید';
const ARCHIVED_STATUS = 'بایگانی';
const CANCELLED_STATUS = 'لغو شده';

const CREDIT = {
  FREE: 'آزاد',
  WARNING: 'هشدار',
  BLOCKED: 'مسدود',
  APPROVAL: 'نیازمند مجوز',
  NO_POLICY: 'سقف تعیین‌نشده',
};

/* پیش‌فرض است، نه ملاک قبول کارفرما: درصد هشدار را خودش روی همان پرونده تغییر می‌دهد. */
const DEFAULT_WARN_PERCENT = 80;

function whole(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : (Number.isFinite(n) ? Math.round(n) : 0);
}

function payableOf(order) {
  if (order.pricing !== undefined) {
    /* واحد پول در pricing.result است (همان جایی که pricing.js می‌گذارد)، نه روی خودِ pricing. */
    const result = order.pricing && order.pricing.result;
    if (!result || !Number.isSafeInteger(result.total) || result.total < 0 || result.currency !== 'IRR') {
      throw new Error('مبلغ پیش‌فاکتور ثبت‌شده معتبر نیست.');
    }
    return result.total;
  }
  const items = (order.items || []).reduce((total, it) => total
    + whole(it && it.qty) * whole(it && it.unitPrice)
    + (it && it.services || []).reduce((s, sv) => s + whole(sv && sv.price), 0)
    + (it && it.hasDesign ? whole(it && it.designPrice) : 0), 0);
  const base = items + whole(order.shippingCost) + whole(order.otherCost) - whole(order.discount);
  return base + Math.round(Math.max(0, base) * whole(order.vatPercent) / 100);
}

function paidOf(order) {
  return (order.payments || []).reduce((s, p) => s + whole(p && p.amount), 0);
}

/* قاعدهٔ یکتای بدهیِ یک سفارش — همان چیزی که قبلاً در سرور و رابط دو جور حساب می‌شد. */
function balanceOf(order) {
  return payableOf(order) - paidOf(order);
}

/* سه دسته، نه بیشتر: بدهی قطعی (پشت فاکتور صادرشده)، تعهد (تأیید شده ولی فاکتور نشده)، بی‌اثر. */
function classify(order, invoice) {
  if (invoice) return 'definite';
  if (order.status === CANCELLED_STATUS) {
    const settled = whole(order.workflow && order.workflow.cancellationSettlement && order.workflow.cancellationSettlement.balance);
    return settled > 0 ? 'definite' : 'ignored';
  }
  if (order.status === PENDING_STATUS || order.status === ARCHIVED_STATUS || order.status === REQUEST_STATUS) return 'ignored';
  return 'committed';
}

function dayStamp(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Math.max(0, whole(days)));
  return d.toISOString().slice(0, 10);
}

/* خط‌به‌خطِ پرونده: هر سفارش مشتری با منشأ مبلغ، موعد و مانده‌اش. */
function creditLines(customerId, orders, invoicesByOrder, termDays, today) {
  const lines = [];
  for (const order of orders || []) {
    if (!order || order.customerId !== customerId) continue;
    const invoice = (invoicesByOrder || {})[order.id] || null;
    const kind = classify(order, invoice);
    if (kind === 'ignored') continue;
    const invoicedTotal = invoice ? whole(invoice.total) : null;
    const payable = invoicedTotal === null ? payableOf(order) : invoicedTotal;
    const paid = paidOf(order);
    const open = Math.max(0, payable - paid);
    const advance = Math.max(0, paid - payable);
    const startDay = invoice ? dayStamp(invoice.issuedAt) : dayStamp(order.date);
    const dueDay = kind === 'definite' ? addDays(startDay, termDays) : '';
    lines.push({
      orderId: order.id,
      orderNumber: String(order.orderNumber || ''),
      kind,
      /* اصلاحات ۱۷/بند ۲: تخصیص وجه «به کدام فاکتور» با شناسهٔ سند گره می‌خورد، پس
         همان شناسه در خطِ پرونده هم می‌آید (منبع فقط متنِ نمایشی است). */
      documentId: invoice ? invoice.documentId || '' : '',
      /* اصلاحات ۱۷/بند ۳: یک نسخهٔ پیش‌فاکتور می‌تواند چند فاکتورِ تحویلی داشته باشد، پس
         منشأٔ مبلغ «فاکتور اول و دومی که پشت آن آمده» را با هم نشان می‌دهد، نه فقط یکی. */
      source: invoice ? `فاکتور ${invoice.number}${invoice.documents && invoice.documents.length > 1 ? ` و ${(invoice.documents.length - 1).toLocaleString('fa-IR')} فاکتور تحویلی` : ''}` : 'بدون فاکتور',
      documentDate: startDay,
      dueDate: dueDay,
      payable,
      paid,
      open,
      advance,
      overdue: !!dueDay && !!today && dueDay < today,
    });
  }
  return lines;
}

function advanceLines(customerId, orders, lines) {
  /* پیش‌پرداختِ سفارش‌های بی‌اثر (در انتظار تأیید/درخواست) هم پولِ در دست چاپخانه است. */
  const covered = new Set(lines.map(l => l.orderId));
  let total = 0;
  for (const order of orders || []) {
    if (!order || order.customerId !== customerId || covered.has(order.id)) continue;
    if (order.status !== PENDING_STATUS && order.status !== REQUEST_STATUS) continue;
    total += Math.max(0, paidOf(order) - payableOf(order));
  }
  return total;
}

function policyOf(customer) {
  const limit = whole(customer && customer.creditLimit);
  const term = whole(customer && customer.paymentTermDays);
  const warn = customer && customer.creditWarnPercent === undefined || customer && customer.creditWarnPercent === null
    ? DEFAULT_WARN_PERCENT : whole(customer.creditWarnPercent);
  return { limit, term: term > 0 ? term : 0, warn: Math.min(100, Math.max(1, warn)) };
}

function sum(rows, key) { return rows.reduce((s, r) => s + r[key], 0); }

/* فرمول کارفرما: تعهد خالص = تعهد سفارش‌های تأییدشده + بدهی قطعی − پیش‌پرداختِ قابل‌استفاده
   اعتبار آزاد = سقف − تعهد خالص */
function creditFileOf(customer, orders, invoicesByOrder, today, extra = {}) {
  const policy = policyOf(customer);
  const lines = creditLines(customer.id, orders, invoicesByOrder, policy.term, today);
  const definiteRows = lines.filter(l => l.kind === 'definite');
  const committedRows = lines.filter(l => l.kind === 'committed');
  const definiteDebt = sum(definiteRows, 'open');
  const overdueDebt = sum(definiteRows.filter(l => l.overdue), 'open');
  const commitment = sum(committedRows, 'open');
  const advance = sum(lines, 'advance') + whole(extra.reservedAdvance) + advanceLines(customer.id, orders, lines);
  const netCommitment = Math.max(0, definiteDebt + commitment - advance);
  const available = policy.limit > 0 ? policy.limit - netCommitment : 0;
  const usedPercent = policy.limit > 0 ? Math.round(netCommitment * 100 / policy.limit) : 0;
  let status = CREDIT.NO_POLICY;
  if (policy.limit > 0) {
    if (netCommitment > policy.limit) status = CREDIT.BLOCKED;
    else if (usedPercent >= policy.warn) status = CREDIT.WARNING;
    else status = CREDIT.FREE;
  }
  return {
    customerId: customer.id,
    customerName: customer.name || '',
    customerCode: customer.customerCode || '',
    ceiling: policy.limit,
    termDays: policy.term,
    warnPercent: policy.warn,
    policySource: extra.policySource || '',
    definiteDebt,
    overdueDebt,
    advance,
    commitment,
    /* مجموعِ دست‌به‌نقدِ باز (قطعی + تعهد) — همان چیزی که دروازهٔ سرور رویش تصمیم می‌گیرد،
       پیش از آن‌که پیش‌پرداخت از آن کم شود. */
    openTotal: definiteDebt + commitment,
    netCommitment,
    available,
    usedPercent,
    status,
    openCount: definiteRows.length,
    committedCount: committedRows.length,
    overdueCount: definiteRows.filter(l => l.overdue).length,
    lines,
    approvals: extra.approvals || [],
  };
}

/* تصمیم برای یک سفارشِ در حال ثبت: چه قدر از سقف عبور می‌کند و آیا مجوز لازم است.
   با سقفِ تعیین‌نشده دروازه از امروز بازتر نمی‌شود: هر مانده‌ای (قطعی یا تعهد) مجوز می‌خواهد. */
function verdictOf(file, newAmount, existingOrderId) {
  const amount = Math.max(0, whole(newAmount));
  const already = (file.lines || []).find(l => l.orderId === existingOrderId);
  const fresh = already ? Math.max(0, amount - already.payable) : amount;
  const projected = file.netCommitment + fresh;
  const over = file.ceiling > 0 ? projected - file.ceiling : 0;
  const needsApproval = file.ceiling > 0 ? over > 0 : file.openTotal > 0;
  /* آستانهٔ درصدی: هشدار پیش از عبور از سقف می‌آید و تولید را نمی‌بندد — فقط یادآوری است.
     همان گردکردِ درصدِ پرونده اینجا هم اعمال می‌شود تا میز و فرم یک عدد را بگویند. */
  const projectedPercent = file.ceiling > 0 ? Math.round(projected * 100 / file.ceiling) : 0;
  const warns = file.ceiling > 0 && over <= 0 && projectedPercent >= file.warnPercent;
  const reasons = [];
  if (file.definiteDebt > 0) reasons.push(`بدهی قطعیِ فاکتورهای صادرشده: ${file.definiteDebt.toLocaleString('fa-IR')}`);
  if (file.overdueDebt > 0) reasons.push(`سررسیدگذشته: ${file.overdueDebt.toLocaleString('fa-IR')}`);
  if (file.commitment > 0) reasons.push(`تعهد سفارش‌های تأییدشدهٔ بی‌فاکتور: ${file.commitment.toLocaleString('fa-IR')}`);
  if (file.advance > 0) reasons.push(`پیش‌پرداختِ قابل‌استفاده: ${file.advance.toLocaleString('fa-IR')}`);
  if (!reasons.length) reasons.push('هیچ ماندهٔ باز یا تعهدی در پرونده ثبت نشده است.');
  /* جملهٔ بی‌عدد: نقش‌هایی که مبلغ نمی‌بینند (کارشناس سفارشات) همین را می‌خوانند. */
  const shortText = file.ceiling > 0
    ? (over > 0 ? 'این سفارش از سقف اعتبارِ مشتری عبور می‌کند؛ مجوز مستند مدیر لازم است.' : 'این سفارش ذیل سقف اعتبار می‌ماند.')
    : (file.openTotal > 0 ? 'مشتری ماندهٔ باز یا تعهدی دارد؛ مجوز مستند مدیر لازم است.' : 'هیچ ماندهٔ باز یا تعهدی روی این مشتری نیست.');
  /* هشدار درصدی: یادآوری است، نه ممنوعیت — متنِ بی‌عددش را همهٔ نقش‌ها می‌خوانند. */
  const warnText = warns
    ? `با این سفارش ${projectedPercent.toLocaleString('fa-IR')}٪ از سقف اعتبار مصرف می‌شود؛ آستانهٔ هشدار ${file.warnPercent.toLocaleString('fa-IR')}٪ است. با تسویهٔ بدهی یا پیش‌پرداخت به حالت آزاد برمی‌گردد.`
    : '';
  const shortWarn = warns
    ? 'اعتبار این مشتری به آستانهٔ هشدار می‌رسد؛ پیش از عبور از سقف، تسویه یا پیش‌پرداخت را یادآوری کنید.'
    : '';
  return {
    newAmount: amount,
    freshAmount: fresh,
    projected,
    overBy: Math.max(0, over),
    ceilingSet: file.ceiling > 0,
    openTotal: file.openTotal,
    needsApproval,
    warns,
    projectedPercent,
    warnPercent: file.warnPercent,
    warnText,
    shortWarn,
    reasons,
    shortText,
    status: !file.ceiling ? CREDIT.NO_POLICY : over > 0 ? CREDIT.APPROVAL : warns ? CREDIT.WARNING : file.status,
    text: file.ceiling > 0
      ? (over > 0
        ? `سفارش جدید ${over.toLocaleString('fa-IR')} ریال از سقف اعتبار عبور می‌کند.`
        : `با این سفارش ${(file.ceiling - projected).toLocaleString('fa-IR')} ریال از سقف باقی می‌ماند.`)
      : 'سقف اعتبار برای این مشتری تعیین نشده است؛ مبنای تصمیم، بدهی قطعی و تعهدِ ثبت‌شده است.',
  };
}

const FILE_FIELDS = [
  ['ceiling', 'سقف اعتبار', 'حداکثر تعهد مجاز مشتری'],
  ['termDays', 'مهلت پرداخت', 'روز از تاریخ فاکتور تا سررسید'],
  ['definiteDebt', 'مانده بدهی قطعی', 'ماندهٔ فاکتورهای صادرشده'],
  ['overdueDebt', 'بدهی سررسیدگذشته', 'مبلغی که از موعد پرداخت عبور کرده'],
  ['advance', 'پیش‌پرداخت قابل‌استفاده', 'دریافت‌شده و هنوز مصرف‌نیافته'],
  ['commitment', 'تعهد سفارش‌های تأییدشده', 'تأیید شده ولی فاکتور نشده'],
  ['netCommitment', 'تعهد اعتباری خالص', 'بدهی قطعی + تعهد − پیش‌پرداخت'],
  ['available', 'اعتبار قابل‌استفاده', 'سقف − تعهد خالص'],
  ['usedPercent', 'مصرف سقف', 'درصد تعهد خالص از سقف — از آستانهٔ هشدار به بعد زرد می‌شود'],
  ['status', 'وضعیت اعتبار', 'آزاد / هشدار / مسدود / نیازمند مجوز'],
];

/* کلیدهایی که فقط مدیر چاپخانه و مدیر مالی می‌بینند. برای بقیه حذف می‌شوند،
   تا پروندهٔ اعتباری همان رازِ مبلغیِ پیش‌فاکتور را فاش نکند. */
const MONEY_KEYS = ['ceiling', 'definiteDebt', 'overdueDebt', 'advance', 'commitment', 'netCommitment', 'available', 'openTotal', 'usedPercent', 'lines', 'reasons', 'policy', 'approvals'];
const VERDICT_MONEY_KEYS = ['newAmount', 'freshAmount', 'projected', 'overBy', 'reasons', 'text', 'warnText'];
const APPROVAL_MONEY_KEYS = ['ceiling', 'openTotal', 'definiteDebt', 'overdueDebt', 'commitment', 'advance', 'overBy', 'quoteRevision'];

function withoutMoney(target, keys) {
  const out = {};
  for (const k of Object.keys(target || {})) if (!keys.includes(k)) out[k] = target[k];
  return out;
}

module.exports = {
  CREDIT,
  DEFAULT_WARN_PERCENT,
  FILE_FIELDS,
  MONEY_KEYS,
  VERDICT_MONEY_KEYS,
  APPROVAL_MONEY_KEYS,
  balanceOf,
  classify,
  creditFileOf,
  creditLines,
  payableOf,
  paidOf,
  policyOf,
  verdictOf,
  withoutMoney,
};
