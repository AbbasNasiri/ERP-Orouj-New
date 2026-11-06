'use strict';
/* حالت سرور (بند الف): یک پروسه، یک بانک، یک نویسنده.
   همان موتور backend.js را میزبانی می‌کند و هیچ منطق دسترسی تازه‌ای ندارد؛
   دروازهٔ نقش‌ها همان canRead/canWrite داخل backend.js می‌ماند.
   پیش‌فرض فقط روی 127.0.0.1 می‌نشیند؛ برای شبکهٔ محلی باید صریحاً --allow-lan داده شود.
   بند ث: هر درخواست یک پاکت AES-256-GCM است و فقط با کلید مشترک باز می‌شود. */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createBackend } = require('./backend.js');
const { invoke } = require('./channels.js');
const { loadOrCreateKey, openRequest, sealResponse, createReplayGuard } = require('./lan-crypto.js');

/* فقط نشانی‌های واقعاً loopback؛ 0.0.0.0 و :: همهٔ کارت‌های شبکه را می‌گیرند و
   باید صریحاً با --allow-lan باز شوند، وگرنه ایستگاه‌ها نمی‌توانند وصل شوند. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]']);
const DEFAULT_PORT = 8443;
const DEFAULT_MAX_BODY_MB = 32;
const RPC_PATH = '/rpc';

function parseArgs(argv) {
  const out = { dataDir: '', host: '127.0.0.1', port: DEFAULT_PORT, maxBodyMb: DEFAULT_MAX_BODY_MB, allowLan: false, backup: false, keyFile: '' };
  for (const a of argv) {
    if (a.startsWith('--data=')) out.dataDir = a.slice(7);
    else if (a.startsWith('--host=')) out.host = a.slice(7);
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a.startsWith('--max-body-mb=')) out.maxBodyMb = Number(a.slice(14));
    else if (a.startsWith('--key-file=')) out.keyFile = a.slice(11);
    else if (a === '--allow-lan') out.allowLan = true;
    else if (a === '--backup') out.backup = true;
    else throw new Error('پارامتر ناشناخته: ' + a);
  }
  if (!out.dataDir) throw new Error('مسیر بانک داده نشده است: --data=<پوشهٔ PrintShopData>');
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw new Error('شمارهٔ پورت معتبر نیست.');
  if (!(out.maxBodyMb > 0)) throw new Error('سقف حجم درخواست معتبر نیست.');
  const loopback = LOOPBACK.has(out.host);
  if (!loopback && !out.allowLan) throw new Error('برای نشستن روی شبکهٔ محلی باید صریحاً --allow-lan داده شود.');
  return { ...out, loopback, keyFile: out.keyFile || path.join(out.dataDir, 'lan-key.txt'), maxBodyBytes: Math.round(out.maxBodyMb * 1024 * 1024) };
}

/* نشانی‌های IPv4 کارت‌های واقعی؛ حلقهٔ محلی حساب نمی‌شود. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      const family = String(a.family);
      if ((family === 'IPv4' || family === '4') && !a.internal && !out.includes(a.address)) out.push(a.address);
    }
  }
  return out;
}

/* نسخهٔ آمادهٔ client.json برای هر ایستگاه: کارفرما لازم نیست نشانی و کلید را دستی
   از لاگ بردارد. این فایل فقط نوشته می‌شود و خودِ سرور هیچ ایستگاهی را تنظیم نمی‌کند. */
function stationSetup({ dataDir, port, key, addresses = lanAddresses() }) {
  const root = path.join(dataDir, 'station-setup');
  const files = [];
  for (const ip of addresses) {
    const folder = path.join(root, ip);
    fs.mkdirSync(folder, { recursive: true });
    const config = { mode: 'network', server: 'http://' + ip + ':' + port, key };
    const file = path.join(folder, 'client.json');
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
    files.push(file);
  }
  return files;
}

