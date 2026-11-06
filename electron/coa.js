'use strict';
/* اصلاحات ۱۷/بند ۰ — کدینگ حساب‌ها و نگاشت «رویداد → سند».
   این ماژول خالص است: نه می‌خواند، نه می‌نویسد. زیرمجموعه‌ای از فایل نمونهٔ کدینگ است که
   به کار چاپخانه لازم است و تا تأیید کارفرما هیچ سندی از آن صادر نمی‌شود (status='draft').
   قاعدهٔ توازن: هر قاعدهٔ ثبتی باید مجموعهٔ عبارت‌های مبلغِ بدهکار را — پس از بازکردن
   عبارت‌های مرکب — دقیقاً برابر مجموعهٔ بستانکار کند؛ پس توازن از ساخت تضمین می‌شود،
   نه با جمعِ اعشاری در زمان اجرا. */

const ACCOUNTS = [
  { code: '1101', title: 'صندوق', group: 'نقدینه و بانک', nature: 'بدهکار' },
  { code: '1102', title: 'بانک‌ها', group: 'نقدینه و بانک', nature: 'بدهکار' },
  { code: '1103', title: 'چک‌های دریافتنی نزد صندوق', group: 'نقدینه و بانک', nature: 'بدهکار' },
  { code: '1104', title: 'چک‌های دریافتنی در جریان وصول', group: 'نقدینه و بانک', nature: 'بدهکار' },
  { code: '1201', title: 'حساب‌های دریافتنی مشتریان', group: 'حساب‌های دریافتنی', nature: 'بدهکار' },
  { code: '1202', title: 'ذخیره مطالبات مشکوک‌الوصول', group: 'حساب‌های دریافتنی', nature: 'بستانکار' },
  { code: '1301', title: 'موجودی کاغذ و مقوا', group: 'موجودی مواد و انبار', nature: 'بدهکار' },
  { code: '1302', title: 'موجودی ملزومات و متفرقه', group: 'موجودی مواد و انبار', nature: 'بدهکار' },
  { code: '1303', title: 'موجودی ضایعات', group: 'موجودی مواد و انبار', nature: 'بدهکار' },
  { code: '1304', title: 'موجودی کالای پای‌کار', group: 'موجودی مواد و انبار', nature: 'بدهکار' },
  { code: '1305', title: 'موجودی کالای مرجوعی', group: 'موجودی مواد و انبار', nature: 'بدهکار' },
  { code: '1306', title: 'کسر و اضافات انبار', group: 'موجودی مواد و انبار', nature: 'بدهکار' },
  { code: '1401', title: 'مالیات و عوارض پرداختی', group: 'سایر بدهکاران', nature: 'بدهکار' },
  { code: '1501', title: 'ماشین‌آلات و تجهیزات چاپ', group: 'دارایی ثابت مشهود', nature: 'بدهکار' },
  { code: '1502', title: 'استهلاک انباشته ماشین‌آلات', group: 'دارایی ثابت مشهود', nature: 'بستانکار' },

  { code: '2101', title: 'حساب‌های پرداختنی تأمین‌کنندگان', group: 'حساب‌های پرداختنی', nature: 'بستانکار' },
  { code: '2102', title: 'اسناد پرداختنی (چک پرداختنی)', group: 'حساب‌های پرداختنی', nature: 'بستانکار' },
  { code: '2103', title: 'کمیسیون و پورسانت پرداختنی', group: 'حساب‌های پرداختنی', nature: 'بستانکار' },
  { code: '2201', title: 'پیش‌دریافت فروش مشتریان', group: 'پیش‌دریافت و بستانکاری', nature: 'بستانکار' },
  { code: '2203', title: 'مالیات و عوارض وصولی پرداختنی', group: 'مالیات و عوارض', nature: 'بستانکار' },
  { code: '2204', title: 'حقوق و بیمه پرداختنی', group: 'حقوق و دستمزد', nature: 'بستانکار' },

  { code: '3101', title: 'سرمایه', group: 'سرمایه و اندوخته‌ها', nature: 'بستانکار' },
  { code: '3201', title: 'اندوخته قانونی', group: 'سرمایه و اندوخته‌ها', nature: 'بستانکار' },
  { code: '3301', title: 'سود و زیان انباشته', group: 'سرمایه و اندوخته‌ها', nature: 'بستانکار' },
  { code: '3401', title: 'تراز افتتاحیه', group: 'سرمایه و اندوخته‌ها', nature: 'بستانکار' },

  { code: '5101', title: 'فروش خدمات چاپ و تکمیلی', group: 'درآمدهای عملیاتی', nature: 'بستانکار' },
  { code: '5201', title: 'برگشت از فروش و تخفیفات', group: 'درآمدهای عملیاتی', nature: 'بدهکار' },

  { code: '6101', title: 'کار در جریان ساخت', group: 'کار در جریان', nature: 'بدهکار' },
  { code: '6102', title: 'بهای تمام‌شده خدمات', group: 'بهای تمام‌شده', nature: 'بدهکار' },
  { code: '6201', title: 'هزینه مواد مصرفی مستقیم', group: 'بهای تمام‌شده', nature: 'بدهکار' },
  { code: '6202', title: 'هزینه مواد مصرفی غیرمستقیم', group: 'بهای تمام‌شده', nature: 'بدهکار' },
  { code: '6301', title: 'هزینه دستمزد مستقیم', group: 'بهای تمام‌شده', nature: 'بدهکار' },
  { code: '6401', title: 'سایر هزینه‌های سربار ساخت', group: 'سربار ساخت', nature: 'بدهکار' },
  { code: '6402', title: 'سربار تخصیص‌یافته به سفارش‌ها', group: 'سربار ساخت', nature: 'بستانکار' },
  { code: '6501', title: 'هزینه خدمات پیمانکاران و برون‌سپاری', group: 'بهای تمام‌شده', nature: 'بدهکار' },
  { code: '6601', title: 'هزینه حمل داخلی سفارش', group: 'هزینه‌های فروش', nature: 'بدهکار' },
  { code: '6602', title: 'هزینه حمل بار به کارخانه', group: 'بهای تمام‌شده', nature: 'بدهکار' },
  { code: '6701', title: 'ضایعات غیرعادی تولید', group: 'هزینه‌های غیرعادی', nature: 'بدهکار' },

  { code: '7101', title: 'هزینه‌های اداری و فروش', group: 'هزینه‌های دوره', nature: 'بدهکار' },
  { code: '7102', title: 'کارمزد و هزینه‌های بانکی', group: 'هزینه‌های دوره', nature: 'بدهکار' },
  { code: '7103', title: 'سود و زیان فروش ضایعات', group: 'سایر درآمدها و هزینه‌ها', nature: 'بستانکار' },
  { code: '7104', title: 'کمیسیون و پورسانت فروش', group: 'هزینه‌های دوره', nature: 'بدهکار' },

  { code: '8101', title: 'کالای امانی مشتریان نزد چاپخانه', group: 'حساب‌های انتظامی', nature: 'بدهکار' },
  { code: '8102', title: 'تعهد عودت کالای امانی مشتری', group: 'حساب‌های انتظامی', nature: 'بستانکار' },
  { code: '8103', title: 'چک‌های ضمانت دریافتی', group: 'حساب‌های انتظامی', nature: 'بدهکار' },
  { code: '8104', title: 'تعهد عودت چک ضمانت', group: 'حساب‌های انتظامی', nature: 'بستانکار' },
];

