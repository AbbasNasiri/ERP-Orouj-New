'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compiled = esbuild.buildSync({ entryPoints: [path.resolve(__dirname, '../src/CustomerRequestForm.jsx')],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' } }).outputFiles[0].text;
function component(requireReact = require('react')) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === 'react' ? requireReact : require(name), module, module.exports);
  return module.exports.default;
}
const approved = { id: 'c1', customerCode: 'C-1001', mobile: '۰۹۱۲۳۴۵۶۷۸۹', eligibility: { status: 'approved' } };
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
function flatten(node, found = []) {
  if (node == null || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach(child => flatten(child, found)); return found; }
  found.push(node); flatten(node.props?.children, found); return found;
}
function mount(props) {
  const values = [];
  let cursor, effects, changed, tree;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { const value = typeof next === 'function' ? next(values[index]) : next; if (!Object.is(values[index], value)) { values[index] = value; changed = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect, deps) { const index = cursor++; if (!values[index] || deps.some((value, i) => !Object.is(value, values[index][i]))) { values[index] = deps; effects.push(effect); } },
  };
  const Component = component(hooks);
  const api = {
    render(next = props) {
      props = next;
      for (let tries = 0; tries < 20; tries++) {
        cursor = 0; effects = []; changed = false; tree = Component(props); effects.forEach(effect => effect());
        if (!changed) return tree;
      }
      throw new Error('Render did not settle');
    },
    nodes: () => flatten(tree), content: () => text(tree),
    field: name => { const field = api.nodes().find(node => ['input', 'textarea'].includes(node.type) && node.props.name === name); assert.ok(field, name); return field; },
    change(name, value) { api.field(name).props.onChange({ target: { value } }); api.render(); },
    submit() { const form = api.nodes().find(node => node.type === 'form'); assert.ok(form, 'form'); return form.props.onSubmit({ preventDefault() {} }); },
    button(label) { const button = api.nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(button, label); return button; },
  };
  api.render(); return api;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('only approved customer with a code sees form; blocked customer can refresh status', async () => {
  const Component = component();
  for (const customer of [undefined, { ...approved, eligibility: { status: 'pending' } }, { ...approved, customerCode: '' }, { ...approved, eligibility: 'approved' }]) {
    const html = renderToStaticMarkup(React.createElement(Component, { customer }));
    assert.equal(html.includes('<form'), false);
    assert.ok(html.includes('باید تأیید شود'));
  }
  let refreshed = 0;
  const ui = mount({ customer: { ...approved, eligibility: { status: 'pending' } }, onRefresh: async () => { refreshed++; return { ok: true }; } });
  await ui.button('بررسی مجدد وضعیت').props.onClick(); ui.render();
  assert.equal(refreshed, 1);
  assert.equal(ui.nodes().some(node => node.type === 'form'), false);
});

test('required product, positive integer quantity, phone and total length are validated without submitting', async () => {
  let submitted = 0;
  const ui = mount({ customer: approved, onSubmit: async () => { submitted++; return { ok: true }; } });
  await ui.submit(); ui.render(); assert.ok(ui.content().includes('نوع محصول را وارد'));
  ui.change('product', 'کتاب');
  for (const qty of ['', '۰', '-1', '۱٫۵', '1e3', '9007199254740992']) {
    ui.change('quantity', qty); await ui.submit(); ui.render(); assert.ok(ui.content().includes('عدد صحیح مثبت'));
  }
  ui.change('quantity', '۲۰۰۰'); ui.change('phone', ' ');
  await ui.submit(); ui.render(); assert.ok(ui.content().includes('شماره تماس را وارد'));
  assert.equal(ui.field('phone').props.maxLength, 40);
  ui.change('phone', '0'.repeat(41));
  await ui.submit(); ui.render(); assert.ok(ui.content().includes('۴۰ نویسه'));
  ui.change('phone', '09123456789'); ui.change('extra', 'الف'.repeat(2000));
  await ui.submit(); ui.render(); assert.ok(ui.content().includes('۴۰۰۰ نویسه'));
  assert.equal(submitted, 0);
});

test('request composes readable text, normalizes Persian digits and prevents pending duplicate clicks', async () => {
  const waiting = deferred(); const calls = [];
  const ui = mount({ customer: approved, onSubmit: (...args) => { calls.push(args); return waiting.promise; } });
  ui.change('product', 'کتاب'); ui.change('quantity', '۲۰۰۰');
  ui.change('specifications', '۴۰۰ صفحه رحلی، متن دو رنگ'); ui.change('deadline', 'پایان آبان'); ui.change('extra', 'کاغذ را خودمان می‌آوریم');
  const first = ui.submit(); const duplicate = ui.submit(); ui.render();
  await duplicate;
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], '09123456789');
  assert.ok(calls[0][0].includes('محصول: کتاب\nتعداد: 2000'));
  assert.ok(calls[0][0].includes('مشخصات: ۴۰۰ صفحه رحلی، متن دو رنگ'));
  assert.ok(calls[0][0].includes('موعد پیشنهادی: پایان آبان'));
  assert.equal(ui.button('در حال ثبت…').props.disabled, true);
  assert.equal(ui.field('product').props.disabled, true);
  waiting.resolve({ ok: true, orderNumber: 'REQ-42' }); await first; ui.render();
  assert.ok(ui.content().includes('REQ-42'));
  assert.ok(ui.content().includes('C-1001'));
  assert.ok(ui.content().includes('تأیید مشتری و اجازه مدیر'));
  assert.equal(ui.field('product').props.value, '');
});

test('submit rejection preserves entered text and allows retry with backend error message', async () => {
  let attempts = 0;
  const ui = mount({ customer: approved, onSubmit: async () => { attempts++; if (attempts === 1) throw new Error('ارتباط قطع شد'); return { ok: false, error: 'پرونده نیاز به بررسی دارد' }; } });
  ui.change('product', 'بروشور'); ui.change('quantity', '١٠٠');
  await ui.submit(); ui.render();
  assert.ok(ui.content().includes('ارتباط قطع شد'));
  assert.equal(ui.field('product').props.value, 'بروشور');
  assert.equal(ui.button('ثبت درخواست').props.disabled, false);
  await ui.submit(); ui.render();
  assert.ok(ui.content().includes('پرونده نیاز به بررسی دارد'));
  assert.equal(attempts, 2);
});

test('a late response for another customer cannot expose its receipt or erase the new draft', async () => {
  const waiting = deferred();
  const props = { customer: approved, onSubmit: () => waiting.promise };
  const ui = mount(props); ui.change('product', 'کتاب'); ui.change('quantity', '10');
  const request = ui.submit();
  const next = { ...props, customer: { ...approved, id: 'c2', customerCode: 'C-2002' } };
  ui.render(next);
  waiting.resolve({ ok: true, requestNumber: 'PRIVATE-OLD-RECEIPT' }); await request; ui.render(next);
  assert.equal(ui.content().includes('PRIVATE-OLD-RECEIPT'), false);
  assert.equal(ui.field('product').props.value, '');
  assert.ok(ui.content().includes('C-2002'));
});
