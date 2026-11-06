/* خالص، بدون وابستگی و بدون شبکه: تبدیل دادهٔ میکروفون و فایل WAV به قالبی که موتورهای ASR می‌خواهند
   (۱۶ کیلوهرتز، تک‌کانال، PCM16). هم ضبط زندهٔ برنامه و هم ابزار سنجش آزمون از همین توابع استفاده می‌کنند
   تا رفتار دو مسیر یکی باشد و هیچ تبدیل صوتی در جای دیگر تکرار نشود. */

export const ASR_SAMPLE_RATE = 16000;
/** سقف ضبط یک درخواست: محدودیت حجم، هم در همین ماژول و هم در قرارداد IPC بررسی می‌شود. */
export const MAX_DICTATION_SECONDS = 60;

const fmtInt = (view, off, bit, signed = true) => {
  if (bit === 8) { const v = view.getUint8(off); return signed ? v - 128 : v; }
  if (bit === 16) return view.getInt16(off, true);
  if (bit === 24) { const lo = view.getUint8(off), mid = view.getUint8(off + 1), hi = view.getInt8(off + 2); return (hi << 16) | (mid << 8) | lo; }
  if (bit === 32) return view.getInt32(off, true);
  throw new Error(`عمق ${bit} بیت پشتیبانی نمی‌شود.`);
};

export function readWav(bytes) {
  const buf = typeof Uint8Array !== 'undefined' && bytes instanceof Uint8Array
    ? (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    : bytes;
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('فایل WAV معتبر نیست. اگر صوت از موبایل است (m4a)، ابتدا آن را به WAV منتقل کنید.');
  }
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        blockAlign: buf.readUInt16LE(body + 12),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
      // WAVE_FORMAT_EXTENSIBLE: کدک واقعی در ۱۶ بایت اول sub-format پنهان است
      if (fmt.audioFormat === 0xfffe && size >= 40) fmt.audioFormat = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = buf.subarray(body, body + Math.min(size, buf.length - body));
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('بخش fmt یا data در WAV پیدا نشد.');
  const isFloat = fmt.audioFormat === 3 || fmt.audioFormat === 0xfff3;
  if (!isFloat && fmt.audioFormat !== 1) throw new Error(`کدک WAV شماره ${fmt.audioFormat} پشتیبانی نمی‌شود (فقط PCM شناور).`);
  const bytesPer = fmt.bitsPerSample / 8;
  if (fmt.blockAlign !== bytesPer * fmt.channels) throw new Error('blockAlign با عمق بیت و تعداد کانال نمی‌خواند.');
  const frames = Math.floor(data.length / fmt.blockAlign);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const channels = [];
  for (let c = 0; c < fmt.channels; c++) channels.push(new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const at = i * fmt.blockAlign + c * bytesPer;
      let v;
      if (isFloat) v = bytesPer === 4 ? view.getFloat32(at, true) : bytesPer === 8 ? view.getFloat64(at, true) : 0;
      else v = fmtInt(view, at, fmt.bitsPerSample) / (fmt.bitsPerSample === 8 ? 128 : 2 ** (fmt.bitsPerSample - 1));
      channels[c][i] = v;
    }
  }
  return { sampleRate: fmt.sampleRate, channels, frames, isFloat, bitsPerSample: fmt.bitsPerSample };
}

export function toMono({ channels }) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const c of channels) s += c[i];
    out[i] = s / channels.length;
  }
  return out;
}

export function resample(mono, fromRate, toRate) {
  if (!(fromRate > 0 && toRate > 0)) throw new Error('نرخ نمونه‌برداری نامعتبر است.');
  if (fromRate === toRate) return mono;
  const ratio = fromRate / toRate;
  const len = Math.max(0, Math.floor(mono.length / ratio));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, mono.length - 1);
    const t = pos - a;
    out[i] = mono[a] * (1 - t) + mono[b] * t;
  }
  return out;
}

export function floatToPcm16(mono) {
  const out = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const v = Math.max(-1, Math.min(1, mono[i]));
    out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
  }
  return out;
}

export function pcm16ToFloat32(pcm) {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] < 0 ? pcm[i] / 32768 : pcm[i] / 32767;
  return out;
}

export function writeWavPcm16(mono, sampleRate) {
  const pcm = floatToPcm16(mono);
  const n = pcm.length;
  const buf = typeof Buffer !== 'undefined' ? Buffer.alloc(44 + n * 2) : new Uint8Array(44 + n * 2);
  const write = (text, at) => { for (let i = 0; i < text.length; i++) buf[at + i] = text.charCodeAt(i); };
  const u16 = (v, at) => { buf[at] = v & 255; buf[at + 1] = (v >> 8) & 255; };
  const u32 = (v, at) => { buf[at] = v & 255; buf[at + 1] = (v >>> 8) & 255; buf[at + 2] = (v >>> 16) & 255; buf[at + 3] = (v >>> 24) & 255; };
  write('RIFF', 0); u32(36 + n * 2, 4); write('WAVE', 8);
  write('fmt ', 12); u32(16, 16);
  u16(1, 20); u16(1, 22);
  u32(sampleRate, 24); u32(sampleRate * 2, 28);
  u16(2, 32); u16(16, 34);
  write('data', 36); u32(n * 2, 40);
  for (let i = 0; i < n; i++) u16(pcm[i] < 0 ? pcm[i] + 65536 : pcm[i], 44 + i * 2);
  return buf;
}

/** بلوک‌های زندهٔ AudioContext (Float32 per channel) -> داده آمادهٔ موتور + اعداد بازخورد سطح صدا. */
export function prepareLiveCapture({ chunks, sourceRate, targetRate = ASR_SAMPLE_RATE, maxSeconds = MAX_DICTATION_SECONDS }) {
  if (!Array.isArray(chunks) || !chunks.length) throw new Error('هیچ نمونه‌ای از میکروفون نرسید.');
  if (!(sourceRate > 0)) throw new Error('نرخ نمونه‌برداری میکروفون نامعلوم است.');
  let total = 0;
  for (const c of chunks) total += c.length;
  const mono = new Float32Array(total);
  let at = 0, peak = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const v = c[i];
      mono[at++] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }
  const rawSeconds = total / sourceRate;
  const limit = Math.max(0, Math.floor(maxSeconds * sourceRate));
  const trimmed = rawSeconds > maxSeconds ? mono.subarray(0, limit) : mono;
  const ready = resample(trimmed, sourceRate, targetRate);
  return {
    pcm16: floatToPcm16(ready),
    sampleRate: targetRate,
    sourceRate,
    seconds: ready.length / targetRate,
    rawSeconds,
    truncated: rawSeconds > maxSeconds,
    peak,
  };
}

/** فایل صوتی -> داده آماده‌ی موتور: ۱۶kHz، تک‌کانال، PCM16 */
export function prepareAudioBuffer(bytes, { targetRate = ASR_SAMPLE_RATE } = {}) {
  const wav = readWav(bytes);
  const mono = toMono(wav);
  const ready = resample(mono, wav.sampleRate, targetRate);
  return { pcm: ready, pcm16: floatToPcm16(ready), sampleRate: targetRate, sourceRate: wav.sampleRate, seconds: ready.length / targetRate, wav: writeWavPcm16(ready, targetRate) };
}
