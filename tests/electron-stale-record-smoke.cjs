'use strict';
/* بند ب/۴: دو ایستگاه روی یک رکورد — از راه فرم‌های واقعی برنامه.
   سرور واقعی + دو پنجرهٔ Electron که هر دو به همان بانک وصل‌اند. ایستگاه ب فرم ویرایش
   را باز می‌کند؛ در همان فاصله ایستگاه الف همان رکورد را ذخیره می‌کند؛ وقتی ب «ذخیره»
   می‌زند سرور باید بنویسد «این اطلاعات پس از خواندنِ شما تغییر کرده»، هیچ داده‌ای عوض
   نشود، فهرستِ ب تازه شود و نوار قرمز روی میز ظاهر شود. سپس ب دوباره ویرایش می‌کند
   و همین ذخیره پذیرفته می‌شود. همه‌چیز در .work است — بانک زندهٔ کارفرما باز نمی‌شود. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
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

const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-stale-smoke-'));
const stationDir = path.join(fixtureDir, 'station');
const serverDataDir = path.join(fixtureDir, 'server', 'PrintShopData');
const userData = path.join(fixtureDir, 'user-data');
for (const dir of [stationDir, serverDataDir, userData]) fs.mkdirSync(dir, { recursive: true });

const PASS = 'stale-smoke-strong-password';
const FIN_PASS = 'finance-stale-smoke-pass';
const SUPPLIERS = 'printshop_suppliers_v2';
const NAME = 'کاغذفروشی مرکزی';
const MAT_FIRST = 'کاغذ';
const MAT_A = 'کاغذ و مقوا — ایستگاه الف';
const MAT_B = 'کاغذ و چوب — ایستگاه ب';
const MAT_C = 'کاغذ، مقوا و چوب — ایستگاه الف';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}
/* با PRINTSHOP_SMOKE_LAN_IP=1 سرور روی همهٔ کارت‌ها می‌نشیند و هر دو ایستگاه با نشانی واقعی
   شبکه وصل می‌شوند؛ این تنها راهِ سنجشِ «سوکت روی کارت شبکه» روی یک ماشین است. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      const family = String(a.family);
      if ((family === 'IPv4' || family === '4') && !a.internal) return a.address;
    }
  }
  return '';
}
const overLan = process.env.PRINTSHOP_SMOKE_LAN_IP === '1';
const smokeHost = () => (overLan ? lanAddress() : '127.0.0.1');
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
    serverCaller = createServerClient({ url: 'http://' + smokeHost() + ':' + port, key: fs.readFileSync(path.join(serverDataDir, 'lan-key.txt'), 'utf8').trim() });
  }
  return serverCaller.call(channel, token, args);
}

const PRELUDE = `
window.__S = {
  api: window.printshopApi,
  SUPPLIERS: '${SUPPLIERS}',
  PASS: '${PASS}', FIN_PASS: '${FIN_PASS}', NAME: '${NAME}', MAT_FIRST: '${MAT_FIRST}', MAT_A: '${MAT_A}', MAT_B: '${MAT_B}', MAT_C: '${MAT_C}',
  pause: ms => new Promise(r => setTimeout(r, ms)),
  check(value, message) { if (!value) throw new Error(message); },
  async ok(request) { const r = await request; window.__S.check(r && r.ok, (r && (r.error || r.code)) || 'operation failed'); return r; },
  async waitFor(select, label) { for (let i = 0; i < 300; i++) { const v = select(); if (v) return v; await window.__S.pause(50); } throw new Error('wait expired: ' + label); },
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
  async clickVisible(text, label) { const b = await this.waitFor(() => [...document.querySelectorAll('button')]
    .filter(x => x.textContent.trim() === text && x.getBoundingClientRect().height > 0).pop(), label || text);
    b.click(); await this.pause(220); return b; },
  field(label) { const f = [...document.querySelectorAll('label.psx-field')]
    .filter(x => x.getBoundingClientRect().height > 0).find(l => (l.querySelector('.psx-field-label')?.textContent || '').includes(label));
    this.check(f, 'فیلد «' + label + '» پیدا نشد'); const input = f.querySelector('input, textarea');
    this.check(input, 'ورودی فیلد «' + label + '» پیدا نشد'); return input; },
  /* رکورد تازه هنوز «در انتظار بررسی» است و از فهرست کاری بیرون می‌ماند؛ نمایشگرِ بانک را باز می‌کنیم. */
  async showWholeBank() { const btn = await this.waitFor(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('همهٔ بانک')), 'bank filter');
    btn.click(); await this.pause(260); },
  async newSupplier(name, materials) {
    await this.clickVisible('تامین‌کننده جدید', 'new supplier');
    this.type(this.field('نام تامین‌کننده'), name);
    this.type(this.field('مواد قابل تامین'), materials);
    await this.pause(120);
    await this.clickVisible('ذخیره', 'save new');
    await this.waitFor(() => this.pageText().includes(materials), 'row with ' + materials);
  },
  /* فرم ویرایش را باز می‌کند و مقدار «مواد قابل تامین» را می‌نویسد؛ ذخیره را جدا می‌زند
     تا بتوان میان باز بودنِ فرمِ یک ایستگاه و ذخیرهٔ ایستگاه دیگر فاصله گذاشت. */
  async openEditForm(materials) {
    const btn = await this.waitFor(() => [...document.querySelectorAll('button')].find(b => b.title === 'ویرایش' && b.getBoundingClientRect().height > 0), 'edit button');
    btn.click(); await this.pause(260);
    this.type(this.field('مواد قابل تامین'), materials);
    await this.pause(140);
  },
  async pressSave() { await this.clickVisible('ذخیره', 'save edit'); await this.pause(420); },
  async readRows() { const r = await window.storage.get(this.SUPPLIERS, true); return r.value === null ? null : JSON.parse(r.value); },
  pageText() { return document.querySelector('.workbench-page:not([hidden])')?.innerText || ''; },
}; 'stale-prelude-ready';`;

let serverChild = null;

(async () => {
  const port = await freePort();
  const host = smokeHost();
  assert.ok(host, 'کلید PRINTSHOP_SMOKE_LAN_IP=1 گذاشته شده ولی ماشین نشانی شبکه ندارد.');
  const serverLog = [];
  const child = spawn(process.execPath, [serverScript, '--data=' + serverDataDir, '--port=' + port,
    ...(overLan ? ['--host=0.0.0.0', '--allow-lan'] : [])], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverChild = child;
  child.stdout.on('data', d => serverLog.push(String(d).trim()));
  child.stderr.on('data', d => serverLog.push('ERR ' + String(d).trim()));
  await waitForPort(port, host);
  /* بند ث: کلید را سرور ساخته است؛ همان را به ایستگاه می‌دهیم. */
  const lanKey = fs.readFileSync(path.join(serverDataDir, 'lan-key.txt'), 'utf8').trim();
  assert.match(lanKey, /^[A-Za-z0-9+/]{43}=$/, 'کلید امنیتی سرور ساخته نشد');

  app.setPath('userData', userData);
  process.env.PORTABLE_EXECUTABLE_DIR = stationDir;
  /* با PRINTSHOP_SMOKE_CLIENT_JSON=1 ایستگاه هیچ متغیر محیطی نمی‌گیرد و همان
     client.json کنار بانک را می‌خواند — دقیقاً همان کاری که روی کامپیوترهای کارفرما
     باید انجام شود؛ اگر این مسیر خراب باشد، آزمونِ با پرچمِ محیطی این را نمی‌گوید. */
  const useClientFile = process.env.PRINTSHOP_SMOKE_CLIENT_JSON === '1';
  if (useClientFile) {
    fs.mkdirSync(path.join(stationDir, 'PrintShopData'), { recursive: true });
    fs.writeFileSync(path.join(stationDir, 'PrintShopData', 'client.json'),
      JSON.stringify({ mode: 'network', server: 'http://' + host + ':' + port, key: lanKey }));
    delete process.env.PRINTSHOP_SERVER_URL;
  } else {
    process.env.PRINTSHOP_SERVER_URL = 'http://' + host + ':' + port;
    process.env.PRINTSHOP_LAN_KEY = lanKey;
  }

  const shots = [];
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
  const makeWindow = async (label) => {
    const win = new BrowserWindow({ show: true, width: 1500, height: 950, webPreferences: {
      preload: path.resolve(root, 'electron', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    } });
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer ' + label + ': ' + message); });
    await win.loadURL(pathToFileURL(rendererFile).href);
    await win.webContents.executeJavaScript(PRELUDE, true);
    win.setBounds({ x: label === 'A' ? 0 : 60, y: 0, width: 1500, height: 950 });
    return win;
  };

  /* پنجرهٔ اصلی برنامه = ایستگاه الف (مدیر چاپخانه)؛ ایستگاه ب را خودمان می‌سازیم. */
  let stationATaken = false;
  app.on('browser-window-created', (_event, win) => {
    if (stationATaken) return;
    stationATaken = true;
    win.show();
    win.setBounds({ x: 0, y: 0, width: 1500, height: 950 });
    win.webContents.once('did-finish-load', () => runStationA(win));
  });

  require('../electron/main.js');

  async function runStationA(win) {
    let winB = null;
    try {
      await win.webContents.executeJavaScript(PRELUDE, true);

      /* ۱) ایستگاه الف: مدیر وارد می‌شود، حساب ایستگاه ب را می‌سازد و تامین‌کنندهٔ مشترک را با فرم ثبت می‌کند. */
      const setup = await run(win, `(async () => {
        const S = window.__S;
        await S.loginAs('admin', '1234', S.PASS);
        const users = (await S.ok(S.api.auth.listUsers())).users;
        users.push({ id: 'finance', username: 'finance', name: 'ایستگاه مالی', role: 'مدیر مالی', active: true, _plain: S.FIN_PASS });
        await S.ok(S.api.auth.saveUsers(users));
        await S.openDesk('تامین‌کنندگان');
        await S.showWholeBank();
        await S.newSupplier(S.NAME, S.MAT_FIRST);
        const rows = await S.readRows();
        return { names: rows.map(r => r.name), materials: rows[0].materials, id: rows[0].id, onPage: S.pageText().includes(S.MAT_FIRST) };
      })()`);
      assert.deepEqual(setup.names, [NAME], 'ایستگاه الف رکورد مشترک را ثبت نکرد');
      assert.equal(setup.onPage, true, 'رکورد تازه روی میز ایستگاه الف دیده نمی‌شود');
      await capture(win, 'stale-1-station-a-created.png');

      /* ۲) ایستگاه ب: همان رکورد را می‌بیند و فرم ویرایش را باز می‌کند (هنوز ذخیره نزده). */
      winB = await makeWindow('B');
      const stationBView = await run(winB, `(async () => {
        const S = window.__S;
        await S.loginAs('finance', S.FIN_PASS);
        await S.openDesk('تامین‌کنندگان');
        await S.showWholeBank();
        const rows = await S.readRows();
        await S.openEditForm(S.MAT_B);
        return { names: rows.map(r => r.name), materials: rows[0].materials,
          onPage: S.pageText().includes(S.MAT_FIRST), formValue: S.field('مواد قابل تامین').value };
      })()`);
      assert.deepEqual(stationBView.names, [NAME], 'ایستگاه ب رکورد ایستگاه الف را نمی‌بیند');
      assert.equal(stationBView.formValue, MAT_B, 'فرم ایستگاه ب مقدار تازه را نپذیرفت');
      await capture(winB, 'stale-2-station-b-form-open.png');

      /* ۳) در همان فاصله، ایستگاه الف همان رکورد را ذخیره می‌کند؛ نسخه جلو می‌رود. */
      const stationAEdit = await run(win, `(async () => {
        const S = window.__S;
        await S.openEditForm(S.MAT_A);
        await S.pressSave();
        return { materials: (await S.readRows())[0].materials, onPage: S.pageText().includes(S.MAT_A) };
      })()`);
      assert.equal(stationAEdit.materials, MAT_A, 'ذخیرهٔ ایستگاه الف در بانک ننشست');
      assert.equal(stationAEdit.onPage, true, 'میز ایستگاه الف پس از ذخیرهٔ خودش تازه نشد');

      /* ۴) ایستگاه ب «ذخیره» می‌زند: رد، بدون تغییری در بانک، فهرست تازه، نوار قرمز. */
      const refused = await run(winB, `(async () => {
        const S = window.__S;
        window.__alerts = []; const realAlert = window.alert; window.alert = m => { window.__alerts.push(String(m)); };
        const stale = [];
        const onStale = e => stale.push({ key: e.detail.key, ids: e.detail.ids });
        window.addEventListener('printshop:stale', onStale);
        await S.pressSave();
        const banner = document.querySelector('.stale-banner');
        const pageAfter = S.pageText();
        const out = { stale, alerts: window.__alerts, bannerText: banner ? banner.innerText : '',
          bannerVisible: !!banner && banner.getBoundingClientRect().height > 0,
          bankMaterials: (await S.readRows()).map(r => r.materials),
          pageHasA: pageAfter.includes(S.MAT_A), pageHasB: pageAfter.includes(S.MAT_B) };
        window.alert = realAlert; window.removeEventListener('printshop:stale', onStale);
        return out;
      })()`);
      assert.deepEqual(refused.stale, [{ key: SUPPLIERS, ids: [setup.id] }], 'رویداد تضاد، رکورد مشترک را اعلام نکرد');
      assert.deepEqual(refused.alerts, [], 'پیام مسدودکنندهٔ alert هنوز روی مسیر تضاد می‌آید');
      assert.match(refused.bannerText, /پس از خواندنِ شما در ایستگاه دیگری تغییر کرد/);
      assert.equal(refused.bannerVisible, true, 'نوار تضاد روی میز دیده نمی‌شود');
      assert.deepEqual(refused.bankMaterials, [MAT_A], 'نوشتنِ ردشده چیزی را در بانک عوض کرد');
      assert.equal(refused.pageHasA, true, 'فهرست ایستگاه ب تازه نشد');
      assert.equal(refused.pageHasB, false, 'تغییر نوشتنِ ردشده روی فهرست مانده است');
      await capture(winB, 'stale-3-station-b-refused.png');

      /* ۵) ایستگاه ب با چشمِ تازه دوباره ویرایش می‌کند و این‌بار ذخیره می‌شود. */
      const retried = await run(winB, `(async () => {
        const S = window.__S;
        await S.openEditForm(S.MAT_B);
        await S.pressSave();
        const banner = document.querySelector('.stale-banner');
        if (banner) banner.querySelector('button').click();
        await S.pause(160);
        return { materials: (await S.readRows())[0].materials, pageHasB: S.pageText().includes(S.MAT_B),
          bannerGone: !document.querySelector('.stale-banner') };
      })()`);
      assert.equal(retried.materials, MAT_B, 'پس از تازه‌شدنِ فهرست، همان ویرایش پذیرفته نشد');
      assert.equal(retried.pageHasB, true, 'فهرست پس از نوشتنِ پذیرفته‌شده تازه نشد');
      assert.equal(retried.bannerGone, true, 'نوار تضاد با دکمهٔ «متوجه شدم» بسته نشد');
      await capture(winB, 'stale-4-station-b-saved.png');

      /* ۶) همان چیزی که در بانکِ سرور نشسته، نه در حافظهٔ یک پنجره. */
      const loginOnServer = await httpCall(port, 'be:login', '', ['admin', PASS]);
      const onServerBank = await httpCall(port, 'be:get', loginOnServer.token, [SUPPLIERS]);
      assert.equal(onServerBank.ok, true);
      assert.equal(onServerBank.value[0].materials, MAT_B);
      assert.deepEqual(onServerBank.revs, { [setup.id]: 3 }, 'هر تغییر داده باید یک نسخه جلو برود: ' + JSON.stringify(onServerBank.revs));
      const audit = await httpCall(port, 'be:audit', loginOnServer.token, [60]);
      const staleAudit = (audit.rows || []).find(r => r.action === 'stale_write' && r.target === SUPPLIERS);
      assert.ok(staleAudit, 'رد نوشتنِ کهنه در ممیزی ثبت نشد: ' + JSON.stringify(audit).slice(0, 300));

      /* ۷) بند پ: ایستگاه ب نشسته و کاری نمی‌کند؛ ایستگاه الف همان فهرست را عوض می‌کند.
         ب باید نوار آبیِ «در ایستگاه دیگری تغییر کرد» را ببیند، ولی ردیف‌های روی میزش
         تا خودش «تازه‌سازی» نزند دست‌نخورده بمانند. */
      const idleB = await run(winB, `(async () => { const S = window.__S;
        return { banner: !!document.querySelector('.live-banner'), pageHasB: S.pageText().includes(S.MAT_B) }; })()`);
      assert.equal(idleB.banner, false, 'پیش از تغییرِ ایستگاه الف، نوار تغییر روی ایستگاه ب مانده است');
      assert.equal(idleB.pageHasB, true, 'ایستگاه ب رکورد خودش را روی میز ندارد');
      const stationALive = await run(win, `(async () => { const S = window.__S;
        await S.readRows();
        await S.openEditForm(S.MAT_C);
        await S.pressSave();
        return { materials: (await S.readRows())[0].materials }; })()`);
      assert.equal(stationALive.materials, MAT_C, 'ذخیرهٔ دومِ ایستگاه الف در بانک ننشست');
      const liveNotice = await run(winB, `(async () => { const S = window.__S;
        const banner = await S.waitFor(() => document.querySelector('.live-banner'), 'live change banner');
        return { text: banner.innerText, pageHasB: S.pageText().includes(S.MAT_B), pageHasC: S.pageText().includes(S.MAT_C) }; })()`);
      assert.match(liveNotice.text, /در ایستگاه دیگری تغییر کرده است/, 'متن نوار تغییر درست نیست: ' + liveNotice.text);
      assert.match(liveNotice.text, /تامین‌کننده‌ها/, 'نوار تغییر نام فهرست را نگفت');
      assert.equal(liveNotice.pageHasB, true, 'فهرست پیش از «تازه‌سازی» خودبه‌خود عوض شد');
      assert.equal(liveNotice.pageHasC, false, 'تغییر تازه پیش از تازه‌سازی روی میز آمد');
      await capture(winB, 'stale-5-station-b-live-notice.png');
      const refreshed = await run(winB, `(async () => { const S = window.__S;
        document.querySelector('.live-banner .live-banner-action').click();
        await S.pause(600);
        return { bannerGone: !document.querySelector('.live-banner'), pageHasC: S.pageText().includes(S.MAT_C) }; })()`);
      assert.equal(refreshed.bannerGone, true, 'نوار تغییر با «تازه‌سازی» بسته نشد');
      assert.equal(refreshed.pageHasC, true, 'تازه‌سازی فهرست را از بانک نخواند');

      /* کنترل منفی: تنها بانکِ این صحنه بانکِ سرور است؛ ایستگاه فایل SQLite نمی‌سازد. */
      const strayBanks = fs.readdirSync(fixtureDir, { recursive: true }).map(String)
        .filter(f => /\.db(-wal|-shm)?$/.test(f) && !f.includes('PrintShopData'));
      assert.deepEqual(strayBanks, [], 'ایستگاه بانک محلی ساخت: ' + strayBanks.join(','));

      console.log(JSON.stringify({ smoke: 'two-stations-one-record', pass: true, electron: process.versions.electron,
        port, serverHost: host, overLan, clientJson: useClientFile, fixtureDir, setup, stationBView, stationAEdit, refused, retried,
        serverMaterials: onServerBank.value.map(r => r.materials), revs: onServerBank.revs, staleAudit, liveNotice, refreshed,
        screenshots: shots }, null, 1));
      app.exit(0);
    } catch (error) {
      console.error(error && error.stack || String(error));
      console.error('server log:', serverLog.slice(0, 20).join(' | '));
      for (const w of BrowserWindow.getAllWindows()) {
        try { fs.writeFileSync(path.join(workDir, 'stale-failure-' + w.id + '.png'), (await w.webContents.capturePage()).toPNG()); } catch (_) { /* window may be gone */ }
      }
      console.error('screenshots:', shots.join(', '));
      app.exit(1);
    }
  }
})().catch(err => { console.error(String(err && err.stack || err)); try { if (serverChild) serverChild.kill(); } catch (_) { /* already dead */ } app.exit(1); });
