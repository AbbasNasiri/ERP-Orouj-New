'use strict';
/* چرخهٔ تعریف ← تأیید ← کد یکتا برای مشتری / بازاریاب / تأمین‌کننده.
   بانک خام همیشه کامل در state می‌ماند؛ این تابع‌ها فقط «قابل استفاده در کار» را تشخیص می‌دهند. */

export const PARTY_LABEL = { customer: 'مشتری', supplier: 'تامین‌کننده' };
export const REVIEW_NAMES = { pending: 'در انتظار بررسی', approved: 'تأیید شده', rejected: 'رد شده' };

export const partyReview = p => (['approved', 'rejected'].includes(p?.eligibility?.status) ? p.eligibility.status : 'pending');
export const partyActive = p => p?.active !== false;
export const partyCode = (p, kind) => String((kind === 'supplier' ? p?.supplierCode : p?.customerCode) || '');
/* فهرست کاری و پیکرها فقط این رکوردها را می‌بینند: تأیید شده و فعال. */
export const usableParty = p => partyReview(p) === 'approved' && partyActive(p);
/* برچسب دیدنی وضعیت: همان واژگان پنل بررسی، تا جدول و پنل یک چیز بگویند. */
export const partyBadge = p => REVIEW_NAMES[partyReview(p)] + (partyActive(p) ? '' : ' · غیرفعال');
/* رکوردی که سرور تغییر یا حذف معمولیِ آن را می‌پذیرد نه؛ رابط هم پیش از نوشتن همین را می‌گوید. */
export const protectedParty = (p, kind) => !!partyCode(p, kind) || (!!p?.eligibility && p.eligibility.status !== 'pending');
export const workList = list => (Array.isArray(list) ? list : []).filter(usableParty);
export const hiddenCount = list => (Array.isArray(list) ? list : []).filter(p => !usableParty(p)).length;
/* پیکر عملیاتی: فهرست کاری + رکوردی که همین حالا انتخاب شده (تا ویرایش سند قدیمی مقدارش را نبازد). */
export const pickable = (list, selectedId) => {
  const work = workList(list);
  return selectedId && !work.some(p => p.id === selectedId) ? [...work, ...(Array.isArray(list) ? list : []).filter(p => p.id === selectedId)] : work;
};
