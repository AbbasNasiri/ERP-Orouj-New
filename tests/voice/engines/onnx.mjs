/* موتور محلی Whisper روی ONNX Runtime (transformers.js) — نصب‌شده در tools/voice-asr، بیرون از
   وابستگی‌های برنامه. در حالت عادی (بدون --allow-download) اجازه‌ی دانلود ندارد: اگر وزن محلی نباشد
   با پیام روشن می‌ایستد و هرگز صوت را به سرویس اینترنتی نمی‌فرستد. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

/* همان تنظیماتی که برنامه می‌چرخاند: voice-protocol.js تنها منبع است و ابزار سنجش آن را می‌خواند،
   پس عددی که اندازه می‌گیرید دقیقاً همان چیزی است که تحویل می‌شود. */
const { ASR_GENERATE } = createRequire(import.meta.url)('../../../electron/voice-protocol.js');

export const name = 'onnx';

function defaultToolsDir() {
  if (process.env.PRINTSHOP_ASR_TOOLS) return process.env.PRINTSHOP_ASR_TOOLS;
  const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
  return join(projectRoot, '..', 'tools', 'voice-asr');
}

export async function create({ model = 'Xenova/whisper-small', toolsDir = defaultToolsDir(), cacheDir, threads = 2, allowDownload = false, generate = ASR_GENERATE } = {}) {
  const pkg = join(toolsDir, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs');
  if (!existsSync(pkg)) throw new Error(`موتور نصب نیست (${pkg}). ابتدا در فاز آماده‌سازی نصب و وزن دانلود کنید؛ این آزمون صوت را به اینترنت نمی‌فرستد.`);
  const mod = await import(pathToFileURL(pkg).href);
  const { pipeline, env } = mod;
  const home = cacheDir || join(toolsDir, 'hf-cache');
  env.cacheDir = home;
  env.allowRemote = !!allowDownload;
  env.allowLocal = true;
  env.useBrowserCache = false;
  if (!allowDownload && !existsSync(join(home, ...model.split('/')))) {
    throw new Error(`وزن مدل محلی (${model}) در ${home} نیست. یک‌بار با --allow-download دانلود کنید (فقط فاز آماده‌سازی).`);
  }
  const t0 = Date.now();
  const asr = await pipeline('automatic-speech-recognition', model, { dtype: 'q8', device: 'cpu' });
  const loadedMs = Date.now() - t0;
  return {
    name: `onnx:${model}`,
    needsAudio: true,
    loadInfo: { model, threads, loadedMs, cacheDir: home, generate },
    /* در Node پیاده‌سازی صوتی مرورگر (AudioContext) نیست؛ نمونه‌ها را مستقیم می‌دهیم.
       آرایه باید ۱۶kHz تک‌کانال باشد (کارِ prepareAudio)؛ موتور نرخ را از آرایه نمی‌خواند.
       فایده‌ی جانبی: هیچ فایل موقت صوتی روی دیسک نمی‌نشیند. */
    async transcribe(sample, prepared) {
      if (!prepared) throw new Error('صدای آماده‌شده (۱۶kHz تک‌کانال) به موتور نرسید.');
      if (prepared.sampleRate !== 16000) throw new Error(`موتور ONNX نمونه‌ی ۱۶kHz می‌خواهد؛ ${prepared.sampleRate} داده شد.`);
      const out = await asr(prepared.pcm, generate);
      const text = typeof out === 'string' ? out : out?.text ?? '';
      if (!String(text).trim()) throw new Error(`نمونه‌ی ${sample.id}: موتور متن خالی برگرداند.`);
      return { text: String(text) };
    },
    async dispose() { try { await asr.dispose?.(); } catch { /* پایان آزمون */ } },
  };
}
