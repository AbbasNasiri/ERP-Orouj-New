'use strict';
/* بند ث/۳: سرور در همان EXE.
   خودِ برنامه با «--server --allow-lan --host=0.0.0.0» بالا می‌آید: همین پنجره باید هم بانک را
   باز کند و هم به شبکه گوش بدهد. چهار چیز سنجیده می‌شود:
   ۱) رابط می‌گوید «سرور این ماشین روشن است» و نشانی کارت شبکه را می‌دهد؛
   ۲) فایل آمادهٔ ایستگاه (PrintShopData/station-setup/<ip>/client.json) همان کلید و نشانی را
      دارد و یک ایستگاه ساخته‌شده فقط از آن فایل از راه شبکه وارد می‌شود و رکوردی را که در
      پنجره نوشته شده می‌خواند — یک بانک، یک نویسنده؛
   ۳) کنترل منفی: کلید نادرست BAD_ENVELOPE می‌گیرد و هیچ نوشتنی نمی‌پذیرد؛
   ۴) گزارش PrintShopData/logs/server.log خطِ شنود و همان درخواست‌ها را دارد.
   همه‌چیز در .work است — بانک زندهٔ کارفرما باز نمی‌شود. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
assert.ok(process.versions.electron, 'Electron runtime required');

const { createServerClient } = require('../electron/server-client');
const { makeKey, KEY_PATTERN } = require('../electron/lan-crypto');

const workDir = path.resolve(__dirname, '../../.work');
const root = path.resolve(__dirname, '..');
const rendererFile = path.resolve(root, 'dist', 'index.html');
const CUSTOMERS = 'printshop_customers_v2';
fs.mkdirSync(workDir, { recursive: true });

const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-server-mode-smoke-'));
const serverDir = path.join(fixtureDir, 'server');
const dataDir = path.join(serverDir, 'PrintShopData');
const userData = path.join(fixtureDir, 'user-data');
for (const dir of [serverDir, dataDir, userData]) fs.mkdirSync(dir, { recursive: true });

const PASS = 'server-mode-strong-password';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}

const PRELUDE = `
window.__S = {
  api: window.printshopApi, PASS: '${PASS}', CUSTOMERS: '${CUSTOMERS}',
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
  stationText() { return document.querySelector('.sidebar-station')?.innerText || ''; },
  stationTitle() { return document.querySelector('.sidebar-station')?.getAttribute('title') || ''; },
  sidebarRect() { const r = document.querySelector('.workbench-sidebar').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(260, r.height) }; },
}; 'server-mode-prelude-ready';`;

(async () => {
  const port = await freePort();

  /* همان مسیری که .exe کارفرما می‌رود: پوشهٔ داده کنار بسته، و پرچم‌های سرور در argv. */
  app.setPath('userData', userData);
  process.env.PORTABLE_EXECUTABLE_DIR = serverDir;
  delete process.env.PRINTSHOP_SERVER_URL;
  delete process.env.PRINTSHOP_LAN_KEY;
  process.argv.push('--server', '--allow-lan', '--host=0.0.0.0', '--port=' + port);

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
  const logFile = path.join(dataDir, 'logs', 'server.log');
  const logLines = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

  let mainTaken = false;
  app.on('browser-window-created', (_event, win) => {
    if (mainTaken) return;
    mainTaken = true;
    win.show();
    win.setBounds({ x: 0, y: 0, width: 1500, height: 950 });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer console: ' + message); });
    win.webContents.once('did-finish-load', () => runScreen(win));
  });

  require('../electron/main.js');

  async function runScreen(win) {
    try {
      await win.webContents.executeJavaScript(PRELUDE, true);

      /* ۱) پنجره بالا آمده و همان لحظه می‌داند این ماشین سرور است — با نشانی شبکه. */
      const boot = await run(win, `(async () => {
        const S = window.__S;
        await S.loginAs('admin', '1234', S.PASS);
        const text = await S.waitFor(() => S.stationText().includes('سرور این ماشین روشن است') ? S.stationText() : null, 'serving indicator');
        return { serving: S.api.serving, servingUrl: S.api.servingUrl, loopback: S.api.servingLoopback,
          addresses: S.api.servingAddresses, transport: S.api.transport, serverName: S.api.serverName,
          dataPath: await S.api.dataPath(), text, title: S.stationTitle(),
          dot: document.querySelector('.sidebar-link-dot')?.getAttribute('data-link') };
      })()`);
      assert.equal(boot.serving, true, 'رابط نفهمید که این ماشین سرور است');
      assert.equal(boot.transport, 'local', 'کامپیوتر سرور نباید خودش را ایستگاه بداند');
      assert.equal(boot.serverName, '', 'کامپیوتر سرور نام سرور بیرونی ندارد');
      assert.ok(Array.isArray(boot.addresses) && boot.addresses.length > 0, 'این ماشین نشانی کارت شبکه ندارد؛ ادعای «شبکه کار می‌کند» ساخته نمی‌شود');
      assert.equal(boot.loopback, false, 'سرور با --allow-lan باید فقط-محلی نباشد');
      assert.equal(boot.servingUrl, 'http://' + boot.addresses[0] + ':' + port, 'نشانی سرور برای ایستگاه‌ها درست نیست: ' + boot.servingUrl);
      assert.equal(boot.text, 'سرور این ماشین روشن است', 'خط ستون کناری در حالت سرور درست نیست: ' + boot.text);
      assert.equal(boot.dot, 'up', 'نقطهٔ نشانگر در حالت سرور سبز نیست');
      assert.equal(boot.title, 'ایستگاه‌ها به این نشانی وصل می‌شوند: ' + boot.servingUrl, 'نشانی سرور در راهنمای خط ستون کناری نیست: ' + boot.title);
      assert.match(String(boot.dataPath), /PrintShopData[\\/]printshop\.db$/, 'روی کامپیوتر سرور بانک باید محلی باز شود: ' + boot.dataPath);
      await capture(win, 'server-mode-1-sidebar-serving.png');
      await run(win, `(async () => { window.__S.tightRect = window.__S.sidebarRect(); return true; })()`);
      const rect = await win.webContents.executeJavaScript('window.__S.tightRect', true);
      await capture(win, 'server-mode-2-sidebar-tight.png', { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });

      /* ۲) کلید و نسخهٔ آمادهٔ ایستگاه روی دیسک. */
      const keyFile = path.join(dataDir, 'lan-key.txt');
      assert.ok(fs.existsSync(keyFile), 'فایل کلید امنیتی ساخته نشد: ' + keyFile);
      const lanKey = fs.readFileSync(keyFile, 'utf8').trim();
      assert.match(lanKey, KEY_PATTERN, 'کلید امنیتی سرور شکل درست ندارد');
      if (process.platform !== 'win32') assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, 'کلید امنیتی باید فقط برای صاحب فایل خواندنی باشد');
      assert.equal(fs.existsSync(path.join(dataDir, 'client.json')), false, 'روی کامپیوتر سرور نباید client.json ایستگاه ساخته شود');

      const setupDir = path.join(dataDir, 'station-setup');
      const setupFiles = fs.existsSync(setupDir)
        ? fs.readdirSync(setupDir).map(ip => ({ ip, file: path.join(setupDir, ip, 'client.json') })).filter(f => fs.existsSync(f.file))
        : [];
      assert.equal(setupFiles.length, boot.addresses.length, 'برای هر نشانی شبکه باید یک فایل آمادهٔ ایستگاه باشد: ' + setupFiles.map(f => f.ip).join(','));
      for (const item of setupFiles) {
        const config = JSON.parse(fs.readFileSync(item.file, 'utf8'));
        assert.equal(config.mode, 'network');
        assert.equal(config.server, 'http://' + item.ip + ':' + port, 'نشانی در فایل آمادهٔ ایستگاه درست نیست: ' + config.server);
        assert.equal(config.key, lanKey, 'کلید فایل آمادهٔ ایستگاه با کلید سرور یکی نیست');
      }

      /* ۳) ایستگاهی که فقط client.json را دارد، از راه شبکه وارد می‌شود. */
      const first = setupFiles.find(f => f.ip === boot.addresses[0]) || setupFiles[0];
      const config = JSON.parse(fs.readFileSync(first.file, 'utf8'));
      const station = createServerClient({ url: config.server, key: config.key });
      const ping = await station.ping();
      assert.equal(ping.ok, true, 'ایستگاه ساخته‌شده از client.json به سرور نرسید: ' + JSON.stringify(ping));
      const login = await station.call('be:login', '', ['admin', PASS]);
      assert.equal(login.ok, true, 'ورود ایستگاه با رمزی که در پنجره تنظیم شد رد شد: ' + JSON.stringify(login));
      assert.equal(login.user.mustChange, false, 'رمز پنجره روی همان بانک ننشسته است');

      /* ۴) یک بانک، یک نویسنده: پنجره می‌نویسد، ایستگاه شبکه همان را می‌خواند. */
      const written = await run(win, `(async () => {
        const S = window.__S;
        const bank = await S.ok(S.api.get(S.CUSTOMERS));
        const rec = { id: 'srv1', name: 'مشتری ثبت‌شده از رابط سرور', entityType: 'حقیقی', phone: '09121110002', address: 'تبریز',
          customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 };
        await S.ok(S.api.set(S.CUSTOMERS, [...(bank.value || []), rec], bank.revs));
        return { before: (bank.value || []).length };
      })()`);
      const overNetwork = await station.call('be:get', login.token, [CUSTOMERS]);
      assert.equal(overNetwork.ok, true, 'خواندن از راه شبکه رد شد: ' + JSON.stringify(overNetwork));
      assert.ok((overNetwork.value || []).some(c => c.id === 'srv1'), 'ایستگاه رکورد نوشته‌شده در پنجره را نمی‌بیند');
      assert.equal(overNetwork.value.length, written.before + 1);

      /* ۵) کنترل منفی: کلید دیگر هیچ کاری نمی‌کند و هیچ نوشتنی از آن نمی‌پذیرد. */
      const stranger = createServerClient({ url: config.server, key: makeKey() });
      const strangerPing = await stranger.ping();
      assert.equal(strangerPing.ok, false, 'ایستگاه با کلید نادرست پاسخی از سرور گرفت');
      assert.equal(strangerPing.code, 'BAD_ENVELOPE', 'خطای کلید نادرست درست نیست: ' + JSON.stringify(strangerPing));
      const strangerLogin = await stranger.call('be:login', '', ['admin', PASS]);
      assert.equal(strangerLogin.ok, false, 'ورود با کلید نادرست پذیرفته شد');
      assert.equal(strangerLogin.code, 'BAD_ENVELOPE');
      assert.equal(strangerLogin.token, undefined, 'برای کلید نادرست نشستی ساخته شد');
      const strangerWrite = await stranger.call('be:set', login.token, [CUSTOMERS, [], null]);
      assert.equal(strangerWrite.ok, false, 'نوشتن با کلید نادرست پذیرفته شد');
      assert.equal(strangerWrite.code, 'BAD_ENVELOPE');
      const unchanged = await station.call('be:get', login.token, [CUSTOMERS]);
      assert.equal(unchanged.value.length, written.before + 1, 'درخواست کلید نادرست چیزی را عوض کرد');

      /* ۶) گزارش سرور: خطِ شنود و همان درخواست‌های واقعی، با کانال و نتیجه. */
      const entries = logLines();
      assert.ok(entries.some(e => e.channel === 'server' && e.outcome === 'listening'), 'خطِ شنود در گزارش سرور نیست');
      assert.ok(entries.some(e => e.channel === 'be:login' && e.outcome === 'ok'), 'ورود موفق ایستگاه در گزارش سرور نیست');
      assert.ok(entries.some(e => e.channel === '(نامعتبر)' && e.outcome === 'BAD_ENVELOPE'), 'ردِ کلید نادرست در گزارش سرور نیست');

      /* کنترل منفی دوم: پوشهٔ سرور فقط یک بانک دارد؛ ایستگاه شبکه‌ای بانک نساخته. */
      const banks = fs.readdirSync(serverDir, { recursive: true }).map(String).filter(f => /\.db(-wal|-shm)?$/.test(f));
      assert.equal(banks.filter(f => f.endsWith('printshop.db')).length, 1, 'بانک سرور باید یکی باشد: ' + banks.join(','));
      const stray = fs.readdirSync(fixtureDir, { recursive: true }).map(String)
        .filter(f => /\.db(-wal|-shm)?$/.test(f) && !String(f).includes('PrintShopData'));
      assert.deepEqual(stray, [], 'بیرون از پوشهٔ بانک، فایل SQLite ساخته شد: ' + stray.join(','));

      console.log(JSON.stringify({ smoke: 'electron-server-mode', pass: true, electron: process.versions.electron,
        abi: process.versions.modules, port, fixtureDir, boot, setupFiles: setupFiles.map(f => f.file), written,
        overNetwork: overNetwork.value.map(c => c.id), stranger: { ping: strangerPing.code, login: strangerLogin.code, write: strangerWrite.code },
        logEntries: entries.slice(0, 8), screenshots: shots }, null, 1));
      app.exit(0);
    } catch (error) {
      console.error(error && error.stack || String(error));
      try { console.error('server log lines:', JSON.stringify(logLines().slice(0, 20))); } catch (_) { /* no log yet */ }
      try { fs.writeFileSync(path.join(workDir, 'server-mode-failure.png'), (await win.webContents.capturePage()).toPNG()); shots.push('server-mode-failure.png'); } catch (_) { /* window may be gone */ }
      console.error('screenshots:', shots.join(', '));
      app.exit(1);
    }
  }
})().catch(err => { console.error(String(err && err.stack || err)); app.exit(1); });
