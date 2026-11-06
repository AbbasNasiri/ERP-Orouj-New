'use strict';
/* اصلاحات ۱۷/بند ۲: «رسید وجه» رشتهٔ شمارهٔ خودش را دارد. 'receipt' از پیش رسیدِ تحویل کالای
   امانی از تأمین‌کننده است؛ اگر همان رشته دو سند متفاوت را شماره می‌زد، دو «رسید ۶۰۰۱»
   در یک بانک پیدا می‌شد. */
const TYPES = Object.freeze(['order', 'quote', 'invoice', 'statement', 'letter', 'receipt', 'stockmovement', 'consignmentreceipt', 'moneyreceipt']);
const STARTS = Object.freeze({ order: 1001, quote: 2001, invoice: 3001, statement: 4001, letter: 5001, receipt: 6001, stockmovement: 7001, consignmentreceipt: 8001, moneyreceipt: 9001 });
const MAX_SERIAL = 999999999999;
function invalid(message) { throw Object.assign(new Error(message), { code: 'VALIDATION_FAILED' }); }
function defaults() { return Object.fromEntries(TYPES.map(type => [type, { prefix: '', start: STARTS[type], next: STARTS[type], width: 0, enabled: true }])); }
function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => !['prefix', 'start', 'next', 'width', 'enabled'].includes(k))) invalid('تنظیم شماره‌گذاری معتبر نیست.');
  if (typeof config.prefix !== 'string' || config.prefix.length > 30 || /[\x00-\x1f\x7f]/.test(config.prefix)) invalid('پیشوند شماره معتبر نیست.');
  if (![config.start, config.next].every(v => Number.isSafeInteger(v) && v >= 1 && v <= MAX_SERIAL) || config.next < config.start) invalid('شروع و شماره بعدی باید عدد صحیح مثبت باشند.');
  if (!Number.isInteger(config.width) || config.width < 0 || config.width > 12 || typeof config.enabled !== 'boolean') invalid('طول شماره یا وضعیت فعال‌بودن معتبر نیست.');
  return { prefix: config.prefix, start: config.start, next: config.next, width: config.width, enabled: config.enabled };
}
function formatNumber(config, serial) { return config.prefix + String(serial).padStart(config.width, '0'); }
function serialOf(number, config) {
  const text = String(number ?? '');
  if (!text.startsWith(config.prefix)) return null;
  const digits = text.slice(config.prefix.length);
  if (!/^\d+$/.test(digits)) return null;
  const serial = Number(digits);
  return Number.isSafeInteger(serial) && serial > 0 && serial <= MAX_SERIAL ? serial : null;
}
module.exports = { TYPES, MAX_SERIAL, defaults, validateConfig, formatNumber, serialOf };
