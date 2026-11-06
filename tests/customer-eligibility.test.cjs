'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.work', 'customer-eligibility-tests');
fs.mkdirSync(fixtureDir, { recursive: true });
const compiled = esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'CustomerEligibility.jsx')], bundle: true,
  write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' },
}).outputFiles[0].text;
const fixture = path.join(fixtureDir, 'CustomerEligibility.cjs');
fs.writeFileSync(fixture, compiled);
const Component = require(fixture).default;

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.props?.children);
}
function flatten(node, result = []) {
  if (node == null || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => flatten(child, result)); return result; }
  if (typeof node.type === 'function') return flatten(node.type(node.props), result);
  result.push(node); flatten(node.props?.children, result); return result;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function customer(overrides = {}) { return { id: 'c1', name: 'علی کیانی', phone: '۰۹۱۲۳۴۵۶۷۸۹', eligibility: { status: 'pending' }, ...overrides }; }
function supplier(overrides = {}) { return { id: 's1', name: 'کاغذ فروشی مرکزی', phone: '02199999999', eligibility: { status: 'pending' }, ...overrides }; }

// Real component handlers run against a minimal hooks host. Effects/DOM are not
// mocked because this component only stores local form values and a busy ref.
function mount(props) {
  let values = [], cursor = 0, tree;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in values)) values[i] = { current: initial }; return values[i]; },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === 'react' ? hooks : require(name), module, module.exports);
  const api = {
    render(next = props) { props = next; cursor = 0; tree = module.exports.default(props); return tree; },
    nodes: () => flatten(tree),
    content: () => text(tree),
    button(label) { const node = api.nodes().find(entry => entry.type === 'button' && text(entry) === label); assert.ok(node, `Missing ${label}`); return node; },
    hasButton(label) { return api.nodes().some(entry => entry.type === 'button' && text(entry) === label); },
    reason(value) { const node = api.nodes().find(entry => entry.type === 'textarea'); assert.ok(node); node.props.onChange({ target: { value } }); api.render(); },
  };
  api.render(); return api;
}

test('approval comes first and is offered before any code; issuing a code is disabled until approval', async () => {
  const calls = [];
  const props = { defaultKind: 'customer', customers: [customer()], suppliers: [], onAction: async (...args) => { calls.push(args); return { ok: true }; } };
  const ui = mount(props);
  ui.reason('بررسی مدارک انجام شد');
  assert.equal(ui.button('۱. تأیید مشتری').props.disabled, false);
  assert.equal(ui.button('۲. صدور کد یکتا').props.disabled, true, 'پیش از تأیید، دکمهٔ کد غیرفعال است');
  assert.ok(ui.content().includes('تا پیش از تأیید، این رکورد در فهرست کاری و فرم‌ها نمایش داده نمی‌شود'));
  await ui.button('۲. صدور کد یکتا').props.onClick(); ui.render();
  assert.equal(calls.length, 0, 'کلیک روی دکمهٔ غیرفعال، درخواستی نمی‌فرستد');
  await ui.button('۱. تأیید مشتری').props.onClick(); ui.render();
  assert.deepEqual(calls, [['customer', 'c1', 'approve', { reason: 'بررسی مدارک انجام شد' }]]);
  assert.ok(ui.content().includes('تأیید مشتری در سرور ثبت شد'));
  ui.render({ ...props, customers: [customer({ eligibility: { status: 'approved' } })] });
  assert.equal(ui.button('۲. صدور کد یکتا').props.disabled, false, 'پس از تأیید، صدور کد باز می‌شود');
  await ui.button('۲. صدور کد یکتا').props.onClick(); ui.render();
  assert.deepEqual(calls[1], ['customer', 'c1', 'issue_number', {}]);
  assert.ok(ui.content().includes('صدور کد یکتای مشتری در سرور ثبت شد'));
  assert.ok(ui.content().includes('صادر نشده'));
});

test('a coded record shows its code, refuses a second one and keeps the approve button closed', () => {
  const props = { defaultKind: 'customer', customers: [customer({ customerCode: 'C-000012', eligibility: { status: 'approved' } })], onAction: async () => ({ ok: true }) };
  const ui = mount(props);
  assert.ok(ui.content().includes('C-000012'));
  assert.equal(ui.button('کد صادر شده: C-000012').props.disabled, true);
  assert.equal(ui.button('۱. تأیید مشتری').props.disabled, true);
  assert.ok(ui.content().includes('تأیید شده و در فهرست کاری است'));
});

