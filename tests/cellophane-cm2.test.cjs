'use strict';
/* سلفون: قیمت هر سانتی‌متر مربع، دو دستهٔ حرارتی و واتربیس و زیرمجموعه‌های حرارتی. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'src', f)).href);
const find = (d, name) => d.binding.items.find(x => x.name === name);

test('سلفون حرارتی: مساحت به سانتی‌متر مربع × نرخ × تیراژ', async () => {
  const u = await load('units.js');
  const e = find(u.defaultUnits(), 'سلفون حرارتی براق');
  assert.equal(e.unit, 'سانتی‌متر مربع');
  e.rate = 2; e.setup = 0;
  assert.equal(u.priceEntry(e, { qty: 1000, coverAreaCm2: 875 }, 'binding').amount, 875 * 2 * 1000);
});

test('ردیف‌های پیش‌فرض: حرارتی با زیرمجموعه‌ها و واتربیس فقط براق و مات', async () => {
  const u = await load('units.js');
  const names = u.defaultUnits().binding.items.filter(x => x.kind === 'سلفون').map(x => x.name);
  for (const n of ['سلفون حرارتی براق', 'سلفون حرارتی مات', 'سلفون حرارتی مخملی', 'سلفون حرارتی شنی', 'سلفون واتربیس براق', 'سلفون واتربیس مات']) assert.ok(names.includes(n), n);
  assert.ok(!names.includes('سلفون واتربیس'));
});

test('ارتقای ردیف قدیمی: نام جدید می‌گیرد، بدون نرخ به واحد جدید می‌رود و نرخ ثبت‌شده دست نمی‌خورد', async () => {
  const u = await load('units.js');
  const mk = rate => { const d = u.defaultUnits(); const e = find(d, 'سلفون حرارتی مات'); e.name = 'سلفون مات (حرارتی)'; e.formula = 'مساحت_جلد * نرخ * تیراژ + راه_اندازی'; e.unit = 'سانتی‌متر'; e.rate = rate; return d; };
  const a = find(u.mergeUnits(mk('')), 'سلفون حرارتی مات');
  assert.match(a.formula, /مساحت_جلد_سانتیمتر/);
  const b = find(u.mergeUnits(mk('5')), 'سلفون حرارتی مات');
  assert.doesNotMatch(b.formula, /مساحت_جلد_سانتیمتر/);
  assert.equal(b.rate, '5');
  const m = u.mergeUnits(mk('')).binding.items.filter(x => x.name === 'سلفون حرارتی مخملی');
  assert.equal(m.length, 1, 'ردیف تازه‌ی مخملی یک بار اضافه می‌شود');
});

test('تشخیص نوع سلفون از متن', async () => {
  const c = await load('cellophane.js');
  assert.deepEqual(c.parseCello('جلد گلاسه سلفون مات'), { celloKind: 'حرارتی', cellophane: 'مات', celloVariant: '' });
  assert.deepEqual(c.parseCello('سلفون مخملی'), { celloKind: 'حرارتی', cellophane: 'مات', celloVariant: 'مخملی' });
  assert.deepEqual(c.parseCello('سلفون واتر بیس براق'), { celloKind: 'واتربیس', cellophane: 'براق', celloVariant: '' });
  assert.equal(c.parseCello('بدون پوشش'), null);
  assert.equal(c.celloLabel({ cellophane: 'مات', celloKind: 'حرارتی', celloVariant: 'شنی' }), 'حرارتی شنی');
  assert.deepEqual(c.celloPatch(''), { cellophane: '', celloKind: '', celloVariant: '' });
});