'use strict';
/* دسترسی مالی مشتری: پنل «مالی من» فقط رکوردهای خودِ همین حساب را از سرور می‌گیرد،
   فقط نمایش می‌دهد و هیچ عملیات نوشتنی ندارد.
   کنترل مثبت: مبلغ پیش‌فاکتورِ ثبت‌شده در سرور (نه حاصل دوباره‌محاسبهٔ ردیف‌ها) دیده می‌شود.
   کنترل منفی: فهرست سفارش‌ها برای مشتری FORBIDDEN است، سفارش مشتری دیگر و هزینهٔ داخلی در صفحه نیست. */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-customer-finance-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
process.env.PRINTSHOP_UI_QA = '1';
const timeout = setTimeout(() => { console.error('Customer finance smoke timed out'); app.exit(1); }, 300000);

const ADMIN_PASS = 'customer-finance-admin';
const CUSTOMER_PASS = 'customer-finance-account-pass';
const CUSTOMER_USER = 'customer-finance-login';
const OK_REASON = 'مدارک ثبتی کامل و قابل اتکا است';

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
    window.dispatchEvent(new Event('printshop:session-expired'));
    await waitFor(() => document.querySelector('input[type="password"]'), 'login form');
    enter([...document.querySelectorAll('input')].find(input => input.type !== 'password'), username);
    enter(document.querySelector('input[type="password"]'), password); await pause(120);
    byText(document, 'ورود').click();
    await waitFor(() => document.querySelector('.workbench-shell'), 'workbench for ' + username);
    await pause(400);
  }
  async function openDesk(label) {
    const item = await waitFor(() => [...document.querySelectorAll('.workbench-navitem')].find(node => node.getAttribute('aria-label') === label), 'desk ' + label);
    item.click(); await pause(450);
    return item;
  }
  const navLabels = () => [...document.querySelectorAll('.workbench-navitem')].map(node => node.getAttribute('aria-label'));
  const grouped = value => Number(value || 0).toLocaleString('en-US');
  return { pause, check, text, ok, enter, byText, main, waitFor, login, openDesk, navLabels, grouped };
}

