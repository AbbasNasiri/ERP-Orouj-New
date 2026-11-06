'use strict';
// Manual integration harness: run with the project's electron.exe, not host Node.
// Exercises the real main/preload/native DB through the exposed renderer API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
assert.ok(process.versions.electron, 'Electron runtime required');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-quote-smoke-'));
const userData = path.join(fixtureDir, 'electron-user-data');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
const timeout = setTimeout(() => { console.error('Quote IPC smoke timed out'); app.exit(1); }, 30000);

async function rendererScenario() {
  function check(condition, message) { if (!condition) throw new Error(message); }
  async function ok(promise, message) {
    const response = await promise;
    check(response && response.ok, `${message}: ${response?.code || ''} ${response?.error || ''}`);
    return response;
  }
  // Allow React to mount, then exercise IPC independently of component state.
  for (let attempt = 0; !document.querySelector('input[type="password"]') && attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const loginRendered = document.body.innerText.includes('ورود') && !!document.querySelector('input[type="password"]');
  check(loginRendered, 'React login page did not render');
  const api = window.printshopApi;
  check(api?.secure === true && api.mode === 'secure', 'Real main/preload did not start in secure mode');
  check(typeof api.previewQuote === 'function', 'previewQuote bridge missing');
  const key = 'printshop_orders_v5';
  const login = await ok(api.auth.login('admin', '1234'), 'login');
  check(!Object.hasOwn(login, 'token'), 'Login token exposed to renderer');
  check(!(await api.get(key)).ok, 'Forced-password-change guard did not block read');
  await ok(api.auth.setOwnPassword('isolated-quote-smoke-password'), 'initial password change');
  const initial = await ok(api.get(key), 'initial read');
  check(initial.value === null || initial.value.length === 0, 'Fixture contains unexpected existing orders');
  const paid = 100000000;
  const order = { id: 'smoke-book', orderNumber: 'SMOKE-1001', customerId: 'smoke-customer', customerName: 'مشتری آزمایشی',
    title: 'کتاب نمونه ۴۰۰ صفحه', status: 'در انتظار تایید', quoteRev: 1,
    items: [{ id: 'smoke-item', stage: 'ثبت سفارش', qty: 2000, unitPrice: 0, services: [] }],
    payments: [{ id: 'smoke-payment', amount: paid }], history: [] };
  await ok(api.set(key, [order]), 'create synthetic order');
  const input = { currency: 'IRR', effectiveDate: '2026-10-22', discount: 0, serviceMarkupPercent: 20, taxPercent: 10,
    materials: [{ id: 'text-paper', description: 'کاغذ متن مشتری', qty: 52500, unit: 'ورق', rate: 100, customerSupplied: true },
      { id: 'cover-paper', description: 'مقوای جلد مشتری', qty: 550, unit: 'ورق', rate: 100, customerSupplied: true }],
    services: [
      { id: 'plates', description: 'زینک متن و جلد', qty: 1, unit: 'خدمت', rate: 4080000000 },
      { id: 'print', description: 'چاپ متن و جلد', qty: 1, unit: 'خدمت', rate: 4100000000 },
      { id: 'laminate', description: 'سلفون جلد', qty: 1, unit: 'خدمت', rate: 175000000 },
      { id: 'binding', description: 'صحافی', qty: 1, unit: 'خدمت', rate: 2040000000 },
    ], offers: [{ id: 'delivery', description: 'ارسال رایگان', internalCost: 100000 }] };
  const preview = await ok(api.previewQuote(order.id, input), 'preview');
  check(preview.result.materialsCost === 0, 'Customer-owned materials were charged');
  check(preview.result.baseCost === 10395000000, 'Preview base differs from agreed example');
  check(preview.result.subtotal === 12474000000, 'Preview subtotal differs from agreed example');
  check(preview.result.total === 13721400000, 'Preview total differs from agreed example');
  const afterPreview = await ok(api.get(key), 'read after preview');
  check(afterPreview.value[0].pricing === undefined && afterPreview.value[0].quoteRev === 1, 'Preview persisted data');
  const saved = await ok(api.orderAction(order.id, 'save_quote', { input, expectedRevision: 1 }), 'save quote');
  check(saved.order.quoteRev === 2 && saved.order.pricing.revision === 2, 'Quote revision did not advance');
  check(saved.order.pricing.result.total === 13721400000, 'Saved amount differs from preview');
  const stale = await api.orderAction(order.id, 'save_quote', { input, expectedRevision: 1 });
  check(stale.ok === false && stale.code === 'REVISION_CONFLICT', 'Stale save was not rejected');
  const confirmed = await ok(api.orderAction(order.id, 'confirm_customer', { evidence: 'تأیید نمونه صرفاً در پایگاه آزمایشی' }), 'customer confirmation');
  check(confirmed.order.workflow.customerConfirmation.quoteRevision === 2, 'Confirmation revision incorrect');
  const changed = structuredClone(input);
  changed.services[0].rate += 100;
  const repriced = await ok(api.orderAction(order.id, 'save_quote', { input: changed, expectedRevision: 2 }), 'reprice');
  check(repriced.order.quoteRev === 3 && !repriced.order.workflow.customerConfirmation, 'Repricing retained stale confirmation');
  check(repriced.order.payments.length === 1 && repriced.order.payments[0].amount === paid, 'Repricing changed payment');
  check(repriced.order.quoteHistory.length === 1 && repriced.order.quoteHistory[0].result.total === 13721400000, 'Old quote was not archived');
  const persisted = (await ok(api.get(key), 'final persisted read')).value[0];
  check(persisted.quoteRev === 3 && persisted.payments[0].amount === paid, 'Persisted repricing/payment mismatch');
  await ok(api.auth.logout(), 'logout');
  check(!(await api.get(key)).ok, 'Read after logout remained authorized');
  return { secure: true, loginRendered, previewTotalIRR: preview.result.total,
    savedRevision: saved.order.quoteRev, staleCode: stale.code, repricedRevision: persisted.quoteRev,
    confirmationCleared: !persisted.workflow.customerConfirmation, preservedPaymentIRR: persisted.payments[0].amount,
    archivedQuotes: persisted.quoteHistory.length, loggedOutReadDenied: true };
}

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.once('did-fail-load', (_e, code, reason) => {
    console.error(JSON.stringify({ smoke: 'quote-real-ipc', pass: false, code, reason })); app.exit(1);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(${rendererScenario.toString()})()`);
      clearTimeout(timeout);
      console.log(JSON.stringify({ smoke: 'quote-real-ipc', pass: true, electron: process.versions.electron,
        abi: process.versions.modules, fixtureDir, ...result }));
      // The DB is owned by main.js; retain only this isolated fixture for inspection.
      app.exit(0);
    } catch (error) { console.error(error.stack); app.exit(1); }
  });
});
require('../electron/main.js');
