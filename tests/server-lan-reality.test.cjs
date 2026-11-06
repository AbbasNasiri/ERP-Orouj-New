'use strict';
/* سه چیزی که آزمون‌های لایهٔ انتقال نمی‌سنجیدند:
   ۱) سرور روی کارت شبکه می‌نشیند و ایستگاه با IP واقعی شبکه (نه 127.0.0.1) به آن می‌رسد؛
   ۲) سروری که --allow-lan ندارد درخواستی که به IP شبکه نشانه رفته را رد می‌کند؛
   ۳) اگر سرور وسط کار از پا دربیاید، ایستگاه باید ببندَد و بانک خالی نبیند؛ پس از بالا آمدن
      دوباره، داده روی دیسک می‌ماند ولی نشستِ کهنه باطل است.
   سرور همین‌جا درون پروسهٔ آزمون ساخته می‌شود ولی از همان ورودی فرمان خط‌افزاری می‌گذرد
   (parseArgs) و روی همان سوکت واقعی listen می‌کند؛ راه‌اندازی پروسهٔ جدا روی ویندوز
   آزمون‌دهنده را می‌خواباند، برای همین مسیر خط‌افزار در tests/server-cli-smoke.cjs سنجیده می‌شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createBackend } = require('../electron/backend');
const { createShopServer, parseArgs } = require('../electron/shop-server');
const { createServerClient } = require('../electron/server-client');
const { makeKey, parseKey, sealRequest } = require('../electron/lan-crypto');

const CUSTOMERS = 'printshop_customers_v2';
const KEY_B64 = makeKey();
const KEY = parseKey(KEY_B64);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
  });
}

/* نشانی واقعی کارت شبکه. اگر ماشینی کارت فعال نداشته باشد آزمون روشن می‌ایستد تا
   «شبکه کار می‌کند» با «عبور از آزمونِ بی‌IP» اشتباه شود. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      const family = String(a.family);
      if ((family === 'IPv4' || family === '4') && !a.internal) return a.address;
    }
  }
  return '';
}

async function listen(server, port, host) {
  for (let i = 0; i < 20; i++) {
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); return; }
    catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      await sleep(200); // پورتِ تازه‌ها خاموش‌شده ممکن است لحظه‌ای در اشغال بماند
    }
  }
  throw new Error('پورت ' + port + ' پس از بی تلاش آزاد نشد.');
}

function upFixture(t, { lan }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-lan-reality-'));
  const state = { dataDir, port: 0, backend: null, server: null };
  state.stop = async () => {
    if (state.server) { const s = state.server; state.server = null; s.closeAllConnections?.(); await new Promise((resolve) => s.close(resolve)); }
    if (state.backend) { const b = state.backend; state.backend = null; b.close(); }
  };
  state.start = async (port) => {
    /* همان parseArgs خط فرمان: ایستگاهِ LAN فقط با --allow-lan روی کارت شبکه می‌نشیند. */
    const cfg = parseArgs(lan ? ['--data=' + dataDir, '--port=' + port, '--host=0.0.0.0', '--allow-lan'] : ['--data=' + dataDir, '--port=' + port]);
    state.port = cfg.port;
    state.backend = createBackend({ dataDir });
    state.server = createShopServer({ backend: state.backend, backupDir: path.join(dataDir, 'backups'), key: KEY, port: cfg.port, loopbackOnly: cfg.loopback });
    await listen(state.server, cfg.port, lan ? '0.0.0.0' : '127.0.0.1');
    return state;
  };
  t.after(async () => { await state.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return state;
}

/* مدیرِ پیش‌فرض تا رمز نخست را عوض نکند هیچ کانال کاری‌ای را نمی‌گذراند؛ ایستگاه تازه‌نصب
   هم دقیقاً همین مسیر را می‌رود، پس آزمون هم از همان مسیر می‌رود. */
async function loginReady(client) {
  const first = await client.call('be:login', '', ['admin', '1234']);
  assert.equal(first.ok, true, 'ورود مدیر پیش‌فرض: ' + JSON.stringify(first));
  const changed = await client.call('be:setOwnPassword', first.token, ['lan-reality-strong-pass']);
  assert.equal(changed.ok, true, 'تغییر رمز نخست از راه شبکه: ' + JSON.stringify(changed));
  const again = await client.call('be:login', '', ['admin', 'lan-reality-strong-pass']);
  assert.equal(again.ok, true, 'ورود با رمز تازه');
  return again.token;
}

async function pingUntilUp(client) {
  for (let i = 0; i < 60; i++) { const p = await client.ping(); if (p.ok) return p; await sleep(100); }
  throw new Error('سرور بالا نیامد: ' + client.url);
}

test('a station reaches the server by its real LAN IP, not only by loopback', async (t) => {
  const ip = lanAddress();
  assert.ok(ip, 'این ماشین هیچ نشانی شبکهٔ غیر-loopback ندارد؛ ادعای «شبکه کار می‌کند» ساخته نمی‌شود.');
  const f = upFixture(t, { lan: true });
  await f.start(await freePort());
  const station = createServerClient({ url: `http://${ip}:${f.port}`, key: KEY_B64 });
  const up = await pingUntilUp(station);
  assert.equal(up.info.backend, 'sqlite', 'be:info از راه IP شبکه پاسخ می‌دهد');

  const token = await loginReady(station);
  const read = await station.call('be:get', token, [CUSTOMERS]);
  assert.equal(read.ok, true, 'خواندن از راه نشانی شبکه: ' + JSON.stringify(read));
  const saved = await station.call('be:set', token, [CUSTOMERS, [{ id: 'lan-ip-1', name: 'مشتریِ شبکه' }], read.revs]);
  assert.equal(saved.ok, true, 'نوشتن با بردار نسخه از راه نشانی شبکه: ' + JSON.stringify(saved));
  assert.equal(saved.revs['lan-ip-1'], 1, 'شمارۀ نسخۀ رکورد از راه شبکه هم درست برمی‌گردد');
  const back = await station.call('be:get', token, [CUSTOMERS]);
  assert.deepEqual(back.value.map((c) => c.id), ['lan-ip-1'], 'رکوردِ نوشته‌شده از همان نشانی دوباره خوانده می‌شود');

  /* ایستگاه دومِ همان بانک، با نشستِ جدا: همان رکوردِ درستِ مجوز را می‌فرستد ولی نسخۀ خوانده‌شده
     ندارد، پس به دروازۀ بند ب می‌خورد — نه به دروازۀ نقش، و نه به دروازۀ اعتبارسنجی. */
  const other = createServerClient({ url: `http://${ip}:${f.port}`, key: KEY_B64 });
  const otherToken = await loginSecond(other, token);
  const known = back.value[0];
  const blind = await other.call('be:set', otherToken, [CUSTOMERS, [{ ...known, name: 'از ایستگاه دوم' }], null]);
  assert.equal(blind.code, 'MISSING_VERSION', 'نوشتنِ بی‌نسخه از راه IP شبکه رد می‌شود');
  const staleVector = await other.call('be:set', otherToken, [CUSTOMERS, [{ ...known, name: 'از ایستگاه دوم' }], { 'lan-ip-1': 7 }]);
  assert.equal(staleVector.code, 'STALE_RECORD', 'بردار نسخۀ نادرست از راه شبکه هم رد می‌شود');
  const stillAfter = await station.call('be:get', token, [CUSTOMERS]);
  assert.equal(stillAfter.value[0].name, 'مشتریِ شبکه', 'هیچ‌یک از دو نوشتنِ ردشده چیزی را عوض نکرد');
  assert.equal(stillAfter.revs['lan-ip-1'], 1, 'شمارۀ نسخۀ رکورد هم تکان نخورد');
});

test('a station on the LAN with another key cannot reach the bank', async (t) => {
  const ip = lanAddress();
  assert.ok(ip, 'این ماشین هیچ نشانی شبکهٔ غیر-loopback ندارد؛ ادعای «شبکه کار می‌کند» ساخته نمی‌شود.');
  const f = upFixture(t, { lan: true });
  await f.start(await freePort());
  const stranger = createServerClient({ url: `http://${ip}:${f.port}`, key: makeKey() });
  /* دسترسیِ بدون کلید درست، حتی به info، نباید چیزی از سرور بگیرد. */
  const info = await stranger.ping();
  assert.equal(info.ok, false);
  assert.equal(info.code, 'BAD_ENVELOPE');
  const attempt = await stranger.call('be:login', '', ['admin', '1234']);
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, 'BAD_ENVELOPE');
  assert.equal(attempt.token, undefined, 'هیچ نشستی ساخته نشد');
  /* کنترل مثبت: بانک دست‌نخورده و همان ایستگاهِ دارای کلید کار می‌کند. */
  const known = createServerClient({ url: `http://${ip}:${f.port}`, key: KEY_B64 });
  await pingUntilUp(known);
  const login = await known.call('be:login', '', ['admin', '1234']);
  assert.equal(login.ok, true, 'رمز مدیر پیش‌فرض تغییر نکرده است');
  assert.equal(login.user.mustChange, true, 'حسابِ مدیر هنوز در وضعیت «تغییر رمز نخست» است؛ کلید اشتباه چیزی را عوض نکرد');
});