/* وقتی سرور فقط روی loopback نشسته، نشانی درخواست هم باید همان باشد: نشانی‌های چرخش‌یافته
   (DNS rebinding) و میزبان‌های دیگر رد می‌مانند. روی شبکهٔ محلی (--allow-lan) ایستگاه با IP
   خودِ سرور وصل می‌شود و این بررسی معنا ندارد. */
function hostAllowed(hostHeader, port) {
  const h = String(hostHeader || '');
  const host = h.startsWith('[') ? h.slice(1, h.indexOf(']') + 1) : h.split(':')[0];
  const rest = h.startsWith('[') ? h.slice(h.indexOf(']') + 1) : h.slice(host.length);
  const p = rest.startsWith(':') ? Number(rest.slice(1)) : 80;
  if (p !== port) return false;
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase());
}

function originAllowed(originHeader) {
  if (!originHeader) return true;
  const o = String(originHeader).trim().toLowerCase();
  return o === '' || o === 'null' || o.startsWith('file://');
}

function createShopServer({ backend, backupDir, key, maxBodyBytes = 32 * 1024 * 1024, port = DEFAULT_PORT, loopbackOnly = true, log = () => {} }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('سرور بدون کلید امنیتی ۳۲ بایتی بالا نمی‌آید.');
  const ctx = { backupDir, origin: 'network' };
  const replays = createReplayGuard();
  const send = (res, status, payload) => {
    if (res.headersSent || res.writableEnded) return;
    const body = JSON.stringify(payload === undefined ? null : payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
    res.end(body);
  };
  const readBody = (req, res) => new Promise((resolve, reject) => {
    let size = 0, overLimit = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBodyBytes) {
        /* بدنهٔ اضافه را دور می‌ریزیم و سوکت را بی‌درنگ نمی‌بندیم: اگر پیش از تحویل پاسخ
           413 سوکت بخوابد، ایستگاه ECONNRESET می‌گیرد و نمی‌فهمد درخواستش بیش از حد بزرگ بوده. */
        if (!overLimit) {
          overLimit = true;
          res.setHeader('connection', 'close');
          send(res, 413, { ok: false, code: 'BODY_TOO_LARGE', error: 'درخواست بزرگ‌تر از حد مجاز است.' });
          reject(Object.assign(new Error('درخواست بزرگ‌تر از حد مجاز است.'), { status: 413, code: 'BODY_TOO_LARGE' }));
        }
        /* سقف دوم فقط برای فرستندهٔ بی‌انتهاست؛ در حجم‌های واقعی (چند ده مگابایت) هیچ‌وقت نمی‌رسد
           و پاسخ ۴۱۳ پیش از آن تحویل داده شده است. */
        if (size > 64 * 1024 * 1024) req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(Object.assign(new Error('درخواست نیمه‌کاره ماند.'), { status: 400, code: 'REQUEST_FAILED' })));
  });

  const handler = async (req, res) => {
    const started = Date.now();
    let label = '(نامعتبر)';
    try {
      if (req.method !== 'POST') throw Object.assign(new Error('فقط درخواست POST پذیرفته می‌شود.'), { status: 405, code: 'METHOD_NOT_ALLOWED' });
      if ((req.url || '').split('?')[0] !== RPC_PATH) throw Object.assign(new Error('این نشانی وجود ندارد.'), { status: 404, code: 'NOT_FOUND' });
      if (loopbackOnly && !hostAllowed(req.headers.host, port)) throw Object.assign(new Error('نشانی درخواست با این سرور مطابقت ندارد.'), { status: 403, code: 'FORBIDDEN' });
      if (!originAllowed(req.headers.origin)) throw Object.assign(new Error('فرستندهٔ درخواست مجاز نیست.'), { status: 403, code: 'FORBIDDEN' });
      if (req.headers['content-type'] !== 'application/json') throw Object.assign(new Error('سربند نوع محتوا باید application/json باشد.'), { status: 415, code: 'VALIDATION_FAILED' });
      const raw = await readBody(req, res);
      let envelope;
      try { envelope = JSON.parse(raw || '{}'); }
      catch (_) { throw Object.assign(new Error('بدنهٔ درخواست JSON معتبر نیست.'), { status: 400, code: 'VALIDATION_FAILED' }); }
      const request = openRequest(key, envelope);
      label = request.ch;
      if (!replays.accept(crypto.createHash('sha256').update(envelope.n).digest())) {
        throw Object.assign(new Error('این درخواست قبلاً یک بار اجرا شده است.'), { status: 400, code: 'REPLAYED_REQUEST' });
      }
      const result = invoke(request.ch, backend, ctx, request.tok, request.args);
      send(res, 200, sealResponse(key, request.nonce, result));
      log(label, (result && result.ok === false ? (result.code || 'FAILED') : 'ok'), Date.now() - started);
    } catch (err) {
      const status = err.status || 400;
      send(res, status, { ok: false, code: err.code || 'REQUEST_FAILED', error: String(err.message || err) });
      log(label, err.code || 'REQUEST_FAILED', Date.now() - started);
    }
  };

  return http.createServer(handler);
}

