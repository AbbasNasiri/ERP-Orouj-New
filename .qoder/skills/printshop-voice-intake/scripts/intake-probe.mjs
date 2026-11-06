#!/usr/bin/env node
/* Runs the intake fixtures through the real print-shop parser and reports pass/fail.
   Usage: node intake-probe.mjs [--root=<project-dir>] [--fixtures=<file.json>] [--show] */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_ROOT = 'C:/Users/LianTech/Desktop/print-shop-desktop-v1.9-secure/print-shop-desktop';

function flag(name) {
  const arg = process.argv.slice(2).find(a => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}
function findRoot() {
  const given = flag('root') || process.env.PRINTSHOP_ROOT;
  if (given) return given;
  let dir = HERE;
  for (let depth = 0; depth < 6; depth++) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try { if (JSON.parse(readFileSync(pkg, 'utf8')).name === 'print-shop-desktop') return dir; } catch { /* unreadable package.json */ }
    }
    dir = path.dirname(dir);
  }
  return FALLBACK_ROOT;
}

const root = findRoot();
const smartPath = path.join(root, 'src', 'smart.js');
if (!existsSync(smartPath)) {
  console.log(`FAIL cannot find src/smart.js under ${root} — pass --root=<project dir>`);
  process.exit(2);
}
const order = await import(pathToFileURL(path.join(root, 'src', 'smartorder.js')).href);

const fixtureFile = flag('fixtures') || path.join(HERE, '..', 'references', 'intake-fixtures.json');
const fixtures = JSON.parse(readFileSync(fixtureFile, 'utf8'));
const opts = { productTypes: fixtures.productTypes, serviceTypes: fixtures.serviceTypes, bindingTypes: [] };
const pick = (parsed) => ({
  productType: parsed.productType, qty: parsed.qty, pages: parsed.pages, sizeKey: parsed.sizeKey,
  textKind: parsed.text.kind, textGsm: parsed.text.gsm, textColors: parsed.text.colors, textSides: parsed.text.sides,
  coverEnabled: parsed.cover.enabled, coverKind: parsed.cover.kind, coverGsm: parsed.cover.gsm,
  coverColors: parsed.cover.colors, cellophane: parsed.cover.cellophane, binding: parsed.binding, printMethod: parsed.printMethod,
});

let failed = 0;
for (const testCase of fixtures.cases) {
  const items = order.parseOfflineItems(testCase.text, opts);
  const problems = [];
  if (testCase.expect.items !== undefined) {
    if (items.length !== testCase.expect.items) problems.push(`items expected ${testCase.expect.items} got ${items.length}`);
  } else if (!items.length) problems.push('no item extracted');

  const got = items.length ? pick(items[0].parsed) : {};
  for (const [key, want] of Object.entries(testCase.expect)) {
    if (key === 'items') continue;
    if (got[key] !== want) problems.push(`${key} expected ${JSON.stringify(want)} got ${JSON.stringify(got[key])}`);
  }
  const noteCount = items.reduce((sum, item) => sum + (item.parsed.notes || []).length, 0);
  const wantNotes = testCase.notes ?? 'none';
  if (wantNotes === 'none' ? noteCount !== 0 : noteCount !== wantNotes) problems.push(`notes expected ${wantNotes} got ${noteCount}`);

  if (problems.length) {
    failed++;
    console.log(`FAIL ${testCase.name}`);
    problems.forEach(p => console.log(`     ${p}`));
  } else {
    console.log(`PASS ${testCase.name}${noteCount ? ` (${noteCount} confirmation note)` : ''}`);
  }
  if (flag('show')) console.log(`     ${JSON.stringify(got)}`);
}
console.log(`\n${fixtures.cases.length - failed}/${fixtures.cases.length} intake cases pass — root: ${root}`);
process.exit(failed ? 1 : 0);