test('approval requires a reason; manager decision payload is trimmed and awaits success', async () => {
  const calls = [], saving = deferred();
  const props = { defaultKind: 'customer', customers: [customer()], onAction: (...args) => { calls.push(args); return saving.promise; } };
  const ui = mount(props);
  assert.equal(ui.button('۱. تأیید مشتری').props.disabled, true);
  await ui.button('۱. تأیید مشتری').props.onClick(); ui.render();
  assert.equal(calls.length, 0);
  assert.ok(ui.content().includes('بین ۳ تا ۲۰۰۰'));
  ui.reason('  سابقه و مدارک بررسی شد  ');
  const pending = ui.button('۱. تأیید مشتری').props.onClick(); ui.render();
  assert.deepEqual(calls[0], ['customer', 'c1', 'approve', { reason: 'سابقه و مدارک بررسی شد' }]);
  assert.equal(ui.button('در حال ثبت تأیید…').props.disabled, true);
  assert.ok(!ui.content().includes('تأیید مشتری در سرور ثبت شد'));
  saving.resolve({ ok: true }); await pending; ui.render();
  assert.ok(ui.content().includes('تأیید مشتری در سرور ثبت شد'));
  assert.ok(ui.content().includes('در انتظار بررسی')); // only refreshed props change the status
});

test('reject requires a reason, asks for it, and never displays success for failure', async () => {
  let calls = 0;
  const ui = mount({ defaultKind: 'customer', customers: [customer()], onAction: async (kind, id, action, payload) => { calls++; assert.equal(kind, 'customer'); assert.equal(id, 'c1'); assert.equal(action, 'reject'); assert.equal(payload.reason, 'اطلاعات کافی نیست'); return { ok: false, error: 'دسترسی مجاز نیست' }; } });
  ui.reason('  ');
  assert.equal(ui.button('رد و غیرفعال کردن').props.disabled, true);
  await ui.button('رد و غیرفعال کردن').props.onClick(); ui.render();
  assert.equal(calls, 0);
  ui.reason('اطلاعات کافی نیست');
  await ui.button('رد و غیرفعال کردن').props.onClick(); ui.render();
  assert.equal(calls, 1);
  assert.ok(ui.content().includes('دسترسی مجاز نیست'));
  assert.equal(ui.nodes().find(node => node.type === 'textarea').props.value, 'اطلاعات کافی نیست');
  assert.ok(!ui.content().includes('رد مشتری'));
});

test('an in-flight ref prevents duplicate submissions even before a rerender', async () => {
  let calls = 0; const saving = deferred();
  const ui = mount({ defaultKind: 'customer', customers: [customer({ eligibility: { status: 'approved' } })], onAction: () => { calls++; return saving.promise; } });
  const handler = ui.button('۲. صدور کد یکتا').props.onClick;
  const first = handler(), second = handler();
  assert.equal(calls, 1);
  saving.resolve({ ok: true }); await Promise.all([first, second]); ui.render();
  assert.ok(ui.content().includes('صدور کد یکتای مشتری در سرور ثبت شد'));
});

test('successful mutation and failed refresh are reported separately instead of claiming mutation failure', async () => {
  const ui = mount({ defaultKind: 'customer', customers: [customer({ eligibility: { status: 'approved' } })], onAction: async () => ({ ok: true }), onRefresh: async () => ({ ok: false }) });
  await ui.button('۲. صدور کد یکتا').props.onClick(); ui.render();
  assert.ok(ui.content().includes('صدور کد یکتای مشتری در سرور ثبت شد'));
  assert.ok(ui.content().includes('دریافت فهرست تازه انجام نشد'));
  assert.ok(!ui.content().includes('عملیات ثبت نشد'));
});

test('activating and deactivating is offered for every state and sends the matching action', async () => {
  const calls = [];
  const props = { defaultKind: 'customer', customers: [customer({ eligibility: { status: 'approved' } })], onAction: async (...args) => { calls.push(args); return { ok: true, party: args[0] }; } };
  const ui = mount(props);
  assert.ok(ui.hasButton('غیرفعال کردن'), 'رکورد فعال قابل غیرفعال کردن است');
  await ui.button('غیرفعال کردن').props.onClick();
  assert.deepEqual(calls[0], ['customer', 'c1', 'deactivate', {}]);
  ui.render({ ...props, customers: [customer({ eligibility: { status: 'approved' }, active: false })] });
  assert.ok(ui.content().includes('غیرفعال است: در هیچ فهرست کاری انتخاب نمی‌شود'), 'رکورد غیرفعال توضیح وضعیت دارد');
  assert.ok(ui.hasButton('فعال کردن'), 'رکورد غیرفعال قابل فعال کردن است');
  await ui.button('فعال کردن').props.onClick();
  assert.deepEqual(calls[1], ['customer', 'c1', 'activate', {}]);
});

