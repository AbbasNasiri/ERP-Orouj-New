'use strict';
/* اصلاحات ۱۷/بند ۱: پروندهٔ اعتباری مشتری و یکنواختی قاعدهٔ بدهی.
   چهار چیز سنجیده می‌شود:
   ۱) مثال خودِ کارفرما رقم‌به‌رقم باز تولید شود (سقف ۱۰۰، بدهی ۵۰، تعهد ۲۵، پیش‌پرداخت ۱۰
      → تعهد خالص ۶۵، اعتبار آزاد ۳۵؛ سفارش ۴۵ میلیونی ۱۰ میلیون از سقف عبور می‌کند).
   ۲) سه‌دسته‌بودنِ بدهی: قطعی فقط پشت فاکتورِ صادرشده، تعهد برای سفارشِ تأییدشدهٔ بی‌فاکتور،
      و بی‌اثر برای انتظار/بایگانی/لغوِ بی‌تعهد — با کنترل منفی روی هر دسته.
   ۳) سررسید: بدهیِ قطعی با مهلتِ پرداختِ مشتری سررسید می‌شود، نه با تاریخِ سفارش.
   ۴) fail‑closed: مبلغ پیش‌فاکتورِ نامعتبر عدد نمی‌سازد، خطا می‌دهد. */
const test = require('node:test');
const assert = require('node:assert/strict');
const credit = require('../electron/credit');

const M = n => n * 1000000;
/* شکل واقعیِ pricing در بانک: { schemaVersion, revision, input, result: { total, currency } } —
   واحد پول داخل result است، پس آزمون هم همان شکل را می‌سازد. */
const priced = total => ({ result: { total, currency: 'IRR' } });
const TODAY = '2026-11-02';

const CUSTOMER = { id: 'c1', name: 'مشتری نمونه', customerCode: 'C-01', creditLimit: M(100), paymentTermDays: 30 };

/* بدهی قطعی ۵۰ از فاکتور ۶۰ با ۱۰ وصول‌شده؛ تعهد ۲۵ از سفارشِ تأییدشدهٔ بی‌فاکتور؛
   پیش‌پرداخت ۱۰ از سفارشی که هنوز به فاکتور نرسیده و بیش از مبلغش پرداخت شده. */
function exampleOrders() {
  return [
    { id: 'o1', orderNumber: '2001', customerId: 'c1', status: 'تحویل شده', date: '2026-09-20', pricing: priced(M(60)), payments: [{ amount: M(10) }] },
    { id: 'o2', orderNumber: '2002', customerId: 'c1', status: 'تایید شده', date: '2026-10-30', pricing: priced(M(25)), payments: [] },
    { id: 'o3', orderNumber: '2003', customerId: 'c1', status: 'در انتظار تایید', date: '2026-11-01', pricing: priced(M(5)), payments: [{ amount: M(15) }] },
  ];
}
const INVOICES = { o1: { number: 'I-77', total: M(60), issuedAt: '2026-09-21T10:00:00Z' } };

const file = (customer = CUSTOMER, orders = exampleOrders(), invoices = INVOICES, today = TODAY) =>
  credit.creditFileOf(customer, orders, invoices, today);

test('مثال کارفرما: تعهد خالص ۶۵ میلیون و اعتبار آزاد ۳۵ میلیون از همین داده بیرون می‌آید', () => {
  const f = file();
  assert.equal(f.ceiling, M(100), 'سقف از پروندهٔ مشتری خوانده می‌شود');
  assert.equal(f.definiteDebt, M(50), 'بدهی قطعی = فاکتور صادرشده منهای وصولی');
  assert.equal(f.commitment, M(25), 'تعهد = سفارش تأییدشدهٔ بی‌فاکتور');
  assert.equal(f.advance, M(10), 'پیش‌پرداختِ مصرف‌نشده هم از سفارشِ در انتظار می‌آید');
  assert.equal(f.netCommitment, M(65), 'تعهد خالص = بدهی قطعی + تعهد − پیش‌پرداخت');
  assert.equal(f.available, M(35), 'اعتبار آزاد = سقف − تعهد خالص');
  assert.equal(f.status, credit.CREDIT.FREE);
});

