'use strict';
/* بند الف: سرور LAN + ایستگاه شبکه‌ای.
   این آزمون‌ها سرور واقعی را روی 127.0.0.1 بلند می‌کنند و همان موتور backend.js را
   از مسیر HTTP امتحان می‌کنند؛ هیچ دروازه‌ای شل نمی‌شود و کنترل منفی هم دارند. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { CHANNELS, invoke } = require('../electron/channels');
const { createShopServer, parseArgs, hostAllowed, originAllowed } = require('../electron/shop-server');
const { createServerClient, parseServerUrl } = require('../electron/server-client');
const { resolveClientMode } = require('../electron/client-config');
const { makeKey, parseKey, sealRequest, loadOrCreateKey } = require('../electron/lan-crypto');

const M = 'مدیر چاپخانه', C = 'کارشناس سفارشات', S = 'انباردار';
const ORDERS = 'printshop_orders_v5';
const CUSTOMERS = 'printshop_customers_v2';
/* بند ث: هر اجرا کلید تازه؛ کلید ثابت در سورس یعنی کلید لو رفته. */
const KEY_B64 = makeKey();
const KEY = parseKey(KEY_B64);
const OTHER_KEY = parseKey(makeKey());

function openDb(file) {
  const raw = new DatabaseSync(file);
  return {
    exec: sql => raw.exec(sql), run: (sql, ...p) => raw.prepare(sql).run(...p),
    get: (sql, ...p) => raw.prepare(sql).get(...p), all: (sql, ...p) => raw.prepare(sql).all(...p),
    tx(fn) { raw.exec('BEGIN'); try { const r = fn(); raw.exec('COMMIT'); return r; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
    close: () => raw.close(),
  };
}

function backendFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-lan-'));
  const b = createBackend({ dataDir: dir, openDb });
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const admin = b.login('admin', '1234').token;
  assert.equal(b.setOwnPassword(admin, 'admin-test-strong').ok, true);
  const users = b.listUsers(admin).users;
  for (const [id, role] of [['clerk', C], ['store', S]]) users.push({ id, username: id, name: id, role, active: true, _plain: 'strong-test-pass' });
  assert.equal(b.saveUsers(admin, users).ok, true);
  return { b, dir, admin, clerk: b.login('clerk', 'strong-test-pass').token, store: b.login('store', 'strong-test-pass').token };
}

/* createShopServer شمارهٔ پورت را برای بررسی Host می‌گیرد، پس پورت آزاد را از پیش
   پیدا می‌کنیم و همان عدد را به سرور می‌دهیم (نه listen(0)). */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function lanFixture(t, options = {}) {
  const f = backendFixture(t);
  const port = await freePort();
  const server = createShopServer({ backend: f.b, backupDir: path.join(f.dir, 'backups'), key: KEY, port, loopbackOnly: true, ...options });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${port}`;
  const clients = new Map();
  return {
    ...f, port, url, server, key: KEY_B64,
    client(name = 'main') {
      if (!clients.has(name)) clients.set(name, createServerClient({ url, key: KEY_B64 }));
      return clients.get(name);
    },
  };
}

/* درخواست خام HTTP برای آزمون‌های لایهٔ انتقال که createServerClient آن‌ها را نمی‌سازد.
   بدنه دستی ساخته می‌شود تا هر آزمون بتواند عمداً چیزی را خراب کند. */
function rawRequest(port, { method = 'POST', path: name = 'rpc', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, host: '127.0.0.1', method, path: '/' + name, headers }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const sealed = (channel, token, args, key = KEY) => JSON.stringify(sealRequest(key, { channel, token: token || '', args: args || [] }));
const json = (token, args, channel = 'be:get', key = KEY) => ({
  headers: { 'content-type': 'application/json' },
  body: sealed(channel, token, args, key),
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a station logs in, reads and writes through the real LAN server', async t => {
  const f = await lanFixture(t);
  const client = f.client();
  const login = await client.call('be:login', '', ['clerk', 'strong-test-pass']);
  assert.equal(login.ok, true);
  assert.equal(login.user.role, C);
  const empty = await client.call('be:get', login.token, [CUSTOMERS]);
  assert.equal(empty.ok, true);
  assert.equal(empty.value, null, 'بانک تازه هیچ رکوردی ندارد');
  const saved = await client.call('be:set', login.token, [CUSTOMERS, [{ id: 'c1', name: 'کتابفروشی نمونه' }], empty.revs]);
  assert.equal(saved.ok, true, 'اولین نوشتنِ دارای نسخه پذیرفته می‌شود');
  assert.deepEqual(saved.revs, { c1: 1 }, 'اولین نسخهٔ هر رکورد ۱ است');
  const readBack = await client.call('be:get', login.token, [CUSTOMERS]);
  assert.equal(readBack.value[0].name, 'کتابفروشی نمونه');
  assert.deepEqual(readBack.revs, { c1: 1 });
  assert.deepEqual(f.b.get(f.clerk, CUSTOMERS).value, readBack.value, 'the server bank is the one that changed');
  /* نوشتنِ دوباره با بردارِ پیشین باید رد شود و بانک دست‌نخورده بماند.
     رکورد همان چیزی است که سرور ساخته (کد و صلاحیت را خودش پر می‌کند)، پس تنها
     نام عوض می‌شود و تضادِ نسخه به دروازۀ نقش یا اعتبارسنجی داده نمی‌خورد. */
  const again = await client.call('be:set', login.token, [CUSTOMERS, [{ ...readBack.value[0], name: 'سرور دیگری این را نوشت' }], empty.revs]);
  assert.equal(again.ok, false);
  assert.equal(again.code, 'STALE_RECORD');
  assert.deepEqual(again.stale, ['c1']);
  assert.equal(Object.hasOwn(again, 'revs'), false, 'پاسخ تضاد نباید بردار تازه بدهد: ایستگاه مجبور است دوباره بخواند');
  assert.equal((await client.call('be:get', login.token, [CUSTOMERS])).value[0].name, 'کتابفروشی نمونه', 'درخواست بی‌نسخهٔ درست چیزی را عوض نکرد');
  const fresh = await client.call('be:set', login.token, [CUSTOMERS, [{ ...readBack.value[0], name: 'با نسخهٔ درست' }], readBack.revs]);
  assert.equal(fresh.ok, true, 'با بردار نسخهٔ تازه همان نوشتن پذیرفته می‌شود');
  assert.deepEqual(fresh.revs, { c1: 2 }, 'هر تغییر داده یک نسخه جلو می‌رود');
});

test('ping and info answer without a session token', async t => {
  const f = await lanFixture(t);
  const ping = await f.client().ping();
  assert.equal(ping.ok, true);
  assert.equal(ping.info.backend, 'sqlite');
});

test('names outside the channel table cannot be reached, not even the engine internals', async t => {
  const f = await lanFixture(t);
  for (const name of ['_db', 'close', 'auditRows', 'be:close', 'be:_sessions', 'be:auditRows', 'be:get2', '']) {
    const r = await f.client().call(name, f.clerk, [ORDERS]);
    assert.equal(r.ok, false, name);
    assert.equal(r.code, 'FORBIDDEN', name);
  }
  assert.equal(f.b.get(f.clerk, ORDERS).ok, true, 'the bank is still open after the refused calls');
  const local = invoke('close', f.b, { backupDir: f.dir }, f.clerk, []);
  assert.equal(local.ok, false);
  assert.equal(local.code, 'FORBIDDEN');
});

test('a request without a usable session token is refused before the engine is touched', async t => {
  const f = await lanFixture(t);
  for (const token of ['', 'short', 'not-base64-!!', 'a'.repeat(200)]) {
    const r = await f.client().call('be:get', token, [ORDERS]);
    assert.equal(r.ok, false, token.slice(0, 6));
    assert.equal(r.code, 'UNAUTHENTICATED', token.slice(0, 6));
  }
});

test('the role gate is exactly as strict over the network as in the process', async t => {
  const f = await lanFixture(t);
  const denied = await f.client().call('be:set', f.store, [ORDERS, []]);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'FORBIDDEN');
  /* بند ۱: انباردار برای دیدن تابلو سفارش‌ها را می‌خواند؛ نوشتن همچنان ممنوع است. */
  const storeRead = await f.client().call('be:get', f.store, [ORDERS]);
  assert.equal(storeRead.ok, true, 'انباردار از راه شبکه نتوانست سفارش‌ها را بخواند');
  const audit = f.b.auditRows(50).find(row => row.action === 'denied_write' && row.target === ORDERS);
  assert.ok(audit, 'a refused network write is audited like a refused local write');
  const clerkWrite = await f.client().call('be:set', f.clerk, [ORDERS, [], (await f.client().call('be:get', f.clerk, [ORDERS])).revs]);
  assert.equal(clerkWrite.ok, true);
  /* کنترل منفی: با حسابِ مجاز هم نوشتنِ بی‌نسخه از راه شبکه پذیرفته نمی‌شود.
     سفارش همان شکلی است که کارشناس مجاز به ثبت آن است؛ دروازۀ نقش و اعتبارسنجی
     داده پیش از بررسیِ نسخه جواب می‌دهند، پس این آزمون دقیقاً MISSING_VERSION را می‌بیند. */
  const blindOrder = { id: 'o-blind', status: 'در انتظار تایید', items: [] };
  const blind = await f.client().call('be:set', f.clerk, [ORDERS, [blindOrder]]);
  assert.equal(blind.ok, false);
  assert.equal(blind.code, 'MISSING_VERSION');
  assert.deepEqual((await f.client().call('be:get', f.clerk, [ORDERS])).value, [], 'درخواست بی‌نسخه چیزی ننوشت');
  const garbage = await f.client().call('be:set', f.clerk, [ORDERS, [blindOrder], 'همه‌چیز نو است']);
  assert.equal(garbage.code, 'VALIDATION_FAILED', 'بردار نسخهٔ بی‌شکل باید رد شود، نه این‌که بی‌بردار حساب شود');
  /* روی سیم JSON، آرگومانِ نگذشته به شکل null می‌رسد؛ همان «بی‌نسخه» است، نه بردارِ بی‌شکل. */
  const nullVector = await f.client().call('be:set', f.clerk, [ORDERS, [blindOrder], null]);
  assert.equal(nullVector.code, 'MISSING_VERSION', 'null باید مثل نبودِ بردار نسخه رفتار کند');
});

test('money that a role may not see stays hidden on the network path', async t => {
  const f = await lanFixture(t);
  const order = {
    id: 'o1', orderNumber: '1001', status: 'در انتظار تایید', customerId: 'c1', createdAt: 1, discount: '1500000',
    items: [{ id: 'i1', stage: 'ثبت سفارش', qty: '2000', unitPrice: '500000', services: [{ id: 's1', serviceType: 'چاپ', price: '900000' }] }],
    payments: [], history: [],
  };
  assert.equal(f.b.set(f.admin, ORDERS, [order]).ok, true, 'only the manager may write the amounts');
  /* بند ۲/۲: ردیف پرداخت از مسیر سفارش نوشته نمی‌شود؛ رقمِ دریافتی مثل رکوردِ واقعیِ
     بانکِ صاحب کار روی همان رکورد کاشته می‌شود تا پاک‌شدنِ آن از دیدِ بی‌رقم بسنجیم. */
  f.b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?',
    JSON.stringify({ ...order, payments: [{ id: 'p1', amount: '5000000' }] }), ORDERS, 'o1');
  const asClerk = await f.client().call('be:get', f.clerk, [ORDERS]);
  assert.equal(asClerk.ok, true, 'کارشناس سفارشات may read the list');
  assert.equal(asClerk.value[0].discount, '');
  assert.deepEqual(asClerk.value[0].payments, []);
  assert.equal(asClerk.value[0].items[0].unitPrice, '');
  assert.equal(asClerk.value[0].items[0].services[0].price, '');
  const asManager = await f.client().call('be:get', f.admin, [ORDERS]);
  assert.equal(asManager.value[0].items[0].services[0].price, '900000', 'the same record keeps its money for مدیر مالی/مدیر');
  /* بند ۱: انباردار هم همین فهرست را می‌خواند — با همان پاک‌شدنِ مبالغ. */
  const asStore = await f.client().call('be:get', f.store, [ORDERS]);
  assert.equal(asStore.ok, true, 'انباردار از راه شبکه سفارش‌ها را برای تابلو نخواند');
  assert.equal(asStore.value[0].items[0].unitPrice, '', 'بهای قلم از راه شبکه به انباردار رسید');
  assert.equal(asStore.value[0].items[0].services[0].price, '', 'بهای خدمت از راه شبکه به انباردار رسید');
  assert.deepEqual(asStore.value[0].payments, [], 'پرداخت‌ها از راه شبکه به انباردار رسید');
});

test('two stations writing at the same moment: the blind one is refused, then both records survive', async t => {
  const f = await lanFixture(t);
  const a = f.client('a'), b = f.client('b');
  const first = await a.call('be:get', f.clerk, [CUSTOMERS]);
  assert.equal(first.ok, true);
  await sleep(5);
  const second = await b.call('be:get', f.store, [CUSTOMERS]);
  assert.equal(second.ok, true);
  await sleep(5);
  const writeA = await a.call('be:set', f.clerk, [CUSTOMERS, [...(first.value || []), { id: 'c-a', name: 'ایستگاه الف' }], first.revs]);
  assert.equal(writeA.ok, true);
  await sleep(5);
  /* ایستگاه ب فهرستی می‌فرستد که رکورد الف در آن نیست: یعنی حذفش. باید رد شود. */
  const writeB = await b.call('be:set', f.store, [CUSTOMERS, [...(second.value || []), { id: 'c-b', name: 'ایستگاه ب' }], second.revs]);
  assert.equal(writeB.ok, false);
  assert.equal(writeB.code, 'STALE_RECORD');
  assert.deepEqual(writeB.stale, ['c-a'], 'باید بگوید کدام رکورد را ندیده‌اید');
  const afterRefusal = (await a.call('be:get', f.clerk, [CUSTOMERS])).value.map(r => r.id).sort();
  assert.deepEqual(afterRefusal, ['c-a'], 'درخواست ردشده نباید رکورد ایستگاه الف را پاک کند');
  const third = await b.call('be:get', f.store, [CUSTOMERS]);
  const retry = await b.call('be:set', f.store, [CUSTOMERS, [...third.value, { id: 'c-b', name: 'ایستگاه ب' }], third.revs]);
  assert.equal(retry.ok, true, 'پس از تازه‌سازی همان نوشتن پذیرفته می‌شود');
  const ids = (await a.call('be:get', f.clerk, [CUSTOMERS])).value.map(r => r.id).sort();
  assert.deepEqual(ids, ['c-a', 'c-b'], 'هر دو رکورد می‌مانند');
});

test('transport failures are reported as failures, never as an empty bank', async t => {
  const f = await lanFixture(t);
  const port = f.port;
  await new Promise(resolve => f.server.close(resolve));
  const r = await f.client().call('be:get', f.clerk, [CUSTOMERS]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SERVER_UNREACHABLE');
  assert.match(r.error, /شبکهٔ محلی/);
  assert.equal(r.value, undefined, 'no silent local fallback and no empty array');
  const ping = await createServerClient({ url: `http://127.0.0.1:${port}`, key: KEY_B64 }).ping();
  assert.equal(ping.ok, false);
  assert.equal(ping.code, 'SERVER_UNREACHABLE');
});

