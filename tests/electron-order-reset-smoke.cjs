'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const workDir = path.resolve(__dirname, '../../.work');
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-order-reset-'));
fs.mkdirSync(path.join(fixtureDir, 'user-data'));
app.setPath('userData', path.join(fixtureDir, 'user-data'));
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
const timeout = setTimeout(() => { console.error('Order reset smoke timed out'); app.exit(1); }, 65000);

async function prepare() {
  window.alert = message => console.log('RESET_ALERT:' + String(message));
  window.confirm = () => true;
  console.log('RESET_PHASE:prepare');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const ok = async promise => { const value = await promise; check(value?.ok, value?.error || 'Request failed'); return value; };
  async function waitFor(fn) { for (let i = 0; i < 140; i++) { const value = fn(); if (value) return value; await pause(50); } throw new Error('UI wait expired'); }
  function enter(element, value) { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }
  const api = window.printshopApi;
  await ok(api.auth.login('admin', '1234'));
  await ok(api.auth.setOwnPassword('smoke-reset-manager'));
  const users = (await ok(api.auth.listUsers())).users;
  users.push({ id: 'finance', username: 'reset-finance', name: 'مالی آزمایشی', role: 'مدیر مالی', _plain: 'smoke-reset-finance' });
  await ok(api.auth.saveUsers(users));
  await ok(api.set('printshop_customers_v2', [{ id: 'customer', name: 'مشتری آزمایشی', entityType: 'حقیقی' }]));
  await ok(api.set('printshop_inventory_v3', [{ id: 'paper', name: 'کاغذ آزمایشی', quantity: '10', ownerType: 'چاپخانه', movements: [] }]));
  await ok(api.set('printshop_orders_v5', [{ id: 'old', customerId: 'customer', customerName: 'مشتری آزمایشی', status: 'در انتظار تایید', quoteRev: 1, items: [], payments: [], history: [] }]));
  await ok(api.auth.logout());
  console.log('RESET_PHASE:seeded');
  await waitFor(() => document.querySelector('input[type="password"]'));
  enter([...document.querySelectorAll('input')].find(input => input.type !== 'password'), 'admin');
  enter(document.querySelector('input[type="password"]'), 'smoke-reset-manager');
  await pause(100); [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'ورود').click();
  await waitFor(() => document.querySelector('.workbench-shell'));
  console.log('RESET_PHASE:manager-ui');
  const tab = [...document.querySelectorAll('.workbench-navitem')].find(button => button.textContent.trim() === 'پاکسازی سفارش‌های آزمایشی');
  check(tab, 'Manager maintenance tab missing'); tab.click();
  await waitFor(() => document.querySelector('.order-reset-panel'));
  [...document.querySelectorAll('.order-reset-panel button')].find(button => button.textContent.includes('بررسی تعداد')).click();
  await waitFor(() => document.querySelector('.order-reset-panel form'));
  const panel = document.querySelector('.order-reset-panel');
  check(panel.querySelector('dd').textContent.trim() === '۱', 'Preview count incorrect');
  enter(panel.querySelector('textarea'), 'پاکسازی سفارش آزمایشی برای آزمون');
  panel.querySelector('input[type="checkbox"]').click();
  enter(panel.querySelector('input:not([type="checkbox"])'), 'پاکسازی سفارش‌های آزمایشی');
  await pause(100);
  check(!panel.querySelector('button[type="submit"]').disabled, 'Confirmed reset remains disabled');
  window.alert = message => console.log('RESET_ALERT:' + String(message));
  console.log('RESET_PHASE:ready-to-reset');
  return { managerTab: true, previewLoaded: true };
}

async function verify() {
  window.alert = message => console.log('RESET_ALERT:' + String(message));
  window.confirm = () => true;
  console.log('RESET_PHASE:verify-reloaded');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const ok = async promise => { const value = await promise; check(value?.ok, value?.error || 'Request failed'); return value; };
  async function waitFor(fn) { for (let i = 0; i < 140; i++) { const value = fn(); if (value) return value; await pause(50); } throw new Error('UI wait expired'); }
  function enter(element, value) { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }
  await waitFor(() => document.querySelector('input[type="password"]'));
  const api = window.printshopApi;
  check(!(await api.get('printshop_orders_v5')).ok, 'Reload retained authenticated data access');
  await ok(api.auth.login('admin', 'smoke-reset-manager'));
  check((await ok(api.get('printshop_orders_v5'))).value.length === 0, 'Orders not cleared');
  check((await ok(api.get('printshop_customers_v2'))).value.length === 1, 'Customer was lost');
  const inventory = (await ok(api.get('printshop_inventory_v3'))).value;
  check(inventory.length === 1 && inventory[0].quantity === '10', 'Inventory changed');
  const saved = await ok(api.set('printshop_orders_v5', [{ id: 'new', status: 'در انتظار تایید', items: [], history: [], payments: [] }]));
  check(saved.value[0].orderNumber === '1002', 'Order counter reused');
  await ok(api.auth.logout());
  enter([...document.querySelectorAll('input')].find(input => input.type !== 'password'), 'reset-finance');
  enter(document.querySelector('input[type="password"]'), 'smoke-reset-finance');
  await pause(100); [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'ورود').click();
  await waitFor(() => document.querySelector('.workbench-shell'));
  check(![...document.querySelectorAll('.workbench-navitem')].some(button => button.textContent.trim() === 'پاکسازی سفارش‌های آزمایشی'), 'Finance sees maintenance tab');
  check((await api.previewOrderReset()).code === 'FORBIDDEN', 'Finance backend reset access allowed');
  return { reloadedAfterReset: true, preservedCustomers: 1, preservedInventory: 1, nextOrderNumber: '1002', financeDenied: true };
}

app.on('browser-window-created', (_event, win) => {
  win.hide();
  const alerts = [];
  win.webContents.on('console-message', (_event, _level, message) => { if (message.startsWith('RESET_ALERT:')) alerts.push(message); if (message.startsWith('RESET_PHASE:')) console.log(message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const prepared = await win.webContents.executeJavaScript(`(${prepare.toString()})()`);
      fs.writeFileSync(path.join(workDir, 'order-reset-maintenance.png'), (await win.webContents.capturePage()).toPNG());
      const reload = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      await win.webContents.executeJavaScript(`document.querySelector('.order-reset-panel button[type="submit"]').click(); true`);
      await reload;
      const result = await win.webContents.executeJavaScript(`(${verify.toString()})()`);
      if (!alerts.some(message => message.includes('printshop-before-order-reset-'))) throw new Error('Backup path was not shown in reset alert');
      console.log(JSON.stringify({ smoke: 'order-reset-real-ui-ipc', pass: true, ...prepared, ...result, backupNotice: true, fixtureDir }));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(error.stack); clearTimeout(timeout); app.exit(1); }
  });
});
require('../electron/main.js');
