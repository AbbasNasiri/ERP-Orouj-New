const { test } = require('node:test');
const assert = require('node:assert');
const { pdfPrintOptions, safePdfName, paperMm } = require('../electron/pdf-export.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MM_TO_INCH = 25.4;

test('legacy paper requests remain A4/A5 portrait by default', () => {
  assert.deepStrictEqual(paperMm('A4'), [210, 297]);
  assert.deepStrictEqual(paperMm('A5'), [148, 210]);
  assert.deepStrictEqual(paperMm('A3'), [210, 297], 'a requested larger paper must never grow the sheet');
  assert.deepStrictEqual(paperMm(undefined), [210, 297]);
});

test('PDF options carry no extra space and no background graphics', () => {
  const o = pdfPrintOptions('A4');
  assert.strictEqual(o.printBackground, false, 'background colours must not reach the PDF');
  assert.strictEqual(o.headerFooter, false, 'browser header/footer would add the wasted band');
  assert.strictEqual(o.preferCSSPageSize, true, 'the measured page size is the authority');
  assert.strictEqual(o.landscape, false);
  for (const m of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) {
    assert.strictEqual(o[m], 0, `${m} must be zero: every sheet already carries its own 10mm padding`);
  }
});

test('PDF paper size follows the selected sheet in inches', () => {
  const a4 = pdfPrintOptions('A4');
  assert.ok(Math.abs(a4.paperWidth - 210 / MM_TO_INCH) < 1e-9);
  assert.ok(Math.abs(a4.paperHeight - 297 / MM_TO_INCH) < 1e-9);
  const a5 = pdfPrintOptions('A5');
  assert.ok(Math.abs(a5.paperWidth - 148 / MM_TO_INCH) < 1e-9);
  assert.ok(Math.abs(a5.paperHeight - 210 / MM_TO_INCH) < 1e-9);
  assert.ok(a4.paperHeight > a5.paperHeight);
});

test('landscape swaps physical dimensions for A4/A5 without changing paper definitions', () => {
  for (const [paper, expected] of [['A4', [297, 210]], ['A5', [210, 148]]]) {
    assert.deepStrictEqual(paperMm(paper, 'landscape'), expected);
    const options = pdfPrintOptions(paper, 'landscape');
    assert.strictEqual(options.landscape, true);
    assert.strictEqual(options.pageSize, paper, 'Electron receives a supported named base size');
    assert.strictEqual(options.paperWidth, expected[0] / MM_TO_INCH);
    assert.strictEqual(options.paperHeight, expected[1] / MM_TO_INCH);
    assert.deepStrictEqual(options.margins, { top: 0, bottom: 0, left: 0, right: 0 });
    assert.strictEqual(options.displayHeaderFooter, false);
  }
  const altered = paperMm('A4'); altered[0] = 999;
  assert.deepStrictEqual(paperMm('A4'), [210, 297], 'a caller cannot mutate future dimensions');
  for (const invalid of ['rotated', '', null, true]) {
    assert.throws(() => pdfPrintOptions('A4', invalid), /orientation/);
  }
});

test('real PDF IPC handler validates direction before opening a dialog and keeps old calls portrait', async () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../electron/main.js'), 'utf8');
  const source = main.slice(main.indexOf("ipcMain.handle('pdf:save'"), main.indexOf("ipcMain.on('win:refocus'"));
  const calls = { dialogs: 0, options: [], writes: [] }; let handler;
  const win = { isDestroyed: () => false, webContents: { printToPDF: async options => { calls.options.push(options); return Buffer.from('pdf'); } } };
  vm.runInNewContext(source, {
    ipcMain: { handle: (_channel, callback) => { handler = callback; } }, trustedSender: () => true,
    deniedSender: () => ({ ok: false }),
    sessionUser: token => Promise.resolve(token === 'private' ? { ok: true, user: { role: 'مدیر' } } : { ok: false, code: 'UNAUTHENTICATED' }),
    BrowserWindow: { fromWebContents: () => win }, dialog: { showSaveDialog: async () => { calls.dialogs++; return { filePath: 'fixture.pdf' }; } },
    app: { getPath: () => '.' }, path, safePdfName, pdfPrintOptions, paperMm,
    fs: { writeFileSync: (...args) => calls.writes.push(args) }, shell: { showItemInFolder() {} },
  });
  for (const [paper, orientation] of [['A4', 'sideways'], ['A3', 'landscape'], ['A5', null]]) {
    const result = await handler({ sender: {} }, 'private', paper, 'invoice', orientation);
    assert.strictEqual(result.code, 'VALIDATION_FAILED');
  }
  assert.strictEqual(calls.dialogs, 0, 'invalid geometry must not trigger a save dialog');
  const landscape = await handler({ sender: {} }, 'private', 'A4', 'invoice', 'landscape');
  assert.strictEqual(landscape.ok, true);
  assert.strictEqual(landscape.orientation, 'landscape');
  assert.deepStrictEqual(landscape.sizeMm, [297, 210]);
  assert.strictEqual(calls.options[0].landscape, true);
  const legacy = await handler({ sender: {} }, 'private', 'A5', 'letter');
  assert.strictEqual(legacy.orientation, 'portrait');
  assert.deepStrictEqual(legacy.sizeMm, [148, 210]);
  assert.strictEqual(calls.options[1].landscape, false);
  assert.strictEqual(calls.writes.length, 2);
});

test('preload forwards an explicit orientation while legacy callers default to portrait', async () => {
  let api; const calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../electron/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { if (name === 'printshopApi') api = value; } },
      ipcRenderer: { sendSync: () => ({ secure: true }), invoke: async (...args) => { calls.push(args); return { ok: true }; } } }),
  });
  await api.savePdf('A4', 'invoice', 'landscape');
  await api.savePdf('A5', 'letter');
  assert.deepStrictEqual(calls, [['pdf:save', null, 'A4', 'invoice', 'landscape'], ['pdf:save', null, 'A5', 'letter', 'portrait']]);
});

test('file names stay single-extension, path-free and printable', () => {
  assert.strictEqual(safePdfName('پیش‌فاکتور-۱۲'), 'پیش‌فاکتور-۱۲.pdf');
  assert.strictEqual(safePdfName('a.pdf.pdf'), 'a.pdf');
  assert.strictEqual(safePdfName('../../etc/passwd'), '.._.._etc_passwd.pdf');
  assert.strictEqual(safePdfName('order:1?"x'), 'order_1__x.pdf');
  assert.strictEqual(safePdfName(''), 'برگه.pdf');
  assert.strictEqual(safePdfName(null), 'برگه.pdf');
  assert.strictEqual(safePdfName('x'.repeat(400)).length, 154);
});
