/* موتور دلخواه با دستور بیرونی (مثلاً whisper.cpp یا vosk). صدا هرگز به شبکه نمی‌رود.
   آرگومان‌ها به‌صورت آرایه و بدون shell اجرا می‌شوند؛ مسیر فایل فقط جای {WAV} می‌نشیند. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { savePrepared } from '../audio.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
export const name = 'cli';

export async function create({ cmd, args = [], timeoutMs = 600000 } = {}) {
  if (!cmd) throw new Error('برای --engine=cli باید --cmd=مسیر-به-اجرا-قابل‌تنظیم داده شود.');
  if (!existsSync(cmd)) throw new Error(`اجرایی پیدا نشد: ${cmd} (موتور نصب نشده؛ آزمون را به سرویس اینترنتی نمی‌فرستد.)`);
  const dir = mkdtempSync(join(tmpdir(), 'ps-voice-'));
  return {
    name: `cli:${cmd}`,
    needsAudio: true,
    async transcribe(sample, prepared) {
      const wavPath = join(dir, `${sample.id}.wav`);
      savePrepared(wavPath, prepared);
      const r = await run(cmd, args.map(a => String(a).replaceAll('{WAV}', wavPath)), { maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs, windowsHide: true });
      return { text: String(r.stdout).trim() };
    },
    async dispose() { rmSync(dir, { recursive: true, force: true }); },
  };
}
