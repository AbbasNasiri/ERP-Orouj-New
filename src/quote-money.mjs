// Display persisted, backend-calculated IRR snapshots. Never reprice a saved quote
// or silently fall back to legacy item prices when its snapshot is stale/invalid.
const n = value => Number(value) || 0;
const fmtLegacy = value => n(value).toLocaleString('en-US');
const fmtFa = value => value.toLocaleString('fa-IR', { maximumFractionDigits: 20 });
const safeMoney = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const hasPricing = order => order?.pricing !== undefined;
const lineTotal = item => n(item.qty) * n(item.unitPrice);
const itemTotal = item => lineTotal(item) + (item.services || []).reduce((sum, line) => sum + n(line.price), 0)
  + (item.hasDesign ? n(item.designPrice) : 0);

function validLines(lines, material) {
  return Array.isArray(lines) && lines.every(line => plain(line)
    && typeof line.qty === 'number' && Number.isFinite(line.qty) && line.qty >= 0
    && safeMoney(line.rate) && safeMoney(line.cost)
    && (!material || line.customerSupplied === undefined || typeof line.customerSupplied === 'boolean')
    && (!material || !line.customerSupplied || line.cost === 0));
}

function addBig(values) { return values.reduce((sum, value) => sum + BigInt(value), 0n); }

/** null means no error (including a legacy order with no snapshot).
 * Callers must block printing/acceptance when a non-null error is returned.
 */
export function moneyError(order) {
  if (!hasPricing(order)) return null;
  const pricing = order.pricing;
  const revision = Number(order.quoteRev || 1);
  if (!plain(pricing) || pricing.schemaVersion !== 1) return 'ساختار قیمت‌گذاری معتبر نیست.';
  if (!Number.isSafeInteger(revision) || revision < 1 || pricing.revision !== revision) {
    return 'قیمت‌گذاری مربوط به نسخه فعلی پیش‌فاکتور نیست؛ محاسبه مجدد لازم است.';
  }
  const result = pricing.result;
  if (!plain(result) || result.currency !== 'IRR') return 'قیمت‌گذاری باید صریحاً بر حسب ریال باشد.';
  const fields = ['materialsCost', 'servicesCost', 'baseCost', 'serviceMarkupAmount', 'subtotal', 'discount', 'taxAmount', 'total'];
  if (fields.some(key => !safeMoney(result[key]))) return 'مبالغ قیمت‌گذاری معتبر نیستند.';
  if (!validLines(result.materials, true) || !validLines(result.services, false)) return 'ردیف‌های قیمت‌گذاری معتبر نیستند.';
  if (!Array.isArray(result.offers) || result.offers.some(offer => !plain(offer) || offer.customerCharge !== 0)) {
    return 'ردیف‌های خدمات رایگان معتبر نیستند.';
  }
  if (addBig(result.materials.map(line => line.cost)) !== BigInt(result.materialsCost)
    || addBig(result.services.map(line => line.cost)) !== BigInt(result.servicesCost)
    || addBig([result.materialsCost, result.servicesCost]) !== BigInt(result.baseCost)
    || addBig([result.baseCost, result.serviceMarkupAmount]) !== BigInt(result.subtotal)
    || result.discount > result.subtotal
    || BigInt(result.subtotal) - BigInt(result.discount) + BigInt(result.taxAmount) !== BigInt(result.total)) {
    return 'جمع ردیف‌ها و مبالغ نهایی قیمت‌گذاری سازگار نیستند.';
  }
  return null;
}

export function hasQuotePricing(order) { return hasPricing(order) && moneyError(order) === null; }

export function orderGrandTotal(order) {
  if (hasPricing(order)) return hasQuotePricing(order) ? order.pricing.result.subtotal : 0;
  return (order.items || []).reduce((sum, item) => sum + itemTotal(item), 0) + n(order.shippingCost) + n(order.otherCost);
}

export function orderDiscount(order) {
  if (hasPricing(order)) return hasQuotePricing(order) ? order.pricing.result.discount : 0;
  return n(order.discount);
}

export function orderPaid(order) {
  return (order.payments || []).reduce((sum, payment) => sum + n(payment.amount), 0);
}

export function orderTax(order) {
  if (hasPricing(order)) return hasQuotePricing(order) ? order.pricing.result.taxAmount : 0;
  return Math.round(Math.max(0, orderGrandTotal(order) - n(order.discount)) * n(order.vatPercent) / 100);
}

