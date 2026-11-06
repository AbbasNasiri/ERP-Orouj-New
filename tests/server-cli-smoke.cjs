'use strict';
/* سنجش خطِ فرمان واقعیِ سرور (نه سرورِ درون پروسهٔ آزمون):
   node electron/shop-server.js --data=<پوشه> --port=<پورت> --host=0.0.0.0 --allow-lan
   سه چیز اندازه گرفته می‌شود:
   ۱) ایستگاه با IP واقعی کارت شبکه به سرورِ تازه‌بالاآمده می‌رسد و می‌خواند و می‌نویسد؛
   ۲) پروسهٔ سرور که وسط کار کشته شود، ایستگاه SERVER_UNREACHABLE می‌گیرد و چیزی نوشته نمی‌شود؛
   ۳) سرورِ دوباره روشن‌شده روی همان پورت و همان بانک، داده را نگه می‌دارد ولی نشستِ کهنه را می‌رد.
   اجرا: node tests/server-cli-smoke.cjs
   محدودیت صادقانه: هر دو «ایستگاه» روی همین یک ماشین‌اند؛ سوکت روی کارت شبکه واقعی می‌نشیند
   ولی دو کامپیوتر فیزیکی در این آزمون نیست (برای آن، کارفرما باید سرور را روی ماشین دیگر بیاورد). */
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServerClient } = require('../electron/server-client');

const ROOT = path.resolve(__dirname, '..');
const SERVER_SCRIPT = path.join(ROOT, 'electron', 'shop-server.js');
const CUSTOMERS = 'printshop_customers_v2';
const PASS = 'cli-smoke-strong-pass';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* بند ث: سرور کلید را خودش می‌سازد؛ ایستگاه تا کلید نرسد حتی یک درخواست نمی‌فرستد. */
async function readKey(dataDir) {
  const file = path.join(dataDir, 'lan-key.txt');
  for (let i = 0; i < 80; i++) {
    if (fs.existsSync(file)) { const key = fs.readFileSync(file, 'utf8').trim(); if (key) return key; }
    await sleep(100);
  }
  throw new Error('سرور کلید امنیتی را نساخت: ' + file);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      const family = String(a.family);
      if ((family === 'IPv4' || family === '4') && !a.internal) return a.address;
    }
  }
  return '';
}

let children = [];
function startServer(dataDir, port) {
  const child = spawn(process.execPath, [SERVER_SCRIPT, '--data=' + dataDir, '--port=' + port, '--host=0.0.0.0', '--allow-lan'], { cwd: ROOT, windowsHide: true });
  const log = [];
  child.stdout.on('data', (c) => log.push(String(c)));
  child.stderr.on('data', (c) => log.push(String(c)));
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  children.push({ child, exited });
  return { child, exited, log };
}
async function killAll() {
  for (const c of children) { try { c.child.kill(); } catch (_) { /* از پیش خاموش است */ } }
  for (const c of children) { try { await Promise.race([c.exited, sleep(3000)]); } catch (_) { /* کشتن اولویت دارد */ } }
}

function need(cond, message) { if (!cond) { console.error('FAIL: ' + message); process.exitCode = 1; throw new Error(message); } }

