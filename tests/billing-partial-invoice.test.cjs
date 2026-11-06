'use strict';
/* اصلاحات ۱۷/بند ۳: آزمونِ ماژول پاکِ صورتحسابِ جزئی.
   مثالِ سندِ کارفرما عیناً اینجا می‌آید: ۱۰۰ سفارش، ۱۵۰ سالم، ۱۰۲۰ تحویل‌قابل‌صورتحساب.
   چهار چیز کنترل منفی است: (۱) سه عدد با هم قاطی نمی‌شوند و «سالم» پول نمی‌سازد؛
   (۲) ردیفِ ثابت (زینک، کاغذِ ورق، جلدِ ورق) یک‌بار طلب می‌شود و در فاکتورِ دوم تکرار
   نمی‌شود؛ (۳) در حالت «ثابت» تحویلِ بیشتر از سفارش ریالی اضافه نمی‌کند؛
   (۴) جمعِ فاکتورهای جزئی، ریال‌به‌ریال، به مبلغِ تأییدشده می‌نشیند — نه کم، نه زیاد. */
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../electron/billing.js');
const { computeQuote } = require('../electron/quote.js');
const { buildInvoiceData } = require('../electron/invoice.js');

const M = 1000000;
/* یک قلمِ کتاب: کاغذ و زینک و جلد ثابت‌اند؛ چاپ و صحافی «هر نسخه‌ای» (واحد = نسخه). */
function quoteInput(over = {}) {
  return {
    materials: [{ id: 'm-paper', itemId: 'i1', description: 'کاغذ و مقوا — کتاب — تحریر ۷۰', itemCode: '0000000000123', unit: 'ورق', qty: 600, rate: 50000 }],
    services: [
      { id: 's-print', itemId: 'i1', description: 'چاپ متن — کتاب — افست', unit: 'نسخه', qty: 1100, rate: 10000 },
      { id: 's-binding', itemId: 'i1', description: 'صحافی — کتاب — چسب گرم', unit: 'نسخه', qty: 1000, rate: 5000 },
      { id: 's-zinc', itemId: 'i1', description: 'چاپ متن — کتاب — زینک', unit: 'عدد', qty: 4, rate: 2 * M },
      { id: 's-cover', itemId: 'i1', description: 'چاپ جلد — کتاب — ۲ ورقی', unit: 'ورق', qty: 50, rate: 100000 },
    ],
    offers: [{ id: 'o1', description: 'طرح جلد — رایگان' }],
    serviceMarkupPercent: 20, taxPercent: 10, discount: 1 * M, ...over,
  };
}
function pricing(over = {}) {
  const computed = computeQuote(quoteInput(over));
  return { schemaVersion: 1, revision: 1, createdAt: 'x', input: computed.input, result: computed.result };
}
const order = (deliveries = [], quality) => ({
  id: 'o1', orderNumber: '1001', items: [{ id: 'i1', productName: 'کتاب', qty: 1000, qtyUnit: 'نسخه', ...(quality ? { quality } : {}), deliveries }],
});
const delivery = (billable, id = 'd1') => ({ id, billable, note: '', at: '2026-11-03', by: { id: 'u', name: 'انبار', role: 'انباردار' } });

test('سه عددِ هر قلم جدا می‌ماند و «سالم» تا ثبت‌شدن null است، نه صفر', () => {
  const q = B.itemQuantities({ qty: 1000, qtyUnit: 'نسخه', deliveries: [delivery(600, 'd1'), delivery(420, 'd2')] });
  assert.deepEqual(q, { ordered: 1000, good: null, delivered: 1020, remaining: 0 }, 'تحویلِ بخشی جمع می‌شود و سالمِ ثبت‌نشده صفر نیست');
  const withGood = B.itemQuantities({ qty: 1000, quality: { good: 1050 }, deliveries: [delivery(1020)] });
  assert.equal(withGood.good, 1050, '۵۰ نسخهٔ اضافه در «سالم» می‌ماند');
  assert.equal(withGood.delivered, 1020, 'و با عددِ تحویلی قاطی نمی‌شود');
});

