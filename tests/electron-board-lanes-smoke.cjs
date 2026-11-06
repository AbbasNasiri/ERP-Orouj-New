'use strict';
/* اصلاحات ۱۴/۵ و ۶ روی رابط واقعی: تابلوی تولید دو کادر مسیر (افست/دیجیتال) + کادر معلقِ سه‌دليله
   + کادر مشترک کنترل کیفیت و تحویل + فیلتر «صفِ من» سنجیده می‌شود.
   اقلامِ در تولید با عملیات واقعیِ سرور (تأیید مشتری ← اجازهٔ تولید ← ارجاع مرحله) جلو می‌روند و
   سفارش تحویل‌شده چرخهٔ کامل «اتمام مرحله» را طی می‌کند. فقط دو حالت از بیرون روی بانک نوشته می‌شود،
   همان‌طور که در آزمون‌های node مرسوم است: رکورد سند پیش‌فاکتور (صدور سند کل فرم قیمت‌گذاری را می‌خواهد)
   و مرحلهٔ قلمِ قدیمی (تغییر مرحله از مسیر عام ممنوع است و این دقیقاً همان حالتِ مهاجرت‌نشده است).
   کنترل منفی: انباردار تابلو و هر سه دلیل را می‌خواند ولی هیچ عملیاتی ندارد؛ «صفِ من» فقط
   قلم‌هایی را نگه می‌دارد که نوبت اتمام مرحلهٔشان به همان نقش است و کادر معلق را دست نمی‌زند. */
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const workDir = path.resolve(__dirname, '../../.work');
fs.mkdirSync(workDir, { recursive: true });
const fixtureDir = fs.mkdtempSync(path.join(workDir, 'electron-board-lanes-'));
const userData = path.join(fixtureDir, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
process.env.PORTABLE_EXECUTABLE_DIR = fixtureDir;
process.env.PRINTSHOP_UI_QA = '1';
const timeout = setTimeout(() => { console.error('Board lanes smoke timed out'); app.exit(1); }, 540000);

const ADMIN_PASS = 'lanes-smoke-admin';
const STAFF_PASS = 'lanes-smoke-staff';
const STATIONS = [
  ['clerk', 'کارشناس سفارشات'],
  ['litho', 'سرپرست لیتوگرافی'],
  ['digital', 'سرپرست چاپ دیجیتال'],
  ['press', 'سرپرست چاپ'],
  ['binder', 'سرپرست صحافی'],
  ['finance', 'مدیر مالی'],
  ['store', 'انباردار'],
];
const FINAL = 'کنترل کیفیت و تحویل به مشتری';
const OFFSET_STAGES = ['ثبت سفارش', 'طراحی و پروف', 'لیتوگرافی و زینک', 'چاپ افست', 'صحافی و تکمیلی', FINAL];
const DIGITAL_STAGES = ['ثبت سفارش', 'طراحی و پروف', 'چاپ دیجیتال', 'برش و تکمیلی', FINAL];

/* ================= page-side code (runs inside the renderer) ================= */
function pageHelpers() {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const text = node => (node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
  async function ok(request) { const result = await request; check(result && result.ok, (result && result.error) || 'Request failed'); return result; }
  async function waitFor(select, label) {
    for (let i = 0; i < 300; i++) { const value = select(); if (value) return value; await pause(50); }
    throw new Error('UI wait expired: ' + label + ' | body=' + text(document.body).slice(0, 1500));
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
    /* پس از بارگذاری دوباره توکنی در حافظه نیست؛ خروج بی‌توکن خطای معمولی است، نه شکست آزمون. */
    try { await window.printshopApi.auth.logout(); } catch (e) { /* بی‌توکن */ }
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
    item.click(); await pause(700);
    return item;
  }
  /* هر کادر = div با سه فرزند: [نوار عنوان, راهنما, شبکهٔ ستون‌ها]؛ هر ستون = [هدر, بدنه]. */
  function laneGrid(titleStart) {
    const lane = [...main().querySelectorAll('div')].find(d => d.children.length === 3 && text(d.firstElementChild).startsWith(titleStart));
    if (!lane) return null;
    return {
      title: text(lane.firstElementChild),
      legend: text(lane.children[1]),
      columns: [...lane.children[2].children].map(col => {
        const name = text(col.children[0].firstElementChild).replace(/^\d+/, '');
        /* نشانهٔ شمارش، فرزندِ اولِ span دومِ هدر است (نه شمارهٔ قدم که در span اول است). */
        const badge = text((col.children[0].children[1] || {}).firstElementChild || {});
        const m = badge.match(/^(\d+)(?:\s*\+\s*(\d+))?$/);
        const bodyCards = [...col.children[1].children].filter(n => text(n) !== 'خالی' && text(n) !== 'تمام‌شده — فقط گزارش');
        return { header: name, width: Math.round(col.getBoundingClientRect().width), badge: badge || '—', cards: m ? Number(m[1]) : null, done: m && m[2] ? Number(m[2]) : 0,
          domCards: bodyCards.filter(n => !text(n).includes('تمام‌شده')).length, domDone: bodyCards.filter(n => text(n).includes('تمام‌شده')).length,
          body: text(col.children[1]) };
      }),
    };
  }
  async function boardProbe() {
    await openDesk('تابلوی تولید');
    await waitFor(() => text(main()).includes('قلم در تولید'), 'the two-lane board');
    const scope = main();
    const btn = name => [...scope.querySelectorAll('button')].filter(b => text(b) === name).length;
    return {
      lanes: { hold: laneGrid('معلق'), offset: laneGrid('کادر چاپ افست'), digital: laneGrid('کادر چاپ دیجیتال'), legacy: laneGrid('مسیر قدیمی'), final: laneGrid('کادر مشترک') },
      deliveredBlock: [...scope.querySelectorAll('div')].map(d => text(d)).find(t => /^تحویل شده —/.test(t)) || '',
      boardText: text(scope).slice(0, 6000),
      laneNames: ['کادر چاپ افست', 'کادر چاپ دیجیتال', 'کادر مشترک کنترل کیفیت و تحویل به مشتری', 'مسیر قدیمی'].filter(name => text(scope).includes(name)),
      draggableCards: scope.querySelectorAll('[draggable="true"]').length,
      operationButtons: btn('اتمام و تایید نهایی') + btn('ثبت تحویل به مشتری') + scope.querySelectorAll('button[title*="عبور مدیر"]').length,
      viewButtons: btn('جزئیات') + btn('جزئیات و ثبت تأیید'),
      pathChips: { afs: [...scope.querySelectorAll('span')].filter(s => text(s) === 'افست').length, dig: [...scope.querySelectorAll('span')].filter(s => text(s) === 'دیجیتال').length, old: [...scope.querySelectorAll('span')].filter(s => text(s) === 'قدیمی').length },
    };
  }
  async function setMyQueue(on) {
    const box = [...main().querySelectorAll('input[type="checkbox"]')].find(i => text(i.parentElement).includes('صفِ من'));
    check(box, 'the «صفِ من» filter is missing');
    if (box.checked !== on) { box.click(); await pause(600); }
    return box.checked;
  }
  const queueLabel = () => text([...main().querySelectorAll('label')].find(l => text(l).includes('صفِ من')));
  const column = (lane, header) => (lane ? lane.columns.find(c => c.header === header) : null) || { header, badge: '—', cards: null, done: null, domCards: null, domDone: null, body: '' };
  return { pause, check, text, ok, enter, byText, main, waitFor, login, openDesk, laneGrid, column, boardProbe, setMyQueue, queueLabel };
}

/* ================= seeding (runs inside the renderer, through the real server) ================= */
async function seedOrders(adminPass, staffPass, roles) {
  /* تابع‌های صفحه序列化 می‌شوند؛ به همان دلیل هیچ ثابتِ بیرونی اینجا خوانده نمی‌شود. */
  const END = 'کنترل کیفیت و تحویل به مشتری';
  const OFFSET_WALK = ['ثبت سفارش', 'طراحی و پروف', 'لیتوگرافی و زینک', 'چاپ افست', 'صحافی و تکمیلی'];
  const h = window.psHelpers();
  await h.ok(window.printshopApi.auth.login('admin', '1234'));
  await h.ok(window.printshopApi.auth.setOwnPassword(adminPass));
  const users = (await h.ok(window.printshopApi.auth.listUsers())).users;
  for (const [id, role] of roles) users.push({ id, name: role, username: id, role, _plain: staffPass });
  await h.ok(window.printshopApi.auth.saveUsers(users));
  await h.ok(window.printshopApi.set('printshop_customers_v2', [
    { id: 'c1', name: 'مشتری آزمون تابلو', entityType: 'حقوقی', phone: '09121110002', mobile: '09121110002', address: '', customerCode: '', eligibility: { status: 'pending', reviewedBy: null, reviewedAt: null, reason: '' }, marketerId: '', createdAt: 1 },
  ]));

  const item = (id, name, method) => ({ id, productName: name, productType: 'کتاب', qty: '1000', qtyUnit: 'نسخه', unitPrice: '', designPrice: '', hasDesign: false,
    stage: 'ثبت سفارش', papers: [], lithoMaterials: [], bindingMaterials: [], services: [], coverEnabled: false, spec: { printMethod: method } });
  const order = (id, method, names, deliveryDate) => ({
    id, orderNumber: id, date: '2026-10-01', deliveryDate, title: 'تابلو ' + id, description: '',
    customerId: 'c1', customerCode: '', customerName: 'مشتری آزمون تابلو', phone: '09121110002', mobile: '', status: 'در انتظار تایید',
    quoteRev: 1, vatPercent: '', discount: '', items: names.map((name, i) => item(id + '-i' + (i + 1), name, method)),
    payments: [], history: [], source: 'دفتر', intent: 'proforma', onHold: false, holdReason: '', procurement: null, smartText: '', archive: null, marketerCode: '', createdAt: 1,
    delivery: { method: 'تحویل حضوری در چاپخانه', address: '', receiver: '', phone: '' }, shippingCost: '', otherCost: '', otherLabel: '',
  });
  const mixed = order('live-mix', 'افست', ['متن افست مخلوط', 'جلد دیجیتال مخلوط'], '2026-11-12');
  mixed.items[1].spec.printMethod = 'دیجیتال';   // یک سفارشِ مخلوط، هر دو کادر را هم‌زمان پر می‌کند
  const seed = [
    order('hold-fin-ofs', 'افست', ['کتاب افست معلق'], '2026-11-20'),
    order('hold-fin-dig', 'دیجیتال', ['جزوه دیجیتال معلق'], '2026-11-25'),
    order('hold-ord-1ofs', 'افست', ['بروشور منتظر تأیید مشتری'], '2026-11-18'),
    order('hold-ord-2dig', 'دیجیتال', ['کاتالوگ منتظر ارجاع'], '2026-11-15'),
    order('hold-mgr-leg', 'افست', ['تقویم قدیمی منتظر مدیر'], '2026-10-20'),
    order('live-ofs', 'افست', ['کتاب افست در چاپ'], '2026-11-10'),
    order('live-dig', 'دیجیتال', ['جزوه دیجیتال در چاپ'], '2026-11-08'),
    mixed,
    order('live-final', 'دیجیتال', ['پوستر دیجیتال آماده تحویل'], '2026-11-05'),
    order('live-leg', 'افست', ['سربرگ قدیمی در چاپ'], '2026-10-28'),
    order('done-order', 'افست', ['کتاب تحویل‌شده'], '2026-11-01'),
  ];
  await h.ok(window.printshopApi.set('printshop_orders_v5', seed));
  const read = async () => (await h.ok(window.printshopApi.get('printshop_orders_v5'))).value;
  const numberById = Object.fromEntries((await read()).map(o => [o.id, String(o.orderNumber)]));

  await h.ok(window.printshopApi.orderAction('hold-ord-2dig', 'confirm_customer', { evidence: 'تأیید تلفنی، قلم هنوز ارجاع نشده است' }));
  for (const id of ['hold-mgr-leg', 'live-ofs', 'live-dig', 'live-mix', 'live-final', 'live-leg', 'done-order']) {
    await h.ok(window.printshopApi.orderAction(id, 'confirm_customer', { evidence: 'تأیید مشتری آزمون تابلو' }));
  }
  for (const id of ['live-ofs', 'live-dig', 'live-mix', 'live-final', 'live-leg', 'done-order']) {
    await h.ok(window.printshopApi.orderAction(id, 'release_production', { materialReview: { checked: true, shortages: [] } }));
  }
  const move = (id, itemId, newStage) => h.ok(window.printshopApi.orderAction(id, 'change_stage', { itemId, newStage, reason: 'آزمون تابلوی دو مسیره' }));
  await move('live-ofs', 'live-ofs-i1', 'چاپ افست');
  await move('live-dig', 'live-dig-i1', 'چاپ دیجیتال');
  await move('live-mix', 'live-mix-i1', 'صحافی و تکمیلی');
  await move('live-mix', 'live-mix-i2', 'برش و تکمیلی');
  await move('live-final', 'live-final-i1', END);

  // چرخهٔ واقعیِ اتمام مرحله تا تحویل، قلم به قلم، در همان مسیر افست (تحویل = اتمام کادر مشترک).
  for (const it of (await read()).find(o => o.id === 'done-order').items) {
    for (const stage of [...OFFSET_WALK, END]) {
      await h.ok(window.printshopApi.orderAction('done-order', 'complete_stage', { itemId: it.id, stage, note: 'آزمون تحویل تابلو' }));
    }
  }
  await h.pause(250);
  const saved = await read();
  const of = id => saved.find(o => o.id === id);
  return {
    numberById,
    stages: { ofs: of('live-ofs').items[0].stage, dig: of('live-dig').items[0].stage, mix: of('live-mix').items.map(i => i.stage), fin: of('live-final').items[0].stage },
    doneStatus: of('done-order').status, doneDeliveredAt: of('done-order').deliveredAt || '',
    holdConfirmed: !!of('hold-ord-2dig').workflow.customerConfirmation,
  };
}

/* شمارشِ همان ستون‌هایی که کاربر می‌بیند (تراز badge با شمارشِ DOM هم سنجیده می‌شود). */
async function measure() {
  const h = window.psHelpers();
  const board = await h.boardProbe();
  const col = (lane, name) => h.column(lane, name);
  return {
    board,
    hold: { manager: col(board.lanes.hold, 'عدم تأیید مدیر'), order: col(board.lanes.hold, 'عدم تأیید سفارش'), finance: col(board.lanes.hold, 'عدم تأیید مالی') },
    offset: { litho: col(board.lanes.offset, 'لیتوگرافی و زینک'), press: col(board.lanes.offset, 'چاپ افست'), binding: col(board.lanes.offset, 'صحافی و تکمیلی'), design: col(board.lanes.offset, 'طراحی و پروف') },
    digital: { press: col(board.lanes.digital, 'چاپ دیجیتال'), cutting: col(board.lanes.digital, 'برش و تکمیلی'), design: col(board.lanes.digital, 'طراحی و پروف') },
    legacy: board.lanes.legacy ? board.lanes.legacy.columns.map(c => ({ header: c.header, cards: c.cards })) : [],
    final: col(board.lanes.final, 'کنترل کیفیت و تحویل به مشتری'),
  };
}

/* ================= main-process driver ================= */
const inject = (fn, ...args) => `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;

async function capture(win, file) {
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

/* سند پیش‌فاکتور و مرحلهٔ قلم قدیمی — همان دو حالتی که از مسیر عامِ کلاینت نوشته نمی‌شوند. */
function patchBank(dbFile, revisions) {
  const Database = require('better-sqlite3');
  const raw = new Database(dbFile);
  raw.pragma('busy_timeout = 5000');
  const addQuote = orderId => {
    const id = 'qa-' + orderId;
    raw.prepare('INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, 'quote', orderId, Number(revisions[orderId]) || 1, 'Q-' + orderId, 'issued', JSON.stringify({ id, type: 'quote', orderId, status: 'issued', number: 'Q-' + orderId }), Date.now());
  };
  /* مالیِ همان نسخه فقط پیش‌فاکتورِ همین سفارش است؛ سه سفارش معلقِ دیگر عمداً بدون سند می‌مانند. */
  for (const orderId of ['hold-ord-1ofs', 'hold-ord-2dig', 'hold-mgr-leg', 'live-ofs', 'live-dig', 'live-mix', 'live-final', 'live-leg', 'done-order']) addQuote(orderId);
  /* دو قلم قدیمی: پیش از این اصلاحات ارجاع شده‌اند، پس همان مسیر نه‌مرحله‌ای را ادامه می‌دهند. */
  for (const [orderId, stage] of [['hold-mgr-leg', 'چاپ'], ['live-leg', 'چاپ']]) {
    const row = raw.prepare('SELECT data FROM records WHERE collection = ? AND id = ?').get('printshop_orders_v5', orderId);
    const data = JSON.parse(row.data);
    data.items[0].stage = stage;
    raw.prepare('UPDATE records SET data = ? WHERE collection = ? AND id = ?').run(JSON.stringify(data), 'printshop_orders_v5', orderId);
  }
  const quotes = raw.prepare('SELECT count(1) c FROM financial_documents WHERE status = ? AND type = ?').get('issued', 'quote').c;
  raw.close();
  return { quotesIssued: quotes };
}

app.on('browser-window-created', (_event, win) => {
  let completed = false;
  win.on('close', event => { if (!completed) event.preventDefault(); });
  /* پنجره بلندتر از صفحه: شواهد باید هر پنج کادر تابلو را در یک تصویر نشان دهد، نه فقط بالای آن. */
  win.setBounds({ x: 0, y: 0, width: 1800, height: 2450 });
  win.webContents.once('did-fail-load', (_e, code, reason) => { fs.writeFileSync(path.join(workDir, 'board-lanes-error.txt'), `load ${code}: ${reason}`); app.exit(1); });
  win.webContents.on('render-process-gone', (_e, details) => { fs.writeFileSync(path.join(workDir, 'board-lanes-error.txt'), JSON.stringify(details)); app.exit(1); });
  win.webContents.once('did-finish-load', async () => {
    const exec = async (code, label) => {
      console.error('[lanes] ' + label);
      try { return await win.webContents.executeJavaScript(code); }
      catch (e) { throw new Error(label + ' -> ' + String((e && e.message) || e)); }
    };
    const reload = () => new Promise((resolve, reject) => {
      const done = () => { win.webContents.removeListener('did-fail-load', failed); resolve(); };
      const failed = (_e, code, reason) => { win.webContents.removeListener('did-finish-load', done); reject(new Error(`reload ${code}: ${reason}`)); };
      win.webContents.once('did-finish-load', done);
      win.webContents.once('did-fail-load', failed);
      win.webContents.reload();
    });
    const boot = () => exec(`window.psHelpers = ${pageHelpers.toString()}; window.confirm = () => true; window.alert = () => {}; 'helpers-installed';`, 'helper bootstrap');
    try {
      await boot();
      const seeded = await exec(inject(seedOrders, ADMIN_PASS, STAFF_PASS, STATIONS), 'seed through the server');
      const dbFile = path.join(fixtureDir, 'PrintShopData', 'printshop.db');
      if (!fs.existsSync(dbFile)) throw new Error('bank file not found: ' + dbFile);
      const revisions = await exec(inject(async () => Object.fromEntries((await window.psHelpers().ok(window.printshopApi.get('printshop_orders_v5'))).value.map(o => [o.id, o.quoteRev]))), 'read revisions');
      const patch = patchBank(dbFile, revisions);
      await reload();
      await boot();

      const results = { seeded, patch, manager: {}, digital: {}, store: {} };
      await exec(inject(async (u, p) => window.psHelpers().login(u, p), 'admin', ADMIN_PASS), 'login admin');
      results.manager = await exec(inject(measure), 'measure as manager');
      results.managerScreenshot = await capture(win, 'rev14-10-board-manager.png');

      const want = [
        ['معلق/مالی', results.manager.hold.finance, 2],
        ['معلق/سفارش', results.manager.hold.order, 2],
        ['معلق/مدیر', results.manager.hold.manager, 1],
        ['افست/طراحی و پروف', results.manager.offset.design, 0],
        ['افست/لیتوگرافی و زینک', results.manager.offset.litho, 0],
        ['افست/چاپ افست', results.manager.offset.press, 1],
        ['افست/صحافی و تکمیلی', results.manager.offset.binding, 1],
        ['دیجیتال/طراحی و پروف', results.manager.digital.design, 0],
        ['دیجیتال/چاپ دیجیتال', results.manager.digital.press, 1],
        ['دیجیتال/برش و تکمیلی', results.manager.digital.cutting, 1],
        ['مشترک/کنترل کیفیت و تحویل', results.manager.final, 1],
      ];
      const wrong = want.filter(([, c, n]) => c.cards !== n).map(([name, c, n]) => `${name}: تابلو=${c.badge} شمارش DOM=${c.domCards} انتظار=${n}`);
      if (wrong.length) throw new Error(wrong.join(' | '));
      const selfCheck = want.filter(([, c]) => c.domCards !== c.cards).map(([name, c]) => `${name}: badge=${c.cards} dom=${c.domCards}`);
      if (selfCheck.length) throw new Error('شمارشِ ستون با DOM هم‌خوان نیست — ' + selfCheck.join(' | '));
      /* عرضِ سنجیده‌شده: کادرِ تک‌ستونه (قدیمی/مشترک) نباید تا تمامِ عرضِ کشیده شود. */
      const wide = [];
      for (const [laneName, lane] of Object.entries(results.manager.board.lanes)) {
        for (const c of (lane ? lane.columns : [])) if (!(c.width > 0) || c.width > (laneName === 'hold' ? 440 : 340)) wide.push(`${laneName}/${c.header}=${c.width}px`);
      }
      if (wide.length) throw new Error('ستون‌های تابلو از سقفِ عرض بیرون زده‌اند: ' + wide.join('، '));
      if (!/دیجیتال/.test(results.manager.hold.order.body) && !/منتظر ارجاع/.test(results.manager.hold.order.body)) throw new Error('کادر معلق دلیل ارجاع را نشان نمی‌دهد: ' + results.manager.hold.order.body);
      if (!/ارجاع/.test(results.manager.hold.order.body)) throw new Error('عبارت «ارجاع نشده» در کادر عدم تأیید سفارش نیست: ' + results.manager.hold.order.body);
      /* شمارهٔ سفارش در لحظهٔ تأیید مشتری صادر می‌شود؛ ردیفِ بی‌شماره باید تاریخ ثبت را نشان دهد نه خط تیره. */
      if (!/تاریخ ثبت/.test(results.manager.hold.finance.body) || /سفارش —/.test(results.manager.hold.finance.body)) throw new Error('ردیف معلقِ بی‌شماره تاریخ ثبت را نشان نمی‌دهد: ' + results.manager.hold.finance.body.slice(0, 160));
      if (!/بی‌تحرک/.test(results.manager.hold.finance.body + results.manager.hold.order.body + results.manager.hold.manager.body)) throw new Error('هیچ ردیف معلق «روز بی‌تحرک» ندارد');
      if (!results.manager.legacy.length) throw new Error('کادر مسیر قدیمی پر نیست در حالی که قلم قدیمی در تولید است');
      if (!/مسیر قدیمی/.test(results.manager.board.boardText)) throw new Error('کادر مسیر قدیمی راهنمای تعیین‌تکلیف یک‌باره را ندارد');
      if (results.manager.board.lanes.hold.columns.length !== 3) throw new Error('کادر معلق سه ستونِ دلیل ندارد');
      if (!results.manager.board.deliveredBlock) throw new Error('کادر تحویل‌شده نیست');
      if (results.manager.board.operationButtons === 0) throw new Error('مدیر چاپخانه دکمهٔ اتمام مرحله روی تابلو ندارد');
      if (results.manager.board.draggableCards === 0) throw new Error('کارت‌های مدیر کشیدنی نیستند');
      if (results.manager.board.pathChips.dig === 0 || results.manager.board.pathChips.afs === 0 || results.manager.board.pathChips.old === 0) throw new Error('تراشهٔ مسیر روی کارت‌ها کامل نیست: ' + JSON.stringify(results.manager.board.pathChips));
      if (results.manager.offset.binding.domDone === 0) throw new Error('ردیف‌های تمام‌شدهٔ امروز در کادر افست دیده نمی‌شوند');

      /* «صفِ من»: سرپرست چاپ دیجیتال فقط قلم‌هایی را می‌بیند که نوبت اتمامشان با اوست
         (تابلو برای او فقط‌نمایشی است؛ دکمهٔ اتمام فقط برای مدیر چاپخانه است). */
      await exec(inject(async (u, p) => window.psHelpers().login(u, p), 'digital', STAFF_PASS), 'login digital supervisor');
      const before = await exec(inject(measure), 'measure before صفِ من');
      const checked = await exec(inject(async () => window.psHelpers().setMyQueue(true)), 'turn on صفِ من');
      const after = await exec(inject(measure), 'measure after صفِ من');
      results.digital = { checked, label: await exec(inject(() => window.psHelpers().queueLabel())), before, after };
      results.digitalScreenshot = await capture(win, 'rev14-11-board-digital-my-queue.png');
      if (!checked) throw new Error('فیلتر «صفِ من» روشن نشد');
      if (!/سرپرست چاپ دیجیتال/.test(results.digital.label)) throw new Error('برچسب فیلتر نقش را نام نمی‌برد: ' + results.digital.label);
      if (before.board.draggableCards !== 0 || before.board.operationButtons !== 0) throw new Error('سرپرست دیجیتال روی تابلو عملیات یا کشیدن دارد');
      if (before.board.viewButtons === 0) throw new Error('سرپرست دیجیتال راه دیدن جزئیات را از دست داده است');
      if (before.digital.press.cards !== 1 || before.digital.cutting.cards !== 1) throw new Error('پیش از فیلتر، کادر دیجیتال پر نبوده: ' + before.digital.press.badge + ' / ' + before.digital.cutting.badge);
      if (after.board.operationButtons !== 0) throw new Error('فیلتر «صفِ من» به سرپرست دکمهٔ عملیات داده است: ' + after.board.operationButtons);
      if (after.digital.press.cards !== 1) throw new Error('قلم چاپ دیجیتال در صفِ من نیست: ' + after.digital.press.badge);
      if (after.digital.cutting.cards !== 0) throw new Error('برش و تکمیلی نوبت سرپرست صحافی است و در صفِ من نباید بماند: ' + after.digital.cutting.badge);
      if (after.offset.press.cards !== 0 || after.offset.binding.cards !== 0) throw new Error('صفِ منِ دیجیتال قلم افست را هم نگه داشته است: ' + after.offset.press.badge + ' / ' + after.offset.binding.badge);
      if (after.final.cards !== 0) throw new Error('کادر مشترک تحویل نوبت کارشناس سفارشات است و در صفِ من مانده: ' + after.final.badge);
      /* قلم قدیمیِ «چاپ» عمداً در صف می‌ماند: همان مرحله در موتور، نوبت سرپرست چاپ دیجیتال هم هست. */
      const legacyLeft = after.legacy.filter(c => c.cards > 0).map(c => c.header);
      if (legacyLeft.join() !== 'چاپ') throw new Error('صفِ منِ دیجیتال قلم‌های قدیمی را درست نکاه نمی‌دارد: ' + JSON.stringify(after.legacy));
      if (after.hold.finance.cards !== before.hold.finance.cards || after.hold.order.cards !== before.hold.order.cards || after.hold.manager.cards !== before.hold.manager.cards) throw new Error('فیلتر «صفِ من» کادر معلق را تغییر داد');

      /* کنترل منفی: انباردار می‌خواند و عملیاتی ندارد. */
      await exec(inject(async (u, p) => window.psHelpers().login(u, p), 'store', STAFF_PASS), 'login storekeeper');
      results.store = await exec(inject(measure), 'measure as storekeeper');
      results.storeScreenshot = await capture(win, 'rev14-12-board-store-view-only.png');
      if (results.store.board.draggableCards !== 0) throw new Error('انباردار می‌تواند کارت‌ها را بکشد');
      if (results.store.board.operationButtons !== 0) throw new Error('انباردار دکمهٔ عملیات مرحله روی تابلو دارد');
      if (results.store.board.viewButtons === 0) throw new Error('انباردار راه دیدن جزئیات را از دست داده است');
      if (!/فقط نمایش/.test(results.store.board.boardText)) throw new Error('نشان «فقط نمایش» برای انباردار نیست');
      if (results.store.board.lanes.hold.columns.length !== 3) throw new Error('انباردار هر سه دلیل معلق را نمی‌بیند');
      if (results.store.hold.finance.cards !== 2) throw new Error('کادر معلقِ انباردار با مدیر هم‌خوان نیست: ' + results.store.hold.finance.badge);

      fs.writeFileSync(path.join(workDir, 'board-lanes-report.json'), JSON.stringify({ ...results, fixtureDir }, null, 2));
      console.log(JSON.stringify({ smoke: 'production-board-two-lanes', pass: true, measured: { hold: results.manager.hold, offset: results.manager.offset, digital: results.manager.digital, final: results.manager.final, legacy: results.manager.legacy, quotesIssued: patch.quotesIssued } , fixtureDir }));
      completed = true; clearTimeout(timeout); app.exit(0);
    } catch (error) {
      fs.writeFileSync(path.join(workDir, 'board-lanes-error.txt'), String((error && error.stack) || error));
      completed = true; console.error((error && error.stack) || error); clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../electron/main.js');