/* عبارت‌های مبلغ که از رکوردهای برنامه خوانده می‌شوند. هر «عبارت مرکب» به اجزای سازندهٔ خود
   باز می‌شود تا توازنِ قواعدی مثل فاکتور (ناخالص = خالص + مالیات) قابل اثبات باشد. */
const COMPOSITES = {
  'invoice.gross': ['invoice.net', 'invoice.vat'],
  'cheque.face': ['cheque.net', 'cheque.fee'],
};

/* حساب‌هایی که کدشان از خودِ رویداد خوانده می‌شود، نه از جدول. */
const RESOLVERS = [
  { key: '@settlement', label: 'حساب تسویهٔ پرداخت', routes: 'نقد ← ۱۱۰۱ صندوق؛ کارت به کارت و حواله بانکی ← ۱۱۰۲ بانک‌ها؛ چک ← ۱۱۰۳ چک‌های دریافتنی نزد صندوق' },
  { key: '@cheque_side', label: 'وضعیت چک دریافتنی', routes: 'نزد صندوق ← ۱۱۰۳؛ در جریان وصول ← ۱۱۰۴' },
];
const SETTLEMENT_ROUTES = { 'نقد': '1101', 'کارت به کارت': '1102', 'حواله بانکی': '1102', 'چک': '1103' };
const CHEQUE_SIDE_ROUTES = { 'near_box': '1103', 'in_collection': '1104' };

