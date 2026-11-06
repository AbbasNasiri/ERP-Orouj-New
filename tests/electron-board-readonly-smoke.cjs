'use strict';
/* بند تابلوی تولید: همهٔ ایستگاه‌ها تابلو را می‌بینند ولی روی آن هیچ عملیاتی ندارند.
   کنترل منفی: مدیر چاپخانه همان‌جا می‌تواند مرحله را تمام کند (مرحله واقعاً عوض می‌شود) و
   سرپرست از میز کار خودش (فرم‌های سفارش) همچنان همین دکمه را دارد. */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
app.disableHardwareAcceleration();
/* پنجره پنهان است؛ بدون این کلیدها timerهای renderer به ۱ بار در ثانیه محدود و آزمون کند می‌شود. */
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-board-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
process.env.PRINTSHOP_UI_QA = '1';
const timeout = setTimeout(() => { console.error('Board smoke timed out'); app.exit(1); }, 420000);

const ADMIN_PASS = 'board-smoke-admin';
const STAFF_PASS = 'board-smoke-staff';
const STATIONS = [
  ['litho', 'سرپرست لیتوگرافی'],
  ['press', 'سرپرست چاپ'],
  ['clerk', 'کارشناس سفارشات'],
  ['finance', 'مدیر مالی'],
  ['store', 'انباردار'],
];

