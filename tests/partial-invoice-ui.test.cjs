'use strict';
/* اصلاحات ۱۷/بند ۳/۴: رابطِ «سه عددِ هر قلم» (src/ItemDeliveryCounts.jsx) و میزِ فاکتورِ
   تحویلی (src/DeliveryInvoicePanel.jsx). آزمون همان چیزی را ثابت می‌کند که قاعدهٔ بند ۳ است:
   ۱) بی‌مجوزِ نقش، هیچ فرمِ عددی باز نمی‌شود (کنترل منفی: دروازه از رابط رد نمی‌شود)؛
   ۲) سه عدد جدا می‌مانند و «سالم» تا ثبت نشود «ثبت نشده» است، نه صفر؛
   ۳) از ایستگاه فقط عددِ صحیحِ تعداد می‌رود — هیچ ریالی، هیچ مبلغِ کل؛
   ۴) ردِ سرور عیناً نمایش داده می‌شود و عددِ ثبت‌شده در رابط بازنویسی نمی‌شود؛
   ۵) ردیف‌ها، جمع‌ها و «چرا هنوز نه» از بدنهٔ be:invoiceProposal می‌آید، نه از حسابِ رابط؛
   ۶) صدور فاکتور تحویلی فقط شناسهٔ سفارش را می‌فرستد و بعد همان پیشنهاد را دوباره می‌خواند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');

function compile(name) {
  return esbuild.buildSync({ entryPoints: [path.resolve(__dirname, `../src/${name}.jsx`)], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } }).outputFiles[0].text;
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  if (typeof node !== 'object') return String(node);
  /* اجزای تابعی (کارت‌های عدد، خانه‌های مبلغ) هم مثل flatten باز می‌شوند؛ بی این،
     متنِ آن‌ها در content() دیده نمی‌شود و آزمون عددهایِ سرور را گم می‌کند. */
  if (typeof node.type === 'function') return text(node.type(node.props));
  return text(node.props?.children);
}
function flatten(node, result = []) {
  if (node == null || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => flatten(child, result)); return result; }
  if (typeof node.type === 'function') return flatten(node.type(node.props), result);
  result.push(node); flatten(node.props?.children, result); return result;
}
function mount(name, props) {
  const values = [];
  let cursor, effects, changed, tree;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { const value = typeof next === 'function' ? next(values[index]) : next; if (!Object.is(value, values[index])) { values[index] = value; changed = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect, deps) { const index = cursor++; if (!values[index] || deps.some((value, i) => !Object.is(value, values[index][i]))) { values[index] = deps; effects.push(effect); } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compile(name))(id => id === 'react' ? hooks : require(id), module, module.exports);
  const Component = module.exports.default;
  const api = {
    render(next = props) { props = next;
      for (let tries = 0; tries < 30; tries++) {
        cursor = 0; effects = []; changed = false; tree = Component(props); effects.forEach(effect => effect()); if (!changed) return tree;
      } throw new Error('Did not settle'); },
    /* دو دور صبر: یکی برای Promiseِ کانال و دیگری برای رندرِ نتیجهٔ آن. */
    async settle() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); api.render(); },
    nodes: () => flatten(tree), content: () => text(tree),
    field(name) { const node = api.nodes().find(item => ['input', 'select', 'textarea'].includes(item.type) && item.props.name === name); assert.ok(node, name); return node; },
    has(name) { return api.nodes().some(item => ['input', 'select', 'textarea'].includes(item.type) && item.props.name === name); },
    change(name, value) { const node = api.field(name); node.props.onChange({ target: { value, checked: value } }); api.render(); },
    byName(name) { const node = api.nodes().find(item => item.props.name === name); assert.ok(node, name); return node; },
    hasButton(name) { return api.nodes().some(item => item.type === 'button' && item.props.name === name); },
    async press(name) { const node = api.byName(name); await node.props.onClick({ preventDefault() {} }); await api.settle(); return node; },
  };
  api.render(); return api;
}

const fa = value => Number(value || 0).toLocaleString('fa-IR');
/* بند ۳/۶: شمارهٔ سندِ ساختهٔ سرور با رقمِ فارسی دیده می‌شود؛ رکورد لاتین می‌ماند. */
const faNo = value => String(value ?? '').replace(/[0-9]/g, d => String.fromCharCode(0x06f0 + Number(d)));
const M = n => n * 1000000;
const ORDER = { id: 'o1', orderNumber: '2001', customerName: 'مشتری نمونه', customerId: 'c1' };
const item = (overrides = {}) => ({ id: 'i1', productName: 'کتاب راهنما', qty: 2000, qtyUnit: 'نسخه', stage: 'کنترل کیفیت', quality: null, deliveries: [], ...overrides });

