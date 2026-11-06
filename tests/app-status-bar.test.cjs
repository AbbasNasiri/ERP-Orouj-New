'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const React = require('react');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;

function compiled() {
  return esbuild.buildSync({ entryPoints: [path.join(root, 'src/AppStatusBar.jsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom', 'react/jsx-runtime'], loader: { '.css': 'empty' } }).outputFiles[0].text;
}
function load(overrides = {}) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(overrides), compiled())(
    id => id === 'react' && overrides.hooks ? overrides.hooks : id === 'react-dom' ? { createPortal: node => node } : require(id),
    module, module.exports, ...Object.values(overrides));
  return module.exports;
}

test('Persian date follows Tehran midnight and month/year boundaries rather than UTC or machine timezone', () => {
  const { tehranDateKey, formatPersianDate, tehranMinuteKey, formatTehranClock, nextTehranMidnightDelay } = load();
  const before = Date.parse('2026-10-22T20:29:59.900Z');
  assert.equal(tehranDateKey(before), '2026-10-22');
  assert.equal(tehranDateKey(before + 100), '2026-10-23');
  assert.equal(tehranMinuteKey(before), '23:59');
  assert.equal(tehranMinuteKey(before + 100), '00:00');
  assert.equal(formatTehranClock(before), '۲۳:۵۹:۵۹');
  assert.equal(formatTehranClock(before + 100), '۰۰:۰۰:۰۰');
  assert.match(formatPersianDate(before), /۱۴۰۵/);
  assert.match(formatPersianDate(before), /۳۰ مهر/);
  assert.match(formatPersianDate(before + 100), /۱ آبان/);
  assert.equal(nextTehranMidnightDelay(before), 125);
  const newYear = Date.parse('2026-12-31T20:29:59.999Z');
  assert.equal(tehranDateKey(newYear + 1), '2027-01-01');
  assert.equal(nextTehranMidnightDelay(newYear), 26);
  assert.ok(nextTehranMidnightDelay(before + 125) > 23 * 60 * 60 * 1000, 'the next timer advances to the following local midnight');
});

test('midnight refresh and the minute clock reschedule independently, and cleanup removes timers and wake listeners', () => {
  let now = Date.parse('2026-10-22T20:29:59.900Z'), cursor = 0, timerId = 0;
  const state = [], effects = [], cleanups = [], timers = new Map(), documentEvents = new Map(), windowEvents = new Map();
  class Clock extends Date { static now() { return now; } }
  const hooks = { ...React,
    useId: () => `status-id-${cursor++}`,
    useRef: current => ({ current }),
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = value; }]; },
    useEffect(effect, deps) { const index = cursor++; if (!state[index] || deps.some((value, i) => !Object.is(value, state[index][i]))) { state[index] = deps; effects.push(effect); } },
  };
  const document = { visibilityState: 'visible', body: {}, addEventListener: (name, callback) => documentEvents.set(name, callback), removeEventListener: name => documentEvents.delete(name) };
  const window = { addEventListener: (name, callback) => windowEvents.set(name, callback), removeEventListener: name => windowEvents.delete(name) };
  const { default: Component } = load({ hooks, Date: Clock, document, window,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id) });
  function render() { cursor = 0; const tree = Component({ user: { name: 'نام آزمایشی' } }); effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); return tree; }
  function fire(id) { const entry = timers.get(id); timers.delete(id); entry.callback(); }
  render();
  assert.equal(timers.size, 2, 'the footer arms one midnight timer and one minute timer');
  const armed = [...timers.values()];
  assert.equal(armed[0].delay, 125, 'the date timer wakes at Tehran midnight');
  assert.equal(armed[1].delay, 100, 'the clock timer wakes at the next minute');
  now += 100; fire(2); render();
  assert.equal(state[1], now, 'the clock shows the fresh minute');
  assert.equal(timers.size, 2, 'the minute tick replaces its own timer');
  assert.ok([...timers.values()][1].delay <= 60000);
  now += 25; fire(1); render();
  assert.equal(state[0], now, 'the displayed date receives the fresh local-day timestamp');
  assert.ok([...timers.values()].find(timer => timer.delay > 23 * 60 * 60 * 1000), 'the next date timer advances to the following local midnight');
  now += 24 * 60 * 60 * 1000;
  documentEvents.get('visibilitychange')(); render();
  assert.equal(state[0], now, 'resuming a sleeping window catches up');
  assert.equal(windowEvents.has('focus'), true);
  cleanups.forEach(cleanup => cleanup());
  assert.equal(timers.size, 0);
  assert.equal(documentEvents.size, 0);
  assert.equal(windowEvents.size, 0);
});

