'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = import(pathToFileURL(path.resolve(__dirname, '../src/smart.js')).href);
const loadOrder = import(pathToFileURL(path.resolve(__dirname, '../src/smartorder.js')).href);
const OPTS = { productTypes: ['کتاب', 'تراکت', 'سررسید', 'فلایر', 'بروشور', 'پوستر'], serviceTypes: ['طلاکوب', 'سلفون'] };

test('spoken numbers become digits without inventing values', async () => {
  const { wordsToDigits } = await load;
  assert.equal(wordsToDigits('دو هزار و پانصد نسخه'), '2500 نسخه');
  assert.equal(wordsToDigits('هزار و پانصد'), '1500');
  assert.equal(wordsToDigits('صد'), '100');
  assert.equal(wordsToDigits('هفتاد گرم'), '70 گرم');
  assert.equal(wordsToDigits('کتاب رحلی با جلد گالینگور'), 'کتاب رحلی با جلد گالینگور');
  assert.equal(wordsToDigits('۲۰۰۰ نسخه'), '2000 نسخه');
});

test('customer request text carries its quantity', async () => {
  const { parseOrderText } = await load;
  const r = parseOrderText('محصول: کتاب\nتعداد: 2000\nمشخصات: رحلی 400 صفحه متن تحریر 70 گرم\nشماره تماس: 09121234567', OPTS);
  assert.equal(r.qty, 2000);
  assert.equal(r.pages, 400);
  assert.equal(r.sizeKey, 'رحلی');
  assert.equal(r.text.gsm, 70);
});

test('agreed book sentence read fully from spoken-style wording', async () => {
  const { parseOrderText } = await load;
  const r = parseOrderText('کتاب رحلی ۴۰۰ صفحه متن تحریر هفتاد گرم دو رنگ جلد گلاسه ۲۵۰ گرم تمام رنگی سلفون براق چسب گرم دو هزار و پانصد نسخه', OPTS);
  assert.equal(r.qty, 2500);
  assert.equal(r.pages, 400);
  assert.equal(r.text.gsm, 70);
  assert.equal(r.text.colors, 2);
  assert.equal(r.cover.gsm, 250);
  assert.equal(r.cover.colors, 4);
  assert.equal(r.cover.cellophane, 'براق');
  assert.equal(r.binding, 'شومیز (چسب گرم)');
});

test('quantity word priority: جلد does not beat نسخه', async () => {
  const { parseOrderText } = await load;
  assert.equal(parseOrderText('یک جلد کتاب رحلی دو هزار نسخه', OPTS).qty, 2000);
  assert.equal(parseOrderText('کتاب رقعی صد صفحه تیراژ نهصد نسخه', OPTS).qty, 900);
  assert.equal(parseOrderText('کتاب سررسید پانصد صفحه', OPTS).pages, 500);
});

test('sheet-word quantity is flagged for confirmation instead of silently priced', async () => {
  const { parseOrderText } = await load;
  const r = parseOrderText('تراکت A5 ۱۰۰ گرم ۵۰۰۰ برگ', OPTS);
  assert.equal(r.qty, 5000);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /تأیید/);
});

test('unreadable print colour raises a confirmation note', async () => {
  const { parseOrderText } = await load;
  const r = parseOrderText('کتاب ۲۴۰ صفحه سه رنگ تیراژ ۲۰۰۰ نسخه', OPTS);
  assert.equal(r.text.colors, null);
  assert.ok(r.notes.some(n => /رنگ چاپ متن/.test(n)));
});

test('offline extraction passes intake warnings as questions', async () => {
  const { extractItems, offlineQuestions, parseOfflineItems } = await loadOrder;
  const res = await extractItems('تراکت A5 ۱۰۰ گرم ۵۰۰۰ برگ', { ai: { enabled: false, apiKey: '' }, opts: OPTS });
  assert.equal(res.source, 'offline');
  assert.equal(res.items.length, 1);
  assert.equal(res.questions.length, 1);
  assert.match(res.questions[0], /شمارگان/);
  assert.deepEqual(offlineQuestions(parseOfflineItems('کتاب رحلی ۲۰۰ نسخه', OPTS)), []);
});

test('a multi-line request stays one item instead of fragmenting its fields', async () => {
  const { parseOfflineItems } = await loadOrder;
  const text = 'محصول: کتاب\nتعداد: 2000\nمشخصات: رحلی 400 صفحه متن تحریر 70 گرم\nشماره تماس: 09121234567';
  const items = parseOfflineItems(text, OPTS);
  assert.equal(items.length, 1);
  const p = items[0].parsed;
  assert.equal(p.productType, 'کتاب');
  assert.equal(p.qty, 2000);
  assert.equal(p.pages, 400);
  assert.equal(p.sizeKey, 'رحلی');
  assert.equal(p.text.gsm, 70);
});

test('two products dictated in one breath are still two items', async () => {
  const { parseOfflineItems } = await loadOrder;
  const items = parseOfflineItems('کتاب رحلی ۳۰۰ صفحه تیراژ ۱۰۰۰ نسخه و ۵۰۰۰ بروشور A4', OPTS);
  assert.equal(items.length, 2);
  assert.equal(items[0].parsed.productType, 'کتاب');
  assert.equal(items[1].parsed.productType, 'بروشور');
});

test('dictated text with persian commas still yields quantity, gsm, colours and sides', async () => {
  const { parseOrderText } = await load;
  const p = parseOrderText('دویست نسخه A4 گلاسه یکصد و پنجاه گرم، یک‌رو، تمام رنگی، چهار رنگ', OPTS);
  assert.equal(p.qty, 200);
  assert.equal(p.text.gsm, 150);
  assert.equal(p.text.colors, 4);
  assert.equal(p.text.sides, 1);
  assert.equal(p.notes.length, 0, 'هیچ نکته‌ای نباید بماند: همه‌ی فیلدها روشن گفته شده‌اند');
});

test('«برگه» is read as a quantity but never silently', async () => {
  const { parseOrderText } = await load;
  const p = parseOrderText('پانصد برگه تحریر هفتاد گرم، یک‌رو، سیاه و سفید', OPTS);
  assert.equal(p.qty, 500);
  assert.equal(p.text.colors, 1);
  assert.ok(p.notes.some(n => /برگه/.test(n)), 'باید از کاربر بخواهد شمارگان را تأیید کند');
});
