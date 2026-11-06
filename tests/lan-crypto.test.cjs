'use strict';
/* بند ث: پاکت رمزشدهٔ ایستگاه‌ها.
   این آزمون خودِ رمزنگاری را می‌سنجد، بی‌سرور و بی‌شبکه: هر تغییری در بایت‌ها باید
   باز شدن را رد کند و هیچ نامی از کانال یا توکن نباید بیرونِ بسته دیده شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeKey, parseKey, sealRequest, openRequest, sealResponse, openResponse, createReplayGuard, MAX_SKEW_MS } = require('../electron/lan-crypto');

const key = parseKey(makeKey());
const other = parseKey(makeKey());
const token = '7f3a9c1b5d8e2f406a8b1c3d5e7f90123456789abcde';

test('a request survives the round trip with its channel, session and arguments', () => {
  const envelope = sealRequest(key, { channel: 'be:set', token, args: ['orders', [{ id: 'o1' }]] });
  const opened = openRequest(key, envelope);
  assert.equal(opened.ch, 'be:set');
  assert.equal(opened.tok, token);
  assert.deepEqual(opened.args, ['orders', [{ id: 'o1' }]]);
  assert.ok(Buffer.isBuffer(opened.nonce));
});

test('the channel and the session token never appear in the packet', () => {
  const envelope = sealRequest(key, { channel: 'be:set', token, args: ['orders'] });
  const wire = JSON.stringify(envelope);
  assert.equal(wire.includes('be:set'), false);
  assert.equal(wire.includes(token), false);
  assert.equal(wire.includes('orders'), false);
  assert.deepEqual(Object.keys(envelope).sort(), ['c', 'n', 't', 'v']);
});

test('a packet sealed with another key is refused', () => {
  const envelope = sealRequest(other, { channel: 'be:info', args: [] });
  assert.throws(() => openRequest(key, envelope), (err) => err.code === 'BAD_ENVELOPE');
});

test('any changed byte in the ciphertext or the tag is refused', () => {
  const flip = text => {
    const at = Math.floor(text.length / 2);
    return text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1);
  };
  const envelope = sealRequest(key, { channel: 'be:get', token, args: ['orders'] });
  for (const field of ['c', 't', 'n']) {
    const tampered = { ...envelope, [field]: flip(envelope[field]) };
    assert.throws(() => openRequest(key, tampered), (err) => err.code === 'BAD_ENVELOPE', field);
  }
});

test('a response cannot be replayed as a request and is bound to its own nonce', () => {
  const request = openRequest(key, sealRequest(key, { channel: 'be:info', args: [] }));
  const response = sealResponse(key, request.nonce, { ok: true, value: 42 });
  assert.deepEqual(openResponse(key, response, request.nonce), { ok: true, value: 42 });
  assert.throws(() => openResponse(key, response, Buffer.alloc(12)), (err) => err.code === 'BAD_ENVELOPE');
  assert.throws(() => openRequest(key, response), (err) => err.code === 'BAD_ENVELOPE', 'پاسخ نباید به‌عنوان درخواست باز شود');
});

test('a clock that is off by more than five minutes is refused, a small skew is not', () => {
  const now = Date.now();
  const skew = (ms) => sealRequest(key, { channel: 'be:info', args: [], now: now + ms });
  assert.equal(openRequest(key, skew(MAX_SKEW_MS - 1000), { now }).ch, 'be:info');
  for (const delta of [MAX_SKEW_MS + 1000, -MAX_SKEW_MS - 1000]) {
    assert.throws(() => openRequest(key, skew(delta), { now }), (err) => err.code === 'STALE_REQUEST');
  }
});

test('the same packet is accepted once; a different packet is unaffected', () => {
  let clock = Date.now();
  const guard = createReplayGuard({ now: () => clock });
  const a = sealRequest(key, { channel: 'be:info', args: [] });
  const b = sealRequest(key, { channel: 'be:info', args: [] });
  const id = (envelope) => require('node:crypto').createHash('sha256').update(envelope.n).digest();
  assert.equal(guard.accept(id(a)), true);
  assert.equal(guard.accept(id(a)), false);
  assert.equal(guard.accept(id(b)), true);
  clock += MAX_SKEW_MS + 1000; // بسته‌های کهنه از حافظه دور ریخته می‌شوند
  assert.equal(guard.accept(id(a)), true, 'بستهٔ کهنه پس از پنجره دوباره پذیرفته می‌شود؛ پنجرهٔ زمانی خودش جلوی بازپخش را می‌گیرد');
  assert.equal(guard.size(), 1);
});

test('a key that is not exactly 32 bytes of base64 is refused', () => {
  for (const bad of ['', 'short', 'A'.repeat(43), makeKey().slice(0, 42), makeKey() + 'AAAA']) {
    assert.throws(() => parseKey(bad), /کلید امنیتی شبکه/, JSON.stringify(bad));
  }
  assert.equal(parseKey(makeKey()).length, 32);
});
