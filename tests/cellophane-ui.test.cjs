'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = (f) => import(pathToFileURL(path.join(__dirname, '..', 'src', f)).href);

test('گزینه‌های سلفون: ترکیب و برچسب و بازگشت به بدون سلفون', async () => {
  const c = await load('cellophane.js');
  const vals = c.CELLO_OPTIONS.map(o => o.value);
  for (const v of ['حرارتی|براق|', 'حرارتی|مات|', 'حرارتی|مات|مخملی', 'حرارتی|مات|شنی', 'حرارتی|براق|هولوگرام', 'واتربیس|براق|', 'واتربیس|مات|']) assert.ok(vals.includes(v), v);
  const sp = { ...c.celloPatch('حرارتی|مات|مخملی') };
  assert.equal(c.celloComboOf(sp), 'حرارتی|مات|مخملی');
  assert.equal(c.celloLabel(sp), 'حرارتی مخملی');
  assert.deepEqual(c.celloPatch(''), { cellophane: '', celloKind: '', celloVariant: '' });
});

test('متن آزاد: سلفون مخملی و واتربیس مات', async () => {
  const c = await load('cellophane.js');
  assert.deepEqual(c.parseCello('جلد با سلفون مخملی'), { celloKind: 'حرارتی', cellophane: 'مات', celloVariant: 'مخملی' });
  assert.deepEqual(c.parseCello('سلفون واتربیس مات'), { celloKind: 'واتربیس', cellophane: 'مات', celloVariant: '' });
  assert.equal(c.parseCello('بدون پوشش'), null);
});