async function seedOnPage(adminPass, customerUser, customerPass, reason) {
  const h = window.psHelpers();
  const api = window.printshopApi;
  await h.ok(api.auth.login('admin', '1234'));
  await h.ok(api.auth.setOwnPassword(adminPass));
  const users = (await h.ok(api.auth.listUsers())).users;
  await h.ok(api.set('printshop_customers_v2', [
    { id: 'c1', name: 'مشتری مالی من', entityType: 'حقیقی', phone: '', mobile: '09121110001', address: '', customerCode: '', debt: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 },
    { id: 'c2', name: 'مشتری دیگری که نباید دیده شود', entityType: 'حقیقی', phone: '', mobile: '09121110002', address: '', customerCode: '', debt: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 },
  ]));
  for (const id of ['c1', 'c2']) {
    await h.ok(api.partyAction('customer', id, 'approve', { reason }));
    await h.ok(api.partyAction('customer', id, 'issue_number'));
  }
  const coded = (await h.ok(api.get('printshop_customers_v2'))).value;
  await h.ok(api.auth.saveUsers([...users, { id: 'cust-1', name: 'حساب مشتری آزمون', username: customerUser, role: 'مشتری', customerId: 'c1', active: true, _plain: customerPass }]));

  const item = (id, name, qty, unitPrice) => ({ id, productName: name, productType: 'کتاب', qty: String(qty), qtyUnit: 'نسخه', unitPrice, designPrice: '', hasDesign: false, designDescription: '', stage: 'ثبت سفارش', papers: [], lithoMaterials: [], bindingMaterials: [], services: [{ id: id + '-svc', serviceType: 'صحافی گرم', price: 120000, notes: '' }], coverEnabled: false });
  const order = (id, number, customerId, code, name, title, items, payments) => ({
    id, orderNumber: number, date: '2026-10-05', deliveryDate: '2026-10-30', title, description: '',
    customerId, customerCode: code, customerName: name, phone: '', mobile: '', status: 'در انتظار تایید', quoteRev: 1,
    vatPercent: '', discount: '', items, payments, history: [], source: 'میز کار', intent: 'proforma', onHold: false, holdReason: '',
    procurement: null, smartText: '', archive: null, marketerCode: '', createdAt: 1,
    delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' }, shippingCost: '', otherCost: '', otherLabel: '',
  });
  const [first, second] = coded.map(c => c.customerCode);
  /* ۲۵۰۱ = سفارش قدیمی با ردیف و پرداخت؛ ۲۵۰۲ = سفارشی که پیش‌فاکتورِ موتور سرور را دارد.
     بهای ردیفِ ۲۵۰۲ عمداً با مبلغ پیش‌فاکتور فرق دارد تا «دوباره‌محاسبه در کلاینت» از «نمایش snapshot» جدا شود. */
  await h.ok(api.set('printshop_orders_v5', [
    order('o-legacy', '2501', 'c1', first, 'مشتری مالی من', 'کتاب شعر آزمون', [item('i1', 'کتاب شعر', 10, 90000)], [{ id: 'pay-1', amount: 500000, method: 'کارت به کارت', date: '2026-10-08' }]),
    order('o-priced', '2502', 'c1', first, 'مشتری مالی من', 'کتاب داستان آزمون', [item('i2', 'کتاب داستان', 1000, 1000)], []),
    order('o-other', '2599', 'c2', second, 'مشتری دیگری که نباید دیده شود', 'بروشور مشتری دیگر', [item('i3', 'بروشور', 4242, 4242424)], []),
  ]));
  await h.ok(api.orderAction('o-priced', 'save_quote', {
    expectedRevision: 1,
    input: {
      materials: [{ id: 'q-m1', description: 'کاغذ تحریر ۷۰ گرم', unit: 'بند', qty: 4, rate: 380000 }],
      services: [{ id: 'q-s1', description: 'چاپ افست متن', unit: 'نوبت', offset: { plates: 2, run: 1000, ratePerBlock: 500000 } }],
      offers: [{ id: 'q-o1', description: 'ارسال رایگان داخل شهر', internalCost: 777000 }],
      serviceMarkupPercent: 10, taxPercent: 0, discount: 100000,
    },
  }));
  const saved = (await h.ok(api.get('printshop_orders_v5'))).value;
  const numbers = Object.fromEntries(saved.map(o => [o.id, String(o.orderNumber)]));
  const priced = saved.find(o => o.id === 'o-priced');
  const document = await h.ok(api.documentAction('o-priced', 'issue_quote', {}));
  return {
    legacyNumber: numbers['o-legacy'], pricedNumber: numbers['o-priced'], otherNumber: numbers['o-other'],
    otherCustomerName: 'مشتری دیگری که نباید دیده شود',
    expectedNumbers: [numbers['o-legacy'], numbers['o-priced']].sort().join(','),
    customerCode: first, quoteRevision: priced.quoteRev,
    snapshotTotal: priced.pricing.result.total, snapshotSubtotal: priced.pricing.result.subtotal,
    snapshotDiscount: priced.pricing.result.discount,
    /* حاصل دوباره‌محاسبهٔ ردیف‌ها در کلاینت — اگر این عدد در صفحه بیاید، یعنی snapshot نشان داده نشده */
    legacyRepriceOfPricedOrder: 1000 * 1000 + 120000,
    legacyPayable: 10 * 90000 + 120000, legacyPaid: 500000,
    documentNumber: document.document.number,
  };
}

/* آنچه مشتری در «مالی من» می‌بیند. scope = خودِ پنل، نه کل محتوا. */
async function probeFinance(expected) {
  const h = window.psHelpers();
  await h.openDesk('مالی من');
  await h.waitFor(() => document.querySelector('section[aria-label="مالی من"]'), 'the customer finance panel');
  const scope = document.querySelector('section[aria-label="مالی من"]');
  const body = h.text(scope);
  const finance = await h.ok(window.printshopApi.customerFinance());
  return {
    orderRows: [...scope.querySelectorAll('tbody tr')].length,
    hasLegacy: body.includes(expected.legacyNumber), hasPriced: body.includes(expected.pricedNumber),
    showsSnapshotTotal: body.includes(h.grouped(expected.snapshotTotal)),
    showsLegacyPayable: body.includes(h.grouped(expected.legacyPayable)),
    showsRepricedTotal: body.includes(h.grouped(expected.legacyRepriceOfPricedOrder)),
    otherCustomerOrder: body.includes(expected.otherNumber),
    otherCustomerName: body.includes(expected.otherCustomerName),
    otherCustomerPrice: body.includes(h.grouped(4242424)),
    internalCostInDom: body.includes('777000'),
    codeShown: body.includes(expected.customerCode),
    showsPayableKpi: body.includes(h.grouped(expected.snapshotTotal + expected.legacyPayable)),
    showsBalanceKpi: body.includes(h.grouped(expected.snapshotTotal + expected.legacyPayable - expected.legacyPaid)),
    buttons: [...scope.querySelectorAll('button')].map(b => h.text(b)),
    readOnlyChip: [...scope.querySelectorAll('span')].some(s => h.text(s).includes('فقط نمایش')),
    financeOrdersSeen: finance.orders.length,
    financeNumbers: finance.orders.map(o => o.orderNumber).sort().join(','),
    nav: h.navLabels(),
    mainButtons: [...h.main().querySelectorAll('button')].map(b => h.text(b)),
  };
}

