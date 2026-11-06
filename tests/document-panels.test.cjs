'use strict';
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
    nodes: () => flatten(tree), content: () => text(tree),
    field(name) { const node = api.nodes().find(item => ['input', 'select', 'textarea'].includes(item.type) && item.props.name === name); assert.ok(node, name); return node; },
    change(name, value) { const node = api.field(name); node.props.onChange({ target: { value, checked: value } }); api.render(); },
    button(label) { const node = api.nodes().find(item => item.type === 'button' && text(item) === label); assert.ok(node, label); return node; },
    submit(index = 0) { const form = api.nodes().filter(node => node.type === 'form')[index]; assert.ok(form); return form.props.onSubmit({ preventDefault() {} }); },
  };
  api.render(); return api;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
/* بند ۳/۶: شمارهٔ سند با رقمِ فارسی دیده می‌شود؛ خودِ رکوردِ سرور لاتین می‌ماند. */
const fa = value => String(value ?? '').replace(/[0-9]/g, d => String.fromCharCode(0x06f0 + Number(d)));
const order = { id: 'o1', orderNumber: 'ORDER-11', customerName: 'مشتری نمونه' };
const doc = { id: 'd1', number: 'INV-57', type: 'invoice', status: 'issued', orderNumber: 'ORDER-11', quoteRevision: 3, createdAt: 1792627200000 };

test('documents show distinct document/order references and filter issued/void tabs', () => {
  const ui = mount('FinancialDocuments', { documents: [doc, { ...doc, id: 'd2', number: 'INV-58', status: 'void' }], orders: [order] });
  assert.ok(ui.content().includes(fa('INV-57')), 'شمارهٔ سند فارسی دیده می‌شود');
  assert.equal(ui.content().includes('INV-57'), false, 'رقمِ لاتینِ همان شماره در جدول تکرار نمی‌شود');
  assert.ok(ui.content().includes('ORDER-11'), 'شمارهٔ سفارش عددِ بیرونی است و لاتین می‌ماند');
  assert.equal(ui.content().includes(fa('INV-58')), false);
  ui.button('باطل‌شده (۱)').props.onClick(); ui.render();
  assert.ok(ui.content().includes(fa('INV-58'))); assert.equal(ui.content().includes(fa('INV-57')), false);
  assert.equal(ui.button('چاپ').props.disabled, true);
});

test('documentType scopes list and selector and locks issuance to the parent tab type', async () => {
  const calls = [];
  const props = { documentType: 'invoice', documents: [doc, { ...doc, id: 'q1', type: 'quote', number: 'QUOTE-99' }],
    orders: [order], onIssue: async (...args) => { calls.push(args); return { ok: true, document: doc }; } };
  const ui = mount('FinancialDocuments', props);
  assert.ok(ui.content().includes(fa('INV-57'))); assert.equal(ui.content().includes(fa('QUOTE-99')), false);
  let options = flatten(ui.field('documentType')).filter(node => node.type === 'option');
  assert.deepEqual(options.map(node => node.props.value), ['invoice']);
  ui.change('documentType', 'quote'); ui.change('documentOrder', 'o1');
  await ui.submit(); ui.render();
  assert.deepEqual(calls, [['o1', 'invoice']]);
  ui.render({ ...props, documentType: 'quote' });
  options = flatten(ui.field('documentType')).filter(node => node.type === 'option');
  assert.deepEqual(options.map(node => node.props.value), ['quote']);
  assert.ok(ui.content().includes(fa('QUOTE-99'))); assert.equal(ui.content().includes(fa('INV-57')), false);
});

test('issuing validates order, guards duplicates and refreshes only after successful issue', async () => {
  const waiting = deferred(); const calls = []; let refreshes = 0;
  const ui = mount('FinancialDocuments', { documents: [], orders: [order], onIssue: (...args) => { calls.push(args); return waiting.promise; }, onRefresh: async () => { refreshes++; } });
  await ui.submit(); ui.render(); assert.equal(calls.length, 0);
  assert.ok(ui.content().includes('سفارش مرتبط را انتخاب'));
  ui.change('documentOrder', 'o1'); ui.change('documentType', 'invoice');
  const first = ui.submit(); await ui.submit(); ui.render();
  assert.deepEqual(calls, [['o1', 'invoice']]);
  assert.equal(ui.button('در حال انجام…').props.disabled, true);
  waiting.resolve({ ok: true, document: doc }); await first; ui.render();
  assert.equal(refreshes, 1); assert.equal(ui.field('documentOrder').props.value, '');
  assert.ok(ui.content().includes(fa('INV-57')));
});