export function orderPayable(order) {
  if (hasPricing(order)) return hasQuotePricing(order) ? order.pricing.result.total : 0;
  return orderGrandTotal(order) - n(order.discount) + orderTax(order);
}

export function orderBalance(order) {
  if (hasPricing(order) && !hasQuotePricing(order)) return 0;
  return orderPayable(order) - orderPaid(order);
}

function label(line, fallback) {
  return typeof line.description === 'string' && line.description
    ? line.description : typeof line.name === 'string' && line.name ? line.name : fallback;
}

function legacyRows(order, detailed) {
  const rows = [];
  (order.items || []).forEach(item => {
    const description = `${item.productName}${item.productType ? ' (' + item.productType + ')' : ''}`;
    const spec = item.spec || {};
    const specLine = [spec.sizeKey ? `قطع ${spec.sizeKey === 'سفارشی' ? spec.w + '×' + spec.h : spec.sizeKey}` : '',
      spec.pages ? `${fmtLegacy(spec.pages)} صفحه` : '', spec.textKind ? `${spec.textKind} ${spec.textGsm || ''} گرم` : '',
      item.bindingType && item.bindingType !== 'بدون صحافی' ? item.bindingType : ''].filter(Boolean).join(' — ');
    if (detailed) {
      rows.push({ key: item.id, desc: description, spec: specLine, qty: `${fmtLegacy(item.qty)} ${item.qtyUnit}`, price: fmtLegacy(item.unitPrice), total: lineTotal(item) });
      if (item.hasDesign) rows.push({ key: item.id + 'd', desc: `طراحی${item.designDescription ? ' — ' + item.designDescription : ''}`, qty: '—', price: '—', total: n(item.designPrice), sub: true });
      (item.services || []).forEach(service => rows.push({ key: service.id, desc: `${service.serviceType}${service.notes ? ' — ' + service.notes : ''}`, qty: '—', price: '—', total: n(service.price), sub: true }));
    } else {
      rows.push({ key: item.id, desc: description, spec: specLine, qty: `${fmtLegacy(item.qty)} ${item.qtyUnit}`, price: '—', total: itemTotal(item) });
    }
  });
  if (Number(order.shippingCost) > 0) rows.push({ key: 'ship', desc: 'هزینه حمل و نقل', qty: '—', price: '—', total: Number(order.shippingCost) });
  if (Number(order.otherCost) > 0) rows.push({ key: 'other', desc: order.otherLabel || 'سایر هزینه‌ها', qty: '—', price: '—', total: Number(order.otherCost) });
  return rows;
}

export function invoiceRows(order, detailed) {
  if (!hasPricing(order)) return legacyRows(order, detailed);
  if (!hasQuotePricing(order)) return [];
  const result = order.pricing.result;
  // Whitelist invoice fields. Never spread raw snapshot lines: inventory book
  // values, offer internal costs, and arbitrary metadata must stay off invoices.
  const rows = result.materials.map((line, index) => ({
    key: `quote-material-${index}`, desc: label(line, 'مواد مصرفی') + (line.customerSupplied ? ' (تأمین مشتری)' : ''),
    qty: fmtFa(line.qty), price: fmtFa(line.customerSupplied ? 0 : line.rate), total: line.customerSupplied ? 0 : line.cost,
  }));
  if (detailed) {
    result.services.forEach((line, index) => rows.push({ key: `quote-service-${index}`,
      desc: label(line, 'خدمات چاپ'), qty: fmtFa(line.qty), price: fmtFa(line.rate), total: line.cost }));
  } else if (result.services.length) {
    rows.push({ key: 'quote-services', desc: 'جمع خدمات', qty: '—', price: '—', total: result.servicesCost });
  }
  if (result.serviceMarkupAmount) rows.push({ key: 'quote-markup', desc: 'افزوده خدمات', qty: '—', price: '—', total: result.serviceMarkupAmount });
  result.offers.forEach((offer, index) => rows.push({ key: `quote-offer-${index}`, desc: label(offer, 'خدمات رایگان'), qty: typeof offer.qty === 'number' && Number.isFinite(offer.qty) && offer.qty >= 0 ? fmtFa(offer.qty) : '—', price: fmtFa(0), total: 0 }));
  return rows;
}
