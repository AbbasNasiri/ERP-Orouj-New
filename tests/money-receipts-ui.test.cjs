'use strict';
/* اصلاحات ۱۷/بند ۲/۴: پنلِ درون‌خطیِ رسیدِ وجه (src/MoneyReceipts.jsx).
   پنل هیچ عددی از خودش نمی‌سازد، پس آزمون هم همین را باید ثابت کند:
   ۱) پلِ امن (window.printshopApi) نباشد یا سرور FORBIDDEN بدهد، هیچ کادرِ پولی باز نمی‌شود؛
   ۲) جمع‌ها و پیشنهادِ تخصیص از بدنهٔ پاسخِ سرور می‌آید، نه از حسابِ رابط؛
   ۳) مبلغِ تایپ‌شدهٔ فارسی به عددِ صحیحِ ریالی تبدیل می‌شود و فقط همان مبلغ به سرور می‌رود؛
   ۴) تا «خودم تقسیم کنم» زده نشود، ردیفِ تخصیص اصلاً فرستاده نمی‌شود (FIFO با سرور)؛
   ۵) دکمه‌های عملیتِ چک از جدولِ chequeActionsِ سرور ساخته می‌شود — نه از قاعدهٔ خودِ رابط؛
   ۶) ابطال با دلیلِ کوتاه خاموش است و با دلیلِ کافی، دفتر دوباره خوانده و سفارش تازه می‌شود. */
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
  return typeof node === 'object' ? text(node.props?.children) : String(node);
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
    async settle() { await new Promise(resolve => setImmediate(resolve)); api.render(); },
    /* صبرِ واقعی برای تایمرِ ۳۵۰ میلی‌ثانیه‌ایِ پیشنهادِ تخصیص، و بعد یک دور رندر. */
    async wait(ms = 400) { await new Promise(resolve => setTimeout(resolve, ms)); await api.settle(); },
    nodes: () => flatten(tree), content: () => text(tree),
    field(name) { const node = api.nodes().find(item => ['input', 'select', 'textarea'].includes(item.type) && item.props.name === name); assert.ok(node, name); return node; },
    has(name) { return api.nodes().some(item => ['input', 'select', 'textarea'].includes(item.type) && item.props.name === name); },
    change(name, value) { const node = api.field(name); node.props.onChange({ target: { value, checked: value } }); api.render(); },
    byName(name) { const node = api.nodes().find(item => item.props.name === name); assert.ok(node, name); return node; },
    button(label) { const nodes = api.nodes().filter(item => item.type === 'button' && text(item) === label); assert.ok(nodes.length, label); return nodes[0]; },
    hasButton(label) { return api.nodes().some(item => item.type === 'button' && text(item) === label); },
    click(label) { const node = api.button(label); const running = node.props.onClick(); api.render(); return running; },
  };
  api.render(); return api;
}

const M = n => n * 1000000;
const fmt = n => String(n);
/* بند ۳/۶ (تصمیمِ کارفرما «فارسی»): شمارهٔ رسید را سرور می‌سازد، پس دیدنش فارسی است. */
const fa = value => String(value ?? '').replace(/[0-9]/g, d => String.fromCharCode(0x06f0 + Number(d)));
const ORDER = { id: 'o1', orderNumber: '2001', customerName: 'مشتری نمونه', customerId: 'c1' };
const CHEQUE_ACTIONS = { held: ['in_transit', 'cleared', 'bounced'], in_transit: ['cleared', 'bounced'], cleared: [], bounced: ['in_transit', 'cleared'], void: [] };

