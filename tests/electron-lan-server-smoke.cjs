'use strict';
/* بند الف/۴: سرور + ایستگاه روی همین ماشین، با Electron و SQLite واقعی.
   سرور در یک پروسهٔ جدا بانک را نگه می‌دارد؛ ایستگاه هیچ‌وقت بانک محلی باز نمی‌کند.
   همه‌چیز در .work نوشته می‌شود — بانک زندهٔ کارفرما باز نمی‌شود و چیزی از او تغییر نمی‌کند. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');
assert.ok(process.versions.electron, 'Electron runtime required');

const workDir = path.resolve(__dirname, '../../.work');
const root = path.resolve(__dirname, '..');
const rendererFile = path.resolve(root, 'dist', 'index.html');
const serverScript = path.resolve(root, 'electron', 'shop-server.js');
fs.mkdirSync(workDir, { recursive: true });

const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-lan-smoke-'));
const stationDir = path.join(fixtureDir, 'station');
const serverDataDir = path.join(fixtureDir, 'server', 'PrintShopData');
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(stationDir, { recursive: true });
fs.mkdirSync(serverDataDir, { recursive: true });
fs.mkdirSync(userData, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}
const waitForPort = (port, tries = 200) => new Promise((resolve, reject) => {
  const attempt = left => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => {
      sock.destroy();
      if (left <= 0) return reject(new Error('سرور روی پورت ' + port + ' بالا نیامد.'));
      setTimeout(() => attempt(left - 1), 100);
    });
  };
  attempt(tries);
});
/* همان مسیری که ایستگاه می‌رود (بند ث): پاکت رمزشده، نه درخواست خام. */
let serverCaller = null;
function httpCall(port, channel, token, args) {
  if (!serverCaller) {
    const { createServerClient } = require('../electron/server-client');
    const key = fs.readFileSync(path.join(serverDataDir, 'lan-key.txt'), 'utf8').trim();
    serverCaller = createServerClient({ url: `http://127.0.0.1:${port}`, key });
  }
  return serverCaller.call(channel, token, args);
}

let serverChild = null;
const PASS = 'lan-smoke-strong-password';
const STORE_PASS = 'storekeeper-lan-strong';
const PRELUDE = `
window.__S = {
  api: window.printshopApi,
  CUSTOMERS: 'printshop_customers_v2', ORDERS: 'printshop_orders_v5',
  PASS: '${PASS}', STORE_PASS: '${STORE_PASS}',
  pause: ms => new Promise(r => setTimeout(r, ms)),
  check(value, message) { if (!value) throw new Error(message); },
  async ok(request) { const r = await request; window.__S.check(r && r.ok, (r && (r.error || r.code)) || 'operation failed'); return r; },
  async waitFor(select, label) { for (let i = 0; i < 200; i++) { const v = select(); if (v) return v; await window.__S.pause(50); } throw new Error('wait expired: ' + label); },
  type(element, value) { const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); },
  /* ورود با رمز پیش‌فرض، صفحهٔ «تغییر رمز الزامی است» را هم رد می‌کند. */
  async changePassword(pass) {
    const btn = await this.waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('رمز و ادامه')), 'forced password change');
    const scope = btn.closest('form') || btn.parentElement || document;
    const inputs = [...scope.querySelectorAll('input')];
    this.check(inputs.length >= 2, 'فیلدهای رمز جدید پیدا نشد');
    this.type(inputs[inputs.length - 2], pass);
    this.type(inputs[inputs.length - 1], pass);
    await this.pause(120);
    btn.click();
  },
  async loginAs(user, pass, newPass) {
    const password = await this.waitFor(() => document.querySelector('input[type="password"]'), 'login screen');
    this.type([...document.querySelectorAll('input')].find(i => i.type !== 'password'), user);
    this.type(password, pass);
    await this.pause(80);
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'ورود').click();
    if (newPass) await this.changePassword(newPass);
    await this.waitFor(() => document.querySelector('.workbench-shell'), 'workbench after ' + user);
  },
  async openDesk(label) { const node = [...document.querySelectorAll('.workbench-navitem')]
    .find(n => (n.getAttribute('aria-label') || n.textContent.trim()) === label);
    this.check(node, 'میز "' + label + '" پیدا نشد'); node.click(); await this.pause(260); },
}; 'lan-prelude-ready';`;