test('failed issue retains selection and a failed refresh does not hide a successful issue', async () => {
  let attempt = 0;
  const ui = mount('FinancialDocuments', { orders: [order], onIssue: async () => ++attempt === 1 ? { ok: false, error: 'پیش‌فاکتور نیازمند اصلاح است' } : { ok: true, document: doc }, onRefresh: async () => { throw new Error('offline'); } });
  ui.change('documentOrder', 'o1');
  await ui.submit(); ui.render();
  assert.equal(ui.field('documentOrder').props.value, 'o1');
  assert.ok(ui.content().includes('پیش‌فاکتور نیازمند اصلاح است'));
  assert.equal(ui.content().includes('صادر شد'), false);
  await ui.submit(); ui.render();
  assert.ok(ui.content().includes(fa('INV-57'))); assert.ok(ui.content().includes('عملیات ثبت شد'));
});

test('idempotent result for an already void document never announces fresh issuance', async () => {
  const ui = mount('FinancialDocuments', { orders: [order], onIssue: async () => ({ ok: true, idempotent: true, document: { ...doc, status: 'void' } }) });
  ui.change('documentOrder', 'o1'); await ui.submit(); ui.render();
  assert.ok(ui.content().includes(fa('INV-57')));
  assert.ok(ui.content().includes('قبلاً باطل شده است'));
  assert.equal(ui.content().includes('صادر شد.'), false);
});

test('void requires reason, preserves editor on backend failure and forwards print callback', async () => {
  const calls = []; let printed;
  const ui = mount('FinancialDocuments', { documents: [doc], orders: [order], onPrint: document => { printed = document; }, onVoid: async (...args) => { calls.push(args); return { ok: false, error: 'ابطال مجاز نیست' }; } });
  await ui.button('چاپ').props.onClick(); assert.equal(printed, doc);
  ui.button('ابطال').props.onClick(); ui.render();
  await ui.submit(1); ui.render(); assert.equal(calls.length, 0);
  ui.change('voidReason', '  اصلاح شماره  ');
  await ui.submit(1); ui.render();
  assert.deepEqual(calls, [['d1', 'اصلاح شماره']]);
  assert.equal(ui.field('voidReason').props.value, '  اصلاح شماره  ');
  assert.ok(ui.content().includes('ابطال مجاز نیست'));
  assert.equal(ui.content().includes('سند باطل شد'), false);
});

/* بند ۳/۶ (تصمیمِ کارفرما «فارسی»): رقم فقط در دیدن عوض می‌شود. هر چیزی که به
   سرور یا به چاپِ PDF می‌رود همچنان همان رشتهٔ لاتینِ ذخیره‌شده است. */
test('شمارهٔ سند با رقمِ فارسی دیده می‌شود و همان رکورد لاتین به چاپ و سرور می‌رود', async () => {
  const calls = []; let printed;
  const ui = mount('FinancialDocuments', {
    documents: [doc], orders: [order], onPrint: document => { printed = document; },
    onVoid: async (...args) => { calls.push(args); return { ok: true, document: doc }; },
    onIssue: async () => ({ ok: true, document: doc }),
  });
  assert.ok(ui.content().includes(fa('INV-57')), 'سلولِ جدول فارسی است');
  assert.equal(ui.content().includes('INV-57'), false, 'هیچ نسخهٔ لاتینی از همان شماره در DOM نمانده');
  await ui.button('چاپ').props.onClick();
  assert.equal(printed.number, 'INV-57', 'رکوردِ چاپ همان لاتینِ سرور است');
  ui.button('ابطال').props.onClick(); ui.render();
  assert.ok(ui.content().includes(fa('INV-57')), 'سرستونِ فرمِ ابطال هم فارسی است');
  ui.change('voidReason', 'اصلاحِ شماره');
  await ui.submit(1); ui.render();
  assert.deepEqual(calls, [['d1', 'اصلاحِ شماره']], 'به سرور فقط شناسهٔ d1 می‌رود نه رشتهٔ نمایشی');
  ui.change('documentOrder', 'o1');
  await ui.submit(); ui.render();
  assert.ok(ui.content().includes(fa('INV-57')));
  assert.equal(ui.content().includes('با شماره INV-57'), false, 'پیامِ صدور هم رقمِ لاتین ندارد');
});

