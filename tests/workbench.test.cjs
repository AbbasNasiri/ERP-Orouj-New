'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.work', 'workbench-tests');
fs.mkdirSync(fixtureDir, { recursive: true });
const compiled = esbuild.buildSync({ entryPoints: [path.join(root, 'src', 'Workbench.jsx')], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } }).outputFiles[0].text;
const fixture = path.join(fixtureDir, 'Workbench.cjs');
fs.writeFileSync(fixture, compiled);
const { workbenchReducer, WorkbenchShell, DeskTabs } = require(fixture);
const items = [{ id: 'orders', label: 'سفارشات', group: 'work' }, { id: 'finance', label: 'مالی', group: 'finance' }, { id: 'stock', label: 'موجودی', group: 'inventory' }, { id: 'settings', label: 'تنظیمات', group: 'management' }];
const allowedIds = items.map(item => item.id);

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.props?.children);
}
function nodes(node, list = []) {
  if (!node || typeof node !== 'object') return list;
  if (Array.isArray(node)) { node.forEach(child => nodes(child, list)); return list; }
  list.push(node); nodes(node.props?.children, list); return list;
}

// Expand the actual components with deterministic hooks and focusable host refs.
// Keyboard handlers and callbacks are the production functions, not simulations.
function mount(name, props) {
  let slots = [], cursor = 0, tree, focused;
  const effects = [];
  const hooks = {
    ...React,
    isValidElement: React.isValidElement,
    useId() { const i = cursor++; if (!(i in slots)) slots[i] = `test-${i}`; return slots[i]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(effect) { effects.push(effect); },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === 'react' ? hooks : require(name), module, module.exports);
  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    const expanded = { ...node, props: { ...node.props, children: expand(node.props?.children) } };
    if (typeof node.ref === 'function') node.ref({ focus: () => { focused = node.props.id; } });
    return expanded;
  }
  const api = {
    render(next = props) { props = next; cursor = 0; effects.length = 0; tree = expand(module.exports[name](props)); return tree; },
    runEffects() { const cleanups = effects.map(effect => effect()); effects.length = 0; return cleanups.filter(fn => typeof fn === 'function'); },
    nodes: () => nodes(tree),
    tabs: () => nodes(tree).filter(node => node.props?.role === 'tab'),
    tab(label) { const tab = api.tabs().find(node => text(node) === label); assert.ok(tab, label); return tab; },
    key(label, key) { let prevented = false; api.tab(label).props.onKeyDown({ key, preventDefault: () => { prevented = true; } }); return prevented; },
    focused: () => focused,
  };
  api.render(); return api;
}

test('opening tabs deduplicates and closing never loses the last allowed work surface', () => {
  let state = { openIds: ['orders'], activeId: 'orders' };
  state = workbenchReducer(state, { type: 'open', id: 'finance', allowedIds });
  state = workbenchReducer(state, { type: 'open', id: 'finance', allowedIds });
  assert.deepEqual(state, { openIds: ['orders', 'finance'], activeId: 'finance' });
  state = workbenchReducer(state, { type: 'close', id: 'finance', allowedIds });
  state = workbenchReducer(state, { type: 'close', id: 'orders', allowedIds });
  assert.deepEqual(state, { openIds: ['orders'], activeId: 'orders' });
});

test('role reset removes forbidden tabs and unknown opens cannot reintroduce them', () => {
  const original = { openIds: ['finance', 'orders', 'orders', 'settings'], activeId: 'finance' };
  const cleaned = workbenchReducer(original, { type: 'reset', allowedIds: ['orders', 'stock'] });
  assert.deepEqual(cleaned, { openIds: ['orders'], activeId: 'orders' });
  assert.deepEqual(workbenchReducer(cleaned, { type: 'open', id: 'finance', allowedIds: ['orders', 'stock'] }), cleaned);
  assert.deepEqual(workbenchReducer(cleaned, { type: 'reset', allowedIds: [] }), { openIds: [], activeId: '' });
  assert.deepEqual(original.openIds, ['finance', 'orders', 'orders', 'settings']);
});

