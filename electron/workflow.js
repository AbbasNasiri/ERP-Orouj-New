'use strict';

// Pure rules: persistence and notification delivery belong to the backend.
const { randomUUID } = require('crypto');
const billing = require('./billing');
const MANAGER = 'مدیر چاپخانه';
const FINANCE = 'مدیر مالی';
const QC = 'ناظر کیفیت';
const STAFF = [MANAGER, FINANCE, 'کارشناس سفارشات', 'انباردار', QC, 'سرپرست لیتوگرافی', 'سرپرست چاپ دیجیتال', 'سرپرست چاپ', 'سرپرست صحافی'];
/* اصلاحات ۱۷/بند ۳ (تصمیم کارفرما به پرسش ۱): «کار کنترل کیفیت جزو شرح وظایف ناظر کیفیت
   هست نه شخص دیگر». تنها همین نقش «سالم» می‌نویسد — نه مدیر، نه مالی، نه کارشناس سفارشات.
   ردیفِ تحویل جای خودش می‌ماند (تحویل را همان‌هایی که تحویل را امضا می‌کنند ثبت می‌کنند). */
const QUALITY_ROLES = [QC];
const START_STAGE = 'ثبت سفارش';
const FINAL_STAGE = 'کنترل کیفیت و تحویل به مشتری';
const DELIVERY_STAGE = 'تحویل';
const OFFSET_PATH = [START_STAGE, 'طراحی و پروف', 'لیتوگرافی و زینک', 'چاپ افست', 'صحافی و تکمیلی', FINAL_STAGE];
const DIGITAL_PATH = [START_STAGE, 'طراحی و پروف', 'چاپ دیجیتال', 'برش و تکمیلی', FINAL_STAGE];
// Old items that already sit inside the nine-stage track keep walking it until the one-time migration.
const LEGACY_PATH = [START_STAGE, 'طراحی', 'پروف', 'لیتوگرافی', 'چاپ', 'صحافی', 'خدمات تکمیلی', 'کنترل کیفیت', DELIVERY_STAGE];
// Whitelist only: the three lists are not comparable by index, so order progress uses orderStage().
const ALL_STAGES = [...new Set([...OFFSET_PATH, ...DIGITAL_PATH, ...LEGACY_PATH])];
/* اصلاحات ۱۷/بند ۳ (تصمیم کارفرما): سه عدد هر قلم دو جا ثبت می‌شود — «سالم» در کنترل کیفیت
   و «تحویل‌قابل‌صورتحساب» در همان لحظهٔ تحویل. در مسیرهای جدید کنترل کیفیت و تحویل یک مرحله
   است، پس هر دو عدد در همان مرحلهٔ آخر نوشته می‌شوند؛ «کنترل کیفیت» جدایی فقط در مسیر قدیمی هست. */
