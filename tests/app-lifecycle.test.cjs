const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireSingleInstance, recordRuntimeEvent } = require('../electron/app-lifecycle');
test('a second application instance quits; the active window restores without a new window', () => {
  let quit = 0, restore = 0, show = 0, focus = 0; const events = {};
  const window = { isDestroyed: () => false, isMinimized: () => true, restore: () => restore++, show: () => show++, focus: () => focus++ };
  const app = { requestSingleInstanceLock: () => true, on: (event, fn) => events[event] = fn, quit: () => quit++ };
  assert.equal(acquireSingleInstance(app, { getAllWindows: () => [window] }), true);
  events['second-instance'](); assert.deepEqual([quit, restore, show, focus], [0, 1, 1, 1]);
  app.requestSingleInstanceLock = () => false;
  assert.equal(acquireSingleInstance(app, {}), false); assert.equal(quit, 1);
});
test('crash diagnostics contain only bounded process metadata and never customer content', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-runtime-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  recordRuntimeEvent(folder, 'renderer-exit', { reason: 'oom', exitCode: 134, type: 'Utility', customer: 'PRIVATE', text: 'PRIVATE' });
  const row = JSON.parse(fs.readFileSync(path.join(folder, 'logs/runtime.jsonl'), 'utf8'));
  assert.equal(row.reason, 'oom'); assert.equal(row.exitCode, 134);
  assert.equal(JSON.stringify(row).includes('PRIVATE'), false);
  assert.doesNotThrow(() => recordRuntimeEvent('\0', 'write-failure'));
});