test('سفارش ۴۵ میلیونیِ این مثال ۱۰ میلیون از سقف عبور می‌کند و نیازمند مجوز است', () => {
  const v = credit.verdictOf(file(), M(45));
  assert.equal(v.projected, M(110));
  assert.equal(v.overBy, M(10), 'مبلغ عبور از سقف');
  assert.equal(v.needsApproval, true);
  assert.equal(v.status, credit.CREDIT.APPROVAL);
  assert.match(v.text, /از سقف اعتبار عبور می‌کند/);
});

test('سفارش ۳۰ میلیونی از سقف عبور نمی‌کند؛ ۵ میلیون باقی می‌ماند', () => {
  const v = credit.verdictOf(file(), M(30));
  assert.equal(v.overBy, 0);
  assert.equal(v.needsApproval, false);
  assert.match(v.text, /باقی می‌ماند/);
});

test('ویرایش همان سفارشِ موجود، مبلغش را دوباره به تعهد اضافه نمی‌کند', () => {
  const f = file();
  const same = credit.verdictOf(f, M(25), 'o2');
  assert.equal(same.freshAmount, 0, 'افزایشی نسبت به مبلغ قبلی محاسبه می‌شود نه مبلغ کل');
  assert.equal(same.projected, f.netCommitment);
  assert.equal(credit.verdictOf(f, M(75), 'o2').overBy, M(15), '۵۰ میلیون افزایش روی ۶۵ میلیون تعهد، ۱۵ میلیون از سقف عبور');
});

test('سه دستهٔ بدهی: قطعی، تعهد، بی‌اثر — با کنترل منفی روی وضعیت‌ها', () => {
  assert.equal(credit.classify({ status: 'تایید شده' }, { number: 'I-1' }), 'definite', 'فاکتور صادرشده قطعی است');
  assert.equal(credit.classify({ status: 'تایید شده' }, null), 'committed');
  assert.equal(credit.classify({ status: 'در انتظار تایید' }, null), 'ignored');
  assert.equal(credit.classify({ status: 'بایگانی' }, null), 'ignored');
  assert.equal(credit.classify({ status: 'درخواست مشتری' }, null), 'ignored');
  assert.equal(credit.classify({ status: 'لغو شده' }, null), 'ignored', 'سفارش لغوشدهٔ بی‌تعهد بدهی نمی‌سازد');
  assert.equal(credit.classify({ status: 'لغو شده', workflow: { cancellationSettlement: { balance: M(3) } } }, null), 'definite',
    'اما لغوشده‌ای که تسویهٔ باز دارد بدهی قطعی است');
});

test('فاکتورِ ابطال‌شده بدهی قطعی نمی‌سازد؛ فقط فاکتورِ صادرشده در بانک حساب می‌شود', () => {
  const orders = [{ id: 'o1', customerId: 'c1', status: 'تحویل شده', date: '2026-09-20', pricing: priced(M(60)), payments: [] }];
  const withVoid = file(CUSTOMER, orders, {}, TODAY);
  assert.equal(withVoid.definiteDebt, 0, 'بی‌فاکتورِ صادرشده، بدهی قطعی نداریم');
  assert.equal(withVoid.commitment, M(60), 'به جایش تعهد می‌نشیند');
  const withIssued = file(CUSTOMER, orders, { o1: { number: 'I-9', total: M(60), issuedAt: '2026-09-21' } }, TODAY);
  assert.equal(withIssued.definiteDebt, M(60));
  assert.equal(withIssued.commitment, 0);
});

test('سررسید از مهلتِ پرداختِ مشتری روی تاریخِ فاکتور حساب می‌شود، نه تاریخِ سفارش', () => {
  const orders = [{ id: 'o1', customerId: 'c1', status: 'تحویل شده', date: '2026-09-01', pricing: priced(M(60)), payments: [] }];
  const invoices = { o1: { number: 'I-1', total: M(60), issuedAt: '2026-10-05T08:00:00Z' } };
  const fresh = credit.creditFileOf({ ...CUSTOMER, paymentTermDays: 30 }, orders, invoices, TODAY);
  assert.equal(fresh.lines[0].documentDate, '2026-10-05', 'مبنای سررسید تاریخ فاکتور است نه تاریخ سفارش (۲۰۲۶-۰۹-۰۱)');
  assert.equal(fresh.lines[0].dueDate, '2026-11-04');
  assert.equal(fresh.overdueDebt, 0, 'دو روز به مهلت مانده، پس سررسیدگذشته نیست');
  const late = credit.creditFileOf({ ...CUSTOMER, paymentTermDays: 15 }, orders, invoices, TODAY);
  assert.equal(late.lines[0].dueDate, '2026-10-20');
  assert.equal(late.overdueDebt, M(60), 'با مهلت ۱۵ روزه همان مبلغ سررسیدگذشته می‌شود');
  assert.equal(late.overdueCount, 1);
});

