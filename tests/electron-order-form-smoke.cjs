'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
app.disableHardwareAcceleration();
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-order-form-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
process.env.PRINTSHOP_UI_QA = '1';
const timeout = setTimeout(() => { console.error('Order form smoke timed out'); app.exit(1); }, 150000);

async function scenario() {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  async function ok(request) { const result = await request; check(result?.ok, result?.error || 'Request failed'); return result; }
  async function waitFor(select, label) { for (let i = 0; i < 200; i++) { const value = select(); if (value) return value; await pause(50); } throw new Error('UI wait expired: ' + (label || String(select)) + ' | body=' + document.body.innerText.slice(0, 900).replace(/\s+/g, ' ')); }
  const alerts = [];
  window.alert = message => alerts.push(String(message));
  window.confirm = () => true;
  const buttons = scope => [...scope.querySelectorAll('button')];
  const byText = (scope, label) => buttons(scope).find(button => button.textContent.trim() === label);
  function enter(element, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const api = window.printshopApi;
  const ORDERS = 'printshop_orders_v5', CUSTOMERS = 'printshop_customers_v2', INVENTORY = 'printshop_inventory_v3';

  await ok(api.auth.login('admin', '1234'));
  await ok(api.auth.setOwnPassword('form-smoke-password'));
  await ok(api.set('printshop_manager_pin', '123456'));

  const paper = { id: 'inv-paper', category: 'کاغذ', name: 'تحریر ۷۰', gramaj: '70', size: 'وزیری', brand: '', color: '', finish: '', ownerType: 'چاپخانه', ownerCustomerId: '', purpose: '', linkedOrderNumber: '', unitMode: 'simple', simpleUnit: 'بند', quantity: '1000', unitValue: '', minThreshold: '', location: '', supplierSource: 'چاپخانه', supplierId: '', bandCount: '', sheetsPerBand: '', weightKg: '' };
  await ok(api.set(INVENTORY, [paper]));
  await ok(api.set(CUSTOMERS, [{ id: 'c1', name: 'مشتری بدهکار', entityType: 'حقوقی', phone: '09121110000', mobile: '09121110000', address: '', customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, marketerId: '', createdAt: 1 }]));

  const material = { id: 'm1', inventoryItemId: paper.id, description: 'تحریر ۷۰', qty: '5', qtyUnit: 'بند', unitLabel: 'بند', ownerName: '', owner: 'چاپخانه', ownerCustomerId: '' };
  const base = {
    date: '2026-10-01', deliveryDate: '2026-10-30', title: 'کتاب آزمایشی', description: '', customerId: 'c1', customerCode: '',
    customerName: 'مشتری بدهکار', phone: '09121110000', mobile: '', status: 'در انتظار تایید', quoteRev: 1, vatPercent: '', discount: '',
    items: [{ id: 'i1', productName: 'کتاب آزمایشی', productType: 'کتاب', qty: '1000', qtyUnit: 'نسخه', unitPrice: '', designPrice: '', hasDesign: false, designDescription: '', stage: 'ثبت سفارش', papers: [material], lithoMaterials: [], bindingMaterials: [], services: [], coverEnabled: false }],
    payments: [], history: [], source: 'مشتری', intent: 'proforma', onHold: false, holdReason: '', procurement: null, smartText: '', archive: null, marketerCode: '', createdAt: 1,
    delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' }, shippingCost: '', otherCost: '', otherLabel: '',
  };
  /* legacy shape on purpose: the record predates managerOverrideDebt and must not gain it from the form */
  const legacy = { ...base, id: 'legacy', orderNumber: '2001' };
  const debtOrder = { ...base, id: 'debt', orderNumber: '2002', items: [{ ...base.items[0], id: 'i2', unitPrice: '5000' }] };
  await ok(api.set(ORDERS, [legacy, debtOrder]));
  await ok(api.orderAction('debt', 'confirm_customer', { evidence: 'تأیید تلفنی مشتری' }));
  await ok(api.orderAction('debt', 'release_production', { materialReview: { checked: true, shortages: [] } }));
  const seeded = (await ok(api.get(ORDERS))).value;
  check(seeded.find(o => o.id === 'debt').status === 'تایید شده', 'fixture debt order did not reach an open-balance status');
  const legacyNumber = String(seeded.find(o => o.id === 'legacy').orderNumber);

  await ok(api.auth.logout());
  await waitFor(() => document.querySelector('input[type="password"]'), 'login form');
  const password = document.querySelector('input[type="password"]');
  enter([...document.querySelectorAll('input')].find(input => input.type !== 'password'), 'admin');
  enter(password, 'form-smoke-password'); await pause(120);
  byText(document, 'ورود').click();
  await waitFor(() => document.querySelector('.workbench-shell'), 'workbench');
  const sidebar = document.querySelector('.workbench-sidebar');
  const slider = document.querySelector('[data-sidebar-toggle]');
  check(slider, 'sidebar slider control missing');
  const initialSidebarWidth = sidebar.getBoundingClientRect().width;
  const initialTabs = document.querySelectorAll('.workbench-tab').length;
  slider.click(); await pause(350);
  check(sidebar.getBoundingClientRect().width < initialSidebarWidth - 80, 'sidebar did not collapse');
  check(document.querySelectorAll('.workbench-tab').length === initialTabs, 'collapsing sidebar closed a tab');
  slider.click(); await pause(350);
  check(Math.abs(sidebar.getBoundingClientRect().width - initialSidebarWidth) < 2, 'sidebar did not reopen');
  check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'workbench overflows the viewport');

  const desk = [...document.querySelectorAll('.workbench-navitem')].find(item => item.getAttribute('aria-label') === 'سفارش‌ها');
  check(desk, 'orders desk missing'); desk.click(); await pause(250);

  async function openForm(orderNumber) {
    const toLatin = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    const findRow = () => [...document.querySelectorAll('tr')].find(tr => toLatin(tr.textContent).replace(/[،,\s]/g, '').includes(String(orderNumber)));
    const row = await waitFor(findRow, 'row ' + orderNumber);
    check(row, 'order row ' + orderNumber + ' missing; rows=' + document.querySelectorAll('tr').length + ' body=' + document.body.innerText.slice(0, 400).replace(/\s+/g, ' '));
    byText(row, 'جزئیات').click();
    await waitFor(() => byText(document, 'ویرایش سفارش'), 'edit button for ' + orderNumber);
    byText(document, 'ویرایش سفارش').click();
    await waitFor(() => byText(document, 'ذخیره سفارش'), 'order form');
  }
  await openForm(legacyNumber);
  check(document.body.innerText.includes('بدهی از سفارش‌های قبلی دارد'), 'debt warning missing in the order form');

  byText(document, 'ذخیره سفارش').click();
  await pause(200);
  check(document.body.innerText.includes('تایید مدیر (رمز مدیر) لازم است'), 'form saved a debtor order without manager consent');
  check(alerts.length === 0, 'save attempt raised an alert: ' + alerts.join(' | '));

  const pin = document.querySelector('input[type="password"]');
  check(pin, 'manager pin field missing');
  enter(pin, '123456'); await pause(80);
  byText(document, 'تایید مدیر').click();
  await waitFor(() => document.body.innerText.includes('با تایید مدیر مجاز شد'), 'manager consent accepted');

  const phone = [...document.querySelectorAll('input')].find(input => input.value === '09121110000');
  check(phone, 'phone field missing in the order form');
  enter(phone, '09121110001'); await pause(80);
  byText(document, 'ذخیره سفارش').click();
  await pause(400);
  check(alerts.length === 0, 'saving a debtor order after manager consent failed: ' + alerts.join(' | '));
  await waitFor(() => !byText(document, 'ذخیره سفارش'), 'form to close after save');

  const savedLegacy = (await ok(api.get(ORDERS))).value.find(o => o.id === 'legacy');
  check(savedLegacy.phone === '09121110001', 'the edited phone was not persisted');
  check(Object.prototype.hasOwnProperty.call(savedLegacy, 'managerOverrideDebt') === false, 'the order form wrote the manager debt flag');
  check(savedLegacy.status === 'در انتظار تایید', 'the general save changed the order status');
  check(!savedLegacy.workflow, 'the general save created a workflow record');

  return { managerConsentGate: true, debtorOrderSaved: true, flagWrittenByForm: false, savedOrderNumber: String(savedLegacy.orderNumber), alerts };
}

