'use strict';
/* اصلاحات ۹ج بند ۱: چرخهٔ «تعریف ← تأیید ← کد یکتا» در رابط واقعی، با SQLite و IPC واقعی.
   فقط رکوردهای پروژه در پوشهٔ .work نوشته می‌شوند؛ بانک زندهٔ کارفرما باز نمی‌شود. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
assert.ok(process.versions.electron, 'Electron runtime required');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-party-cycle-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
const timeout = setTimeout(() => { console.error('Party-cycle smoke timed out'); app.exit(1); }, 90000);

const PRELUDE = `
window.__S = {
  api: window.printshopApi,
  CUSTOMERS: 'printshop_customers_v2',
  SUPPLIERS: 'printshop_suppliers_v2',
  PASS: 'party-cycle-isolated-password',
  REASON: 'مدارک ثبتی کامل و قابل اتکا است',
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
  check(value, message) { if (!value) throw new Error(message); },
  async ok(request) { const result = await request; window.__S.check(result && result.ok, (result && (result.error || result.code)) || 'operation failed'); return result; },
  async waitFor(select, label) { for (let i = 0; i < 160; i++) { const value = select(); if (value) return value; await window.__S.pause(50); } throw new Error('UI wait expired: ' + label); },
  page() { return document.querySelector('.workbench-page:not([hidden])') || document; },
  chip(label) { return [...this.page().querySelectorAll('button')].find(button => button.textContent.trim().startsWith(label + ' (')); },
  async clickChip(label) { const chip = this.chip(label); this.check(chip, 'Missing chip ' + label); chip.click(); await this.pause(160); return chip.textContent.trim(); },
  /* پنل بزرگ بالای فهرست برداشته شده؛ بررسی هر طرف از همان ردیف باز می‌شود. */
  async showTable() { const chip = this.chip('فهرست کاری'); this.check(chip, 'Missing chip for the scroll anchor'); chip.scrollIntoView({ block: 'start' }); await this.pause(200); return true; },
  rowNames() { return [...this.page().querySelectorAll('tbody tr')].map(row => ((row.querySelector('td') || {}).textContent || '').trim()); },
  rowFor(name) { return [...this.page().querySelectorAll('tbody tr')].find(row => ((row.querySelector('td') || {}).textContent || '').includes(name)); },
  async openReview(name) {
    const row = this.rowFor(name); this.check(row, 'Missing row for ' + name);
    const button = [...row.querySelectorAll('button')].find(b => ['بررسی و تأیید', 'صدور کد یکتا'].includes(b.textContent.trim()));
    this.check(button, 'Missing review button in row ' + name);
    button.click();
    const dialog = await this.waitFor(() => document.querySelector('.ui-modal'), 'review dialog');
    await this.pause(150);
    return dialog;
  },
  async closeReview(dialog) {
    const node = dialog || document.querySelector('.ui-modal'); this.check(node, 'review dialog is not open');
    const close = node.querySelector('.ui-modal-close'); this.check(close, 'close button missing');
    close.click();
    await this.waitFor(() => !document.querySelector('.ui-modal'), 'review dialog closed');
  },
  cards() { return [...document.querySelectorAll('.ui-modal article[aria-label^="بررسی "]')]; },
  card(name) { const node = this.cards().find(a => a.getAttribute('aria-label') === 'بررسی ' + name); this.check(node, 'Missing review card for ' + name); return node; },
  button(scope, label) { const node = [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === label); this.check(node, 'Missing button ' + label); return node; },
  type(element, value) { const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); },
  /* هیچ سنجشی پشت یک مودال باز انجام نمی‌شود: اگر فرمی باز مانده باشد، دودتست باید
     همان‌جا بایستد و نه این‌که جدول زیرِ پوشش را اندازه بگیرد و عکس آلوده بدهد. */
  desk(label) { if (document.querySelector('.ui-modal')) throw new Error('desk("' + label + '") looked up with a modal still open');
    return [...document.querySelectorAll('.workbench-navitem')].find(n => (n.getAttribute('aria-label') || n.textContent.trim()) === label); },
  async openDesk(label) { const node = this.desk(label);
    if (!node) throw new Error('Missing desk "' + label + '" — available: ' + [...document.querySelectorAll('.workbench-navitem')].map(n => n.getAttribute('aria-label') || n.textContent.trim()).join(' | '));
    node.click(); await this.pause(220); },
  async openOrderForm() {
    await this.openDesk('سفارش‌ها');
    const button = [...this.page().querySelectorAll('button')].find(b => b.textContent.trim() === 'سفارش جدید');
    this.check(button, 'دکمهٔ «سفارش جدید» در میز سفارش‌ها نیست');
    button.click();
    const dialog = await this.waitFor(() => document.querySelector('.ui-modal[aria-label="سفارش جدید"]'), 'order form modal');
    const picker = await this.waitFor(() => [...dialog.querySelectorAll('select')].find(s => [...s.querySelectorAll('option')].some(o => o.textContent.includes('انتخاب کنید'))), 'customer picker');
    return { dialog, picker };
  },
  async closeOrderForm(dialog) { this.check(dialog, 'فرم سفارش برای بستن پیدا نشد'); const cancel = [...dialog.querySelectorAll('button')].find(b => ['انصراف', 'بستن', 'لغو'].includes(b.textContent.trim()));
    this.check(cancel, 'دکمهٔ بستن فرم سفارش پیدا نشد');
    cancel.click();
    await this.waitFor(() => !document.querySelector('.ui-modal[aria-label="سفارش جدید"]'), 'order form modal closed'); },
  closeOpenOrderForm() { return this.closeOrderForm(document.querySelector('.ui-modal[aria-label="سفارش جدید"]')); },
  selectOptions(select) { return [...select.querySelectorAll('option')].map(o => o.textContent.trim()); },
}; 'party-prelude-ready';`;

app.on('browser-window-created', (_event, win) => {
  win.show(); win.focus();
  win.setBounds({ x: 0, y: 0, width: 1600, height: 1000 });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer console: ' + message); });
  win.webContents.once('did-finish-load', async () => {
    const shots = [];
    const capture = async name => {
      const file = path.join(workDir, name);
      fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      shots.push(file);
    };
    const run = async source => {
      const marker = source.replace(/\s+/g, ' ').slice(0, 70);
      const result = await win.webContents.executeJavaScript(`(async () => { try { return await (${source}); } catch (error) { return { __smokeError: String((error && error.stack) || error) }; } })()`, true);
      if (result && result.__smokeError) throw new Error(result.__smokeError + '\n  in phase: ' + marker);
      return result;
    };
    try {
      await win.webContents.executeJavaScript(PRELUDE, true);
      // ۱) تعریف رکوردها و تصمیم مدیر از راه IPC — تا رابط با بانکِ معلوم باز شود.
      await run(`(async () => {
        const S = window.__S;
        await S.ok(S.api.auth.login('admin', '1234'));
        await S.ok(S.api.auth.setOwnPassword(S.PASS));
        await S.ok(S.api.set(S.CUSTOMERS, [
          { id: 'p1', name: 'مشتری تازه‌وارد', entityType: 'حقیقی', phone: '09120000001', address: '', customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 },
          { id: 'm1', name: 'بازاریاب تأییدشده', entityType: 'حقیقی', phone: '09120000002', address: '', customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 },
          { id: 'p2', name: 'مشتری ردشده', entityType: 'حقیقی', phone: '09120000003', address: '', customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 },
        ]));
        await S.ok(S.api.set(S.SUPPLIERS, [
          { id: 's1', name: 'کاغذ فروش تأییدشده', entityType: 'حقوقی', phone: '02110000001', materials: 'کاغذ تحریر', supplierCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' } },
          { id: 's2', name: 'مقوا فروش تازه', entityType: 'حقوقی', phone: '02110000002', materials: 'مقوا', supplierCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' } },
        ]));
        const early = await S.api.partyAction('customer', 'm1', 'issue_number');
        S.check(early.ok === false && early.code === 'VALIDATION_FAILED', 'کد یکتا پیش از تأیید صادر شد: ' + JSON.stringify(early));
        const approved = await S.ok(S.api.partyAction('customer', 'm1', 'approve', { reason: S.REASON }));
        const coded = await S.ok(S.api.partyAction('customer', 'm1', 'issue_number'));
        S.check(coded.party.customerCode === 'C-000001', 'کد یکتا درست صادر نشد: ' + coded.party.customerCode);
        S.check(approved.party.active === true && !approved.party.customerCode, 'تأیید باید بی‌کد و فعال بماند');
        const rejected = await S.ok(S.api.partyAction('customer', 'p2', 'reject', { reason: 'مدارک کافی برای شروع کار نبود' }));
        S.check(rejected.party.active === false && rejected.party.customerCode === '', 'رد صلاحیت باید رکورد را غیرفعال و بی‌کد بگذارد');
        await S.ok(S.api.partyAction('supplier', 's1', 'approve', { reason: S.REASON }));
        const supplierCode = await S.ok(S.api.partyAction('supplier', 's1', 'issue_number'));
        S.check(supplierCode.party.supplierCode === 'S-000001', 'کد تامین‌کننده از شمارۀ جدا صادر نشد: ' + supplierCode.party.supplierCode);
        const bank = (await S.ok(S.api.get(S.CUSTOMERS))).value;
        await S.ok(S.api.set(S.CUSTOMERS, bank.map(c => c.id === 'm1' ? { ...c, isMarketer: true, commissionPercent: 5 } : c)));
        await S.ok(S.api.auth.logout());
      })()`);
      // ۲) ورود از راه رابط، تا پنل‌ها با نشست واقعی پر شوند.
      await run(`(async () => {
        const S = window.__S;
        window.confirm = () => true; // تأییدهای مرورگر را در آزمون می‌پذیریم تا کلیک روی دکمه‌ها معطل نماند
        const password = await S.waitFor(() => document.querySelector('input[type="password"]'), 'login screen');
        S.type([...document.querySelectorAll('input')].find(input => input.type !== 'password'), 'admin');
        S.type(password, S.PASS);
        await S.pause(80);
        S.button(document, 'ورود').click();
        await S.waitFor(() => document.querySelector('.workbench-shell'), 'workbench shell');
      })()`);
      // ۳) بخش مشتریان: فهرست در بالای صفحه، و بررسی از همان ردیف (بدون پنل بزرگ بالای فرم).
      await run(`(async () => {
        const S = window.__S;
        await S.openDesk('مشتریان');
        await S.clickChip('فهرست کاری');
        S.check(!S.page().textContent.includes('تعریف ← تأیید ← کد یکتا'), 'پنل بزرگ بررسی هنوز بالای فهرست است');
      })()`);
      const customersWork = await run(`(async () => {
        const S = window.__S;
        const chip = await S.clickChip('فهرست کاری');
        const names = S.rowNames();
        S.check(names.length === 1 && names.join(' ').includes('بازاریاب تأییدشده'), 'فهرست کاری مشتری‌ها درست نیست: ' + names.join('|'));
        S.check(names.join(' ').includes('C-000001'), 'کد یکتا در ستون نام جدول نشان داده نمی‌شود');
        S.check(!names.join(' ').includes('مشتری تازه‌وارد') && !names.join(' ').includes('مشتری ردشده'), 'رکورد تأییدنشده یا غیرفعال در فهرست کاری ماند');
        await S.clickChip('در انتظار بررسی');
        const pendingNames = S.rowNames();
        S.check(pendingNames.some(name => name.includes('مشتری تازه‌وارد')), 'رکورد در انتظار در چیپ خودش دیده نمی‌شود: ' + pendingNames.join('|'));
        const row = S.rowFor('مشتری تازه‌وارد');
        S.check([...row.querySelectorAll('button')].some(button => button.textContent.trim() === 'بررسی و تأیید'), 'دکمهٔ «بررسی و تأیید» در ردیف نیست');
        await S.showTable();
        return { chip, workRows: names.length };
      })()`);
      await capture('party-cycle-1-customers-worklist.png');
      const approvalThroughDialog = await run(`(async () => {
        const S = window.__S;
        const chip = await S.clickChip('همهٔ بانک');
        const names = S.rowNames();
        S.check(names.length === 3, 'بانک کامل باید ۳ رکورد داشته باشد: ' + names.join('|'));
        S.check(names.join(' ').includes('رد شده'), 'رکورد ردشده با چیپ «همهٔ بانک» دیده نمی‌شود');
        await S.openReview('مشتری تازه‌وارد');
        const card = S.card('مشتری تازه‌وارد');
        S.check(S.cards().length === 1, 'مودال بررسی باید فقط همان یک رکورد را نشان دهد: ' + S.cards().length);
        S.check(S.button(card, '۲. صدور کد یکتا').disabled === true, 'دکمهٔ صدور کد پیش از تأیید باز است');
        S.check(S.button(card, '۱. تأیید مشتری').disabled === true, 'تأیید بدون شرح تصمیم باز است');
        S.type(card.querySelector('textarea'), 'مدارک ثبتی و نمونه کار بررسی شد');
        await S.pause(80);
        S.check(S.button(S.card('مشتری تازه‌وارد'), '۱. تأیید مشتری').disabled === false, 'پس از نوشتن شرح، دکمهٔ تأیید باز نشد');
        S.button(S.card('مشتری تازه‌وارد'), '۱. تأیید مشتری').click();
        await S.waitFor(() => document.querySelector('.ui-modal').textContent.includes('تأیید مشتری در سرور ثبت شد'), 'approval feedback');
        const codeButton = S.button(S.card('مشتری تازه‌وارد'), '۲. صدور کد یکتا');
        S.check(codeButton.disabled === false, 'پس از تأیید، صدور کد باز نشد');
        codeButton.click();
        await S.waitFor(() => document.querySelector('.ui-modal').textContent.includes('صدور کد یکتای مشتری در سرور ثبت شد'), 'code feedback');
        const stored = (await S.ok(S.api.get(S.CUSTOMERS))).value.find(c => c.id === 'p1');
        S.check(stored.eligibility.status === 'approved' && stored.customerCode === 'C-000002', 'تأیید و کدِ رابط، در سرور ثبت نشد: ' + JSON.stringify(stored));
        return { chip, bankRows: names.length, newCode: stored.customerCode };
      })()`);
      await capture('party-cycle-2-review-dialog.png');
      await run(`(async () => { await window.__S.closeReview(); return true; })()`);
      const workListAfterApproval = await run(`(async () => {
        const S = window.__S;
        const chip = await S.clickChip('فهرست کاری');
        const names = S.rowNames();
        S.check(names.length === 2, 'پس از تأیید، رکورد به فهرست کاری نیامد: ' + names.join('|'));
        S.check(names.join(' ').includes('C-000002'), 'کد صادرشده در جدول دیده نمی‌شود');
        S.check([...S.rowFor('مشتری تازه‌وارد').querySelectorAll('button')].some(button => button.textContent.trim() === 'غیرفعال کردن'), 'دکمهٔ «غیرفعال کردن» کنار ویرایش و حذف نیست');
        await S.showTable();
        return { chip, workRows: names.length };
      })()`);
      await capture('party-cycle-2b-customers-after-approval.png');
      const orderForm = await run(`(async () => {
        const S = window.__S;
        const { dialog, picker } = await S.openOrderForm();
        const options = S.selectOptions(picker);
        const parties = options.filter(o => !o.includes('انتخاب کنید') && !o.includes('مشتری جدید'));
        S.check(parties.length === 2, 'پیکر مشتری باید ۲ رکورد تأییدشدهٔ فعال بدهد: ' + parties.join('|'));
        S.check(!parties.some(o => o.includes('مشتری ردشده')), 'مشتری ردشده در فرم سفارش انتخاب شدنی است');
        S.check(!parties.some(o => o.includes('مدارک') || o.includes('در انتظار')), 'رکورد در انتظار در پیکر مانده است');
        S.check(dialog.textContent.includes('ثبت سفارش'), 'فرم سفارش باز نشد');
        return { pickerOptions: options.length, parties };
      })()`);
      await capture('party-cycle-3-order-form-picker.png');
      // عکس پیکر گرفته شد؛ فرم باید بسته شود وگرنه سنجش‌های بعدی پشت پوشش انجام می‌شوند.
      await run(`(async () => { await window.__S.closeOpenOrderForm(); return true; })()`);
      const suppliers = await run(`(async () => {
        const S = window.__S;
        await S.openDesk('تامین‌کنندگان');
        S.check(!S.page().textContent.includes('تعریف ← تأیید ← کد یکتا'), 'پنل بزرگ بررسی هنوز در میز تامین‌کنندگان است');
        const work = await S.clickChip('فهرست کاری');
        const names = S.rowNames();
        S.check(names.length === 1 && names.join(' ').includes('کاغذ فروش تأییدشده'), 'فهرست کاری تامین‌کننده‌ها درست نیست: ' + names.join('|'));
        S.check(names.join(' ').includes('S-000001'), 'کد تامین‌کننده در جدول دیده نمی‌شود');
        const all = await S.clickChip('همهٔ بانک');
        S.check(S.rowNames().length === 2, 'بانک کامل تامین‌کننده‌ها باید ۲ رکورد داشته باشد');
        await S.openReview('مقوا فروش تازه');
        const pending = S.card('مقوا فروش تازه');
        S.check(S.cards().length === 1, 'مودال بررسی تامین‌کننده باید فقط همان یک رکورد را نشان دهد');
        S.check(S.button(pending, '۲. صدور کد یکتا').disabled === true, 'دکمهٔ کد تامین‌کننده پیش از تأیید باز است');
        S.check(S.button(pending, 'حذف از بانک').disabled === false, 'رکورد بی‌کد و تأییدنشده با دکمهٔ جدا حذف نمی‌شود');
        await S.closeReview();
        await S.showTable();
        return { workChip: work, allChip: all, supplierCards: 1 };
      })()`);
      await capture('party-cycle-4-suppliers.png');
      const marketerReport = await run(`(async () => {
        const S = window.__S;
        const nav = S.desk('حساب بازاریاب‌ها');
        if (nav) { nav.click(); await S.pause(220); }
        else {
          await S.openDesk('خلاصه مالی');
          const link = [...S.page().querySelectorAll('button')].find(b => b.textContent.includes('حساب بازاریاب‌ها'));
          S.check(link, 'پل «حساب بازاریاب‌ها» در خلاصه مالی نیست');
          link.click(); await S.pause(220);
        }
        await S.waitFor(() => S.page().textContent.includes('پورسانت'), 'marketer report');
        S.check(S.page().textContent.includes('بازاریاب تأییدشده'), 'بازاریاب تأییدشده در گزارش نیست');
        S.check(!S.page().textContent.includes('مشتری ردشده'), 'مشتریِ غیرفعال در گزارش بازاریاب‌ها آمده است');
        return { reportOk: true };
      })()`);
      await capture('party-cycle-5-marketers.png');
      // ۴) فعال/غیرفعال از همان ردیف فهرست + کنترل‌های منفیِ جعل و حذف.
      const guards = await run(`(async () => {
        const S = window.__S;
        const before = (await S.ok(S.api.get(S.CUSTOMERS))).value;
        const readParty = async id => (await S.ok(S.api.get(S.CUSTOMERS))).value.find(c => c.id === id);
        await S.openDesk('مشتریان');
        await S.clickChip('فهرست کاری');
        const row = S.rowFor('مشتری تازه‌وارد');
        S.check(row, 'رکورد تأییدشده در فهرست کاری نیست');
        S.button(row, 'غیرفعال کردن').click();
        for (let attempt = 0; attempt < 80; attempt++) { if ((await readParty('p1')).active === false) break; await S.pause(80); }
        const off = await readParty('p1');
        S.check(off.active === false && off.customerCode === 'C-000002', 'غیرفعال کردن کد را خراب کرد');
        await S.clickChip('همهٔ بانک');
        const offRow = S.rowFor('مشتری تازه‌وارد');
        S.check(offRow && offRow.textContent.includes('غیرفعال'), 'وضعیت غیرفعال در ردیف دیده نمی‌شود');
        S.check([...offRow.querySelectorAll('button')].some(button => button.textContent.trim() === 'فعال کردن'), 'دکمهٔ «فعال کردن» جای «غیرفعال کردن» نیامد');
        const form = await S.openOrderForm();
        const parties = S.selectOptions(form.picker).filter(o => !o.includes('انتخاب کنید') && !o.includes('مشتری جدید'));
        S.check(parties.length === 1 && parties[0].includes('بازاریاب تأییدشده'), 'رکورد غیرفعال هنوز در پیکر است: ' + parties.join('|'));
        await S.closeOrderForm(form.dialog);
        await S.openDesk('مشتریان');
        await S.clickChip('همهٔ بانک');
        S.button(S.rowFor('مشتری تازه‌وارد'), 'فعال کردن').click();
        for (let attempt = 0; attempt < 80; attempt++) { if ((await readParty('p1')).active === true) break; await S.pause(80); }
        const on = await readParty('p1');
        S.check(on.active === true && on.eligibility.status === 'approved', 'فعال کردن رکورد را از چرخه بیرون انداخت');
        const forged = structuredClone((await S.ok(S.api.get(S.CUSTOMERS))).value);
        forged.find(c => c.id === 'p1').customerCode = 'C-999999';
        S.check((await S.api.set(S.CUSTOMERS, forged)).ok === false, 'جعل کد از مسیر عمومی پذیرفته شد');
        forged.find(c => c.id === 'p1').customerCode = on.customerCode;
        S.check((await S.api.set(S.CUSTOMERS, forged.filter(c => c.id !== 'p2'))).ok === false, 'حذف رکورد ردشده از مسیر عمومی پذیرفته شد');
        const suppliersBank = (await S.ok(S.api.get(S.SUPPLIERS))).value;
        S.check((await S.api.set(S.SUPPLIERS, suppliersBank.slice(1))).ok === false, 'حذف تامین‌کنندهٔ کددار از مسیر عمومی پذیرفته شد');
        const after = (await S.ok(S.api.get(S.CUSTOMERS))).value;
        S.check(after.length === before.length, 'نویسندۀ ردشده، تعداد بانک را تغییر داد');
        await S.ok(S.api.auth.logout());
        return { customers: after.map(c => ({ id: c.id, code: c.customerCode, status: c.eligibility.status, active: c.active !== false })),
          suppliers: suppliersBank.map(s => s.supplierCode || 'بی‌کد'), pickerWhileInactive: parties.length };
      })()`);
      console.log(JSON.stringify({ smoke: 'party-cycle-real-ipc', pass: true, electron: process.versions.electron,
        abi: process.versions.modules, fixtureDir, customersWork, approvalThroughDialog, workListAfterApproval, orderForm, suppliers, marketerReport, guards, screenshots: shots }));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(error && error.stack || String(error)); clearTimeout(timeout); app.exit(1); }
  });
});
require('../electron/main.js');