test('a server that accepts but never answers is a timeout, never empty data', async t => {
  const silent = http.createServer(() => { /* عمداً بدون پاسخ */ });
  await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => silent.close(resolve)));
  const client = createServerClient({ url: `http://127.0.0.1:${silent.address().port}`, key: KEY_B64, timeoutMs: 200 });
  const r = await client.call('be:get', 'x'.repeat(48), [CUSTOMERS]);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'REQUEST_TIMEOUT');
  assert.match(r.error, /انجام نشد/);
});

test('an unreachable address and a bad server URL behave predictably', () => {
  assert.equal(parseServerUrl('not a url'), null);
  assert.equal(parseServerUrl('ftp://127.0.0.1:21'), null);
  assert.equal(parseServerUrl(''), null);
  assert.ok(parseServerUrl('http://192.168.1.10:8443'));
  assert.throws(() => createServerClient({ url: 'garbage', key: KEY_B64 }), /نشانی سرور معتبر نیست/);
  assert.throws(() => createServerClient({ url: 'http://192.168.1.10:8443' }), /کلید امنیتی شبکه/);
  assert.throws(() => createServerClient({ url: 'http://192.168.1.10:8443', key: 'short' }), /کلید امنیتی شبکه/);
});

test('the wire refuses anything that is not a station request', async t => {
  const f = await lanFixture(t);
  const get = await rawRequest(f.port, { method: 'GET' });
  assert.equal(get.status, 405);
  const origin = await rawRequest(f.port, { ...json(f.clerk, [ORDERS]), headers: { 'content-type': 'application/json', origin: 'https://evil.example' } });
  assert.equal(origin.status, 403);
  const contentType = await rawRequest(f.port, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(contentType.status, 415);
  const broken = await rawRequest(f.port, { ...json(f.clerk, [ORDERS]), body: '{"args":[' });
  assert.equal(broken.status, 400);
  /* بدنهٔ JSON سالم ولی «پاکت» نیست: نامِ کانال و توکن روی سیم دیده نمی‌شوند. */
  const notEnvelope = await rawRequest(f.port, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'be:get', token: f.clerk, args: [ORDERS] }) });
  assert.equal(notEnvelope.status, 400);
  assert.match(JSON.parse(notEnvelope.body).error, /بستهٔ امنیتی/);
  const oldPath = await rawRequest(f.port, { path: 'be:get', ...json(f.clerk, [ORDERS]) });
  assert.equal(oldPath.status, 404, 'فقط /rpc وجود دارد؛ نشانی‌های قبلی بسته‌اند');
  const spoofedHost = await rawRequest(f.port, { ...json(f.clerk, [ORDERS]), headers: { 'content-type': 'application/json', host: 'dns-rebind.invalid:' + f.port } });
  assert.equal(spoofedHost.status, 403);
  for (const r of [get, origin, contentType, broken, notEnvelope, oldPath, spoofedHost]) {
    const payload = JSON.parse(r.body);
    assert.equal(payload.ok, false, r.body);
    assert.ok(payload.error, r.body);
  }
});