function settings() {
  /* اصلاحات ۱۷/بند ۲: 'moneyreceipt' (رسید وجه) رشتهٔ شمارهٔ تازه است و فرم باید
     ردیفِ همهٔ نوع‌ها را از سرور بگیرد، وگرنه ذخیره ساختار ناقص رد می‌کند. */
  return Object.fromEntries(['order', 'quote', 'invoice', 'statement', 'letter', 'receipt', 'stockmovement', 'consignmentreceipt', 'moneyreceipt'].map(key => [key,
    { prefix: `${key}-`, start: 1, next: 20, width: 4, enabled: true }]));
}

test('numbering loads server counters and refuses rollback or malformed numbers before saving', async () => {
  let saves = 0;
  const ui = mount('NumberingSettings', { onLoad: async () => ({ ok: true, settings: settings() }), onSave: async () => { saves++; } });
  await ui.settle();
  assert.equal(ui.field('invoice-next').props.value, 20);
  ui.change('invoice-next', '۱۹'); await ui.submit(); ui.render();
  assert.ok(ui.content().includes('نباید به عقب برگردد'));
  ui.change('invoice-next', '۲۱'); ui.change('invoice-width', '۱٫۵'); await ui.submit(); ui.render();
  assert.ok(ui.content().includes('عدد صحیح'));
  assert.equal(saves, 0);
});

test('numbering failure retains edits, duplicate save is blocked and server response is authoritative', async () => {
  let calls = 0; let captured; const waiting = deferred();
  const ui = mount('NumberingSettings', { onLoad: async () => ({ ok: true, settings: settings() }), onSave: async payload => {
    captured = payload; calls++;
    if (calls === 1) return { ok: false, error: 'شماره‌ها همزمان تغییر کرده‌اند' };
    return waiting.promise;
  } });
  await ui.settle(); ui.change('invoice-next', '۲۱');
  await ui.submit(); ui.render();
  assert.equal(ui.field('invoice-next').props.value, '۲۱');
  assert.ok(ui.content().includes('شماره‌ها همزمان تغییر کرده‌اند'));
  assert.equal(ui.content().includes('تنظیمات شماره‌گذاری ذخیره شد'), false);
  const first = ui.submit(); await ui.submit(); ui.render();
  assert.equal(calls, 2); assert.equal(captured.invoice.next, 21);
  assert.equal(ui.button('در حال ذخیره…').props.disabled, true);
  const authoritative = settings(); authoritative.invoice.next = 22;
  waiting.resolve({ ok: true, settings: authoritative }); await first; ui.render();
  assert.equal(ui.field('invoice-next').props.value, 22);
  assert.ok(ui.content().includes('تنظیمات شماره‌گذاری ذخیره شد'));
});

test('a failed numbering load never fabricates usable default counters', async () => {
  const ui = mount('NumberingSettings', { onLoad: async () => ({ ok: false, error: 'دسترسی مجاز نیست' }) });
  await ui.settle();
  assert.ok(ui.content().includes('دسترسی مجاز نیست'));
  assert.equal(ui.nodes().some(node => node.type === 'form'), false);
});

test('real backend defaults with zero width load/save and prefix limits match the server', async () => {
  const { defaults } = require('../electron/numbering.js');
  const actual = defaults(); let saved;
  assert.ok(Object.values(actual).every(config => config.width === 0));
  const ui = mount('NumberingSettings', { onLoad: async () => ({ ok: true, settings: actual }),
    onSave: async payload => { saved = payload; return { ok: true, settings: payload }; } });
  await ui.settle(); assert.equal(ui.field('invoice-width').props.value, 0);
  assert.equal(ui.field('invoice-prefix').props.maxLength, 30);
  await ui.submit(); ui.render(); assert.equal(saved.invoice.width, 0);
  ui.change('invoice-prefix', 'x'.repeat(31)); saved = null;
  await ui.submit(); ui.render(); assert.equal(saved, null);
  assert.ok(ui.content().includes('تنظیمات فاکتور معتبر نیست'));
  ui.change('invoice-prefix', '\u0001');
  await ui.submit(); ui.render(); assert.equal(saved, null);
});
