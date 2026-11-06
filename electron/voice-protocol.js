'use strict';
/* قرارداد پیام صوت در فرایند اصلی: هیچ بایت صوتی بدون این اعتبارسنجی به موتور نمی‌رسد.
   صوت فرمان اجرایی نیست؛ مسیر صوت هیچ کلید داده‌ای نمی‌نویسد و فقط متن برمی‌گرداند. */
const fs = require('node:fs');
const path = require('node:path');

const ASR_SAMPLE_RATE = 16000;
const MAX_SECONDS = 60;
const MIN_SECONDS = 0.4;
/** PCM16 تک‌کانال: ۲ بایت به ازای هر نمونه. */
const MAX_BYTES = MAX_SECONDS * ASR_SAMPLE_RATE * 2;
const MAX_B64_LENGTH = Math.ceil(MAX_BYTES / 3) * 4 + 8;
const DEFAULT_MODEL = 'Xenova/whisper-small';
/* تنظیمات تولیدِ موتور. فرایند اصلی همین را در cfg.generate به موتور می‌فرستد و ابزار سنجش
   (tests/voice/engines/onnx.mjs) همان را می‌خواند تا آنچه اندازه گرفته می‌شود با آنچه می‌چرخد یکی بماند.
   تکرار این مقادیر در voice-engine.js با یک آزمون مقایسه می‌شود، چون موتور بیرون از app.asar اجرا می‌شود
   و به این فایل دسترسی ندارد.
   repetition_penalty از اندازه‌گیری آمد (۱ آبان ۱۴۰۵، یک صوت ۹.۵ ثانیه‌ایِ فارسیِ انسانی):
   بدون آن موتور یک بند را ۱۲ بار تکرار کرد (۵۲۵ نویسه، ۲۹.۶ ثانیه)؛ با آن ۷۹ نویسه در ۷.۸ ثانیه. */
const ASR_GENERATE = { task: 'transcribe', language: 'fa', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false, repetition_penalty: 1.2 };
const TRANSFORMERS_ENTRY = path.join('node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');

function modelDirOf(cacheDir, model) { return path.join(cacheDir, ...String(model).split('/')); }

function engineLayout(dir, model = DEFAULT_MODEL) {
  dir = typeof dir === 'string' ? dir : '';
  return {
    dir,
    model,
    pkgFile: path.join(dir, TRANSFORMERS_ENTRY),
    cacheDir: path.join(dir, 'hf-cache'),
    modelDir: modelDirOf(path.join(dir, 'hf-cache'), model),
  };
}

/** وضعیت نصب موتور، بدون بالا آوردن فرایند: فقط بررسی فایل‌ها. */
function engineStatus(dir, model = DEFAULT_MODEL) {
  const layout = engineLayout(dir, model);
  if (!dir) return { ...layout, installed: false, reason: 'مسیر موتور صوت تعیین نشده است.' };
  if (!fs.existsSync(layout.pkgFile)) {
    return { ...layout, installed: false, reason: `موتور صوت در این سیستم نصب نیست (${layout.pkgFile}). یک‌بار در فاز آماده‌سازی نصب کنید.` };
  }
  const requiredModelFiles = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
  const missing = requiredModelFiles.filter(file => {
    try { const stat = fs.statSync(path.join(layout.modelDir, file)); return !stat.isFile() || !stat.size; }
    catch (_) { return true; }
  });
  if (missing.length) {
    return { ...layout, installed: false, reason: `وزن مدل ${model} محلی نیست (${layout.modelDir}). دانلود وزن فقط در فاز آماده‌سازی و با اجازه انجام می‌شود.` };
  }
  return { ...layout, installed: true, reason: '' };
}

/** اولین مسیر آماده: پوشهٔ کنار بسته، سپس مسیر توسعه؛ اگر هیچ‌کدام آماده نبود، اولی گزارش می‌شود. */
function resolveEngineDir({ env = {}, candidates = [] } = {}) {
  const override = env.PRINTSHOP_ASR_TOOLS;
  const list = (override ? [override] : []).concat(candidates);
  const ready = list.find(dir => engineStatus(dir).installed);
  return { dir: ready || list[0] || '', candidates: list, overridden: !!override };
}

function validateTranscribeRequest(payload) {
  const fail = (code, error) => ({ ok: false, code, error });
  if (!payload || typeof payload !== 'object') return fail('VALIDATION_FAILED', 'درخواست صوت معتبر نیست.');
  if (payload.sampleRate !== ASR_SAMPLE_RATE) return fail('VALIDATION_FAILED', `نرخ نمونه‌برداری باید ${ASR_SAMPLE_RATE} هرتز باشد.`);
  const requestId = payload.requestId;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(requestId)) return fail('VALIDATION_FAILED', 'شناسهٔ درخواست صوت معتبر نیست.');
  const b64 = payload.pcm16Base64;
  if (typeof b64 !== 'string' || !b64.length) return fail('VALIDATION_FAILED', 'صدای ضبط‌شده به برنامه نرسید.');
  if (b64.length > MAX_B64_LENGTH) return fail('TOO_LARGE', `صوت بیش از ${MAX_SECONDS} ثانیه است؛ ضبط را کوتاه‌تر کنید.`);
  if (b64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return fail('VALIDATION_FAILED', 'دادهٔ صوتی معتبر نیست.');
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.toString('base64') !== b64) return fail('VALIDATION_FAILED', 'دادهٔ صوتی معتبر نیست.');
  if (bytes.length % 2) return fail('VALIDATION_FAILED', 'طول نمونه‌های صوتی زوج نیست.');
  const seconds = bytes.length / (ASR_SAMPLE_RATE * 2);
  if (seconds > MAX_SECONDS) return fail('TOO_LARGE', `صوت بیش از ${MAX_SECONDS} ثانیه است؛ ضبط را کوتاه‌تر کنید.`);
  if (seconds < MIN_SECONDS) return fail('TOO_SHORT', 'صوت خیلی کوتاه است؛ چند کلمه کامل صحبت کنید.');
  return { ok: true, requestId, bytes, seconds };
}

function validateCancelRequest(payload) {
  const requestId = payload && payload.requestId;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(requestId)) {
    return { ok: false, code: 'VALIDATION_FAILED', error: 'شناسهٔ درخواست صوت معتبر نیست.' };
  }
  return { ok: true, requestId };
}

module.exports = { ASR_SAMPLE_RATE, MAX_SECONDS, MIN_SECONDS, MAX_BYTES, DEFAULT_MODEL, ASR_GENERATE, engineLayout, engineStatus, resolveEngineDir, validateTranscribeRequest, validateCancelRequest };