/* بدنهٔ همان پاسخِ be:invoiceProposal؛ در آزمون دست‌ساز است تا معلوم شود رابط فقط مصرف‌کننده است. */
const proposal = (overrides = {}) => ({
  ok: true, orderId: 'o1', orderNumber: '2001', quoteRevision: 2, contractMode: 'ثابت', approvedTotal: M(1247),
  items: [{ itemId: 'i1', label: 'کتاب راهنما', ordered: 2000, good: 1800, delivered: 1200, remaining: 800 }],
  rows: [
    { itemId: 'i1', lineId: 'l1', kind: 'services', role: 'per_copy', description: 'چاپ متن', itemCode: '', unit: 'بند', qty: 1200, cumulativeQty: 1200, cumulativeAmount: M(600), amount: M(600), rate: M(0.5), cost: M(600), customerSupplied: false },
    { itemId: 'i1', lineId: 'l2', kind: 'materials', role: 'fixed', description: 'زینک', itemCode: '', unit: 'ورق', qty: 4, cumulativeQty: 4, cumulativeAmount: M(8), amount: M(8), rate: M(2), cost: M(8), customerSupplied: false },
  ],
  totals: { grossAmount: M(608), markupAmount: M(120), subtotal: M(728), discountAmount: 0, taxableAmount: M(728), taxAmount: 0, totalAmount: M(728) },
  cumulative: { grossCost: M(608), markup: M(120), subtotal: M(728), discount: 0, taxable: M(728), tax: 0, total: M(728), serviceCost: M(600) },
  warnings: [], canIssue: true, issueBlock: '', invoices: [],
  ...overrides,
});

function recorder(replies = {}) {
  const calls = [];
  const channel = name => (...args) => { calls.push({ name, args }); const reply = replies[name];
    return Promise.resolve(typeof reply === 'function' ? reply(...args) : reply); };
  return { calls, api: { invoiceProposal: channel('invoiceProposal'), issuePartial: channel('issuePartial'), refresh: channel('refresh'), action: channel('action') } };
}
const openPanel = (bridge, extra = {}) => mount('DeliveryInvoicePanel', { orders: [ORDER], onProposal: bridge.invoiceProposal, onIssuePartial: bridge.issuePartial, onRefresh: bridge.refresh, ...extra });

/* ── سه عددِ هر قلم ─────────────────────────────────────────────── */

test('بی‌مجوزِ نقش و بی‌عددِ ثبت‌شده هیچ فرمِ عددی باز نمی‌شود (کنترل منفی: دروازه از رابط رد نمی‌شود)', async () => {
  let touched = 0;
  const ui = mount('ItemDeliveryCounts', { order: ORDER, item: item(), canRecordQuality: false, canRecordDelivery: false,
    onAction: () => { touched++; return Promise.resolve({ ok: true }); }, faDate: d => d });
  await ui.settle();
  assert.equal(ui.content(), '', 'کارتِ عددها اصلاً رندر نمی‌شود');
  assert.equal(ui.nodes().length, 0);
  assert.equal(touched, 0);
});

/* بند ۳/۵ (پرسش ۱): دو عدد دو شغل دارند — رابط دو اجازهٔ جدا می‌گیرد و بی‌اجازه هیچ
   خانهٔ نوشتنی نمی‌سازد. کنترل منفی: ناظر کیفیت جای تحویل، امضاکنندهٔ تحویل جای «سالم» نمی‌بیند. */
test('«سالم» و «تحویل» دو اجازهٔ جدا: بی‌اجازه هیچ خانهٔ نوشتنی‌ای باز نمی‌شود', () => {
  const qc = mount('ItemDeliveryCounts', { order: ORDER, item: item(), canRecordQuality: true, canRecordDelivery: false, faDate: d => d, onAction: () => Promise.resolve({ ok: true }) });
  assert.equal(qc.has('good'), true, 'ناظر کیفیت خانهٔ «سالم» را می‌بیند');
  assert.equal(qc.has('billable'), false, 'و خانهٔ تحویل را نمی‌بیند');
  const clerk = mount('ItemDeliveryCounts', { order: ORDER, item: item({ quality: { good: 1800, at: '1405-08-11', by: { name: 'سمیرا' } } }), canRecordQuality: false, canRecordDelivery: true, faDate: d => d, onAction: () => Promise.resolve({ ok: true }) });
  assert.equal(clerk.has('good'), false, 'ثبت‌کنندهٔ تحویل «سالم» را از این رابط نمی‌نویسد');
  assert.equal(clerk.hasButton('record-quality'), false);
  assert.equal(clerk.has('billable'), true, 'جای تحویل باز است');
  assert.ok(clerk.content().includes(`${fa(1800)} نسخه`), 'عددِ ثبت‌شدهٔ کنترل کیفیت را فقط می‌خواند');
});