test('ردیفِ ثابت یک‌بارِ کامل طلب می‌شود؛ ردیفِ هر‌نسخه‌ای به نسبتِ تحویل', () => {
  const p = pricing();
  const proposal = B.invoiceProposal(order([delivery(600)]), p, []);
  const byLine = Object.fromEntries(proposal.rows.map(row => [row.lineId, row]));
  assert.equal(byLine['m-paper'].amount, 30 * M, 'کاغذ ۶۰۰ ورق: کلِ ردیف در اولین فاکتور');
  assert.equal(byLine['s-zinc'].amount, 8 * M, 'زینک هزینهٔ یک‌بار است و تقسیم نمی‌شود');
  assert.equal(byLine['s-cover'].amount, 5 * M, 'جلد با واحدِ ورق ← ثابت');
  assert.equal(byLine['s-print'].amount, 6600000, '۱۱M × ۶۰۰ ÷ ۱۰۰۰');
  assert.equal(byLine['s-print'].qty, 600, 'ردیفِ مقیاس‌شونده تعدادِ این صورتحساب را نشان می‌دهد');
  assert.equal(byLine['s-binding'].amount, 3 * M, '۵M × ۶۰۰ ÷ ۱۰۰۰');
  assert.equal(proposal.mode, 'ثابت', 'بی‌کلیدِ contractMode یعنی همان پیش‌فرضِ کارفرما');
  assert.equal(proposal.rows.reduce((sum, row) => sum + row.amount, 0), proposal.totals.grossAmount, 'جمعِ ردیف‌ها = مبلغِ این سند');
});

test('در حالت «ثابت» تحویلِ ۱۰۲۰ از ۱۰۰۰ هیچ ریالی اضافه نمی‌سازد', () => {
  const p = pricing();
  const proposal = B.invoiceProposal(order([delivery(1020)], { good: 1050 }), p, []);
  assert.equal(proposal.rows.find(r => r.lineId === 's-print').amount, 11 * M, 'سقفِ ردیف همان مبلغِ تأییدشده است');
  assert.equal(proposal.totals.totalAmount, p.result.total, 'و کلِ سند دقیقاً مبلغِ تأییدشده می‌شود');
});

test('در حالت «تعداد واقعی» همان ۱۰۲۰ نسخه نرخِ خودش را طلب می‌کند', () => {
  const p = pricing({ contractMode: 'تعداد واقعی' });
  const proposal = B.invoiceProposal(order([delivery(1020)], { good: 1050 }), p, []);
  assert.equal(proposal.mode, 'تعداد واقعی');
  assert.equal(proposal.rows.find(r => r.lineId === 's-print').amount, 11220000, '۱۱M × ۱۰۲۰ ÷ ۱۰۰۰');
  assert.equal(proposal.rows.find(r => r.lineId === 's-binding').amount, 5100000, '۵M × ۱۰۲۰ ÷ ۱۰۰۰');
  assert.ok(proposal.totals.totalAmount > p.result.total, 'پس سند از مبلغِ تأییدشده جلو می‌زند');
});

test('فاکتورِ دوم فقط باقی‌مانده را می‌گیرد و ردیفِ ثابت تکرار نمی‌شود', () => {
  const p = pricing();
  const first = B.invoiceProposal(order([delivery(600)]), p, []);
  const billed = first.rows.map(row => ({ lineId: row.lineId, amount: row.amount, qty: row.qty }));
  const second = B.invoiceProposal(order([delivery(600, 'd1'), delivery(400, 'd2')]), p, billed);
  assert.deepEqual(second.rows.map(row => row.lineId).sort(), ['s-binding', 's-print'], 'کاغذ/زینک/جلد که طلب شده‌اند دوباره نمی‌آیند');
  assert.equal(second.rows.find(r => r.lineId === 's-print').amount, 11 * M - 6600000);
  assert.equal(second.rows.find(r => r.lineId === 's-print').qty, 400, 'تعدادِ این سند، نه تعدادِ انباشته');
  assert.equal(second.totals.grossAmount, second.rows.reduce((sum, row) => sum + row.amount, 0));
});