/* UI-10 (density, larger labels) and UI-11 (colon + column alignment) measured in the real window,
   plus the per-field microphone that must name its own destination and never write on its own. */
async function densityScenario(orderNumber) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const toLatin = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const byText = (scope, label) => [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === label);
  async function waitFor(select, label) {
    for (let i = 0; i < 200; i++) { const value = select(); if (value) return value; await pause(50); }
    throw new Error('UI wait expired: ' + label + ' | body=' + document.body.innerText.slice(0, 500).replace(/\s+/g, ' '));
  }
  const findRow = () => [...document.querySelectorAll('tr')].find(tr => toLatin(tr.textContent).replace(/[،,\s]/g, '').includes(String(orderNumber)));
  if (!findRow()) {
    const desk = [...document.querySelectorAll('.workbench-navitem')].find(item => item.getAttribute('aria-label') === 'سفارش‌ها');
    check(desk, 'orders desk missing before the density pass');
    desk.click();
    await pause(500);
  }
  if (!findRow()) throw new Error('orders table is not visible: tables=' + document.querySelectorAll('table').length
    + ' rows=' + document.querySelectorAll('tr').length
    + ' nav=' + [...document.querySelectorAll('.workbench-navitem')].map(i => i.getAttribute('aria-label') + ':' + i.className).join('|')
    + ' main=' + (document.querySelector('main')?.innerText || document.body.innerText).slice(0, 300).replace(/\s+/g, ' '));
  const row = findRow();
  byText(row, 'جزئیات').click();
  await waitFor(() => byText(document, 'ویرایش سفارش'), 'edit button');
  byText(document, 'ویرایش سفارش').click();
  await waitFor(() => byText(document, 'ذخیره سفارش'), 'order form');

  /* اصلاحات ۹ بند ۱۰: تراکم فرم در دو سطح شمرده می‌شود — کادرهای سطح سفارش، و
     خانه‌های قابل‌ویرایش هر ردیف قلم (جدول ردیفی جای کارت‌های بلند را گرفت).
     اعداد مبنای چیدمانِ امروزند: ۸ کادر سفارش و ۱۱ خانه در هر ردیف (۱۴ برای قلم کتابی). */
  const fields = [...document.querySelectorAll('.psx-field')];
  check(fields.length >= 8, 'expected the order-level fields, only ' + fields.length + ' found');
  const itemRow = document.querySelector('.oit-table tbody tr.oit-part');
  check(!!itemRow, 'the order form has no item row table');
  const rowCells = [...itemRow.querySelectorAll('input,select,textarea')].filter(cell => cell.getClientRects().length);
  check(rowCells.length >= 9, 'a row must carry the editable columns of its part, got ' + rowCells.length);
  const labelOf = field => field.querySelector(':scope > .psx-field-label');
  const labelled = fields.filter(labelOf);
  const missingColon = labelled.map(labelOf).filter(label => !/:\s*$/.test(label.textContent));
  check(missingColon.length === 0, 'labels without a colon: ' + missingColon.map(l => l.textContent).join(' | '));

  const TEXTUAL = ['text', 'search', 'tel', 'url', 'email', ''];
  const dictatable = field => [...field.querySelectorAll('input,textarea')].some(el => TEXTUAL.includes(String(el.type || '').toLowerCase()) && !el.readOnly && !el.disabled);
  const textFields = fields.filter(dictatable);
  check(textFields.length >= 5, 'only ' + textFields.length + ' order-level fields can take text');
  /* اصلاحات ۹ بند ۲: مبدل گفتاربه‌متن حذف شده است — هیچ کادری دکمهٔ صوت ندارد. */
  const mics = fields.filter(field => field.querySelector('.voice-field-button, button[aria-label^="با صدا"]'));
  check(mics.length === 0, mics.length + ' field(s) still carry a speech button');

  const clipped = labelled.map(labelOf).filter(label => label.scrollWidth > label.clientWidth + 1);
  check(clipped.length === 0, 'truncated labels: ' + clipped.map(l => l.textContent).join(' | '));
  /* کنترل‌های سطح سفارش: هر ورودی/انتخاب داخل کادرهای سفارش (کادر تاریخ، کنترل ترکیبی است). */
  const innerControls = fields.flatMap(field => [...field.querySelectorAll('input,select,textarea')]).filter(control => control.getClientRects().length);
  check(innerControls.length >= fields.length, 'order-level fields have no control inside: ' + innerControls.length + ' for ' + fields.length + ' fields');
  /* جعبهٔ کنترل تک‌خطی باید همان قطارِ بند ۱ باشد: `src/ui-theme.css:14` برای ورودی و انتخابِ
     مودال min-height:38px و padding:7px 10px تعیین می‌کند، پس جعبه ۳۸ تا ۴۰ پیکسل است.
     سقف ۳۴ پیش از آن تصویب شده بود و با قطارِ تایپوگرافیِ تصویب‌شده در تضاد است. */
  const controls = [...document.querySelectorAll('.psx-field-control > input, .psx-field-control > select, .psx-field-control > textarea')];
  check(controls.length >= 7, 'expected the order-level control boxes, got ' + controls.length);
  const oneLine = controls.filter(el => el.tagName !== 'TEXTAREA').map(el => ({ el, height: Math.round(el.getBoundingClientRect().height) }));
  const offGrid = oneLine.filter(box => box.height < 38 || box.height > 40);
  check(offGrid.length === 0, offGrid.length + ' control boxes are off the 38-40px design row: '
    + offGrid.map(box => (labelOf(box.el.closest('.psx-field'))?.textContent || box.el.tagName).trim() + '=' + box.height).join(' | '));
  /* اندازهٔ لیبل باید همان توکنِ سیستم طراحی باشد؛ عدد ثابت نمی‌نویسیم تا با مقیاسِ بند ۱ نپوسد. */
  const labelToken = getComputedStyle(document.documentElement).getPropertyValue('--psx-fs-label').trim();
  check(!!labelToken, 'the design system exposes no --psx-fs-label token');
  const offSize = labelled.map(labelOf).filter(label => getComputedStyle(label).fontSize !== labelToken);
  check(offSize.length === 0, offSize.length + ' labels are not at the design token size (' + labelToken + '); found '
    + [...new Set(offSize.map(label => getComputedStyle(label).fontSize))].join('/') + ')');

  const groups = new Map();
  labelled.forEach(field => { if (field.classList.contains('psx-stacked')) return; const key = field.parentElement; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(field); });
  const aligned = [...groups.values()].filter(list => list.length >= 2);
  check(aligned.length >= 2, 'expected several fields sharing a row, got ' + aligned.length);
  const misaligned = [];
  aligned.forEach(list => {
    const widths = list.map(field => Math.round(labelOf(field).getBoundingClientRect().width));
    if (new Set(widths).size !== 1) misaligned.push(list.map((f, i) => labelOf(f).textContent.trim() + '=' + widths[i]).join(' / '));
  });
  check(misaligned.length === 0, 'label columns of differing label lengths do not line up: ' + misaligned.join(' || '));

  const controlOf = f => f.querySelector('input:not([type=checkbox]):not([type=radio]),textarea');

  return { fieldCount: fields.length, rowCellCount: rowCells.length, dictatableCount: textFields.length, alignedRows: aligned.length, controlHeight: Math.round(controls[0].getBoundingClientRect().height), labelSize: getComputedStyle(labelOf(labelled[0])).fontSize };
}

