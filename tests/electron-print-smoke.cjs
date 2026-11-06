'use strict';
// Manual integration QA: run the project's electron.exe on this file after build.
// Real main/preload/React/native SQLite; all data lives in an isolated .work dir.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
assert.ok(process.versions.electron, 'Use the project Electron executable');
const workDir = path.resolve(__dirname, '../../.work');
const outputDir = path.join(workDir, 'print-qa');
fs.mkdirSync(outputDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-print-smoke-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
const timeout = setTimeout(() => { console.error('Print QA timed out'); app.exit(1); }, 240000);

const { pdfPrintOptions, paperMm } = require('../electron/pdf-export.js');
const { version: appVersion } = require('../package.json');
const PT_PER_MM = 72 / 25.4;

/* The PDF itself is the deliverable, so measure the bytes: every page must be exactly the chosen
   sheet, and the page count must equal the paginated preview — a silent extra sheet is the
   "فضای اضافی" the owner complained about. */
function assertPdfGeometry(bytes, paper, expectedPages, name, orientation = 'portrait') {
  const text = bytes.toString('latin1');
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g)]
    .map(m => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] }));
  assert.ok(boxes.length, `${name}: no /MediaBox found — PDF geometry unverified`);
  const [wMm, hMm] = paperMm(paper, orientation);
  for (const [index, box] of boxes.entries()) {
    const wPt = Math.abs(box.x2 - box.x1), hPt = Math.abs(box.y2 - box.y1);
    assert.ok(Math.abs(wPt - wMm * PT_PER_MM) <= 1.5 && Math.abs(hPt - hMm * PT_PER_MM) <= 1.5,
      `${name}: page ${index + 1} is ${wPt.toFixed(1)}x${hPt.toFixed(1)}pt, expected A4/A5 ${wMm}x${hMm}mm`);
  }
  assert.ok(boxes.length <= 400, `${name}: PDF has ${boxes.length} pages, far too many`);
  assert.equal(boxes.length, expectedPages, `${name}: PDF page count differs from the paginated preview`);
  return { pages: boxes.length, pagePt: [Math.round(Math.abs(boxes[0].x2 - boxes[0].x1)), Math.round(Math.abs(boxes[0].y2 - boxes[0].y1))] };
}

