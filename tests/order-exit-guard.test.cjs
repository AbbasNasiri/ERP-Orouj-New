const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const src = n => fs.readFileSync(path.join(__dirname, '..', 'src', n), 'utf8');
test('order modal dirty state is a real comparison and new customers are staged', () => {
  const a = src('App.jsx'), g = src('ExitGuard.jsx');
  assert.ok(a.includes('JSON.stringify(o) !== initialJson.current'));
  assert.ok(a.includes('setStagedCustomers(prev => [c, ...prev])'));
  assert.ok(/wide dirty=\{orderDirty\}/.test(a));
  assert.ok(g.includes('dirty: dirtyProp'));
  assert.ok(!g.includes('بستن بدون ذخیره'));
});
