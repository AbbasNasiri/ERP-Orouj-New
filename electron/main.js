const { app, BrowserWindow, Menu, ipcMain, shell, dialog, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const { fileURLToPath } = require('url');
const { createBackend } = require('./backend.js');
const { pdfPrintOptions, safePdfName, paperMm } = require('./pdf-export.js');
const { createVoiceService } = require('./voice-service.js');
const voiceProtocol = require('./voice-protocol.js');
const { microphonePermission } = require('./voice-permissions.js');
const { acquireSingleInstance, recordRuntimeEvent } = require('./app-lifecycle.js');
const voiceSessions = new Map();

/* Data file: next to the .exe when running the portable build (easy backup),
   otherwise inside the user's app-data folder. */
const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData');
const dataDir = path.join(baseDir, 'PrintShopData');
const dataFile = path.join(dataDir, 'data.json');
const backupsDir = path.join(dataDir, 'backups');

/* ---------- بند الف: دو حالت اجرا ----------
   local: همان تک‌کامپیوتریِ امروز — بانک در همین کامپیوتر باز می‌شود.
   network: این ماشین فقط ایستگاه است؛ بانک را اصلاً باز نمی‌کند و هر درخواست کاری را به
   سرور می‌فرستد. تنها یک پروسه (سرور) نویسندهٔ SQLite است، پس قفل بین دو برنامه معنا ندارد. */
const { CHANNELS, invoke } = require('./channels.js');
const { resolveClientMode } = require('./client-config.js');
const { createServerClient, TRANSPORT_CODES } = require('./server-client.js');
const { parseArgs: parseServerArgs, createShopServer, stationSetup, lanAddresses } = require('./shop-server.js');
const { loadOrCreateKey } = require('./lan-crypto.js');
const clientMode = resolveClientMode({ env: process.env, baseDir });
const networkMode = clientMode.mode === 'network';
const serverMode = process.argv.includes('--server');
const backupMode = process.argv.includes('--backup');
let serverClient = null;
let serverProbe = null;
let shopServer = null;
let serving = null;
if (networkMode) {
  try { serverClient = createServerClient({ url: clientMode.url, key: clientMode.key }); }
  catch (err) { clientMode.error = String((err && err.message) || err); }
}
/* اگر ایستگاه شبکه را خواسته ولی نشانی سرور خراب است، هیچ درخواستی به بانک محلی نمی‌رود. */
const configFailure = () => ({ ok: false, code: 'CONFIGURATION_FAILED', error: clientMode.error || 'تنظیمات سرور کامل نیست.' });
const backendDown = () => ({ ok: false, code: 'BACKEND_UNAVAILABLE', error: 'پایگاه داده فعال نیست؛ ورود و تغییر اطلاعات متوقف شده است.' });
const backendCtx = { backupDir: backupsDir };

// خطای SQLite نباید مجوز دسترسی بدون احراز هویت به فایل JSON ایجاد کند.
let backend = null; let backendError = '';
const rendererFile = path.resolve(__dirname, '..', 'dist', 'index.html');
function trustedSender(e) {
  try {
    const owner = BrowserWindow.fromWebContents(e.sender);
    return !!owner && e.senderFrame === e.sender.mainFrame
      && path.resolve(fileURLToPath(e.senderFrame.url)) === rendererFile;
  } catch (_) { return false; }
}
const deniedSender = () => ({ ok: false, code: 'FORBIDDEN', error: 'این درخواست از صفحهٔ برنامه ارسال نشده است.' });

/* بستن پنجره فقط پس از تأیید صفحه انجام می‌شود: اول منوی باز بسته می‌شود،
   بعد دیالوگ تأیید خروج، و تازه بعد از آن پنجره واقعاً بسته می‌شود. */
const { createCloseController } = require('./window-close.js');
const closeController = createCloseController({ dialog });
const VOICE_ENABLED = false;

/* ---- صوت آفلاین: مدل فقط در فرایند جانبی بارگذاری می‌شود و مسیرش کنار بسته یا پوشهٔ توسعه است ---- */
function unpackedPath(file) {
  return file.includes(`${path.sep}app.asar${path.sep}`)
    ? file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`) : file;
}
const voiceEngineDir = voiceProtocol.resolveEngineDir({
  env: process.env,
  candidates: [path.join(baseDir, 'voice-asr'), path.resolve(__dirname, '..', '..', 'tools', 'voice-asr')],
}).dir;
const voice = VOICE_ENABLED ? createVoiceService({
  fork: (file, args, options) => utilityProcess.fork(file, args, options),
  workerFile: unpackedPath(path.join(__dirname, 'voice-engine.js')),
  engineDir: voiceEngineDir,
  model: process.env.PRINTSHOP_ASR_MODEL || voiceProtocol.DEFAULT_MODEL,
  log: message => console.log(message),
}) : { dispose() {} };
/* صوت هیچ داده‌ای نمی‌نویسد و فرمان اجرایی نیست؛ فقط متن برمی‌گرداند، پس هر نقش واردشده می‌تواند از آن استفاده کند. */
const voiceGate = (token) => {
  if (!VOICE_ENABLED) return { ok: false, code: 'FEATURE_DISABLED', error: 'تبدیل گفتار در این نسخه غیرفعال است.' };
  const auth = backend && backend.currentUser(token);
  return auth && auth.ok ? null : { ok: false, code: 'FORBIDDEN', error: 'برای استفاده از صوت باید وارد برنامه شوید.' };
};
const voiceChannel = (fn) => (e, token, ...a) => {
  if (!trustedSender(e)) return deniedSender();
  const denied = voiceGate(token);
  if (denied) return denied;
  voiceSessions.set(e.sender.id, token);
  try { return fn(...a); }
  catch (err) { return { ok: false, code: 'REQUEST_FAILED', error: String((err && err.message) || err) }; }
};
ipcMain.handle('voice:status', (e, token) => voiceChannel(() => voice.status())(e, token));
ipcMain.handle('voice:transcribe', (e, token, payload) => voiceChannel(payload2 => voice.transcribe(payload2))(e, token, payload));
ipcMain.handle('voice:cancel', (e, token, payload) => voiceChannel(payload2 => voice.cancel(payload2))(e, token, payload));

function startBackend() {
  /* در حالت شبکه این کامپیوتر بانک را اصلاً باز نمی‌کند: تنها نویسندهٔ SQLite سرور است. */
  if (networkMode) return;
  try { backend = createBackend({ dataDir, legacyJsonFile: dataFile }); scheduleBackup(); } catch (e) { backend = null; backendError = String((e && e.message) || e); }
}
function scheduleBackup() {
  /* نتیجه (موفق یا خطا) در خودِ پایگاه ثبت می‌شود، پس اینجا خطا نباید بی‌صدا بماند؛ تنها حالتِ ممکن
     برای throw، خاموش شدن پایگاه است که آن هم از مسیر be:status دیده می‌شود. */
  const run = () => { if (backend) backend.backup(path.join(dataDir, 'backups')); };
  run(); setInterval(run, 6 * 3600 * 1000).unref();
}

/* ---- بند ث: سرور در همان EXE ----
   فرمان: «سامانه چاپ و نشر.exe» --server [--allow-lan] [--host=0.0.0.0] [--port=8443]
   پرچم‌های پس از --server به shop-server داده می‌شوند و مسیر بانک همیشه همین پوشهٔ این برنامه است،
   تا سرور هرگز به بانک دیگری اشاره نکند. */
function serverArgv(argv = process.argv) {
  const at = argv.indexOf('--server');
  const rest = (at >= 0 ? argv.slice(at + 1) : argv.slice(1)).filter(a => a !== '--backup');
  return ['--data=' + dataDir, ...rest];
}
const serverLogFile = path.join(dataDir, 'logs', 'server.log');
function serverLog(channel, outcome, ms) {
  try {
    fs.mkdirSync(path.dirname(serverLogFile), { recursive: true });
    if (fs.existsSync(serverLogFile) && fs.statSync(serverLogFile).size > 2 * 1024 * 1024) {
      fs.renameSync(serverLogFile, path.join(path.dirname(serverLogFile), `server-${Date.now()}.log`));
    }
    fs.appendFileSync(serverLogFile, JSON.stringify({ at: new Date().toISOString(), channel, outcome, ms }) + '\n');
  } catch (_) { /* گزارش نباید سرور را بخواباند */ }
}
async function startServing() {
  const cfg = parseServerArgs(serverArgv());
  if (!backend) throw new Error(backendError || 'پایگاه داده باز نشد، پس سرور نمی‌تواند پاسخ دهد.');
  const keyInfo = loadOrCreateKey(cfg.keyFile);
  const addresses = lanAddresses();
  const server = createShopServer({
    backend, backupDir: backupsDir, key: keyInfo.key, maxBodyBytes: cfg.maxBodyBytes,
    port: cfg.port, loopbackOnly: cfg.loopback, log: serverLog,
  });
  await new Promise((resolve, reject) => {
    const failed = (err) => reject(err);
    server.once('error', failed);
    server.listen(cfg.port, cfg.host, () => { server.removeListener('error', failed); resolve(); });
  });
  const files = cfg.loopback ? [] : stationSetup({ dataDir, port: cfg.port, key: keyInfo.key.toString('base64'), addresses });
  /* نشانی نمایشی: روی حلقهٔ محلی همان 127.0.0.1، روی شبکه همان IP کارت شبکه (0.0.0.0 نشانیِ شنود است نه نشانیِ اتصال). */
  const url = 'http://' + (cfg.loopback ? '127.0.0.1' : (addresses[0] || cfg.host)) + ':' + cfg.port;
  serving = { url, port: cfg.port, host: cfg.host, loopback: cfg.loopback, addresses, keyFile: cfg.keyFile, keyCreated: keyInfo.created, files };
  shopServer = server;
  serverLog('server', 'listening', 0);
  return serving;
}
const stopServing = () => {
  if (!shopServer) return;
  try { shopServer.close(); } catch (_) { /* خاموش‌شدن برنامه اولویت دارد */ }
  shopServer = null; serving = null;
};

/* پشتیبان دستی: «سامانه چاپ و نشر.exe» --backup — پنجره باز نمی‌شود و نتیجه در یک پیام دیده می‌شود. */
async function runBackupAndQuit() {
  let text; let failed = false;
  if (networkMode) {
    failed = true;
    text = 'این کامپیوتر ایستگاه است و بانکی برای پشتیبان‌گیری ندارد. پشتیبان را روی کامپیوتر سرور بگیرید.';
  } else {
    try {
      if (!backend) throw new Error(backendError || 'پایگاه داده باز نشد.');
      const record = backend.backup(backupsDir, { manual: true });
      failed = !record.ok;
      text = record.ok ? 'پشتیبان ساخته شد:\n' + record.path : 'پشتیبان ساخته نشد:\n' + (record.error || 'خطای نامشخص');
    } catch (err) { failed = true; text = 'پشتیبان ساخته نشد:\n' + String((err && err.message) || err); }
  }
  if (failed) dialog.showErrorBox('پشتیبان‌گیری', text);
  else dialog.showMessageBoxSync({ type: 'info', title: 'پشتیبان‌گیری', message: text, buttons: ['باشه'] });
  app.quit();
}

/* ---- حالت امن (نشست با توکنی که فقط preload نگه می‌دارد) ---- */
ipcMain.on('be:status', (e) => {
  if (!trustedSender(e)) { e.returnValue = { secure: false, error: 'دسترسی مجاز نیست.' }; return; }
  const probeError = serverProbe ? serverProbe.error : '';
  e.returnValue = {
    secure: networkMode ? !!(serverClient && serverProbe && serverProbe.ok) : !!backend,
    mode: networkMode ? 'network' : 'local',
    server: networkMode ? (serverClient ? serverClient.url : clientMode.url) : '',
    error: networkMode ? (clientMode.error || (serverClient && serverProbe && serverProbe.ok ? '' : probeError || 'سرور پاسخ نداد.')) : backendError,
    /* بند ث: «این ماشین خودش سرور است» نشانهٔ جداگانه‌ای دارد؛ ایستگاه بودن با سرور بودن یکی نیست. */
    serving: serving ? { url: serving.url, port: serving.port, loopback: serving.loopback, addresses: serving.addresses } : null,
  };
});

/* هر درخواست کاری از همین یک جدول می‌گذرد: در حالت محلی موتور را صدا می‌زند و در حالت شبکه
   همان درخواست را به سرور می‌فرستد. دروازهٔ نقش‌ها در هر دو حالت داخل backend.js می‌ماند و هیچ‌جا شل نمی‌شود.
   کانال‌هایی که auth ندارند (info و login) توکن نمی‌برند؛ بقیه توکن به‌عنوان نخستین آرگومان می‌گیرند. */
async function runChannel(name, token, args) {
  if (networkMode) {
    if (!serverClient) return configFailure();
    const result = await serverClient.call(name, token, args);
    /* نشانهٔ اتصال باید با واقعیت به‌روز بماند: اگر سرور وسط کار خاموش شود، بارگذاری بعدی
       صفحه همان پیام را نشان می‌دهد و نه «وصل هستم» که در آغاز درست بوده است. */
    if (result && result.ok === false && TRANSPORT_CODES.includes(result.code)) serverProbe = { ok: false, error: result.error };
    else if (!serverProbe || serverProbe.ok !== true) serverProbe = { ok: true };
    return result;
  }
  if (!backend) return backendDown();
  return invoke(name, backend, backendCtx, token, args);
}
const guard = (fn) => async (e, ...a) => {
  if (!trustedSender(e)) return deniedSender();
  try { return await fn(...a); }
  catch (err) { return { ok: false, code: 'REQUEST_FAILED', error: String((err && err.message) || err) }; }
};
for (const name of Object.keys(CHANNELS)) {
  if (name === 'be:whoami') continue; // فقط برای دروازه‌های داخلی خودِ همین فرایند؛ صفحه آن را صدا نمی‌زند
  const session = CHANNELS[name].auth !== false;
  ipcMain.handle(name, guard((...a) => runChannel(name, session ? a[0] : '', session ? a.slice(1) : a)));
}

/* نشانی کاربرِ نشست برای دروازه‌های محلی (خروجی فایل و PDF). همان مسیر کانال‌ها،
   پس در هر دو حالت و با همان به‌روزرسانی نشانهٔ اتصال کار می‌کند. */
function sessionUser(token) {
  return runChannel('be:whoami', token, []);
}

// کانال‌های قدیمی هم صریحاً بسته‌اند؛ JSON قدیمی فقط ورودی مهاجرت SQLite است.
for (const channel of ['db:get', 'db:set', 'db:del']) {
  ipcMain.handle(channel, () => ({ ok: false, code: 'LEGACY_DISABLED', error: 'ذخیره‌سازی بدون احراز هویت غیرفعال است.' }));
}
ipcMain.handle('db:path', (e) => {
  if (!trustedSender(e)) return null;
  if (networkMode) return serverClient ? serverClient.url : clientMode.url; // در حالت شبکه فایل بانک روی کامپیوتر سرور است، نه اینجا
  return backend ? backend.dbFile : dataFile;
});
// نسخهٔ آزمایشی داخلی آفلاین است؛ متن سفارش نباید به سرویس اینترنتی ارسال شود.
ipcMain.handle('ai:complete', guard(() => !networkMode && !backend
  ? backendDown() // اگر بانک این ماشین خراب است، همان خطا اول گفته می‌شود (قرارداد قبلی صفحه)
  : { ok: false, code: 'OFFLINE_ONLY', error: 'این نسخه آفلاین است؛ تحلیل محلی استفاده می‌شود.' }));
ipcMain.handle('file:save', async (e, token, name, b64) => {
  if (!trustedSender(e)) return deniedSender();
  const auth = await sessionUser(token);
  if (!auth || !auth.ok || auth.user.role === 'مشتری') return { ok: false, code: 'FORBIDDEN', error: 'برای خروجی فایل باید با حساب مجاز وارد شوید.' };
  if (typeof name !== 'string' || typeof b64 !== 'string' || b64.length > 64 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    return { ok: false, code: 'VALIDATION_FAILED', error: 'فایل خروجی معتبر نیست یا بیش از اندازه بزرگ است.' };
  }
  const w = BrowserWindow.fromWebContents(e.sender);
  const safeName = path.basename(name).replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/\.xlsx$/i, '').slice(0, 150) + '.xlsx';
  const r = await dialog.showSaveDialog(w, { defaultPath: path.join(app.getPath('documents'), safeName), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, Buffer.from(b64, 'base64'));
  shell.showItemInFolder(r.filePath);
  return { ok: true, path: r.filePath };
});
/* خروجی PDF از همان صفحاتِ صفحه‌بندی‌شده می‌آید و هیچ تنظیمی به پنجرهٔ چاپ واگذار نمی‌شود:
   اندازه فقط A4 یا A5، جهت عمودی یا افقی، حاشیه صفر (حاشیهٔ داخل صفحه است)، بدون سرصفحه/پاصفحه و بدون گرافیک پس‌زمینه. */
ipcMain.handle('pdf:save', async (e, token, paper, name, orientation = 'portrait') => {
  if (!trustedSender(e)) return deniedSender();
  const auth = await sessionUser(token);
  if (!auth || !auth.ok || auth.user?.role === 'مشتری') return { ok: false, code: 'FORBIDDEN', error: 'برای خروجی PDF باید با حساب مجاز وارد شوید.' };
  if (!['A4', 'A5'].includes(paper) || !['portrait', 'landscape'].includes(orientation)) return { ok: false, code: 'VALIDATION_FAILED', error: 'اندازه یا جهت کاغذ معتبر نیست.' };
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.isDestroyed()) return { ok: false, code: 'PRINT_FAILED', error: 'پنجرهٔ چاپ در دسترس نیست.' };
  const chosen = await dialog.showSaveDialog(w, {
    defaultPath: path.join(app.getPath('documents'), safePdfName(name)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (chosen.canceled || !chosen.filePath) return { ok: false, canceled: true };
  let bytes;
  try { bytes = await w.webContents.printToPDF(pdfPrintOptions(paper, orientation)); }
  catch (err) { return { ok: false, code: 'PRINT_FAILED', error: `PDF ساخته نشد: ${String((err && err.message) || err)}` }; }
  if (!bytes || !bytes.length) return { ok: false, code: 'PRINT_FAILED', error: 'خروجی PDF خالی است.' };
  try { fs.writeFileSync(chosen.filePath, bytes); }
  catch (err) { return { ok: false, code: 'WRITE_FAILED', error: `فایل نوشته نشد: ${String((err && err.message) || err)}` }; }
  shell.showItemInFolder(chosen.filePath);
  return { ok: true, path: chosen.filePath, paper, orientation, sizeMm: paperMm(paper, orientation) };
});
ipcMain.on('win:refocus', (e) => {
  if (!trustedSender(e)) return;
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) { w.blur(); w.focus(); w.webContents.focus(); }
});
ipcMain.handle('win:close-response', (e, id, confirmed) => trustedSender(e) ? closeController.respond(e.sender, id, confirmed) : deniedSender());
ipcMain.on('win:close-ack', (e, id) => { if (trustedSender(e)) closeController.acknowledge(e.sender, id); });

function createWindow() {
  const win = new BrowserWindow({
    show: process.env.PRINTSHOP_UI_QA !== '1',
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#FBF6EC',
    icon: path.join(__dirname, 'icon.png'),
    title: 'سامانه چاپ و نشر',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      offscreen: process.env.PRINTSHOP_UI_QA === '1',
    },
  });
  Menu.setApplicationMenu(null);
  if (process.env.PRINTSHOP_UI_QA !== '1') win.maximize();
  closeController.attach(win);
  win.webContents.on('render-process-gone', (_event, details) => recordRuntimeEvent(dataDir, 'renderer-exit', details));
  win.webContents.on('will-navigate', (e, destination) => {
    // Logout/reset reloads the same local entry point to discard old state.
    // Every other destination, including another local file, stays blocked.
    try {
      const url = new URL(destination);
      if (url.protocol === 'file:' && !url.search && !url.hash && path.resolve(fileURLToPath(url)) === rendererFile) return;
    } catch (_) { /* malformed destination stays blocked */ }
    e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  /* میکروفون فقط برای فریم اصلیِ همین صفحهٔ برنامه باز می‌شود؛ بقیهٔ درخواست‌ها رد می‌مانند. */
  const mayUseMicrophone = (wc, permission, details) => microphonePermission(wc, permission, details, rendererFile,
    !!wc && voiceSessions.has(wc.id) && !voiceGate(voiceSessions.get(wc.id)));
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => callback(mayUseMicrophone(wc, permission, details)));
  win.webContents.session.setPermissionCheckHandler((wc, permission, origin, details) => mayUseMicrophone(wc, permission, details));
  const voiceWindowId = win.webContents.id;
  win.webContents.once('destroyed', () => voiceSessions.delete(voiceWindowId));
  win.webContents.setWindowOpenHandler(({ url }) => {
    try { if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url); } catch (_) { /* invalid URL */ }
    return { action: 'deny' };
  });
  win.loadFile(rendererFile);
}

/* در آزمون واقعیِ رابط، دستگاه ساختگیِ کرومی جای میکروفون را می‌گیرد؛ فقط با متغیر محیطی و برای آزمون.
   این کلید در اجرای عادی برنامه ست نمی‌شود و هیچ داده‌ای را از بیرون نمی‌آورد. */
if (process.env.PRINTSHOP_VOICE_FAKE_MIC === '1') {
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
}

/* پشتیبان دستی پیش از قفل تک‌نمونه بررسی می‌شود: اگر برنامه باز باشد، دو پروسه نباید هم‌زمان
   بانک را باز کنند؛ پیام راهنما داده می‌شود و برنامه بسته می‌شود. */
if (backupMode) {
  if (typeof app.requestSingleInstanceLock !== 'function' || app.requestSingleInstanceLock()) {
    app.whenReady().then(() => { startBackend(); return runBackupAndQuit(); });
  } else {
    app.whenReady().then(() => {
      dialog.showErrorBox('پشتیبان‌گیری', 'برنامه باز است و بانک در حال استفاده است.\nبرای پشتیبان‌گیری دستی، اول برنامه را ببندید و بعد میانبر «پشتیبان‌گیری» را اجرا کنید.\nنسخهٔ خودکار روزانه هم در پوشهٔ PrintShopData\\backups ساخته می‌شود.');
      app.quit();
    });
  }
} else if (acquireSingleInstance(app, BrowserWindow)) app.whenReady().then(async () => {
  /* سرور و ایستگاه در یک کامپیوتر جمع نمی‌شوند: اگر client.json این ماشین را ایستگاه می‌داند،
     اجرای --server دو نویسنده روی دو بانک می‌سازد و دقیقاً همان چیزی است که بند الف منع کرد. */
  if (serverMode && networkMode) {
    dialog.showErrorBox('تنظیم ناسازگار', 'این کامپیوتر در client.json به‌عنوان ایستگاه تنظیم شده است.\nاگر می‌خواهید همین کامپیوتر سرور باشد، فایل PrintShopData\\client.json را پاک کنید و دوباره اجرا کنید.');
    app.quit(); return;
  }
  /* در حالت شبکه اول سرور سنجیده می‌شود و بعد پنجره باز می‌شود، تا صفحه از همان ابتدا بداند
     به سرور وصل است یا نه؛ هرگز با بانک خالیِ محلی شروع نمی‌کند. */
  if (serverClient) serverProbe = await serverClient.ping();
  startBackend();
  if (serverMode) {
    /* اگر سرور بالا نیاید پنجرهٔ کاری باز نمی‌شود: کار روی بانکی که کسی به آن وصل نیست،
       کاربر را به اشتباه می‌اندازد که ایستگاه‌ها هم وصل‌اند. */
    try { await startServing(); }
    catch (err) {
      dialog.showErrorBox('سرور چاپخانه شروع نشد', String((err && err.message) || err));
      app.quit(); return;
    }
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('child-process-gone', (_event, details) => recordRuntimeEvent(dataDir, 'child-exit', details));
app.on('window-all-closed', () => { stopServing(); app.quit(); });
app.on('before-quit', () => { voice.dispose(); stopServing(); });