test('هشدار و مسدود: با عبور از درصد هشدار و با عبور از سقف خودِ پرونده', () => {
  const orders = [{ id: 'o1', customerId: 'c1', status: 'تحویل شده', date: '2026-10-01', pricing: priced(M(85)), payments: [] }];
  const warn = file(CUSTOMER, orders, { o1: { number: 'I-1', total: M(85), issuedAt: '2026-10-01' } });
  assert.equal(warn.usedPercent, 85);
  assert.equal(warn.status, credit.CREDIT.WARNING, 'پیش‌فرض هشدار از ۸۰٪ مصرف');
  assert.equal(warn.available, M(15));
  const over = file(CUSTOMER, [{ ...orders[0], pricing: priced(M(120)) }], { o1: { number: 'I-1', total: M(120), issuedAt: '2026-10-01' } });
  assert.equal(over.status, credit.CREDIT.BLOCKED);
  assert.equal(over.available, -M(20), 'اعتبار منفی یعنی از سقف گذشته است');
});

test('بی‌سقف بودنِ اعتبار وضعیت را «سقف تعیین‌نشده» می‌کند و دروازه از امروز بازتر نمی‌شود', () => {
  const f = file({ ...CUSTOMER, creditLimit: 0 });
  assert.equal(f.status, credit.CREDIT.NO_POLICY);
  assert.equal(f.available, 0, 'بدون سقف، عددِ اعتبار آزاد ساخته نمی‌شود');
  assert.equal(credit.verdictOf(f, M(1)).needsApproval, true, 'بدهیِ قطعیِ ۵۰ میلیونی هست، پس مجوز لازم است');
  const committedOnly = file({ ...CUSTOMER, creditLimit: 0 },
    [{ id: 'o9', customerId: 'c1', status: 'تایید شده', date: '2026-11-01', pricing: priced(M(5)), payments: [] }], {});
  assert.equal(credit.verdictOf(committedOnly, M(1)).needsApproval, true,
    'کنترل منفی: تعهدِ بی‌فاکتور هم بدون سقف مجوز می‌خواهد — همان قاعدهٔ امروز، نه بازتر');
  const clean = file({ ...CUSTOMER, creditLimit: 0 },
    [{ id: 'o8', customerId: 'c1', status: 'در انتظار تایید', date: '2026-11-01', pricing: priced(M(5)), payments: [] }], {});
  assert.equal(credit.verdictOf(clean, M(1)).needsApproval, false, 'پروندهٔ بی‌مانده مجوز نمی‌خواهد');
  assert.match(credit.verdictOf(clean, M(1)).reasons.join('|'), /هیچ ماندهٔ باز/);
});

test('درصد هشدارِ مشتری از پیش‌فرض قابل تغییر است و به بیرون از ۱..۱۰۰ نمی‌رود', () => {
  assert.equal(credit.policyOf({}).warn, credit.DEFAULT_WARN_PERCENT);
  assert.equal(credit.policyOf({ creditWarnPercent: 50 }).warn, 50);
  assert.equal(credit.policyOf({ creditWarnPercent: 0 }).warn, 1);
  assert.equal(credit.policyOf({ creditWarnPercent: 400 }).warn, 100);
});

test('کنترل منفی: مبلغ پیش‌فاکتورِ نامعتبر عدد نمی‌سازد، خطا می‌دهد (fail‑closed)', () => {
  const broken = { id: 'ox', customerId: 'c1', status: 'تایید شده', date: '2026-11-01', pricing: { result: { total: -5, currency: 'IRR' } }, payments: [] };
  assert.throws(() => file(CUSTOMER, [broken], {}), /مبلغ پیش‌فاکتور ثبت‌شده معتبر نیست/);
  const wrongCurrency = { ...broken, pricing: { result: { total: 1000, currency: 'USD' } } };
  assert.throws(() => file(CUSTOMER, [wrongCurrency], {}), /مبلغ پیش‌فاکتور ثبت‌شده معتبر نیست/);
  const missing = { ...broken, pricing: { result: null } };
  assert.throws(() => file(CUSTOMER, [missing], {}), /مبلغ پیش‌فاکتور ثبت‌شده معتبر نیست/);
  /* واحد پولِ درست و مبلغِ درست — همان شکل واقعیِ سرور — باید پذیرفته شود. */
  assert.equal(credit.payableOf({ id: 'ok', pricing: { schemaVersion: 1, revision: 2, result: { total: 5000, currency: 'IRR' } } }), 5000);
});