test('closing the active middle tab selects its neighbour while closing an inactive tab keeps the current one', () => {
  const state = { openIds: ['orders', 'finance', 'stock'], activeId: 'finance' };
  assert.deepEqual(workbenchReducer(state, { type: 'close', id: 'finance', allowedIds }), { openIds: ['orders', 'stock'], activeId: 'stock' });
  assert.deepEqual(workbenchReducer(state, { type: 'close', id: 'orders', allowedIds }), { openIds: ['finance', 'stock'], activeId: 'finance' });
});

test('a sub-tab opens directly under its parent tab and never duplicates a destination', () => {
  const parentOf = { 'finance-quote': 'finance', 'finance-invoice': 'finance' };
  const ids = ['orders', 'finance', 'finance-quote', 'finance-invoice'];
  let state = { openIds: ['orders'], activeId: 'orders' };
  state = workbenchReducer(state, { type: 'open', id: 'finance', allowedIds: ids, parentOf });
  state = workbenchReducer(state, { type: 'open', id: 'finance-invoice', allowedIds: ids, parentOf });
  assert.deepEqual(state.openIds, ['orders', 'finance', 'finance-invoice'], 'a sub-tab belongs next to its parent, not at the end of the strip');
  state = workbenchReducer(state, { type: 'open', id: 'finance-quote', allowedIds: ids, parentOf });
  assert.deepEqual(state.openIds, ['orders', 'finance', 'finance-invoice', 'finance-quote'], 'a second sub-tab joins the siblings after the parent');
  state = workbenchReducer(state, { type: 'open', id: 'finance-quote', allowedIds: ids, parentOf });
  assert.deepEqual(state, { openIds: ['orders', 'finance', 'finance-invoice', 'finance-quote'], activeId: 'finance-quote' }, 'reopening a destination must not build a second tab');
  const orphan = workbenchReducer({ openIds: ['orders'], activeId: 'orders' }, { type: 'open', id: 'finance-quote', allowedIds: ids, parentOf });
  assert.deepEqual(orphan.openIds, ['orders', 'finance-quote'], 'without an open parent the order stays a plain append');
  const lateParent = workbenchReducer({ openIds: ['orders', 'finance-invoice', 'finance-quote'], activeId: 'finance-quote' }, { type: 'open', id: 'finance', allowedIds: ids, parentOf });
  assert.deepEqual(lateParent, { openIds: ['orders', 'finance', 'finance-invoice', 'finance-quote'], activeId: 'finance' }, 'opening the parent later must pull its sub-tabs under it');
  assert.deepEqual(workbenchReducer({ openIds: ['orders'], activeId: 'orders' }, { type: 'open', id: 'finance-quote', allowedIds: ids }).openIds, ['orders', 'finance-quote'], 'a caller without the parent map cannot break the strip');
});

test('sidebar uses one chevron per parent, hides children on first paint, and keeps open tabs when collapsed', () => {
  const nested = [{ id:'orders', label:'سفارش‌ها',group:'work' },{ id:'finance',label:'مالی',group:'finance' },{id:'finance-quote',label:'پیش‌فاکتورها',group:'finance',parent:'finance'}];
  const opened=[];const ui=mount('WorkbenchShell',{items:nested,openIds:['finance','finance-quote'],activeId:'finance-quote',onOpen:id=>opened.push(id),onClose:()=>{}});
  const toggle=()=>ui.nodes().find(n=>n.props?.className==='workbench-navdisclose');
  const branch=()=>ui.nodes().find(n=>n.props?.role==='group');
  assert.equal(branch().props.hidden,true); assert.equal(toggle().props['aria-expanded'],false);
  assert.equal(ui.nodes().filter(n=>n.props?.className==='workbench-navtoggle').length,0,'No duplicated group heading');
  toggle().props.onClick();ui.render();assert.equal(branch().props.hidden,false);assert.equal(toggle().props['aria-expanded'],true);
  toggle().props.onClick();ui.render();assert.equal(branch().props.hidden,true);assert.equal(ui.tabs().length,2);assert.deepEqual(opened,[]);
});