test('جمعِ دو فاکتورِ جزئی ریال‌به‌ریال به مبلغِ تأییدشده می‌رسد', () => {
  const p = pricing();
  const one = B.invoiceProposal(order([delivery(600)]), p, []);
  const billed = one.rows.map(row => ({ lineId: row.lineId, amount: row.amount, qty: row.qty }));
  const two = B.invoiceProposal(order([delivery(600, 'd1'), delivery(400, 'd2')]), p, billed);
  const add = (a, b) => ({ ...a, ...Object.fromEntries(Object.keys(a).map(key => [key, a[key] + b[key]])) });
  const sum = add(one.totals, two.totals);
  assert.equal(sum.grossAmount, p.result.materialsCost + p.result.servicesCost, 'جمعِ مبالغِ ردیف‌ها = هزینهٔ تأییدشده');
  assert.equal(sum.markupAmount, p.result.serviceMarkupAmount, 'سودِ خدمات سر به سر');
  assert.equal(sum.subtotal, p.result.subtotal);
  assert.equal(sum.discountAmount, p.result.discount, 'تخفیفِ خردشده کم یا زیاد نمی‌شود');
  assert.equal(sum.taxableAmount, p.result.discountedSubtotal);
  assert.equal(sum.taxAmount, p.result.taxAmount, 'مالیات با همان قاعدهٔ درصدِ موتور قیمت');
  assert.equal(sum.totalAmount, p.result.total);
});

test('سازندهٔ فاکتورِ موجود، خروجیِ صورتحسابِ جزئی را بدون هیچ ایرادِ جمعِ ردیف می‌پذیرد', () => {
  const p = pricing();
  const proposal = B.invoiceProposal(order([delivery(600)]), p, []);
  const invoice = buildInvoiceData(B.partialQuoteResult(p, proposal));
  assert.equal(invoice.totals.grossAmount, proposal.totals.subtotal);
  assert.equal(invoice.totals.total, proposal.totals.totalAmount);
  const moneyRows = invoice.rows.filter(row => !row.freeOffer);
  assert.equal(moneyRows.length, proposal.rows.length, 'ردیف‌های پولیِ سند همان ردیف‌های پیشنهادی است');
  /* ردیف‌های آفر مبلغ ندارند ولی در سند می‌مانند، تا خطِ «طرح جلد — رایگان» از فاکتور
     تحویلی نیفتد. (کنترل: افزودنشان جمعِ ردیف‌ها را یک ریال هم عوض نمی‌کند.) */
  assert.equal(invoice.rows.filter(row => row.freeOffer).length, 1, 'آفرِ رایگان روی فاکتورِ تحویلی هم هست');
  assert.equal(invoice.rows.reduce((sum, row) => sum + row.total, 0), proposal.totals.totalAmount, 'هیچ ریالی در تخصیص گم نمی‌شود');
});