test('a station without the key, with another key, or with a tampered packet gets nothing', async t => {
  const f = await lanFixture(t);
  const before = f.b.get(f.clerk, CUSTOMERS);
  const wrongKey = await rawRequest(f.port, { ...json(f.clerk, [CUSTOMERS], 'be:get', OTHER_KEY) });
  assert.equal(wrongKey.status, 400);
  assert.equal(JSON.parse(wrongKey.body).code, 'BAD_ENVELOPE');
  /* کنترل منفی: تغییر یک حرف در متن رمزشده نباید رمزگشایی موفق یا نوشتن بسازد. */
  const envelope = JSON.parse(sealed('be:set', f.clerk, [CUSTOMERS, [{ id: 'c-evil', name: 'دستکاری‌شده' }], before.revs]));
  const at = Math.floor(envelope.c.length / 2);
  envelope.c = envelope.c.slice(0, at) + (envelope.c[at] === 'A' ? 'B' : 'A') + envelope.c.slice(at + 1);
  const tampered = await rawRequest(f.port, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope) });
  assert.equal(tampered.status, 400);
  assert.equal(JSON.parse(tampered.body).code, 'BAD_ENVELOPE');
  assert.deepEqual(f.b.get(f.clerk, CUSTOMERS).value, null, 'هیچ نوشتنی از بستهٔ دستکاری‌شده به بانک نرسید');
  /* نام کانال و توکن هرگز به‌صورت متن روی سیم نمی‌روند. */
  assert.equal(envelope.c.includes('be:set'), false);
  assert.equal(envelope.c.includes(f.clerk), false);
});

