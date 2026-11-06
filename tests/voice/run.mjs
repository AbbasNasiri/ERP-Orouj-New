/* رانر آزمون صوت آفلاین.
   مصرف:  node tests/voice/run.mjs --corpus=tests/voice/corpus/manifest.json --engine=human|onnx|cli
   گزینه‌ها: --model= --cmd= --args= --only=id1,id2 --threads= --allow-download --strict --out=dir
   خروجی: یک خط به‌ازای نمونه + خلاصه + فایل report.json و report.md کنار مجموعه.
   این ابزار فقط اندازه می‌گیرد؛ تصمیم حدود پذیرش در manifest مجموعه نوشته می‌شود. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareAudio } from './audio.mjs';
import { wordErrorRate, charErrorRate, unitNumberRecall, summarize } from './metrics.mjs';
import { fieldReport } from './fields.mjs';

const ENGINE_FILES = { human: './engines/human.mjs', onnx: './engines/onnx.mjs', cli: './engines/cli.mjs' };

function parseArgs(argv) {
  const a = { args: [], threads: 2, engine: 'human', allowDownload: false, strict: false };
  for (const s of argv) {
    if (s === '--allow-download') a.allowDownload = true;
    else if (s === '--strict') a.strict = true;
    else if (s.startsWith('--')) {
      const [k, ...rest] = s.slice(2).split('=');
      const v = rest.join('=');
      if (k === 'args') a.args = v ? v.split(',') : [];
      else if (k === 'threads') a.threads = Number(v) || 2;
      else a[k] = v;
    }
  }
  return a;
}

async function loadEngine(o) {
  const file = ENGINE_FILES[o.engine];
  if (!file) throw new Error(`موتور ناشناخته: ${o.engine} (مجاز: ${Object.keys(ENGINE_FILES).join('، ')})`);
  const mod = await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), file)).href);
  return mod.create({ cmd: o.cmd, args: o.args, model: o.model, threads: o.threads, allowDownload: o.allowDownload });
}

function pct(v) { return v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}٪`; }
function fix(v, d = 1) { return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d); }

export async function runCorpus({ corpusPath, opts = {} }) {
  const manifest = JSON.parse(readFileSync(corpusPath, 'utf8'));
  const corpusDir = dirname(resolve(corpusPath));
  const only = opts.only ? new Set(opts.only.split(',')) : null;
  const samples = (manifest.samples || []).filter(s => !only || only.has(s.id));
  if (!samples.length) throw new Error('هیچ نمونه‌ای در manifest پیدا نشد (یا --only هیچ‌کدام را انتخاب نکرد).');
  const parseOpts = { productTypes: manifest.options?.productTypes || [], serviceTypes: manifest.options?.serviceTypes || [], bindingTypes: manifest.options?.bindingTypes || [] };
  const engine = await loadEngine(opts);
  const rows = [];
  console.log(`\nمجموعه: ${basename(corpusDir)} | موتور: ${engine.name} | نمونه‌ها: ${samples.length}${opts.allowDownload ? ' | دانلود وزن مجاز (فقط آماده‌سازی)' : ' | بدون شبکه'}`);
  console.log('id      ثانیه  زمان‌موتور  WER    CER    اعداد-واحد   فیلدها  متن موتور');
  for (const s of samples) {
    const row = { id: s.id, ok: true };
    try {
      let prepared = null;
      if (engine.needsAudio) {
        const audioPath = resolve(corpusDir, s.file || `${s.id}.wav`);
        if (!existsSync(audioPath)) throw new Error(`فایل صوتی پیدا نشد: ${audioPath}`);
        prepared = prepareAudio(audioPath);
        row.audioSeconds = Number(fix(prepared.seconds, 2));
        row.sourceRate = prepared.sourceRate;
      } else row.audioSeconds = s.seconds ?? null;
      const t0 = performance.now();
      const res = await engine.transcribe(s, prepared);
      row.engineSeconds = Number(((performance.now() - t0) / 1000).toFixed(2));
      row.hypothesis = res.text;
      row.werObj = wordErrorRate(s.reference, res.text);
      row.cerObj = charErrorRate(s.reference, res.text);
      row.wer = row.werObj.rate; row.cer = row.cerObj.rate; row.werErrors = row.werObj.errors; row.werRefLen = row.werObj.refLen;
      const nums = unitNumberRecall(s.reference, res.text);
      row.numbersTotal = nums.total; row.numbersFound = nums.found; row.numberRecall = nums.recall; row.numberMisses = nums.misses;
      const fr = fieldReport({ reference: s.reference, hypothesis: res.text, expectedFields: s.expectedFields, opts: parseOpts });
      Object.assign(row, { fieldsTotal: fr.fieldsTotal, fieldsOk: fr.fieldsOk, fieldProblems: fr.fieldProblems, criteria: fr.criteria });
      row.note = s.note || '';
    } catch (e) {
      row.ok = false;
      row.error = e.message;
    }
    rows.push(row);
    const flag = row.ok ? (row.fieldProblems.length ? '⚠' : '✓') : '✗';
    const preview = row.ok ? String(row.hypothesis).replace(/\s+/g, ' ').slice(0, 46) : `خطا: ${row.error}`;
    console.log(`${String(s.id).padEnd(7)} ${String(row.audioSeconds ?? '—').padStart(5)}  ${String(row.engineSeconds ?? '—').padStart(9)}  ${pct(row.wer).padStart(6)} ${pct(row.cer).padStart(6)}  ${row.ok ? `${row.numbersFound}/${row.numbersTotal}`.padStart(11) : '  —'.padStart(11)}  ${row.ok ? `${row.fieldsOk}/${row.fieldsTotal}`.padStart(7) : '  —'.padStart(7)}  ${flag} ${preview}`);
    for (const p of row.fieldProblems || []) console.log(`         ↳ ${p.field}: انتظار ${p.expected} / خوانده شد «${p.got ?? ''}» (${p.kind === 'missing' ? 'نیافت' : 'اشتباه'})`);
    for (const m of row.numberMisses || []) console.log(`         ↳ عددِ واحددار افتاد: ${m.value} ${m.unit}`);
  }
  await engine.dispose?.();
  const summary = summarize(rows);
  const acceptance = manifest.acceptance || {};
  const checks = [
    acceptance.werMax !== undefined && { label: `WER میانگین ≤ ${pct(acceptance.werMax)}`, value: summary.werMean, show: pct, pass: summary.werMean !== null && summary.werMean <= acceptance.werMax },
    acceptance.cerMax !== undefined && { label: `CER میانگین ≤ ${pct(acceptance.cerMax)}`, value: summary.cerMean, show: pct, pass: summary.cerMean !== null && summary.cerMean <= acceptance.cerMax },
    acceptance.unitNumberRecallMin !== undefined && { label: `فراخوانی اعدادِ واحددار ≥ ${pct(acceptance.unitNumberRecallMin)}`, value: summary.unitNumberRecall, show: pct, pass: summary.unitNumberRecall !== null && summary.unitNumberRecall >= acceptance.unitNumberRecallMin },
    acceptance.fieldAccuracyMin !== undefined && { label: `درستی فیلدها ≥ ${pct(acceptance.fieldAccuracyMin)}`, value: summary.fieldAccuracy, show: pct, pass: summary.fieldAccuracy !== null && summary.fieldAccuracy >= acceptance.fieldAccuracyMin },
    acceptance.maxRealtimeFactor !== undefined && { label: `زمان موتور ≤ ${acceptance.maxRealtimeFactor}× طول صوت`, value: summary.realtimeFactor, show: (v) => `${fix(v, 2)}×`, pass: summary.realtimeFactor !== null && summary.realtimeFactor <= acceptance.maxRealtimeFactor },
  ].filter(Boolean);
  console.log(`\nخلاصه: WER ${pct(summary.werMean)} | CER ${pct(summary.cerMean)} | اعداد-واحد ${pct(summary.unitNumberRecall)} | فیلدها ${pct(summary.fieldAccuracy)} | نمونه تمیز ${summary.fieldCleanSamples}/${summary.samples} | خطای اجرا ${summary.failed} | ضریب زمان‌برآیند ${fix(summary.realtimeFactor, 2)}×`);
  for (const c of checks) console.log(`${c.pass ? '✓' : '✗'} ${c.label} — اندازه‌گیری‌شده: ${c.show(c.value)}`);
  return { rows, summary, checks, engine: engine.name, generate: engine.loadInfo?.generate || null, manifest, acceptance };
}

function toMarkdown(result) {
  const head = ['| نمونه | ثانیه | WER | CER | اعداد-واحد | فیلدها | مغایرت | متن موتور |', '|---|---:|---:|---:|---:|---:|---|---|'];
  const lines = result.rows.map(r => r.ok
    ? `| ${r.id} | ${r.audioSeconds ?? '—'} | ${pct(r.wer)} | ${pct(r.cer)} | ${r.numbersFound}/${r.numbersTotal} | ${r.fieldsOk}/${r.fieldsTotal} | ${(r.fieldProblems || []).map(p => p.field).join('، ') || '—'} | ${String(r.hypothesis).replace(/\|/g, '\\|').slice(0, 70)} |`
    : `| ${r.id} | — | — | — | — | — | خطا | ${r.error} |`);
  return [`# گزارش آزمون صوت`, '', `- موتور: \`${result.engine}\``, `- تنظیم تولید: \`${JSON.stringify(result.generate)}\``, `- تاریخ: ${new Date().toISOString()}`, `- خلاصه: WER ${pct(result.summary.werMean)} · CER ${pct(result.summary.cerMean)} · اعداد-واحد ${pct(result.summary.unitNumberRecall)} · درستی فیلد ${pct(result.summary.fieldAccuracy)} · خطای اجرا ${result.summary.failed} · ضریب زمان‌برآیند ${fix(result.summary.realtimeFactor, 2)}×`, ...head, ...lines, ''].join('\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  if (!o.corpus) { console.error('استفاده: node tests/voice/run.mjs --corpus=<manifest.json> [--engine=human|onnx|cli] [--model=] [--cmd=] [--args=a,{WAV},b] [--only=] [--strict] [--out=dir]'); process.exit(2); }
  try {
    const result = await runCorpus({ corpusPath: o.corpus, opts: o });
    if (o.engine === 'human') console.log('\nتوجه: موتور «human» خودآزمون ابزار است؛ دقت گفتار را نشان نمی‌دهد.');
    if (o.out) { mkdirSync(o.out, { recursive: true }); writeFileSync(join(o.out, 'report.json'), JSON.stringify(result, null, 1)); writeFileSync(join(o.out, 'report.md'), toMarkdown(result)); console.log(`گزارش: ${join(o.out, 'report.md')}`); }
    if (o.strict && (result.checks.some(c => !c.pass) || result.summary.failed > 0)) process.exit(1);
  } catch (e) { console.error(`✗ آزمون اجرا نشد: ${e.message}`); process.exit(1); }
}