test('سه عدد جدا می‌مانند: سفارش‌شده از قلم، سالم «ثبت نشده» تا ثبت شود، تحویل از ردیف‌های خودش', () => {
  const ui = mount('ItemDeliveryCounts', { order: ORDER, canRecordQuality: false, canRecordDelivery: false, faDate: d => `ج${d}`, onAction: () => Promise.resolve({ ok: true }),
    item: item({ deliveries: [{ id: 'd1', billable: 1200, at: '1405-08-12', note: 'نصف تیراژ', by: { name: 'مریم' } }] }) });
  const content = ui.content();
  assert.ok(content.includes(`${fa(2000)} نسخه`), 'سفارش‌شده');
  assert.ok(content.includes('ثبت نشده'), 'سالمِ ثبت‌نشده صفر نمی‌شود');
  assert.ok(content.includes(`${fa(1200)} نسخه`) && content.includes(`${fa(800)} نسخه`), 'تحویل‌شده و مانده از جمعِ ردیف‌ها');
  assert.ok(content.includes('ج1405-08-12') && content.includes('نصف تیراژ') && content.includes('مریم'), 'ردیف تحویل با تاریخ، شرح و ثبت‌کنندهٔ سرور');
  assert.equal(ui.has('good'), false, 'بی‌مجوز، جای ثبتِ عدد نیست');
  assert.equal(ui.has('billable'), false);
});

test('تعداد سالم فقط عددِ صحیح است، مبلغی فرستاده نمی‌شود و یک‌بارِ ثبت شدنی است', async () => {
  const sent = [];
  const ui = mount('ItemDeliveryCounts', { order: ORDER, item: item(), canRecordQuality: true, faDate: d => d,
    onAction: (orderId, action, payload) => { sent.push([orderId, action, payload]); return Promise.resolve({ ok: true }); } });
  assert.equal(ui.field('good').props.value, '2000', 'پیش‌فرض همان تیراژِ قلم است، نه عددی تازه');
  ui.change('good', '۱٬۸۰۰');
  assert.equal(ui.field('good').props.value, '1800', 'ارقامِ فارسی و جداکننده پیش از ارسال پاک می‌شود');
  await ui.press('record-quality');
  assert.deepEqual(sent, [['o1', 'record_quality', { itemId: 'i1', good: 1800 }]], 'بی‌شرحِ خالی، فقط itemId و good');
  assert.ok(!/amount|total|price|rial|ریال/.test(JSON.stringify(sent)), 'هیچ ریالی از این پنل بیرون نمی‌رود');
  assert.ok(ui.content().includes('تعداد سالم ثبت شد'));
  assert.ok(ui.content().includes('قابل ویرایش نیست'));
});

test('سرور که رد کرد، متنش عیناً می‌آید و عددِ ثبت‌شده در رابط پیش‌نوشته نمی‌شود', async () => {
  const refusal = 'جمع تحویل (۲٬۰۰۰) از تعداد سالمِ ثبت‌شده (۱٬۸۰۰) بیشتر است.';
  const stored = item();
  const ui = mount('ItemDeliveryCounts', { order: ORDER, item: stored, canRecordQuality: true, faDate: d => d,
    onAction: () => Promise.resolve({ ok: false, error: refusal }) });
  ui.change('good', '۲۵۰۰');
  await ui.press('record-quality');
  assert.ok(ui.content().includes(refusal), 'دلیلِ ردِ سرور جانشینِ محلی ندارد');
  assert.equal(ui.content().includes('تعداد سالم ثبت شد'), false);
  assert.equal(ui.has('good'), true, 'فرم باز می‌ماند تا عددِ درست وارد شود');
  assert.equal(stored.quality, null, 'رابط هیچ چیزی به رکوردِ سرور اضافه نمی‌کند');
});