test('سفارشِ تک‌قلمی: ردیفِ بی‌شناسه خودکار به همان قلم می‌نشیند و مقیاس می‌شود', () => {
  const computed = computeQuote({ materials: [{ id: 'm1', description: 'کاغذ', unit: 'ورق', qty: 10, rate: 1000 }], services: [{ id: 's1', description: 'چاپ', unit: 'نسخه', qty: 100, rate: 100 }] });
  const p = { schemaVersion: 1, revision: 1, input: computed.input, result: computed.result };
  const singleItem = { id: 'o1', items: [{ id: 'i1', qty: 100, qtyUnit: 'نسخه', deliveries: [delivery(50)] }] };
  const proposal = B.invoiceProposal(singleItem, p, []);
  assert.equal(proposal.rows.find(r => r.lineId === 's1').amount, 5000, '۵۰ از ۱۰۰ نسخه ← نصفِ ردیف، نه کلِ آن');
  assert.equal(proposal.rows.find(r => r.lineId === 'm1').amount, 10000, 'کاغذ با واحدِ ورق ثابت می‌ماند');
  assert.deepEqual(proposal.warnings, [], 'در سفارشِ تک‌قلمی هیچ ابهامی نیست، پس هشدار هم نیست');
});

test('سفارشِ چندقلمی: ردیفِ بی‌شناسه یک‌بار طلب می‌شود و هشدار می‌گیرد', () => {
  const computed = computeQuote({ services: [{ id: 's1', description: 'چاپ', unit: 'نسخه', qty: 100, rate: 100 }] });
  const p = { schemaVersion: 1, revision: 1, input: computed.input, result: computed.result };
  const twoItems = { id: 'o1', items: [{ id: 'i1', qty: 100, qtyUnit: 'نسخه', deliveries: [delivery(50)] }, { id: 'i2', qty: 200, qtyUnit: 'نسخه', deliveries: [] }] };
  const proposal = B.invoiceProposal(twoItems, p, []);
  assert.equal(proposal.rows.find(r => r.lineId === 's1').amount, 10000, 'بی‌مبنای قلم، مقیاس معنا ندارد ← کلِ ردیف');
  assert.ok(proposal.warnings.some(w => w.includes('به هیچ قلم سفارش وصل نیست')), 'و رابط باید آن را بگوید');
});

test('عددِ بی‌اعتبارِ مقدار نمی‌سازد؛ تحویل بی‌شناسه و تاریخِ بی‌قاعده رد می‌شود', () => {
  assert.throws(() => B.itemQuantities({ qty: 1000, deliveries: [{ billable: 1.5 }] }), /صحیح/);
  assert.throws(() => B.itemQuantities({ qty: -1 }), /صحیح/);
  assert.throws(() => B.qualityOf({ good: 1050, at: '۱۴۰۵/۰۸/۱۲' }, {}), /تاریخ/);
  assert.throws(() => B.deliveryOf({ billable: 100, at: '2026-11-03' }, {}), /شناسه/);
  const ok = B.qualityOf({ good: 1050, note: 'پرت غیرعادی ندارد', at: '2026-11-03' }, { id: 'u1', name: 'سرپرست صحافی', role: 'سرپرست صحافی' });
  assert.deepEqual(ok.by, { id: 'u1', name: 'سرپرست صحافی', role: 'سرپرست صحافی' }, 'ثبت‌کننده در رکورد می‌ماند');
});

test('پیش‌فاکتورِ قدیمی بدونِ کلیدِ جدید در بازرسیِ سرور رد نمی‌شود', () => {
  const computed = computeQuote(quoteInput());
  assert.equal(Object.prototype.hasOwnProperty.call(computed.input, 'contractMode'), false, 'بی‌درخواست، کلید نوشته نمی‌شود');
  assert.equal(computed.input.services[0].itemId, 'i1', 'ولی شناسهٔ قلم از همین نسخه ذخیره می‌شود');
  const again = computeQuote(computed.input);
  assert.deepEqual(again.input, computed.input, 'پس validatedPricing برای رکوردِ همین تغییر هم سازگار می‌ماند');
  const legacy = computeQuote(quoteInput());
  delete legacy.input.contractMode;
  legacy.input.materials.forEach(line => { delete line.itemId; });
  legacy.input.services.forEach(line => { delete line.itemId; });
  assert.deepEqual(computeQuote(legacy.input).input, legacy.input, 'و رکوردِ پیش از بند ۳ هم رد نمی‌شود');
});
