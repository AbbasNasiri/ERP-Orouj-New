const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
const calendar = {};
vm.runInNewContext(app.slice(app.indexOf('function div('), app.indexOf('/* ---------------- helpers')) + '\nthis.api = {toIso:isoFromJ,fromIso:jFromIso,isLeapYear:isLeapJy};', calendar);
const options = { ...calendar.api, today: '2026-10-22' };
const compiled = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/BirthDateInput.jsx')], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } }).outputFiles[0].text;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports);
const { birthDateResult, default: BirthDateInput } = mod.exports;

test('a stored birthday paints as one Persian box and the word شمسی is gone', () => {
  const result = birthDateResult({ year: '1350', month: '1', day: '15' }, options);
  assert.equal(result.valid, true);
  assert.equal(result.iso, '1971-04-04');
  const html = renderToStaticMarkup(React.createElement(BirthDateInput, { ...options, value: result.iso, onChange() {} }));
  const fa = value => String(value).replace(/\d/g, d => String.fromCharCode(0x06f0 + Number(d)));
  assert.ok(html.includes(`value="${fa('1350/01/15')}"`), 'the stored birthday paints as one Persian box');
  assert.equal((html.match(/<input/g) || []).length, 1, 'one box, like every other date field');
  assert.equal((html.match(/<select/g) || []).length, 0, 'no dropdown inside the date');
  assert.doesNotMatch(html, /شمسی/, 'the calendar is Jalali everywhere, so the word adds nothing');
});

test('calendar rejects an impossible date, partial date and future birth, preserving leap-year rules', () => {
  for (const parts of [
    { year: '1400', month: '12', day: '30' },
    { year: '1350', month: '7', day: '31' },
    { year: '1350', month: '', day: '1' },
    { year: '1406', month: '1', day: '1' },
    { year: '1405', month: '12', day: '1' },
  ]) assert.equal(birthDateResult(parts, options).valid, false, JSON.stringify(parts));
  assert.equal(birthDateResult({ year: '1399', month: '12', day: '30' }, options).valid, true);
  assert.deepEqual(birthDateResult({ year: '', month: '', day: '' }, options), { valid: true, iso: '', error: '' });
});
