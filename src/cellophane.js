/* سلفون: دو دستهٔ اصلی حرارتی و واتربیس. هر دو براق و مات دارند و حرارتی زیرمجموعه‌هایی مثل مخملی و شنی دارد.
   spec.cellophane همان سطح (براق یا مات) می‌ماند تا بقیهٔ برنامه کار کند؛ celloKind و celloVariant به آن افزوده می‌شوند. */
export const CELLO_KINDS = ['حرارتی', 'واتربیس'];
export const CELLO_FINISHES = ['براق', 'مات'];
// زیرمجموعه‌ی حرارتی و سطحی که ذاتاً دارد (مخملی و شنی مات‌اند، هولوگرام و متالایز براق)
export const CELLO_VARIANTS = {
  'حرارتی': [{ name: 'مخملی', finish: 'مات' }, { name: 'شنی', finish: 'مات' }, { name: 'هولوگرام', finish: 'براق' }, { name: 'متالایز', finish: 'براق' }],
  'واتربیس': [],
};
export const celloName = (kind, finish, variant) => (variant ? `سلفون ${kind} ${variant}` : `سلفون ${kind} ${finish}`);
export const celloKindOf = (sp) => (sp && sp.celloKind) || 'حرارتی';
export function celloLabel(sp) {
  if (!sp || !sp.cellophane) return '';
  return sp.celloVariant ? `${celloKindOf(sp)} ${sp.celloVariant}` : `${celloKindOf(sp)} ${sp.cellophane}`;
}
// همه‌ی گزینه‌های قابل انتخاب به شکل «نوع|سطح|زیرمجموعه»
export const CELLO_OPTIONS = CELLO_KINDS.flatMap(kind => [
  ...CELLO_FINISHES.map(f => ({ value: `${kind}|${f}|`, label: `${kind} — ${f}` })),
  ...(CELLO_VARIANTS[kind] || []).map(v => ({ value: `${kind}|${v.finish}|${v.name}`, label: `${kind} — ${v.name}` })),
]);
export const celloComboOf = (sp) => (sp && sp.cellophane ? `${celloKindOf(sp)}|${sp.cellophane}|${sp.celloVariant || ''}` : '');
export function celloPatch(combo) {
  if (!combo) return { cellophane: '', celloKind: '', celloVariant: '' };
  const [celloKind, cellophane, celloVariant] = String(combo).split('|');
  return { cellophane, celloKind, celloVariant: celloVariant || '' };
}
// تشخیص از متن گفتاری یا نوشتاری
export function parseCello(text) {
  const t = String(text || '');
  if (!/سلفون/.test(t)) return null;
  const kind = /واتر\s*بیس|water\s*base/i.test(t) ? 'واتربیس' : 'حرارتی';
  const hit = (CELLO_VARIANTS[kind] || []).find(v => t.includes(v.name));
  if (hit) return { celloKind: kind, cellophane: hit.finish, celloVariant: hit.name };
  return { celloKind: kind, cellophane: /مات|سافت/.test(t) ? 'مات' : 'براق', celloVariant: '' };
}