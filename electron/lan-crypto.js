'use strict';
/* رمزنگاری رفت‌وبرگشت ایستگاه‌ها (بند ث).
   چرا TLS نه؟ روی همین ماشین آزمون، گواهی هر اتصال TLS — حتی روی 127.0.0.1 — بازنویسی
   می‌شود (نرم‌افزار امنیتی گواهی را با امضای خودش عوض می‌کند)، پس «اثر انگشت گواهی سرور»
   روی چنین کامپیوترهایی به بن‌بست می‌خورد. رمزنگاری در خود پیام این مشکل را ندارد.
   هر درخواست با AES-256-GCM و کلیدی که فقط سرور و ایستگاه‌ها دارند بسته‌بندی می‌شود؛
   نام کانال، توکن نشست و داده‌ها همه داخل بستهٔ رمزشده‌اند. کلید از کلید ۳۲ بایتی با
   nonce همان پیام مشتق می‌شود و AAD، غیرقابل‌جابه‌جایی‌بودن بسته را تضمین می‌کند.
   محدودیت صادقانه: این کلید مشترک است و رمزنگاریِ رو به جلو (forward secrecy) ندارد. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALG = 'aes-256-gcm';
const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_SKEW_MS = 5 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function makeKey() { return crypto.randomBytes(32).toString('base64'); }

function parseKey(raw) {
  const text = String(raw || '').trim();
  if (!KEY_PATTERN.test(text)) throw new Error('کلید امنیتی شبکه باید ۳۲ بایت base64 باشد.');
  const key = Buffer.from(text, 'base64');
  if (key.length !== 32) throw new Error('کلید امنیتی شبکه باید ۳۲ بایت باشد.');
  return key;
}

function loadOrCreateKey(file) {
  try {
    return { key: parseKey(fs.readFileSync(file, 'utf8')), created: false, file };
  } catch (err) {
    if (fs.existsSync(file)) throw new Error('کلید امنیتی ' + file + ' خوانده نشد: ' + String(err.message || err));
  }
  const text = makeKey();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text + '\n', { mode: 0o600 });
  return { key: parseKey(text), created: true, file };
}

function derive(key, nonce, label) {
  return Buffer.from(crypto.hkdfSync('sha256', key, nonce, 'printshop-rpc-v1:' + label, 32));
}

function aad(label, nonce) {
  return Buffer.from('printshop-rpc-v1|' + label + '|' + nonce.toString('base64'));
}

function seal(key, nonce, label, value) {
  const cipher = crypto.createCipheriv(ALG, derive(key, nonce, label), nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(label, nonce));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: VERSION, n: nonce.toString('base64'), c: body.toString('base64'), t: cipher.getAuthTag().toString('base64') };
}

function open(key, envelope, label) {
  if (!envelope || envelope.v !== VERSION || typeof envelope.n !== 'string' || typeof envelope.c !== 'string' || typeof envelope.t !== 'string') {
    throw Object.assign(new Error('بستهٔ امنیتی ساختار درست ندارد.'), { code: 'BAD_ENVELOPE' });
  }
  const nonce = Buffer.from(envelope.n, 'base64');
  if (nonce.length !== NONCE_BYTES) throw Object.assign(new Error('nonce بستهٔ امنیتی معتبر نیست.'), { code: 'BAD_ENVELOPE' });
  try {
    const decipher = crypto.createDecipheriv(ALG, derive(key, nonce, label), nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(label, nonce));
    decipher.setAuthTag(Buffer.from(envelope.t, 'base64'));
    const text = Buffer.concat([decipher.update(Buffer.from(envelope.c, 'base64')), decipher.final()]).toString('utf8');
    return { nonce, value: JSON.parse(text) };
  } catch (_) {
    throw Object.assign(new Error('کلید امنیتی این ایستگاه با سرور یکی نیست یا بسته دستکاری شده است.'), { code: 'BAD_ENVELOPE' });
  }
}

/* بستهٔ درخواست: نام کانال و توکن هم داخل رمز می‌روند، نه در سربند HTTP. */
function sealRequest(key, { channel, token = '', args = [], now = Date.now(), nonce = crypto.randomBytes(NONCE_BYTES) }) {
  return seal(key, nonce, 'req', { ts: now, ch: channel, tok: token || '', args });
}

function openRequest(key, envelope, { now = Date.now(), windowMs = MAX_SKEW_MS } = {}) {
  const { nonce, value } = open(key, envelope, 'req');
  if (!value || typeof value.ch !== 'string' || !Array.isArray(value.args)) throw Object.assign(new Error('محتوای درخواست معتبر نیست.'), { code: 'BAD_ENVELOPE' });
  if (!Number.isFinite(value.ts) || Math.abs(now - value.ts) > windowMs) throw Object.assign(new Error('زمان درخواست با ساعت سرور نمی‌خواند (بیش از ۵ دقیقه اختلاف).'), { code: 'STALE_REQUEST' });
  if (typeof value.tok !== 'string') throw Object.assign(new Error('توکن درخواست معتبر نیست.'), { code: 'BAD_ENVELOPE' });
  return { ...value, nonce };
}

function sealResponse(key, nonce, result) { return seal(key, nonce, 'res', { result }); }
function openResponse(key, envelope, nonce) {
  const opened = open(key, envelope, 'res');
  if (Buffer.compare(opened.nonce, nonce) !== 0) throw Object.assign(new Error('پاسخ با همین درخواست جفت نیست.'), { code: 'BAD_ENVELOPE' });
  return opened.value.result;
}

/* جلوگیری از بازپخش: هر nonce فقط یک بار پذیرفته می‌شود. حافظهٔ کوچک با دور ریختن
   ورودی‌های کهنه، و سقف تعداد تا حافظه زیر فشار درخواست‌های جعلی رشد نکند. */
function createReplayGuard({ now = Date.now, windowMs = MAX_SKEW_MS, limit = 20000 } = {}) {
  const seen = new Map();
  const prune = () => {
    const cut = now() - windowMs;
    for (const [nonce, at] of seen) if (at < cut) seen.delete(nonce);
    while (seen.size > limit) seen.delete(seen.keys().next().value);
  };
  return {
    accept(nonce) {
      const id = nonce.toString('base64');
      prune();
      if (seen.has(id)) return false;
      seen.set(id, now());
      return true;
    },
    size: () => seen.size,
  };
}

module.exports = {
  makeKey, parseKey, loadOrCreateKey, sealRequest, openRequest, sealResponse, openResponse,
  createReplayGuard, KEY_PATTERN, MAX_SKEW_MS, VERSION,
};
