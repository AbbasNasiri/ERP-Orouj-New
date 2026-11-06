/* خطای فیلد، نه خطای واژه: آنچه برای ثبت سفارش مهم است.
   همان متن مرجع و همان متن موتور را از `parseOrderText` عبور می‌دهیم و فیلدها را مقایسه می‌کنیم.
   expectedFields (دستی، از فرم سفارش) اگر باشد، ملاک اصلی همان است؛ متن مرجع فقط ملاک دوم است. */
import { parseOrderText } from '../../src/smart.js';

export const FLAT_FIELDS = [
  ['qty', p => p.qty],
  ['pages', p => p.pages],
  ['productType', p => p.productType],
  ['sizeKey', p => p.sizeKey],
  ['custom', p => (p.custom ? p.custom.join('x') : '')],
  ['textKind', p => p.text.kind],
  ['textGsm', p => p.text.gsm],
  ['textColors', p => p.text.colors],
  ['textSides', p => p.text.sides],
  ['coverEnabled', p => (p.cover.enabled ? 1 : 0)],
  ['coverGsm', p => p.cover.gsm],
  ['coverColors', p => p.cover.colors],
  ['binding', p => p.binding],
  ['printMethod', p => p.printMethod],
];

export function flatten(parsed) {
  const out = {};
  for (const [k, get] of FLAT_FIELDS) out[k] = get(parsed);
  return out;
}

const emptyish = (v) => v === null || v === undefined || v === '' || v === 0;

/** p = فیلدی که در ملاک مقدار(has value) دارد و در متن موتور مقدارش فرق دارد */
export function diffFields(expected, got) {
  const problems = [];
  for (const [k] of FLAT_FIELDS) {
    const e = expected[k], g = got[k];
    if (emptyish(e)) continue;
    if (String(e) !== String(g)) problems.push({ field: k, expected: e, got: g, kind: emptyish(g) ? 'missing' : 'wrong' });
  }
  return problems;
}

export function parseText(text, opts) {
  return flatten(parseOrderText(text, opts));
}

/** خروجی: شمار فیلدهای ملاک، تعداد درست، و لیست مغایرت‌ها (ملاک = expectedFields اگر باشد وگرنه parse متن مرجع) */
export function fieldReport({ reference, hypothesis, expectedFields, opts }) {
  const base = expectedFields && Object.keys(expectedFields).length ? expectedFields : parseText(reference, opts);
  const got = parseText(hypothesis, opts);
  const problems = diffFields(base, got);
  const total = FLAT_FIELDS.filter(([k]) => !emptyish(base[k])).length;
  return { fieldsTotal: total, fieldsOk: total - problems.length, fieldProblems: problems, criteria: expectedFields ? 'expectedFields' : 'referenceParse' };
}