async function expandRow(number) {
  const h = window.psHelpers();
  const scope = document.querySelector('section[aria-label="مالی من"]');
  const row = [...scope.querySelectorAll('tbody tr')].find(tr => h.text(tr).includes(number));
  h.check(row, 'row ' + number + ' not found');
  const toggle = [...row.querySelectorAll('button')].find(b => h.text(b) === 'دیدن ردیف‌ها');
  h.check(toggle, 'row ' + number + ' has no view-only expander');
  toggle.click();
  await h.pause(300);
  const details = row.nextElementSibling;
  details.scrollIntoView({ block: 'center' });
  await h.pause(200);
  return { detailText: h.text(details), quoteRow: h.text(details).includes('پیش‌فاکتور'), paymentRow: h.text(details).includes('کارت به کارت'), documentRow: h.text(details).includes('صادر شده') };
}

async function closeRow(number) {
  const h = window.psHelpers();
  const scope = document.querySelector('section[aria-label="مالی من"]');
  const row = [...scope.querySelectorAll('tbody tr')].find(tr => h.text(tr).includes(number));
  h.check(row, 'row ' + number + ' not found');
  const toggle = [...row.querySelectorAll('button')].find(b => h.text(b) === 'بستن');
  h.check(toggle, 'row ' + number + ' is not open');
  toggle.click();
  await h.pause(250);
  return 'closed';
}

async function pressRefresh() {
  const h = window.psHelpers();
  const before = await window.printshopApi.customerFinance();
  const button = [...h.main().querySelectorAll('button')].find(b => h.text(b) === 'تازه‌سازی');
  h.check(button, 'the panel lost its refresh control');
  button.click();
  await h.pause(1200);
  const after = await window.printshopApi.customerFinance();
  return { ordersBefore: before.orders.length, ordersAfter: after.orders.length, notice: h.text(h.main()).includes('تازه شد') };
}

/* مدیر همان سفارش‌ها را با مبلغ کامل می‌بیند: ثابت می‌کند آزمون زنده است و داده وجود دارد. */
async function managerSeesTheSameMoney(expected) {
  const h = window.psHelpers();
  const orders = (await h.ok(window.printshopApi.get('printshop_orders_v5'))).value;
  const priced = orders.find(o => o.id === 'o-priced');
  const documents = (await h.ok(window.printshopApi.documents())).documents;
  return {
    orderCount: orders.length,
    pricedTotal: priced.pricing.result.total,
    internalCostVisibleToManager: priced.pricing.result.offers.some(offer => offer.internalCost === 777000),
    documentCount: documents.length,
  };
}

