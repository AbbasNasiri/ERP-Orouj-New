// تیراژ چاپ متن و جلد؛ قاعدهٔ جلد به ماشین چاپ جلد بستگی دارد، نه به تیراژ سفارش.
const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

export const COVER_PRESS_RULES = Object.freeze({
  'GTO': Object.freeze({ coversPerSheet: 1, waste: 100 }),
  '2 ورقی': Object.freeze({ coversPerSheet: 2, waste: 50 }),
  '4.5 ورقی': Object.freeze({ coversPerSheet: 8, waste: 25 }),
});
export const DEFAULT_COVER_PRESS = 'GTO';

function count(value) {
  const text = String(value ?? '')
    .replace(/[۰-۹]/g, digit => FA.indexOf(digit))
    .replace(/[٠-٩]/g, digit => AR.indexOf(digit))
    .replace(/[٬,،\s]/g, '');
  if (!/^\d+$/.test(text)) return NaN;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : NaN;
}

export function coverRun(qty, coverPress) {
  const press = Object.hasOwn(COVER_PRESS_RULES, coverPress) ? coverPress : DEFAULT_COVER_PRESS;
  const rule = COVER_PRESS_RULES[press];
  const covers = count(qty);
  if (!covers) return { press, ...rule, covers: 0, sheetsNet: 0, sheets: 0 };
  const sheetsNet = Math.ceil(covers / rule.coversPerSheet);
  return { press, ...rule, covers, sheetsNet, sheets: sheetsNet + rule.waste };
}

export function textRun(qty, waste) {
  const net = count(qty) || 0;
  const extra = count(waste) || 0;
  return { net, waste: extra, total: net + extra };
}