test('سالمِ ثبت‌شده: فرمِ ثبت می‌رود و راه تغییر فقط سندِ اصلاحی است', () => {
  const ui = mount('ItemDeliveryCounts', { order: ORDER, canRecordQuality: true, canRecordDelivery: true, faDate: d => `ج${d}`, onAction: () => Promise.resolve({ ok: true }),
    item: item({ quality: { good: 1800, at: '1405-08-11', note: '۲۰ نسخه پاشیدگی', by: { name: 'سمیرا' } }, deliveries: [{ id: 'd1', billable: 1200, at: '1405-08-12', by: { name: 'مریم' } }] }) });
  assert.equal(ui.has('good'), false, 'ثبتِ دوباره روی همان خانه مجاز نیست');
  assert.equal(ui.hasButton('record-quality'), false);
  assert.ok(ui.content().includes('سندِ اصلاحی'));
  assert.ok(ui.content().includes(`${fa(1800)} نسخه`) && ui.content().includes('ج1405-08-11') && ui.content().includes('سمیرا'));
});

test('تحویلِ صفر یا خالی دکمه را خاموش می‌کند؛ تحویلِ مثبت با شرح به همان قلم ثبت می‌شود', async () => {
  const sent = [];
  const ui = mount('ItemDeliveryCounts', { order: ORDER, item: item({ quality: { good: 1800, at: '1405-08-11', by: { name: 'سمیرا' } } }), canRecordDelivery: true, faDate: d => d,
    onAction: (orderId, action, payload) => { sent.push([orderId, action, payload]); return Promise.resolve({ ok: true }); } });
  assert.equal(ui.byName('record-delivery').props.disabled, true, 'بی‌مقدار، ردیفی ساخته نمی‌شود');
  ui.change('billable', '۰');
  assert.equal(ui.byName('record-delivery').props.disabled, true, 'صفر طلب نمی‌سازد');
  ui.change('billable', '۵۰۰');
  ui.change('delivery-note', 'آقای رضایی — بار ۱۲');
  await ui.press('record-delivery');
  assert.deepEqual(sent, [['o1', 'record_delivery', { itemId: 'i1', billable: 500, note: 'آقای رضایی — بار ۱۲' }]], 'شناسهٔ ردیف را سرور می‌سازد، نه رابط');
  assert.ok(!/amount|cost|rate/.test(JSON.stringify(sent)), 'مبلغ و نرخ از این مسیر نوشته نمی‌شود');
});

/* ── میزِ فاکتورِ تحویلی ─────────────────────────────────────────── */

test('پیش از انتخاب سفارش هیچ جدولِ پولی باز نیست و سروری صدا زده نمی‌شود', async () => {
  const { calls, api } = recorder();
  const ui = await openPanel(api);
  await ui.settle();
  assert.equal(calls.length, 0, 'بی‌سفارشِ انتخابی، پیشنهادی خوانده نمی‌شود');
  assert.equal(ui.nodes().some(node => node.type === 'table'), false);
  assert.ok(ui.content().includes('عددها و مبلغِ قابل صورتحساب را سرور می‌خواند'));
});

test('ردیف‌ها، سه عدد و جمع‌ها عیناً از بدنهٔ پاسخِ سرور است', async () => {
  const { api } = recorder({ invoiceProposal: proposal({ warnings: ['ردیف «زینک» به هیچ قلم سفارش وصل نیست.'] }) });
  const ui = await openPanel(api);
  ui.change('proposalOrder', 'o1');
  await ui.settle();
  const content = ui.content();
  assert.ok(content.includes(fa(M(728))), 'مبلغ این فاکتور از totalsِ سرور');
  assert.ok(content.includes(fa(M(1247))), 'مبلغ تأییدشدهٔ پیش‌فاکتور از سرور');
  assert.ok(content.includes(fa(M(600))) && content.includes('چاپ متن'), 'ردیفِ هر نسخه‌ای با مبلغ خودش');
  assert.ok(content.includes('هر نسخه‌ای') && content.includes('ثابت (یک‌بار)'), 'نقشِ ردیف از سرور برچسب می‌گیرد');
  assert.ok(content.includes(fa(1200)) && content.includes(fa(800)), 'سه عددِ هر قلم از itemsِ سرور');
  assert.ok(content.includes('حالت قرارداد'), 'حالت قرارداد همان چیزی است که پیش‌فاکتور نگه داشته');
  assert.ok(content.includes('ردیف «زینک» به هیچ قلم سفارش وصل نیست'), 'هشدارِ موتور نمایش داده می‌شود');
  assert.ok(!content.includes(fa(M(999))), 'عددِ ساخته‌نشده در هیچ خانه‌ای نمی‌نشیند');
});