const COUNT_STAGES = ['کنترل کیفیت', FINAL_STAGE, DELIVERY_STAGE];
const STAGE_ROLES = {
  'لیتوگرافی و زینک': ['سرپرست لیتوگرافی'],
  'چاپ افست': ['سرپرست چاپ'],
  'چاپ دیجیتال': ['سرپرست چاپ دیجیتال'],
  'صحافی و تکمیلی': ['سرپرست صحافی'], 'برش و تکمیلی': ['سرپرست صحافی'], [FINAL_STAGE]: ['سرپرست صحافی'],
  'لیتوگرافی': ['سرپرست لیتوگرافی'],
  'چاپ': ['سرپرست چاپ', 'سرپرست چاپ دیجیتال'],
  'صحافی': ['سرپرست صحافی'], 'خدمات تکمیلی': ['سرپرست صحافی'], 'کنترل کیفیت': ['سرپرست صحافی'],
};
// Who may declare that a section's work is finished and release it to the next section.
const STAGE_COMPLETE_ROLES = {
  [START_STAGE]: ['کارشناس سفارشات'], [FINAL_STAGE]: ['کارشناس سفارشات', FINANCE],
  'طراحی و پروف': ['کارشناس سفارشات'], 'لیتوگرافی و زینک': ['سرپرست لیتوگرافی'],
  'چاپ افست': ['سرپرست چاپ'], 'چاپ دیجیتال': ['سرپرست چاپ دیجیتال'],
  'صحافی و تکمیلی': ['سرپرست صحافی'], 'برش و تکمیلی': ['سرپرست صحافی'],
  'طراحی': ['کارشناس سفارشات'], 'پروف': ['کارشناس سفارشات'],
  'لیتوگرافی': ['سرپرست لیتوگرافی'],
  'چاپ': ['سرپرست چاپ', 'سرپرست چاپ دیجیتال'],
  'صحافی': ['سرپرست صحافی'], 'خدمات تکمیلی': ['سرپرست صحافی'], 'کنترل کیفیت': ['سرپرست صحافی'],
  [DELIVERY_STAGE]: ['کارشناس سفارشات', FINANCE],
};
const HOLD_REASONS = [
  { key: 'manager', label: 'عدم تأیید مدیر', role: MANAGER, detail: 'اجازهٔ شروع تولید توسط مدیر چاپخانه ثبت نشده است.' },
  { key: 'order', label: 'عدم تأیید سفارش', role: 'کارشناس سفارشات', detail: 'تأیید مشتری برای نسخهٔ فعلی ثبت نشده است.' },
  { key: 'finance', label: 'عدم تأیید مالی', role: FINANCE, detail: 'پیش‌فاکتور یا پیش‌پرداخت هنوز توسط مالی تأیید نشده است.' },
];
const fail = (message, code = 'VALIDATION_FAILED') => { const e = new Error(message); e.code = code; throw e; };
const requireRole = (actor, roles, message) => { if (!actor || !roles.includes(actor.role)) fail(message || 'اجازهٔ انجام این عملیات را ندارید.', 'FORBIDDEN'); };
const text = (value, label) => { if (typeof value !== 'string' || value.trim().length < 3 || value.length > 2000) fail(`${label} باید حداقل سه حرف و حداکثر ۲۰۰۰ نویسه باشد.`); return value.trim(); };
const note = (value) => { if (value === undefined || value === null || value === '') return ''; if (typeof value !== 'string' || value.length > 2000) fail('شرح تأیید مرحله حداکثر ۲۰۰۰ نویسه است.'); return value.trim(); };
const amount = (value, label) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) fail(`${label} معتبر نیست.`); return value; };
const isoDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const itemPathKey = (item) => (item && item.spec && item.spec.printMethod === 'دیجیتال' ? 'digital' : 'offset');
const pathLabel = (item) => (itemPathKey(item) === 'digital' ? 'دیجیتال' : 'افست');
function stagesFor(item) {
  const stage = (item && item.stage) || START_STAGE;
  if (stage !== START_STAGE && LEGACY_PATH.includes(stage)) return LEGACY_PATH;
  const own = itemPathKey(item) === 'digital' ? DIGITAL_PATH : OFFSET_PATH;
  const other = own === DIGITAL_PATH ? OFFSET_PATH : DIGITAL_PATH;
  return own.includes(stage) ? own : (other.includes(stage) ? other : own);
}
const isDeliveryStage = (stage) => stage === FINAL_STAGE || stage === DELIVERY_STAGE;
const finalStageFor = (item) => { const list = stagesFor(item); return list[list.length - 1]; };
const isDeliveredItem = (item) => !!(item && item.stageCompletions && item.stageCompletions[finalStageFor(item)]);
const stageIndex = (item) => { const list = stagesFor(item); return Math.max(0, list.indexOf((item && item.stage) || START_STAGE)); };
/* The two paths have different lengths, so the order-level stage is the least advanced item measured
   as a fraction of its own path; for single-path orders this is identical to the old index rule. */
function orderStage(order) {
  const items = (order && order.items) || [];
  if (!items.length) return { stage: START_STAGE, path: 'offset', pathLabel: 'افست' };
  let slowest;
  for (const it of items) {
    const list = stagesFor(it);
    const progress = stageIndex(it) / (list.length - 1);
    if (!slowest || progress < slowest.progress) slowest = { stage: list[stageIndex(it)], path: itemPathKey(it), pathLabel: pathLabel(it), progress };
  }
  return slowest;
}
/* Read-only: why an open order still sits in the hold box. Persisted fields only — nothing invented. */
function holdState(order, facts = {}) {
  if (!order || order.deliveredAt || ['تحویل شده', 'لغو شده', 'بایگانی', 'متوقف'].includes(order.status)) return { held: false, reasons: [] };
  const wf = order.workflow || {};
  const rev = Number(order.quoteRev) || 1;
  const reasons = [];
  if (!wf.productionAuthorization) reasons.push({ ...HOLD_REASONS[0] });
  const confirmed = !!wf.customerConfirmation && wf.customerConfirmation.quoteRevision === rev;
  const items = order.items || [];
  const referred = items.length > 0 && items.some(it => stageIndex(it) > 0);
  if (!confirmed || !referred) reasons.push({ ...HOLD_REASONS[1], detail: confirmed ? 'مسئول سفارشات هنوز قلم را به مرحلهٔ بعدی ارجاع نداده است.' : HOLD_REASONS[1].detail });
  if (facts.financeApproved !== true) reasons.push({ ...HOLD_REASONS[2] });
  return { held: reasons.length > 0, reasons };
}
const holdReasons = (order, facts = {}) => holdState(order, facts).reasons;