test('RTL keyboard navigation activates and focuses adjacent tabs, wraps and supports Home/End', () => {
  const opened = [];
  const ui = mount('WorkbenchShell', { items, openIds: ['orders', 'finance', 'stock'], activeId: 'orders', onOpen: id => opened.push(id), onClose: () => {} });
  assert.equal(ui.tabs().filter(tab => tab.props.tabIndex === 0).length, 1);
  assert.equal(ui.key('سفارشات', 'ArrowLeft'), true);
  assert.equal(opened.at(-1), 'finance');
  assert.equal(ui.focused(), ui.tab('مالی').props.id);
  ui.key('سفارشات', 'ArrowRight'); assert.equal(opened.at(-1), 'stock');
  ui.key('مالی', 'Home'); assert.equal(opened.at(-1), 'orders');
  ui.key('مالی', 'End'); assert.equal(opened.at(-1), 'stock');
  assert.equal(ui.key('مالی', 'a'), false);
});

test('Delete closes via the parent callback, moves focus and preserves the final tab', () => {
  const closed = [];
  const props = { items, openIds: ['orders', 'finance', 'stock'], activeId: 'finance', onOpen: () => {}, onClose: id => closed.push(id) };
  const ui = mount('WorkbenchShell', props);
  assert.equal(ui.key('مالی', 'Delete'), true);
  assert.deepEqual(closed, ['finance']);
  assert.equal(ui.focused(), ui.tab('موجودی').props.id);
  ui.render({ ...props, openIds: ['orders'], activeId: 'orders' });
  ui.key('سفارشات', 'Delete'); assert.deepEqual(closed, ['finance']);
  assert.equal(ui.nodes().find(node => node.props?.['aria-label'] === 'بستن تب سفارشات').props.disabled, true);
});

test('all tabs control a stable existing panel and navigation never replaces the parent-owned child content', () => {
  const content = React.createElement('div', { id: 'cached-forms' }, 'پیش‌نویس حفظ می‌شود');
  const props = { items, openIds: ['orders', 'finance'], activeId: 'orders', onOpen: () => {}, onClose: () => {}, children: content };
  const ui = mount('WorkbenchShell', props);
  const panel = ui.nodes().find(node => node.props?.role === 'tabpanel');
  assert.ok(ui.tabs().every(tab => tab.props['aria-controls'] === panel.props.id));
  assert.equal(panel.props['aria-labelledby'], ui.tab('سفارشات').props.id);
  ui.render({ ...props, activeId: 'finance' });
  const next = ui.nodes().find(node => node.props?.role === 'tabpanel');
  assert.equal(next.props.id, panel.props.id);
  assert.equal(next.key, panel.key);
  assert.equal(next.props['aria-labelledby'], ui.tab('مالی').props.id);
  assert.ok(ui.nodes().some(node => node.props?.id === 'cached-forms'));
});

test('DeskTabs uses the same controlled RTL keyboard pattern without closing subforms', () => {
  const changes = [];
  const ui = mount('DeskTabs', { id: 'finance', items: [{ id: 'quote', label: 'پیش‌فاکتور' }, { id: 'payments', label: 'پرداخت‌ها' }], value: 'quote', onChange: id => changes.push(id), children: React.createElement('div', null, 'فرم مالی') });
  ui.key('پیش‌فاکتور', 'ArrowLeft');
  assert.deepEqual(changes, ['payments']);
  assert.equal(ui.focused(), ui.tab('پرداخت‌ها').props.id);
  assert.equal(ui.key('پیش‌فاکتور', 'Delete'), false);
  assert.equal(ui.nodes().filter(node => node.props?.['aria-label']?.startsWith('بستن تب')).length, 0);
});