test('سرور که «هنوز نه» گفته، دکمه خاموش است و صدور با زورِ کلیک هم صدا زده نمی‌شود', async () => {
  const block = 'برای این سفارش هنوز تحویلِ ثبت‌شده‌ای نیست؛ ابتدا تعداد تحویل‌قابل‌صورتحساب را در مرحلهٔ تحویل ثبت کنید.';
  const { calls, api } = recorder({ invoiceProposal: proposal({ canIssue: false, issueBlock: block }) });
  const ui = await openPanel(api);
  ui.change('proposalOrder', 'o1');
  await ui.settle();
  assert.ok(ui.content().includes(block), 'دلیلِ بسته‌بودن از همان قاعدهٔ صدورِ سرور است');
  assert.equal(ui.byName('issue-partial').props.disabled, true);
  await ui.press('issue-partial');
  assert.equal(calls.filter(call => call.name === 'issuePartial').length, 0, 'کنترل منفی: مسیرِ نوشتن باز نمی‌شود');
});

test('صدور فقط شناسهٔ سفارش را می‌فرستد، سپس همان پیشنهاد دوباره خوانده و فهرست اسناد تازه می‌شود', async () => {
  const { calls, api } = recorder({
    invoiceProposal: proposal({ invoices: [{ id: 'd1', number: 'I-77', billingMode: 'partial', total: M(728), createdAt: 1792627200000, status: 'issued' }] }),
    issuePartial: () => ({ ok: true, document: { id: 'd2', number: 'I-78' } }),
    refresh: () => ({ ok: true, documents: [] }),
  });
  const ui = await openPanel(api);
  ui.change('proposalOrder', 'o1');
  await ui.settle();
  assert.ok(ui.content().includes(faNo('I-77')) && ui.content().includes('بر پایهٔ تحویل'), 'فاکتورهای قبلیِ همین نسخه با شمارهٔ فارسی دیده می‌شود');
  assert.equal(ui.content().includes('I-77'), false, 'شمارهٔ لاتینِ همان فاکتور در دید نمی‌ماند');
  assert.ok(ui.content().includes(fa(M(1247) - M(728))), 'باقی‌مانده از کسرِ جمعِ اسنادِ سرور است');
  await ui.press('issue-partial');
  const issued = calls.filter(call => call.name === 'issuePartial');
  assert.deepEqual(issued.map(call => call.args), [['o1']], 'بدون هیچ مبلغی؛ سرور خودش می‌شمارد');
  assert.equal(calls.filter(call => call.name === 'invoiceProposal').length, 2, 'پس از صدور، پیشنهاد از سرور تازه می‌شود');
  assert.equal(calls.filter(call => call.name === 'refresh').length, 1);
  assert.ok(ui.content().includes(faNo('I-78')) && ui.content().includes('دفتر صورتحساب قفل شد'), 'پیامِ صدور شمارهٔ تازه را فارسی می‌برد');
  assert.equal(ui.content().includes('I-78'), false, 'هیچ شمارهٔ لاتینی از همان سند در دید نمی‌ماند');
});

test('FORBIDDENِ سرور جانشینِ محلی ندارد و هیچ جدولِ پولی باز نمی‌ماند', async () => {
  const { api } = recorder({ invoiceProposal: () => ({ ok: false, code: 'FORBIDDEN', error: 'پیشنهاد صورتحساب فقط در اختیار مدیر و مدیر مالی است.' }) });
  const ui = await openPanel(api);
  ui.change('proposalOrder', 'o1');
  await ui.settle();
  assert.ok(ui.content().includes('پیشنهاد صورتحساب فقط در اختیار مدیر و مدیر مالی است.'));
  assert.equal(ui.nodes().some(node => node.type === 'table'), false);
  assert.equal(ui.hasButton('issue-partial'), false);
});

/* ── دروازهٔ میزها ──────────────────────────────────────────────── */

test('پنلِ فاکتور تحویلی فقط میزِ فاکتور و فقط با پلِ امن باز می‌شود', () => {
  const withBridge = mount('FinancialDocuments', { documents: [], orders: [ORDER], documentType: 'invoice', onProposal: () => Promise.resolve({ ok: false }), onIssuePartial: () => Promise.resolve({ ok: false }) });
  assert.equal(withBridge.has('proposalOrder'), true, 'میز فاکتور جای همین پنل است');
  const quoteDesk = mount('FinancialDocuments', { documents: [], orders: [ORDER], documentType: 'quote', onProposal: () => Promise.resolve({ ok: false }) });
  assert.equal(quoteDesk.has('proposalOrder'), false, 'میز پیش‌فاکتور و صورت‌حساب این پنل را ندارند');
  const noBridge = mount('FinancialDocuments', { documents: [], orders: [ORDER], documentType: 'invoice' });
  assert.equal(noBridge.has('proposalOrder'), false, 'بی‌پلِ امن، هیچ کادرِ صدور فاکتور تحویلی باز نمی‌شود');
});
