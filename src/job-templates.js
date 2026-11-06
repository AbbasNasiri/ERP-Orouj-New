/* قالب نوع کار: پیش‌فرض‌های قطع، ماشین، کاغذ و صحافی هر نوع محصول. فقط جاهای خالی پر می‌شود و هیچ قیمتی در اینجا نیست؛
   قیمت‌ها از جدول واحدها (units.js) می‌آید. */
export const JOB_TEMPLATES = {
  'کتاب': { sizeKey: 'وزیری', press: '2 ورقی', printMethod: 'افست', textKind: 'تحریر', textGsm: '70', textColors: 1, textSides: 2, cover: { kind: 'گلاسه', gsm: '250', colors: 4, sides: 1 }, bindingType: 'شومیز (چسب گرم)', finishing: ['برش', 'بسته‌بندی'] },
  'مجله': { sizeKey: 'رحلی', press: '2 ورقی', printMethod: 'افست', textKind: 'گلاسه', textGsm: '115', textColors: 4, textSides: 2, cover: { kind: 'گلاسه', gsm: '250', colors: 4, sides: 1 }, bindingType: 'منگنه‌ای (مفتولی/سیمی)', finishing: ['برش', 'بسته‌بندی'] },
  'کاتالوگ': { sizeKey: 'رحلی', press: '2 ورقی', printMethod: 'افست', textKind: 'گلاسه', textGsm: '135', textColors: 4, textSides: 2, cover: { kind: 'گلاسه', gsm: '250', colors: 4, sides: 1 }, bindingType: 'منگنه‌ای (مفتولی/سیمی)', finishing: ['برش', 'بسته‌بندی'] },
  'دفترچه': { sizeKey: 'رقعی', press: 'GTO', printMethod: 'افست', textKind: 'تحریر', textGsm: '70', textColors: 1, textSides: 2, cover: { kind: 'گلاسه', gsm: '250', colors: 4, sides: 1 }, bindingType: 'منگنه‌ای (مفتولی/سیمی)', finishing: ['برش'] },
};
export const FINISHING_STEPS = ['برش', 'بسته‌بندی', 'ارسال و حمل'];
/* هر مرحله با ردیفی از جدول صحافی (units.js) قیمت می‌خورد؛ کلید = بخشی از نام ردیف */
export const FINISHING_UNIT_KEY = { 'برش': 'برش', 'بسته‌بندی': 'بسته‌بندی', 'ارسال و حمل': 'ارسال' };
export const jobTemplateFor = (type, custom) => (custom && custom[type]) || JOB_TEMPLATES[type] || null;

/* قالب را روی قلم سفارش می‌نشاند. فقط وقتی اجرا می‌شود که قلم هنوز دست‌نخورده باشد (قطع خالی) تا انتخاب کاربر پاک نشود. */
export function applyJobTemplate(item, custom) {
  const t = jobTemplateFor(item.productType, custom);
  const sp = item.spec || {};
  if (!t || sp.sizeKey || sp.pages || sp.textGsm) return item;
  const spec = { ...sp, sizeKey: t.sizeKey, printMethod: t.printMethod, textKind: t.textKind, textGsm: t.textGsm, textColors: t.textColors, textSides: t.textSides };
  const next = { ...item, spec, press: t.press, bindingType: item.bindingType && item.bindingType !== 'بدون صحافی' ? item.bindingType : t.bindingType };
  if (t.cover) {
    next.coverEnabled = true;
    Object.assign(spec, { coverKind: t.cover.kind, coverGsm: t.cover.gsm, coverColors: t.cover.colors, coverSides: t.cover.sides });
  }
  next.finishingSteps = [...(t.finishing || [])];
  return next;
}