test('the footer keyhint is honest: arrows and Delete work from the workspace without focusing a tab', () => {
  const opened = [], closed = [], focusTargets = [], listeners = new Set();
  const props = { items, openIds: ['orders', 'finance', 'stock'], activeId: 'orders', onOpen: id => opened.push(id), onClose: id => closed.push(id) };
  const ui = mount('WorkbenchShell', props);
  const body = { tagName: 'BODY' };
  const inTree = (...selectors) => ({ tagName: 'DIV', closest: selector => (selectors.includes(selector) ? { selector } : null) });
  const workspace = inTree('.workbench-workspace');
  const dialog = inTree('.workbench-workspace', '[role="dialog"], [aria-modal="true"]');
  const tabButton = inTree('.workbench-workspace', '[role="tab"]');
  const sidebarItem = inTree('.workbench-sidebar');
  const textField = { tagName: 'TEXTAREA', closest: () => null };
  const fakeDocument = {
    body,
    addEventListener: (type, effect) => { if (type === 'keydown') listeners.add(effect); },
    removeEventListener: (type, effect) => listeners.delete(effect),
    getElementById: id => ({ focus: () => focusTargets.push(id) }),
  };
  const realDocument = globalThis.document;
  globalThis.document = fakeDocument;
  try {
    let cleanups = ui.runEffects();
    assert.equal(listeners.size, 1, 'the workspace should subscribe exactly one key handler');
    assert.equal(cleanups.length, 1);

    assert.equal(press(workspace, 'ArrowLeft'), true, 'ArrowLeft should be handled from the workspace');
    assert.deepEqual(opened, ['finance']);
    assert.deepEqual(focusTargets, [ui.tab('مالی').props.id], 'the moved-to tab should receive focus by its real id');

    assert.equal(press(body, 'ArrowRight'), true);
    assert.equal(opened.at(-1), 'stock', 'RTL order wraps from the first tab to the last');

    assert.equal(press(workspace, 'Delete'), true);
    assert.deepEqual(closed, ['orders'], 'Delete closes the active tab through the parent callback');

    // Negative controls: keys that belong to something else must be left untouched.
    assert.equal(press(textField, 'ArrowLeft'), false, 'typing direction keys must not move workbench tabs');
    assert.equal(press(tabButton, 'ArrowLeft'), false, 'a focused tab keeps its own handler');
    assert.equal(press(dialog, 'ArrowLeft'), false, 'an open dialog must not be tabbed away underneath');
    assert.equal(press(sidebarItem, 'ArrowLeft'), false, 'the sidebar is not the workspace');
    assert.equal(press(workspace, 'Home'), false, 'Home/End stay tab-scoped so page scrolling is not stolen');
    assert.equal(press(workspace, 'ArrowLeft', { ctrlKey: true }), false, 'browser shortcuts must not be hijacked');
    assert.deepEqual(opened, ['finance', 'stock']);
    assert.equal(focusTargets.length, 2);

    // One open tab: nothing to move or close.
    cleanups.forEach(fn => fn());
    assert.equal(listeners.size, 0, 'unmount must remove the key handler');
    ui.render({ ...props, openIds: ['orders'], activeId: 'orders' });
    cleanups = ui.runEffects();
    assert.equal(press(workspace, 'ArrowLeft'), false);
    assert.equal(press(workspace, 'Delete'), false, 'the last open tab is never closed by a keypress');
    assert.deepEqual(closed, ['orders']);
    cleanups.forEach(fn => fn());
  } finally {
    globalThis.document = realDocument;
  }

  function press(target, key, mods = {}) {
    let prevented = false;
    const event = { key, target, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: () => { prevented = true; }, ...mods };
    listeners.forEach(effect => effect(event));
    return prevented;
  }
});

test('the active user opens the right column and logout closes it at the bottom', () => {
  const html = renderToStaticMarkup(React.createElement(WorkbenchShell, { items, openIds: ['orders'], activeId: 'orders', userLabel: 'مدیر چاپخانه', userRole: 'مالک چاپخانه', children: 'محتوا' }));
  const sidebar = html.slice(html.indexOf('workbench-sidebar"'), html.indexOf('workbench-workspace'));
  assert.ok(sidebar.indexOf('workbench-user') >= 0 && sidebar.indexOf('workbench-user') < sidebar.indexOf('workbench-navigation'), 'the user block must sit above the navigation');
  assert.ok(sidebar.indexOf('workbench-navigation') < sidebar.indexOf('workbench-logout'), 'logout must sit below the navigation');
  assert.ok(/class="workbench-user-avatar"[^>]*>م</.test(sidebar), 'the circular avatar carries the initial');
  assert.ok(sidebar.includes('مدیر چاپخانه') && sidebar.includes('مالک چاپخانه'), 'name and role both show in the column');
  assert.ok(!sidebar.includes('سامانه چاپ و نشر') && !sidebar.includes('workbench-brand'), 'the workbench title no longer repeats in the sidebar');
  assert.equal((html.match(/class="workbench-logout"/g) || []).length, 1, 'the shell must not offer logout twice');
});

