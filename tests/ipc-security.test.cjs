'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const electronDir = path.resolve(__dirname, '../electron');
const rendererUrl = pathToFileURL(path.resolve(electronDir, '../dist/index.html')).href;
const MANAGER_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0';
const REAL_TOKEN = '7f3a9c1b5d8e2f406a8b1c3d5e7f90123456789abcde'; // 48 hex: شکل توکن واقعیِ backend

// Run the real entry points in isolated VMs; no Electron/native module, windows,
// filesystem writes, real backup timer or database are started by these tests.
function mainFixture(backendAvailable, overrides = {}, { env = {}, argv = [], clearCalls = true } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const calls = [];
  const windows = [];
  let ready;
  const backend = new Proxy({ dbFile: 'mock.sqlite', ...overrides }, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { calls.push([key, ...args]); return { ok: true }; };
    },
  });
  class WindowMock {
    constructor() {
      this.events = new Map();
      windows.push(this);
      this.webContents = {
        on: (name, handler) => this.events.set(name, handler), once() {}, setWindowOpenHandler() {}, session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
        printToPDF: async (options) => { calls.push(['printToPDF', options]); return Buffer.from('%PDF-1.4 mock'); },
      };
    }
    maximize() {}
    loadFile() {}
    isDestroyed() { return false; }
    static fromWebContents(sender) { return sender.owner; }
    static getAllWindows() { return []; }
  }
  const electron = {
    app: { getPath: () => 'mock-data', whenReady: () => ({ then(fn) { ready = fn; } }), on() {}, quit() { calls.push(['quit']); } },
    BrowserWindow: WindowMock,
    Menu: { setApplicationMenu() {} },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => listeners.set(channel, fn) },
    shell: { showItemInFolder: () => { calls.push(['showItemInFolder']); } },
    dialog: {
      showSaveDialog: async (win, options) => { calls.push(['showSaveDialog', options]); return { canceled: true }; },
      showErrorBox: (title, text) => { calls.push(['showErrorBox', title, text]); },
      showMessageBoxSync: (options) => { calls.push(['showMessageBoxSync', options]); return 0; },
    },
    utilityProcess: { fork: (file, args, options) => { calls.push(['voice-fork', file]); return { postMessage() {}, on() {}, kill() {} }; } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(electronDir, 'main.js'), 'utf8'), {
    __dirname: electronDir, process: { env, argv }, Buffer, URL,
    setInterval: () => ({ unref() {} }),
    require(id) {
      if (id === 'electron') return electron;
      if (id === './backend.js') return { createBackend() {
        if (!backendAvailable) throw new Error('Mock native SQLite unavailable');
        return backend;
      } };
      /* سرور و کلید در این آزمون بالا نمی‌آیند (بدون --server)؛ اگر کسی ناخواسته صدایشان بزند،
         همان لحظه معلوم شود. */
      if (id === './shop-server.js') return {
        parseArgs() { throw new Error('server mode was not requested'); },
        createShopServer() { throw new Error('server mode was not requested'); },
        stationSetup() { throw new Error('server mode was not requested'); },
        lanAddresses: () => [],
      };
      if (id === './lan-crypto.js') return { loadOrCreateKey() { throw new Error('server mode was not requested'); } };
      if (['./channels.js', './client-config.js', './server-client.js'].includes(id)) return require(path.join(electronDir, id));
      if (['path', 'url'].includes(id)) return require(id);
      if (id === './window-close.js') return require(path.join(electronDir, 'window-close.js'));
      if (id === './pdf-export.js') return require(path.join(electronDir, 'pdf-export.js'));
      if (id === './voice-service.js') return require(path.join(electronDir, 'voice-service.js'));
      if (id === './voice-protocol.js') return { ...require(path.join(electronDir, 'voice-protocol.js')), resolveEngineDir: () => ({ dir: path.join(electronDir, '__missing_test_engine__') }) };
      if (id === './voice-permissions.js') return require(path.join(electronDir, 'voice-permissions.js'));
      if (id === './app-lifecycle.js') return require(path.join(electronDir, 'app-lifecycle.js'));
      if (id === 'fs') return { existsSync: () => false, writeFileSync() { throw new Error('Unexpected file write'); } };
      throw new Error(`Unexpected module ${id}`);
    },
  }, { filename: 'main.js' });
  ready();
  if (clearCalls) calls.length = 0; // Startup backup is outside request assertions.
  const frame = { url: rendererUrl };
  const sender = { mainFrame: frame, owner: new WindowMock() };
  const trusted = { sender, senderFrame: frame };
  /* پنجرهٔ آخر فقط «فرستندهٔ ساختگی» است، نه پنجره‌ای که خود برنامه ساخته باشد. */
  return { handlers, listeners, calls, trusted, window: windows[0], mainWindows: windows.slice(0, -1) };
}