/* عددهای بند ۳ فقط برای قلمی معنا دارد که کارش به کنترل کیفیت یا تحویل رسیده است؛
   شمارهِ تولید پیش از آن مرحله وجود ندارد، و اجازهٔ تولید همان مرحلهٔ قبل است. */
function countItem(order, workflow, payload, stageLabel) {
  if (!workflow.productionAuthorization || !workflow.customerConfirmation || workflow.customerConfirmation.quoteRevision !== (Number(order.quoteRev) || 1)) fail('برای ثبت عددهای تولید، اجازهٔ معتبر مدیر و تأیید مشتری برای نسخهٔ فعلی لازم است.');
  if (workflow.stop || ['متوقف', 'لغو شده', 'بایگانی', 'تحویل شده'].includes(order.status)) fail('سفارش متوقف یا بسته است؛ عددِ تولید در آن ثبت نمی‌شود.');
  const item = (order.items || []).find(it => it.id === payload.itemId);
  if (!item) fail('قلم سفارش یافت نشد.', 'NOT_FOUND');
  const stage = item.stage || START_STAGE;
  if (!COUNT_STAGES.includes(stage)) fail(`${stageLabel} فقط وقتی قلم در مرحلهٔ کنترل کیفیت یا تحویل است ثبت می‌شود؛ این قلم در «${stage}» است.`);
  return { item, stage };
}

