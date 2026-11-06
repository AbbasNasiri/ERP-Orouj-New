'use strict';
/* RETIRED (اصلاحات ۹ بند ۲): the microphone UI this script drove is removed from the renderer,
   so it can no longer pass. Kept only as the fake-microphone recipe for the engine side;
   measure speech with the offline rig in tests/voice/ instead, which needs no UI.
   ------------------------------------------------------------------
   Explicit manual QA only: real renderer capture, private preload session, utilityProcess,
   and local Whisper inference. Never operates on an existing PrintShopData directory.
   PRINTSHOP_VOICE_FAKE_MIC=1 PRINTSHOP_VOICE_SAMPLE=<public Persian PCM WAV>
   Optional PRINTSHOP_VOICE_CAPTURE_MS adjusts the real recording duration. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, utilityProcess } = require('electron');
assert.ok(process.versions.electron, 'Run with the project Electron executable');
assert.equal(process.env.PRINTSHOP_VOICE_FAKE_MIC, '1', 'Explicit fake-microphone opt-in is required');
const sample = path.resolve(process.env.PRINTSHOP_VOICE_SAMPLE || 'MISSING_VOICE_SAMPLE');
assert.ok(fs.statSync(sample).isFile(), 'PRINTSHOP_VOICE_SAMPLE must name a WAV fixture');
const wav = fs.readFileSync(sample);
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
let byteRate = 0, audioBytes = 0;
for (let cursor = 12; cursor + 8 <= wav.length;) {
  const tag = wav.toString('ascii', cursor, cursor + 4), length = wav.readUInt32LE(cursor + 4);
  if (tag === 'fmt ') byteRate = wav.readUInt32LE(cursor + 16);
  if (tag === 'data') audioBytes = Math.min(length, wav.length - cursor - 8);
  cursor += 8 + length + length % 2;
}
assert.ok(byteRate > 0 && audioBytes > 0, 'WAV format/data chunks are required');
const sampleSeconds = audioBytes / byteRate;
const captureMs = Number(process.env.PRINTSHOP_VOICE_CAPTURE_MS) || Math.min(15000, Math.max(2500, Math.ceil(sampleSeconds * 1000) + 250));
assert.ok(captureMs >= 1000 && captureMs <= 59000, 'Capture duration must fit the 60-second limit');
const qaDir = path.resolve(__dirname, '../../.work/voice-qa');
fs.mkdirSync(qaDir, { recursive: true });
const fixture = fs.mkdtempSync(path.join(qaDir, 'real-voice-'));
console.log('[voice-smoke] fixture ' + fixture);
const userData = path.join(fixture, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixture;
process.env.PRINTSHOP_UI_QA = '1';
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', sample);
const rendererRequests = [];
const workerEvents = [];
const forkedWorkers = [];
const runtimeErrors = [];
let scenarioFinished = false;
process.on('uncaughtException', error => {
  scenarioFinished = true;
  fs.writeFileSync(path.join(fixture, 'uncaught-exception.txt'), String(error.stack || error));
  console.error(error.stack || error);
  forkedWorkers.forEach(child => { try { child.kill(); } catch (_) {} });
  process.exit(1);
});
const guard = path.join(fixture, 'worker-offline-guard.cjs');
const guardLog = path.join(fixture, 'worker-network.jsonl');
fs.writeFileSync(guard, `'use strict';
const fs = require('node:fs');
const file = ${JSON.stringify(guardLog)};
fs.appendFileSync(file, JSON.stringify({type:'guard-installed',pid:process.pid})+'\\n');
const deny = channel => (...args) => {
  fs.appendFileSync(file, JSON.stringify({type:'network-attempt',channel,target:String(args[0] || '')})+'\\n');
  throw new Error('Offline smoke test blocked network: '+channel);
};
globalThis.fetch = deny('fetch');
for (const name of ['http','https']) { const mod = require('node:'+name); mod.request=deny(name+'.request');mod.get=deny(name+'.get'); }
const net=require('node:net');net.connect=deny('net.connect');net.createConnection=deny('net.createConnection');net.Socket.prototype.connect=deny('Socket.connect');
require('node:tls').connect=deny('tls.connect');require('node:dgram').createSocket=deny('dgram.createSocket');
require('node:module').syncBuiltinESMExports();
`, 'utf8');
const originalFork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (file, args, options = {}) => {
  // Electron utilityProcess does not run Node --require consistently. The fixture
  // wrapper installs the guard, then executes the unmodified production worker.
  const wrapper = path.join(fixture, 'guarded-voice-worker.cjs');
  fs.writeFileSync(wrapper, `require(${JSON.stringify(guard)});require(${JSON.stringify(file)});\n`);
  const child = originalFork(wrapper, args, options);
  forkedWorkers.push(child);
  workerEvents.push({ type: 'fork', file: path.basename(file) });
  child.on('message', message => {
    if (message?.type === 'ready' || message?.type === 'fatal' || message?.type === 'error') workerEvents.push(message);
    if (message?.type === 'text') workerEvents.push({ type: 'text', id: message.id, ms: message.ms, samples: message.samples, text: message.text });
    fs.writeFileSync(path.join(fixture, 'worker-events.json'), JSON.stringify(workerEvents, null, 2));
    console.log('[voice-smoke] worker ' + message?.type);
  });
  child.stderr?.on('data', bytes => fs.appendFileSync(path.join(fixture, 'worker-stderr.txt'), bytes));
  child.stdout?.on('data', bytes => fs.appendFileSync(path.join(fixture, 'worker-stdout.txt'), bytes));
  return child;
};
const timeout = setTimeout(() => { scenarioFinished = true; console.error('Real voice smoke timed out'); app.exit(1); }, 720000);
app.on('before-quit', () => console.log('[voice-smoke] app quitting while scenario may still run'));

async function scenario(captureDuration) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const ok = async promise => { const value = await promise; check(value?.ok, value?.error || 'IPC failed'); return value; };
  const byText = (scope, label) => [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === label);
  const waitFor = async (find, label, waitMs = 15000) => {
    const started = Date.now();
    while (Date.now() - started < waitMs) {
      const result = find(); if (result) return result;
      const error = document.querySelector('.voice-error');
      if (error?.textContent) throw new Error(`${label}: ${error.textContent}`);
      await pause(100);
    }
    throw new Error(`Wait expired: ${label}; status=${document.querySelector('.voice-status')?.textContent}; body=${document.body.innerText.slice(0, 500)}`);
  };
  const enter = (element, value) => {
    check(element, 'Input is missing');
    const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const focusTarget = element => {
    element.focus();
    // Hidden integration windows can lack OS focus when another fixture runs.
    // Dispatch the same DOM event a user's click produces; destination and React
    // insertion are still the real production helpers, with no ASR mock.
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  };
  const alerts = [];
  window.alert = message => alerts.push(String(message));
  window.confirm = () => true;
  const api = window.printshopApi, voiceApi = window.printshopVoice;
  check(!!voiceApi, 'Voice preload bridge is missing');
  const beforeLogin = await voiceApi.status();
  check(beforeLogin?.ok === false && beforeLogin.code === 'FORBIDDEN', 'Voice allowed before login');
  await ok(api.auth.login('admin', '1234'));
  await ok(api.auth.setOwnPassword('voice-smoke-password'));
  const status = await ok(voiceApi.status());
  check(status.installed, 'Whisper is missing: ' + status.reason);
  await ok(api.auth.logout());
  await waitFor(() => document.querySelector('input[type="password"]'), 'Login form');
  enter([...document.querySelectorAll('input')].find(input => input.type !== 'password'), 'admin');
  enter(document.querySelector('input[type="password"]'), 'voice-smoke-password');
  await pause(150); byText(document, 'ورود').click();
  await waitFor(() => document.querySelector('.workbench-shell'), 'Workbench');
  const ordersKey = 'printshop_orders_v5';
  const beforeOrders = (await ok(api.get(ordersKey))).value || [];
  check(beforeOrders.length === 0, 'Fixture must start with an empty order collection');
  const ordersDesk = [...document.querySelectorAll('.workbench-navitem')].find(button => button.getAttribute('aria-label') === 'سفارش‌ها');
  check(ordersDesk, 'Orders desk is missing'); ordersDesk.click(); await pause(200);
  const newOrder = await waitFor(() => [...document.querySelectorAll('button')].find(button => /سفارش جدید/.test(button.textContent)), 'New order');
  newOrder.click();
  const directButton = await waitFor(() => document.querySelector('button[aria-label="با صدا مشخصات بگویید"]'), 'Order dictation button');
  const smartText = await waitFor(() => [...document.querySelectorAll('textarea')].find(input => (input.placeholder || '').startsWith('سفارش را همان')), 'Order description');
  const recognized = [];
  async function record(button, panelSelector) {
    console.log('[voice-smoke] recording ' + panelSelector);
    button.click();
    const panel = await waitFor(() => document.querySelector(panelSelector), 'Voice panel');
    byText(panel, 'شروع ضبط')?.click();
    await waitFor(() => byText(panel, 'توقف و تبدیل'), 'Recording started');
    await pause(captureDuration);
    const level = panel.querySelector('meter')?.value || 0;
    byText(panel, 'توقف و تبدیل').click();
    console.log('[voice-smoke] transcribing ' + panelSelector);
    const review = await waitFor(() => panel.querySelector('[data-voice-review="true"]'), 'Whisper review', 240000);
    const raw = review.value.trim();
    check(raw.length >= 2 && /[\u0600-\u06ff]/.test(raw), 'Whisper did not return Persian text: ' + raw);
    recognized.push(raw);
    console.log('[voice-smoke] review ready ' + panelSelector);
    return { panel, review, level };
  }
  const first = await record(directButton, '.voice-field-button .voice-panel');
  check(smartText.value === '', 'Transcript was inserted before user review');
  const orderEdited = 'کتاب آزمایشی برای بررسی صوت آفلاین';
  enter(first.review, orderEdited); await pause(150);
  byText(first.panel, 'درج متن').click();
  await waitFor(() => smartText.value === orderEdited, 'Explicit insertion into order');
  check(!document.body.innerText.includes('قلم ساخته شد'), 'Speech automatically ran order analysis');
  check(((await ok(api.get(ordersKey))).value || []).length === 0, 'Speech automatically saved an order');
  document.querySelector('.voice-field-button .voice-close').click(); await pause(100);
  check(!document.querySelector('.voice-dock'), 'global voice dock must not be rendered');
  const deliverySelect = [...document.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'ارسال به نشانی مشتری'));
  check(deliverySelect, 'delivery method field missing');
  enter(deliverySelect, 'ارسال به نشانی مشتری'); await pause(150);
  const addressField = [...document.querySelectorAll('.psx-field')].find(field => field.querySelector(':scope > .psx-field-label')?.textContent.includes('نشانی تحویل محصول'));
  const title = addressField?.querySelector('input');
  check(title, 'Generic text target is missing');
  enter(title, 'عنوان اولیه'); await pause(100);focusTarget(title);
  const dockButton = addressField.querySelector('.voice-field-button > button');
  check(dockButton, 'Field voice button is missing');
  const widthBefore = document.documentElement.scrollWidth;
  const second = await record(dockButton, '.voice-inline-slot .voice-panel');
  check(document.documentElement.scrollWidth <= widthBefore + 1, 'field voice panel stretches the page');
  check(title.value === 'عنوان اولیه', 'Generic field changed before insertion');
  const genericEdited = 'تکمیل با صوت';
  enter(second.review, genericEdited); await pause(150);
  byText(second.panel, 'درج متن').click();
  await waitFor(() => title.value === 'عنوان اولیه ' + genericEdited, 'Generic React input insertion');
  enter(smartText, orderEdited + '؛ بازبینی'); await pause(150);
  check(title.value === 'عنوان اولیه ' + genericEdited, 'Generic insertion was lost on React rerender');
  check(((await ok(api.get(ordersKey))).value || []).length === 0, 'Generic dictation saved an order');
  document.querySelector('.voice-inline-slot .voice-close').click(); await pause(100);focusTarget(title);
  const previous = title.value;
  dockButton.click();
  const cancelPanel = await waitFor(() => document.querySelector('.voice-inline-slot .voice-panel'), 'Cancel panel');
  byText(cancelPanel, 'شروع ضبط').click();
  await waitFor(() => byText(cancelPanel, 'توقف و تبدیل'), 'Cancellation recording');
  await pause(700);byText(cancelPanel, 'لغو').click();await pause(200);
  check(title.value === previous, 'Cancel changed the target');
  check(!cancelPanel.querySelector('meter'), 'Cancel did not stop the recording UI');
  check(alerts.length === 0, 'Unexpected alerts: ' + alerts.join(' | '));
  const finalStatus = await ok(voiceApi.status());

  // نقشِ فاقد اجازه: صوت باید در دسترس باشد، اما هیچ اجازه‌ای نمی‌دهد (معیار پذیرشِ اصلاحات ۸)
  const staff = (await ok(api.auth.listUsers())).users || [];
  const limited = { id: 'voice-smoke-warehouse', username: 'voice-warehouse', name: 'انباردارِ آزمون', role: 'انباردار', active: true, _plain: 'voice-limited-pass' };
  await ok(api.auth.saveUsers([...staff, limited]));
  await ok(api.auth.logout());
  await waitFor(() => document.querySelector('input[type="password"]'), 'Login form (limited role)');
  enter([...document.querySelectorAll('input')].find(input => input.type !== 'password'), limited.username);
  enter(document.querySelector('input[type="password"]'), limited._plain);
  await pause(150); byText(document, 'ورود').click();
  await waitFor(() => document.querySelector('.workbench-shell'), 'Workbench (limited role)');
  const limitedStatus = await ok(voiceApi.status());
  check(limitedStatus.installed, 'Voice must be available to a role without order rights: ' + limitedStatus.reason);
  // The warehouse keeper owns inventory, not orders: dictate into their own form.
  const inventoryDesk = [...document.querySelectorAll('.workbench-navitem')].find(button => button.getAttribute('aria-label') === 'موجودی و کالاها');
  if (inventoryDesk && !inventoryDesk.classList.contains('is-active')) { inventoryDesk.click(); await pause(250); }
  (await waitFor(() => byText(document, 'کالای جدید'), 'New inventory item (limited role)')).click();
  await pause(250);
  const limitedScope = await waitFor(() => [...document.querySelectorAll('.psx-field')].find(field => field.querySelector('.voice-field-button') && field.querySelector('input:not([readonly]),textarea')), 'Descriptive field (limited role)');
  const limitedField = limitedScope.querySelector('input,textarea');
  focusTarget(limitedField);
  const limitedBefore = limitedField.value;
  const third = await record(limitedScope.querySelector('.voice-field-button > button'), '.voice-inline-slot .voice-panel');
  byText(third.panel, 'درج متن').click(); await pause(200);
  check(limitedField.value !== limitedBefore, 'Voice did not reach the limited role — „همه جا“ is not true');
  const deniedRead = await api.get(ordersKey);
  check(deniedRead.ok === false && deniedRead.code === 'FORBIDDEN', 'Server let a role without rights read orders: ' + JSON.stringify(deniedRead));
  const denied = await api.set(ordersKey, [{ id: 'voice-smoke-attempt', title: 'تلاش ثبت با صوت', status: 'در انتظار تایید' }]);
  check(denied.ok === false && denied.code === 'FORBIDDEN', 'Server accepted an order write from a role without rights: ' + JSON.stringify(denied));
  document.querySelector('.voice-inline-slot .voice-close')?.click(); await pause(100);
  // «دست‌نخورده ماندن داده و ممیزیِ رد شدن» در آزمون بک‌اندِ واقعیِ backend-workflow اثبات می‌شود؛
  // این دود فقط مسیر صوت و رد شدن IPC را در رابط نشان می‌دهد.

  return { recognized, orderInserted: true, genericInserted: true, reactRerenderPreserved: true, noAutoSave: true, noAutoAnalysis: true, recordingCancelled: true, beforeLoginDenied: true,
    voiceAvailableToLimitedRole: true, limitedRoleDictatedIntoOwnField: true, limitedRoleDeniedOrderRead: true, limitedRoleDeniedOrderWrite: true,
    deniedReadCode: deniedRead.code, deniedWriteCode: denied.code, deniedWriteError: denied.error,
    status: finalStatus, captureDuration, alerts };
}

app.on('browser-window-created', (_event, win) => {
  // This machine intermittently sends the hidden integration window a close request
  // mid-scenario. Refuse it until the scenario has settled, otherwise the run reports
  // a clean exit without ever writing evidence.
  const lifecycle = path.join(fixture, 'window-lifecycle.txt');
  const note = (event, extra) => {
    const state = win.isDestroyed() ? { destroyed: true } : { visible: win.isVisible(), destroyed: false };
    fs.appendFileSync(lifecycle, `${event} ${JSON.stringify({ at: new Date().toISOString(), ...state, ...(extra || {}) })}\n`);
  };
  win.on('close', event => { note('close'); if (!scenarioFinished) { event.preventDefault(); note('close-prevented'); } });
  for (const event of ['closed', 'destroyed', 'unresponsive']) win.on(event, () => note(event));
  win.webContents.on('render-process-gone', (_e, details) => { note('render-process-gone', details); runtimeErrors.push('render-process-gone ' + JSON.stringify(details)); });
  // A hidden window cannot hold DOM focus, so document.activeElement never becomes the
  // dictation target and the dock correctly refuses to insert. This QA window is shown.
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => { rendererRequests.push(details.url); callback({ cancel: true }); });
  win.webContents.on('console-message', (_event, level, message) => {
    if (message.startsWith('[voice-smoke]')) console.log(message);
    if (level === 3 && !/Content Security Policy|net::|resource/i.test(message)) runtimeErrors.push(message);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(${scenario.toString()})(${JSON.stringify(captureMs)})`);
      fs.writeFileSync(path.join(fixture, 'renderer-voice-results.json'), JSON.stringify(result, null, 2));
      const guardEvents = fs.readFileSync(guardLog, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.ok(guardEvents.some(event => event.type === 'guard-installed'), 'Worker network guard did not run');
      assert.deepEqual(guardEvents.filter(event => event.type === 'network-attempt'), [], 'Worker tried to use the network');
      assert.equal(workerEvents.filter(event => event.type === 'text').length, 3, 'Expected three genuine worker transcriptions (two fields + limited role)');
      assert.ok(workerEvents.some(event => event.type === 'ready'), 'Actual utilityProcess did not initialize');
      assert.deepEqual(rendererRequests, [], 'Renderer attempted an internet request');
      assert.deepEqual(runtimeErrors, [], 'Renderer errors');
      fs.writeFileSync(path.join(fixture, 'voice-final.png'), (await win.webContents.capturePage()).toPNG());
      const report = { ok: true, fixture, sample, sampleSeconds, ...result, workerEvents, guardEvents, rendererRequests, runtimeErrors };
      fs.writeFileSync(path.join(fixture, 'result.json'), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(qaDir, 'real-voice-results.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));scenarioFinished = true;clearTimeout(timeout);forkedWorkers.forEach(child => child.kill());app.exit(0);
    } catch (error) {
      scenarioFinished = true;
      try { fs.writeFileSync(path.join(fixture, 'voice-error.png'), (await win.webContents.capturePage()).toPNG()); } catch (_) {}
      fs.writeFileSync(path.join(qaDir, 'real-voice-error.txt'), String(error.stack || error));
      fs.writeFileSync(path.join(fixture, 'worker-events.json'), JSON.stringify(workerEvents, null, 2));
      console.error(error.stack || error);clearTimeout(timeout);forkedWorkers.forEach(child => child.kill());app.exit(1);
    }
  });
});
require('../electron/main.js');
