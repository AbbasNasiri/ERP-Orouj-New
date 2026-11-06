'use strict';
/* One local worker, a bounded queue, and a watchdog that also survives cancellation. */
const { engineStatus, validateTranscribeRequest, validateCancelRequest, ASR_GENERATE } = require('./voice-protocol.js');
function createVoiceService({ fork, workerFile, engineDir, model, loadTimeoutMs = 90000, requestTimeoutMs = 180000, maxQueue = 3, log = () => {} } = {}) {
  if (typeof fork !== 'function') throw new Error('createVoiceService به fork نیاز دارد.');
  let proc = null, state = 'stopped', fatal = '', lastMs = 0, current = null, loadTimer = null, disposed = false;
  const queue = [];
  const engine = () => engineStatus(engineDir, model);
  function settle(entry, result, keepTimer = false) {
    if (!entry) return;
    if (!keepTimer) clearTimeout(entry.timer);
    if (entry.settled) return;
    entry.settled = true;
    entry.b64 = '';
    entry.resolve(result);
  }
  function stopWorker(result, reason) {
    log('voice stop: ' + reason);
    const dying = proc;
    // Clear identity before kill so delayed events cannot affect a replacement worker.
    proc = null;
    state = 'stopped';
    clearTimeout(loadTimer);
    loadTimer = null;
    const running = current;
    current = null;
    settle(running, result);
    queue.splice(0).forEach(entry => settle(entry, result));
    if (dying) { try { dying.kill(); } catch (_) {} }
  }
  function pump() {
    if (state !== 'ready' || current || !queue.length) return;
    const entry = queue.shift();
    current = entry;
    entry.timer = setTimeout(() => {
      stopWorker({ ok: false, code: 'TIMEOUT', error: 'تبدیل صوت بیش از حد طول کشید؛ دوباره امتحان کنید یا خودتان تایپ کنید.' }, 'request timeout');
    }, requestTimeoutMs);
    try {
      proc.postMessage({ type: 'asr', id: entry.id, pcm16Base64: entry.b64, language: 'fa' });
      entry.b64 = '';
    } catch (_) {
      stopWorker({ ok: false, code: 'ENGINE_EXITED', error: 'ارتباط با موتور صوت قطع شد؛ دوباره امتحان کنید.' }, 'send failed');
    }
  }
  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      if (state !== 'loading') return;
      state = 'ready';
      clearTimeout(loadTimer);
      loadTimer = null;
      pump();
      return;
    }
    if (msg.type === 'fatal') {
      fatal = String(msg.message || 'موتور صوت بالا نیامد.');
      stopWorker({ ok: false, code: 'ENGINE_UNAVAILABLE', error: fatal }, 'worker fatal');
      state = 'failed';
      return;
    }
    if (msg.type !== 'text' && msg.type !== 'error') return;
    // Ignore late, repeated or unrelated replies without releasing another request's slot.
    if (!current || current.id !== msg.id) return;
    const entry = current;
    current = null;
    if (msg.type === 'error') {
      lastMs = 0;
      settle(entry, { ok: false, code: 'TRANSCRIBE_FAILED', error: 'صوت تبدیل نشد: ' + String(msg.message || 'خطای موتور') });
    } else {
      lastMs = Number.isFinite(msg.ms) && msg.ms >= 0 ? msg.ms : 0;
      const text = typeof msg.text === 'string' ? msg.text : '';
      settle(entry, text.trim() ? { ok: true, text, ms: lastMs, seconds: entry.seconds }
        : { ok: false, code: 'NO_TEXT', error: 'موتور متنی نشناخت؛ نزدیک‌تر صحبت کنید یا خودتان تایپ کنید.' });
    }
    pump();
  }
  function start() {
    if (disposed) return false;
    if (proc) return true;
    const info = engine();
    if (!info.installed) { fatal = info.reason; state = 'failed'; return false; }
    fatal = '';
    state = 'loading';
    try {
      const worker = fork(workerFile, [], { serviceName: 'printshop-voice', stdio: 'pipe' });
      proc = worker;
      worker.on('message', msg => { if (proc === worker) onMessage(msg); });
      worker.on('exit', () => {
        if (proc !== worker) return;
        stopWorker({ ok: false, code: 'ENGINE_EXITED', error: 'فرایند صوت بسته شد؛ دوباره امتحان کنید.' }, 'worker exit');
      });
      worker.on('error', () => {
        if (proc !== worker) return;
        stopWorker({ ok: false, code: 'ENGINE_EXITED', error: 'فرایند صوت با خطا بسته شد؛ دوباره امتحان کنید.' }, 'worker error');
      });
      loadTimer = setTimeout(() => {
        stopWorker({ ok: false, code: 'ENGINE_SLOW', error: 'مدل صوت بالا نیامد؛ دوباره امتحان کنید.' }, 'loading timeout');
      }, loadTimeoutMs);
      worker.postMessage({ type: 'init', cfg: { pkgFile: info.pkgFile, cacheDir: info.cacheDir, modelDir: info.modelDir, model: info.model, generate: ASR_GENERATE } });
      return !!proc;
    } catch (_) {
      fatal = 'موتور صوت اجرا نشد؛ دوباره امتحان کنید.';
      stopWorker({ ok: false, code: 'ENGINE_UNAVAILABLE', error: fatal }, 'worker start failed');
      state = 'failed';
      return false;
    }
  }
  function status() {
    const info = engine();
    return { ok: true, installed: info.installed, reason: fatal || info.reason, state,
      ready: state === 'ready', busy: !!current, queued: queue.length, lastMs, model: info.model, dir: info.dir };
  }
  function transcribe(payload) {
    const v = validateTranscribeRequest(payload);
    if (!v.ok) return Promise.resolve(v);
    if (disposed) return Promise.resolve({ ok: false, code: 'SHUTDOWN', error: 'برنامه بسته شد.' });
    if (current?.id === v.requestId || queue.some(entry => entry.id === v.requestId)) {
      return Promise.resolve({ ok: false, code: 'DUPLICATE_REQUEST', error: 'این درخواست صوت قبلاً در حال انجام است.' });
    }
    const info = engine();
    if (!info.installed) return Promise.resolve({ ok: false, code: 'ENGINE_MISSING', error: info.reason });
    if (queue.length + (current ? 1 : 0) >= maxQueue) {
      return Promise.resolve({ ok: false, code: 'BUSY', error: 'صف تبدیل صوت پر است؛ چند لحظه صبر کنید.' });
    }
    return new Promise(resolve => {
      queue.push({ id: v.requestId, resolve, b64: payload.pcm16Base64, seconds: v.seconds, settled: false });
      start();
      pump();
    });
  }
  function cancel(payload) {
    const v = validateCancelRequest(payload);
    if (!v.ok) return v;
    if (current?.id === v.requestId) {
      // Keep the watchdog: a cancelled inference can also get stuck.
      settle(current, { ok: false, code: 'CANCELED', error: 'تبدیل لغو شد.' }, true);
      return { ok: true, removed: true, running: true };
    }
    const index = queue.findIndex(entry => entry.id === v.requestId);
    if (index < 0) return { ok: true, removed: false };
    settle(queue.splice(index, 1)[0], { ok: false, code: 'CANCELED', error: 'تبدیل لغو شد.' });
    return { ok: true, removed: true, running: false };
  }
  function dispose() {
    disposed = true;
    stopWorker({ ok: false, code: 'SHUTDOWN', error: 'برنامه بسته شد.' }, 'shutdown');
  }
  return { status, transcribe, cancel, dispose, start };
}
module.exports = { createVoiceService };
