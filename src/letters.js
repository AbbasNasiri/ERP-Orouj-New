/* نامه‌ی اداری A5: واحدهای چاپخانه به مدیر چاپخانه درخواست می‌دهند (خرید مواد، تعمیرکار، مساعده، مرخصی و ...) */
import { normalizeDigits } from './smart.js';

export const UNITS = ['انبار', 'لیتوگرافی', 'چاپ دیجیتال', 'چاپ افست', 'صحافی و تکمیلی', 'سفارشات', 'طراحی', 'امور مالی', 'سایر'];
export const LETTER_TYPES = {
  material: { title: 'درخواست خرید مواد اولیه', fields: [['item', 'مواد مورد نیاز'], ['qty', 'مقدار'], ['reason', 'دلیل / سفارش مرتبط']] },
  repair: { title: 'درخواست اعزام تعمیرکار / سرویسکار', fields: [['machine', 'دستگاه یا تجهیزات'], ['problem', 'شرح خرابی'], ['urgency', 'میزان فوریت']] },
  goods: { title: 'درخواست خرید کالا', fields: [['item', 'کالا'], ['qty', 'تعداد'], ['price', 'برآورد قیمت (ریال)'], ['reason', 'دلیل نیاز']] },
  advance: { title: 'درخواست مساعده', fields: [['amount', 'مبلغ (ریال)'], ['reason', 'دلیل'], ['repay', 'نحوه‌ی بازپرداخت']] },
  leave: { title: 'درخواست مرخصی', fields: [['leaveType', 'نوع مرخصی'], ['from', 'از تاریخ'], ['to', 'تا تاریخ'], ['substitute', 'جانشین در زمان مرخصی']] },
  other: { title: 'نامه‌ی اداری', fields: [] },
};
export const LEAVE_TYPES = ['استحقاقی', 'استعلاجی', 'بدون حقوق', 'ساعتی'];
export const URGENCY = ['عادی', 'فوری', 'خیلی فوری'];
export const LETTER_STATUS = {
  sent: { label: 'ارسال شده — منتظر نظر مدیر', bg: '#E1ECF8', fg: '#1F5FA8' },
  approved: { label: 'موافقت شد', bg: '#E1F3E4', fg: '#1E7A34' },
  followup: { label: 'در دست پیگیری', bg: '#FFF1D6', fg: '#8A5A00' },
  rejected: { label: 'مخالفت شد', bg: '#FBE3E0', fg: '#B3261E' },
};
export function unitForRole(role) {
  return { 'انباردار': 'انبار', 'کارشناس سفارشات': 'سفارشات', 'مدیر مالی': 'امور مالی', 'ناظر کیفیت': 'کنترل کیفیت', 'سرپرست لیتوگرافی': 'لیتوگرافی', 'سرپرست چاپ دیجیتال': 'چاپ دیجیتال', 'سرپرست چاپ': 'چاپ افست', 'سرپرست صحافی': 'صحافی و تکمیلی', 'مدیر چاپخانه': 'سایر' }[role] || 'سایر';
}
const fa = (n) => Number(n).toLocaleString('en-US');
const money = (v) => { const n = Number(normalizeDigits(String(v || '')).replace(/,/g, '')); return n > 0 ? `${fa(n)} ریال` : ''; };
/* پیش‌نویس متن رسمی از روی فیلدهای فرم؛ کاربر می‌تواند ویرایشش کند. dateText: تابع تبدیل تاریخ به شمسی */
export function composeLetter(l, dateText = (d) => d) {
  const f = l.fields || {}; const unit = l.fromUnit || '';
  const head = 'با سلام و احترام؛';
  const tail = 'خواهشمند است دستور فرمایید اقدام لازم صورت گیرد. با تشکر.';
  const d = [];
  if (l.type === 'material') d.push(`به استحضار می‌رساند واحد ${unit} برای ادامه‌ی کار به «${f.item || '…'}»${f.qty ? ` به مقدار ${f.qty}` : ''} نیاز دارد.${f.reason ? ` علت: ${f.reason}.` : ''} لطفاً نسبت به خرید و تامین آن اقدام فرمایید.`);
  else if (l.type === 'repair') d.push(`به استحضار می‌رساند دستگاه «${f.machine || '…'}» در واحد ${unit} دچار اشکال شده است${f.problem ? `: ${f.problem}` : ''}. با توجه به میزان فوریت (${f.urgency || 'عادی'}) لطفاً نسبت به اعزام تعمیرکار / سرویسکار اقدام فرمایید.`);
  else if (l.type === 'goods') d.push(`احتراماً درخواست خرید «${f.item || '…'}»${f.qty ? ` به تعداد ${f.qty}` : ''} برای واحد ${unit} را دارم.${money(f.price) ? ` برآورد قیمت: ${money(f.price)}.` : ''}${f.reason ? ` دلیل نیاز: ${f.reason}.` : ''}`);
  else if (l.type === 'advance') d.push(`احتراماً درخواست مساعده‌ای به مبلغ ${money(f.amount) || '…'} را دارم.${f.reason ? ` دلیل: ${f.reason}.` : ''}${f.repay ? ` نحوه‌ی بازپرداخت: ${f.repay}.` : ''}`);
  else if (l.type === 'leave') d.push(`احتراماً درخواست مرخصی ${f.leaveType || ''} از تاریخ ${f.from ? dateText(f.from) : '…'} تا تاریخ ${f.to ? dateText(f.to) : '…'}${leaveDays(f) ? ` (${leaveDays(f)} روز)` : ''} را دارم.${f.substitute ? ` جانشین در زمان مرخصی: ${f.substitute}.` : ''}`);
  else d.push(l.body || '');
  return [head, ...d, tail].filter(Boolean).join('\n');
}
export function leaveDays(f) {
  if (!f || !f.from || !f.to) return 0;
  const a = new Date(f.from + 'T00:00:00'), b = new Date(f.to + 'T00:00:00');
  const n = Math.round((b - a) / 86400000) + 1; return n > 0 ? n : 0;
}
export function nextLetterNumber(letters, jy) {
  const prefix = `${jy}/`;
  const max = letters.reduce((m, l) => (String(l.number || '').startsWith(prefix) ? Math.max(m, Number(String(l.number).slice(prefix.length)) || 0) : m), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
export function validLetter(l) {
  const e = [];
  if (!l.fromUnit) e.push('واحد درخواست‌کننده را انتخاب کنید.');
  if (!String(l.subject || '').trim()) e.push('موضوع نامه را وارد کنید.');
  if (!String(l.body || '').trim()) e.push('متن نامه خالی است؛ «ساخت متن نامه» را بزنید یا بنویسید.');
  const f = l.fields || {};
  if (l.type === 'leave') { if (!f.from || !f.to) e.push('تاریخ شروع و پایان مرخصی را وارد کنید.'); else if (leaveDays(f) <= 0) e.push('تاریخ پایان مرخصی قبل از شروع است.'); }
  if (l.type === 'advance' && !(Number(normalizeDigits(String(f.amount || '')).replace(/,/g, '')) > 0)) e.push('مبلغ مساعده را وارد کنید.');
  if ((l.type === 'material' || l.type === 'goods') && !String(f.item || '').trim()) e.push('نام کالا / مواد را وارد کنید.');
  if (l.type === 'repair' && !String(f.machine || '').trim()) e.push('دستگاه را مشخص کنید.');
  return e;
}
