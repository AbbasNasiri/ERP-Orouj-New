'use strict';
const { randomUUID } = require('node:crypto');

function createCloseController({ dialog, timeoutMs = 7000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const pending = new Map();
  const allowed = new WeakSet();
  function attach(win) {
    if (typeof win.on !== 'function') return;
    const senderId = win.webContents.id;
    win.on('close', event => {
      if (allowed.has(win)) return;
      event.preventDefault();
      if (pending.has(senderId)) return;
      const requestId = randomUUID();
      const state = { win, requestId, timer: null };
      pending.set(senderId, state);
      // If the renderer has not loaded or has crashed, the native dialog is a
      // recovery path. The default and Escape response always keep data open.
      state.timer = setTimer(async () => {
        if (pending.get(senderId) !== state || win.isDestroyed()) return;
        let response;
        try { response = await dialog.showMessageBox(win, { type: 'question', title: 'خروج از برنامه', message: 'پاسخ فرم در دسترس نیست. از برنامه خارج می‌شوید؟', detail: 'ممکن است تغییرات ذخیره‌نشده از دست برود.', buttons: ['ماندن در برنامه', 'خروج بدون ذخیره'], defaultId: 0, cancelId: 0, noLink: true }); }
        catch (_) { response = { response: 0 }; }
        if (pending.get(senderId) !== state) return;
        respond(win.webContents, requestId, response.response === 1);
      }, timeoutMs);
      state.timer?.unref?.();
      win.webContents.send?.('win:close-request', requestId);
    });
    win.on('closed', () => {
      const state = pending.get(senderId);
      if (state) clearTimer(state.timer);
      pending.delete(senderId);
    });
  }
  function respond(sender, requestId, confirmed) {
    const state = pending.get(sender.id);
    if (!state || state.win.webContents !== sender || state.requestId !== requestId || typeof confirmed !== 'boolean') return { ok: false, code: 'INVALID_CLOSE_REQUEST' };
    clearTimer(state.timer); pending.delete(sender.id);
    if (confirmed && !state.win.isDestroyed()) { allowed.add(state.win); state.win.close(); }
    return { ok: true };
  }
  function acknowledge(sender, requestId) {
    const state = pending.get(sender.id);
    if (!state || state.win.webContents !== sender || state.requestId !== requestId) return false;
    clearTimer(state.timer); state.timer = null;
    return true;
  }
  return { attach, respond, acknowledge };
}
module.exports = { createCloseController };
