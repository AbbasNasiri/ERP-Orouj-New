const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const src = n => fs.readFileSync(path.join(__dirname, '..', 'src', n), 'utf8');
test('stock size mismatch is flagged in the item table and in order issues', () => {
  const t = src('OrderItemsTable.jsx'), a = src('App.jsx');
  assert.ok(/export function stockSizeWarning/.test(t));
  assert.ok(t.includes('oit-sizewarn'));
  assert.ok(/stockSizeWarning\(inv,/.test(a));
});