test('کنترل منفی: نسخهٔ بدون‌پول برای نقشی که مبلغ نمی‌بیند ساخته می‌شود', () => {
  const f = file();
  const v = credit.verdictOf(f, M(45), 'o9');
  const bare = credit.withoutMoney(f, credit.MONEY_KEYS);
  const bareVerdict = credit.withoutMoney(v, credit.VERDICT_MONEY_KEYS);
  assert.equal(bare.lines, undefined, 'ردیف‌های مبلغی حذف می‌شوند');
  assert.equal(bare.definiteDebt, undefined);
  assert.equal(bare.status, f.status, 'وضعیت اعتبار بی‌عدد هم معنا دارد');
  assert.equal(bare.openCount, f.openCount);
  assert.equal(bareVerdict.needsApproval, v.needsApproval, 'تصمیم برای کارشناس سفارشات same است');
  assert.equal(bareVerdict.text, undefined, 'جملهٔ دارای رقم حذف می‌شود');
  assert.ok(bareVerdict.shortText.includes('سقف'), 'جملهٔ بی‌عدد می‌ماند');
  assert.ok(!JSON.stringify(bareVerdict).includes(String(M(45))), 'هیچ رقمی در بستهٔ بی‌پول نشت نمی‌کند');
});

test('راه قدیمی (بی‌پیش‌فاکتور) هم با همان قاعده حساب می‌شود: اقلام + خدمات + طراحی + حمل + سایر − تخفیف + مالیات', () => {
  const legacy = {
    id: 'ol', customerId: 'c1', status: 'تایید شده', date: '2026-11-01',
    items: [{ qty: '10', unitPrice: '5000', services: [{ price: '2000' }], hasDesign: true, designPrice: '3000' }],
    shippingCost: '1000', otherCost: '500', discount: '1500', vatPercent: '10', payments: [{ amount: '2000' }],
  };
  assert.equal(credit.payableOf(legacy), 60500, '۵۰۰۰۰+۲۰۰۰+۳۰۰۰+۱۰۰۰+۵۰۰−۱۵۰۰ = ۵۵۰۰۰، با ۱۰٪ مالیات = ۶۰۵۰۰');
  assert.equal(credit.balanceOf(legacy), 58500);
  const f = file(CUSTOMER, [legacy], {});
  assert.equal(f.commitment, 58500, 'سفارشِ بی‌فاکتور تعهد است نه بدهی قطعی');
});

test('پرونده فقط سفارش‌های همان مشتری را می‌خواند', () => {
  const orders = [...exampleOrders(), { id: 'other', customerId: 'c2', status: 'تحویل شده', date: '2026-09-01', pricing: priced(M(999)), payments: [] }];
  const f = file(CUSTOMER, orders, INVOICES);
  assert.deepEqual(f.lines.map(l => l.orderId).sort(), ['o1', 'o2']);
  assert.equal(f.definiteDebt, M(50));
});

test('ردیف‌های پرونده منبع مبلغ را نام می‌برند: شمارهٔ فاکتور یا «بدون فاکتور»', () => {
  const f = file();
  const invoiced = f.lines.find(l => l.orderId === 'o1');
  assert.equal(invoiced.source, 'فاکتور I-77');
  assert.equal(invoiced.kind, 'definite');
  const open = f.lines.find(l => l.orderId === 'o2');
  assert.equal(open.source, 'بدون فاکتور');
  assert.equal(open.kind, 'committed');
});

test('قاعدهٔ یکتا: balanceOf همان عددی را می‌دهد که پرونده به‌عنوان ماندهٔ یک سفارش نشان می‌دهد', () => {
  for (const order of exampleOrders()) {
    const line = file().lines.find(l => l.orderId === order.id);
    if (!line) continue;
    assert.equal(line.payable, credit.payableOf(order));
    assert.equal(line.paid, credit.paidOf(order));
    assert.equal(line.open, Math.max(0, credit.balanceOf(order)));
  }
});