function preloadFixture(status, response = () => ({ ok: true })) {
  const calls = [];
  const bridges = {};
  vm.runInNewContext(fs.readFileSync(path.join(electronDir, 'preload.js'), 'utf8'), {
    require(id) {
      assert.equal(id, 'electron');
      return {
        contextBridge: { exposeInMainWorld(name, value) {
          assert.ok(['printshopApi', 'printshopVoice'].includes(name), `unexpected bridge ${name}`);
          bridges[name] = value;
        } },
        ipcRenderer: {
          sendSync(channel) { assert.equal(channel, 'be:status'); return status; },
          invoke(channel, ...args) { calls.push([channel, ...args]); return Promise.resolve().then(() => response(channel, args)); },
          send(channel, ...args) { calls.push([channel, ...args]); },
        },
      };
    },
  }, { filename: 'preload.js' });
  return { api: bridges.printshopApi, voice: bridges.printshopVoice, bridges, calls };
}

test('legacy JSON channels stay disabled whether secure backend starts or fails', async () => {
  for (const available of [false, true]) {
    const fixture = mainFixture(available);
    for (const channel of ['db:get', 'db:set', 'db:del']) {
      const response = await fixture.handlers.get(channel)(fixture.trusted, 'orders', []);
      assert.equal(response.ok, false);
      assert.equal(response.code, 'LEGACY_DISABLED');
    }
    assert.equal(fixture.calls.length, 0);
  }
});

test('trusted requests fail closed with structured error when backend is unavailable', async () => {
  const { handlers, listeners, trusted, calls } = mainFixture(false);
  listeners.get('be:status')(trusted);
  assert.equal(trusted.returnValue.secure, false);
  assert.match(trusted.returnValue.error, /SQLite unavailable/);
  for (const [channel, handler] of handlers) {
    if (!channel.startsWith('be:') && channel !== 'ai:complete') continue;
    const result = await handler(trusted, 'token', 'orders', []);
    assert.equal(result.ok, false, channel);
    assert.equal(result.code, 'BACKEND_UNAVAILABLE', channel);
  }
  assert.equal(calls.length, 0);
});

test('unowned sender, foreign origin and subframes cannot invoke guarded channels', async () => {
  const fixture = mainFixture(true);
  const foreignFrame = { url: 'https://untrusted.invalid/' };
  const foreign = { sender: { mainFrame: foreignFrame, owner: {} }, senderFrame: foreignFrame };
  const unowned = { sender: { mainFrame: fixture.trusted.senderFrame }, senderFrame: fixture.trusted.senderFrame };
  const child = { sender: fixture.trusted.sender, senderFrame: { url: rendererUrl } };
  for (const event of [foreign, unowned, child]) {
    for (const [channel, handler] of fixture.handlers) {
      if (!channel.startsWith('be:') && !['file:save', 'ai:complete', 'pdf:save', 'voice:status', 'voice:transcribe', 'voice:cancel'].includes(channel)) continue;
      const response = await handler(event, 'token', 'orders', []);
      assert.equal(response.ok, false, channel);
      assert.equal(response.code, 'FORBIDDEN', channel);
    }
    assert.equal(await fixture.handlers.get('db:path')(event), null);
    fixture.listeners.get('be:status')(event);
    assert.equal(event.returnValue.secure, false);
  }
  assert.equal(fixture.calls.length, 0);
  const good = await fixture.handlers.get('be:get')(fixture.trusted, REAL_TOKEN, 'orders');
  assert.equal(good.ok, true);
  /* پس از خواندنِ موفق، سرور همین نشست را «دیدهِ» این فهرست می‌شمارد تا تغییر خودش را
     به خودش خبر ندهد؛ این کار داخلی است و همان توکن را می‌گیرد. */
  assert.deepEqual(fixture.calls, [['get', REAL_TOKEN, 'orders'], ['markSeen', REAL_TOKEN, ['orders']]]);
});

