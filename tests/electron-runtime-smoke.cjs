'use strict';
// Manual Electron-runtime smoke, intentionally not *.test.cjs: native addons
// rebuilt for Electron must not be loaded by the host Node test runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('../electron/backend.js');
assert.ok(process.versions.electron, 'Run this harness with the project Electron executable');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });

function nativeSmoke() {
  const NativeDatabase = require('better-sqlite3');
  const raw = new NativeDatabase(':memory:');
  const sqliteVersion = raw.prepare('SELECT sqlite_version() AS version').get().version;
  raw.close();
  const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-native-smoke-'));
  let backend;
  try {
    // No adapter override: exercise production openSqlite and the real native ABI.
    backend = createBackend({ dataDir: fixtureDir });
    const login = backend.login('admin', '1234');
    assert.equal(login.ok, true);
    assert.equal(backend.get(login.token, 'printshop_orders_v5').ok, false);
    assert.equal(backend.setOwnPassword(login.token, 'isolated-smoke-strong-password').ok, true);
    assert.equal(backend.get(login.token, 'printshop_orders_v5').ok, true);
    assert.equal(backend.logout(login.token), true);
    assert.equal(backend.get(login.token, 'printshop_orders_v5').ok, false);
    console.log(JSON.stringify({ smoke: 'native-backend', pass: true, electron: process.versions.electron,
      node: process.versions.node, abi: process.versions.modules, sqliteVersion }));
  } finally {
    if (backend) backend.close();
    // Only this generated fixture inside the selected project's .work is removed.
    assert.equal(path.dirname(fixtureDir), workDir);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

if (!process.argv.includes('--ui')) {
  nativeSmoke();
} else {
  const { app } = require('electron');
  const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-ui-smoke-'));
  const userData = path.join(fixtureDir, 'electron-user-data');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
  const timeout = setTimeout(() => { console.error('UI smoke timed out'); app.exit(1); }, 25000);
  app.on('browser-window-created', (_event, win) => {
    win.hide();
    win.webContents.once('did-fail-load', (_e, code, reason) => {
      console.error(JSON.stringify({ smoke: 'ui', pass: false, code, reason })); app.exit(1);
    });
    win.webContents.once('did-finish-load', async () => {
      try {
        // Wait for React to mount, without invoking login or modifying app state.
        const state = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
          let attempts = 0;
          const check = () => {
            const text = document.body.innerText;
            if (text.includes('ورود')) return resolve({ secure: window.printshopApi?.secure,
              mode: window.printshopApi?.mode, loginRendered: true,
              hasPasswordInput: !!document.querySelector('input[type="password"]'),
              tokenExposed: Object.hasOwn(window.printshopApi || {}, 'token') });
            if (++attempts > 100) return reject(new Error('Login page did not render'));
            setTimeout(check, 50);
          }; check();
        })`);
        assert.equal(state.secure, true);
        assert.equal(state.mode, 'secure');
        assert.equal(state.loginRendered, true);
        assert.equal(state.hasPasswordInput, true);
        assert.equal(state.tokenExposed, false);
        clearTimeout(timeout);
        console.log(JSON.stringify({ smoke: 'real-main-preload-react', pass: true, ...state,
          fixtureDir, electron: process.versions.electron }));
        // Keep isolated UI fixture for inspection; the process owns its open DB.
        app.exit(0);
      } catch (error) { console.error(error.stack); app.exit(1); }
    });
  });
  require('../electron/main.js');
}
