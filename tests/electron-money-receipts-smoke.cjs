'use strict';
/* اصلاحات ۱۷/بند ۲/۴: پروبِ دیدنیِ «رسید وصول‌شونده و تخصیص وجه» با الکترون، SQLite و IPCِ واقعی.
   سناریوی کارفرما: فاکتور ۵۰ میلیونی ← چک ۲۰ میلیونی (FIFO به همان فاکتور) ← وصول ← نقد ۵ میلیون
   ← چک ۱۰ میلیون و برگشتِ همان چک ← ابطالِ رسیدِ ۵ میلیونی با دلیل.
   دو چیز با همین پروب سنجیده می‌شود: (۱) عددِ پروندهٔ اعتباری با هر حرکتِ دفتر عوض می‌شود و
   چکِ وصول‌نشده مطالبه را کم می‌کند ولی نقدِ صندوق نه؛ (۲) ردیفِ پرداختِ سفارش فقط بازتاب است.
   فقط در پوشهٔ .work نوشته می‌شود؛ بانک زندهٔ کارفرما باز نمی‌شود. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
assert.ok(process.versions.electron, 'Electron runtime required');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-money-receipts-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
const timeout = setTimeout(() => { console.error('Money-receipts smoke timed out'); app.exit(1); }, 150000);

const PASS = 'money-receipts-isolated-password';
const PRELUDE = `
window.__S = {
  api: window.printshopApi,
  ORDERS: 'printshop_orders_v5',
  CUSTOMERS: 'printshop_customers_v2',
  PASS: '${PASS}',
  pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
  check(value, message) { if (!value) throw new Error(message); },
  grouped(value) { return Number(value || 0).toLocaleString('en-US'); },
  text(node) { return (node && node.textContent ? node.textContent : '').replace(/\\s+/g, ' ').trim(); },
  async ok(request) { const result = await request; window.__S.check(result && result.ok, (result && (result.error || result.code)) || 'operation failed'); return result; },
  async fails(request, code, message) {
    const result = await request;
    window.__S.check(result && result.ok === false, message + ' — پذیرفته شد: ' + JSON.stringify(result).slice(0, 200));
    if (code) window.__S.check(result.code === code, message + ' — کد ' + result.code + ' به‌جای ' + code + ': ' + result.error);
    return result;
  },
  async waitFor(select, label) {
    for (let i = 0; i < 320; i++) { const value = select(); if (value) return value; await window.__S.pause(50); }
    throw new Error('UI wait expired: ' + label + ' | body=' + window.__S.text(document.body).slice(0, 600));
  },
  enter(element, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  },
  button(scope, label) { const node = [...scope.querySelectorAll('button')].find(b => window.__S.text(b) === label); window.__S.check(node, 'Missing button ' + label); return node; },
  rowFor(scope, number) { return [...scope.querySelectorAll('tbody tr')].find(tr => window.__S.text(tr).includes(number)); },
  main: () => document.querySelector('main.workbench-content') || document.querySelector('main'),
  async openDesk(label) {
    const item = await window.__S.waitFor(() => [...document.querySelectorAll('.workbench-navitem')].find(n => n.getAttribute('aria-label') === label), 'desk ' + label);
    item.click(); await window.__S.pause(450);
  },
  /* کادرِ رسید در همان صفحهٔ سفارش است؛ هیچ مودالی باز نمی‌شود. */
  ledger() { const scope = [...document.querySelectorAll('section.document-panel')].find(s => window.__S.text(s).includes('دفتر رسید وجه'));
    if (scope) scope.scrollIntoView({ block: 'start' }); return scope; },
  async openLedger(orderNumber) {
    const S = window.__S;
    await S.openDesk('قیمت‌گذاری و دریافت');
    const search = await S.waitFor(() => document.querySelector('#finance-order-numbers') && document.querySelector('input[list="finance-order-numbers"]'), 'finance order search box');
    /* تطبیقِ رابط، رشته‌به‌رشته است؛ همان ارزشی را تایپ کن که خودِ رابط از بانک خوانده. */
    const listed = [...document.querySelectorAll('#finance-order-numbers option')].map(o => o.value);
    const typed = listed.find(v => String(v) === String(orderNumber)) || String(orderNumber);
    S.enter(search, typed);
    await S.pause(300);
    const mainText = S.text(S.main());
    S.check(!mainText.includes('سفارشی با این شماره یافت نشد'),
      'رابط سفارش ' + JSON.stringify(typed) + ' را پیدا نکرد | listed=' + JSON.stringify(listed) + ' | main=' + mainText.slice(0, 500));
    await S.waitFor(() => S.ledger(), 'inline money receipt panel');
    S.button(S.main(), 'دریافت‌ها').click();
    await S.pause(250);
    return S.waitFor(() => window.__S.ledger() && window.__S.ledger().querySelector('input[name="amount"]'), 'receipt form');
  },
  field(name) { const node = window.__S.ledger().querySelector('[name="' + name + '"]'); window.__S.check(node, 'Missing field ' + name); return node; },
  /* جدولِ «رسیدهای این مشتری» زیرِ تاشو است؛ برای عکسِ تایید بالا می‌آید. */
  async receiptsIntoView() {
    const S = window.__S;
    const heading = [...S.ledger().querySelectorAll('strong')].find(n => S.text(n).startsWith('رسیدهای این مشتری'));
    S.check(heading, 'جدول رسیدها در پنل نیست');
    heading.scrollIntoView({ block: 'start' }); await S.pause(200);
    return S.text(heading);
  },
  labelInput(text) { const label = [...window.__S.ledger().querySelectorAll('label')].find(l => window.__S.text(l).startsWith(text));
    window.__S.check(label, 'Missing label ' + text); const input = label.querySelector('input'); window.__S.check(input, 'No input under ' + text); return input; },
  /* اعدادِ دیدنیِ پنل + حقیقتِ سرور، در همان لحظه. */
  async numbers(customerId) {
    const S = window.__S;
    const ledger = await S.ok(S.api.receipts({ customerId }));
    const file = (await S.ok(S.api.customerCreditFile({ customerId }))).file;
    const dom = S.text(S.ledger());
    return { gross: ledger.totals.gross, allocated: ledger.totals.allocated, advance: ledger.totals.advance,
      pendingCheque: ledger.totals.pendingCheque, cleared: ledger.totals.cleared,
      definiteDebt: file.definiteDebt, commitment: file.commitment, available: file.available,
      receipts: ledger.receipts.map(r => [r.number, r.method, r.amount, r.status]),
      domShowsGross: dom.includes(S.grouped(ledger.totals.gross)), domShowsPending: dom.includes(S.grouped(ledger.totals.pendingCheque)),
      domShowsDebt: dom.includes(S.grouped(file.definiteDebt)),
      /* دو خانهٔ جدا، همان‌طور که کارفرما تصمیم گرفت: چکِ در دست هرگز با نقدِ صندوق جمع نمی‌شود. */
      domHasPendingCard: dom.includes('چک در دست وصول'), domHasCashCard: dom.includes('نقدِ صندوق') };
  },
}; 'money-prelude-ready';`;

app.on('browser-window-created', (_event, win) => {
  win.show(); win.focus();
  win.setBounds({ x: 0, y: 0, width: 1600, height: 1000 });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error('renderer console: ' + message); });
  win.webContents.once('did-finish-load', async () => {
    const shots = [];
    const capture = async name => { const file = path.join(workDir, name); fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); shots.push(file); };
    const run = async source => {
      const marker = source.replace(/\s+/g, ' ').slice(0, 70);
      const result = await win.webContents.executeJavaScript(`(async () => { try { return await (${source}); } catch (error) { return { __smokeError: String((error && error.stack) || error) }; } })()`, true);
      if (result && result.__smokeError) throw new Error(result.__smokeError + '\n  in phase: ' + marker);
      return result;
    };
    try {
      await win.webContents.executeJavaScript(PRELUDE, true);
      /* ۱) بانکِ معلوم: مشتریِ تأییدشده با سقف ۱۰۰ میلیون، سفارشی که پیش‌فاکتورِ ۵۰ میلیونی‌اش
         تأیید شده و فاکتورش صادر شده است. مبلغ با «تخفیف» به ۵۰ میلیون دقیق می‌رسد تا
         مثالِ کارفرما رقم‌به‌رقم دیده شود. */
      const seed = await run(`(async () => {
        const S = window.__S;
        S.check(S.api.secure === true, 'پروب باید در حالتِ پایگاه دادهٔ امن اجرا شود');
        await S.ok(S.api.auth.login('admin', '1234'));
        await S.ok(S.api.auth.setOwnPassword(S.PASS));
        const users = (await S.ok(S.api.auth.listUsers())).users;
        await S.ok(S.api.auth.saveUsers([...users, { id: 'clerk', name: 'کارشناس سفارشات آزمون', username: 'clerk', role: 'کارشناس سفارشات', active: true, _plain: S.PASS }]));
        await S.ok(S.api.set(S.CUSTOMERS, [
          { id: 'c1', name: 'کتاب نور', entityType: 'حقیقی', phone: '09120000001', address: '', customerCode: '', creditLimit: 100000000, paymentTermDays: 30, eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, createdAt: 1 },
        ]));
        await S.ok(S.api.partyAction('customer', 'c1', 'approve', { reason: 'مدارک ثبتی کامل است' }));
        const coded = await S.ok(S.api.partyAction('customer', 'c1', 'issue_number'));
        const item = { id: 'i1', productName: 'کتاب مثال', productType: 'کتاب', qty: '1000', qtyUnit: 'نسخه', unitPrice: '1000', designPrice: '', hasDesign: false, designDescription: '',
          stage: 'ثبت سفارش', papers: [], lithoMaterials: [], bindingMaterials: [], services: [], coverEnabled: false };
        await S.ok(S.api.set(S.ORDERS, [{
          id: 'o1', orderNumber: '3001', date: '2026-10-05', deliveryDate: '2026-10-30', title: 'کتاب مثال بند ۲', description: '',
          customerId: 'c1', customerCode: coded.party.customerCode, customerName: 'کتاب نور', phone: '', mobile: '', status: 'در انتظار تایید', quoteRev: 1,
          vatPercent: '', discount: '', items: [item], payments: [], history: [], source: 'میز کار', intent: 'proforma', onHold: false, holdReason: '',
          procurement: null, smartText: '', archive: null, marketerCode: '', createdAt: 1, delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' },
        }]));
        const quote = { materials: [{ id: 'm1', description: 'کاغذ تحریر ۷۰ گرم', unit: 'بند', qty: 10, rate: 6000000 }],
          services: [{ id: 's1', description: 'چاپ افست متن', unit: 'نوبت', offset: { plates: 2, run: 1000, ratePerBlock: 6000000 } }],
          offers: [], serviceMarkupPercent: 10, taxPercent: 0, discount: 0 };
        const first = await S.ok(S.api.orderAction('o1', 'save_quote', { expectedRevision: 1, input: quote }));
        const rawTotal = first.order.pricing.result.total;
        const discount = rawTotal - 50000000;
        S.check(discount > 0, 'مبلغ پایه باید بیشتر از ۵۰ میلیون باشد تا با تخفیف به مثال برسد: ' + rawTotal);
        const second = await S.ok(S.api.orderAction('o1', 'save_quote', { expectedRevision: first.order.pricing.revision, input: { ...quote, discount } }));
        S.check(second.order.pricing.result.total === 50000000, 'بدهی مثال باید ۵۰,۰۰۰,۰۰۰ شود، شد: ' + second.order.pricing.result.total);
        await S.ok(S.api.documentAction('o1', 'issue_quote', {}));
        /* «شمارهٔ سفارش» را سرور در لحظهٔ تأیید مشتری صادر می‌کند؛ پیش از آن رکورد بی‌شماره است. */
        const confirmed = await S.ok(S.api.orderAction('o1', 'confirm_customer', { evidence: 'تأیید تلفنی مشتری روی نسخهٔ فعلی پیش‌فاکتور' }));
        S.check(!!confirmed.orderNumber, 'سرور شمارهٔ سفارش را صادر نکرد');
        const invoice = await S.ok(S.api.documentAction('o1', 'issue_invoice', {}));
        const numbers = await S.numbers('c1');
        await S.ok(S.api.auth.logout());
        return { orderNumber: String(confirmed.orderNumber || ''), invoiceNumber: invoice.document.number, rawTotal, discount, start: numbers };
      })()`);
      assert.equal(seed.start.definiteDebt, 50000000, 'بدهیِ آغازین = فاکتورِ صادرشده');
      assert.equal(seed.start.receipts.length, 0, 'دفتر از صفر شروع می‌شود');
      assert.equal(seed.start.available, 50000000, 'سقف ۱۰۰ منهای بدهی ۵۰');
      /* ۲) ورودِ مدیر از راه رابط و بازِ کردنِ همان کادرِ درون‌خطی. */
      await run(`(async () => {
        const S = window.__S;
        window.confirm = () => true;
        const password = await S.waitFor(() => document.querySelector('input[type="password"]'), 'login screen');
        S.enter([...document.querySelectorAll('input')].find(i => i.type !== 'password'), 'admin');
        S.enter(password, S.PASS); await S.pause(120);
        S.button(document, 'ورود').click();
        await S.waitFor(() => document.querySelector('.workbench-shell'), 'workbench shell');
        await S.openLedger(${JSON.stringify(seed.orderNumber)});
        return true;
      })()`);
      await capture('money-receipts-1-empty-ledger.png');
      /* ۳) چک ۲۰ میلیونی: فیلدهای چک فقط با روشِ چک باز می‌شوند و پیشنهادِ تخصیص را سرور می‌دهد. */
      const chequeTyped = await run(`(async () => {
        const S = window.__S;
        S.enter(S.field('amount'), '۲۰٬۰۰۰٬۰۰۰');
        S.check(S.field('amount').value === '20000000', 'ارقامِ فارسی یکسان نشد: ' + S.field('amount').value);
        S.enter(S.field('method'), 'چک');
        S.enter(S.field('chequeNumber'), '۷۷');
        S.enter(S.labelInput('بانک'), 'ملی');
        S.enter(S.labelInput('شعبه'), 'چراغ');
        S.enter(S.labelInput('سررسید چک'), '۱۴۰۵/۰۹/۲۰');
        await S.pause(700);
        const body = S.text(S.ledger());
        return { showsProposal: body.includes(S.grouped(20000000)), chequeFieldsOpen: !!S.ledger().querySelector('[name="chequeDue"]') || body.includes('سررسید چک'),
          autoModeHeader: body.includes('پیشنهاد سرور (ریال)') };
      })()`);
      await capture('money-receipts-2-cheque-proposal.png');
      assert.equal(chequeTyped.showsProposal, true, 'پیشنهادِ تخصیصِ ۲۰ میلیونیِ سرور در جدول دیده نشد');
      assert.equal(chequeTyped.autoModeHeader, true, 'سرستون حالتِ خودکار عوض شده است');
      const afterCheque = await run(`(async () => {
        const S = window.__S;
        S.button(S.ledger(), 'ثبت رسید و تخصیص').click();
        await S.waitFor(() => S.text(S.ledger()).includes('ثبت شد'), 'receipt success message');
        const numbers = await S.numbers('c1');
        const orders = (await S.ok(S.api.get(S.ORDERS))).value;
        return { ...numbers, mirror: orders.find(o => o.id === 'o1').payments, body: S.text(S.ledger()).slice(0, 400) };
      })()`);
      await capture('money-receipts-3-cheque-held.png');
      assert.deepEqual(afterCheque.receipts, [['9001', 'چک', 20000000, 'held']], 'چکِ تازه‌گرفته‌شده «در دست» است');
      assert.equal(afterCheque.pendingCheque, 20000000, 'خانهٔ چکِ در دست');
      assert.equal(afterCheque.cleared, 0, 'تصمیم کارفرما: چکِ وصول‌نشده نقدِ صندوق نیست');
      assert.equal(afterCheque.definiteDebt, 30000000, 'مطالبه کم شده: ۵۰ − ۲۰');
      assert.equal(afterCheque.available, 70000000, 'اعتبار آزاد هم همان‌قدر بالا آمد');
      assert.equal(afterCheque.mirror.length, 1, 'ردیف پرداختِ سفارش از دفتر ساخته شد');
      assert.equal(afterCheque.mirror[0].receiptNumber, '9001', 'بازتاب شمارهٔ رسید را می‌آورد');
      assert.equal(afterCheque.mirror[0].statusLabel, 'در دست');
      assert.equal(afterCheque.domHasPendingCard, true, 'خانهٔ «چک در دست وصول» در پنل نیست');
      assert.equal(afterCheque.domHasCashCard, true, 'خانهٔ «نقدِ صندوق» در پنل نیست');
      /* domShowsDebt اینجا فقط گزارش می‌شود: ۳۰,۰۰۰,۰۰۰ رقمِ ردیفِ «مانده» است که سرور در
         ledger.lines می‌فرستد، نه جمعِ بدهی‌ای که رابط ساخته باشد. */
      /* ۴) وصولِ قطعی: «چک در دست» به «نقدِ صندوق» می‌رود و بدهی تکان نمی‌خورد. */
      const cleared = await run(`(async () => {
        const S = window.__S;
        const row = S.rowFor(S.ledger(), '9001');
        S.check(row, 'ردیف رسید ۹۰۰۱ در جدول نیست');
        S.button(row, 'وصول‌شده').click();
        await S.waitFor(() => S.text(S.ledger()).includes('رسید 9001 — وصول‌شده'), 'clearance message');
        const numbers = await S.numbers('c1');
        return { ...numbers, mirrorLabel: (await S.ok(S.api.get(S.ORDERS))).value.find(o => o.id === 'o1').payments[0].statusLabel };
      })()`);
      await capture('money-receipts-4-cheque-cleared.png');
      assert.deepEqual(cleared.receipts, [['9001', 'چک', 20000000, 'cleared']]);
      assert.equal(cleared.pendingCheque, 0); assert.equal(cleared.cleared, 20000000);
      assert.equal(cleared.definiteDebt, 30000000, 'وصولِ قطعی عددِ مطالبه را عوض نمی‌کند، فقط صندوق را');
      assert.equal(cleared.mirrorLabel, 'وصول‌شده');
      assert.equal(cleared.domShowsGross, true, 'جمعِ سرور در صفحه دیده می‌شود');
      /* ۵) نقد ۵ میلیون (FIFOِ خودکار) و چک ۱۰ میلیون که برمی‌گردد. */
      const cash = await run(`(async () => {
        const S = window.__S;
        S.enter(S.field('amount'), '5000000');
        await S.pause(700);
        S.button(S.ledger(), 'ثبت رسید و تخصیص').click();
        await S.waitFor(() => S.text(S.ledger()).includes('رسید 9002 ثبت شد'), 'second receipt');
        return S.numbers('c1');
      })()`);
      assert.deepEqual(cash.receipts.map(r => r[3]), ['cleared', 'cleared']);
      assert.equal(cash.allocated, 25000000, '۲۰ + ۵ هر دو به همان فاکتور');
      assert.equal(cash.advance, 0, 'چیزی به پیش‌پرداخت نرسید چون مانده بود');
      assert.equal(cash.definiteDebt, 25000000);
      const bounced = await run(`(async () => {
        const S = window.__S;
        S.enter(S.field('method'), 'چک');
        S.enter(S.field('amount'), '10000000');
        S.enter(S.field('chequeNumber'), '۸۸');
        S.enter(S.labelInput('سررسید چک'), '۱۴۰۵/۱۰/۰۵');
        await S.pause(700);
        S.button(S.ledger(), 'ثبت رسید و تخصیص').click();
        await S.waitFor(() => S.text(S.ledger()).includes('رسید 9003 ثبت شد'), 'third receipt');
        const held = await S.numbers('c1');
        const row = S.rowFor(S.ledger(), '9003');
        S.button(row, 'برگشتی').click();
        await S.waitFor(() => S.text(S.ledger()).includes('رسید 9003 — برگشتی'), 'bounce message');
        const after = await S.numbers('c1');
        const mirror = (await S.ok(S.api.get(S.ORDERS))).value.find(o => o.id === 'o1').payments;
        return { held, after, mirrorNumbers: mirror.map(p => p.receiptNumber) };
      })()`);
      await capture('money-receipts-5-cheque-bounced.png');
      assert.equal(bounced.held.definiteDebt, 15000000, 'چکِ در دستِ دوم هم مطالبه را کم می‌کند');
      assert.equal(bounced.after.definiteDebt, 25000000, 'برگشتی بدهی را برمی‌گرداند');
      assert.equal(bounced.after.pendingCheque, 0);
      assert.deepEqual(bounced.mirrorNumbers, ['9001', '9002'], 'ردیفِ برگشتی از بازتاب بیرون می‌رود — دید: ' + JSON.stringify(bounced.mirrorNumbers)
        + ' | رسیدها: ' + JSON.stringify(bounced.after.receipts) + ' | بدهی: ' + bounced.after.definiteDebt);
      /* ۶) ابطالِ رسیدِ ۵ میلیونی: دلیلِ کوتاه خاموش، دلیلِ کافی بدهی را برمی‌گرداند. */
      const voided = await run(`(async () => {
        const S = window.__S;
        const row = S.rowFor(S.ledger(), '9002');
        S.button(row, 'ابطال').click();
        await S.pause(120);
        const reason = S.field('void-reason');
        S.enter(reason, 'کوتاه');
        const disabledWhileShort = S.button(S.ledger(), 'ثبت ابطال').disabled === true;
        S.enter(reason, 'چک در بانک چاپ نشده بود و سند اشتباه است');
        await S.pause(120);
        const enabledAfterReason = S.button(S.ledger(), 'ثبت ابطال').disabled === false;
        S.button(S.ledger(), 'ثبت ابطال').click();
        await S.waitFor(() => S.text(S.ledger()).includes('رسید 9002 باطل شد'), 'void message');
        const numbers = await S.numbers('c1');
        const mirror = (await S.ok(S.api.get(S.ORDERS))).value.find(o => o.id === 'o1').payments;
        return { disabledWhileShort, enabledAfterReason, ...numbers, mirrorNumbers: mirror.map(p => p.receiptNumber) };
      })()`);
      await capture('money-receipts-6-receipt-voided.png');
      const tableHeading = await run(`(async () => await window.__S.receiptsIntoView())()`);
      await capture('money-receipts-7-receipts-table.png');
      assert.equal(voided.disabledWhileShort, true, 'دلیلِ ۱۱ نویسه‌ای دکمه را باز کرد');
      assert.equal(voided.enabledAfterReason, true, 'با دلیلِ کافی دکمه باز نشد');
      assert.equal(voided.receipts.find(r => r[0] === '9002')[3], 'void', 'سندِ باطل در بانک می‌ماند');
      assert.equal(voided.gross, 20000000, 'جمعِ زنده فقط چکِ وصول‌شده است');
      assert.equal(voided.definiteDebt, 30000000, 'بدهی به پرونده برگشت');
      assert.deepEqual(voided.mirrorNumbers, ['9001'], 'بازتاب هم رسیدِ باطل را نمی‌شمارد');
      /* ۷) کنترل‌های منفی از راهِ سیم: بازتابِ نوشتنی نیست و دفترِ رسید فقط مدیر و مدیر مالی است. */
      const guards = await run(`(async () => {
        const S = window.__S;
        const rows = (await S.ok(S.api.get(S.ORDERS))).value;
        const forged = structuredClone(rows);
        forged.find(o => o.id === 'o1').payments = [{ id: 'injected', amount: 99000000, date: '2026-11-03', method: 'نقد' }];
        const writeAttempt = await S.fails(S.api.set(S.ORDERS, forged), 'FORBIDDEN', 'ردیف پرداخت از راهِ سفارش نوشته شد');
        const untouched = (await S.ok(S.api.get(S.ORDERS))).value.find(o => o.id === 'o1').payments;
        const next = (await S.ok(S.api.numberingSettings())).settings.moneyreceipt.next;
        const clerk = await S.ok(S.api.auth.login('clerk', S.PASS));
        const deniedLedger = await S.fails(S.api.receipts({ customerId: 'c1' }), 'FORBIDDEN', 'کارشناس سفارشات دفتر رسید را خواند');
        const deniedWrite = await S.fails(S.api.recordReceipt({ customerId: 'c1', method: 'نقد', amount: 1000000, receivedAt: '2026-11-03' }), 'FORBIDDEN', 'کارشناس سفارشات رسید ثبت کرد');
        const clerkOrders = (await S.ok(S.api.get(S.ORDERS))).value.find(o => o.id === 'o1');
        await S.ok(S.api.auth.logout());
        return { deniedMessage: writeAttempt.error.slice(0, 60), mirrorStill: untouched.map(p => p.receiptNumber),
          clerkSeesPayments: clerkOrders.payments, deniedLedgerCode: deniedLedger.code, deniedWriteCode: deniedWrite.code,
          clerkSession: clerk.user.role, moneyCounterAfter: next };
      })()`);
      assert.deepEqual(guards.mirrorStill, ['9001'], 'کوششِ جعل، بازتاب را عوض نکرد');
      assert.deepEqual(guards.clerkSeesPayments, [], 'رقمِ وصولی به نقشِ بی‌رقم رسید');
      assert.equal(guards.moneyCounterAfter, 9004, 'سه رسید، سه شماره و چیزی نسوخت');
      console.log(JSON.stringify({ smoke: 'money-receipts-real-ipc', pass: true, electron: process.versions.electron,
        abi: process.versions.modules, fixtureDir, tableHeading, seed, chequeTyped, afterCheque, cleared, cash, bounced, voided, guards, screenshots: shots }));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(error && error.stack || String(error)); clearTimeout(timeout); app.exit(1); }
  });
});
require('../electron/main.js');