test('a replayed packet and a stale clock are both refused', async t => {
  const f = await lanFixture(t);
  const body = sealed('be:get', f.clerk, [CUSTOMERS]);
  const once = await rawRequest(f.port, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(once.status, 200);
  const twice = await rawRequest(f.port, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(twice.status, 400);
  assert.equal(JSON.parse(twice.body).code, 'REPLAYED_REQUEST');
  const old = JSON.stringify(sealRequest(KEY, { channel: 'be:get', token: f.clerk, args: [CUSTOMERS], now: Date.now() - 6 * 60 * 1000 }));
  const stale = await rawRequest(f.port, { method: 'POST', headers: { 'content-type': 'application/json' }, body: old });
  assert.equal(stale.status, 400);
  assert.equal(JSON.parse(stale.body).code, 'STALE_REQUEST');
});

test('an oversized body is refused with 413 and the server stays usable', async t => {
  const f = await lanFixture(t, { maxBodyBytes: 4096 });
  const huge = 'ک'.repeat(50000);
  const r = await rawRequest(f.port, { method: 'POST', headers: { 'content-type': 'application/json' }, body: sealed('be:set', f.clerk, [CUSTOMERS, [{ id: 'c1', name: huge }]]) });
  assert.equal(r.status, 413, r.body);
  assert.equal(JSON.parse(r.body).code, 'BODY_TOO_LARGE');
  const stillWorks = await f.client().call('be:get', f.clerk, [CUSTOMERS]);
  assert.equal(stillWorks.ok, true);
  assert.equal(stillWorks.value, null, 'the oversized write never reached the bank');
});

test('the server only opens to the LAN when the operator says so', () => {
  assert.throws(() => parseArgs(['--data=/tmp/x', '--host=192.168.1.10']), /--allow-lan/);
  assert.throws(() => parseArgs(['--data=/tmp/x', '--host=0.0.0.0']), /--allow-lan/, 'همه کارت‌های شبکه یعنی در دسترس ایستگاه‌ها');
  assert.throws(() => parseArgs(['--host=0.0.0.0', '--allow-lan', '--data=/tmp/x', '--port=0']), /پورت/);
  assert.throws(() => parseArgs(['--data=/tmp/x', '--nope']), /ناشناخته/);
  assert.throws(() => parseArgs(['--port=8443']), /--data/);
  const lan = parseArgs(['--data=/tmp/x', '--host=0.0.0.0', '--allow-lan', '--max-body-mb=64']);
  assert.equal(lan.loopback, false);
  assert.equal(lan.maxBodyBytes, 64 * 1024 * 1024);
  const local = parseArgs(['--data=/tmp/x']);
  assert.equal(local.loopback, true);
  assert.equal(local.port, 8443);
  assert.equal(hostAllowed('127.0.0.1:8443', 8443), true);
  assert.equal(hostAllowed('localhost:8443', 8443), true);
  assert.equal(hostAllowed('192.168.1.10:8443', 8443), false);
  assert.equal(hostAllowed('127.0.0.1:9999', 8443), false);
  assert.equal(originAllowed(undefined), true);
  assert.equal(originAllowed('file://'), true);
  assert.equal(originAllowed('https://evil.example'), false);
});

test('a station with a broken server config blocks instead of using a local bank', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-client-config-'));
  const write = contents => fs.writeFileSync(path.join(dir, 'PrintShopData', 'client.json'), contents);
  fs.mkdirSync(path.join(dir, 'PrintShopData'), { recursive: true });
  try {
    assert.equal(resolveClientMode({ env: {}, baseDir: dir }).mode, 'local');
    /* نشانی بدون کلید یعنی اتصال بی‌رمز؛ ایستگاه مسدود می‌شود، نه وصل. */
    const noKey = resolveClientMode({ env: { PRINTSHOP_SERVER_URL: 'http://192.168.1.10:8443' }, baseDir: dir });
    assert.equal(noKey.mode, 'network');
    assert.match(noKey.error, /کلید امنیتی شبکه/);
    const fromEnv = resolveClientMode({ env: { PRINTSHOP_SERVER_URL: 'http://192.168.1.10:8443', PRINTSHOP_LAN_KEY: KEY_B64 }, baseDir: dir });
    assert.equal(fromEnv.url, 'http://192.168.1.10:8443');
    assert.equal(fromEnv.key, KEY_B64);
    assert.equal(fromEnv.error, undefined);
    write(JSON.stringify({ mode: 'network', server: 'http://192.168.1.10:8443' }));
    assert.match(resolveClientMode({ env: {}, baseDir: dir }).error, /کلید امنیتی شبکه/);
    write(JSON.stringify({ mode: 'network', server: 'http://192.168.1.10:8443', key: KEY_B64 }));
    const network = resolveClientMode({ env: {}, baseDir: dir });
    assert.equal(network.mode, 'network');
    assert.equal(network.error, undefined);
    assert.equal(network.key, KEY_B64);
    write(JSON.stringify({ mode: 'network', server: 'http://192.168.1.10:8443', key: 'short' }));
    assert.match(resolveClientMode({ env: {}, baseDir: dir }).error, /شکل درست ندارد/);
    write('{"mode":"local"}');
    assert.equal(resolveClientMode({ env: {}, baseDir: dir }).mode, 'local');
    write('{ not json');
    const broken = resolveClientMode({ env: {}, baseDir: dir });
    assert.equal(broken.mode, 'network', 'a corrupt file must not fall back to the local bank');
    assert.match(broken.error, /JSON معتبر نیست/);
    write('{ "mode": "network" }');
    assert.match(resolveClientMode({ env: {}, baseDir: dir }).error, /نشانی سرور/);
    write('{ "mode": "network", "server": "tp://192.168.1.10" }');
    assert.match(resolveClientMode({ env: {}, baseDir: dir }).error, /معتبر نیست/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the server key file is created once and a damaged key is refused', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-key-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'lan-key.txt');
  const first = loadOrCreateKey(file);
  assert.equal(first.created, true);
  assert.equal(first.key.length, 32);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'کلید فقط برای خودِ سرور قابل خواندن است');
  const again = loadOrCreateKey(file);
  assert.equal(again.created, false);
  assert.deepEqual(again.key, first.key, 'کلید موجود بازنویسی نمی‌شود، وگرنه همهٔ ایستگاه‌ها یک‌شبه قطع می‌شوند');
  fs.writeFileSync(file, 'not-a-key');
  assert.throws(() => loadOrCreateKey(file), /خوانده نشد/);
});

test('the server refuses to start without a 32-byte key', () => {
  assert.throws(() => createShopServer({ backend: {}, key: null }), /کلید امنیتی/);
  assert.throws(() => createShopServer({ backend: {}, key: Buffer.alloc(16) }), /کلید امنیتی/);
});

test('every session channel sends its token first, exactly as the preload does', () => {
  const names = Object.keys(CHANNELS);
  assert.ok(names.includes('be:login') && names.includes('be:get') && names.includes('be:backupNow'));
  assert.equal(names.filter(n => CHANNELS[n].auth === false).join(','), 'be:info,be:login');
  for (const [name, c] of Object.entries(CHANNELS)) assert.ok(Number.isInteger(c.arity) && c.arity <= 4, name);
  const calls = [];
  const stub = new Proxy({}, { get: (t, key) => (...a) => { calls.push([key, ...a]); return { ok: true, user: { role: M } }; } });
  const ctx = { backupDir: '/tmp/backups' };
  const tok = '7f3a9c1b5d8e2f406a8b1c3d5e7f90123456789abcde';
  invoke('be:info', stub, ctx, '', []);
  invoke('be:login', stub, ctx, '', ['admin', '1234']);
  invoke('be:get', stub, ctx, tok, ['orders']);
  invoke('be:backupNow', stub, ctx, tok, []);
  invoke('be:get', stub, ctx, tok, ['orders', 'extra', 'ignored']);
  invoke('be:get', stub, ctx, 'tok', ['orders']);
  /* «markSeen» کارِ داخلیِ سرور پس از یک خواندنِ موفق است (بند پ)، نه کانال؛ پس جدا
     سنجیده می‌شود. اول ثابت می‌کنیم هیچ کانالی بیش از arity خودش به موتور نمی‌فرستد. */
  assert.deepEqual(calls.filter(([key]) => key !== 'markSeen'), [
    ['info'], ['login', 'admin', '1234'], ['get', tok, 'orders'], ['backupNow', tok, ctx.backupDir], ['get', tok, 'orders'],
  ], 'the table never forwards more arguments than a channel declares, and a short token never reaches the engine');
  assert.deepEqual(calls.filter(([key]) => key === 'markSeen'), [
    ['markSeen', tok, ['orders']], ['markSeen', tok, ['orders']],
  ], 'each successful read marks the same session as having seen exactly that list; the rejected token marks nothing');
});