function inject(fn, ...args) {
  return `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
}

async function capture(win, file) {
  console.error('[customer-finance] screenshot ' + file);
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

app.on('browser-window-created', (_event, win) => {
  let completed = false;
  win.on('close', event => { if (!completed) event.preventDefault(); });
  win.webContents.once('did-fail-load', (_event, code, reason) => { fs.writeFileSync(path.join(workDir, 'customer-finance-error.txt'), `load ${code}: ${reason}`); app.exit(1); });
  win.webContents.on('render-process-gone', (_event, details) => { fs.writeFileSync(path.join(workDir, 'customer-finance-error.txt'), JSON.stringify(details)); app.exit(1); });
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    const exec = async (code, label) => {
      console.error('[customer-finance] ' + label);
      try { return await win.webContents.executeJavaScript(code); }
      catch (e) { throw new Error(label + ' -> ' + String(e && e.message || e)); }
    };
    try {
      await exec(`window.psHelpers = ${pageHelpers.toString()}; window.confirm = () => true; window.alert = () => {}; 'helpers-installed';`, 'helper bootstrap');
      const seeded = await exec(inject(seedOnPage, ADMIN_PASS, CUSTOMER_USER, CUSTOMER_PASS, OK_REASON), 'seed');
      const results = { fixture: seeded };

      await exec(inject(async (u, p) => window.psHelpers().login(u, p), CUSTOMER_USER, CUSTOMER_PASS), 'login customer');
      const probe = await exec(inject(probeFinance, seeded), 'probe مالی من');
      results.customer = { probe };
      results.customer.screenshot = await capture(win, 'customer-finance-panel.png');
      results.customer.legacyDetail = await exec(inject(expandRow, seeded.legacyNumber), 'expand the legacy order');
      results.customer.legacyScreenshot = await capture(win, 'customer-finance-legacy-detail.png');
      await exec(inject(closeRow, seeded.legacyNumber), 'close the legacy order');
      results.customer.pricedDetail = await exec(inject(expandRow, seeded.pricedNumber), 'expand the priced order');
      results.customer.detailScreenshot = await capture(win, 'customer-finance-detail.png');
      await exec(inject(closeRow, seeded.pricedNumber), 'close the priced order');
      results.customer.refresh = await exec(inject(pressRefresh), 'press تازه‌سازی');

      /* کنترل منفی روی همان نشست: مسیر عمومی بانک برای مشتری بسته است. */
      results.customer.collectionRead = await exec(inject(async () => (await window.printshopApi.get('printshop_orders_v5')).code), 'customer tries the raw orders collection');
      results.customer.foreignWrite = await exec(inject(async () => (await window.printshopApi.orderAction('o-priced', 'confirm_customer', { evidence: 'Attempt from the customer account' })).code), 'customer tries to confirm their own order');

      await exec(inject(async (u, p) => window.psHelpers().login(u, p), 'admin', ADMIN_PASS), 'login admin for the live negative control');
      results.manager = await exec(inject(managerSeesTheSameMoney, seeded), 'manager reads the same money');

      const problems = [];
      if (probe.orderRows !== 2) problems.push('پنل ' + probe.orderRows + ' ردیف دارد، نه ۲ تا');
      if (!probe.hasLegacy || !probe.hasPriced) problems.push('ردیف‌های خودِ مشتری در پنل نیست');
      if (!probe.showsSnapshotTotal || probe.showsRepricedTotal) problems.push('مبلغ پیش‌فاکتورِ سرور نمایش داده نشد یا دوباره از ردیف‌ها محاسبه شد');
      if (!probe.showsLegacyPayable || !probe.showsPayableKpi || !probe.showsBalanceKpi) problems.push('جمع‌های قابل پرداخت/باقی‌مانده با اعداد بانک نمی‌خواند');
      if (probe.otherCustomerOrder || probe.otherCustomerPrice || probe.otherCustomerName) problems.push('سفارش، بها یا نام مشتری دیگر در پنل دیده شد');
      if (probe.internalCostInDom) problems.push('هزینهٔ داخلی خدمت رایگان در صفحهٔ مشتری است');
      if (probe.buttons.filter(label => !['تازه‌سازی', 'دیدن ردیف‌ها', 'بستن'].includes(label)).length) problems.push('دکمهٔ بیرون از تازه‌سازی/باز‌کردن ردیف: ' + probe.buttons.join('|'));
      if (!probe.readOnlyChip) problems.push('برچسب «فقط نمایش» در پنل نیست');
      if (!probe.codeShown) problems.push('کد مشتری در پنل نیست');
      if (probe.financeOrdersSeen !== 2 || probe.financeNumbers !== seeded.expectedNumbers) problems.push('پاسخ سرور: ' + probe.financeNumbers + ' به‌جای ' + seeded.expectedNumbers);
      if (probe.nav.join('|') !== 'ثبت درخواست سفارش|مالی من') problems.push('منوی مشتری: ' + probe.nav.join('|'));
      if (!results.customer.legacyDetail.paymentRow) problems.push('پرداختِ سفارش قدیمی در جزئیات نیست');
      if (!results.customer.pricedDetail.quoteRow) problems.push('ردیف‌های پیش‌فاکتور در جزئیات نیست');
      if (!results.customer.pricedDetail.documentRow) problems.push('سند صادرشده در جزئیات نیست');
      if (!results.customer.refresh.notice) problems.push('دکمهٔ تازه‌سازی پاسخ نداد');
      if (results.customer.collectionRead !== 'FORBIDDEN') problems.push('مشتری توانست بانک خام سفارش‌ها را بخواند: ' + results.customer.collectionRead);
      if (results.customer.foreignWrite === 'ok') problems.push('مشتری توانست از مسیر عملیات، سفارش را تأیید کند');
      if (results.manager.orderCount !== 3) problems.push('کنترل منفی: مدیر ' + results.manager.orderCount + ' سفارش دید، نه ۳ تا');
      if (results.manager.pricedTotal !== seeded.snapshotTotal) problems.push('مبلغ سفارش قیمت‌گذاری‌شده بین سرور و آزمون فرق دارد');
      if (!results.manager.internalCostVisibleToManager) problems.push('هزینهٔ داخلی از دید مدیر هم پاک شد — آزمون چیزی را ثابت نمی‌کند');
      if (results.manager.documentCount === 0) problems.push('سندی صادر نشده است');
      if (problems.length) throw new Error(problems.join(' — '));

      fs.writeFileSync(path.join(workDir, 'customer-finance-report.json'), JSON.stringify({ ...results, fixtureDir }, null, 2));
      console.log(JSON.stringify({ smoke: 'customer-finance-panel', pass: true, results, fixtureDir }));
      completed = true; clearTimeout(timeout); app.exit(0);
    } catch (error) {
      fs.writeFileSync(path.join(workDir, 'customer-finance-error.txt'), String(error && error.stack || error));
      completed = true; console.error(error.stack); clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../electron/main.js');