function applyOrderAction(original, action, payload, actor, options = {}) {
  requireRole(actor, STAFF);
  if (!original || typeof original.id !== 'string') fail('سفارش یافت نشد.', 'NOT_FOUND');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('اطلاعات عملیات معتبر نیست.');
  // A delivered order is closed: no production, stage, stop or settlement action may touch it.
  if (original.status === 'تحویل شده' || original.deliveredAt) fail('این سفارش تحویل شده و هیچ تغییری در آن مجاز نیست.', 'FORBIDDEN');
  const at = (options.now || Date.now)();
  const date = new Date(at).toISOString().slice(0, 10);
  const who = { id: actor.id, name: actor.name, role: actor.role };
  const order = structuredClone(original);
  const workflow = { ...(order.workflow || {}), revision: ((order.workflow || {}).revision || 0) + 1 };
  const notifications = [];
  const notify = (audience, message) => notifications.push({ audience, message, orderId: order.id, customerId: order.customerId || '', orderNumber: String(order.orderNumber || '') });
  let message;

  switch (action) {
    case 'change_stage': {
      if (!workflow.productionAuthorization || !workflow.customerConfirmation || workflow.customerConfirmation.quoteRevision !== (Number(order.quoteRev) || 1)) fail('اجازهٔ معتبر مدیر و تأیید مشتری برای نسخهٔ فعلی لازم است.');
      if (workflow.stop || ['در انتظار تایید', 'درخواست مشتری', 'متوقف', 'لغو شده', 'بایگانی', 'تحویل شده'].includes(order.status)) fail('سفارش متوقف، بسته یا فاقد مجوز تولید است.');
      const item = (order.items || []).find(it => it.id === payload.itemId);
      if (!item) fail('قلم سفارش یافت نشد.', 'NOT_FOUND');
      const list = stagesFor(item);
      const before = list.indexOf(item.stage || START_STAGE);
      if (!list.includes(payload.newStage)) fail(`«${payload.newStage || '—'}» در مسیر ${pathLabel(item)} این قلم نیست؛ هر قلم فقط در مسیر خودش جلو می‌رود.`);
      const after = list.indexOf(payload.newStage);
      if (before < 0 || after < 0 || after <= before) fail('حرکت مرحله باید به مرحلهٔ معتبر بعدی باشد؛ برگشت نیازمند ثبت دوباره‌کاری است.');
      requireRole(actor, [MANAGER, ...(STAGE_ROLES[payload.newStage] || [])]);
      if (after > before + 1) {
        requireRole(actor, [MANAGER]);
        text(payload.reason, 'دلیل عبور از مراحل');
      }
      item.stage = payload.newStage;
      message = `مرحلهٔ قلم سفارش (${pathLabel(item)}) از «${list[before]}» به «${payload.newStage}» تغییر کرد`;
      if (payload.reason) message += ` — ${text(payload.reason, 'دلیل تغییر مرحله')}`;
      notify('staff', message);
      break;
    }
    case 'complete_stage': {
      if (!workflow.productionAuthorization || !workflow.customerConfirmation || workflow.customerConfirmation.quoteRevision !== (Number(order.quoteRev) || 1)) fail('اجازهٔ معتبر مدیر و تأیید مشتری برای نسخهٔ فعلی لازم است.');
      if (workflow.stop || ['در انتظار تایید', 'درخواست مشتری', 'متوقف', 'لغو شده', 'بایگانی', 'تحویل شده'].includes(order.status)) fail('سفارش متوقف، بسته یا فاقد مجوز تولید است.');
      const item = (order.items || []).find(it => it.id === payload.itemId);
      if (!item) fail('قلم سفارش یافت نشد.', 'NOT_FOUND');
      const current = item.stage || START_STAGE;
      const list = stagesFor(item);
      const before = list.indexOf(current);
      if (before < 0) fail('مرحلهٔ فعلی قلم سفارش معتبر نیست.');
      // The caller must name the section it saw; a second click with the old section cannot close the next one.
      if (payload.stage !== current) fail('مرحلهٔ قلم سفارش تغییر کرده است؛ فهرست را تازه کنید.', 'STAGE_CONFLICT');
      requireRole(actor, [MANAGER, ...(STAGE_COMPLETE_ROLES[current] || [])]);
      if (item.stageCompletions && item.stageCompletions[current]) fail(`مرحلهٔ «${current}» قبلاً به پایان رسیده و انجام کار در آن مجاز نیست.`);
      const reason = note(payload.note);
      const nextStage = before < list.length - 1 ? list[before + 1] : null;
      const delivery = nextStage === null;
      item.stageCompletions = { ...(item.stageCompletions || {}), [current]: { at, by: who, note: reason, nextStage } };
      const items = order.items || [];
      if (delivery) {
        const allDelivered = items.every(isDeliveredItem);
        if (allDelivered) {
          order.status = 'تحویل شده';
          order.deliveredAt = date;
          order.deliveredBy = who;
        }
        message = allDelivered ? 'تحویل سفارش به مشتری ثبت شد؛ سفارش بسته شد و تغییر در آن مجاز نیست.' : 'تحویل قلم سفارش به مشتری ثبت شد.';
        if (reason) message += ` — ${reason}`;
        notify('staff', message);
        notify('management', message);
        notify('finance', 'تحویل سفارش ثبت شد؛ صدور فاکتور و تسویهٔ نهایی را بررسی کنید.');
        notify('customer', 'سفارش شما تحویل داده شد.');
      } else {
        item.stage = nextStage;
        message = `مرحلهٔ «${current}» با تأیید نهایی پایان یافت و قلم سفارش به «${nextStage}» ارسال شد.`;
        if (reason) message += ` — ${reason}`;
        notify('staff', message);
        if (items.length && items.every(it => isDeliveryStage(it.stage || START_STAGE))) {
          order.status = 'آماده تحویل';
          notify('management', 'همهٔ اقلام سفارش آمادهٔ تحویل به مشتری است.');
        }
      }
      break;
    }
    case 'record_quality': {
      const { item } = countItem(order, workflow, payload, 'تعداد سالم');
      requireRole(actor, QUALITY_ROLES, 'تعداد سالم را فقط «ناظر کیفیت» ثبت می‌کند — کارِ کنترل کیفیت جزو شرح وظایف همین نقش است.');
      /* ثبت‌شده ویرایش نمی‌شود: عددِ تولید مثل سند مالی، تاریخچه می‌خواهد. راه تغییر،
         سند اصلاحیِ بند ۴ است، نه نوشتن دوباره روی همان خانه. */
      if (item.quality) fail('تعداد سالمِ این قلم پیش‌تر ثبت شده است؛ برای تغییر آن سند اصلاحی لازم است (بند ۴).');
      item.quality = billing.qualityOf({ ...payload, at: payload.at || date }, who);
      const unit = item.qtyUnit || 'نسخه';
      message = `تعداد سالمِ قلم (${pathLabel(item)}) ثبت شد: ${item.quality.good.toLocaleString('fa-IR')} ${unit}`;
      if (item.quality.note) message += ` — ${item.quality.note}`;
      notify('staff', message);
      notify('finance', `کنترل کیفیت ${order.orderNumber || ''} ثبت شد؛ عددهای قابل صورتحساب در فاکتور تحویلی خوانده می‌شود.`);
      break;
    }
    case 'record_delivery': {
      const { item, stage } = countItem(order, workflow, payload, 'تحویل');
      requireRole(actor, [MANAGER, ...(STAGE_COMPLETE_ROLES[stage] || [])]);
      /* هر تحویلِ بخشی یک ردیفِ تازه است و هیچ ردیفِ قبلی عوض نمی‌شود؛ شناسه را سرور
         می‌سازد تا ایستگاه نتواند ردیفِ دیگری را بازنویسی کند. */
      const row = billing.deliveryOf({ ...payload, id: randomUUID(), at: payload.at || date }, who);
      if (!row.billable) fail('تعداد تحویل‌قابل‌صورتحساب باید بیشتر از صفر باشد.');
      const already = (item.deliveries || []).reduce((sum, d) => sum + d.billable, 0);
      const good = item.quality ? item.quality.good : null;
      if (good !== null && already + row.billable > good) {
        fail(`جمع تحویل (${(already + row.billable).toLocaleString('fa-IR')}) از تعداد سالمِ ثبت‌شده (${good.toLocaleString('fa-IR')}) بیشتر است؛ یا عددِ تحویل را درست کنید یا تعداد سالم را با سند اصلاحی تعیین تکلیف کنید.`);
      }
      item.deliveries = [...(item.deliveries || []), row];
      const unit = item.qtyUnit || 'نسخه';
      message = `تحویل قلم (${pathLabel(item)}) ثبت شد: ${row.billable.toLocaleString('fa-IR')} ${unit}${row.note ? ` — ${row.note}` : ''}`;
      notify('staff', message);
      notify('customer', `بخشی از سفارش شما تحویل داده شد: ${row.billable.toLocaleString('fa-IR')} ${unit}`);
      notify('finance', `تحویل بخشی ${order.orderNumber || ''} ثبت شد؛ برای این مقدار فاکتور تحویلی قابل صدور است.`);
      break;
    }
    case 'confirm_customer': {
      requireRole(actor, [MANAGER, FINANCE, 'کارشناس سفارشات']);
      if (['درخواست مشتری', 'بایگانی', 'لغو شده', 'تحویل شده', 'متوقف'].includes(order.status)) fail('این سفارش در وضعیت مناسب ثبت تأیید مشتری نیست.');
      if (workflow.productionAuthorization) fail('تغییر تأیید سفارش در حال تولید نیازمند بازنگری سفارش است.');
      const evidence = text(payload.evidence, 'شرح تأیید مشتری');
      workflow.customerConfirmation = { at, by: who, evidence, quoteRevision: Number(order.quoteRev) || 1 };
      message = 'تأیید مشتری ثبت شد؛ منتظر اجازهٔ مدیر چاپخانه';
      notify('management', message);
      break;
    }
    case 'release_production': {
      requireRole(actor, [MANAGER]);
      if (!workflow.customerConfirmation || workflow.customerConfirmation.quoteRevision !== (Number(order.quoteRev) || 1)) fail('ابتدا تأیید مشتری برای نسخهٔ فعلی سفارش ثبت شود.');
      if (order.status !== 'در انتظار تایید' || workflow.stop || workflow.productionAuthorization) fail('این سفارش در وضعیت مناسب اجازهٔ اولیهٔ تولید نیست.');
      const badItem = (order.items || []).findIndex(it => it && it.analysis && (it.analysis.ok === false || (it.analysis.errors || []).length));
      if (badItem >= 0) fail(`قلم ${badItem + 1} خطای محاسبه دارد (مثلاً تعداد صفحهٔ غیرقابل فرم‌بندی)؛ پس از اصلاح و محاسبهٔ دوباره می‌توان اجازهٔ تولید داد.`);
      const review = payload.materialReview;
      if (!review || review.checked !== true || !Array.isArray(review.shortages)) fail('بررسی مواد اولیه باید ثبت شود.');
      if (review.shortages.length > 100) fail('تعداد کسری‌های مواد معتبر نیست.');
      const shortages = review.shortages.map(s => {
        const description = text(s.description, 'شرح مادهٔ موردنیاز');
        const qty = amount(s.qty, 'مقدار کسری');
        if (qty <= 0 || !isoDay(s.dueDate) || s.dueDate < date) fail('مقدار کسری و مهلت تأمین باید معتبر و موعد از امروز به بعد باشد.');
        return { description, qty, unit: text(s.unit || 'عدد', 'واحد مقدار'), dueDate: s.dueDate, responsibleRole: FINANCE, state: 'pending' };
      });
      if (options.hasOpenDebt && payload.debtApproved !== true) fail('مشتری بدهی باز دارد؛ اجازهٔ صریح مدیر برای ادامه لازم است.');
      /* اصلاحات ۱۷/بند ۱: رمز مدیر تنها کنترل نیست. ادامه با بدهی باز سند می‌خواهد — چه کسی،
         چه زمانی، کدام سفارش، به چه مبلغی و با چه دلیلی. سرور آن را در credit_approvals می‌نویسد
         و این‌جا فقط همان سند به اجازهٔ تولید وصل می‌شود (دادهٔ مبلغ از client خوانده نمی‌شود). */
      let debtApproval = null;
      if (options.hasOpenDebt) {
        const a = options.creditApproval;
        if (!a || typeof a.reason !== 'string' || a.reason.trim().length < 10) fail('مجوز مستند بدهی ثبت نشده است؛ دلیل مجوز (حداقل ۱۰ نویسه) باید در پرونده باشد — رمز مدیر به‌تنهایی کافی نیست.');
        debtApproval = { id: a.id || null, reason: a.reason.trim(), at, by: (typeof a.decidedBy === 'string' && a.decidedBy) ? a.decidedBy : who.name, amount: a.openTotal, overBy: a.overBy, ceiling: a.ceiling };
      }
      workflow.materialReview = { at, by: who, shortages };
      workflow.productionAuthorization = { at, by: who, debtApproved: options.hasOpenDebt ? true : false, conditional: shortages.length > 0, ...(debtApproval ? { creditApproval: debtApproval } : {}) };
      if (options.hasOpenDebt) order.managerOverrideDebt = true;
      order.status = 'تایید شده';
      order.approvedAt = date;
      order.onHold = false;
      order.holdReason = '';
      message = shortages.length ? 'اجازهٔ مشروط مدیر برای شروع بخش‌های آماده؛ تأمین کسری به مالی ارجاع شد' : 'اجازهٔ مدیر چاپخانه برای شروع تولید ثبت شد';
      if (debtApproval) message += ` — با مجوز مستند بدهی (${debtApproval.by})`;
      notify('staff', message);
      notify('customer', 'سفارش شما برای شروع تولید تأیید شد.');
      if (shortages.length) { notify('finance', 'تأمین کسری مواد با مهلت تعیین‌شده به شما ارجاع شد.'); notify('management', 'سفارش با تعهد تأمین مواد و اجازهٔ مشروط وارد تولید شد.'); }
      /* اطلاع به مالی: بدهیِ این مشتری با سند مدیر ادامه افتاد (بدون رقم، تا برای نقشِ بی‌مبلغ فاش نشود). */
      if (debtApproval) { notify('finance', `ادامهٔ تولید با بدهی باز — مجوز مستند ${debtApproval.by}: ${debtApproval.reason}`); notify('management', 'سند مجوز اعتبار به پروندهٔ مشتری افزوده شد.'); }
      break;
    }
    case 'stop': {
      if (payload.customerRequest !== true) fail('این مسیر مخصوص ثبت درخواست توقف یا لغو مشتری است.');
      if (['تحویل شده', 'بایگانی'].includes(order.status)) fail('برای سفارش تحویل‌شده یا بایگانی‌شده توقف تولید ثبت نمی‌شود.');
      if (order.status === 'لغو شده') fail('سفارش قبلاً لغو شده است.');
      const kind = payload.kind;
      if (!['pause', 'cancel'].includes(kind)) fail('نوع درخواست مشتری باید توقف موقت یا لغو باشد.');
      if (workflow.stop && kind === 'pause') fail('سفارش هم‌اکنون متوقف است.');
      const reason = text(payload.reason, 'دلیل درخواست مشتری');
      const previousStatus = workflow.stop ? workflow.stop.previousStatus : order.status;
      workflow.stop = { kind, reason, at, by: who, customerRequest: true, previousStatus };
      order.status = kind === 'cancel' ? 'لغو شده' : 'متوقف';
      message = kind === 'cancel' ? 'لغو به درخواست مشتری؛ اجرای کار فوراً متوقف شد' : 'توقف فوری به درخواست مشتری';
      notify('management', message);
      notify('staff', message);
      notify('partners', 'درخواست توقف سفارش برای پیگیری و ابلاغ به همکاران ثبت شد.');
      if (kind === 'cancel') notify('finance', 'سفارش لغو شد؛ تعیین تکلیف هزینه‌ها و تسویه لازم است.');
      break;
    }
    case 'resume': {
      requireRole(actor, [MANAGER]);
      if (!workflow.stop || workflow.stop.kind !== 'pause' || order.status !== 'متوقف') fail('فقط سفارش دارای توقف موقت قابل ادامه است؛ سفارش لغوشده نیازمند بازنگری است.');
      const reason = text(payload.reason, 'دلیل ادامهٔ کار');
      if (workflow.productionAuthorization && (!workflow.customerConfirmation || workflow.customerConfirmation.quoteRevision !== (Number(order.quoteRev) || 1))) fail('تأیید مشتری برای نسخهٔ فعلی سفارش معتبر نیست.');
      order.status = workflow.stop.previousStatus;
      workflow.lastStop = workflow.stop;
      workflow.stop = null;
      workflow.lastResume = { at, by: who, reason };
      message = 'اجازهٔ مدیر چاپخانه برای ادامهٔ سفارش ثبت شد';
      notify('staff', message);
      notify('management', message);
      notify('customer', 'ادامهٔ رسیدگی به سفارش شما ثبت شد.');
      break;
    }
    case 'settle_cancellation': {
      requireRole(actor, [MANAGER, FINANCE]);
      if (!workflow.stop || workflow.stop.kind !== 'cancel' || order.status !== 'لغو شده') fail('تسویهٔ لغو فقط برای سفارش لغوشده ثبت می‌شود.');
      const services = amount(payload.services, 'کار انجام‌شده');
      const materials = amount(payload.materials, 'مواد مصرف‌شده');
      const partners = amount(payload.partners, 'تعهدات همکاران');
      const paid = amount(payload.paid, 'وجه دریافتی');
      const explanation = text(payload.explanation, 'شرح تسویه');
      const total = services + materials + partners;
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(paid)) fail('مبالغ تسویه باید عدد صحیح در واحد پول برنامه باشند.');
      workflow.cancellationSettlement = { at, by: who, services, materials, partners, paid, total, balance: total - paid, explanation, revision: ((workflow.cancellationSettlement || {}).revision || 0) + 1 };
      message = 'تسویهٔ لغو توسط مالی تعیین شد؛ اطلاع مدیر و صورت‌حساب مشتری در صف قرار گرفت';
      notify('management', 'تعیین تکلیف مالی سفارش لغوشده ثبت شد.');
      notify('customer', 'صورت‌حساب تسویهٔ سفارش لغوشده برای ارائه به مشتری آماده است.');
      break;
    }
    default: fail('عملیات گردش کار شناخته‌شده نیست.');
  }
  order.workflow = workflow;
  const event = { id: randomUUID(), action, at, actor: who, orderId: order.id, message, revision: workflow.revision };
  // No financial figures in shared history. Detailed financial data stays in its protected field.
  order.history = [...(order.history || []), { id: event.id, date, text: message, by: actor.name }];
  return { order, event, notifications };
}

module.exports = {
  applyOrderAction, MANAGER, FINANCE, STAFF,
  STAGES: ALL_STAGES, ALL_STAGES, OFFSET_PATH, DIGITAL_PATH, LEGACY_PATH, START_STAGE, FINAL_STAGE, COUNT_STAGES,
  STAGE_ROLES, STAGE_COMPLETE_ROLES, HOLD_REASONS, QUALITY_ROLES, QC,
  itemPathKey, pathLabel, stagesFor, isDeliveryStage, finalStageFor, isDeliveredItem, stageIndex, orderStage, holdState, holdReasons,
};