test('real React footer contains approved credits and a version/date/second clock cluster', { timeout: 60000 }, () => {
  const work = path.resolve(root, '../.work'); fs.mkdirSync(work, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(work, 'status-bar-test-'));
  const bundle = esbuild.buildSync({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import AppStatusBar from './src/AppStatusBar.jsx';const root=createRoot(document.getElementById('app'));window.mountStatusBar=()=>flushSync(()=>root.render(<AppStatusBar user={{name:'کاربر آزمایشی'}}/>));window.unmountStatusBar=()=>flushSync(()=>root.unmount());`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' } }).outputFiles[0].text;
  const css = fs.readFileSync(path.join(root, 'src/app-status-bar.css'), 'utf8');
  const browserCase = async () => {
    const check = (value, message) => { if (!value) throw new Error(message); };
    window.mountStatusBar();
    const footer = document.querySelector('footer');
    const [date, clock] = footer.querySelectorAll('time');
    check(!footer.textContent.includes('کاربر آزمایشی'), 'User name still repeats in the status bar');
    check(!footer.querySelector('button') && !footer.textContent.includes('درباره'), 'The about entry still repeats in the status bar (UI-07)');
    check(footer.children.length === 2, 'The footer must hold exactly version, date and clock: ' + [...footer.children].map(node => node.textContent).join('|'));
    check(date.dateTime.length === 10 && /[۰-۹]/.test(date.textContent), 'Persian date metadata missing');
    check(/^([01]\d|2[0-3]):[0-5]\d$/.test(clock.dateTime), 'Clock metadata is not a 24-hour Tehran minute');
    const tehranMinute = offset => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + offset));
    check([0, 60000, -60000].some(offset => clock.dateTime === tehranMinute(offset)), 'Clock is not the current Tehran minute');
    check(/[۰-۹]{2}:[۰-۹]{2}/.test(clock.textContent), 'Persian clock digits missing');
    check(footer.querySelector('.app-credits').textContent.includes('عباس نصیری'), 'Manager credit missing');
    check(footer.querySelector('.app-credits').textContent.includes('asn.nasiri@hotmail.com'), 'Contact missing');
    check(footer.querySelector('.app-status-values').contains(clock), 'Clock must share the version/date cluster');
    check(/[۰-۹]{2}:[۰-۹]{2}:[۰-۹]{2}/.test(clock.textContent), 'Clock must show seconds');
    check(getComputedStyle(footer).direction === 'rtl' && getComputedStyle(footer).flexShrink === '0', 'Footer must preserve RTL and avoid shrinking');
    const result = { version: footer.querySelector('.app-status-values bdi').textContent, date: date.textContent, dateTime: date.dateTime };
    window.unmountStatusBar();
    check(!document.querySelector('footer'), 'Unmount failed');
    return result;
  };
  const script = `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(fixture, 'user-data'))});app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta charset="utf-8"><style>'+${JSON.stringify(css)}+'</style><div id="app"></div>'));await win.webContents.executeJavaScript(${JSON.stringify(bundle)});const result=await win.webContents.executeJavaScript('('+${JSON.stringify(browserCase.toString())}+')()');console.log('STATUS_BAR_RESULT:'+JSON.stringify(result));app.exit(0);}catch(error){console.error(error.stack);app.exit(1);}});`;
  const runner = path.join(fixture, 'runner.cjs'); fs.writeFileSync(runner, script);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(require('electron'), [runner], { env, encoding: 'utf8', windowsHide: true, timeout: 50000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(run.status, 0, `${run.error || ''}\n${run.stderr}\n${run.stdout}`);
  const result = JSON.parse(run.stdout.split('STATUS_BAR_RESULT:')[1].split('\n')[0]);
  assert.equal(result.version, version, 'the UI must import the current package version');
});

test('the about desk is a standalone destination that carries the credits and the current version', () => {
  const bundle = esbuild.buildSync({ entryPoints: [path.join(root, 'src/AboutDesk.jsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } }).outputFiles[0].text;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle)(require, module, module.exports);
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(module.exports.default));
  assert.ok(html.includes('عباس نصیری'), 'The author credit is missing');
  assert.ok(['apGPt', 'Claude', 'Qoder'].every(name => html.includes(name)), 'A tool credit changed spelling');
  assert.ok(html.includes('href="mailto:asn.nasiri@hotmail.com"'), 'The contact address changed');
  assert.ok(html.includes(version), 'The desk must show the current package version');
  assert.ok(!/role="dialog"|aria-modal/.test(html), 'The about desk must be a page, not a modal');
});
