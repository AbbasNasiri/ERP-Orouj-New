/* قیمت‌گذاری بر مبنای کیلوگرم (مقوا): وزن هر بند از سایز، گراماژ و تعداد ورق در بند به‌دست می‌آید. */
const en = t => String(t || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬،\s]/g, m => (/\s/.test(m) ? ' ' : ''));
export function bandWeightKg(item) {
  const m = en(item.size).match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  const g = Number(en(item.gramaj).replace(/[^\d.]/g, ''));
  const spb = Number(en(item.sheetsPerBand).replace(/[^\d.]/g, '')) || 0;
  if (!m || !g || !spb) return 0;
  return spb * (Number(m[1]) * Number(m[2]) / 10000) * g / 1000;
}
export function usesKgPrice(item) { return item.unitMode === 'band_sheet' && item.priceBasis === 'kg'; }
export function bandValueFromKg(item, pricePerKg) { return Math.round(bandWeightKg(item) * (Number(en(pricePerKg)) || 0)); }
