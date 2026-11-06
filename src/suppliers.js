/* کاردکس تامین‌کننده: هر «ورود کالا» با تاریخ، شماره فاکتور، راننده و وضعیت پرداخت ثبت می‌شود و موجودی انبار را بالا می‌برد. */
import { normalizeDigits } from './smart.js';
import { bandWeightKg, usesKgPrice } from './kgprice.js';

export const PAY_STATES = {
  unpaid: { short: 'پرداخت‌نشده', long: 'پرداخت‌نشده — هنوز اقدامی نشده', bg: '#FBE3E0', fg: '#B3261E' },
  processing: { short: 'در شرف پرداخت', long: 'تایید شده — در مسیر پرداخت', bg: '#E1ECF8', fg: '#1F5FA8' },
  paid: { short: 'پرداخت‌شده', long: 'پرداخت‌شده', bg: '#E1F3E4', fg: '#1E7A34' },
};
export const PAY_ORDER = ['unpaid', 'processing', 'paid'];
const num = (v) => { const n = Number(normalizeDigits(String(v ?? '')).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
let _n = 0;
const rid = () => 'r' + Date.now().toString(36) + (++_n).toString(36) + Math.random().toString(36).slice(2, 5);

export function emptyReceipt(supplierId, today) {
  return { id: rid(), supplierId, date: today || '', invoiceNo: '', driverName: '', plate: '', driverPhone: '', payStatus: 'unpaid', payDate: '', amount: '', note: '', lines: [{ id: rid(), inventoryItemId: '', qty: '', unitPrice: '' }], createdAt: Date.now() };
}
export const stockLevelOf = (i) => (i.unitMode === 'band_sheet' ? num(i.bandCount) : i.unitMode === 'roll_kg' ? num(i.weightKg) : num(i.quantity));
const withLevel = (i, level) => (i.unitMode === 'band_sheet' ? { ...i, bandCount: level } : i.unitMode === 'roll_kg' ? { ...i, weightKg: level } : { ...i, quantity: level });
const r3 = (x) => Math.round(x * 1000) / 1000;

export function receiptAmount(r) {
  const manual = num(r.amount);
  if (manual > 0) return manual;
  return (r.lines || []).reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0);
}
export function validReceipt(r) {
  const errs = [];
  if (!r.date) errs.push('تاریخ ورود کالا را انتخاب کنید.');
  const lines = (r.lines || []).filter(l => l.inventoryItemId || num(l.qty) > 0);
  if (!lines.length) errs.push('حداقل یک کالا با مقدار وارد کنید.');
  lines.forEach((l, i) => { if (!l.inventoryItemId) errs.push(`ردیف ${i + 1}: کالا را انتخاب کنید.`); if (!(num(l.qty) > 0)) errs.push(`ردیف ${i + 1}: مقدار باید بیشتر از صفر باشد.`); });
  return errs;
}

/* ورود کالا: موجودی بالا می‌رود، حرکت «ورود» با شناسه‌ی رسید ثبت می‌شود و (اختیاری) قیمت واحد با میانگین موزون به‌روز می‌شود. */
export function applyReceipt(inventory, receipt, supplierName, { updateUnitValue = true, uid = rid } = {}) {
  const lines = (receipt.lines || []).filter(l => l.inventoryItemId && num(l.qty) > 0);
  let inv = inventory;
  lines.forEach(l => {
    inv = inv.map(i => {
      if (i.id !== l.inventoryItemId) return i;
      const before = stockLevelOf(i), q = num(l.qty), price = num(l.unitPrice);
      let next = withLevel(i, r3(before + q));
      if (updateUnitValue && price > 0) { next.unitValue = String(Math.round(((before * num(i.unitValue)) + (q * price)) / (before + q))); const w = bandWeightKg(i); if (usesKgPrice(i) && w > 0) next.pricePerKg = String(Math.round(num(next.unitValue) / w)); }
      const move = { id: uid(), date: receipt.date, type: 'in', qty: q, note: `ورود از ${supplierName || 'تامین‌کننده'} — فاکتور ${receipt.invoiceNo || '—'}`, receiptId: receipt.id };
      return { ...next, movements: [...(i.movements || []), move] };
    });
  });
  return inv;
}
export function reverseReceipt(inventory, receipt, { uid = rid, today = '' } = {}) {
  const lines = (receipt.lines || []).filter(l => l.inventoryItemId && num(l.qty) > 0);
  for (const l of lines) {
    const it = inventory.find(i => i.id === l.inventoryItemId);
    if (!it) continue;
    if (stockLevelOf(it) + 1e-9 < num(l.qty)) return { ok: false, error: `موجودی «${it.name}» از مقدار این ورود کمتر است (قبلاً مصرف شده)؛ حذف ممکن نیست.` };
  }
  let inv = inventory;
  lines.forEach(l => {
    inv = inv.map(i => {
      if (i.id !== l.inventoryItemId) return i;
      const q = num(l.qty);
      const move = { id: uid(), date: today || receipt.date, type: 'out', qty: q, note: `حذف ورود کالا — فاکتور ${receipt.invoiceNo || '—'}`, receiptId: receipt.id };
      return { ...withLevel(i, r3(Math.max(0, stockLevelOf(i) - q))), movements: [...(i.movements || []), move] };
    });
  });
  return { ok: true, inventory: inv };
}

export function filterReceipts(receipts, f, names = {}) {
  const q = normalizeDigits(f.q || '').trim();
  return receipts.filter(r =>
    (!f.supplierId || r.supplierId === f.supplierId) && (!f.status || r.payStatus === f.status) &&
    (!f.from || r.date >= f.from) && (!f.to || r.date <= f.to) &&
    (!q || normalizeDigits(`${r.invoiceNo} ${r.driverName} ${r.plate} ${r.driverPhone} ${names[r.supplierId] || ''}`).includes(q)));
}
export function receiptSummary(receipts) {
  const out = { total: { count: 0, amount: 0 } };
  PAY_ORDER.forEach(k => { out[k] = { count: 0, amount: 0 }; });
  receipts.forEach(r => { const a = receiptAmount(r); const k = PAY_STATES[r.payStatus] ? r.payStatus : 'unpaid'; out[k].count++; out[k].amount += a; out.total.count++; out.total.amount += a; });
  return out;
}