test('a malformed session token never reaches the engine, over IPC or over the wire', async () => {
  const fixture = mainFixture(true);
  for (const token of ['', 'short', 'has-dashes-and-symbols', 'x'.repeat(200)]) {
    const r = await fixture.handlers.get('be:get')(fixture.trusted, token, 'orders');
    assert.equal(r.ok, false, token);
    assert.equal(r.code, 'UNAUTHENTICATED', token);
  }
  assert.equal(fixture.calls.length, 0, 'no engine call for a token that cannot be a session');
});

test('pdf:save only renders after a destination is chosen and never for a customer or dead backend', async () => {
  const customer = mainFixture(true, { currentUser: () => ({ ok: true, user: { role: 'مشتری' } }) });
  const denied = await customer.handlers.get('pdf:save')(customer.trusted, REAL_TOKEN, 'A4', 'فاکتور-۱');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'FORBIDDEN');
  assert.equal(customer.calls.length, 0, 'a customer must not open a dialog or render a PDF');

  const offline = mainFixture(false);
  const closed = await offline.handlers.get('pdf:save')(offline.trusted, REAL_TOKEN, 'A4', 'فاکتور-۱');
  assert.equal(closed.ok, false);
  assert.equal(closed.code, 'FORBIDDEN');
  assert.equal(offline.calls.length, 0, 'no dialog and no rendering while the backend is down');

  const staff = mainFixture(true, { currentUser: () => ({ ok: true, user: { role: 'مدیر مالی' } }) });
  /* کنترل منفی: بدون نشست معتبر، حتی دیالوگ ذخیره هم باز نمی‌شود. */
  const noSession = await staff.handlers.get('pdf:save')(staff.trusted, 'token', 'A5', 'فاکتور-۲.pdf');
  assert.equal(noSession.ok, false);
  assert.equal(noSession.code, 'FORBIDDEN');
  assert.equal(staff.calls.length, 0, 'a forged session token must not open a save dialog');
  const cancelled = await staff.handlers.get('pdf:save')(staff.trusted, REAL_TOKEN, 'A5', '../../خروجی-۱.pdf');
  assert.equal(cancelled.canceled, true);
  const dialogCall = staff.calls.find(call => call[0] === 'showSaveDialog');
  assert.ok(dialogCall, 'the save dialog must come before any rendering');
  assert.ok(!staff.calls.some(call => call[0] === 'printToPDF'), 'nothing is rendered when the operator cancels');
  assert.equal(path.basename(dialogCall[1].defaultPath), '.._.._خروجی-۱.pdf', 'separators become inert characters and exactly one .pdf remains');
  assert.equal(dialogCall[1].defaultPath.includes('/'), false, 'no directory part survives into the suggested file name');
});

test('preload exposes blocked startup and still uses only authenticated data channels', async () => {  for (const status of [null, { secure: false, error: 'SQLite failed' }]) {
    const { api, calls } = preloadFixture(status);
    assert.equal(api.secure, false);
    assert.equal(api.mode, 'blocked');
    assert.equal(api.startupError, status?.error || '');
    await api.get('orders');
    await api.set('orders', []);
    await api.del('orders');
    assert.deepEqual(calls, [['be:get', null, 'orders'], ['be:set', null, 'orders', [], undefined], ['be:del', null, 'orders']]);
    assert.equal(calls.some(([channel]) => /^db:(get|set|del)$/.test(channel)), false);
  }
});