const READY = 'همین حالا از دادهٔ فعلی';
const WAITING = { warehouse: 'منتظر گام انبار (اصلاحات ۱۵)', ar: 'منتظر رسید و تخصیص وجه', ap: 'منتظر سند پرداخت تأمین‌کننده', costing: 'منتظر گام بهای تمام‌شده', treasury: 'منتظر شیء چک و حواله' };

/* kind='posting' قاعدهٔ ثبتیِ کامل است. kind='mechanism' یعنی این رویداد یک سند تک‌خطی نمی‌دهد
   و جای خود را به دو سند (برگشت + ثبت تازه) یا مبلغِ علامت‌دار می‌دهد؛ توضیحش در note است. */
const MAPPINGS = [
  { event: 'invoice_issued', label: 'صدور فاکتور فروش', owner: 'مدیر مالی', kind: 'posting', status: READY, source: 'سند financial_documents نوع invoice + snapshot پیش‌فاکتورِ همان نسخه',
    lines: [{ account: '1201', side: 'dr', amount: 'invoice.gross' }, { account: '5101', side: 'cr', amount: 'invoice.net' }, { account: '2203', side: 'cr', amount: 'invoice.vat' }] },
  { event: 'prepayment_received', label: 'دریافت پیش‌پرداخت از مشتری', owner: 'مدیر مالی', kind: 'posting', status: READY, source: 'ردیف پرداخت سفارش (order.payments) پیش از صدور فاکتور',
    lines: [{ account: '@settlement', side: 'dr', amount: 'receipt.amount' }, { account: '2201', side: 'cr', amount: 'receipt.amount' }] },
  { event: 'payment_received', label: 'دریافت وجه بابت فاکتور', owner: 'مدیر مالی', kind: 'posting', status: READY, source: 'رسید وصول (پس از تخصیص به فاکتور)',
    lines: [{ account: '@settlement', side: 'dr', amount: 'payment.amount' }, { account: '1201', side: 'cr', amount: 'payment.amount' }] },
  { event: 'advance_applied', label: 'تخصیص پیش‌دریافت به فاکتور', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ar, source: 'ردیف تخصیصِ روی سند دریافت',
    lines: [{ account: '2201', side: 'dr', amount: 'allocation.amount' }, { account: '1201', side: 'cr', amount: 'allocation.amount' }] },
  { event: 'refund_overpayment', label: 'استرداد وجه اضافهٔ مشتری', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ar, source: 'رسید پرداخت از صندوق/بانک',
    lines: [{ account: '2201', side: 'dr', amount: 'refund.amount' }, { account: '@settlement', side: 'cr', amount: 'refund.amount' }] },
  { event: 'cheque_received', label: 'دریافت چک از مشتری', owner: 'مدیر مالی', kind: 'posting', status: WAITING.treasury, source: 'سند چک دریافتنی — مبلغ اسمی',
    lines: [{ account: '1103', side: 'dr', amount: 'cheque.face' }, { account: '1201', side: 'cr', amount: 'cheque.face' }] },
  { event: 'cheque_deposited', label: 'ارسال چک دریافتنی به جریان وصول', owner: 'مدیر مالی', kind: 'posting', status: WAITING.treasury, source: 'همان چک، فقط جابه‌جایی وضعیت',
    lines: [{ account: '1104', side: 'dr', amount: 'cheque.face' }, { account: '1103', side: 'cr', amount: 'cheque.face' }] },
  { event: 'cheque_cleared', label: 'وصول چک از بانک', owner: 'مدیر مالی', kind: 'posting', status: WAITING.treasury, source: 'گزارش بانک: خالص واصل و کارمزد',
    lines: [{ account: '1102', side: 'dr', amount: 'cheque.net' }, { account: '7102', side: 'dr', amount: 'cheque.fee' }, { account: '@cheque_side', side: 'cr', amount: 'cheque.face' }] },
  { event: 'cheque_rejected', label: 'برگشت چک', owner: 'مدیر مالی', kind: 'posting', status: WAITING.treasury, source: 'وضعیت فعلی چک (نزد صندوق یا در جریان وصول)',
    lines: [{ account: '1201', side: 'dr', amount: 'cheque.face' }, { account: '@cheque_side', side: 'cr', amount: 'cheque.face' }] },
  { event: 'cash_transferred_to_bank', label: 'واریز وجه صندوق به بانک', owner: 'مدیر مالی', kind: 'posting', status: WAITING.treasury, source: 'رسید حوالهٔ داخلی',
    lines: [{ account: '1102', side: 'dr', amount: 'transfer.amount' }, { account: '1101', side: 'cr', amount: 'transfer.amount' }] },
  { event: 'sales_return', label: 'برگشت از فروش', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ar, source: 'رسید مرجوعی کالا از مشتری',
    lines: [{ account: '5201', side: 'dr', amount: 'return.amount' }, { account: '1201', side: 'cr', amount: 'return.amount' }] },
  { event: 'post_invoice_discount', label: 'بخشودگی پس از صدور فاکتور', owner: 'مدیر چاپخانه', kind: 'posting', status: WAITING.ar, source: 'تخفیفی که در فاکتور نیامده و بعد اعمال می‌شود',
    lines: [{ account: '5201', side: 'dr', amount: 'discount.amount' }, { account: '1201', side: 'cr', amount: 'discount.amount' }] },
  { event: 'purchase_goods_received', label: 'رسید کالا از تأمین‌کننده', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'رسید ورود انبار به بهای خرید',
    lines: [{ account: '1301', side: 'dr', amount: 'receipt.cost' }, { account: '2101', side: 'cr', amount: 'receipt.cost' }] },
  { event: 'freight_on_purchase', label: 'حمل بار به کارخانه', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'فقط یک‌بار همراه رسید کالا؛ در فاکتور دوباره ثبت نمی‌شود',
    lines: [{ account: '6602', side: 'dr', amount: 'freight.amount' }, { account: '2101', side: 'cr', amount: 'freight.amount' }] },
  { event: 'supplier_payment', label: 'پرداخت به تأمین‌کننده', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ap, source: 'سند پرداخت تأمین‌کننده',
    lines: [{ account: '2101', side: 'dr', amount: 'payment.amount' }, { account: '@settlement', side: 'cr', amount: 'payment.amount' }] },
  { event: 'supplier_cheque_issued', label: 'صدور چک به تأمین‌کننده', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ap, source: 'سند چک پرداختنی',
    lines: [{ account: '2101', side: 'dr', amount: 'cheque.face' }, { account: '2102', side: 'cr', amount: 'cheque.face' }] },
  { event: 'supplier_cheque_paid', label: 'پرداخت چک از حساب بانک', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ap, source: 'برداشت از بانک',
    lines: [{ account: '2102', side: 'dr', amount: 'cheque.face' }, { account: '1102', side: 'cr', amount: 'cheque.face' }] },
  { event: 'outsource_invoice', label: 'صورتحساب پیمانکار (برون‌سپاری)', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'فاکتور همکار، بدون اثر بر انبار',
    lines: [{ account: '6501', side: 'dr', amount: 'outsource.amount' }, { account: '2101', side: 'cr', amount: 'outsource.amount' }] },
  { event: 'outsource_to_job', label: 'تخصیص کار پیمانکار به سفارش', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'همان مبلغ، از حساب برون‌سپاری به کار در جریان',
    lines: [{ account: '6101', side: 'dr', amount: 'outsource.amount' }, { account: '6501', side: 'cr', amount: 'outsource.amount' }] },
  { event: 'material_to_job', label: 'صرف مواد به سفارش', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'برگهٔ خروج مواد با بهای میانگینِ موزون انبار',
    lines: [{ account: '6101', side: 'dr', amount: 'issue.cost' }, { account: '1301', side: 'cr', amount: 'issue.cost' }] },
  { event: 'material_returned', label: 'عودت مواد خرج‌نشده به انبار', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'برگهٔ ورود مواد',
    lines: [{ account: '1301', side: 'dr', amount: 'return.cost' }, { account: '6101', side: 'cr', amount: 'return.cost' }] },
  { event: 'labor_to_job', label: 'ثبت دستمزد روی سفارش', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'کارکرد پرسنل به تفکیک سفارش',
    lines: [{ account: '6101', side: 'dr', amount: 'labor.amount' }, { account: '2204', side: 'cr', amount: 'labor.amount' }] },
  { event: 'overhead_incurred', label: 'تحقق سربار ساخت', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'قبوض و هزینه‌های واحد تولید',
    lines: [{ account: '6401', side: 'dr', amount: 'overhead.amount' }, { account: '@settlement', side: 'cr', amount: 'overhead.amount' }] },
  { event: 'overhead_applied', label: 'تخصیص سربار به سفارش', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'نرخ تخصیص × مبنا (ساعت یا تیراژ)',
    lines: [{ account: '6101', side: 'dr', amount: 'overhead.applied' }, { account: '6402', side: 'cr', amount: 'overhead.applied' }] },
  { event: 'abnormal_waste', label: 'ضایعات غیرعادی', owner: 'سرپرست چاپ', kind: 'posting', status: WAITING.costing, source: 'بهایی که از کار در جریان خارج می‌شود',
    lines: [{ account: '6701', side: 'dr', amount: 'waste.abnormal_cost' }, { account: '6101', side: 'cr', amount: 'waste.abnormal_cost' }] },
  { event: 'scrap_to_warehouse', label: 'ورود ضایعات به انبار', owner: 'انباردار', kind: 'posting', status: WAITING.costing, source: 'ضایعات عادیِ با ارزش بازیافتی',
    lines: [{ account: '1303', side: 'dr', amount: 'scrap.cost' }, { account: '6101', side: 'cr', amount: 'scrap.cost' }] },
  { event: 'job_costed_on_delivery', label: 'بستن بهای سفارش هنگام تحویل', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'مجموع کار در جریانِ همان سفارش',
    lines: [{ account: '6102', side: 'dr', amount: 'job.actual_total' }, { account: '6101', side: 'cr', amount: 'job.actual_total' }] },
  { event: 'stock_shortage', label: 'کسر انبار شمارش', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'مابه‌التفاوت شمارش Physical با ماندهٔ سیستم',
    lines: [{ account: '1306', side: 'dr', amount: 'adjustment.value' }, { account: '1301', side: 'cr', amount: 'adjustment.value' }] },
  { event: 'stock_surplus', label: 'اضافات انبار شمارش', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'جهت معکوسِ همان مابه‌التفاوت',
    lines: [{ account: '1301', side: 'dr', amount: 'adjustment.value' }, { account: '1306', side: 'cr', amount: 'adjustment.value' }] },
  { event: 'consignment_received', label: 'تحویل کالای امانی از مشتری', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'رسید بند ۵/الف — ارزش ظاهری، نه بدهکاری واقعی',
    lines: [{ account: '8101', side: 'dr', amount: 'consignment.value' }, { account: '8102', side: 'cr', amount: 'consignment.value' }] },
  { event: 'consignment_consumed', label: 'مصرف کالای امانی مشتری در سفارش', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'خروج از امانت بدون هزینهٔ خرید؛ بهای فروش آن صفر است',
    lines: [{ account: '8102', side: 'dr', amount: 'consumed.value' }, { account: '8101', side: 'cr', amount: 'consumed.value' }] },
  { event: 'consignment_returned', label: 'عودت کالای امانی به مشتری', owner: 'انباردار', kind: 'posting', status: WAITING.warehouse, source: 'رسید خروج امانت',
    lines: [{ account: '8102', side: 'dr', amount: 'returned.value' }, { account: '8101', side: 'cr', amount: 'returned.value' }] },
  { event: 'guarantee_cheque_received', label: 'دریافت چک ضمانت', owner: 'مدیر مالی', kind: 'posting', status: WAITING.treasury, source: 'چک ضمانت مشتری یا پیمانکار',
    lines: [{ account: '8103', side: 'dr', amount: 'guarantee.face' }, { account: '8104', side: 'cr', amount: 'guarantee.face' }] },
  { event: 'guarantee_cheque_returned', label: 'عودت چک ضمانت', owner: 'مدیر مالی', kind: 'posting', status: WAITING.treasury, source: 'پایان تعهد، بدون وجه',
    lines: [{ account: '8104', side: 'dr', amount: 'guarantee.face' }, { account: '8103', side: 'cr', amount: 'guarantee.face' }] },
  { event: 'marketer_commission', label: 'ایجاد تعهد کمیسیون بازاریاب', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ap, source: 'نرخ کمیسیون × فروشِ همان بازاریاب',
    lines: [{ account: '7104', side: 'dr', amount: 'commission.amount' }, { account: '2103', side: 'cr', amount: 'commission.amount' }] },
  { event: 'commission_paid', label: 'پرداخت کمیسیون بازاریاب', owner: 'مدیر مالی', kind: 'posting', status: WAITING.ap, source: 'رسید پرداخت',
    lines: [{ account: '2103', side: 'dr', amount: 'commission.amount' }, { account: '@settlement', side: 'cr', amount: 'commission.amount' }] },
  { event: 'payroll_accrued', label: 'ثبت حقوق و بیمهٔ دوره', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'فیش حقوق پرسنل غیرمستقیم',
    lines: [{ account: '7101', side: 'dr', amount: 'payroll.amount' }, { account: '2204', side: 'cr', amount: 'payroll.amount' }] },
  { event: 'payroll_paid', label: 'پرداخت حقوق از بانک', owner: 'مدیر مالی', kind: 'posting', status: WAITING.costing, source: 'لیست واریز',
    lines: [{ account: '2204', side: 'dr', amount: 'payroll.amount' }, { account: '1102', side: 'cr', amount: 'payroll.amount' }] },

  { event: 'correction_document', kind: 'mechanism', label: 'سند اصلاحی به‌جای ابطال', owner: 'مدیر مالی', status: 'قاعدهٔ کلی — همهٔ اسناد',
    note: 'سند اولیه هرگز حذف یا بازنویسی نمی‌شود. سند اصلاحی در دو بخش ثبت می‌گردد: ۱) برگشت کاملِ خطوط سند مبدأ با تاریخ تازه ۲) ثبت مقادیر درست. جمع دو بخش برابر تفاوتِ خواسته‌شده است و هر دو در سوابق می‌مانند.' },
  { event: 'supplier_invoice_matched', kind: 'mechanism', label: 'مطابقت سه‌طرفهٔ فاکتور تأمین‌کننده', owner: 'مدیر مالی', status: 'قاعدهٔ کلی — خرید',
    note: 'سه برگ (سفارش خرید، رسید کالا، فاکتور) مقایسه می‌شوند. اگر مبلغ یا مقدار تفاوت داشت، مابه‌التفاوت در حساب مغایرت ثبت می‌شود و تا تعیین تکلیف، بدهکار/بستانکار قطعی نمی‌گردد؛ هزینهٔ حمل فقط یک‌بار از طریق قاعدهٔ freight_on_purchase وارد می‌شود.' },
  { event: 'scrap_sold', kind: 'mechanism', label: 'فروش ضایعات', owner: 'انباردار', status: 'قاعدهٔ کلی — ضایعات',
    note: 'وجه دریافتی بدهکار صندوق/بانک و بهای ضایعات از موجودی خارج می‌شود؛ مابه‌التفاوتِ مثبت یا منفی به حساب «سود و زیان فروش ضایعات» می‌رود. چون علامتِ مابه‌التفاوت از پیش معلوم نیست، به‌جای یک قاعدهٔ تک‌خطی، دو حالت (سود/زیان) در زمان ثبت انتخاب می‌شود.' },
  { event: 'cancellation_settlement', kind: 'mechanism', label: 'تسویهٔ سفارش لغوشده', owner: 'مدیر مالی', status: 'قاعدهٔ کلی — لغو',
    note: 'از workflow.cancellationSettlement خوانده می‌شود: کار انجام‌شده و مواد مصرف‌شده به‌عنوان بستانکار فروش/بهای تمام‌شده، وجه دریافتی از پیش‌دریافت کسر، و مانده (به‌کارفرما یا به‌مشتری) در یک سند جدا ثبت می‌شود.' },
  { event: 'opening_balance', kind: 'mechanism', label: 'تراز افتتاحیه', owner: 'مدیر چاپخانه', status: 'یک‌بار در دورهٔ انتقال داده',
    note: 'از فایل ورودی خوانده می‌شود و به‌جای قاعدهٔ ثابت، هر ردیفِ تراز خودش یک خط سند است؛ طرف مقابل همیشه «تراز افتتاحیه» است. پس از تأیید مدیر، سند افتتاحیه قفل می‌شود.' },
];