/* همان بدنه‌ای که be:receipts می‌سازد؛ در آزمون دست‌ساز است تا معلوم شود رابط فقط مصرف‌کننده است. */
function serverLedger(extra = {}) {
  return {
    ok: true,
    receipts: [
      { id: 'r1', number: '9001', customerId: 'c1', orderId: 'o1', method: 'چک', amount: M(20), status: 'held', receivedAt: '1405-08-11',
        cheque: { number: '۷۷', bank: 'ملی', branch: 'شعبه ۱', due: '1405-09-20' }, note: 'چکِ تحویلِ سالن', legacyPaymentId: '', opening: false,
        createdBy: 'مریم', createdAt: 0, clearedAt: '', voidedBy: '', voidReason: '', voidedAt: 0,
        allocations: [{ id: 'a1', receiptId: 'r1', orderId: 'o1', documentId: 'd1', amount: M(20), kind: 'definite' }] },
      { id: 'r2', number: '9002', customerId: 'c1', orderId: 'o1', method: 'نقد', amount: M(5), status: 'cleared', receivedAt: '1405-08-12',
        cheque: null, note: '', legacyPaymentId: 'p-legacy', opening: true, createdBy: 'مریم', createdAt: 0, clearedAt: '1405-08-12', voidedBy: '', voidReason: '', voidedAt: 0,
        allocations: [] },
      { id: 'r3', number: '9003', customerId: 'c1', orderId: 'o2', method: 'چک', amount: M(4), status: 'void', receivedAt: '1405-08-13',
        cheque: { number: '۸۸', bank: '', branch: '', due: '1405-08-20' }, note: '', legacyPaymentId: '', opening: false,
        createdBy: 'مریم', createdAt: 0, clearedAt: '', voidedBy: 'مدیر', voidReason: 'اشتباهِ ثبت در ایستگاه مالی', voidedAt: 0, allocations: [] },
    ],
    totals: { gross: M(25), allocated: M(20), advance: M(5), pendingCheque: M(20), cleared: M(5) },
    lines: [
      { orderId: 'o1', orderNumber: '2001', kind: 'definite', documentId: 'd1', source: 'فاکتور I-77', documentDate: '1405-07-30', dueDate: '1405-08-30', payable: M(60), paid: M(20), open: M(40), advance: 0, overdue: false },
      { orderId: 'o2', orderNumber: '2002', kind: 'commitment', documentId: '', source: 'سفارشِ تأییدشده', documentDate: '1405-08-05', dueDate: '', payable: M(25), paid: 0, open: M(25), advance: 0, overdue: false },
    ],
    proposal: null, advance: 0,
    methods: ['نقد', 'کارت به کارت', 'چک', 'حواله بانکی'],
    statuses: { held: 'در دست', in_transit: 'در جریان وصول', cleared: 'وصول‌شده', bounced: 'برگشتی', void: 'باطل' },
    fields: [['number', 'شماره رسید']],
    chequeActions: CHEQUE_ACTIONS,
    ...extra,
  };
}
/* fakeApi هر فراخوانی را ثبت می‌کند؛ آخرِ کار ثابت می‌شود پنل جز چهار کانالِ پول چیزی صدا نزد. */
function fakeApi(replies = {}) {
  const calls = [];
  const channel = method => (...args) => { calls.push({ method, args }); const reply = replies[method]; return Promise.resolve(typeof reply === 'function' ? reply(...args) : reply); };
  return { calls, api: { receipts: channel('receipts'), recordReceipt: channel('recordReceipt'), receiptCheque: channel('receiptCheque'), voidReceipt: channel('voidReceipt') } };
}
const readLedger = () => serverLedger();
const proposalFor = amount => serverLedger({ proposal: { rows: [{ orderId: 'o1', documentId: 'd1', amount, kind: 'definite', source: 'فاکتور I-77', dueDate: '1405-08-30' }], advance: 0 } });
async function open(props, bridge) {
  globalThis.window = { printshopApi: bridge };
  const ui = mount('MoneyReceipts', { customerId: 'c1', order: ORDER, fmt, faDate: d => `ج${d}`, ...props });
  await ui.settle();
  return ui;
}

test('پلِ امن نباشد هیچ کادرِ پولی باز نمی‌شود (کنترل منفی: مسیرِ نوشتنِ سمتِ کلاینت وجود ندارد)', async () => {
  globalThis.window = {};
  const ui = mount('MoneyReceipts', { customerId: 'c1', order: ORDER, fmt, faDate: d => d });
  await ui.settle();
  assert.match(ui.content(), /فقط در نسخهٔ پایگاه دادهٔ امن/);
  assert.equal(ui.has('amount'), false, 'بدونِ سرور، فرمِ مبلغ و تخصیص اصلاً رندر نمی‌شود');
  assert.equal(ui.nodes().some(node => node.type === 'table'), false, 'بدونِ سرور هیچ دفتری نمایش داده نمی‌شود');
});

test('FORBIDDENِ سرور عیناً نمایش داده می‌شود و جانشینِ محلی ندارد', async () => {
  const { api } = fakeApi({ receipts: () => ({ ok: false, code: 'FORBIDDEN', error: 'دفتر رسیدهای وجه فقط در اختیار مدیر چاپخانه و مدیر مالی است.' }) });
  const ui = await open({}, api);
  assert.ok(ui.content().includes('دفتر رسیدهای وجه فقط در اختیار مدیر چاپخانه و مدیر مالی است.'));
  assert.equal(ui.has('amount'), false);
  assert.ok(ui.hasButton('تازه‌سازی از سرور'));
});

