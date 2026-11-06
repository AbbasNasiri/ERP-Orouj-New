'use strict';
/* فرایند جانبی صوت: مدل Whisper فقط اینجا بارگذاری می‌شود تا صفحه‌بندی وIPC اصلی درگیر محاسبه نشوند.
   allowRemote=false است؛ اگر وزن محلی نباشد خطا می‌دهد و هرگز صوت را به شبکه نمی‌فرستد.
   این فایل هیچ دسترسی به داده‌های برنامه ندارد و فقط متن برمی‌گرداند. */
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

function decodePcm16Base64(b64) {
  const buf = Buffer.from(b64, 'base64');
  const view = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) out[i] = view[i] < 0 ? view[i] / 32768 : view[i] / 32767;
  return out;
}

/* این فایل کنارِ بسته (بیرون app.asar) اجرا می‌شود و به voice-protocol.js دسترسی ندارد، پس
   DEFAULT_GENERATE همین‌جا تکرار شده و tests/voice-service.test.cjs آن را با ASR_GENERATE یکسان می‌داند.
   فرایند اصلی در msg.cfg.generate همان ASR_GENERATE را می‌فرستد. */
const DEFAULT_GENERATE = { language: 'fa', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false, repetition_penalty: 1.2 };

let asr = null;
let loading = null;
let generate = DEFAULT_GENERATE;

async function ensureLoaded(cfg) {
  generate = { ...DEFAULT_GENERATE, ...(cfg && cfg.generate) };
  if (asr) return { loadedMs: 0 };
  if (loading) return loading;
  loading = (async () => {
    if (!cfg || !cfg.pkgFile || !fs.existsSync(cfg.pkgFile)) throw new Error(`موتور صوت نصب نیست (${cfg && cfg.pkgFile}).`);
    if (!fs.existsSync(cfg.modelDir)) throw new Error(`وزن مدل ${cfg.model} در ${cfg.cacheDir} نیست. دانلود وزن فقط در فاز آماده‌سازی و با اجازهٔ صاحب برنامه انجام می‌شود.`);
    const mod = await import(pathToFileURL(cfg.pkgFile).href);
    const { pipeline, env } = mod;
    env.cacheDir = cfg.cacheDir;
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    const t0 = Date.now();
    asr = await pipeline('automatic-speech-recognition', cfg.model, { dtype: 'q8', device: 'cpu', local_files_only: true });
    return { loadedMs: Date.now() - t0 };
  })().catch(e => { loading = null; throw e; });
  return loading;
}

async function transcribe(msg) {
  const samples = decodePcm16Base64(msg.pcm16Base64);
  if (!samples.length) throw new Error('نمونهٔ صوتی خالی است.');
  const t0 = Date.now();
  const out = await asr(samples, {
    ...generate,
    language: msg.language || generate.language,
  });
  const text = String(typeof out === 'string' ? out : (out && out.text) || '');
  return { text, ms: Date.now() - t0, samples: samples.length };
}

async function handle(msg, send) {
  if (!msg || typeof msg !== 'object') return;
  try {
    if (msg.type === 'init') {
      const info = await ensureLoaded(msg.cfg || {});
      send({ type: 'ready', loadedMs: info.loadedMs, model: (msg.cfg || {}).model });
    } else if (msg.type === 'asr') {
      const r = await transcribe(msg);
      send({ type: 'text', id: msg.id, text: r.text, ms: r.ms, samples: r.samples });
    }
  } catch (e) {
    const message = String((e && e.message) || e);
    if (msg.type === 'init') send({ type: 'fatal', message });
    else send({ type: 'error', id: msg.id, message });
  }
}

module.exports = { decodePcm16Base64, ensureLoaded, transcribe, handle, DEFAULT_GENERATE };

if (process.parentPort) {
  const send = message => { try { process.parentPort.postMessage(message); } catch (_) { /* فرایند اصلی بسته شد */ } };
  process.parentPort.on('message', e => handle(e.data, send));
  process.on('unhandledRejection', reason => send({ type: 'fatal', message: String((reason && reason.message) || reason) }));
}