test('the sidebar logout calls the parent handler and never logs out without one', () => {
  const clicks = [];
  const ui = mount('WorkbenchShell', { items, openIds: ['orders'], activeId: 'orders', userLabel: 'مدیر چاپخانه', onLogout: () => clicks.push('logout') });
  const button = ui.nodes().find(node => node.props?.className === 'workbench-logout');
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.deepEqual(clicks, ['logout']);
  const withoutHandler = mount('WorkbenchShell', { items, openIds: ['orders'], activeId: 'orders', userLabel: 'مدیر چاپخانه' });
  assert.equal(withoutHandler.nodes().find(node => node.props?.className === 'workbench-logout').props.disabled, true, 'a logout with nothing to call is inert, not a dead button');
});

test('the sidebar slider preserves tabs and exposes an accessible toggle', () => {
 const ui=mount('WorkbenchShell',{items,openIds:['orders','finance'],activeId:'finance',onOpen:()=>{},onClose:()=>{}});
 const toggle=()=>ui.nodes().find(n=>n.props?.['data-sidebar-toggle']);
 assert.equal(toggle().props['aria-expanded'],true);toggle().props.onClick();ui.render();
 assert.equal(toggle().props['aria-expanded'],false);assert.equal(ui.tabs().length,2);
 toggle().props.onClick();ui.render();assert.equal(toggle().props['aria-expanded'],true);
});

test('server rendering exposes permitted groups and unique tabs with no nested buttons', () => {
  const html = renderToStaticMarkup(React.createElement(WorkbenchShell, { items, openIds: ['orders', 'orders', 'finance', 'forbidden'], activeId: 'orders', userLabel: 'مدیر چاپخانه', children: 'محتوا' }));
  assert.equal((html.match(/role="tab"/g) || []).length, 2);
  assert.ok(html.includes('کارتابل چاپخانه'));
  assert.ok(html.includes('مدیر چاپخانه'));
  for (const label of ['کارها', 'مالی', 'انبار', 'مدیریت']) assert.ok(html.includes(label));
  assert.ok(!html.includes('forbidden'));
  assert.ok(!/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(html));
});

/* بند ت: کنار نام کاربر، نام ایستگاه و وضعیت اتصال — یک خط کوتاه، نه برچسب اضافه. */
test('the sidebar names the station and the live server link state', () => {
  const base = { items, openIds: ['orders'], activeId: 'orders', userLabel: 'اپراتور', userRole: 'مدیر مالی' };
  const stationOf = ui => ui.nodes().find(node => node.props?.className === 'sidebar-station');
  const dotOf = ui => ui.nodes().find(node => node.props?.className === 'sidebar-link-dot');
  const ui = mount('WorkbenchShell', { ...base, station: 'مالی', link: 'up', server: 'http://192.168.1.20:7788' });
  assert.match(text(stationOf(ui)), /ایستگاه مالی/);
  assert.match(text(stationOf(ui)), /وصل به سرور/);
  assert.equal(stationOf(ui).props.title, 'سرور: http://192.168.1.20:7788');
  assert.equal(dotOf(ui).props['data-link'], 'up');
  ui.render({ ...base, station: 'مالی', link: 'down', server: 'http://192.168.1.20:7788' });
  assert.match(text(stationOf(ui)), /سرور قطع است/);
  assert.equal(dotOf(ui).props['data-link'], 'down');
  ui.render({ ...base, link: 'local' });
  assert.match(text(stationOf(ui)), /بانک روی همین کامپیوتر/);
  assert.equal(dotOf(ui).props['data-link'], 'local');
  ui.render(base);
  assert.equal(stationOf(ui), undefined, 'بدون ایستگاه و بدون اتصال، خط تازه‌ای به ستون کناری اضافه نمی‌شود');
});