test('جمع‌ها و شماره‌ها از بدنهٔ پاسخِ سرور است؛ بدونِ مبلغ، دکمهٔ ثبت خاموش', async () => {
  const { calls, api } = fakeApi({ receipts: readLedger });
  const ui = await open({}, api);
  assert.ok(ui.content().includes(fmt(M(25))), 'جمعِ دریافتِ زنده از totalsِ سرور');
  assert.ok(ui.content().includes(fmt(M(20))), 'چکِ در دست در خانهٔ خودش، جدا از نقدِ صندوق');
  assert.ok(ui.content().includes(fa('9001')), 'شمارهٔ رسیدِ سرور با رقمِ فارسی در جدول است');
  assert.equal(ui.content().includes('9001'), false, 'رقمِ لاتینِ شمارهٔ رسید جایی در دید نمی‌ماند');
  assert.ok(ui.content().includes('2001'), 'شمارهٔ سفارش عددِ بیرونی است و لاتین می‌ماند');
  assert.ok(ui.content().includes('ج1405-08-11'), 'تاریخ از faDate می‌آید نه از Date.toISOString');
  assert.ok(ui.content().includes('افتتاحیه'), 'رسیدِ مهاجرت‌یافته علامت دارد');
  assert.ok(ui.content().includes('اشتباهِ ثبت در ایستگاه مالی'), 'دلیلِ ابطالِ رسیدِ باطل‌شده دیده می‌شود');
  assert.ok(ui.content().includes('20000000'), 'تخصیصِ هر رسید از ردیف‌های خودش خوانده می‌شود');
  assert.equal(ui.button('ثبت رسید و تخصیص').props.disabled, true);
  assert.deepEqual(calls, [{ method: 'receipts', args: [{ customerId: 'c1' }] }], 'پیش از تایپِ مبلغ، فقط دفتر خوانده می‌شود');
});

test('مبلغِ فارسی به عددِ صحیحِ ریالی می‌شود، پیشنهاد از سرور می‌آید و در حالتِ خودکار ردیفِ تخصیص فرستاده نمی‌شود', async () => {
  const { calls, api } = fakeApi({
    receipts: input => (input && input.amount ? proposalFor(input.amount) : readLedger()),
    recordReceipt: () => ({ ok: true, receipt: { number: '9004' }, allocated: M(5), advance: 0 }),
  });
  const ui = await open({}, api);
  ui.change('amount', '۵٬۰۰۰٬۰۰۰');
  assert.equal(ui.field('amount').props.value, '5000000', 'ارقامِ فارسی و جداکننده پاک می‌شود');
  await ui.wait();
  assert.deepEqual(calls[1], { method: 'receipts', args: [{ customerId: 'c1', amount: 5000000 }] }, 'رابط فقط مبلغِ تایپ‌شده را می‌فرستد، نه عددی از خودش');
  assert.equal(ui.has('alloc-o1'), false, 'در حالتِ «پیشنهاد سرور» ردیفِ تخصیص ورودیِ متن نیست');
  assert.ok(ui.content().includes('پیشنهاد سرور (ریال)'), 'سرستون می‌گوید عدد از کجا آمده');
  const before = calls.length;
  await ui.click('ثبت رسید و تخصیص'); await ui.settle(); await ui.settle();
  const sent = calls.slice(before).find(c => c.method === 'recordReceipt');
  assert.ok(sent, 'ثبت فقط از کانالِ be:recordReceipt انجام می‌شود');
  assert.equal(sent.args[0].amount, 5000000);
  assert.equal(sent.args[0].customerId, 'c1');
  assert.equal(sent.args[0].orderId, 'o1');
  assert.equal(sent.args[0].method, 'نقد');
  assert.equal(sent.args[0].receivedAt, ui.field('receivedAt').props.value, 'تاریخِ دریافت همان روزِ انتخابی است');
  assert.equal(sent.args[0].allocations, undefined, 'تا «خودم تقسیم کنم» زده نشود، FIFO تصمیمِ سرور است');
  assert.ok(ui.content().includes(fa('9004')), 'شماره‌ای که سرور داده در پیامِ موفقیت با رقمِ فارسی می‌آید');
  assert.equal(ui.content().includes('9004'), false, 'همان پیام رقمِ لاتین ندارد');
  assert.equal(ui.field('amount').props.value, '', 'پس از موفقیت فرم پاک می‌شود');
});