const byCode = new Map(ACCOUNTS.map(a => [a.code, a]));
/* هر حساب چند قاعدهٔ ثبتی را تغذیه می‌کند؛ برای دیدنِ حساب‌های بی‌کار در میز دایرةالمعارف. */
function usageByAccount() {
  const usage = new Map(ACCOUNTS.map(a => [a.code, []]));
  for (const rule of MAPPINGS) {
    if (rule.kind !== 'posting') continue;
    for (const line of rule.lines) if (usage.has(line.account)) usage.get(line.account).push(rule.event);
  }
  return Object.fromEntries(usage);
}
const expand = key => (COMPOSITES[key] || [key]);
const multiset = lines => lines.flatMap(l => expand(l.amount)).sort().join('|');
const ruleLabel = r => `${r.event} (${r.label})`;

/* اعتبارسنجی ساختاری: هر قاعدهٔ ثبتی باید حساب‌های موجود، یک بدهکار و یک بستانکار،
   و مجموعهٔ مبلغِ یکسان در دو طرف داشته باشد. قواعد مکانیزمی فقط توضیح می‌خواهند. */
function validateCoding() {
  const errors = [];
  const seenCodes = new Set();
  for (const account of ACCOUNTS) {
    if (!/^\d{4}$/.test(account.code)) errors.push(`کد حساب «${account.code}» چهار رقم نیست.`);
    if (seenCodes.has(account.code)) errors.push(`کد حساب ${account.code} تکراری است.`);
    seenCodes.add(account.code);
    if (!['بدهکار', 'بستانکار'].includes(account.nature)) errors.push(`ماهیت حساب ${account.code} نامعلوم است.`);
  }
  const used = new Set();
  const seenEvents = new Set();
  for (const rule of MAPPINGS) {
    if (seenEvents.has(rule.event)) errors.push(`رویداد ${rule.event} دوبار تعریف شده است.`);
    seenEvents.add(rule.event);
    if (rule.kind === 'mechanism') {
      if (typeof rule.note !== 'string' || rule.note.length < 20) errors.push(`قاعدهٔ مکانیزمی ${ruleLabel(rule)} توضیح کافی ندارد.`);
      continue;
    }
    if (rule.kind !== 'posting') { errors.push(`نوع قاعدهٔ ${ruleLabel(rule)} شناخته‌شده نیست.`); continue; }
    const lines = rule.lines || [];
    const debit = lines.filter(l => l.side === 'dr');
    const credit = lines.filter(l => l.side === 'cr');
    if (!debit.length || !credit.length) errors.push(`قاعدهٔ ${ruleLabel(rule)} هر دو طرف بدهکار و بستانکار را ندارد.`);
    if (lines.some(l => l.side !== 'dr' && l.side !== 'cr')) errors.push(`قاعدهٔ ${ruleLabel(rule)} طرفِ ناشناس دارد.`);
    for (const line of lines) {
      const key = line.account;
      if (key.startsWith('@')) {
        const resolver = RESOLVERS.find(r => r.key === key);
        if (!resolver) errors.push(`گردگیر ${key} در قاعدهٔ ${ruleLabel(rule)} تعریف نشده است.`);
        continue;
      }
      if (!byCode.has(key)) { errors.push(`حساب ${key} در قاعدهٔ ${ruleLabel(rule)} در کدینگ نیست.`); continue; }
      used.add(key);
      if (!COMPOSITES[line.amount] && !/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z_]*$/.test(line.amount)) errors.push(`عبارت مبلغ «${line.amount}» در ${ruleLabel(rule)} سازگار نیست.`);
    }
    if (debit.length && credit.length && multiset(debit) !== multiset(credit)) errors.push(`قاعدهٔ ${ruleLabel(rule)} متوازن نیست: بدهکار [${multiset(debit)}] ≠ بستانکار [${multiset(credit)}].`);
  }
  const unused = ACCOUNTS.filter(a => a.code < '8000' && !used.has(a.code)).map(a => a.code);
  const posting = MAPPINGS.filter(r => r.kind === 'posting');
  const readyNow = posting.filter(r => r.status === READY);
  return {
    ok: errors.length === 0, errors,
    stats: {
      accounts: ACCOUNTS.length, rules: MAPPINGS.length, posting: posting.length,
      mechanisms: MAPPINGS.length - posting.length, balanced: posting.filter(r => { const d = r.lines.filter(l => l.side === 'dr'), c = r.lines.filter(l => l.side === 'cr'); return multiset(d) === multiset(c); }).length,
      readyNow: readyNow.length, waiting: posting.length - readyNow.length, unusedAccounts: unused,
    },
  };
}

