'use strict';
/* بند ت: حساب ایستگاه‌ها + نشانگر سرور در رابط.
   سرور واقعی + یک پنجرهٔ Electron در حالت شبکه. مدیر در «کاربران و دسترسی‌ها» نام
   ایستگاه را در همان ردیف حساب خودش می‌نویسد؛ نام باید روی سرور بنشیند و همان لحظه
   کنار نام کاربر در ستون کناری دیده شود. سپس سرور خاموش می‌شود و همان نشانگر باید
   قرمزِ «سرور قطع است» را نشان دهد، بی‌آن‌که نام ایستگاه از میان برود.
   همه‌چیز در .work است — بانک زندهٔ کارفرما باز نمی‌شود. */
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

const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-station-smoke-'));
const stationDir = path.join(fixtureDir, 'station');
const serverDataDir = path.join(fixtureDir, 'server', 'PrintShopData');
const userData = path.join(fixtureDir, 'user-data');
for (const dir of [stationDir, serverDataDir, userData]) fs.mkdirSync(dir, { recursive: true });

const PASS = 'station-smoke-strong-password';
const STATION = 'مالی';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}
const waitForPort = (port, host, tries = 200) => new Promise((resolve, reject) => {
  const attempt = left => {
    const sock = net.connect(port, host);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => {
      sock.destroy();
      if (left <= 0) return reject(new Error('سرور روی ' + host + ':' + port + ' بالا نیامد.'));
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
    serverCaller = createServerClient({ url: `http://127.0.0.1:${port}`, key: fs.readFileSync(path.join(serverDataDir, 'lan-key.txt'), 'utf8').trim() });
  }
  return serverCaller.call(channel, token, args);
}

const PRELUDE = `
window.__S = {
  api: window.printshopApi, PASS: '${PASS}', STATION: '${STATION}',
  pause: ms => new Promise(r => setTimeout(r, ms)),
  check(value, message) { if (!value) throw new Error(message); },
  async ok(request) { const r = await request; window.__S.check(r && r.ok, (r && (r.error || r.code)) || 'operation failed'); return r; },
  async waitFor(select, label, tries = 300) { for (let i = 0; i < tries; i++) { const v = select(); if (v) return v; await window.__S.pause(50); } throw new Error('wait expired: ' + label); },
  type(element, value) { const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); },
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
  async openDesk(label) { const node = await this.waitFor(() => [...document.querySelectorAll('.workbench-navitem')]
    .find(n => (n.getAttribute('aria-label') || n.textContent.trim()) === label), 'desk ' + label);
    node.click(); await this.pause(340); },
  stationText() { return document.querySelector('.sidebar-station')?.innerText || ''; },
  stationInput() { return [...document.querySelectorAll('input')].find(i => (i.getAttribute('aria-label') || '').startsWith('نام ایستگاه ')) || null; },
  pageText() { return document.querySelector('.workbench-page:not([hidden])')?.innerText || ''; },
  sidebarRect() { const r = document.querySelector('.workbench-sidebar').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(260, r.height) }; },
}; 'station-prelude-ready';`;

let serverChild = null;

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
  await waitForPort(port, '127.0.0.1');
  /* بند ث: کلید را سرور ساخته است؛ همان به ایستگاه داده می‌شود. */
  const lanKey = fs.readFileSync(path.join(serverDataDir, 'lan-key.txt'), 'utf8').trim();
  assert.match(lanKey, /^[A-Za-z0-9+/]{43}=$/, 'کلید امنیتی سرور ساخته نشد');

  app.setPath('userData', userData);
  process.env.PORTABLE_EXECUTABLE_DIR = stationDir;
  process.env.PRINTSHOP_SERVER_URL = 'http://127.0.0.1:' + port;
  process.env.PRINTSHOP_LAN_KEY = lanKey;

  const shots = [];
  const capture = async (win, name, rect) => {
    const file = path.join(workDir, name);
    fs.writeFileSync(file, (await win.webContents.capturePage(rect)).toPNG());
    shots.push(file);
  };
  const run = async (win, source) => {
    const marker = source.replace(/\s+/g, ' ').slice(0, 60);
    const result = await win.webContents.executeJavaScript(`(async () => { try { return await (${source}); } catch (e) { return { __smokeError: String((e && e.stack) || e) }; } })()`, true);
    if (result && result.__smokeError) throw new Error(result.__smokeError + '\n  in phase: ' + marker);
    return result;
  };

  let mainTaken = false;
  app.on('browser-window-created', (_event, win) => {
    if (mainTaken) return;
    mainTaken = true;
    win.show();
    win.setBounds({ x: 0, y: 0, width: 1500, height: 950 });
    win.webContents.once('did-finish-load', () => runScreen(win));
  });

  require('../electron/main.js');

  async function runScreen(win) {
    try {
      await win.webContents.executeJavaScript(PRELUDE, true);

      /* ۱) ایستگاه تازه: پیش از هر کاری، نشانگر باید «در حال بررسی سرور» یا «وصل» باشد، نه محلی. */
      const setup = await run(win, `(async () => {
        const S = window.__S;
        await S.loginAs('admin', '1234', S.PASS);
        const transport = S.api.transport;
        const serverName = S.api.serverName;
        await S.openDesk('کاربران و دسترسی‌ها');
        const headers = [...document.querySelectorAll('.workbench-page:not([hidden]) th')].map(th => th.innerText.trim());
        const input = S.stationInput();
        S.check(input, 'فیلد ایستگاه در ردیف حساب مدیر پیدا نشد');
        const linked = await S.waitFor(() => S.stationText().includes('وصل به سرور') ? S.stationText() : null, 'connected indicator', 120);
        return { transport, serverName, headers, stationBefore: linked, inputLabel: input.getAttribute('aria-label') };
      })()`);
      assert.equal(setup.transport, 'network', 'preload حالت شبکه را به رابط نرساند');
      assert.match(setup.serverName, /^http:\/\/127\.0\.0\.1:\d+\/?$/);
      assert.ok(setup.headers.includes('ایستگاه'), 'ستون ایستگاه در جدول کاربران نیست: ' + setup.headers.join('، '));
      assert.equal(setup.stationBefore, 'وصل به سرور', 'ایستگاه بدون نام نباید چیزی جز وضعیت اتصال نشان دهد: ' + setup.stationBefore);

      /* ۲) مدیر نام ایستگاه خودش را در همان ردیف می‌نویسد و از فیلد بیرون می‌رود. */
      const typed = await run(win, `(async () => {
        const S = window.__S;
        const input = S.stationInput();
        input.focus();
        S.type(input, '  ' + S.STATION + '  ');
        input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await S.waitFor(() => S.pageText().includes('تغییرات کاربران ثبت شد'), 'station save message');
        const label = await S.waitFor(() => { const t = S.stationText(); return t.includes('ایستگاه ' + S.STATION) ? t : null; }, 'sidebar station label');
        return { label, savedValue: S.stationInput()?.value };
      })()`);
      assert.equal(typed.label, 'ایستگاه مالی · وصل به سرور', 'نشانگر ستون کناری نام ایستگاه و اتصال را با هم نشان نداد: ' + typed.label);
      assert.equal(typed.savedValue, STATION, 'مقدار ذخیره‌شده در همان فیلد دیده نمی‌شود');
      await capture(win, 'station-1-users-page.png');

      /* ۳) حقیقت روی سرور: همان نام در پاسخ be:listUsers، نه فقط در حافظهٔ پنجره. */
      const serverLogin = await httpCall(port, 'be:login', '', ['admin', PASS]);
      assert.equal(serverLogin.ok, true, JSON.stringify(serverLogin));
      assert.equal(serverLogin.user.station, STATION, 'نام ایستگاه در پاسخ ورود سرور نیست');
      const serverUsers = await httpCall(port, 'be:listUsers', serverLogin.token, []);
      const adminRow = (serverUsers.users || []).find(u => u.username === 'admin');
      assert.equal(adminRow.station, STATION, 'نام ایستگاه روی بانک سرور ننشست');

      /* عکس نزدیک از همان خط، تا کارفرما بدون ذره‌بین ببیند. */
      await run(win, `(async () => { window.__S.tightRect = window.__S.sidebarRect(); return true; })()`);
      const rect = await win.webContents.executeJavaScript('window.__S.tightRect', true);
      await capture(win, 'station-2-sidebar-up.png', { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });

      /* ۴) کنترل منفی: سرور خاموش می‌شود. ضربان تغییر باید نشانگر را قرمز کند و نام ایستگاه بماند. */
      child.kill();
      serverChild = null;
      const down = await run(win, `(async () => {
        const S = window.__S;
        const text = await S.waitFor(() => { const t = S.stationText(); return t.includes('سرور قطع است') ? t : null; }, 'disconnected indicator', 400);
        return { text, hasStation: text.includes('ایستگاه ' + S.STATION), dot: document.querySelector('.sidebar-link-dot')?.getAttribute('data-link') };
      })()`);
      assert.equal(down.text, 'ایستگاه مالی · سرور قطع است', 'نشانگر قطع اتصال درست نیست: ' + down.text);
      assert.equal(down.hasStation, true, 'نام ایستگاه با قطع اتصال از میان رفت');
      assert.equal(down.dot, 'down', 'نقطهٔ نشانگر قرمز نشد');
      await run(win, `(async () => { window.__S.tightRect = window.__S.sidebarRect(); return true; })()`);
      const rectDown = await win.webContents.executeJavaScript('window.__S.tightRect', true);
      await capture(win, 'station-3-sidebar-down.png', { x: Math.round(rectDown.x), y: Math.round(rectDown.y), width: Math.round(rectDown.width), height: Math.round(rectDown.height) });

      /* کنترل منفی دوم: تنها بانکِ این صحنه بانکِ سرور است؛ ایستگاه فایل SQLite نمی‌سازد. */
      const strayBanks = fs.readdirSync(fixtureDir, { recursive: true }).map(String)
        .filter(f => /\.db(-wal|-shm)?$/.test(f) && !f.includes('PrintShopData'));
      assert.deepEqual(strayBanks, [], 'ایستگاه بانک محلی ساخت: ' + strayBanks.join(','));

      console.log(JSON.stringify({ smoke: 'station-label-and-server-link', pass: true, electron: process.versions.electron,
        port, fixtureDir, setup, typed, adminStationOnServer: adminRow.station, down, screenshots: shots }, null, 1));
      app.exit(0);
    } catch (error) {
      console.error(error && error.stack || String(error));
      console.error('server log:', serverLog.slice(0, 20).join(' | '));
      for (const w of BrowserWindow.getAllWindows()) {
        try { fs.writeFileSync(path.join(workDir, 'station-failure-' + w.id + '.png'), (await w.webContents.capturePage()).toPNG()); } catch (_) { /* window may be gone */ }
      }
      console.error('screenshots:', shots.join(', '));
      app.exit(1);
    }
  }
})().catch(err => { console.error(String(err && err.stack || err)); try { if (serverChild) serverChild.kill(); } catch (_) { /* already dead */ } app.exit(1); });