/* ================= page-side code (runs inside the renderer) ================= */
function pageHelpers() {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const text = node => (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  async function ok(request) { const result = await request; check(result && result.ok, (result && result.error) || 'Request failed'); return result; }
  async function waitFor(select, label) {
    for (let i = 0; i < 240; i++) { const value = select(); if (value) return value; await pause(50); }
    throw new Error('UI wait expired: ' + label + ' | body=' + text(document.body).slice(0, 900));
  }
  function enter(element, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const byText = (scope, label) => [...scope.querySelectorAll('button')].find(button => text(button) === label);
  const main = () => document.querySelector('main.workbench-content') || document.querySelector('main');
  async function login(username, password) {
    await ok(window.printshopApi.auth.logout());
    /* توکن رفته است؛ همان نشانه‌ای را می‌دهیم که خودِ برنامه وقتی سرور نشست را رد می‌کند می‌فرستد. */
    window.dispatchEvent(new Event('printshop:session-expired'));
    await waitFor(() => document.querySelector('input[type="password"]'), 'login form');
    const passwordBox = document.querySelector('input[type="password"]');
    enter([...document.querySelectorAll('input')].find(input => input.type !== 'password'), username);
    enter(passwordBox, password); await pause(120);
    byText(document, 'ورود').click();
    await waitFor(() => document.querySelector('.workbench-shell'), 'workbench for ' + username);
    await pause(400);
  }
  async function openDesk(label) {
    const item = await waitFor(() => [...document.querySelectorAll('.workbench-navitem')].find(node => node.getAttribute('aria-label') === label), 'desk ' + label);
    item.click(); await pause(450);
    return item;
  }
  async function closeModal() {
    const close = document.querySelector('.ui-modal-close');
    if (!close) return;
    close.click(); await pause(300);
    const discard = [...document.querySelectorAll('.ui-exit-dialog button')].find(b => text(b).includes('بدون ذخیره'));
    if (discard) { discard.click(); await pause(300); }
  }
  const stageOf = async () => (await ok(window.printshopApi.get('printshop_orders_v5'))).value.find(o => o.id === 'board-1').items[0].stage;
  return { pause, check, text, ok, enter, byText, main, waitFor, login, openDesk, closeModal, stageOf };
}

async function seedOnPage(adminPass, staffPass, roles) {
  const h = window.psHelpers();
  await h.ok(window.printshopApi.auth.login('admin', '1234'));
  await h.ok(window.printshopApi.auth.setOwnPassword(adminPass));
  const users = (await h.ok(window.printshopApi.auth.listUsers())).users;
  for (const [id, role] of roles) users.push({ id, name: role, username: id, role, _plain: staffPass });
  await h.ok(window.printshopApi.auth.saveUsers(users));

  const paper = { id: 'inv-paper', category: 'کاغذ', name: 'تحریر ۷۰', gramaj: '70', size: 'وزیری', brand: '', color: '', finish: '', ownerType: 'چاپخانه', ownerCustomerId: '', purpose: '', linkedOrderNumber: '', unitMode: 'simple', simpleUnit: 'بند', quantity: '1000', unitValue: '', minThreshold: '', location: '', supplierSource: 'چاپخانه', supplierId: '', bandCount: '', sheetsPerBand: '', weightKg: '' };
  await h.ok(window.printshopApi.set('printshop_inventory_v3', [paper]));
  await h.ok(window.printshopApi.set('printshop_customers_v2', [{ id: 'c1', name: 'مشتری آزمون تابلو', entityType: 'حقوقی', phone: '09121110002', mobile: '09121110002', address: '', customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, marketerId: '', createdAt: 1 }]));

  const item = id => ({ id, productName: 'کتاب آزمون ' + id, productType: 'کتاب', qty: '1000', qtyUnit: 'نسخه', unitPrice: '', designPrice: '', hasDesign: false, designDescription: '', stage: 'ثبت سفارش', papers: [], lithoMaterials: [], bindingMaterials: [], services: [], coverEnabled: false });
  const order = {
    id: 'board-1', orderNumber: '2401', date: '2026-10-01', deliveryDate: '2026-10-30', title: 'کتاب آزمون تابلو', description: '',
    customerId: 'c1', customerCode: '', customerName: 'مشتری آزمون تابلو', phone: '09121110002', mobile: '', status: 'در انتظار تایید',
    quoteRev: 1, vatPercent: '', discount: '', items: [item('i1'), item('i2')],
    payments: [], history: [], source: 'مشتری', intent: 'proforma', onHold: false, holdReason: '', procurement: null, smartText: '', archive: null, marketerCode: '', createdAt: 1,
    delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' }, shippingCost: '', otherCost: '', otherLabel: '',
  };
  await h.ok(window.printshopApi.set('printshop_orders_v5', [order]));
  await h.ok(window.printshopApi.orderAction('board-1', 'confirm_customer', { evidence: 'تأیید تلفنی مشتری آزمون' }));
  await h.ok(window.printshopApi.orderAction('board-1', 'release_production', { materialReview: { checked: true, shortages: [] } }));
  for (const id of ['i1', 'i2']) {
    await h.ok(window.printshopApi.orderAction('board-1', 'change_stage', { itemId: id, newStage: 'لیتوگرافی و زینک', reason: 'آزمون دسترسی تابلو' }));
  }
  await h.pause(250);
  const saved = (await h.ok(window.printshopApi.get('printshop_orders_v5'))).value.find(o => o.id === 'board-1');
  return { orderNumber: String(saved.orderNumber), submittedNumber: '2401', stage: saved.items[0].stage };
}

/* آنچه یک ایستگاه روی تابلو می‌بیند و آنچه می‌تواند انجام دهد. */
async function probeBoard() {
  const h = window.psHelpers();
  await h.openDesk('تابلوی تولید');
  const scope = h.main();
  await h.waitFor(() => h.text(scope).includes('قلم در تولید'), 'the board columns');
  return {
    cards: scope.querySelectorAll('[draggable]').length,
    draggableCards: scope.querySelectorAll('[draggable="true"]').length,
    completeButtons: [...scope.querySelectorAll('button')].filter(b => h.text(b) === 'اتمام و تایید نهایی' || h.text(b) === 'ثبت تحویل به مشتری').length,
    managerSkipButtons: [...scope.querySelectorAll('button')].filter(b => (b.getAttribute('title') || '').includes('عبور مدیر')).length,
    stageSelects: [...scope.querySelectorAll('select')].filter(s => [...s.options].some(o => h.text(o) === 'لیتوگرافی و زینک')).length,
    viewOnlyNotice: h.text(scope).includes('فقط نمایشی است'),
    viewOnlyChip: [...scope.querySelectorAll('span')].some(s => h.text(s) === 'فقط نمایش'),
    detailsButtons: [...scope.querySelectorAll('button')].filter(b => h.text(b) === 'جزئیات').length,
    reportButtons: [...scope.querySelectorAll('button')].filter(b => h.text(b).includes('گزارش')).length,
  };
}

/* فشار واقعی دکمهٔ اتمام از روی تابلو؛ اگر نبود، مرحله نباید تکان بخورد. */
async function tryCompleteFromBoard() {
  const h = window.psHelpers();
  const stageBefore = await h.stageOf();
  const button = [...h.main().querySelectorAll('button')].find(b => h.text(b) === 'اتمام و تایید نهایی');
  if (button) { window.confirm = () => true; button.click(); await h.pause(1500); }
  const stageAfter = await h.stageOf();
  return { pressed: !!button, stageBefore, stageAfter, stageChanged: stageBefore !== stageAfter };
}

/* «جزئیات» از روی تابلو: بدون انتخاب مرحله، بدون دکمهٔ اتمام، با یادداشت «فقط نمایش». */
async function probeBoardDetail() {
  const h = window.psHelpers();
  const card = [...h.main().querySelectorAll('[draggable]')].find(node => h.text(node).includes('سفارش'));
  h.check(card, 'no card to open on the board');
  const details = [...card.querySelectorAll('button')].find(b => h.text(b) === 'جزئیات');
  h.check(details, 'the card has no جزئیات control');
  details.click();
  await h.waitFor(() => document.querySelector('.ui-modal-body'), 'the order detail modal');
  const body = document.querySelector('.ui-modal-body');
  const result = {
    completeButtons: [...body.querySelectorAll('button')].filter(b => h.text(b) === 'اتمام و تایید نهایی').length,
    stageSelects: [...body.querySelectorAll('select')].filter(s => [...s.options].some(o => h.text(o) === 'لیتوگرافی و زینک')).length,
    mutatingButtons: [...body.querySelectorAll('button')].filter(b => /بایگانی|بازگشایی|حذف سفارش|رفع تعلیق|ویرایش سفارش/.test(h.text(b))).length,
    viewOnlyNotice: h.text(body).includes('نمای تابلوی تولید — فقط نمایش'),
    printFormButtons: [...body.querySelectorAll('button')].filter(b => h.text(b).includes('چاپ فرم سفارش')).length,
    orderNumberShown: h.text(body).includes('کتاب آزمون'),
  };
  await h.closeModal();
  return result;
}

/* «جزئیات» را باز می‌گذارد تا از همان نما عکس گرفته شود. */
async function openBoardDetail() {
  const h = window.psHelpers();
  const card = [...h.main().querySelectorAll('[draggable]')].find(node => h.text(node).includes('سفارش'));
  h.check(card, 'no card to open on the board');
  [...card.querySelectorAll('button')].find(b => h.text(b) === 'جزئیات').click();
  await h.waitFor(() => document.querySelector('.ui-modal-body'), 'the order detail modal');
  return 'detail-open';
}

/* میز کار خودِ بخش (فرم‌های سفارش): عملیات باید دست‌نخورده مانده باشد. */
async function probeOwnDesk(orderNumber) {
  const h = window.psHelpers();
  const digits = value => String(value).replace(/[^0-9۰-۹]/g, '');
  const toLatin = value => digits(value).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  await h.openDesk('فرم‌های سفارش');
  const row = await h.waitFor(() => [...document.querySelectorAll('tr')].find(tr => toLatin(h.text(tr)).includes(toLatin(orderNumber))), 'the fixture row in the forms desk');
  const open = [...row.querySelectorAll('button')].find(b => h.text(b).includes('مشاهده و چاپ فرم'));
  h.check(open, 'the forms desk has no view control');
  open.click();
  await h.waitFor(() => document.querySelector('.ui-modal-body'), 'the form modal');
  const body = document.querySelector('.ui-modal-body');
  const result = {
    completeButtons: [...body.querySelectorAll('button')].filter(b => h.text(b) === 'اتمام و تایید نهایی').length,
    stageSelects: [...body.querySelectorAll('select')].filter(s => [...s.options].some(o => h.text(o) === 'لیتوگرافی و زینک')).length,
  };
  await h.closeModal();
  return result;
}

/* ================= main-process driver ================= */
function inject(fn, ...args) {
  return `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
}

async function capture(win, file) {
  console.error('[board] screenshot ' + file);
  let image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  for (let attempt = 0; image.isEmpty() && attempt < 5; attempt++) {
    win.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 350));
    image = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  }
  if (image.isEmpty()) throw new Error('Empty screenshot: ' + file);
  const png = image.toPNG();
  fs.writeFileSync(path.join(workDir, file), png);
  return { file, bytes: png.length };
}

function assertStation(role, probe, attempt, detail) {
  const problems = [];
  if (probe.cards === 0) problems.push('the board shows no card');
  if (probe.draggableCards !== 0) problems.push(probe.draggableCards + ' card(s) still draggable');
  if (probe.completeButtons !== 0) problems.push(probe.completeButtons + ' completion button(s) on the board');
  if (probe.managerSkipButtons !== 0) problems.push('the manager skip control is visible');
  if (probe.stageSelects !== 0) problems.push('a stage selector is usable on the board');
  if (!probe.viewOnlyChip || !probe.viewOnlyNotice) problems.push('the view-only notice is missing');
  if (probe.detailsButtons === 0) problems.push('the board lost its view-only جزئیات control');
  if (attempt.pressed || attempt.stageChanged) problems.push('the stage changed from the board');
  if (detail.completeButtons !== 0 || detail.stageSelects !== 0 || detail.mutatingButtons !== 0) problems.push('the board detail modal still exposes operations');
  if (!detail.viewOnlyNotice) problems.push('the board detail modal has no view-only notice');
  if (problems.length) throw new Error(role + ': ' + problems.join('; '));
}

app.on('browser-window-created', (_event, win) => {
  let completed = false;
  win.on('close', event => { if (!completed) event.preventDefault(); });
  win.webContents.once('did-fail-load', (_event, code, reason) => { fs.writeFileSync(path.join(workDir, 'board-smoke-error.txt'), `load ${code}: ${reason}`); app.exit(1); });
  win.webContents.on('render-process-gone', (_event, details) => { fs.writeFileSync(path.join(workDir, 'board-smoke-error.txt'), JSON.stringify(details)); app.exit(1); });
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    const exec = async (code, label) => {
      console.error('[board] ' + label);
      try {
        return await win.webContents.executeJavaScript(code);
      } catch (e) {
        throw new Error(label + ' -> ' + String(e && e.message || e));
      }
    };
    try {
      await exec(`window.psHelpers = ${pageHelpers.toString()}; window.confirm = () => true; window.alert = () => {}; 'helpers-installed';`, 'helper bootstrap');
      const seeded = await exec(inject(seedOnPage, ADMIN_PASS, STAFF_PASS, STATIONS), 'seed');
      const results = { fixture: seeded, stations: {}, manager: {} };

      /* ایستگاه‌ها: تابلو باز، فقط نمایش. */
      for (const [username, role] of STATIONS) {
        await exec(inject(async (u, p) => window.psHelpers().login(u, p), username, STAFF_PASS), 'login ' + username);
        const probe = await exec(inject(probeBoard), 'probe board ' + role);
        const screenshot = await capture(win, 'board-' + username + '-view-only.png');
        const attempt = await exec(inject(tryCompleteFromBoard), 'attempt ' + role);
        const detail = await exec(inject(probeBoardDetail), 'detail ' + role);
        results.stations[role] = { probe, attempt, detail, screenshot };
        assertStation(role, probe, attempt, detail);
        if (role === 'سرپرست لیتوگرافی') {
          results.stations[role].ownDesk = await exec(inject(probeOwnDesk, seeded.orderNumber), 'own desk ' + role);
          if (results.stations[role].ownDesk.completeButtons < 1) throw new Error('the litho supervisor lost the completion control on its own desk');
          await exec(inject(openBoardDetail), 'open the board detail for the screenshot');
          results.stations[role].detailScreenshot = await capture(win, 'board-litho-detail-view-only.png');
          await exec(inject(async () => { await window.psHelpers().closeModal(); await window.psHelpers().openDesk('تابلوی تولید'); }), 'back to the board for the screenshot');
          results.stations[role].boardScreenshot = await capture(win, 'board-litho-view-only.png');
        }
        const after = await exec(inject(() => window.psHelpers().stageOf()), 'stage after ' + role);
        if (after !== seeded.stage) throw new Error('the stage moved during the ' + role + ' pass: ' + seeded.stage + ' -> ' + after);
      }

      /* کنترل منفی: مدیر چاپخانه همان دکمه‌ها را دارد و واقعاً کار می‌کند. */
      await exec(inject(async (u, p) => window.psHelpers().login(u, p), 'admin', ADMIN_PASS), 'login admin');
      results.manager.probe = await exec(inject(probeBoard), 'probe board as manager');
      results.manager.screenshot = await capture(win, 'board-manager-full.png');
      results.manager.attempt = await exec(inject(tryCompleteFromBoard), 'manager attempt');
      if (results.manager.probe.draggableCards === 0) throw new Error('the manager board lost its draggable cards');
      if (results.manager.probe.completeButtons === 0) throw new Error('the manager board lost the completion button');
      if (results.manager.probe.viewOnlyChip || results.manager.probe.viewOnlyNotice) throw new Error('the manager board is in view-only mode');
      if (!results.manager.attempt.pressed || !results.manager.attempt.stageChanged) throw new Error('the manager could not complete the stage from the board');

      fs.writeFileSync(path.join(workDir, 'board-readonly-report.json'), JSON.stringify({ ...results, fixtureDir }, null, 2));
      console.log(JSON.stringify({ smoke: 'production-board-view-only', pass: true, results, fixtureDir }));
      completed = true; clearTimeout(timeout); app.exit(0);
    } catch (error) {
      fs.writeFileSync(path.join(workDir, 'board-smoke-error.txt'), String(error && error.stack || error));
      completed = true; console.error(error.stack); clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../electron/main.js');