async function financialLayoutScenario(orderNumber) {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  // Close the two order dialogs through their actual header buttons.
  for (let i = 0; i < 3; i++) {
    const overlay = [...document.querySelectorAll('div')].reverse().find(element => element.style.position === 'fixed' && element.style.inset === '0px' && element.querySelector('strong'));
    if (!overlay) break;
    overlay.querySelector('strong').parentElement.querySelector('button')?.click(); await pause(100);
  }
  document.querySelector('.workbench-navitem[aria-label="قیمت‌گذاری و دریافت"]').click(); await pause(200);
  const search = document.querySelector('input[list="finance-order-numbers"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, String(orderNumber));
  search.dispatchEvent(new Event('input', { bubbles: true })); await pause(300);
  const editor = document.querySelector('.quote-editor'); check(editor, 'financial table is missing');
  const table = editor.querySelector('.quote-table'); check(table, 'quote rows are not a table');
  const viewport = table.closest('.quote-table-scroll');
  check(viewport.scrollWidth >= viewport.clientWidth, 'financial table does not own its horizontal scrolling');
  check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'financial page expands the document');
  const fieldset = editor.querySelector('fieldset');
  check(!fieldset.disabled, 'draft order pricing is incorrectly locked');
  const descriptions = [...editor.querySelectorAll('input[aria-label="شرح کالا یا خدمات"]')];
  check(descriptions.length > 0, 'financial description is missing');
  const editorSpeech = [...editor.querySelectorAll('button')].filter(button =>
    /با صدا|تبدیل گفتار/.test(button.getAttribute('aria-label') || '') || button.getAttribute('title')?.includes('تبدیل گفتار'));
  check(editorSpeech.length === 0, 'price editor still exposes ' + editorSpeech.length + ' speech control(s)');

  // --- row table replaces the tall cards: invoice-aligned heads, one editable line per row ---
  const enterValue = (element, value) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const pressButton = (label) => [...editor.querySelectorAll('button')].find(button => button.textContent.trim() === label);
  async function waitUi(select, label) { for (let attempt = 0; attempt < 200; attempt++) { const value = select(); if (value) return value; await pause(50); } throw new Error('pricing table wait expired: ' + label); }
  check(!editor.querySelector('.quote-row'), 'the tall per-row cards are still rendered');
  const tables = [...editor.querySelectorAll('.quote-table')];
  check(tables.length === 2, 'expected one row table per group, got ' + tables.length);
  const headsOf = node => [...node.querySelectorAll('thead th')].map(th => th.textContent.trim());
  const invoiceHeads = ['ردیف', 'شناسه کالا / خدمت', 'شرح کالا یا خدمات', 'دسته', 'مقدار', 'واحد', 'مبلغ واحد — نرخ فروش روز (ریال)', 'مبلغ کل (ریال)', 'مواد مشتری', 'حذف'];
  check(JSON.stringify(headsOf(tables[0])) === JSON.stringify(invoiceHeads), 'material heads differ from the invoice order: ' + headsOf(tables[0]).join('|'));
  check(headsOf(tables[1]).slice(0, 6).join('|') === invoiceHeads.slice(0, 6).join('|') && headsOf(tables[1])[7] === 'مبلغ کل (ریال)', 'service heads differ from the invoice order: ' + headsOf(tables[1]).join('|'));

  // Column edges must line up inside each table and between the two tables (spreadsheet alignment).
  const leftEdges = node => [...node.querySelectorAll('thead tr:first-child > *')].map(cell => Math.round(cell.getBoundingClientRect().left * 10) / 10);
  const bodyEdges = node => [...node.querySelectorAll('tbody tr:first-child > *')].map(cell => Math.round(cell.getBoundingClientRect().left * 10) / 10);
  const headerEdges = leftEdges(tables[0]), rowEdges = bodyEdges(tables[0]);
  check(headerEdges.length === rowEdges.length, 'head and row cell counts differ');
  const maxHeaderDrift = Math.max(...headerEdges.map((left, index) => Math.abs(left - rowEdges[index])));
  check(maxHeaderDrift <= 0.6, `head and body columns drift by ${maxHeaderDrift}px`);
  const maxTableDrift = Math.max(...leftEdges(tables[0]).map((left, index) => Math.abs(left - leftEdges(tables[1])[index])));
  check(maxTableDrift <= 1, `the two row tables use different column edges: ${maxTableDrift}px`);
  const rowHeights = tables.flatMap(table => [...table.querySelectorAll('tbody tr')].map(tr => Math.round(tr.getBoundingClientRect().height)));
  const rowHeight = Math.max(...rowHeights);
  check(rowHeight <= 72, `a pricing row is ${rowHeight}px tall; the cards were supposed to collapse`);

  // Keyboard cell movement in the real DOM.
  pressButton('افزودن ماده').click(); await pause(150);
  const press = (id, key) => { const element = document.getElementById(id); element.focus(); element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); return document.activeElement.id; };
  check(press('qc-materials-0-itemCode', 'ArrowLeft') === 'qc-materials-0-description', 'ArrowLeft did not walk to the next invoice column');
  check(press('qc-materials-0-description', 'ArrowRight') === 'qc-materials-0-itemCode', 'ArrowRight did not walk back');
  check(press('qc-materials-0-rate', 'Enter') === 'qc-materials-1-rate', 'Enter did not move to the row below');
  check(press('qc-materials-1-qty', 'ArrowUp') === 'qc-materials-0-qty', 'ArrowUp did not move to the row above');
  check(press('qc-materials-0-itemCode', 'ArrowRight') === 'qc-materials-0-itemCode', 'the first column moved past the table edge');
  check(press('qc-materials-0-rate', 'ArrowLeft') === 'qc-materials-0-rate', 'the last editable column moved past the table edge');
  check(document.getElementById('qc-materials-1-description').getAttribute('list') === 'quote-descriptions-materials', 'a new row lost its suggestion list');

  // Stable goods code: the missing-identifier flag disappears once a 13-digit code is typed.
  const flags = () => editor.querySelectorAll('.quote-flag').length;
  const flagsBefore = flags();
  check(flagsBefore > 0, 'rows without a 13-digit code are not flagged');
  enterValue(document.getElementById('qc-materials-0-itemCode'), '1234567890123'); await pause(120);
  check(flags() === flagsBefore - 1, `the flag stayed after a valid code (${flagsBefore} -> ${flags()})`);
  check(document.getElementById('qc-materials-0-itemCode').value === '1234567890123', 'typed identifier lost while editing');

  // Money: grouped Persian display, plain digits to the engine, amounts and sums only from the backend.
  const amountCells = () => [...editor.querySelectorAll('td.quote-amount')].map(td => td.textContent.trim());
  check(amountCells().every(value => value === '—'), 'amounts appeared before any calculation');
  enterValue(document.getElementById('qc-materials-0-rate'), '123456'); await pause(120);
  check(document.getElementById('qc-materials-0-rate').value === '۱۲۳٬۴۵۶', 'rate lost its three-digit separator: ' + document.getElementById('qc-materials-0-rate').value);
  enterValue(document.getElementById('qc-materials-1-description'), 'مقوای جلد');
  enterValue(document.getElementById('qc-materials-1-rate'), '999'); await pause(150);
  const printRate = [...editor.querySelectorAll('input[aria-label="مبلغ واحد (ریال)"]')].find(input => !input.disabled);
  check(printRate, 'no editable service rate cell exists');
  enterValue(printRate, '500000'); await pause(150);
  pressButton('محاسبه و پیش‌نمایش').click();
  const summary = await waitUi(() => editor.querySelector('.quote-summary'), 'pricing preview');
  const summaryValue = label => { const row = [...summary.querySelectorAll('dl > div')].find(div => div.querySelector('dt')?.textContent.trim() === label); return row?.querySelector('dd')?.textContent.replace(/\s*ریال$/, '').trim(); };
  const fa = value => Number(value).toLocaleString('fa-IR');
  const materialRows = [...tables[0].querySelectorAll('tbody td.quote-amount')].map(td => td.textContent.trim());
  const materialSum = tables[0].querySelector('tfoot td.quote-amount').textContent.trim();
  const serviceSum = tables[1].querySelector('tfoot td.quote-amount').textContent.trim();
  check(JSON.stringify(materialRows) === JSON.stringify([fa(5 * 123456), fa(999)]), 'row amounts are not the engine line costs: ' + materialRows.join('|'));
  check(materialSum === fa(5 * 123456 + 999) && materialSum === summaryValue('فروش مواد'), `material row sum ${materialSum} vs engine ${summaryValue('فروش مواد')}`);
  check(serviceSum === fa(500000) && serviceSum === summaryValue('هزینهٔ خدمات'), `service row sum ${serviceSum} vs engine ${summaryValue('هزینهٔ خدمات')}`);
  check(document.getElementById('qc-materials-0-rate').value === '۱۲۳٬۴۵۶', 'recalculating rewrote the edited rate');
  // 20% markup applies to the service rows only, never to the material sales.
  check(summaryValue('سود خدمات') === fa(500000 * 0.2), `markup was not services-only: ${summaryValue('سود خدمات')}`);
  check(summaryValue('مبلغ نهایی') === fa(5 * 123456 + 999 + 500000 + 100000), `total disagrees with the engine: ${summaryValue('مبلغ نهایی')}`);
  // Editing after a calculation invalidates every displayed amount.
  enterValue(document.getElementById('qc-materials-1-rate'), '1000'); await pause(150);
  check(amountCells().every(value => value === '—' || value === 'صفر'), 'an edited table kept showing stale amounts: ' + amountCells().join('|'));

  // اصلاحات ۹ بند ۲: ردیف‌های جدول هم دیگر میکروفون ندارند.
  const cellMics = [...tables[0].querySelectorAll('.voice-field-button, button[aria-label^="با صدا"]')];
  check(cellMics.length === 0, 'row cells still carry ' + cellMics.length + ' speech button(s)');

  return { rowTables: tables.length, localScrollWidth: viewport.scrollWidth, localClientWidth: viewport.clientWidth, documentWidth: document.documentElement.scrollWidth,
    invoiceHeads, maxHeaderDrift, maxTableDrift, rowHeight, rowHeights, flagsBefore, materialRows, materialSum, serviceSum,
    finalTotal: summaryValue('مبلغ نهایی'), staleAmounts: amountCells(), cellMics: cellMics.length };
}