(async () => {
  const ip = lanAddress();
  need(!!ip, 'این ماشین نشانی شبکهٔ غیر-loopback ندارد');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-cli-smoke-'));
  const port = await freePort();
  const measured = { lanIp: ip, port, node: process.version, electron: process.versions.electron || null };

  try {
    const first = startServer(dataDir, port);
    const key = await readKey(dataDir);
    const station = createServerClient({ url: `http://${ip}:${port}`, key });
    const other = createServerClient({ url: `http://${ip}:${port}`, key });
    let up = { ok: false };
    for (let i = 0; i < 80 && !up.ok; i++) { up = await station.ping(); if (!up.ok) await sleep(100); }
    need(up.ok, 'سرورِ خط فرمان از راه IP شبکه پاسخ داد: ' + JSON.stringify(up));
    measured.info = up.info;

    /* فایل آمادهٔ ایستگاهی که سرور می‌نویسد باید خودش به همان بانک وصل شود؛
       کارفرما نباید نشانی و کلید را دستی از لاگ بردارد. */
    const setupFile = path.join(dataDir, 'station-setup', ip, 'client.json');
    need(fs.existsSync(setupFile), 'فایل آمادهٔ ایستگاه نوشته نشد: ' + setupFile);
    const setup = JSON.parse(fs.readFileSync(setupFile, 'utf8'));
    need(setup.mode === 'network' && setup.server === `http://${ip}:${port}` && setup.key === key, 'محتوای فایل آمادهٔ ایستگاه درست نیست: ' + JSON.stringify(setup));
    const unpacked = createServerClient({ url: setup.server, key: setup.key });
    need((await unpacked.ping()).ok === true, 'ایستگاهی که فقط از فایل آماده ساخته شده وصل می‌شود');
    measured.stationSetup = { file: setupFile, reachable: true };

    const login = await station.call('be:login', '', ['admin', '1234']);
    need(login.ok === true, 'ورود نخست از راه IP شبکه');
    const changed = await station.call('be:setOwnPassword', login.token, [PASS]);
    need(changed.ok === true, 'تغییر رمز نخست از راه IP شبکه');
    const token = (await station.call('be:login', '', ['admin', PASS])).token;
    const otherToken = (await other.call('be:login', '', ['admin', PASS])).token;
    need(token && otherToken && token !== otherToken, 'هر ایستگاه نشست خودش را دارد');
    measured.sessions = { station: true, other: true };

    const read = await station.call('be:get', token, [CUSTOMERS]);
    need(read.ok === true, 'خواندن از راه IP شبکه');
    const saved = await station.call('be:set', token, [CUSTOMERS, [{ id: 'cli-1', name: 'مشتریِ خط فرمان' }], read.revs]);
    need(saved.ok === true, 'ذخیره با بردار نسخه از راه IP شبکه: ' + JSON.stringify(saved));
    const otherRead = await other.call("be:get", otherToken, [CUSTOMERS]);
    const refused = await other.call("be:set", otherToken, [CUSTOMERS, [{ ...otherRead.value[0], name: "از ایستگاه دوم" }], null]);
    need(refused.code === 'MISSING_VERSION', 'ایستگاه دوم بدون نسخه رد می‌شود، نه پذیرفته: ' + JSON.stringify(refused));
    measured.wire = { writeRev: saved.revs['cli-1'], refusal: refused.code };

    /* سرور می‌میرد، وسط کار. */
    first.child.kill();
    const code = await Promise.race([first.exited, sleep(5000)]);
    measured.serverExitCode = code;
    const down = await station.call('be:get', token, [CUSTOMERS]);
    need(down.ok === false && down.code === 'SERVER_UNREACHABLE', 'خاموشی سرور به شکل نرسیدن گزارش می‌شود: ' + JSON.stringify(down));
    const lostWrite = await station.call('be:set', token, [CUSTOMERS, [{ id: 'cli-2', name: 'کارِ بعد از خاموشی' }], saved.revs]);
    need(lostWrite.ok === false, 'در زمان خاموشی نوشتن پذیرفته نمی‌شود');
    measured.down = { read: down.code, write: lostWrite.code };

    /* همان پورت، همان بانک. */
    const second = startServer(dataDir, port);
    let revived = { ok: false };
    for (let i = 0; i < 80 && !revived.ok; i++) { revived = await station.ping(); if (!revived.ok) await sleep(100); }
    need(revived.ok, 'سرورِ دوباره روی همان پورت بالا آمد');
    const staleSession = await station.call('be:get', token, [CUSTOMERS]);
    need(staleSession.code === 'UNAUTHENTICATED', 'نشستِ پروسهٔ پیشین باطل است: ' + JSON.stringify(staleSession));
    const fresh = await station.call('be:login', '', ['admin', PASS]);
    const after = await station.call('be:get', fresh.token, [CUSTOMERS]);
    const ids = (after.value || []).map((c) => c.id);
    need(JSON.stringify(ids) === JSON.stringify(['cli-1']), 'کارِ ذخیره‌شده مانده و کارِ ردشده نوشته نشده: ' + JSON.stringify(ids));
    need(after.revs['cli-1'] === 1, 'شمارۀ نسخه هم روی دیسک مانده است: ' + JSON.stringify(after.revs));
    measured.restart = { ids, revs: after.revs, staleSessionCode: staleSession.code };
    /* کنترل منفی روی همان سرور واقعی: ایستگاهِ بی‌کلید هیچ کاری نمی‌تواند بکند. */
    const stranger = createServerClient({ url: `http://${ip}:${port}`, key: require('../electron/lan-crypto').makeKey() });
    const strangerRead = await stranger.call('be:get', fresh.token, [CUSTOMERS]);
    need(strangerRead.ok === false && strangerRead.code === 'BAD_ENVELOPE', 'کلید اشتباه باید بسته را رد کند: ' + JSON.stringify(strangerRead));
    measured.wrongKey = strangerRead.code;
    second.child.kill();
    await Promise.race([second.exited, sleep(5000)]);
    measured.journal = first.log.join('');

    /* پشتیبان دستی از خط فرمان همان مسیری است که کارفرما روی سرور اجرا می‌کند. */
    const backup = spawn(process.execPath, [SERVER_SCRIPT, '--data=' + dataDir, '--backup'], { cwd: ROOT, windowsHide: true });
    const backupCode = await new Promise((resolve) => backup.once('exit', resolve));
    const backups = fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.endsWith('.db')) : [];
    need(backupCode === 0 && backups.length === 1, 'پشتیبان دستی خط فرمان ساخته نشد: code=' + backupCode + ' files=' + JSON.stringify(backups));
    measured.backup = { exitCode: backupCode, files: backups };

    console.log(JSON.stringify({ smoke: 'server-cli-lan', pass: process.exitCode !== 1, ...measured }, null, 1));
  } finally {
    await killAll();
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
  }
})().catch(async (err) => { console.error(String((err && err.stack) || err)); await killAll(); process.exit(1); });
