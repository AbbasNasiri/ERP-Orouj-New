'use strict';

// Freeze a sales presentation of the approved quote, never inventory book cost.
// Integer largest-remainder allocations preserve every rial of the saved totals.
function allocate(amount, weights) {
  if (!Number.isSafeInteger(amount) || amount < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new Error('مبالغ تخصیص فاکتور معتبر نیست.');
  const total = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (!total) {
    if (amount) throw new Error('مبلغ بدون مبنای تخصیص در فاکتور وجود دارد.');
    return weights.map(() => 0);
  }
  const shares = weights.map((w, index) => ({ index, value: Number(BigInt(amount) * BigInt(w) / total), remainder: BigInt(amount) * BigInt(w) % total }));
  const rest = amount - shares.reduce((s, r) => s + r.value, 0);
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < rest; i++) ranked[i].value++;
  return shares.map(r => r.value);
}

function buildInvoiceData(result) {
  const markup = allocate(result.serviceMarkupAmount, result.services.map(r => r.cost));
  const rows = [
    ...result.materials.map(r => ({ id: r.id, description: r.description, itemCode: r.itemCode || '', qty: r.qty, unit: r.unit, unitPrice: r.customerSupplied ? 0 : r.rate, grossAmount: r.cost, customerSupplied: r.customerSupplied === true })),
    ...result.services.map((r, index) => ({ id: r.id, description: r.description, itemCode: r.itemCode || '', qty: r.qty, unit: r.unit, unitPrice: r.qty ? (r.cost + markup[index]) / r.qty : 0, grossAmount: r.cost + markup[index] })),
  ];
  const discounts = allocate(result.discount, rows.map(r => r.grossAmount));
  const net = rows.map((r, i) => r.grossAmount - discounts[i]);
  const taxes = allocate(result.taxAmount, net);
  const moneyRows = rows.map((r, i) => ({ ...r, discountAmount: discounts[i], taxableAmount: net[i], taxPercent: result.taxPercent, taxAmount: taxes[i], total: net[i] + taxes[i] }));
  const offers = result.offers.map(r => ({ id: r.id, description: r.description, itemCode: r.itemCode || '', qty: 1, unit: 'خدمت', unitPrice: 0, grossAmount: 0, discountAmount: 0, taxableAmount: 0, taxPercent: 0, taxAmount: 0, total: 0, freeOffer: true }));
  const totals = { grossAmount: result.subtotal, discountAmount: result.discount, taxableAmount: result.discountedSubtotal, taxAmount: result.taxAmount, total: result.total };
  for (const key of Object.keys(totals)) {
    if (!Number.isSafeInteger(totals[key]) || moneyRows.reduce((s, r) => s + BigInt(r[key]), 0n) !== BigInt(totals[key])) throw new Error('جمع ردیف‌های فاکتور با قیمت‌گذاری تأییدشده یکسان نیست.');
  }
  return { schemaVersion: 1, currency: 'IRR', allocation: 'largest-remainder-v1', rows: [...moneyRows, ...offers], totals };
}
module.exports = { allocate, buildInvoiceData };
