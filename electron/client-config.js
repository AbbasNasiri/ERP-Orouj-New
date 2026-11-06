'use strict';
/* ایستگاه چطور می‌فهمد باید به سرور وصل شود؟
   ۱) متغیرهای PRINTSHOP_SERVER_URL و PRINTSHOP_LAN_KEY (برای آزمون و اجرای مستقیم)
   ۲) فایل client.json کنار پوشهٔ دادهٔ همان ماشین:
      { "mode": "network", "server": "http://192.168.1.10:8443", "key": "<۳۲ بایت base64>" }
   ۳) هیچ‌کدام: همان حالت تک‌کامپیوتریِ امروز (بانک محلی).
   قاعده: اگر فایل هست ولی خراب است، برنامه «مسدود» می‌شود و بی‌صدا به بانک محلی برنمی‌گردد؛
   وگرنه ممکن است کاربر اطلاعاتش را در بانک اشتباهی وارد کند.
   بند ث: بدون کلید مشترک، ایستگاه به هیچ سروری وصل نمی‌شود؛ رمز و داده روی سیم نمی‌رود. */
const fs = require('fs');
const path = require('path');
const { parseServerUrl } = require('./server-client.js');
const { KEY_PATTERN } = require('./lan-crypto.js');

const FILE_NAME = 'client.json';

function resolveClientMode({ env = process.env, baseDir, read = fs.readFileSync } = {}) {
  const fromEnv = String(env.PRINTSHOP_SERVER_URL || '').trim();
  if (fromEnv) {
    return validate(fromEnv, 'متغیر محیطی PRINTSHOP_SERVER_URL', '', {
      key: String(env.PRINTSHOP_LAN_KEY || '').trim(),
    });
  }
  const file = path.join(String(baseDir || ''), 'PrintShopData', FILE_NAME);
  let raw;
  try { raw = read(file, 'utf8'); }
  catch (err) { return { mode: 'local', source: 'پیش‌فرض', file }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { return { mode: 'network', url: '', error: 'فایل ' + FILE_NAME + ' خوانده شد ولی JSON معتبر نیست: ' + file }; }
  if (!parsed || typeof parsed !== 'object') return { mode: 'network', url: '', error: 'فایل ' + FILE_NAME + ' ساختار درست ندارد: ' + file };
  if (parsed.mode !== 'network') return { mode: 'local', source: FILE_NAME + ' (mode: ' + String(parsed.mode) + ')', file };
  return validate(String(parsed.server || '').trim(), FILE_NAME, file, { key: String(parsed.key || '').trim() });
}

function validate(url, source, file, { key = '' } = {}) {
  if (!url) return { mode: 'network', url: '', source, file, error: 'در حالت شبکه باید نشانی سرور نوشته شود (' + source + ').' };
  if (!parseServerUrl(url)) return { mode: 'network', url, source, file, error: 'نشانی سرور معتبر نیست: ' + url + ' (فقط http یا https با نام میزبان و پورت).' };
  if (!key) return { mode: 'network', url, source, file, error: 'کلید امنیتی شبکه در ' + source + ' نوشته نشده است؛ فایل client.jsonی که سرور ساخته را کپی کنید.' };
  if (!KEY_PATTERN.test(key)) return { mode: 'network', url, source, file, error: 'کلید امنیتی شبکه در ' + source + ' شکل درست ندارد (باید ۳۲ بایت base64 باشد).' };
  return { mode: 'network', url, source, file, key };
}

module.exports = { resolveClientMode, FILE_NAME };