async function bootstrap(expectedVersion) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  async function ok(promise, label) {
    const result = await promise;
    check(result?.ok, `${label || 'IPC'}: ${result?.code || ''} ${result?.error || 'request failed'}`);
    return result;
  }
  async function waitFor(select, label, attempts = 240) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const value = select(); if (value) return value;
      const printError = document.querySelector('.print-toolbar [role="status"]')?.textContent;
      if (printError && /انجام نشد|متوقف شد|جا نمی‌شود|اصلاح کنید/.test(printError)) throw new Error(`Pagination error: ${printError}`);
      await pause(50);
    }
    throw new Error(`UI wait expired: ${label || select.toString()}; toolbar=${document.querySelector('.print-toolbar')?.innerText || ''}`);
  }
  function enter(element, value) {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }
  const activePanel = () => document.querySelector('.workbench-page:not([hidden])');
  async function open(label) {
    const button = [...document.querySelectorAll('.workbench-navitem')].find(node => node.textContent.trim() === label);
    check(button, `Missing desk ${label}`); button.click(); await pause(150);
    await waitFor(activePanel, `active panel ${label}`);
  }
  async function ready(paper) {
    await waitFor(() => {
      const host = document.querySelector('.print-pages');
      return host?.getAttribute('aria-busy') === 'false' && host.dataset.paper === paper && host.querySelector('.print-page');
    }, `pagination ${paper}`, 600);
    await pause(100);
  }
  const api = window.printshopApi;
  check(api?.secure, 'Secure Electron backend unavailable');
  const login = await ok(api.auth.login('admin', '1234'), 'initial login');
  check(!Object.hasOwn(login, 'token'), 'Token leaked into renderer');
  await ok(api.auth.setOwnPassword('isolated-print-qa-password'), 'initial password change');
  await ok(api.get('printshop_settings_v1'), 'read settings');
  await ok(api.set('printshop_settings_v1', { company: {
    name: 'چاپخانه نمونه آزمایشی', entityType: 'حقوقی', nationalId: '00000000000', registerNo: 'TEST-123', economicCode: '000000000000',
    postalCode: '0000000000', province: 'تهران', city: 'تهران', address: 'نشانی ساختگی برای آزمایش قالب، خیابان چاپ، پلاک ۱', phone: '02100000000',
  }, quote: { validityDays: 7, terms: 'شروع تولید فقط پس از تأیید مشتری و اجازه مدیر چاپخانه است.' } }), 'seed seller snapshot');
  const customersKey = 'printshop_customers_v2';
  const customers = Array.from({ length: 65 }, (_, index) => ({
    id: `print-customer-${index + 1}`, name: `QA-CUSTOMER-${String(index + 1).padStart(4, '0')} مشتری نمونه چاپ`, entityType: 'حقیقی',
    phone: '02112345678', mobile: '09123456789', nationalCode: '0000000000', economicCode: '000000000000', postalCode: '0000000000', province: 'تهران', city: 'تهران', address: `نشانی آزمایشی ${index + 1}، خیابان چاپ، کوچه کاغذ، پلاک بیست، واحد سه`,
  }));
  await ok(api.get(customersKey), 'read customers');
  await ok(api.set(customersKey, customers), 'seed report customers');
  const ordersKey = 'printshop_orders_v5';
  const base = { customerId: customers[0].id, customerName: customers[0].name, phone: customers[0].phone,
    date: '2026-10-22', deliveryDate: '2026-11-01', status: 'در انتظار تایید', quoteRev: 1, payments: [], history: [],
    delivery: { method: 'تحویل حضوری در چاپخانه', receiver: '', phone: '' } };
  const simple = { ...base, id: 'print-simple-order', title: 'QA-SIMPLE-ORDER', items: [{
    id: 'simple-item', productName: 'QA-SIMPLE-PRODUCT', productType: 'کارت', stage: 'ثبت سفارش', qty: 100, qtyUnit: 'عدد', unitPrice: 1000,
    spec: { sizeKey: 'سفارشی', w: 9, h: 5, pages: 2, printMethod: 'دیجیتال', textColors: 1, textSides: 1 }, services: [],
  }] };
  const long = { ...base, id: 'print-long-order', title: 'QA-LONG-ORDER', items: [{
    id: 'long-item', productName: 'کتاب آزمایشی چندصفحه‌ای', stage: 'ثبت سفارش', qty: 2000, qtyUnit: 'نسخه', unitPrice: 0,
    spec: { sizeKey: 'رحلی', pages: 400 }, services: [],
  }], payments: [{ id: 'print-payment', date: '2026-10-22', amount: 100000, method: 'واریز آزمایشی' }] };
  await ok(api.get(ordersKey), 'read orders');
  const saved = await ok(api.set(ordersKey, [simple, long]), 'seed orders');
  const simpleSaved = saved.value.find(order => order.id === simple.id);
  const longSaved = saved.value.find(order => order.id === long.id);
  check(simpleSaved?.orderNumber && longSaved?.orderNumber, 'Server order numbering failed');
  const serviceTokens = Array.from({ length: 70 }, (_, index) => `QA-SVC-${String(index + 1).padStart(4, '0')}`);
  const input = { currency: 'IRR', effectiveDate: '2026-10-22', materials: [],
    services: serviceTokens.map((token, index) => ({ id: `print-service-${index}`, description: `${token} — خدمات چاپ و صحافی نمونه با توضیح کامل عملیات، کنترل کیفیت و تحویل به واحد بعدی`, qty: 1, unit: 'خدمت', rate: 100000 + index })),
    offers: [{ id: 'print-free-delivery', description: 'QA-FREE-DELIVERY ارسال رایگان', internalCost: 987654321 }],
    serviceMarkupPercent: 20, taxPercent: 10, discount: 0 };
  await ok(api.orderAction(long.id, 'save_quote', { input, expectedRevision: 1 }), 'save long quote');
  const quote = (await ok(api.documentAction(long.id, 'issue_quote', {}), 'issue quote')).document;
  await ok(api.orderAction(long.id, 'confirm_customer', { evidence: 'تأیید آزمایشی مشتری برای بررسی چاپ، فقط داده ساختگی' }), 'confirm synthetic customer');
  const invoice = (await ok(api.documentAction(long.id, 'issue_invoice', {}), 'issue invoice')).document;
  const statement = (await ok(api.documentAction(long.id, 'issue_statement', {}), 'issue statement')).document;
  const shortInput = { currency: 'IRR', materials: [
    { id: 'paper', description: 'کاغذ متن متعلق به مشتری', qty: 105, unit: 'بند', rate: 0, customerSupplied: true },
    { id: 'cover', description: 'مقوای جلد متعلق به مشتری', qty: 550, unit: 'برگ', rate: 0, customerSupplied: true },
  ], services: [
    { id: 'plates', description: 'لیتوگرافی متن — ۲۰۰ زینک', qty: 200, unit: 'ورق زینک', rate: 20000000 },
    { id: 'print', description: 'چاپ متن', qty: 200, unit: 'دور زینک', rate: 20000000 },
    { id: 'cover-plates', description: 'لیتوگرافی جلد چهاررنگ', qty: 4, unit: 'ورق زینک', rate: 20000000 },
    { id: 'cover-print', description: 'چاپ جلد', qty: 1, unit: 'خدمت', rate: 100000000 },
    { id: 'film', description: 'سلفون جلد', qty: 1, unit: 'خدمت', rate: 175000000 },
    { id: 'bind', description: 'صحافی چسب گرم — ۵۱ فرم × ۲۰۰۰ نسخه', qty: 102000, unit: 'فرم', rate: 20000 },
  ], offers: [{ id: 'delivery', description: 'برش، بسته‌بندی و ارسال رایگان' }], serviceMarkupPercent: 20, discount: 0, taxPercent: 10 };
  await ok(api.orderAction(simple.id, 'save_quote', { input: shortInput, expectedRevision: 1 }), 'save book example quote');
  await ok(api.orderAction(simple.id, 'confirm_customer', { evidence: 'تأیید صرفاً آزمایشی برای نمونه چاپ' }), 'confirm example');
  const simpleInvoice = (await ok(api.documentAction(simple.id, 'issue_invoice', {}), 'issue book example invoice')).document;
  check(simpleInvoice.snapshot.invoice.totals.total === 13721400000, 'Book example total changed');
  const letterTokens = Array.from({ length: 65 }, (_, index) => `QA-LETTER-${String(index + 1).padStart(4, '0')}`);
  const lettersKey = 'printshop_letters_v1';
  await ok(api.get(lettersKey), 'read letters');
  const letters = await ok(api.set(lettersKey, [{ id: 'print-long-letter', type: 'other', date: '2026-10-22',
    subject: 'نامه آزمایشی بلند برای کنترل پیوستگی متن', fromUnit: 'سفارشات', fromName: 'مسئول آزمایش',
    createdBy: login.user.id, createdAt: Date.now(), status: 'sent', managerNote: '',
    body: letterTokens.map(token => `${token} با احترام، این بند نمونه برای بررسی حفظ متن فارسی در ادامه صفحات و جلوگیری از بریده‌شدن محتوای نامه چاپ می‌شود.`).join('\n'),
  }]), 'seed long letter');
  const letterNumber = letters.value[0].number;
  await ok(api.auth.logout(), 'logout before UI login');
  await waitFor(() => document.querySelector('input[type="password"]'), 'login form');
  enter([...document.querySelectorAll('input')].find(node => node.type !== 'password'), 'admin');
  enter(document.querySelector('input[type="password"]'), 'isolated-print-qa-password');
  await pause(100);
  const loginButton = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'ورود');
  check(loginButton, 'UI login button missing'); loginButton.click();
  await waitFor(() => document.querySelector('.workbench-shell'), 'React workbench');

  const statusBar = await waitFor(() => document.querySelector('.app-status-bar'), 'application status bar');
  check(statusBar.innerText.includes(expectedVersion), `Status bar does not show the built app version ${expectedVersion}: ${statusBar.innerText.replace(/\s+/g, ' ').slice(0, 160)}`);
  check(!statusBar.querySelector('button') && !statusBar.innerText.includes('درباره'), 'The about entry still repeats in the status bar (UI-07)');
  check(statusBar.getBoundingClientRect().bottom <= innerHeight + 1, 'Status bar clipped below viewport');
  // اصلاحات ۹ (بازگشت UI-07): درباره از منو حذف است و اعتبارها فقط در همان نوار وضعیت می‌مانند.
  check(![...document.querySelectorAll('.workbench-navitem')].some(node => node.textContent.trim().includes('درباره برنامه')), 'About is still a menu entry (rev9b)');
  const credits = statusBar.querySelector('.app-credits');
  check(!!credits && credits.innerText.includes('عباس نصیری') && credits.innerText.includes('asn.nasiri@hotmail.com'), 'Manager credit/contact missing from the status bar');
  await open('مشتریان');
  const editCustomer = await waitFor(() => activePanel().querySelector('button[title="ویرایش"]'), 'customer edit');
  editCustomer.click();
  // بند ۸: تاریخ تولد یک کادر تک‌جعبه‌ای است (روز/ماه/سال با جداکننده)، نه سه فیلد جدا.
  const birthdaySelector = 'input[aria-label="تاریخ تولد"], input[aria-label="تاریخ تأسیس"]';
  const birthday = await waitFor(() => document.querySelector(birthdaySelector), 'birthday editor');
  enter(birthday, '۱۳۵۰/۰۱/۱۵'); await pause(180);
  check(birthday.value === '۱۳۵۰/۰۱/۱۵', `Birthday box kept the wrong text: ${birthday.value}`);
  // aria-invalid همیشه در DOM هست؛ مقدارش مهم است ('true' یعنی فرم تاریخ را رد کرده).
  check(birthday.getAttribute('aria-invalid') !== 'true', `Birthday box rejected the sample date: value=${birthday.value}, hint=${birthday.parentElement.innerText.replace(/\s+/g, ' ').slice(0, 80)}`);
  const saveCustomer = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'ذخیره');
  check(saveCustomer, 'Customer save missing'); saveCustomer.click();
  await waitFor(() => !document.querySelector(birthdaySelector), 'customer saved');
  const afterBirthday = (await ok(api.get(customersKey), 'verify persisted birthday')).value;
  check(afterBirthday.some(customer => customer.birthDate === '1971-04-04'), 'Jalali 1350 birthday was not persisted correctly');

  window.__printQA = {
    async openSimple() {
      await open('قیمت‌گذاری و دریافت');
      const lookup = await waitFor(() => document.querySelector('input[list="finance-order-numbers"]'), 'finance order lookup');
      enter(lookup, String(simpleSaved.orderNumber)); await pause(150);
      const button = await waitFor(() => [...activePanel().querySelectorAll('button')].find(node => node.textContent.trim() === 'فرم سفارش — نسخه حسابداری'), 'order form print');
      button.click(); await ready('A4');
    },
    async openDocument(type) {
      const labels = { quote: 'پیش‌فاکتورها', invoice: 'فاکتورها', simpleInvoice: 'فاکتورها', statement: 'صورت وضعیت' };
      const docs = { quote, invoice, simpleInvoice, statement };
      await open(labels[type]);
      const row = await waitFor(() => [...activePanel().querySelectorAll('tbody tr')].find(node => node.textContent.includes(docs[type].number)), `document ${type}`);
      const button = [...row.querySelectorAll('button')].find(node => node.textContent.trim() === 'چاپ');
      check(button, `Print button ${type}`); button.click(); await ready('A4');
    },
    async openLetter() {
      await open('نامه‌ها');
      const row = await waitFor(() => [...activePanel().querySelectorAll('tbody tr')].find(node => node.textContent.includes(letterNumber)), 'long letter');
      const button = [...row.querySelectorAll('button')].find(node => node.textContent.trim() === 'چاپ A5');
      check(button, 'Letter print button missing'); button.click(); await ready('A5');
    },
    async openCustomersReport() {
      await open('مشتریان');
      const button = await waitFor(() => [...activePanel().querySelectorAll('button')].find(node => node.textContent.trim() === 'چاپ A4'), 'customers report print');
      button.click(); await ready('A4');
    },
    async paper(paper) {
      const select = document.querySelector('select[aria-label="اندازهٔ کاغذ"]'); check(select, 'Paper selector missing');
      enter(select, paper); await ready(paper);
    },
    async close() {
      const close = document.querySelector('.print-toolbar button:last-child'); check(close, 'Print close missing');
      close.click(); await waitFor(() => !document.querySelector('.print-root'), 'close print preview');
    },
    audit({ paper, orientation = 'portrait', minimumPages = 1, exactPages, tokens = [], expectTable = false, forbidden = [] }) {
      const host = document.querySelector('.print-pages');
      check(host?.getAttribute('aria-busy') === 'false', 'Print preview is not ready');
      check(host.dataset.paper === paper, `Paper mismatch: ${host.dataset.paper}`);
      const pages = [...host.querySelectorAll(':scope > .print-page')];
      check(pages.length >= minimumPages, `Expected >=${minimumPages} ${paper} pages, got ${pages.length}`);
      if (exactPages !== undefined) check(pages.length === exactPages, `Expected ${exactPages} pages, got ${pages.length}`);
      const mm = value => value * 96 / 25.4;
      const expected = paper === 'A4' ? [210, 297] : [148, 210];
      if (orientation === 'landscape') expected.reverse();
      check(host.dataset.orientation === orientation, 'Orientation mismatch');
      if (orientation === 'landscape') check(document.querySelector('select[aria-label="اندازهٔ کاغذ"]').disabled, 'Final invoice paper must be locked');
      const number = value => value.toLocaleString('fa-IR', { useGrouping: false });
      const metrics = pages.map((page, index) => {
        const rect = page.getBoundingClientRect();
        check(Math.abs(rect.width - mm(expected[0])) <= 2 && Math.abs(rect.height - mm(expected[1])) <= 2, `Wrong page dimensions at ${index + 1}: ${rect.width}x${rect.height}`);
        const headers = page.querySelectorAll(':scope > .print-page-header');
        check(headers.length === 1, `Missing/duplicate page header ${index + 1}`);
        const header = headers[0].textContent.trim();
        check(header === `صفحه ${number(index + 1)} از ${number(pages.length)}`, `Wrong page count label: ${header}`);
        const content = page.querySelector(':scope > .print-page-content');
        check(content, `Page content missing ${index + 1}`);
        check(content.scrollHeight <= content.clientHeight + 2, `Vertical overflow on page ${index + 1}: ${content.scrollHeight}/${content.clientHeight}`);
        check(content.scrollWidth <= content.clientWidth + 2, `Horizontal overflow on page ${index + 1}: ${content.scrollWidth}/${content.clientWidth}`);
        if (content.textContent.includes('مهر و امضای فروشنده')) check(content.textContent.includes('جمع کل'), `Signature stranded without financial summary on page ${index + 1}`);
        return { page: index + 1, header, width: rect.width, height: rect.height,
          contentHeight: content.clientHeight, scrollHeight: content.scrollHeight, contentWidth: content.clientWidth, scrollWidth: content.scrollWidth };
      });
      pages.forEach((page, index) => {
        const pageRect = page.getBoundingClientRect();
        const header = page.querySelector(':scope > .print-page-header');
        const headerRect = header.getBoundingClientRect();
        check(headerRect.top >= pageRect.top - 1 && headerRect.bottom <= pageRect.top + mm(17),
          `Page-number header is not at the top of page ${index + 1}`);
        const content = page.querySelector(':scope > .print-page-content');
        check(content.textContent.trim().length > 0, `Page ${index + 1} is empty — wasted sheet`);
      });
      const painted = [...host.querySelectorAll('.print-page-content *')].filter(el => {
        const style = window.getComputedStyle(el);
        return (style.backgroundImage && style.backgroundImage !== 'none')
          || !/rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/.test(style.backgroundColor);
      });
      check(painted.length === 0, `Background would print on ${painted.length} element(s): ${painted.slice(0, 3).map(el => el.className || el.tagName).join(', ')}`);
      // Ignore page-number headers when reconstructing text split across pages.
      const printedText = pages.map(page => page.querySelector('.print-page-content').textContent).join('').replace(/\s/g, '');
      for (const token of tokens) {
        const normalized = token.replace(/\s/g, '');
        check(printedText.includes(normalized), `Printed text lost token ${token}`);
        check(printedText.split(normalized).length - 1 === 1, `Printed token duplicated: ${token}`);
      }
      forbidden.forEach(token => check(!printedText.includes(token), `Private/internal text printed: ${token}`));
      const tables = [...host.querySelectorAll('.print-page-content table')].filter(table => table.tBodies.length && [...table.tBodies].some(body => body.rows.length));
      if (expectTable) {
        check(tables.length > 1, 'Expected table continuation across pages');
        check(tables.every(table => table.tHead?.rows.length), 'A continued table lost THEAD');
        const headings = tables.map(table => table.tHead.textContent.replace(/\s/g, ''));
        check(headings.every(heading => heading === headings[0]), 'Repeated THEAD changed across pages');
      }
      return { paper, orientation, pageCount: pages.length, checkedTokens: tokens.length, repeatedTableHeads: tables.length, metrics };
    },
    serviceTokens, letterTokens, customerTokens: customers.map(customer => customer.name.split(' ')[0]),
  };
  return { simpleOrderNumber: simpleSaved.orderNumber, longOrderNumber: longSaved.orderNumber,
    quoteNumber: quote.number, invoiceNumber: invoice.number, statementNumber: statement.number, letterNumber };
}

