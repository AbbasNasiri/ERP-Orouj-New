const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
test('only the manager can add stock from the order form', () => {
  const block = app.slice(app.indexOf('const ROLE_PERMS = {'), app.indexOf('SUPERVISOR_ROLES.forEach'));
  const lines = block.split('\n').filter(l => /addStock/.test(l));
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].includes("'مدیر چاپخانه'"));
  assert.ok(/onAddStock=\{perms\.addStock \?/.test(app));
});