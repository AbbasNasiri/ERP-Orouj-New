'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'print-run.mjs')).href;

test('cover run follows the owner rule for each cover press', async () => {
  const { coverRun } = await import(moduleUrl);
  assert.deepEqual(
    (({ press, coversPerSheet, waste, sheetsNet, sheets }) => ({ press, coversPerSheet, waste, sheetsNet, sheets }))(coverRun(2000, 'GTO')),
    { press: 'GTO', coversPerSheet: 1, waste: 100, sheetsNet: 2000, sheets: 2100 },
  );
  assert.deepEqual(
    (({ coversPerSheet, waste, sheetsNet, sheets }) => ({ coversPerSheet, waste, sheetsNet, sheets }))(coverRun('۲۰۰۰', '2 ورقی')),
    { coversPerSheet: 2, waste: 50, sheetsNet: 1000, sheets: 1050 },
  );
  assert.deepEqual(
    (({ coversPerSheet, waste, sheetsNet, sheets }) => ({ coversPerSheet, waste, sheetsNet, sheets }))(coverRun('2,000', '4.5 ورقی')),
    { coversPerSheet: 8, waste: 25, sheetsNet: 250, sheets: 275 },
  );
});

test('an unknown cover press falls back to GTO instead of guessing', async () => {
  const { coverRun } = await import(moduleUrl);
  const run = coverRun(300, 'نامشخص');
  assert.equal(run.press, 'GTO');
  assert.equal(run.sheets, 400);
});

test('text run adds the entered waste and ignores an empty waste', async () => {
  const { textRun } = await import(moduleUrl);
  assert.deepEqual(textRun('2,000', '۱۰۰'), { net: 2000, waste: 100, total: 2100 });
  assert.deepEqual(textRun(2000, ''), { net: 2000, waste: 0, total: 2000 });
  assert.deepEqual(textRun('', 100), { net: 0, waste: 100, total: 100 });
  assert.deepEqual(textRun(0, 0), { net: 0, waste: 0, total: 0 });
});
