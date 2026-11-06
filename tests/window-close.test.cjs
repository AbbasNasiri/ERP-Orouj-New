'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createCloseController } = require(path.resolve(__dirname, '..', 'electron', 'window-close.js'));

function fakeWindow(id = 7) {
  const handlers = {};
  const webContents = { id, sent: [], send(channel, requestId) { this.sent.push({ channel, requestId }); }, isDestroyed: () => false };
  return {
    webContents,
    closed: false,
    closeCalls: 0,
    destroyed: false,
    on(event, fn) { (handlers[event] ||= []).push(fn); },
    emit(event, ...args) { return (handlers[event] || []).map(fn => fn(...args)); },
    isDestroyed() { return this.destroyed; },
    close() { this.closeCalls += 1; this.destroyed = true; },
    _handlers: handlers,
  };
}

function harness({ timeoutMs = 7000, dialogResponse = 0, dialogThrows = false } = {}) {
  const timers = [];
  const dialog = { shown: 0, showMessageBox: async () => { dialog.shown += 1; if (dialogThrows) throw new Error('no dialog'); return { response: dialogResponse }; } };
  const controller = createCloseController({
    dialog,
    timeoutMs,
    setTimer: (fn, ms) => { const entry = { fn, ms, cleared: false }; timers.push(entry); return entry; },
    clearTimer: (entry) => { if (entry) entry.cleared = true; },
  });
  const win = fakeWindow();
  controller.attach(win);
  return { controller, win, timers, dialog };
}

test('a close request never destroys the window on its own: it is prevented and handed to the form', () => {
  const { win } = harness();
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  win.emit('close', event);
  assert.equal(event.prevented, true, 'the window must not close before the renderer answers');
  assert.equal(win.closeCalls, 0);
  assert.equal(win.webContents.sent.length, 1);
  assert.equal(win.webContents.sent[0].channel, 'win:close-request');
  assert.ok(win.webContents.sent[0].requestId, 'a request id is issued so the answer can be verified');
});

test('declining the prompt keeps the application open and consumes only that request', () => {
  const { controller, win } = harness();
  win.emit('close', { preventDefault() {} });
  const requestId = win.webContents.sent[0].requestId;
  assert.deepEqual(controller.respond(win.webContents, requestId, false), { ok: true });
  assert.equal(win.closeCalls, 0);
  assert.equal(win.destroyed, false);
});

test('an explicit confirmation closes the window exactly once', () => {
  const { controller, win } = harness();
  win.emit('close', { preventDefault() {} });
  const requestId = win.webContents.sent[0].requestId;
  assert.deepEqual(controller.respond(win.webContents, requestId, true), { ok: true });
  assert.equal(win.closeCalls, 1);
});

test('forged, replayed or non-boolean answers cannot close the window', () => {
  const { controller, win } = harness();
  win.emit('close', { preventDefault() {} });
  const requestId = win.webContents.sent[0].requestId;
  const stranger = { id: 7, send() {}, isDestroyed: () => false };
  assert.equal(controller.respond(stranger, requestId, true).code, 'INVALID_CLOSE_REQUEST');
  assert.equal(controller.respond(win.webContents, 'not-the-id', true).code, 'INVALID_CLOSE_REQUEST');
  assert.equal(controller.respond(win.webContents, requestId, 'true').code, 'INVALID_CLOSE_REQUEST');
  assert.equal(controller.respond(win.webContents, requestId, undefined).code, 'INVALID_CLOSE_REQUEST');
  assert.equal(win.closeCalls, 0, 'no answer was accepted, so the window stays open');
  assert.deepEqual(controller.respond(win.webContents, requestId, false), { ok: true }, 'the real request is still open');
  assert.equal(controller.respond(win.webContents, requestId, true).code, 'INVALID_CLOSE_REQUEST', 'a request is answered once');
});

test('a second close click while a prompt is open does not stack prompts', () => {
  const { controller, win } = harness();
  win.emit('close', { preventDefault() {} });
  win.emit('close', { preventDefault() {} });
  assert.equal(win.webContents.sent.length, 1);
  controller.respond(win.webContents, win.webContents.sent[0].requestId, false);
  win.emit('close', { preventDefault() {} });
  assert.equal(win.webContents.sent.length, 2, 'after the answer, a new request is allowed');
});

test('a dead renderer falls back to the native dialog, and its default keeps the data open', async () => {
  const { controller, win, timers, dialog } = harness({ dialogResponse: 0 });
  win.emit('close', { preventDefault() {} });
  await timers[0].fn();
  assert.equal(dialog.shown, 1);
  assert.equal(win.closeCalls, 0, 'the safe default is to stay in the application');
});

test('the native fallback closes only when it is explicitly chosen', async () => {
  const { controller, win, timers, dialog } = harness({ dialogResponse: 1 });
  win.emit('close', { preventDefault() {} });
  await timers[0].fn();
  assert.equal(dialog.shown, 1);
  assert.equal(win.closeCalls, 1);
});

test('an unreachable native dialog never forces the window shut', async () => {
  const { controller, win, timers } = harness({ dialogThrows: true });
  win.emit('close', { preventDefault() {} });
  await timers[0].fn();
  assert.equal(win.closeCalls, 0);
});

test('a live renderer acknowledging the request cancels the native fallback', async () => {
  const { controller, win, timers, dialog } = harness();
  win.emit('close', { preventDefault() {} });
  const requestId = win.webContents.sent[0].requestId;
  assert.equal(controller.acknowledge(win.webContents, requestId), true);
  assert.equal(timers[0].cleared, true, 'the fallback timer is disarmed as soon as the form takes over');
  assert.equal(dialog.shown, 0, 'the native dialog is not shown once the form has taken over');
  assert.equal(controller.acknowledge(win.webContents, 'wrong-id'), false);
  assert.deepEqual(controller.respond(win.webContents, requestId, false), { ok: true }, 'the form still owns the request');
});

test('closing the window clears the pending request', () => {
  const { controller, win, timers } = harness();
  win.emit('close', { preventDefault() {} });
  const requestId = win.webContents.sent[0].requestId;
  win.emit('closed');
  assert.equal(timers[0].cleared, true);
  assert.equal(controller.respond(win.webContents, requestId, true).code, 'INVALID_CLOSE_REQUEST');
});