test('erase is offered only for an uncoded, non-approved record and is a separate action', async () => {
  const calls = [];
  const props = { defaultKind: 'customer', customers: [customer()], onAction: async (...args) => { calls.push(args); return { ok: true, removed: true }; } };
  const ui = mount(props);
  assert.equal(ui.button('حذف از بانک').props.disabled, false, 'رکورد بی‌کد و تأییدنشده قابل حذف کامل است');
  await ui.button('حذف از بانک').props.onClick();
  assert.deepEqual(calls[0], ['customer', 'c1', 'erase', {}]);
  ui.render({ ...props, customers: [customer({ customerCode: 'C-000003', eligibility: { status: 'approved' } })] });
  assert.equal(ui.button('حذف از بانک').props.disabled, true, 'دارای کد حذف نمی‌شود');
  ui.render({ ...props, customers: [customer({ eligibility: { status: 'rejected' } })] });
  assert.equal(ui.button('حذف از بانک').props.disabled, false, 'ردشدهٔ بی‌کد قابل حذف است');
});

test('the same panel drives suppliers through the S code cycle', async () => {
  const calls = [];
  const props = { defaultKind: 'supplier', customers: [], suppliers: [supplier()], onAction: async (...args) => { calls.push(args); return { ok: true }; } };
  const ui = mount(props);
  assert.ok(ui.content().includes('کاغذ فروشی مرکزی'));
  assert.ok(ui.content().includes('کد تامین‌کننده'));
  ui.reason('محل عرضه و تحویل بررسی شد');
  await ui.button('۱. تأیید تامین‌کننده').props.onClick(); ui.render();
  assert.deepEqual(calls[0], ['supplier', 's1', 'approve', { reason: 'محل عرضه و تحویل بررسی شد' }]);
  ui.render({ ...props, suppliers: [supplier({ eligibility: { status: 'approved' } })] });
  await ui.button('۲. صدور کد یکتا').props.onClick();
  assert.deepEqual(calls[1], ['supplier', 's1', 'issue_number', {}]);
});

test('tabs switch the bank without losing the search, and status chips reveal the hidden records', () => {
  const props = {
    defaultKind: 'customer',
    customers: [customer(), customer({ id: 'c2', name: 'رضا رضایی', customerCode: 'C-000002', phone: '09876543210', eligibility: { status: 'approved' } }), customer({ id: 'c3', name: 'مشتری غیرفعال', phone: '09350000000', eligibility: { status: 'approved' }, active: false })],
    suppliers: [supplier({ id: 's9', name: 'تأمین‌کنندهٔ کاری', supplierCode: 'S-000001', eligibility: { status: 'approved' } })],
    onAction: async () => ({ ok: true }),
  };
  const ui = mount(props);
  const search = ui.nodes().find(node => node.type === 'input' && node.props.type === 'search');
  search.props.onChange({ target: { value: '0912345' } }); ui.render();
  assert.equal(ui.nodes().filter(node => node.type === 'article').length, 1);
  assert.ok(ui.content().includes('علی کیانی'));
  search.props.onChange({ target: { value: '' } }); ui.render();
  ui.nodes().find(node => node.type === 'select').props.onChange({ target: { value: 'approved' } }); ui.render();
  assert.equal(ui.nodes().filter(node => node.type === 'article').length, 1);
  assert.ok(ui.content().includes('C-000002'));
  ui.nodes().find(node => node.type === 'select').props.onChange({ target: { value: 'inactive:approved' } }); ui.render();
  assert.ok(ui.content().includes('مشتری غیرفعال'), 'چیپ وضعیت، رکورد غیرفعال را نشان می‌دهد');
  ui.nodes().find(node => node.type === 'select').props.onChange({ target: { value: 'all' } }); ui.render();
  assert.equal(ui.nodes().filter(node => node.type === 'article').length, 3, 'هیچ رکوردی از بانک پاک نمی‌شود');
  assert.ok(ui.content().includes('بانک کامل ۳ رکورد دارد'));
  ui.button('تامین‌کنندهها').props.onClick(); ui.render();
  assert.ok(ui.content().includes('تأمین‌کنندهٔ کاری'));
  assert.ok(ui.content().includes('S-000001'));
});

test('guidance states the new order and never advertises the code as a password', () => {
  const html = renderToStaticMarkup(React.createElement(Component, { defaultKind: 'customer', customers: [customer()], onAction: async () => ({ ok: true }) }));
  assert.ok(html.includes('کد یکتا فقط پس از تأیید صادر می‌شود'));
  assert.ok(html.includes('شناسه است و رمز ورود محسوب نمی‌شود'));
  assert.ok(html.includes('بخش «کاربران»'));
});
