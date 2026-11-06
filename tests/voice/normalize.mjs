/* نرمال‌سازی متن فارسی برای مقایسه‌ی عادلانه: آنچه موتور تشخیص می‌دهد با آنچه انسان می‌نویسد
   باید پیش از شمارش خطا هم‌شکل شود (نیم‌فاصله، ارقام، ي/ی، ک/ك، اعراب، کشیده، نشانه‌گذاری). */
import { normalizeDigits, wordsToDigits } from '../../src/smart.js';

const DIACRITICS = /[\u064B-\u0652\u0670\u0640\u06D6-\u06ED]/g;

export function normalizeTextFa(raw) {
  let s = normalizeDigits(String(raw ?? ''));
  s = s.replace(/[\u200c\u200b\u200d\u200e\u200f]/g, ' ');
  s = s.replace(/[\u06f0-\u06f9]/g, d => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(DIACRITICS, '');
  s = s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه');
  s = s.replace(/[،؛:!?«»"'()\[\]{}\-–—_*~#%^+=/\\|<>.]/g, ' ');
  s = s.toLowerCase().replace(/\s+/g, ' ');
  return s.trim();
}

export function tokenizeFa(normalized) {
  const s = normalizeTextFa(normalized);
  return s ? s.split(' ') : [];
}

export function charSeq(normalized) {
  return [...normalizeTextFa(normalized).replace(/ /g, '')];
}

/** تعدادِ با واحد، نزدیک‌ترین عدد به کلمه‌ی واحد — همان چیزی که در سفارش چاپ اشتباه‌پذیر است.
   اعداد گفتاری («دویست»، «دو هزار و پانصد») پیش از شمارش رقمی می‌شوند تا نوشتارِ عددِ مرجع،
   موتور را جریمه نکند: موتور «دویست» می‌نویسد و انسان «۲۰۰». */
export const UNIT_WORDS = ['نسخه', 'عدد', 'جلد', 'برگ', 'برگه', 'ورق', 'بند', 'صفحه', 'گرم', 'رنگ', 'سانتی', 'سانتی‌متر', 'متری', 'تایی'];
export function digitsFolded(normalized) {
  return wordsToDigits(normalizeTextFa(normalized));
}
export function numbersWithUnits(foldedText) {
  const toks = tokenizeFa(foldedText);
  const isUnit = (w) => !!w && UNIT_WORDS.some(u => w === u || w.startsWith(u));
  const hits = [];
  toks.forEach((t, i) => {
    if (!/^\d+(\.\d+)?$/.test(t)) return;
    // واحد در فارسی معمولاً بلافاصله بعد از عدد می‌آید («دویست صفحه»)؛ اگر نبود، نزدیک‌ترین واحد
    const unit = [toks[i + 1], toks[i - 1], toks[i + 2], toks[i - 2]].find(isUnit) || '';
    hits.push({ value: t, unit, index: i });
  });
  return hits;
}