test('ثبتِ موفقِ چک، روش را هم برمی‌گرداند تا رسیدِ بعدی با چکِ بی‌شماره رد نشود', async () => {
  const { calls, api } = fakeApi({
    receipts: input => (input && input.amount ? proposalFor(input.amount) : readLedger()),
    recordReceipt: () => ({ ok: true, receipt: { number: '9006' }, allocated: M(20), advance: 0 }),
  });
  const ui = await open({}, api);
  ui.change('method', 'چک'); ui.change('amount', '20000000'); ui.change('chequeNumber', '۷۷');
  await ui.wait();
  await ui.click('ثبت رسید و تخصیص'); await ui.settle(); await ui.settle();
  assert.equal(calls.find(c => c.method === 'recordReceipt').args[0].method, 'چک', 'همان روشی که انتخاب شده فرستاده می‌شود');
  assert.equal(ui.field('method').props.value, 'نقد', 'فرمِ تازه با «نقد» باز می‌شود');
  assert.equal(ui.has('chequeNumber'), false, 'کادرِ چک هم بسته است؛ ردیفِ چکِ پیشین پاک شده');
});

test('«خودم تقسیم کنم» فقط ردیف‌هایِ مبلغ‌دار را می‌فرستد و باقی‌مانده پیش‌پرداخت نشان داده می‌شود', async () => {
  const { calls, api } = fakeApi({
    receipts: input => (input && input.amount ? proposalFor(input.amount) : readLedger()),
    recordReceipt: () => ({ ok: true, receipt: { number: '9005' }, allocated: M(1), advance: M(4) }),
  });
  const ui = await open({}, api);
  ui.change('amount', '5000000'); await ui.wait();
  ui.byName('alloc-manual').props.onClick(); ui.render();
  assert.ok(ui.content().includes('مبلغ این ردیف'), 'سرستون عوض می‌شود: حالا رابط عدد می‌دهد');
  ui.change('alloc-o1', '1000000');
  assert.ok(ui.content().includes('باقی‌مانده به‌عنوان پیش‌پرداخت'), 'ردیفِ باقی‌مانده نمایش داده می‌شود');
  assert.ok(ui.content().includes('4000000'), '۵ میلیون منهای ۱ میلیونِ تخصیص');
  const before = calls.length;
  await ui.click('ثبت رسید و تخصیص'); await ui.settle(); await ui.settle();
  const sent = calls.slice(before).find(c => c.method === 'recordReceipt');
  assert.deepEqual(sent.args[0].allocations, [{ orderId: 'o1', documentId: 'd1', amount: 1000000 }],
    'ردیفِ صفر فرستاده نمی‌شود؛ جمع‌بودنِ مبلغ را سرور کنترل می‌کند');
});

test('فیلدهای چک فقط با روشِ چک باز می‌شوند و ردِ سرور فرم را پاک نمی‌کند', async () => {
  const { calls, api } = fakeApi({
    receipts: readLedger,
    recordReceipt: () => ({ ok: false, code: 'VALIDATION_FAILED', error: 'برای چک، تاریخ سررسید لازم است.' }),
  });
  const ui = await open({}, api);
  assert.equal(ui.has('chequeNumber'), false, 'در روشِ نقد، کادرِ چک نیست');
  ui.change('method', 'چک');
  assert.ok(ui.has('chequeNumber')); assert.ok(ui.has('chequeDue'));
  ui.change('amount', '20000000'); ui.change('chequeNumber', '۷۷'); await ui.wait();
  await ui.click('ثبت رسید و تخصیص'); await ui.settle(); await ui.settle();
  const sent = calls.find(c => c.method === 'recordReceipt');
  assert.equal(sent.args[0].chequeNumber, '۷۷', 'شمارهٔ چک همان‌طور که تایپ شده می‌رود');
  assert.ok(ui.content().includes('برای چک، تاریخ سررسید لازم است.'), 'پیامِ ردِ سرور عیناً نمایش داده می‌شود');
  assert.equal(ui.field('amount').props.value, '20000000', 'فرم پاک نشده؛ کارفرما عددِ خودش را دوباره تایپ نمی‌کند');
  assert.ok(ui.content().includes('در دست'), 'وضعیت‌ها با برچسبِ statusesِ سرور خوانده می‌شوند');
});

