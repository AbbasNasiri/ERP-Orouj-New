/* بازاریاب‌ها: پورسانت پلکانی بر اساس مجموع فاکتورها، صورتحساب هر فاکتور و تسویه (پرداخت‌ها به ترتیب قدیمی‌ترین فاکتور) */

export const COMMISSION_MODES = [
  ['bracket', 'کل مجموع فاکتورها با درصدِ ردیفی که در آن قرار می‌گیرد'],
  ['progressive', 'هر بخش از مجموع با درصد همان ردیف (پلکانی)'],
];
export const defaultCommission = () => ({ mode: 'bracket', tiers: [{ upTo: '1000000000', percent: '' }, { upTo: '10000000000', percent: '' }, { upTo: '', percent: '', open: true }] });
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

/* ردیف‌ها: سقف (ریال، خالی = بدون سقف) و درصد. ترتیب بر اساس سقف است و ردیف «بدون سقف» همیشه آخر می‌ماند. */
export function normTiers(tiers) {
  const t = (tiers || [])
    .filter(x => x.open === true || String(x.upTo ?? '').trim() !== '')   // ردیف سقف‌دار که سقفش هنوز خالی است نادیده می‌ماند
    .map(x => ({ upTo: x.open === true ? Infinity : num(x.upTo), percent: num(x.percent) }));
  return t.sort((a, b) => a.upTo - b.upTo);
}
export function rateForTotal(total, tiers) {
  const t = normTiers(tiers); if (!t.length) return 0;
  for (const x of t) if (total <= x.upTo) return x.percent;
  return t[t.length - 1].percent;
}
export function commissionFor(total, commission) {
  const c = commission || defaultCommission(); const T = Math.max(0, num(total));
  const t = normTiers(c.tiers); if (!t.length || T === 0) return 0;
  if (c.mode === 'progressive') {
    let prev = 0, sum = 0;
    for (const x of t) { if (T <= prev) break; const top = Math.min(T, x.upTo); sum += (top - prev) * x.percent / 100; prev = x.upTo; if (T <= x.upTo) break; }
    if (T > prev && prev !== Infinity) sum += (T - prev) * t[t.length - 1].percent / 100;
    return sum;
  }
  return T * rateForTotal(T, c.tiers) / 100;
}

const COUNTED_EXCLUDED = ['در انتظار تایید', 'بایگانی', 'لغو شده', 'درخواست مشتری'];
export const invoiceBase = (o, grandTotal, discountOf) => Math.max(0, grandTotal(o) - (discountOf ? discountOf(o) : (Number(o.discount) || 0)));
export function marketerOf(order, customers) {
  if (order.marketerId) return order.marketerId;
  if (order.source === 'بازاریاب' && order.marketerCode) { const m = customers.find(c => c.isMarketer && c.name === order.marketerCode); return m ? m.id : ''; }
  return '';
}

/* صورتحساب یک بازاریاب. fns = { grandTotal(order) } از برنامه می‌آید تا این فایل به App وابسته نشود. */
export function marketerStatement(marketer, orders, customers, payments, { from = '', to = '' } = {}, fns) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const mine = orders.filter(o => !COUNTED_EXCLUDED.includes(o.status) && marketerOf(o, customers) === marketer.id && inRange(o.date || ''))
    .map(o => ({ order: o, base: invoiceBase(o, fns.grandTotal, fns.discount) }))
    .sort((a, b) => String(a.order.date).localeCompare(String(b.order.date)) || (a.order.createdAt || 0) - (b.order.createdAt || 0));
  const totalBase = mine.reduce((s, x) => s + x.base, 0);
  const comm = marketer.commission || defaultCommission();
  const totalCommission = commissionFor(totalBase, comm);
  const rate = rateForTotal(totalBase, comm.tiers);
  let cum = 0;
  const rows = mine.map(x => {
    let c;
    if (comm.mode === 'progressive') { const before = commissionFor(cum, comm); cum += x.base; c = commissionFor(cum, comm) - before; }
    else { cum += x.base; c = x.base * rate / 100; }
    return { ...x, commission: Math.round(c) };
  });
  const pays = (payments || []).filter(p => p.marketerId === marketer.id && inRange(p.date || ''));
  const paid = pays.reduce((s, p) => s + num(p.amount), 0);
  let remain = paid;
  rows.forEach(r => { const part = Math.min(r.commission, remain); remain -= part; r.paid = part; r.status = r.commission <= 0 ? 'بدون پورسانت' : part >= r.commission - 0.5 ? 'پرداخت‌شده' : part > 0 ? 'پرداخت جزئی' : 'پرداخت‌نشده'; });
  const commissionSum = Math.round(totalCommission);
  const balance = commissionSum - paid;
  return { rows, totalBase, commission: commissionSum, paid, balance, rate, count: rows.length, payments: pays,
    state: commissionSum === 0 && paid === 0 ? 'بدون فعالیت' : balance > 0.5 ? 'طلبکار (هنوز باید به او پرداخت شود)' : balance < -0.5 ? 'بیش‌پرداخت' : 'تسویه‌شده' };
}

/* تولد نزدیک: بر اساس ماه و روز شمسی. fns = { jFromIso, isoFromJ, todayIso, todayJalali } */
export function daysToBirthday(iso, fns) {
  if (!iso) return null;
  const b = fns.jFromIso(iso); const t = fns.todayJalali(); if (!b || !t) return null;
  const toDate = (jy) => new Date(fns.isoFromJ(jy, b.jm, Math.min(b.jd, b.jm <= 6 ? 31 : b.jm <= 11 ? 30 : 29)) + 'T00:00:00');
  const today = new Date(fns.todayIso() + 'T00:00:00');
  let d = toDate(t.jy); if (d < today) d = toDate(t.jy + 1);
  return Math.round((d - today) / 86400000);
}