const amountOf = (facts, key) => {
  const direct = facts[key];
  if (Number.isSafeInteger(direct) && direct >= 0) return direct;
  const parts = COMPOSITES[key];
  if (!parts) return null;
  let total = 0n;
  for (const part of parts) { const value = amountOf(facts, part); if (value === null) return null; total += BigInt(value); }
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
};
/* نام بردنِ جزءِ غایب به‌جای عبارت مرکب: اپراتور باید بفهمد کدام عدد کم است. */
const missingLeaves = (facts, key) => {
  if (Number.isSafeInteger(facts[key]) && facts[key] >= 0) return [];
  const parts = COMPOSITES[key];
  if (!parts) return [key];
  return parts.flatMap(part => missingLeaves(facts, part));
};

/* پیش‌نویس سند از دادهٔ واقعی: هر مبلغِ غایب، منفی یا نامتوازن یعنی «ثبت نشد».
   هیچ عددی ساخته نمی‌شود و هیچ سندی اینجا نوشته نمی‌شود. */
function draftFor(event, facts = {}) {
  const rule = MAPPINGS.find(r => r.event === event);
  if (!rule) return { ok: false, code: 'UNMAPPED', error: 'این رویداد در نگاشت سند تعریف نشده است؛ ثبت نمی‌شود.' };
  if (rule.kind !== 'posting') return { ok: false, code: 'MECHANISM', error: rule.note };
  const source = facts && typeof facts === 'object' ? facts : {};
  const lines = [];
  for (const line of rule.lines) {
    let code = line.account;
    if (code === '@settlement') {
      code = SETTLEMENT_ROUTES[String(source.method || '')];
      if (!code) return { ok: false, code: 'VALIDATION_FAILED', error: 'روش پرداخت مشخص نیست؛ حساب تسویه تعیین نمی‌شود.' };
    } else if (code === '@cheque_side') {
      code = CHEQUE_SIDE_ROUTES[String(source.chequeState || '')];
      if (!code) return { ok: false, code: 'VALIDATION_FAILED', error: 'وضعیت چک مشخص نیست (نزد صندوق یا در جریان وصول).' };
    }
    const amount = amountOf(source, line.amount);
    if (amount === null) {
      const missing = missingLeaves(source, line.amount);
      return { ok: false, code: 'VALIDATION_FAILED', error: missing.length === 1 ? `مبلغ «${missing[0]}» در دسترس نیست یا معتبر نیست؛ چیزی ساخته نمی‌شود.` : `اجزای «${line.amount}» (${missing.join(' و ')}) در دسترس نیستند؛ چیزی ساخته نمی‌شود.` };
    }
    const account = byCode.get(code);
    lines.push({ code, title: account.title, group: account.group, side: line.side, amount, expression: line.amount });
  }
  const debit = lines.filter(l => l.side === 'dr').reduce((sum, l) => sum + BigInt(l.amount), 0n);
  const credit = lines.filter(l => l.side === 'cr').reduce((sum, l) => sum + BigInt(l.amount), 0n);
  if (debit !== credit) return { ok: false, code: 'UNBALANCED', error: `جمع بدهکار (${debit}) با بستانکار (${credit}) برابر نیست؛ سند ثبت نمی‌شود.` };
  return { ok: true, event, rule: { kind: rule.kind, label: rule.label, owner: rule.owner, source: rule.source, status: rule.status }, lines, total: Number(debit) };
}

/* متن آمادهٔ نمایش برای رابط: دو طرف سند از چپ به راست، به‌همراه نام حساب یا گردگیر آن. */
const accountName = key => {
  if (key.startsWith('@')) return RESOLVERS.find(r => r.key === key)?.label || key;
  const account = byCode.get(key);
  return account ? `${account.title} (${account.code})` : key;
};
const ruleView = rule => ({
  event: rule.event, label: rule.label, owner: rule.owner, kind: rule.kind, status: rule.status, source: rule.source || '',
  debit: (rule.lines || []).filter(l => l.side === 'dr').map(l => `${accountName(l.account)} ← ${l.amount}`).join(' + '),
  credit: (rule.lines || []).filter(l => l.side === 'cr').map(l => `${accountName(l.account)} ← ${l.amount}`).join(' + '),
  note: rule.note || '',
});

module.exports = {
  ACCOUNTS, MAPPINGS, COMPOSITES, RESOLVERS, SETTLEMENT_ROUTES, CHEQUE_SIDE_ROUTES,
  validateCoding, draftFor, ruleLabel, usageByAccount, ruleView, accountName,
};
