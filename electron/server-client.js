'use strict';
/* مسیر شبکهٔ ایستگاه (بند الف): درخواست را به سرور می‌فرستد و همان شیء پاسخ موتور را برمی‌گرداند.
   قاعدهٔ کارفرما: «آفلاین یعنی آفلاین» — اگر سرور پاسخ نداد، هیچ بازگشت بی‌صدایی به بانک
   محلی انجام نمی‌شود و پیام روشن برمی‌گردد.
   بند ث: هر درخواست و پاسخ در پاکت AES-256-GCM با کلید مشترک ایستگاه‌ها بسته‌بندی می‌شود.
   نام کانال و توکن نشست داخل پاکت‌اند، پس روی سیم فقط حجم و زمان دیده می‌شود. */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { parseKey, sealRequest, openResponse } = require('./lan-crypto.js');

const MAX_RESPONSE_BYTES = 48 * 1024 * 1024;
/* پاسخ ۲۰۰ سرور همیشه نتیجهٔ خودِ موتور است (even a FORBIDDEN) و خطای کاری به همان شکل
   دست رابط کاربری می‌رسد؛ فقط نشانه‌های زیر یعنی «به سرور نرسیدیم» یا «سرور را نشناختیم». */
const TRANSPORT_CODES = [
  'SERVER_UNREACHABLE', 'REQUEST_TIMEOUT', 'RESPONSE_TOO_LARGE', 'BAD_RESPONSE', 'SERVER_ERROR',
  'BAD_ENVELOPE', 'STALE_REQUEST', 'REPLAYED_REQUEST',
];

function parseServerUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (_) { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null;
  return u;
}

function createServerClient({ url, key, timeoutMs = 8000, transport } = {}) {
  const target = parseServerUrl(url);
  if (!target) throw new Error('نشانی سرور معتبر نیست: ' + String(url || '(خالی)'));
  let secret;
  try { secret = parseKey(key); }
  catch (err) { throw new Error('کلید امنیتی شبکهٔ این ایستگاه درست نیست یا تنظیم نشده است: ' + String(err.message || err)); }
  const port = target.port ? Number(target.port) : (target.protocol === 'https:' ? 443 : 80);
  const base = (target.pathname || '/').replace(/\/+$/, '');
  const agent = transport || (target.protocol === 'https:' ? https : http);
  const netFail = (code, error) => ({ net: { ok: false, code, error }, result: null });
  const unavailable = () => netFail('SERVER_UNREACHABLE', 'سرور چاپخانه در دسترس نیست. اینترنت لازم نیست؛ فقط همین شبکهٔ محلی و روشن بودن کامپیوتر سرور.');
  const rejected = (parsed) => netFail(parsed.code, parsed.error || 'سرور بستهٔ امنیتی این ایستگاه را نپذیرفت.');

  function raw(channel, token, args) {
    return new Promise((resolve) => {
      /* done باید پیش از ساخت درخواست وجود داشته باشد: اگر سرور روشن نباشد، خطا روی خودِ
         درخواست می‌آید و هیچ پاسخی ساخته نمی‌شود — بدون این، ایستگاه تا ابد در انتظار می‌ماند. */
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      const envelope = sealRequest(secret, { channel, token, args });
      const requestNonce = Buffer.from(envelope.n, 'base64');
      const body = JSON.stringify(envelope);
      const req = agent.request({
        method: 'POST',
        hostname: target.hostname,
        port,
        path: base + '/rpc',
        timeout: timeoutMs,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        let size = 0;
        const chunks = [];
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_RESPONSE_BYTES) { req.destroy(); return done(netFail('RESPONSE_TOO_LARGE', 'پاسخ سرور بیش از اندازه بزرگ است.')); }
          chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = JSON.parse(text); } catch (_) { /* پاسخ سرور غیرمنتظره بود */ }
          if (!(res.statusCode >= 200 && res.statusCode < 300)) {
            if (parsed && parsed.error && TRANSPORT_CODES.includes(parsed.code)) return done(rejected(parsed));
            return done(netFail('SERVER_ERROR', (parsed && parsed.error) || 'سرور پاسخ داد ولی درخواست انجام نشد (کد ' + res.statusCode + ').'));
          }
          if (!parsed || typeof parsed !== 'object') return done(netFail('BAD_RESPONSE', 'پاسخ سرور قابل خواندن نیست.'));
          let result;
          try { result = openResponse(secret, parsed, requestNonce); }
          catch (_) { return done(netFail('BAD_ENVELOPE', 'پاسخ سرور با کلید این ایستگاه باز نشد؛ ممکن است سرور عوض شده یا پاسخ دستکاری شده باشد.')); }
          if (!result || typeof result !== 'object') return done(netFail('BAD_RESPONSE', 'پاسخ سرور شکل درست ندارد.'));
          if (result.ok === false && TRANSPORT_CODES.includes(result.code)) return done(netFail(result.code, result.error));
          done({ net: null, result });
        });
        res.on('error', () => done(unavailable()));
      });
      req.on('timeout', () => { req.destroy(); done(netFail('REQUEST_TIMEOUT', 'سرور در زمان مقرر پاسخ نداد؛ تغییر اطلاعات انجام نشد.')); });
      req.on('error', () => done(unavailable()));
      req.end(body);
    });
  }

  return {
    url: target.href,
    host: target.hostname,
    port,
    encrypted: true,
    /* هر درخواست کاری: یا نتیجهٔ موتور از سرور، یا پیام روشن خطای شبکه. */
    async call(channel, token, args) { const r = await raw(channel, token, args); return r.net || r.result; },
    /* سنجش اولیهٔ روشن بودن سرور؛ پاسخِ be:info هیچ ok ندارد، پس اینجا بررسی می‌شود. */
    async ping() {
      const r = await raw('be:info', '', []);
      if (r.net) return r.net;
      if (!r.result || typeof r.result !== 'object') return { ok: false, code: 'BAD_RESPONSE', error: 'پاسخ سرور شکل درست ندارد.' };
      return { ok: true, info: r.result };
    },
  };
}

module.exports = { createServerClient, parseServerUrl, MAX_RESPONSE_BYTES, TRANSPORT_CODES };