/* نشستِ دوم با همان حساب: رمز دیگر عوض شده، پس ورود مستقیم می‌آید. */
async function loginSecond(client, firstToken) {
  const r = await client.call('be:login', '', ['admin', 'lan-reality-strong-pass']);
  assert.equal(r.ok, true, 'ورود ایستگاه دوم: ' + JSON.stringify(r));
  assert.notEqual(r.token, firstToken, 'هر ایستگاه نشستِ خودش را دارد');
  return r.token;
}

test('a server without --allow-lan refuses a request addressed to the LAN IP', async (t) => {
  const ip = lanAddress();
  const f = upFixture(t, { lan: false });
  await f.start(await freePort());
  assert.equal(f.server.listening, true, 'سرورِ فقط-loopback روی 127.0.0.1 نشسته است');

  /* درخواست به خودِ سوکت می‌رسد ولی سربند Host نشانی شبکه است: پذیرفتنش یعنی هر صفحه‌ای
     در مرورگر میزبان بتواند از راه DNS rebinding به بانک برسد. */
  const answered = (hostHeader) => new Promise((resolve, reject) => {
    const body = JSON.stringify(sealRequest(KEY, { channel: 'be:info', args: [] }));
    const req = http.request({ host: '127.0.0.1', port: f.port, method: 'POST', path: '/rpc', headers: { host: hostHeader, 'content-type': 'application/json' } }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(4000, () => { req.destroy(new Error('in-process ایستگاه پاسخ نداد')); });
    req.end(body);
  });
  if (ip) {
    const refused = await answered(`${ip}:${f.port}`);
    assert.equal(refused.status, 403, 'درخواستِ نشانه‌رفته به IP شبکه رد می‌شود');
    assert.equal(JSON.parse(refused.body).code, 'FORBIDDEN');
  }
  const allowed = await answered(`127.0.0.1:${f.port}`);
  assert.equal(allowed.status, 200, 'کنترل مثبت: همان درخواست با Host حلقوی پذیرفته می‌شود');
});

test('a server that dies mid-work blocks the station, and a restarted server keeps the data but drops the session', async (t) => {
  const f = upFixture(t, { lan: true });
  const port = await freePort();
  await f.start(port);
  const station = createServerClient({ url: `http://127.0.0.1:${port}`, key: KEY_B64 });
  await pingUntilUp(station);
  const token = await loginReady(station);
  const read = await station.call('be:get', token, [CUSTOMERS]);
  const saved = await station.call('be:set', token, [CUSTOMERS, [{ id: 'kept', name: 'کارِ قبل از خاموشی' }], read.revs]);
  assert.equal(saved.ok, true, 'کار اولیه ذخیره می‌شود');

  await f.stop(); // همان چیزی که کشیدنِ پروسهٔ سرور یا خاموش‌شدنِ کامپیوتر سرور می‌کند
  const gone = await station.call('be:get', token, [CUSTOMERS]);
  assert.equal(gone.ok, false, 'ایستگاه بانک را خالی نمی‌بیند');
  assert.equal(gone.code, 'SERVER_UNREACHABLE', 'خاموشی سرور به شکل «نرسیدن» گزارش می‌شود');
  const attempt = await station.call('be:set', token, [CUSTOMERS, [{ id: 'lost', name: 'کارِ بعد از خاموشی' }], saved.revs]);
  assert.equal(attempt.ok, false, 'در زمان خاموشی هیچ نوشتنی پذیرفته نمی‌شود');

  await f.start(port); // همان پورت، همان پوشهٔ بانک
  const revived = await pingUntilUp(station);
  assert.equal(revived.ok, true, 'ایستگاه سرورِ دوباره روشن‌شده را می‌بیند');
  const staleSession = await station.call('be:get', token, [CUSTOMERS]);
  assert.equal(staleSession.code, 'UNAUTHENTICATED', 'نشستِ پروسهٔ پیشین باطل است؛ ایستگاه باید دوباره وارد شود');
  const fresh = await station.call('be:login', '', ['admin', 'lan-reality-strong-pass']);
  const after = await station.call('be:get', fresh.token, [CUSTOMERS]);
  assert.deepEqual((after.value || []).map((c) => c.id), ['kept'], 'کارِ ذخیره‌شده مانده و کارِ ردشده نوشته نشده است');
  assert.equal(after.revs.kept, 1, 'شمارۀ نسخۀ رکورد هم روی دیسک مانده است');
});