/* سرور از طریق همین ورودی استارت می‌شود:
   node electron/shop-server.js --data=<پوشهٔ PrintShopData> [--port=8443] [--allow-lan --host=0.0.0.0]
   و برای پشتیبان دستی: همان فرمان با --backup (بدون listen). */
if (require.main === module) {
  let cfg;
  try { cfg = parseArgs(process.argv.slice(2)); }
  catch (err) { console.error('سرور شروع نشد: ' + err.message); process.exit(2); }
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const backend = createBackend({ dataDir: cfg.dataDir, legacyJsonFile: path.join(cfg.dataDir, 'data.json') });
  if (cfg.backup) {
    const record = backend.backup(path.join(cfg.dataDir, 'backups'), { manual: true });
    console.log(record.ok ? 'پشتیبان ساخته شد: ' + record.path : 'پشتیبان ساخته نشد: ' + record.error);
    backend.close();
    process.exit(record.ok ? 0 : 1);
  }
  let keyInfo;
  try { keyInfo = loadOrCreateKey(cfg.keyFile); }
  catch (err) { console.error('سرور شروع نشد: ' + err.message); backend.close(); process.exit(2); }
  const server = createShopServer({
    backend,
    backupDir: path.join(cfg.dataDir, 'backups'),
    key: keyInfo.key,
    maxBodyBytes: cfg.maxBodyBytes,
    port: cfg.port,
    loopbackOnly: cfg.loopback,
    log: (channel, outcome, ms) => console.log(new Date().toISOString(), channel, outcome, ms + 'ms'),
  });
  server.listen(cfg.port, cfg.host, () => {
    console.log('سرور چاپخانه در حال اجراست: http://' + cfg.host + ':' + cfg.port);
    console.log('پوشهٔ بانک: ' + backend.dbFile);
    console.log('کلید امنیتی ایستگاه‌ها: ' + cfg.keyFile + (keyInfo.created ? ' (تازه ساخته شد)' : ''));
    if (cfg.loopback) console.log('فقط همین کامپیوتر می‌تواند وصل شود.');
    else console.log('پیام‌های ایستگاه‌ها رمزنگاری‌شده است. فایل‌های آمادهٔ ایستگاه: ' + stationSetup({ dataDir: cfg.dataDir, port: cfg.port, key: keyInfo.key.toString('base64') }).join(' , '));
  });
  const backupTimer = setInterval(() => {
    try { backend.backup(path.join(cfg.dataDir, 'backups')); } catch (_) { /* پشتیبان نباید سرور را بخواباند */ }
  }, 6 * 3600 * 1000);
  backupTimer.unref();
  const stop = () => {
    clearInterval(backupTimer);
    try { backend.backup(); } catch (_) { /* خاموش‌شدن بانک اولویت دارد */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('uncaughtException', (err) => console.error('خطای غیرمنتظرهٔ سرور: ' + String(err && err.message || err)));
}

module.exports = { createShopServer, parseArgs, hostAllowed, originAllowed, lanAddresses, stationSetup, LOOPBACK, DEFAULT_PORT };
