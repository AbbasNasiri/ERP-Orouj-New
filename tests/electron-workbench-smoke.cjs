'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-workbench-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
const timeout = setTimeout(() => { console.error('Workbench smoke timed out'); app.exit(1); }, 75000);

async function scenario() {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  async function ok(request) { const result = await request; check(result?.ok, result?.error || 'Request failed'); return result; }
  async function waitFor(select) { for (let i = 0; i < 120; i++) { const value = select(); if (value) return value; await pause(50); } throw new Error('UI wait expired: ' + select); }
  const api = window.printshopApi;
  await ok(api.auth.login('admin', '1234'));
  await ok(api.auth.setOwnPassword('workbench-isolated-password'));
  const ordersKey = 'printshop_orders_v5';
  await ok(api.get(ordersKey));
  const saved = await ok(api.set(ordersKey, [{ id: 'smoke-order', orderNumber: 'forged', customerName: 'مشتری آزمایشی', title: 'چاپ کتاب', status: 'در انتظار تایید', quoteRev: 1, items: [{id:'item',stage:'ثبت سفارش',qty:1,services:[]}],payments:[],history:[] }]));
  const order = saved.value[0];
  check(order.orderNumber === '1001', 'Server order number missing');
  const input = { currency:'IRR', effectiveDate:'2026-10-22', materials:[], services:[{id:'service',description:'چاپ',qty:1,unit:'نوبت',rate:1000}], offers:[],serviceMarkupPercent:20,taxPercent:0,discount:0 };
  await ok(api.orderAction(order.id, 'save_quote', {input,expectedRevision:1}));
  const quote = (await ok(api.documentAction(order.id,'issue_quote',{}))).document;
  check(quote.number !== order.orderNumber, 'Document reused order number');
  await ok(api.auth.logout());
  await waitFor(() => document.querySelector('input[type="password"]'));
  function enter(element,value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value); element.dispatchEvent(new Event('input',{bubbles:true})); }
  const password = document.querySelector('input[type="password"]');
  const username = [...document.querySelectorAll('input')].find(input => input.type !== 'password');
  enter(username,'admin'); enter(password,'workbench-isolated-password'); await pause(100);
  [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'ورود').click();
  await waitFor(() => document.querySelector('.workbench-shell'));
  // UI-01/UI-02/UI-04: the shell owns the user intro (top of the right column) and logout (bottom);
  // the application top bar keeps only alerts and the emergency stop.
  // اصلاحات ۹ بند ۴ (تصمیم کارفرما ۱۴۰۵/۰۸/۰۲): نوار «کارتابل‌ها» سر ستون راست است و
  // بلوک معرفی کاربر درست زیر آن می‌آید — هیچ‌کدام به پایین یا به نوار بالا منتقل نمی‌شوند.
  const sidebar = document.querySelector('.workbench-sidebar');
  const userBlock = sidebar.querySelector('.workbench-user');
  const logoutButton = sidebar.querySelector('.workbench-logout');
  check(sidebar.firstElementChild?.classList.contains('sidebar-toolbar'), 'The کارتابل‌ها toolbar must open the right column');
  check(sidebar.children[1] === userBlock, 'The user intro must sit directly under the toolbar at the top of the right column');
  check(sidebar.lastElementChild?.contains(logoutButton), 'Logout must sit at the bottom of the right column');
  check(userBlock.querySelector('strong')?.textContent.trim().length > 0, 'No active user name in the right column');
  check(userBlock.querySelector('div>span')?.textContent.trim().length > 0, 'No active user role in the right column');
  check(userBlock.querySelector('.workbench-user-avatar')?.textContent.trim() === userBlock.querySelector('strong').textContent.trim().slice(0, 1), 'The circular avatar does not carry the user initial');
  const topBar = document.querySelector('.printshop-desktop > div:first-child');
  check(!topBar.querySelector('.workbench-logout') && ![...topBar.querySelectorAll('button')].some(button => (button.getAttribute('aria-label') || '').includes('خروج')), 'Logout still repeats in the application top bar');
  check(!topBar.textContent.includes(userBlock.querySelector('strong').textContent.trim()), 'The user intro still repeats in the application top bar');
  check(topBar.textContent.includes('توقف / لغو به درخواست مشتری'), 'The emergency stop left the top bar (UI-04)');
  check(!!topBar.querySelector('.workflow-button:not(.workflow-danger)'), 'Internal notifications left the top bar (UI-04)');
  async function open(label) { const button = [...document.querySelectorAll('.workbench-navitem')].find(button => button.textContent.trim() === label); check(button, 'Missing desk ' + label); button.click(); await pause(140); }
  await open('قیمت‌گذاری و دریافت');
  const lookup = document.querySelector('input[list="finance-order-numbers"]');
  enter(lookup,'1001'); await pause(150);
  await open('فاکتورها');
  check(document.querySelectorAll('.workbench-tabstrip:first-of-type [role="tab"]').length >= 3,'Independent tabs missing');
  await open('قیمت‌گذاری و دریافت');
  check(document.querySelector('input[list="finance-order-numbers"]').value === '1001','Draft lost on tab switch');
  await open('مدیریت شماره‌گذاری');
  await waitFor(() => document.querySelector('input[name="order-next"]'));
  check(document.querySelector('input[name="order-next"]').value === '1002','Numbering editor did not load backend defaults');
  await open('پیش‌فاکتورها');
  await waitFor(() => [...document.querySelectorAll('.workbench-page:not([hidden]) td')].some(td => td.textContent.includes(quote.number)));
  const current = document.querySelector('.workbench-page:not([hidden])');
  [...current.querySelectorAll('button')].find(button => button.textContent.trim() === 'چاپ').click(); await pause(150);
  check(document.body.innerText.includes('مرجع سفارش') && document.body.innerText.includes(quote.number),'Printed document reference missing');
  // UI-05: the footer keyhint must be true from the work area, without focusing a tab first.
  const selectedTab = () => document.querySelector('.workbench-tab[aria-selected="true"]')?.textContent.trim();
  const tabCount = () => document.querySelectorAll('.workbench-tab').length;
  const panel = document.querySelector('.workbench-content');
  const tabsBefore = tabCount();
  check(tabsBefore >= 2, 'The keyboard check needs more than one open tab: ' + tabsBefore);
  // اصلاحات ۹ بند ۹: تا فرمی باز است، Delete تب را نمی‌بندد؛ پنجرهٔ تأیید می‌آید و
  // کاربر خودش انتخاب می‌کند. پیش‌نمایش چاپ در این لحظه باز است، پس این کنترل منفی است.
  panel.focus();
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await pause(220);
  const guard = document.querySelector('.ui-exit-dialog');
  check(!!guard, 'Delete closed a tab while the print preview was still open (بند ۹)');
  check(guard.textContent.includes('پیش‌نمایش چاپ'), 'The confirm dialog does not name the open form: ' + guard.textContent.replace(/\s+/g, ' ').trim().slice(0, 90));
  check(tabCount() === tabsBefore, `Delete with an open form destroyed a tab (بند ۹): ${tabsBefore} -> ${tabCount()}`);
  [...guard.querySelectorAll('button')].find(button => button.textContent.trim() === 'بازگشت به فرم').click(); await pause(180);
  check(!document.querySelector('.ui-exit-dialog'), 'The confirm dialog stayed open after بازگشت به فرم');
  check(!!document.querySelector('.print-root'), 'بازگشت به فرم closed the print preview instead of returning to it');
  // محیط را تمیز می‌کنیم تا Delete بعدی روی چیدمانِ بی‌فرم آزمایش شود.
  [...document.querySelector('.print-toolbar').querySelectorAll('button')].find(button => button.textContent.trim() === 'بستن').click(); await pause(220);
  check(!document.querySelector('.print-root'), 'The print preview did not close from its بستن button');
  const selectedBefore = selectedTab();
  document.querySelector('.workbench-content').focus();
  document.querySelector('.workbench-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await pause(220);
  check(selectedTab() !== selectedBefore, `ArrowLeft from the work area moved nothing (UI-05): ${selectedBefore} -> ${selectedTab()}`);
  check(document.activeElement === document.querySelector('.workbench-tab[aria-selected="true"]'), 'The tab reached by keyboard did not take focus');
  const tabsBeforeDelete = tabCount();
  document.querySelector('.workbench-content').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await pause(220);
  check(tabCount() === tabsBeforeDelete - 1, `Delete from the work area closed no tab (UI-05): ${tabsBeforeDelete} -> ${tabCount()}`);
  check(!document.querySelector('.ui-exit-dialog'), 'Delete on a clean work area asked for confirmation instead of closing the tab (بند ۹)');
  let textFieldKeysPreserved = true;
  const lookupField = document.querySelector('input[list="finance-order-numbers"]');
  if (lookupField) {
    const selectedAfterDelete = selectedTab();
    lookupField.focus();
    lookupField.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await pause(180);
    textFieldKeysPreserved = selectedTab() === selectedAfterDelete;
    check(textFieldKeysPreserved, 'ArrowLeft inside a text field changed the active tab (UI-05 negative control)');
  }
  // UI-08 and UI-09: sub-items nest under their parent, a branch collapses on its own,
  // a sub-tab lands under its parent tab and closing nothing is allowed to destroy data.
  const nav = document.querySelector('.workbench-navigation');
  const branch = nav.querySelector('.workbench-navchildren');
  const disclose = nav.querySelector('.workbench-navdisclose');
  check(!!branch && !!disclose, 'Sub-items are still a flat list (UI-08)');
  check(disclose.getAttribute('aria-controls') === branch.id, 'The +/− control does not address its own sub-item list (UI-08)');
  check(branch.parentElement === nav.querySelector('.workbench-navbranch'), 'The sub-item list is not inside its branch (UI-08)');
  // اصلاحات ۹ بند ۴: شاخه‌ها بسته شروع می‌شوند، پس برای سنجشِ بریدگیِ لیبل‌ها اول بازش می‌کنیم.
  disclose.click(); await pause(160);
  check(getComputedStyle(branch).display !== 'none', 'The branch would not open from its + control (UI-08)');
  const branchItems = [...branch.querySelectorAll('.workbench-navitem')].map(node => node.textContent.trim());
  check([...branch.querySelectorAll('.workbench-navlabel')].every(node => node.scrollWidth <= node.clientWidth + 1), 'A nested sub-item label is cut off by the indent (UI-08)');
  check(branchItems.length > 1, 'The parent has no nested sub-items: ' + branchItems.join(','));
  const tabLabels = () => [...document.querySelectorAll('.workbench-tab')].map(tab => tab.textContent.trim());
  await open('خلاصه مالی');
  await open(branchItems.find(label => !tabLabels().includes(label)) || branchItems[0]);
  const labels = tabLabels();
  const parentIndex = labels.indexOf('خلاصه مالی');
  check(parentIndex >= 0, 'The finance parent desk did not open (UI-09)');
  const openSubs = labels.filter(label => branchItems.includes(label));
  check(labels.slice(parentIndex + 1, parentIndex + 1 + openSubs.length).join('|') === openSubs.join('|'), 'Sub-tabs must sit consecutively under the parent tab (UI-09): ' + labels.join(','));
  const childLabel = labels[parentIndex + 1];
  check(new Set(labels).size === labels.length, 'A destination opened twice built a duplicate tab (UI-09): ' + labels.join(','));
  const activeLabel = document.querySelector('.workbench-tab[aria-selected="true"]').textContent.trim();
  const breadcrumb = document.querySelector('.workbench-breadcrumb').textContent.trim();
  check(breadcrumb.includes('مالی') && breadcrumb.includes(activeLabel), 'The parent/child path is not visible in the header (UI-09): ' + breadcrumb + ' vs ' + activeLabel);
  check(childLabel !== 'خلاصه مالی', 'The tab right of the parent must be one of its sub-tabs (UI-09): ' + labels.join(','));
  const tabsBeforeCollapse = tabLabels().length;
  disclose.click(); await pause(160);
  check(getComputedStyle(branch).display === 'none', 'Collapsing the branch left the sub-items visible (UI-08)');
  check(disclose.getAttribute('aria-expanded') === 'false' && disclose.getAttribute('aria-label').startsWith('باز کردن') && !!disclose.querySelector('svg'), 'The boxed +/− control does not read its own state (UI-08): ' + disclose.getAttribute('aria-label'));
  check([...branch.querySelectorAll('.workbench-navitem')].length === branchItems.length, 'Collapsing removed the sub-items instead of hiding them (UI-08)');
  check(tabLabels().length === tabsBeforeCollapse, 'Collapsing a branch closed an open tab (UI-08)');
  disclose.click(); await pause(160);
  check(getComputedStyle(branch).display !== 'none', 'The branch did not open again (UI-08)');
  const headings = [...nav.querySelectorAll('.workbench-navgroup-title')].map(node => ({ text: node.textContent.trim(), font: parseFloat(getComputedStyle(node).fontSize) }));
  check(['کارها', 'مالی', 'انبار', 'مدیریت'].every(title => headings.some(heading => heading.text === title)), 'A group heading is missing (UI-08): ' + headings.map(heading => heading.text).join(','));
  const childFont = parseFloat(getComputedStyle(branch.querySelector('.workbench-navlabel')).fontSize);
  check(headings.every(heading => heading.font > childFont), 'A group heading is not larger than its sub-items (UI-08): ' + headings.map(heading => heading.text + '/' + heading.font + 'px vs ' + childFont + 'px').join(', '));
  const secondDisclose = [...nav.querySelectorAll('.workbench-navdisclose')].find(node => node !== disclose);
  secondDisclose?.click(); await pause(160);
  check(getComputedStyle(branch).display !== 'none', 'Opening a second branch closed the first one (UI-08)');
  check(tabLabels().length === tabsBeforeCollapse, 'Expanding another branch destroyed an open tab (UI-08)');
  // اصلاحات ۹ (بازگشت UI-07): «درباره برنامه» دیگر در منوی کناری نیست — فقط نوار وضعیت اعتبارها را نشان می‌دهد.
  const allNavItems = [...nav.querySelectorAll('.workbench-navitem')];
  check(!allNavItems.some(node => node.textContent.trim().includes('درباره برنامه')), 'About is still a menu entry (rev9b): ' + allNavItems.map(node => node.textContent.trim()).join(','));
  check(allNavItems[allNavItems.length - 1].textContent.trim().startsWith('تنظیمات'), 'The menu no longer ends in the تنظیمات group (rev9b): ' + allNavItems[allNavItems.length - 1].textContent.trim());
  const statusText = document.querySelector('.app-status-bar').innerText;
  check(!statusText.includes('درباره'), 'About still repeats in the status bar (UI-07)');
  // برگهٔ چاپ دوباره باز می‌شود تا شواهد بیرونی (capturePage) همان پیش‌نمایش چاپ باشد.
  await open('پیش‌فاکتورها');
  await waitFor(() => [...document.querySelectorAll('.workbench-page:not([hidden]) button')].some(button => button.textContent.trim() === 'چاپ'));
  [...document.querySelector('.workbench-page:not([hidden])').querySelectorAll('button')].find(button => button.textContent.trim() === 'چاپ').click();
  await waitFor(() => document.querySelector('.print-root'));
  return { orderNumber:order.orderNumber,quoteNumber:quote.number,tabDraftPreserved:true,numberingLoaded:true,documentPrint:true,
    userIntroInRightColumn:true,logoutAtColumnBottom:true,topBarKeepsOnlyAlertsAndStop:true,keyboardTabsFromWorkArea:true,keyboardClosesTab:true,closeWithOpenFormAsksFirst:true,textFieldKeysPreserved,
    subItemsNested:true,subTabUnderParent:true,branchCollapseKeepsTabs:true,breadcrumbShowsParentPath:true,aboutRemovedFromMenu:true };
}

app.on('browser-window-created', (_event, win) => {
  // The keyboard checks need a window that can actually hold DOM focus.
  win.show(); win.focus();
  // خطای صفحهٔ نمایش (renderer) باید در خروجی this smoke دیده شود، نه فقط «Script failed to execute».
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer console: ' + message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(${scenario.toString()})()`);
      const screenshot = path.join(workDir, 'workbench-document-print.png');
      fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.querySelector('.print-root .print-toolbar button:last-of-type')?.click(); document.querySelector('.workbench-navitem[aria-label="خلاصه مالی"]')?.click();`);
      await new Promise(resolve => setTimeout(resolve, 150));
      fs.writeFileSync(path.join(workDir,'workbench-finance.png'),(await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({smoke:'workbench-real-ipc',pass:true,...result,screenshot,fixtureDir}));
      clearTimeout(timeout); app.exit(0);
    } catch(error) { console.error(error.stack); clearTimeout(timeout); app.exit(1); }
  });
});
require('../electron/main.js');
