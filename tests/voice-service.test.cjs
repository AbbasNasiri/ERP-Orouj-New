'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');

const protocol = require('../electron/voice-protocol.js');
const { createVoiceService } = require('../electron/voice-service.js');
const audio = () => import(pathToFileURL(path.resolve(__dirname, '../src/voice-audio.mjs')).href);

function fakeEngineDir(model = protocol.DEFAULT_MODEL) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-voice-engine-'));
  const pkg = path.join(dir, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');
  fs.mkdirSync(path.dirname(pkg), { recursive: true });
  fs.writeFileSync(pkg, '');
  const modelDir = path.join(dir, 'hf-cache', ...model.split('/'));
  fs.mkdirSync(path.join(modelDir, 'onnx'), { recursive: true });
  for (const file of ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']) fs.writeFileSync(path.join(modelDir, file), 'test');
  return dir;
}

function payload({ seconds = 2, sampleRate = protocol.ASR_SAMPLE_RATE, requestId = 'req-1', b64 } = {}) {
  const bytes = b64 !== undefined ? null : Buffer.alloc(Math.round(seconds * protocol.ASR_SAMPLE_RATE) * 2, 0x40);
  return { requestId, sampleRate, pcm16Base64: b64 !== undefined ? b64 : bytes.toString('base64') };
}

test('صدای درخواست فقط با قالب توافق‌شده پذیرفته می‌شود و هر شکل دیگر با پیام روشن رد می‌شود', () => {
  assert.equal(protocol.validateTranscribeRequest(payload({ seconds: 2 })).ok, true);
  assert.equal(protocol.validateTranscribeRequest(payload({ sampleRate: 44100 })).code, 'VALIDATION_FAILED');
  assert.equal(protocol.validateTranscribeRequest(payload({ requestId: 'a'.repeat(50) })).code, 'VALIDATION_FAILED');
  assert.equal(protocol.validateTranscribeRequest(payload({ b64: 'not base64 !!' })).code, 'VALIDATION_FAILED');
  assert.equal(protocol.validateTranscribeRequest(payload({ b64: 'AAAB' })).code, 'VALIDATION_FAILED');
  const validPadded = payload({ seconds: 0.5 }).pcm16Base64;
  assert.equal(protocol.validateTranscribeRequest(payload({ b64: validPadded.slice(0, -1) })).code, 'VALIDATION_FAILED', 'padding must not be silently repaired');
  assert.equal(protocol.validateTranscribeRequest(payload({ b64: validPadded.slice(0, -3) + 'B==' })).code, 'VALIDATION_FAILED', 'non-zero padding bits are rejected');
  assert.equal(protocol.validateTranscribeRequest(payload({ seconds: 0.1 })).code, 'TOO_SHORT');
  assert.equal(protocol.validateTranscribeRequest(payload({ seconds: 75 })).code, 'TOO_LARGE');
  assert.equal(protocol.validateTranscribeRequest(null).code, 'VALIDATION_FAILED');
  // سقف مدت در قرارداد ثبت شده و بزرگ‌ترین صدای مجاز دقیقاً همان است
  const biggest = Buffer.alloc(protocol.MAX_BYTES - 2, 7).toString('base64');
  assert.equal(protocol.validateTranscribeRequest(payload({ b64: biggest })).ok, true);
});

test('وضعیت موتور از روی فایل‌های محلی خوانده می‌شود و بدون شبکه قضاوت می‌کند', () => {
  assert.equal(protocol.engineStatus().installed, false, 'missing path is a status, not an exception');
  const ready = fakeEngineDir();
  try {
    const installed = protocol.engineStatus(ready);
    assert.equal(installed.installed, true);
    assert.equal(installed.reason, '');
    const weights = path.join(installed.modelDir, 'onnx', 'encoder_model_quantized.onnx');
    fs.writeFileSync(weights, '');
    assert.equal(protocol.engineStatus(ready).installed, false, 'empty weights do not count as an installed model');
    fs.writeFileSync(weights, 'test');
    fs.unlinkSync(path.join(installed.modelDir, 'tokenizer.json'));
    assert.equal(protocol.engineStatus(ready).installed, false, 'a partial model directory must not look ready');
    fs.rmSync(installed.modelDir, { recursive: true, force: true });
    const noModel = protocol.engineStatus(ready);
    assert.equal(noModel.installed, false);
    assert.match(noModel.reason, /وزن مدل/);
    assert.match(noModel.reason, /فاز آماده‌سازی/);
  } finally { fs.rmSync(ready, { recursive: true, force: true }); }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-voice-none-'));
  try {
    assert.equal(protocol.engineStatus(empty).installed, false);
    assert.match(protocol.engineStatus(empty).reason, /موتور صوت در این سیستم نصب نیست/);
    const chosen = protocol.resolveEngineDir({ env: { PRINTSHOP_ASR_TOOLS: empty }, candidates: [empty] });
    assert.equal(chosen.dir, empty);
    assert.equal(chosen.overridden, true);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

/** موتور ساختگی: همان قرارداد پیام voice-engine.js را بازی می‌کند تا چرخهٔ عمر در تست آزمون‌پذیر بماند. */
function fakeFork({ reply, respond = true } = {}) {
  const proc = new EventEmitter();
  proc.messages = [];
  proc.listenersFor = [];
  proc.killed = false;
  proc.postMessage = message => {
    proc.messages.push(message);
    if (!respond || message.type !== 'asr') return;
    const out = reply ? reply(message) : { type: 'text', id: message.id, text: 'سلام', ms: 5 };
    if (out) setImmediate(() => proc.emit('message', out));
  };
  proc.kill = () => { proc.killed = true; };
  setImmediate(() => proc.emit('message', { type: 'ready', loadedMs: 3 }));
  fakeFork.last = proc;
  return proc;
}

test('درخواست‌های صوت یکی‌یکی به موتور می‌روند و پاسخ هر شناسه به خودِ درخواست برمی‌گردد', async () => {
  const dir = fakeEngineDir();
  try {
    const seen = [];
    const service = createVoiceService({
      fork: (file, args, options) => {
        const proc = new EventEmitter();
        proc.messages = [];
        proc.postMessage = m => { proc.messages.push(m); if (m.type === 'asr') setImmediate(() => proc.emit('message', { type: 'text', id: m.id, text: `متن ${m.id}`, ms: 11 })); };
        proc.kill = () => {};
        seen.push({ file, args, options });
        setImmediate(() => proc.emit('message', { type: 'ready', loadedMs: 2 }));
        fakeFork.last = proc;
        return proc;
      },
      workerFile: 'engine.js', engineDir: dir,
    });
    const first = service.transcribe(payload({ requestId: 'aaa' }));
    const second = service.transcribe(payload({ requestId: 'bbb' }));
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1.ok, true); assert.equal(r1.text, 'متن aaa');
    assert.equal(r2.ok, true); assert.equal(r2.text, 'متن bbb');
    assert.equal(seen[0].file, 'engine.js');
    assert.equal(seen[0].options.serviceName, 'printshop-voice');
    assert.deepEqual(seen[0].args, []);
    const asrs = fakeFork.last.messages.filter(m => m.type === 'asr');
    assert.equal(asrs.length, 2, 'هر درخواست یک پیام asr دارد');
    assert.equal(asrs[0].language, 'fa');
    assert.equal(service.status().state, 'ready');
    assert.equal(service.status().busy, false);
    service.dispose();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('تنظیمات تولیدِ موتور یک منبع دارد و همان عدد به فرایند صوت فرستاده می‌شود', async () => {
  const engine = require('../electron/voice-engine.js');
  assert.deepEqual(protocol.ASR_GENERATE, engine.DEFAULT_GENERATE,
    'موتورِ کنارِ بسته و فرایند اصلی باید یک تنظیم بسازند؛ ابزار سنجش همین عدد را می‌خواند');
  const dir = fakeEngineDir();
  try {
    const service = createVoiceService({ fork: () => fakeFork(), workerFile: 'engine.js', engineDir: dir });
    await service.transcribe(payload({ seconds: 1 }));
    const init = fakeFork.last.messages.find(m => m.type === 'init');
    assert.ok(init, 'پیام init باید فرستاده شود');
    assert.deepEqual(init.cfg.generate, protocol.ASR_GENERATE);
    service.dispose();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('بدون موتور نصب‌شده هیچ فرایندی بالا نمی‌آید و پیام فارسی روشن برگردانده می‌شود', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'printshop-voice-none-'));
  let forks = 0;
  try {
    const service = createVoiceService({ fork: () => { forks++; return fakeFork(); }, workerFile: 'engine.js', engineDir: empty });
    const r = await service.transcribe(payload());
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ENGINE_MISSING');
    assert.match(r.error, /نصب نیست/);
    assert.equal(forks, 0, 'نباید بدون موتور، فرایند صوت ساخته شود');
    assert.equal(service.status().installed, false);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('صف کوتاه است، درخواست در صف لغو می‌شود و درخواست در حال انجام بی‌نتیجه رها می‌شود', async () => {
  const dir = fakeEngineDir();
  try {
    let proc = null;
    const service = createVoiceService({
      fork: () => {
        proc = new EventEmitter();
        proc.messages = [];
        proc.kill = () => {};
        proc.postMessage = m => proc.messages.push(m);
        setImmediate(() => proc.emit('message', { type: 'ready', loadedMs: 1 }));
        return proc;
      },
      workerFile: 'engine.js', engineDir: dir, maxQueue: 2,
    });
    const a = service.transcribe(payload({ requestId: 'aaa' }));
    const b = service.transcribe(payload({ requestId: 'bbb' }));
    await new Promise(resolve => setImmediate(resolve));
    const c = await service.transcribe(payload({ requestId: 'ccc' }));
    assert.equal(c.code, 'BUSY', 'صف پر است و درخواست تازه رد می‌شود');
    assert.equal(proc.messages.filter(m => m.type === 'asr').length, 1, 'در حالی که موتور مشغول است درخواست دوم ارسال نمی‌شود');
    assert.deepEqual(service.cancel({ requestId: 'bbb' }), { ok: true, removed: true, running: false });
    assert.equal((await b).code, 'CANCELED');
    // حالا موتور آزاد می‌شود و درخواست بعدی ارسال می‌گردد
    proc.emit('message', { type: 'text', id: 'aaa', text: 'یک', ms: 4 });
    assert.equal((await a).text, 'یک');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(proc.messages.filter(m => m.type === 'asr').length, 1, 'درخواست لغوشده ارسال نمی‌شود');
    // لغو درخواستِ در حال محاسبه: نتیجهٔ دیرهنگام دور ریخته می‌شود
    const d = service.transcribe(payload({ requestId: 'ddd' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.cancel({ requestId: 'ddd' }).running, true);
    assert.equal((await d).code, 'CANCELED');
    proc.emit('message', { type: 'text', id: 'ddd', text: 'نباید برسد', ms: 4 });
    assert.equal(service.status().busy, false);
    assert.equal(service.cancel({ requestId: '!!!' }).code, 'VALIDATION_FAILED');
    service.dispose();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function controlledService(t, overrides = {}) {
  const dir = fakeEngineDir();
  const procs = [];
  const service = createVoiceService({ engineDir: dir, workerFile: 'engine.js',
    requestTimeoutMs: 100, loadTimeoutMs: 500,
    fork: () => {
      const worker = new EventEmitter();
      worker.messages = [];
      worker.killed = false;
      worker.kill = () => { worker.killed = true; };
      worker.postMessage = m => worker.messages.push(m);
      procs.push(worker);
      return worker;
    }, ...overrides });
  t.after(() => { service.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, procs };
}

test('timeout settles both running and queued audio and stale worker events cannot break recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, procs } = controlledService(t);
  const running = service.transcribe(payload({ requestId: 'run' }));
  const waiting = service.transcribe(payload({ requestId: 'wait' }));
  procs[0].emit('message', { type: 'ready' });
  t.mock.timers.tick(101);
  assert.equal((await running).code, 'TIMEOUT');
  assert.equal((await waiting).code, 'TIMEOUT');
  assert.equal(procs[0].killed, true);
  const next = service.transcribe(payload({ requestId: 'next' }));
  procs[0].emit('exit');
  procs[0].emit('message', { type: 'fatal', message: 'stale failure' });
  procs[0].emit('message', { type: 'ready' });
  assert.equal(service.status().state, 'loading');
  procs[1].emit('message', { type: 'ready' });
  procs[1].emit('message', { type: 'text', id: 'next', text: 'بازیابی', ms: 5 });
  assert.equal((await next).text, 'بازیابی');
  assert.equal(service.status().ready, true);
});

test('cancelled running inference keeps its watchdog and rejects duplicate IDs until it ends', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { service, procs } = controlledService(t);
  const running = service.transcribe(payload({ requestId: 'run' }));
  const waiting = service.transcribe(payload({ requestId: 'wait' }));
  assert.equal((await service.transcribe(payload({ requestId: 'wait' }))).code, 'DUPLICATE_REQUEST');
  procs[0].emit('message', { type: 'ready' });
  service.cancel({ requestId: 'run' });
  assert.equal((await running).code, 'CANCELED');
  assert.equal((await service.transcribe(payload({ requestId: 'run' }))).code, 'DUPLICATE_REQUEST');
  t.mock.timers.tick(101);
  assert.equal((await waiting).code, 'TIMEOUT');
  assert.equal(procs[0].killed, true);
  assert.equal(service.status().busy, false);
});

test('unrelated or repeated replies never release the active worker slot', async t => {
  const { service, procs } = controlledService(t);
  const a = service.transcribe(payload({ requestId: 'aaa' }));
  const b = service.transcribe(payload({ requestId: 'bbb' }));
  procs[0].emit('message', { type: 'ready' });
  procs[0].emit('message', { type: 'text', id: 'unknown', text: 'wrong' });
  assert.equal(service.status().busy, true);
  assert.equal(service.status().queued, 1);
  assert.equal(procs[0].messages.filter(m => m.type === 'asr').length, 1);
  procs[0].emit('message', { type: 'text', id: 'aaa', text: 'اول' });
  assert.equal((await a).text, 'اول');
  procs[0].emit('message', { type: 'text', id: 'aaa', text: 'late duplicate' });
  assert.equal(service.status().busy, true);
  procs[0].emit('message', { type: 'text', id: 'bbb', text: 'دوم' });
  assert.equal((await b).text, 'دوم');
});

test('load timeout, crash, fatal and send failure resolve every pending request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const cause of ['loading', 'exit', 'error', 'fatal', 'send']) {
    const { service, procs } = controlledService(t);
    const a = service.transcribe(payload({ requestId: 'aaa' }));
    const b = service.transcribe(payload({ requestId: 'bbb' }));
    if (cause === 'loading') t.mock.timers.tick(501);
    else if (cause === 'fatal') procs[0].emit('message', { type: 'fatal', message: 'model unavailable' });
    else if (cause === 'send') {
      procs[0].postMessage = () => { throw new Error('closed'); };
      procs[0].emit('message', { type: 'ready' });
    } else procs[0].emit(cause, cause === 'error' ? new Error('crash') : undefined);
    const results = await Promise.all([a, b]);
    assert.equal(results.every(r => !r.ok), true, cause);
    assert.equal(service.status().queued, 0, cause);
    assert.equal(service.status().busy, false, cause);
    service.dispose();
  }
});

test('fork and init send exceptions fail closed, and disposed services cannot restart', async t => {
  for (const fork of [() => { throw new Error('cannot fork'); }, () => {
    const worker = new EventEmitter();
    worker.kill = () => {};
    worker.postMessage = () => { throw new Error('init closed'); };
    return worker;
  }]) {
    const { service } = controlledService(t, { fork });
    assert.equal((await service.transcribe(payload())).code, 'ENGINE_UNAVAILABLE');
    service.dispose();
    assert.equal((await service.transcribe(payload())).code, 'SHUTDOWN');
    assert.equal(service.start(), false);
  }
});

test('worker errors and empty text remain explicit without blocking the next request', async t => {
  const { service, procs } = controlledService(t);
  const failed = service.transcribe(payload({ requestId: 'fail' }));
  const empty = service.transcribe(payload({ requestId: 'empty' }));
  procs[0].emit('message', { type: 'ready' });
  procs[0].emit('message', { type: 'error', id: 'fail', message: 'مدل جواب نداد' });
  assert.equal((await failed).code, 'TRANSCRIBE_FAILED');
  procs[0].emit('message', { type: 'text', id: 'empty', text: '  ' });
  assert.equal((await empty).code, 'NO_TEXT');
  assert.equal(service.status().busy, false);
});

test('قالب دادهٔ ضبط زنده با همان قالب فایل صوتی یکی می‌شود و سقف ۶۰ ثانیه را برمی‌گرداند', async () => {
  const { prepareLiveCapture, prepareAudioBuffer, writeWavPcm16, ASR_SAMPLE_RATE, MAX_DICTATION_SECONDS } = await audio();
  assert.equal(ASR_SAMPLE_RATE, 16000);
  assert.equal(MAX_DICTATION_SECONDS, 60);
  const chunkA = new Float32Array(4800).fill(0.5);
  const chunkB = new Float32Array(4800).fill(-0.25);
  const live = prepareLiveCapture({ chunks: [chunkA, chunkB], sourceRate: 48000 });
  assert.equal(live.sampleRate, 16000);
  assert.ok(Math.abs(live.seconds - 0.2) < 0.01, `duration ${live.seconds}`);
  assert.equal(live.peak, 0.5);
  assert.equal(live.pcm16.length, Math.round(live.seconds * 16000));
  const truncated = prepareLiveCapture({ chunks: [new Float32Array(48000 * 70).fill(0.1)], sourceRate: 48000 });
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.seconds <= 60.001);
  // مسیر فایل و مسیر زنده باید بایت‌بندی یکسان بدهند
  const round = prepareAudioBuffer(writeWavPcm16(new Float32Array([...chunkA, ...chunkB]), 48000));
  assert.equal(round.sampleRate, 16000);
  assert.deepEqual(Array.from(round.pcm16.subarray(0, 8)), Array.from(live.pcm16.subarray(0, 8)));
  assert.throws(() => prepareLiveCapture({ chunks: [], sourceRate: 48000 }), /میکروفون/);
});

test('فقط کادرهای متن‌پذیر میزبان صوت‌اند و متن در همان کادر جای React‌پذیر درج می‌شود', async () => {
  const fields = await import(pathToFileURL(path.resolve(__dirname, '../src/voice-fields.mjs')).href);
  assert.equal(fields.isDictatable({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(fields.isDictatable({ tagName: 'INPUT', type: '' }), true);
  assert.equal(fields.isDictatable({ tagName: 'TEXTAREA' }), true);
  assert.equal(fields.isDictatable({ tagName: 'INPUT', type: 'password' }), false);
  assert.equal(fields.isDictatable({ tagName: 'INPUT', type: 'number' }), false);
  assert.equal(fields.isDictatable({ tagName: 'TEXTAREA', readOnly: true }), false);
  assert.equal(fields.isDictatable({ tagName: 'INPUT', type: 'text', disabled: true }), false);
  assert.equal(fields.isDictatable({ tagName: 'SELECT' }), false);
  assert.equal(fields.isDictatable(null), false);

  const events = [];
  const element = {
    tagName: 'TEXTAREA', value: 'یک', readOnly: false, disabled: false,
    dispatchEvent: event => events.push(event.type),
    setSelectionRange: (a, b) => events.push(`caret:${a}:${b}`),
  };
  const proto = {};
  Object.defineProperty(proto, 'value', { get() { return element.value; }, set(v) { events.push(`set:${v}`); element.value = v; } });
  const win = { HTMLTextAreaElement: { prototype: proto }, Event: function Event(type) { this.type = type; } };
  assert.equal(fields.insertIntoField(element, 'دو', { win }), true);
  assert.equal(element.value, 'یک\nدو', 'متن جدید به آخر متن قبلی می‌چسبد');
  assert.deepEqual(events, ['set:یک\nدو', 'input', 'caret:5:5']);
  assert.equal(fields.insertIntoField({ tagName: 'INPUT', type: 'password', value: '' }, 'x', { win }), false);
  assert.equal(fields.insertIntoField(element, 'سه', { win: null }), false);
});
