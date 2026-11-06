'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const source = fs.readFileSync(path.resolve(__dirname, '../src/App.jsx'), 'utf8');
const start = source.indexOf('function UsersManager(');
const end = source.indexOf('function FormsList(', start);
assert.ok(start >= 0 && end > start, 'Real UsersManager boundaries are present');
const hash = source.slice(source.indexOf('function hashPass('), source.indexOf('const DEFAULT_ADMIN'));
const normalize = source.match(/^const normUser = .*;$/m)?.[0];
assert.ok(normalize, 'Real username normalizer exists');
// Only presentation wrappers, icons and uid are stubs. UsersManager handlers,
// eligibility filtering, password hashing and username normalization come from App.
const compiled = esbuild.transformSync(`
const { useState, useRef, Fragment, createElement } = require('react');
const COLORS = {}, inputStyle = {}, ROLE_NOTES = {};
const STAFF_ROLES = ['مدیر چاپخانه', 'کارشناس سفارشات', 'مدیر مالی'];
let nextId = 0; const uid = () => 'test-user-' + (++nextId);
const Plus = () => null, Save = Plus, Trash2 = Plus;
const Field = ({label, children}) => createElement('label', null, createElement('span', null, label), children);
const TextInput = props => createElement('input', props);
const Select = ({options, ...props}) => createElement('select', props, options.map(value => createElement('option', {key:value, value}, value)));
const PrimaryButton = ({icon, children, ...props}) => createElement('button', props, children);
const GhostButton = PrimaryButton;
const IconButton = ({icon, ...props}) => createElement('button', props);
const SectionTitle = ({children}) => createElement('h2', null, children);
const Badge = ({text}) => createElement('span', null, text);
${hash}
${normalize}
${source.slice(start, end)}
module.exports = UsersManager;`, { loader: 'jsx', format: 'cjs', jsx: 'automatic' }).code;

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
function flatten(node, found = []) {
  if (node == null || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach(child => flatten(child, found)); return found; }
  if (typeof node.type === 'function') return flatten(node.type(node.props), found);
  found.push(node); flatten(node.props?.children, found); return found;
}
const manager = { id: 'admin', name: 'مدیر', username: 'admin', role: 'مدیر چاپخانه', active: true };
function mount(props) {
  const values = []; let cursor = 0, tree;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'confirm', compiled)(name => name === 'react' ? hooks : require(name), module, module.exports, () => true);
  const Component = module.exports;
  const api = {
    render(next = props) { props = next; cursor = 0; tree = Component(props); return tree; },
    nodes: () => flatten(tree), content: () => text(flatten(tree)),
    field(label) {
      const group = api.nodes().find(node => node.type === 'label' && text(node.props.children[0]) === label);
      assert.ok(group, `Field ${label}`);
      return flatten(group).find(node => ['input', 'select'].includes(node.type));
    },
    change(label, value) { api.field(label).props.onChange({ target: { value } }); api.render(); },
    button(label) { const button = api.nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(button, `Button ${label}`); return button; },
  };
  api.render(); return api;
}
function fill(ui) { ui.change('نام و نام‌خانوادگی', 'کاربر نمونه'); ui.change('نام کاربری', 'new-user'); ui.change('رمز عبور', 'test-password'); }
function props(onSave, extra = {}) { return { users: [manager], currentUser: manager, onSave, ...extra }; }

test('failed add save never announces success or clears the actual entered form', async () => {
  const calls = [];
  const ui = mount(props(async users => { calls.push(users); return { ok: false, error: 'ذخیره در پایگاه انجام نشد' }; }));
  fill(ui); await ui.button('افزودن کاربر').props.onClick(); ui.render();
  assert.equal(calls.length, 1);
  assert.equal(ui.field('نام کاربری').props.value, 'new-user');
  assert.equal(ui.field('رمز عبور').props.value, 'test-password');
  assert.ok(ui.content().includes('ذخیره در پایگاه انجام نشد'));
  assert.equal(ui.content().includes('تغییرات کاربران ثبت شد'), false);
  assert.equal(ui.button('افزودن کاربر').props.disabled, false);
});

test('failed password save preserves reset editor and password; thrown failure also stays an error', async () => {
  const ui = mount(props(async () => { throw new Error('Disconnected'); }));
  ui.button('تغییر رمز').props.onClick(); ui.render();
  let field = ui.nodes().find(node => node.type === 'input' && node.props.placeholder === 'رمز جدید');
  field.props.onChange({ target: { value: 'retained-password' } }); ui.render();
  await ui.button('ذخیره رمز').props.onClick(); ui.render();
  field = ui.nodes().find(node => node.type === 'input' && node.props.placeholder === 'رمز جدید');
  assert.ok(field); assert.equal(field.props.value, 'retained-password');
  assert.ok(ui.content().includes('ذخیره انجام نشد'));
  assert.equal(ui.content().includes('تغییرات کاربران ثبت شد'), false);
});