app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.once('did-fail-load', (_e, code, reason) => { console.error(JSON.stringify({ pass: false, code, reason })); app.exit(1); });
  win.webContents.once('did-finish-load', async () => {
    const results = [];
    const evaluate = code => win.webContents.executeJavaScript(code);
    async function capture(name, options, tokensExpression = '[]') {
      // A thrown page-side check otherwise arrives as a generic "script failed"; catch it in-page.
      const outcome = await evaluate(`(() => { try { return { ok: true, value: window.__printQA.audit({...${JSON.stringify(options)},tokens:${tokensExpression}}) }; } catch (error) { return { ok: false, error: String((error && error.message) || error) }; } })()`);
      if (!outcome.ok) {
        fs.writeFileSync(path.join(outputDir, `${name}-failed.pdf`), await win.webContents.printToPDF(pdfPrintOptions(options.paper, options.orientation)));
      }
      assert.ok(outcome.ok, `${name}: audit failed — ${outcome.error}`);
      const result = outcome.value;
      const pdfPath = path.join(outputDir, `${name}.pdf`);
      // Exactly the options the app itself uses, so this QA measures the shipped behaviour.
      const bytes = await win.webContents.printToPDF(pdfPrintOptions(options.paper, options.orientation));
      assert.ok(bytes.length > 1000, 'Empty PDF'); fs.writeFileSync(pdfPath, bytes);
      const pdf = assertPdfGeometry(bytes, options.paper, result.pageCount, name, options.orientation);
      fs.writeFileSync(path.join(outputDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      results.push({ name, pdfPath, pdfBytes: bytes.length, pdfPages: pdf.pages, pdfPagePt: pdf.pagePt, ...result });
    }
    try {
      const seeded = await evaluate(`(${bootstrap.toString()})(${JSON.stringify(appVersion)})`);
      await evaluate('window.__printQA.openSimple()');
      await capture('01-simple-order-a4', { paper: 'A4', exactPages: 1 }, '["QA-SIMPLE-PRODUCT"]');
      await evaluate('window.__printQA.close();');
      await evaluate('window.__printQA.openDocument("quote")');
      await capture('02-long-quote-a4', { paper: 'A4', minimumPages: 2, expectTable: true, forbidden: ['987654321'] }, 'window.__printQA.serviceTokens');
      await evaluate('window.__printQA.paper("A5")');
      await capture('03-long-quote-a5', { paper: 'A5', minimumPages: 2, expectTable: true, forbidden: ['987654321'] }, 'window.__printQA.serviceTokens');
      await evaluate('window.__printQA.close();');
      await evaluate('window.__printQA.openDocument("invoice")');
      await capture('04-long-invoice-a4', { paper: 'A4', orientation: 'landscape', minimumPages: 2, expectTable: true, forbidden: ['987654321'] }, 'window.__printQA.serviceTokens');
      await evaluate('window.__printQA.close();');
      await evaluate('window.__printQA.openDocument("simpleInvoice")');
      await capture('08-book-example-invoice-landscape', { paper: 'A4', orientation: 'landscape', exactPages: 1 }, '["لیتوگرافی متن", "مشخصات فروشنده", "مشخصات خریدار"]');
      await evaluate('window.__printQA.close();');
      await evaluate('window.__printQA.openDocument("statement")');
      await capture('05-long-statement-a4', { paper: 'A4', minimumPages: 2, expectTable: true, forbidden: ['987654321'] }, 'window.__printQA.serviceTokens');
      await evaluate('window.__printQA.close();');
      await evaluate('window.__printQA.openLetter()');
      await capture('06-long-letter-a5', { paper: 'A5', minimumPages: 2 }, 'window.__printQA.letterTokens');
      await evaluate('window.__printQA.close();');
      await evaluate('window.__printQA.openCustomersReport()');
      await capture('07-customer-report-a4', { paper: 'A4', minimumPages: 2, expectTable: true }, 'window.__printQA.customerTokens');
      const report = { smoke: 'electron-real-print-pagination', pass: true, electron: process.versions.electron, fixtureDir, outputDir, seeded, results };
      fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report)); clearTimeout(timeout); app.exit(0);
    } catch (error) {
      fs.writeFileSync(path.join(outputDir, 'failure.json'), JSON.stringify({ pass: false, error: error.stack, fixtureDir, completed: results }, null, 2));
      console.error(error.stack); clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../electron/main.js');