test('دکمه‌های عملیتِ چک از جدولِ سرور ساخته می‌شود؛ وصولِ قطعی عملیتی ندارد و «در دست» مقصد نیست', async () => {
  const { calls, api } = fakeApi({
    receipts: readLedger,
    receiptCheque: () => ({ ok: true, receipt: { number: '9001', status: 'in_transit' } }),
  });
  const ui = await open({}, api);
  const rows = ui.nodes().filter(node => node.type === 'button' && /^cheque-/.test(node.props.name || ''));
  assert.deepEqual(rows.map(node => node.props.name), ['cheque-in_transit-r1', 'cheque-cleared-r1', 'cheque-bounced-r1'],
    'فقط چکِ «در دست» دکمه دارد؛ وصول‌شده (r2) و باطل (r3) هیچ عملیتی ندارند');
  assert.equal(rows.some(node => /held/.test(node.props.name)), false, 'بازگشتِ پول فقط با ابطالِ سند است');
  assert.equal(ui.nodes().filter(node => node.type === 'button' && node.props.name === 'void-r3').length, 0, 'رسیدِ باطل‌شده دوباره باطل نمی‌شود');
  await rows[0].props.onClick(); await ui.settle(); await ui.settle();
  const call = calls.find(c => c.method === 'receiptCheque');
  assert.deepEqual(call.args, ['r1', 'in_transit'], 'مقصد همان کلیدِ جدولِ سرور است نه برچسبِ فارسی');
  assert.ok(ui.content().includes(`رسید ${fa('9001')} — در جریان وصول`), 'پیام از statusesِ سرور با شمارهٔ فارسی ساخته می‌شود');
  assert.equal(ui.content().includes('رسید 9001'), false, 'همان پیام شمارهٔ لاتین ندارد');
  assert.equal(call.args[0], 'r1', 'عملیت فقط با شناسهٔ رکورد به سرور می‌رود، نه رشتهٔ نمایشی');
});

test('ابطال با دلیلِ کوتاه خاموش است؛ با دلیلِ کافی دفتر دوباره خوانده و سفارش تازه می‌شود', async () => {
  const { calls, api } = fakeApi({
    receipts: readLedger,
    voidReceipt: () => ({ ok: true, receipt: { number: '9001', status: 'void' } }),
  });
  let refreshed = 0;
  const ui = await open({ onChanged: () => { refreshed++; } }, api);
  const before = calls.length;
  ui.byName('void-r1').props.onClick(); ui.render();
  assert.ok(ui.has('void-reason'), 'کادرِ دلیل در همان ردیف باز می‌شود (بدون مودالِ روی مودال)');
  ui.change('void-reason', 'کوتاه');
  assert.equal(ui.button('ثبت ابطال').props.disabled, true, 'کمتر از ۱۰ نویسه اجازهٔ امضا نمی‌دهد');
  ui.change('void-reason', 'چک در بانک چاپ نشده بود و سند اشتباه است');
  await ui.click('ثبت ابطال'); await ui.settle(); await ui.settle();
  assert.deepEqual(calls.slice(before).map(c => ({ method: c.method, args: c.args })), [
    { method: 'voidReceipt', args: [{ id: 'r1', reason: 'چک در بانک چاپ نشده بود و سند اشتباه است' }] },
    { method: 'receipts', args: [{ customerId: 'c1' }] },
  ], 'ابطال و سپس بازخوانیِ دفتر؛ چیزِ سومی میان این دو نیست');
  assert.equal(refreshed, 1, 'سفارشِ همین صفحه هم بلافاصله تازه می‌شود');
  assert.ok(ui.content().includes('باطل شد؛ بدهی به پرونده برگشت'));
});

test('در تمامِ این تعامل فقط کانال‌هایِ پول صدا زده می‌شود', async () => {
  const { calls, api } = fakeApi({
    receipts: input => (input && input.amount ? serverLedger({ proposal: { rows: [], advance: input.amount } }) : readLedger()),
    recordReceipt: () => ({ ok: true, receipt: { number: '9006' }, allocated: 0, advance: M(3) }),
    voidReceipt: () => ({ ok: true, receipt: { number: '9002', status: 'void' } }),
  });
  const ui = await open({}, api);
  ui.change('amount', '3000000'); await ui.wait();
  await ui.click('ثبت رسید و تخصیص'); await ui.settle(); await ui.settle();
  ui.byName('void-r2').props.onClick(); ui.render();
  ui.change('void-reason', 'این رسید مربوط به مشتری دیگری بود');
  await ui.click('ثبت ابطال'); await ui.settle(); await ui.settle();
  assert.deepEqual([...new Set(calls.map(c => c.method))].sort(), ['receipts', 'recordReceipt', 'voidReceipt'],
    'رابط جز خواندنِ دفتر، ثبتِ رسید و ابطال هیچ راهِ نوشتنِ دیگری ندارد');
  assert.equal(Object.keys(api).sort().join(','), 'receiptCheque,receipts,recordReceipt,voidReceipt', 'پلِ پنل هم همین چهار کانال است');
});
