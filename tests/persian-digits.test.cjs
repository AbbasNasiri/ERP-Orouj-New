'use strict';
/* اصلاحات ۱۷/بند ۳/۶ — تصمیمِ کارفرما به پرسشِ ارقام: «فارسی».
   قاعده‌ای که این آزمون نگه می‌دارد: رقمِ فارسی فقط در دیدن است.
   ۱) faDigits هر عددِ ذخیره‌شده را برای نمایش فارسی می‌کند و nothing else؛
   ۲) normalizeDigits همان رقمِ فارسی را دوباره به لاتینِ machine برمی‌گرداند،
      پس هیچ مقدارِ ذخیره‌شده، payload یا Number() ای از مسیرِ نمایش نمی‌گذرد. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function smart() {
  return import(pathToFileURL(path.resolve(__dirname, '..', 'src', 'smart.js')).href);
}

test('faDigits شمارهٔ ساختهٔ سرور را برای دیدن فارسی می‌کند', async () => {
  const { faDigits } = await smart();
  assert.equal(faDigits('INV-57'), 'INV-۵۷', 'حروفِ پیشوند دست نمی‌خورد، فقط رقم');
  assert.equal(faDigits('9001'), '۹۰۰۱');
  assert.equal(faDigits(14050812), '۱۴۰۵۰۸۱۲', 'شمارهٔ عددی هم پذیر است');
  assert.equal(faDigits('٣٤٥'), '۳۴۵', 'رقمِ عربی هم به فارسی می‌نشیند');
  assert.equal(faDigits(''), '', 'رشتهٔ خالی پیامِ ساختگی نمی‌گیرد');
  assert.equal(faDigits(null), '', 'بدونِ شماره، خانه خاموش است نه NaN');
});

test('دور‌بردِ نمایش: فارسی به لاتینِ ذخیره برمی‌گردد و Number همان عدد را می‌دهد', async () => {
  const { faDigits, normalizeDigits } = await smart();
  for (const stored of ['9001', 'INV-57', '1405/08/12', '2001']) {
    const shown = faDigits(stored);
    assert.notEqual(shown, stored, `${stored} برای دیدن عوض می‌شود`);
    assert.equal(normalizeDigits(shown), stored, `${stored} با تایپِ دوباره به همان لاتین برمی‌گردد`);
  }
  assert.equal(Number(normalizeDigits(faDigits('1250000'))), 1250000, 'مبلغِ خوانده‌شده دوباره عدد است');
});

test('faDigits رشتهٔ مرجعِ بیرونی را نمی‌سازد: فقط رقمِ همان رشته را می‌بیند', async () => {
  const { faDigits } = await smart();
  /* کنترل منفی: این تابع معنای عددی نمی‌سازد و جداکنندهٔ هزارگان را جابه‌جا نمی‌کند؛
     پس هر جای اشتباهی که رویش صدا بزند، خروجی‌اش همچنان همان کاراکترهاست. */
  assert.equal(faDigits('1,234'), '۱,۲۳۴');
  assert.equal(faDigits('4411351413'), '۴۴۱۱۳۵۱۴۱۳');
  assert.equal(faDigits('ORDER-11'), 'ORDER-۱۱');
});