test('customer dropdown contains only approved coded customers and refuses forged selection', async () => {
  let calls = 0;
  const customers = [
    { id: 'yes', name: 'مجاز', customerCode: 'C1', eligibility: { status: 'approved' } },
    { id: 'pending', name: 'منتظر', customerCode: 'C2', eligibility: { status: 'pending' } },
    { id: 'no-code', name: 'بدون کد', customerCode: '', eligibility: { status: 'approved' } },
    { id: 'rejected', name: 'رد شده', customerCode: 'C3', eligibility: { status: 'rejected' } },
  ];
  const ui = mount(props(async () => { calls++; return { ok: true }; }, { customers }));
  fill(ui); ui.change('نقش', 'مشتری');
  const options = flatten(ui.field('مشتری تأییدشده *')).filter(node => node.type === 'option');
  assert.deepEqual(options.map(node => node.props.value), ['', 'yes']);
  ui.change('مشتری تأییدشده *', 'pending');
  await ui.button('افزودن کاربر').props.onClick(); ui.render();
  assert.equal(calls, 0);
  assert.ok(ui.content().includes('تأیید صلاحیت'));
});

test('pending save uses a synchronous duplicate guard and clears form only after success', async () => {
  let resolve, calls = 0;
  const waiting = new Promise(done => { resolve = done; });
  const ui = mount(props(() => { calls++; return waiting; }));
  fill(ui);
  const button = ui.button('افزودن کاربر');
  const first = button.props.onClick(); const second = button.props.onClick();
  await second; ui.render();
  assert.equal(calls, 1);
  assert.equal(ui.button('در حال ذخیره…').props.disabled, true);
  assert.equal(ui.field('نام کاربری').props.value, 'new-user');
  resolve({ ok: true }); await first; ui.render();
  assert.equal(ui.field('نام کاربری').props.value, '');
  assert.equal(ui.field('رمز عبور').props.value, '');
  assert.ok(ui.content().includes('تغییرات کاربران ثبت شد'));
});

/* بند ت: هر میز نشانی دارد که در همین فهرست تعیین می‌شود و همراه همان حساب ذخیره می‌شود. */
test('the station typed for a new account is trimmed and saved with that account', async () => {
  const calls = [];
  const ui = mount(props(async users => { calls.push(users); return { ok: true }; }));
  fill(ui); ui.change('نام ایستگاه', '  مالی  ');
  await ui.button('افزودن کاربر').props.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].at(-1).station, 'مالی');
});

test('editing a row station saves only when the value really changed', async () => {
  const calls = [];
  const user = { ...manager, station: 'مالی' };
  const ui = mount({ users: [user], currentUser: user, onSave: async users => { calls.push(users); return { ok: true }; } });
  const cell = () => ui.nodes().find(node => node.type === 'input' && node.props['aria-label'] === `نام ایستگاه ${manager.name}`);
  cell().props.onBlur({ target: { value: '  مالی ' } });
  await new Promise(done => setTimeout(done, 0));
  assert.equal(calls.length, 0, 'نام دست‌نخورده نباید نوشتن بی‌دلیل بفرستد');
  cell().props.onBlur({ target: { value: ' لیتوگرافی ' } });
  await new Promise(done => setTimeout(done, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].station, 'لیتوگرافی');
});

test('a customer account has no station cell, and the add form hides that field for customers', () => {
  const customer = { id: 'c-user', name: 'مشتری نمونه', username: 'cust', role: 'مشتری', customerId: 'yes', active: true };
  const customers = [{ id: 'yes', name: 'مجاز', customerCode: 'C1', eligibility: { status: 'approved' } }];
  const ui = mount({ users: [manager, customer], currentUser: manager, onSave: async () => ({ ok: true }), customers });
  assert.equal(ui.nodes().filter(node => node.type === 'input' && node.props['aria-label'] === `نام ایستگاه ${customer.name}`).length, 0, 'حساب مشتری نباید فیلد ایستگاه داشته باشد');
  ui.change('نقش', 'مشتری');
  assert.equal(ui.nodes().some(node => node.type === 'label' && text(node.props.children[0]) === 'نام ایستگاه'), false, 'فرم مشتری نباید نام ایستگاه بخواهد');
});
