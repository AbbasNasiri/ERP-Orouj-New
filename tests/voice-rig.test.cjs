'use strict';
/* خودآزمون ابزار سنجش صوت: ریاضیِ خطا، قرائت WAV، و خط لوله‌ی «صوت → متن → فیلد».
   این تست‌ها موتور واقعی صدا نمی‌زنند؛ نشان می‌دهند هر عددی که گزارش می‌شود درست محاسبه می‌شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');

const V = (p) => import(pathToFileURL(path.resolve(__dirname, 'voice', p)).href);
const audio = V('audio.mjs');
const norm = V('normalize.mjs');
const metrics = V('metrics.mjs');
const fields = V('fields.mjs');
const runner = V('run.mjs');

const OPTS = { productTypes: ['کتاب', 'تراکت', 'پوستر', 'دفترچه'], serviceTypes: ['سلفون'], bindingTypes: ['شومیز (چسب گرم)', 'گالینگور (جلد سخت)'] };

function wavBuffer({ sampleRate, channels, bits, samples, float = false }) {
  const bytesPer = bits / 8;
  const blockAlign = bytesPer * channels;
  const dataLen = samples.length / channels * blockAlign;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(float ? 3 : 1, 20); buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32); buf.writeUInt16LE(bits, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataLen, 40);
  samples.forEach((v, i) => {
    const at = 44 + i * bytesPer;
    if (float) buf.writeFloatLE(v, at);
    else if (bits === 16) buf.writeInt16LE(Math.round(v * 32767), at);
    else if (bits === 24) { const n = Math.round(v * 8388607); buf.writeIntLE(n, at, 3); }
    else if (bits === 8) buf.writeUInt8(Math.round(v * 127) + 128, at);
  });
  return buf;
}

test('wav: stereo 44.1kHz 16-bit becomes mono 16kHz PCM without changing duration', async () => {
  const { readWav, toMono, resample, writeWavPcm16 } = await audio;
  const rate = 44100, secs = 0.02, n = Math.round(rate * secs);
  const left = [], right = [];
  for (let i = 0; i < n; i++) { left.push(Math.sin(i / 8)); right.push(-Math.sin(i / 8)); }
  const samples = [];
  for (let i = 0; i < n; i++) { samples.push(left[i], right[i]); }
  const buf = wavBuffer({ sampleRate: rate, channels: 2, bits: 16, samples });
  const wav = readWav(buf);
  assert.equal(wav.sampleRate, rate);
  assert.equal(wav.channels.length, 2);
  assert.equal(wav.frames, n);
  const mono = toMono(wav);
  mono.forEach(v => assert.ok(Math.abs(v) < 1e-6, 'میانگین دو کانالِ مخالف باید صفر شود'));
  const down = resample(mono, rate, 16000);
  assert.equal(down.length, Math.floor(n * 16000 / 44100));
  assert.ok(Math.abs(down.length / 16000 - secs) < 0.001);
  const out = writeWavPcm16(down, 16000);
  assert.equal(out.toString('ascii', 0, 4), 'RIFF');
  assert.equal(out.readUInt32LE(24), 16000);
  assert.equal(out.readUInt16LE(22), 1);
});

test('wav: 8/24-bit and float32 decode to the same amplitude range', async () => {
  const { readWav, toMono } = await audio;
  const vals = [0, 0.5, -0.5, 0.25];
  for (const spec of [{ bits: 8 }, { bits: 24 }, { bits: 32, float: true }]) {
    const buf = wavBuffer({ sampleRate: 16000, channels: 1, bits: spec.bits, float: !!spec.float, samples: vals });
    const mono = toMono(readWav(buf));
    assert.equal(mono.length, vals.length, `بیت‌عمق ${spec.bits}`);
    vals.forEach((v, i) => assert.ok(Math.abs(mono[i] - v) < (spec.bits === 8 ? 0.01 : 1e-4), `نمونه‌ی ${i} در بیت‌عمق ${spec.bits}: ${mono[i]} ≠ ${v}`));
  }
});

test('wav: non-WAV audio is rejected with an actionable message, never guessed', async () => {
  const { readWav } = await audio;
  const m4a = Buffer.from('FTAV\u0000\u0000\u0000\x20ftypM4A ', 'binary');
  assert.throws(() => readWav(m4a), /WAV معتبر نیست/);
});

test('prepareAudio reads a real file and reports source rate and duration', async () => {
  const { prepareAudio } = await audio;
  const dir = mkdtempSync(path.join(tmpdir(), 'ps-wav-'));
  try {
    const f = path.join(dir, 'a.wav');
    const n = 8000;
    const samples = Array.from({ length: n }, (_, i) => Math.sin(i / 20));
    writeFileSync(f, wavBuffer({ sampleRate: 8000, channels: 1, bits: 16, samples }));
    const p = prepareAudio(f);
    assert.equal(p.sourceRate, 8000);
    assert.equal(p.sampleRate, 16000);
    assert.ok(Math.abs(p.seconds - 1) < 0.01, `مدت ≈ ۱ ثانیه، شد ${p.seconds}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('persian normalization folds writing variants before counting errors', async () => {
  const { normalizeTextFa } = await norm;
  assert.equal(normalizeTextFa('دویست‌هزار'), 'دویست هزار');
  assert.equal(normalizeTextFa('۲۵۰۰ نسخه'), '2500 نسخه');
  assert.equal(normalizeTextFa('کتابِ رحلی'), 'کتاب رحلی');
  assert.equal(normalizeTextFa('يوسف ک، ۵۰۰ عدد!'), 'یوسف ک 500 عدد');
  assert.deepEqual(normalizeTextFa('دو، هزار'), normalizeTextFa('دو هزار'));
});

test('edit distance and error rates match hand-computed values', async () => {
  const { editDistance, wordErrorRate, charErrorRate } = await metrics;
  assert.equal(editDistance(['a', 'b', 'c', 'd'], ['a', 'b', 'd']), 1);
  assert.equal(editDistance([], ['a']), 1);
  const w = wordErrorRate('کتاب دو هزار نسخه', 'کتاب نسخه');
  assert.equal(w.errors, 1); assert.equal(w.refLen, 3); assert.equal(w.rate, 1 / 3);
  const c = charErrorRate('کتاب', 'کتاب');
  assert.equal(c.errors, 0);
  assert.equal(charErrorRate('ورق', 'ورق ').errors, 0);
  assert.equal(wordErrorRate('پانصد نسخه', 'هزار نسخه').rate, 0.5);
  // «دویست»ِ موتور و «۲۰۰»ِ انسان یک عددند، نه دو خطای واژه‌ای
  assert.equal(wordErrorRate('۲۰۰ نسخه', 'دویست نسخه').rate, 0);
});

test('unit-number recall counts only numbers attached to a print unit', async () => {
  const { unitNumberRecall } = await metrics;
  const r = unitNumberRecall('دویست صفحه تحریر هفتاد گرم دو هزار و پانصد نسخه', 'دویست صفحه تحریر شش گرم 2500 نسخه');
  assert.equal(r.total, 3);
  assert.equal(r.found, 2);
  assert.equal(r.recall, 2 / 3);
  assert.deepEqual(r.misses, [{ value: '70', unit: 'گرم' }]);
  const none = unitNumberRecall('کتاب شومیز', 'کتاب جلد سخت');
  assert.equal(none.total, 0); assert.equal(none.recall, null);
});

test('field report turns a lost spoken number into a wrong-field finding', async () => {
  const { fieldReport } = await fields;
  const ref = 'کتاب رحلی دویست صفحه کاغذ تحریر هفتاد گرم دو رنگ جلد گلاسه دویست پنجاه گرم چهار رنگ سلفون براق شومیز دو هزار و پانصد نسخه';
  const hyp = 'کتاب رحلی دویست صفحه کاغذ تحریر هفتاد گرم دو رنگ جلد گلاسه دویست پنجاه گرم چهار رنگ سلفون براق شومیز دو هزار نسخه';
  const rep = fieldReport({ reference: ref, hypothesis: hyp, opts: OPTS });
  const qty = rep.fieldProblems.find(p => p.field === 'qty');
  assert.ok(qty, 'تیراژ باید به‌عنوان مغایرت ثبت شود');
  assert.equal(qty.expected, 2500);
  assert.equal(qty.got, 2000);
  assert.equal(qty.kind, 'wrong');
  assert.equal(rep.criteria, 'referenceParse');
  assert.ok(rep.fieldsTotal >= 8, `فیلدهای ملاک باید زیاد شمرده شوند (${rep.fieldsTotal})`);
});

test('expectedFields from the order form outrank the parsed reference text', async () => {
  const { fieldReport } = await fields;
  const ref = 'بروشور A4 صد و پنجاه گرم دویست نسخه';
  const rep = fieldReport({ reference: ref, hypothesis: 'بروشور A4 صد و پنجاه گرم', expectedFields: { qty: 200, textGsm: 150, sizeKey: 'A4' }, opts: OPTS });
  assert.equal(rep.criteria, 'expectedFields');
  assert.deepEqual(rep.fieldProblems.map(p => p.field).sort(), ['qty']);
  assert.equal(rep.fieldProblems[0].kind, 'missing');
});

test('runner end-to-end: perfect transcript scores zero error, injected slip is caught', async () => {
  const { runCorpus } = await runner;
  const dir = mkdtempSync(path.join(tmpdir(), 'ps-corpus-'));
  try {
    const manifest = {
      options: OPTS,
      acceptance: { werMax: 0.2, unitNumberRecallMin: 0.9, fieldAccuracyMin: 0.85 },
      samples: [
        { id: 'P-01', reference: 'کتاب رحلی دویست صفحه تحریر هفتاد گرم دو هزار نسخه' },
        { id: 'P-02', reference: 'پوستر A3 تمام رنگی پانصد نسخه', engineText: 'پوستر A3 تمام رنگی پنجاه نسخه' },
      ],
    };
    const file = path.join(dir, 'manifest.json');
    writeFileSync(file, JSON.stringify(manifest));
    const log = [];
    const orig = console.log; console.log = (...a) => { log.push(a.join(' ')); };
    let res;
    try { res = await runCorpus({ corpusPath: file, opts: { engine: 'human' } }); } finally { console.log = orig; }
    assert.equal(res.rows[0].wer, 0, 'نمونه‌ی سالم باید WER صفر بگیرد');
    assert.equal(res.rows[0].fieldProblems.length, 0);
    assert.equal(res.rows[1].numbersTotal, 1);
    assert.equal(res.rows[1].numbersFound, 0, 'عددِ افتاده باید در فراخوانی دیده شود');
    assert.equal(res.rows[1].fieldProblems[0].field, 'qty');
    assert.ok(res.summary.werMean > 0 && res.summary.werMean < 0.2);
    assert.equal(res.checks.length, 3);
    assert.ok(res.checks.every(c => c.pass === true || c.pass === false));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('engines refuse to run when not installed locally — no silent cloud fallback', async () => {
  const onnx = await V('engines/onnx.mjs');
  await assert.rejects(() => onnx.create({ toolsDir: path.join(tmpdir(), 'ps-nope') }), /موتور نصب نیست/);
  const cli = await V('engines/cli.mjs');
  await assert.rejects(() => cli.create({ cmd: path.join(tmpdir(), 'ps-no-exe.exe') }), /اجرایی پیدا نشد/);
  await assert.rejects(() => cli.create({}), /--engine=cli/);
});
