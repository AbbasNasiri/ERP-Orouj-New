'use strict';
/* اصلاحات ۱۴/۵: کادر معلق تابلو را سرور می‌سازد (productionBoard). سنجیده می‌شود که
   ۱) فقط سفارش‌های بازِ بدون اجازهٔ تولید می‌آیند، ۲) دلیل اصلی با اولِ زنجیرهٔ واقعی
   (مالی ← سفارش ← مدیر) انتخاب می‌شود، ۳) دلیل مالی فقط با رکورد سند پیش‌فاکتورِ صادرشده
   برای همان نسخه برطرف می‌شود — نه با هر عدد دیگری، ۴) روز بی‌تحرک از گردش واقعی حساب می‌شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBackend } = require('../electron/backend');
const { invoke } = require('../electron/channels');

const ORDERS = 'printshop_orders_v5';
const PASS = 'strong-board-pass';
const TODAY = '2026-06-15';
const NOW = () => Date.parse(TODAY + 'T12:00:00Z');

function openDb(file) {
  const db = new DatabaseSync(file);
  return { exec: s => db.exec(s), run: (s, ...p) => db.prepare(s).run(...p), get: (s, ...p) => db.prepare(s).get(...p), all: (s, ...p) => db.prepare(s).all(...p), close: () => db.close(), tx(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

const item = (id, productName, stage) => ({ id, productName, stage: stage || 'ثبت سفارش', qty: 1, unitPrice: 0, services: [], spec: { printMethod: 'افست' } });
const order = (id, n, extra) => ({
  id, orderNumber: n, date: '2026-06-01', deliveryDate: '2026-06-20', customerId: 'c1', customerName: 'کتاب نور',
  status: 'در انتظار تایید', quoteRev: 1, items: [item('i' + n, 'کتاب ' + n)], payments: [], history: [], ...extra,
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-board-'));
  const b = createBackend({ dataDir: dir, openDb, now: NOW });
  const manager = b.login('admin', '1234').token;
  b.setOwnPassword(manager, PASS);
  // حساب «مشتری» فقط به مشتریِ شماره‌دار و تأییدشده وصل می‌شود؛ کنترل‌منفیِ نقش مشتری به آن نیاز دارد.
  assert.equal(b.set(manager, 'printshop_customers_v2', [{ id: 'c1', name: 'کتاب نور' }]).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c1', 'approve', { reason: 'معتبر' }).ok, true);
  assert.equal(b.partyAction(manager, 'customer', 'c1', 'issue_number').ok, true);
  const users = b.listUsers(manager).users;
  users.push(
    { id: 'clerk', name: 'کارشناس سفارشات', username: 'clerk', role: 'کارشناس سفارشات', _plain: PASS },
    { id: 'store', name: 'انباردار', username: 'store', role: 'انباردار', _plain: PASS },
    { id: 'press', name: 'سرپرست چاپ', username: 'press', role: 'سرپرست چاپ', _plain: PASS },
    { id: 'cust1', name: 'کتاب نور', username: 'cust1', role: 'مشتری', customerId: 'c1', _plain: PASS },
  );
  assert.equal(b.saveUsers(manager, users).ok, true);
  /* مسیر عام «set» فقط فیلدهای مجاز را می‌پذیرد: workflow، deliveredAt و مرحلهٔ قلم از این راه نوشته نمی‌شوند.
   پس رکوردها بی‌ضرر کاشته و سپس همان فیلدهای حفاظت‌شده مستقیم روی دادهٔ ذخیره‌شده نوشته می‌شوند
   (روشی که در backend-workflow و backend-unfinished-work مرسوم است) تا حالت‌های واقعیِ تولید بازسازی شود. */
  const seed = [
    order('o1', '1001'),
    order('o2', '1002', { history: [{ id: 'h1', date: '2026-06-05', text: 'پیش‌فاکتور آماده شد' }] }),
    order('o3', '1003', { date: '2026-06-08' }),
    order('o4', '1004', { date: '2026-06-10' }),
    order('o5', '1005', { date: '2026-06-12' }),
    order('o6', '1006', { date: '2026-06-12', quoteRev: 2 }),
    order('o7', '1007'),
    order('o8', '1008', { status: 'بایگانی' }),
  ];
  const seeded = b.set(manager, ORDERS, seed);
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  const write = o => b._db.run('UPDATE records SET data = ? WHERE collection = ? AND id = ?', JSON.stringify(o), ORDERS, o.id);
  const withStage = (o, stage) => ({ ...o, items: o.items.map(it => ({ ...it, stage })) });
  const confirm = rev => ({ customerConfirmation: { at: Date.parse('2026-06-10T08:00:00Z'), quoteRevision: rev } });
  // o1001 در تولید است (مجوز مدیر + تأیید مشتری + قلم در چاپ افست) → هرگز در کادر معلق نمی‌آید
  write({ ...withStage(seed[0], 'چاپ افست'), status: 'تایید شده', workflow: { productionAuthorization: { at: 1, by: { role: 'مدیر چاپخانه' } }, ...confirm(1) } });
  // o1002 تازه ثبت شده: هیچ حلقه‌ای بسته نیست و پیش‌فاکتوری صادر نشده → دلیل اصلی مالی
  // o1003 فقط پیش‌فاکتور دارد → تأیید مشتریِ نسخهٔ فعلی ثبت نشده
  // o1004 پیش‌فاکتور و تأیید مشتریِ نسخهٔ فعلی دارد، ولی قلم هنوز ارجاع نشده
  write({ ...seed[3], workflow: confirm(1) });
  // o1005 همه حلقه‌های پیش‌نیاز بسته شده و قلم ارجاع شده: فقط اجازهٔ مدیر باز است
  write({ ...withStage(seed[4], 'طراحی و پروف'), workflow: confirm(1) });
  // o1006 پیش‌فاکتور برای نسخهٔ ۱ صادر شده ولی سفارش به نسخهٔ ۲ رفته و تأیید مشتری نسخهٔ قبل است
  write({ ...withStage(seed[5], 'طراحی و پروف'), workflow: confirm(1) });
  // o1007 تحویل‌شده و o1008 بایگانی → هر دو بیرون از کادر معلق
  write({ ...withStage(seed[6], 'کنترل کیفیت و تحویل به مشتری'), status: 'تحویل شده', deliveredAt: '2026-06-13' });
  const addDoc = (orderId, revision, number, status) => b._db.run(
    'INSERT INTO financial_documents(id,type,order_id,quote_revision,number,status,record,created_at) VALUES(?,?,?,?,?,?,?,?)',
    'd-' + number, 'quote', orderId, revision, number, status, JSON.stringify({ id: 'd-' + number, type: 'quote', number, status }), 1);
  addDoc('o3', 1, 'Q-1003', 'issued');
  addDoc('o4', 1, 'Q-1004', 'issued');
  addDoc('o5', 1, 'Q-1005', 'issued');
  addDoc('o6', 1, 'Q-1006', 'issued');   // برای نسخهٔ ۱ صادر شده، در حالی که سفارش به نسخهٔ ۲ رفته است
  const clerk = b.login('clerk', PASS).token;
  const store = b.login('store', PASS).token;
  const press = b.login('press', PASS).token;
  const customer = b.login('cust1', PASS).token;
  t.after(() => { b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { b, manager, clerk, store, press, customer, addDoc };
}

const find = (rows, id) => rows.find(r => r.orderId === id);
const keys = r => r.reasons.map(x => x.key);

test('فقط سفارش‌های بازِ بدون اجازهٔ تولید در کادر معلق می‌نشینند؛ سفارشِ در تولید، تحویل‌شده و بایگانی بیرون‌اند', t => {
  const { b, manager } = fixture(t);
  const rows = b.productionBoard(manager).holds;
  assert.deepEqual(rows.map(r => r.orderId).sort(), ['o2', 'o3', 'o4', 'o5', 'o6']);
  assert.equal(find(rows, 'o1'), undefined, 'سفارش دارای اجازهٔ تولید معلق نیست');
  assert.equal(find(rows, 'o7'), undefined, 'سفارش تحویل‌شده معلق نیست');
  assert.equal(find(rows, 'o8'), undefined, 'سفارش بایگانی‌شده معلق نیست');
});

test('دلیل اصلی به ترتیب زنجیرهٔ واقعی انتخاب می‌شود: مالی، سپس سفارش، سپس مدیر', t => {
  const { b, manager } = fixture(t);
  const rows = b.productionBoard(manager).holds;
  assert.equal(find(rows, 'o2').primary, 'finance', 'بدون سند پیش‌فاکتور، اولین حلقهٔ باز مالی است');
  assert.equal(find(rows, 'o3').primary, 'order', 'پیش‌فاکتور صادر شده؛ نوبت تأیید مشتری است');
  assert.equal(find(rows, 'o4').primary, 'order', 'تأیید مشتری هست اما قلم هنوز ارجاع نشده');
  assert.equal(find(rows, 'o5').primary, 'manager', 'همه بسته شده؛ فقط اجازهٔ مدیر مانده است');
  assert.deepEqual(keys(find(rows, 'o2')), ['manager', 'order', 'finance'], 'هر سه دلیل خاموش گزارش می‌شود');
  assert.deepEqual(keys(find(rows, 'o3')), ['manager', 'order'], 'دلیل مالی با سند صادرشده برطرف می‌شود');
  assert.deepEqual(keys(find(rows, 'o5')), ['manager'], 'با قلم ارجاع‌شده فقط دلیل مدیر می‌ماند');
});

test('تأیید مالی فقط با سند پیش‌فاکتورِ صادرشده برای همان نسخه برمی‌گردد؛ نسخهٔ دیگر و سند باطل‌شده اعتبار ندارند', t => {
  const { b, manager, addDoc } = fixture(t);
  assert.equal(find(b.productionBoard(manager).holds, 'o2').primary, 'finance');
  addDoc('o2', 1, 'Q-1002', 'issued');
  assert.equal(find(b.productionBoard(manager).holds, 'o2').primary, 'order', 'سند نسخهٔ فعلی دلیل مالی را برمی‌دارد');
  // همان سند باطل می‌شود: رکورد تازه‌ای ساخته نمی‌شود (یک سند به ازای هر نسخه)، وضعیتِ همان رکورد عوض می‌شود
  b._db.run('UPDATE financial_documents SET status = ? WHERE id = ?', 'void', 'd-Q-1002');
  assert.equal(find(b.productionBoard(manager).holds, 'o2').primary, 'finance', 'سند باطل‌شده تأیید مالی نیست');
  // o6: سند برای نسخهٔ ۱ صادر شده ولی سفارش به نسخهٔ ۲ رفته است → دلیل مالی دوباره باز است
  assert.equal(find(b.productionBoard(manager).holds, 'o6').primary, 'finance', 'سند نسخهٔ قبل، نسخهٔ فعلی را تأیید نمی‌کند');
  assert.match(find(b.productionBoard(manager).holds, 'o6').reasons.find(r => r.key === 'order').detail, /مشتری/);
});

test('روز بی‌تحرک از آخرین گردش واقعی سفارش حساب می‌شود و قلم‌های ارجاع‌نشده شمرده می‌شوند', t => {
  const { b, manager } = fixture(t);
  const rows = b.productionBoard(manager).holds;
  assert.equal(find(rows, 'o2').idleDays, 10, 'گردش ۵ خرداد تا امروز ۱۵ خرداد = ۱۰ روز');
  assert.equal(find(rows, 'o2').unreferredItems, 1);
  assert.equal(find(rows, 'o5').unreferredItems, 0, 'قلم ارجاع‌شده در شمار نیست');
  assert.equal(find(rows, 'o4').unreferredItems, 1, 'تأیید مشتری که ارجاع نشده باشد دلیل سفارش را باز می‌گذارد');
  assert.match(find(rows, 'o4').reasons.find(r => r.key === 'order').detail, /ارجاع/);
});

test('سرپرست، انباردار و کارشناس سفارشات کادر معلق را می‌خوانند؛ نقش مشتری نه و بی‌توکن رد می‌شود', t => {
  const { b, manager, clerk, store, press, customer } = fixture(t);
  assert.equal(b.productionBoard(clerk).ok, true);
  assert.equal(b.productionBoard(press).ok, true);
  assert.equal(b.productionBoard(store).ok, true, 'انباردار هم تابلو را می‌بیند');
  assert.equal(b.productionBoard(customer).code, 'FORBIDDEN');
  assert.equal(b.productionBoard('x'.repeat(12)).ok, false);
  assert.equal(invoke('be:productionBoard', { productionBoard: () => ({ ok: true, spy: true }) }, {}, 'x'.repeat(12), []).code, 'UNAUTHENTICATED');
  assert.equal(invoke('be:productionBoard', { productionBoard: () => ({ ok: true, spy: true }) }, {}, manager, []).spy, true, 'کانال در جدول allow-list ثبت است');
});

test('هیچ مبلغی در کادر معلق نیست و فقط فیلدهای واقعی سفارش می‌آید', t => {
  const { b, manager, clerk } = fixture(t);
  for (const token of [manager, clerk]) {
    const out = b.productionBoard(token);
    assert.equal(out.ok, true);
    assert.equal(out.today, TODAY);
    for (const h of out.holds) {
      assert.deepEqual(Object.keys(h).sort(), ['customerName', 'date', 'held', 'idleDays', 'lastMovement', 'orderId', 'orderNumber', 'primary', 'reasons', 'status', 'unreferredItems'].sort());
      assert.ok(!JSON.stringify(h).match(/[0-9]{6,}/), 'عدد پولی در کادر معلق نشسته است');
    }
  }
});