test('only a network station is told the server address, a local failure is not', async () => {
  const local = preloadFixture({ secure: false, mode: 'local', error: 'SQLite failed' });
  assert.equal(local.api.serverName, '', 'ایستگاه محلی نباید نشانی سرور داشته باشد');
  assert.equal(local.api.transport, 'local');
  const station = preloadFixture({ secure: false, mode: 'network', server: 'http://192.168.1.10:8443', error: 'سرور پاسخ نداد.' });
  assert.equal(station.api.serverName, 'http://192.168.1.10:8443');
  assert.equal(station.api.startupError, 'سرور پاسخ نداد.');
  const connected = preloadFixture({ secure: true, mode: 'network', server: 'http://192.168.1.10:8443' });
  assert.equal(connected.api.serverName, 'http://192.168.1.10:8443');
  assert.equal(connected.api.transport, 'network');
  assert.equal(station.api.transport, 'network', 'حالت حمل‌ونقل باید حتی وقتی سرور پاسخ نداده «شبکه» بماند');
  assert.equal(preloadFixture(null).api.transport, 'local', 'بدون پاسخ وضعیت، ایستگاه محلی است نه شبکه');
});

test('preload keeps successful login token private and forwards it until logout', async () => {
  const { api, calls } = preloadFixture({ secure: true }, channel => channel === 'be:login'
    ? { ok: true, token: 'secret-session-token', user: { id: 'u1' } } : { ok: true });
  const result = await api.auth.login('user', 'password');
  assert.equal(result.ok, true);
  assert.equal(result.user.id, 'u1');
  assert.equal(Object.hasOwn(result, 'token'), false);
  assert.equal(Object.hasOwn(api, 'token'), false);
  assert.equal(Object.hasOwn(api.auth, 'token'), false);
  await api.get('orders');
  await api.set('orders', []);
  await api.orderAction('o1', 'approve', {});
  await api.customerAction('c1', 'approve', { reason: 'verified' });
  await api.customerProfile();
  await api.customerFinance();
  await api.savePdf('A4', 'فاکتور-۱.pdf');
  await api.auth.logout();
  await api.get('orders');
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [
    ['be:login', 'user'], ['be:get', 'secret-session-token'], ['be:set', 'secret-session-token'],
    ['be:orderAction', 'secret-session-token'], ['be:customerAction', 'secret-session-token'],
    ['be:customerProfile', 'secret-session-token'], ['be:customerFinance', 'secret-session-token'], ['pdf:save', 'secret-session-token'],
    ['be:logout', 'secret-session-token'], ['be:get', null],
  ]);
});

test('preload clears its token even when logout IPC rejects', async () => {
  const { api, calls } = preloadFixture({ secure: true }, channel => {
    if (channel === 'be:login') return { ok: true, token: 'temporary-token', user: {} };
    if (channel === 'be:logout') throw new Error('IPC disconnected');
    return { ok: true };
  });
  await api.auth.login('user', 'password');
  await assert.rejects(api.auth.logout(), /IPC disconnected/);
  await api.get('orders');
  assert.deepEqual(calls.at(-1), ['be:get', null, 'orders']);
});

test('maintenance reset bridge forwards the private session through guarded main handlers and clears it only after success', async () => {
  const payload = { previewToken: 'preview-1', expectedCount: 2, confirmation: 'پاکسازی سفارش‌های آزمایشی', reason: 'پاکسازی داده آزمایشی' };
  const received = [];
  let allowReset = false;
  const main = mainFixture(true, {
    login: () => ({ ok: true, token: MANAGER_TOKEN, user: { role: 'مدیر چاپخانه' } }),
    previewOrderReset: token => { received.push(['preview', token]); return { ok: true, previewToken: 'preview-1', expectedCount: 2 }; },
    resetOrders: (token, request) => {
      received.push(['reset', token, request]);
      return allowReset ? { ok: true, requiresLogin: true, backupFile: 'maintenance-backup.db' } : { ok: false, code: 'RESET_PREVIEW_STALE' };
    },
  });
  const preload = preloadFixture({ secure: true }, (channel, args) => main.handlers.get(channel)(main.trusted, ...args));
  const login = await preload.api.auth.login('admin', 'password');
  assert.equal(Object.hasOwn(login, 'token'), false);
  await preload.api.previewOrderReset();
  assert.equal((await preload.api.resetOrders(payload)).ok, false);
  await preload.api.previewOrderReset();
  assert.equal(received.at(-1)[1], MANAGER_TOKEN, 'a stale preview does not log the manager out');
  allowReset = true;
  assert.equal((await preload.api.resetOrders(payload)).backupFile, 'maintenance-backup.db');
  assert.deepEqual(JSON.parse(JSON.stringify(received[1])), ['reset', MANAGER_TOKEN, payload]);
  await preload.api.get('orders');
  assert.deepEqual(preload.calls.at(-1), ['be:get', null, 'orders']);
  await preload.voice.status();
  assert.equal(preload.calls.at(-1)[1], null, 'reset also clears the token used by voice');
});

