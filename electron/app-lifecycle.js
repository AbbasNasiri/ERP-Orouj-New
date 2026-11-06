'use strict';
const fs = require('node:fs');
const path = require('node:path');

function acquireSingleInstance(app, BrowserWindow) {
  if (typeof app.requestSingleInstanceLock !== 'function') return true;
  if (!app.requestSingleInstanceLock()) { app.quit(); return false; }
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  });
  return true;
}
function recordRuntimeEvent(directory, event, details = {}) {
  try {
    const folder = path.join(directory, 'logs');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'runtime.jsonl');
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, path.join(folder, `runtime-${Date.now()}.jsonl`));
    fs.appendFileSync(file, JSON.stringify({ date: new Date().toISOString(), event, reason: details.reason || '', exitCode: details.exitCode, type: details.type || '' }) + '\n');
  } catch (_) { /* A diagnostic write must never close the application. */ }
}
module.exports = { acquireSingleInstance, recordRuntimeEvent };