app.on('browser-window-created', (_event, win) => {
  let completed = false;
  win.on('close', event => { if (!completed) event.preventDefault(); });
  win.webContents.once('did-fail-load', (_event, code, reason) => { fs.writeFileSync(path.join(workDir, 'order-form-smoke-error.txt'), `load ${code}: ${reason}`); app.exit(1); });
  win.webContents.on('render-process-gone', (_event, details) => { fs.writeFileSync(path.join(workDir, 'order-form-smoke-error.txt'), JSON.stringify(details)); app.exit(1); });
  win.hide();
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(${scenario.toString()})()`);
      // Hidden windows still compute layout; avoid popping application windows during QA.
      await new Promise(resolve => setTimeout(resolve, 400));
      const density = await win.webContents.executeJavaScript(`(${densityScenario.toString()})(${JSON.stringify(result.savedOrderNumber)})`);
      const screenshot = path.join(workDir, 'order-form-density.png');
      const capture = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      fs.writeFileSync(screenshot, capture.toPNG());
      const finance = await win.webContents.executeJavaScript(`(${financialLayoutScenario.toString()})(${JSON.stringify(result.savedOrderNumber)})`);
      fs.writeFileSync(path.join(workDir, 'finance-table-ui2.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      fs.writeFileSync(path.join(workDir, 'order-form-smoke-results.json'), JSON.stringify({ ...result, density, finance }, null, 2));
      console.log(JSON.stringify({ smoke: 'order-form-real-ipc', pass: true, ...result, density, finance, fixtureDir }));
      completed = true; clearTimeout(timeout); app.exit(0);
    } catch (error) {
      fs.writeFileSync(path.join(workDir, 'order-form-smoke-error.txt'), String(error && error.stack || error));
      completed = true; console.error(error.stack); clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../electron/main.js');