test('logout can reload the exact local application but navigation to other files, sites or decorated URLs stays blocked', () => {
  const fixture = mainFixture(true);
  const navigate = fixture.window.events.get('will-navigate');
  assert.equal(typeof navigate, 'function');
  for (const [destination, blocked] of [[rendererUrl, false], ['https://untrusted.invalid/', true], [pathToFileURL(path.resolve(electronDir, '../other.html')).href, true], [rendererUrl + '?untrusted=1', true], [rendererUrl + '#untrusted', true], ['not a URL', true]]) {
    let prevented = false;
    navigate({ preventDefault() { prevented = true; } }, destination);
    assert.equal(prevented, blocked, destination);
  }
});

test('voice channels remain disabled for every role and never start the engine', async () => {
  for (const signedIn of [false,true]) {
    const f=mainFixture(true,{currentUser:()=>({ok:signedIn,user:{role:'مدیر چاپخانه'}})});
    for(const channel of ['voice:status','voice:transcribe','voice:cancel']) {
      const r=await f.handlers.get(channel)(f.trusted,'token',{});assert.equal(r.ok,false);assert.equal(r.code,'FEATURE_DISABLED');
    }
    assert.equal(f.calls.filter(c=>c[0]==='voice-fork').length,0);
  }
});

test('the voice bridge only forwards the session token and cannot write data', async () => {
  const { voice, calls } = preloadFixture({ secure: true }, channel => {
    if (channel === 'be:login') return { ok: true, token: 'voice-token', user: {} };
    return { ok: true, text: 'پنج بند گلاسه' };
  });
  assert.equal(Object.hasOwn(voice, 'token'), false);
  await voice.status();
  await voice.transcribe({ requestId: 'r1', sampleRate: 16000, pcm16Base64: 'AAA' });
  await voice.cancel('r2');
  assert.deepEqual(calls.map(call => call[0]), ['voice:status', 'voice:transcribe', 'voice:cancel']);
  assert.deepEqual(calls.map(call => call[1]), [null, null, null], 'توکن نشست پیش از ورود افزوده می‌شود');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2])), ['voice:cancel', null, { requestId: 'r2' }]);
});

test('--backup writes one manual backup and quits without opening a window', async () => {
  const f = mainFixture(true, {}, { argv: ['--backup'], clearCalls: false });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.mainWindows.length, 0, 'حالت پشتیبان نباید پنجره باز کند');
  const manual = f.calls.filter(([key, , options]) => key === 'backup' && options && options.manual === true);
  assert.equal(manual.length, 1, 'دقیقاً یک پشتیبان دستی گرفته می‌شود: ' + JSON.stringify(f.calls));
  assert.ok(f.calls.some(([key]) => key === 'showMessageBoxSync'), 'نتیجه به کاربر گفته می‌شود');
  assert.ok(f.calls.some(([key]) => key === 'quit'));
});

test('--server refuses to start on a machine that is configured as a station', async () => {
  const { makeKey } = require('../electron/lan-crypto');
  const f = mainFixture(true, {}, {
    env: { PRINTSHOP_SERVER_URL: 'http://127.0.0.1:8443', PRINTSHOP_LAN_KEY: makeKey() },
    argv: ['--server'],
    clearCalls: false,
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.mainWindows.length, 0, 'دو نویسنده روی دو بانک نباید ساخته شود');
  const box = f.calls.find(([key]) => key === 'showErrorBox');
  assert.ok(box, 'کاربر باید دلیل شروع‌نشدن را ببیند: ' + JSON.stringify(f.calls));
  assert.match(box[2], /ایستگاه/);
  assert.ok(f.calls.some(([key]) => key === 'quit'));
  assert.equal(f.calls.some(([key]) => key === 'backup'), false, 'در این حالت هیچ بانکی باز نمی‌شود');
});
