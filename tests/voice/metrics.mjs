/* معیارهای خطای تشخیص گفتار: فاصله ویرایشی روی واژه و روی نویسه، و فراخوانی اعدادِ واحددار.
   هیچ عددی اینجا اختراع نمی‌شود؛ حدود پذیرش در manifest مجموعه نوشته می‌شود. */
import { tokenizeFa, charSeq, digitsFolded, numbersWithUnits } from './normalize.mjs';

export function editDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[m];
}

const rate = (ref, hyp) => { const errors = editDistance(ref, hyp); return { errors, refLen: ref.length, rate: ref.length ? errors / ref.length : 0 }; };

/* WER روی واژه‌های رقمی‌شده: تفاوتِ «دویست» با «۲۰۰» خطای فهم نیست، پس جریمه نمی‌شود.
   CER روی نویسه‌های همان متن می‌ماند: بازنویسی عدد هم خودش بخشی از رفتار موتور است. */
export function wordErrorRate(reference, hypothesis) {
  return rate(tokenizeFa(digitsFolded(reference)), tokenizeFa(digitsFolded(hypothesis)));
}
export function charErrorRate(reference, hypothesis) {
  return rate(charSeq(reference), charSeq(hypothesis));
}

/** چند درصد از اعدادِ واحددارِ متن مرجع، دقیقاً در متن موتور آمده‌اند (تیراژ، صفحه، گرماژ، رنگ) */
export function unitNumberRecall(reference, hypothesis) {
  const ref = numbersWithUnits(digitsFolded(reference));
  if (!ref.length) return { total: 0, found: 0, recall: null, misses: [] };
  const hyp = numbersWithUnits(digitsFolded(hypothesis));
  const pool = hyp.map(h => ({ ...h, used: false }));
  const misses = [];
  let found = 0;
  for (const r of ref) {
    const match = pool.find(h => !h.used && h.value === r.value && (!r.unit || h.unit === r.unit));
    if (match) { match.used = true; found++; } else misses.push({ value: r.value, unit: r.unit });
  }
  return { total: ref.length, found, recall: found / ref.length, misses };
}

export function summarize(rows) {
  const num = (arr) => (arr || []).filter(x => x !== null && x !== undefined && !Number.isNaN(x));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  return {
    samples: rows.length,
    werMean: mean(num(rows.map(r => r.wer))),
    cerMean: mean(num(rows.map(r => r.cer))),
    werMicro: (() => { const e = sum(rows.map(r => r.werErrors || 0)), l = sum(rows.map(r => r.werRefLen || 0)); return l ? e / l : null; })(),
    unitNumberRecall: (() => { const t = sum(rows.map(r => r.numbersTotal || 0)), f = sum(rows.map(r => r.numbersFound || 0)); return t ? f / t : null; })(),
    fieldAccuracy: (() => { const t = sum(rows.map(r => r.fieldsTotal || 0)), o = sum(rows.map(r => r.fieldsOk || 0)); return t ? o / t : null; })(),
    fieldCleanSamples: rows.filter(r => r.ok !== false && (r.fieldProblems || []).length === 0).length,
    failed: rows.filter(r => r.ok === false).length,
    secondsMean: mean(num(rows.map(r => r.audioSeconds))),
    latencyMean: mean(num(rows.map(r => r.engineSeconds))),
    realtimeFactor: (() => { const a = sum(rows.map(r => r.audioSeconds || 0)), e = sum(rows.map(r => r.engineSeconds || 0)); return a ? e / a : null; })(),
  };
}
