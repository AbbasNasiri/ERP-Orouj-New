/* قرائت WAV و تنظیف صوت حالا در src/voice-audio.mjs است (همان کدی که ضبط زندهٔ برنامه استفاده می‌کند)؛
   این فایل فقط بخش خواندن/نوشتن فایل را برای ابزار سنجش اضافه می‌کند تا دو مسیر یکی بمانند. */
import { readFileSync, writeFileSync } from 'node:fs';
import { readWav, toMono, resample, writeWavPcm16, floatToPcm16, pcm16ToFloat32, prepareAudioBuffer, ASR_SAMPLE_RATE, MAX_DICTATION_SECONDS, prepareLiveCapture } from '../../src/voice-audio.mjs';

export { readWav, toMono, resample, writeWavPcm16, floatToPcm16, pcm16ToFloat32, prepareAudioBuffer, ASR_SAMPLE_RATE, MAX_DICTATION_SECONDS, prepareLiveCapture };

/** فایل صوتی -> داده آماده‌ی موتور: ۱۶kHz، تک‌کانال، PCM16 */
export function prepareAudio(path, { targetRate = ASR_SAMPLE_RATE } = {}) {
  const prepared = prepareAudioBuffer(readFileSync(path), { targetRate });
  return { ...prepared, sourceRate: prepared.sourceRate };
}

export function savePrepared(path, prepared) { writeFileSync(path, prepared.wav); return path; }