(async () => {
  const port = await freePort();
  const serverLog = [];
  const child = spawn(process.execPath, [serverScript, '--data=' + serverDataDir, '--port=' + port], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverChild = child;
  child.stdout.on('data', d => serverLog.push(String(d).trim()));
  child.stderr.on('data', d => serverLog.push('ERR ' + String(d).trim()));
  await waitForPort(port);
  const lanKey = fs.readFileSync(path.join(serverDataDir, 'lan-key.txt'), 'utf8').trim();

  /* ایستگاه: همان برنامه، فقط به سرور وصل است. */
  app.setPath('userData', userData);
  process.env.PORTABLE_EXECUTABLE_DIR = stationDir;
  process.env.PRINTSHOP_SERVER_URL = 'http://127.0.0.1:' + port;
  process.env.PRINTSHOP_LAN_KEY = lanKey;

  const shots = [];
  let secondWindow = null;
  const capture = async (win, name) => {
    const file = path.join(workDir, name);
    fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  const run = async (win, source) => {
    const marker = source.replace(/\s+/g, ' ').slice(0, 60);
    const result = await win.webContents.executeJavaScript(`(async () => { try { return await (${source}); } catch (e) { return { __smokeError: String((e && e.stack) || e) }; } })()`, true);
    if (result && result.__smokeError) throw new Error(result.__smokeError + '\n  in phase: ' + marker);
    return result;
  };

  let stationWindow = null;
  app.on('browser-window-created', (_event, win) => {
    /* فقط پنجرهٔ اصلیِ برنامه راهنمایی می‌شود؛ پنجرهٔ ایستگاه دوم را خودمان می‌سازیم. */
    if (stationWindow) return;
    stationWindow = win;
    win.show();
    win.setBounds({ x: 0, y: 0, width: 1500, height: 950 });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer console: ' + message); });
    win.webContents.once('did-finish-load', async () => {
      try {
        await win.webContents.executeJavaScript(PRELUDE, true);
        /* ۱) ایستگاه بدون بانک محلی بالا آمده و به سرور وصل است. */
        const boot = await run(win, `(async () => ({ secure: window.printshopApi.secure, mode: window.printshopApi.mode,
          serverName: window.printshopApi.serverName, dataPath: await window.printshopApi.dataPath() }))()`);
        assert.equal(boot.secure, true, 'ایستگاه به سرور وصل نشد: ' + JSON.stringify(boot));
        assert.match(String(boot.dataPath), /^http:\/\/127\.0\.0\.1:\d+\/?$/, 'نشانی بانک برای ایستگاه باید نشانی سرور باشد: ' + boot.dataPath);
        assert.equal(String(boot.serverName).replace(/\/$/, ''), String(boot.dataPath).replace(/\/$/, ''), 'ایستگاه نشانی سرور را به رابط نمی‌دهد: ' + JSON.stringify(boot));
        /* عکسِ پیش از نقاشیِ صفحه، کاغذ سفید می‌دهد؛ پس اول صحنهٔ ورود را می‌بینیم. */
        await run(win, `(async () => window.__S.waitFor(() => document.querySelector('input[type="password"]'), 'login screen'))()`);
        await capture(win, 'lan-1-station-connected-login.png');

        /* ۲) مدیر از راه شبکه وارد می‌شود، حساب انباردار را می‌سازد و مشتری ثبت می‌کند. */
        const managerWork = await run(win, `(async () => {
          const S = window.__S;
          await S.loginAs('admin', '1234', S.PASS);
          const users = (await S.ok(S.api.auth.listUsers())).users;
          users.push({ id: 'store', username: 'store', name: 'انباردار شعبه', role: 'انباردار', active: true, _plain: S.STORE_PASS });
          await S.ok(S.api.auth.saveUsers(users));
          /* بند ب: نوشتن از راه شبکه بردار نسخهٔ خوانده‌شده را می‌خواهد. */
          const bank = await S.ok(S.api.get(S.CUSTOMERS));
          await S.ok(S.api.set(S.CUSTOMERS, [
            { id: 'lan1', name: 'مشتری ثبت‌شده از ایستگاه', entityType: 'حقیقی', phone: '09121110001', address: 'تبریز', customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 },
          ], bank.revs));
          const ordersOverNetwork = await S.api.get(S.ORDERS);
          await S.openDesk('مشتریان');
          return { page: document.querySelector('.workbench-page:not([hidden])')?.innerText.slice(0, 200) || '',
            customers: (await S.ok(S.api.get(S.CUSTOMERS))).value.map(c => c.name),
            ordersVisible: ordersOverNetwork.ok };
        })()`);
        assert.deepEqual(managerWork.customers, ['مشتری ثبت‌شده از ایستگاه']);
        await capture(win, 'lan-2-station-manager-customers.png');

        /* ۳) ایستگاه دوم با حساب خودش: همان بانک، دسترسی کوچک‌تر. */
        secondWindow = new BrowserWindow({ show: true, width: 1200, height: 800, webPreferences: {
          preload: path.resolve(root, 'electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        } });
        secondWindow.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer console B: ' + message); });
        await secondWindow.loadURL(pathToFileURL(rendererFile).href);
        await secondWindow.webContents.executeJavaScript(PRELUDE, true);
        const stationTwo = await run(secondWindow, `(async () => {
          const S = window.__S;
          await S.loginAs('store', S.STORE_PASS);
          const names = document.querySelectorAll('.workbench-navitem');
          const orders = await S.api.get(S.ORDERS);
          const desks = [...names].map(n => (n.getAttribute('aria-label') || n.textContent.trim()));
          /* انباردار میز مشتری‌ها را در فهرست خود ندارد؛ همان رکورد را از راه بانک می‌خواند
             و نخستین میزِ مجاز خودش را باز می‌کند تا عکس، دسترسی واقعی را نشان دهد. */
          const openable = ['موجودی و کالاها', 'داشبورد', 'نامه‌ها'].find(label => desks.includes(label));
          if (openable) await S.openDesk(openable);
          return { desks, opened: openable || '', ordersCode: orders.code || 'ok',
            customers: (await S.ok(S.api.get(S.CUSTOMERS))).value.map(c => c.name) };
        })()`);
        assert.deepEqual(stationTwo.customers, ['مشتری ثبت‌شده از ایستگاه'], 'ایستگاه دوم رکورد ایستگاه اول را نمی‌بیند');
        assert.equal(stationTwo.ordersCode, 'ok', 'انباردار از راه شبکه نتوانست سفارش‌ها را برای تابلو بخواند');
        secondWindow.setBounds({ x: 0, y: 0, width: 1500, height: 950 });
        await capture(secondWindow, 'lan-3-station-storekeeper.png');

        /* ۴) بانکِ سرور همان جایی است که نوشته شده، و ایستگاه هیچ بانک محلی نساخته است. */
        const loginOnServer = await httpCall(port, 'be:login', '', ['admin', PASS]);
        const onServerBank = await httpCall(port, 'be:get', loginOnServer.token, ['printshop_customers_v2']);
        assert.equal(onServerBank.ok, true);
        assert.equal(onServerBank.value[0].name, 'مشتری ثبت‌شده از ایستگاه');
        const localBankFiles = fs.readdirSync(stationDir, { recursive: true }).filter(f => /\.db(-wal|-shm)?$/.test(String(f)));
        assert.deepEqual(localBankFiles, [], 'ایستگاه بانک محلی ساخت: ' + localBankFiles.join(','));

        /* ۵) کنترل منفی: سرور خاموش می‌شود — ایستگاه باید بایستد، نه اینکه با بانک خودش ادامه دهد. */
        await new Promise(resolve => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 4000); });
        const whileDown = await run(win, `(async () => {
          const S = window.__S;
          const r = await S.api.get(S.CUSTOMERS);
          await window.__S.pause(120);
          return { ok: r.ok, code: r.code, error: r.error, valueIsArray: Array.isArray(r.value) };
        })()`);
        assert.equal(whileDown.ok, false);
        assert.equal(whileDown.code, 'SERVER_UNREACHABLE');
        assert.equal(whileDown.valueIsArray, false, 'پاسخ سرور خاموش نباید فهرست خالی باشد');
        const reloaded = new Promise(resolve => secondWindow.webContents.once('did-finish-load', resolve));
        secondWindow.webContents.reload();
        await reloaded;
        await secondWindow.webContents.executeJavaScript(PRELUDE, true);
        const blocked = await run(secondWindow, `(async () => { await window.__S.pause(400);
          const alert = document.querySelector('[role="alert"]');
          return { mode: window.printshopApi.mode, serverName: window.printshopApi.serverName,
            headline: alert?.querySelector('strong')?.innerText || '', text: alert?.innerText || '' }; })()`);
        assert.equal(blocked.mode, 'blocked', 'ایستگاه پس از خاموش‌شدن سرور خودش را مسدود نکرد');
        assert.match(blocked.text, /متوقف شده است/);
        /* پیام باید سرور را نام ببرد، نه SQLite این ماشین؛ وگرنه اپراتور جای اشتباه را می‌گردد. */
        assert.equal(blocked.headline, 'سرور چاپخانه در دسترس نیست', 'تیتر صفحهٔ سرور خاموش درست نیست: ' + blocked.headline);
        assert.match(blocked.serverName, /127\.0\.0\.1/, 'نشانی سرور به رابط داده نشد');
        await capture(secondWindow, 'lan-4-server-down-blocked.png');

        const stillNoLocalBank = fs.readdirSync(stationDir, { recursive: true }).filter(f => /\.db(-wal|-shm)?$/.test(String(f)));
        assert.deepEqual(stillNoLocalBank, [], 'پس از قطع سرور، ایستگاه بانک محلی باز کرد');
        console.log(JSON.stringify({ smoke: 'lan-server-plus-station', pass: true, electron: process.versions.electron,
          abi: process.versions.modules, port, fixtureDir, boot, managerWork, stationTwo, onServerBank: onServerBank.value.map(c => c.id),
          whileDown, blocked, serverLog: serverLog.slice(0, 12), screenshots: shots }, null, 1));
        app.exit(0);
      } catch (error) {
        console.error(error && error.stack || String(error));
        console.error('server log:', serverLog.slice(0, 20).join(' | '));
        try { fs.writeFileSync(path.join(workDir, 'lan-failure.png'), (await win.webContents.capturePage()).toPNG()); shots.push('lan-failure.png'); } catch (_) { /* window may be gone */ }
        console.error('screenshots:', shots.join(', '));
        app.exit(1);
      }
    });
  });

  require('../electron/main.js');
})().catch(err => { console.error(String(err && err.stack || err)); try { if (serverChild) serverChild.kill(); } catch (_) { /* already dead */ } app.exit(1); });
