'use strict';
/* اصلاحات ۹ بند ۲: مبدل گفتاربه‌متن از رابط حذف شد.
   این فایل دو چیز را می‌سنجد: هیچ سطح صوتی در رندرر باقی نمانده است، و ابزار کمکیِ درجِ متن
   (voice-fields.mjs) که جایگزینِ آینده و ابزار سنجش به آن تکیه می‌کنند، همچنان بی‌خطر است. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');

const DELETED = ['VoiceDock.jsx', 'useDictation.js', 'voice-dock.css'];
const BANNED = ['useDictation', 'VoiceDock', 'FieldVoiceButton', 'DictationButton', 'requestFieldVoice',
  'speech-placeholder', 'voice-field-button', 'voice-dock.css', 'printshopVoice', 'getUserMedia', 'با صدا'];

test('بند ۲: پرونده‌های رابط صوت حذف شده‌اند', () => {
  for (const name of DELETED) {
    assert.equal(fs.existsSync(path.join(src, name)), false, `پروندهٔ رابط صوت «${name}» باید حذف شده باشد`);
  }
});

test('بند ۲: هیچ رندرری صوت را فراخوانی نمی‌کند و میکروفون نمی‌خواهد', () => {
  const offenders = [];
  for (const name of fs.readdirSync(src).filter(entry => /\.(jsx?|mjs|css)$/.test(entry))) {
    const text = fs.readFileSync(path.join(src, name), 'utf8');
    for (const needle of BANNED) if (text.includes(needle)) offenders.push(`${name}: ${needle}`);
  }
  assert.deepEqual(offenders, [], 'نشانهٔ صوت در رندرر باقی مانده است');
});

test('بند ۲: کلیدِ خاموشِ موتور صوت صریح است و درخواست رد می‌شود', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  assert.match(main, /const VOICE_ENABLED = false;/, 'کلید خاموشِ موتور باید صریح بماند');
  assert.match(main, /FEATURE_DISABLED/, 'درخواست تبدیل باید رد شود، نه اینکه بی‌صدا معلق بماند');
});

const compiled = esbuild.buildSync({
  stdin: { contents: "export { isDictatable, insertIntoField } from './voice-fields.mjs';", resolveDir: src, loader: 'js' },
  bundle: true, write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { isDictatable, insertIntoField } = mod.exports;

function field(value = '', extra = {}) {
  const node = { tagName: 'TEXTAREA', isConnected: true, maxLength: -1, value, dispatchEvent() {}, setSelectionRange() {}, ...extra };
  return node;
}

test('بند ۲: ابزار درجِ متن فقط کادرِ نوشتنیِ امن را می‌پذیرد', () => {
  for (const extra of [{ disabled: true }, { readOnly: true }, { isConnected: false }, { tagName: 'INPUT', type: 'password' },
    { tagName: 'INPUT', type: 'number' }, { closest: () => ({}) }, { matches: () => true }]) {
    assert.equal(isDictatable(field('', extra)), false, `هدف ناامن پذیرفته شد: ${JSON.stringify(Object.keys(extra))}`);
  }
  const limited = field('الف', { maxLength: 4 });
  assert.equal(insertIntoField(limited, 'متن'), false);
  assert.equal(limited.value, 'الف');
});
