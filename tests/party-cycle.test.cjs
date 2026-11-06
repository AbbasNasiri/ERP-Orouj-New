'use strict';
/* بند ۱/۳: یک نقطهٔ انحصاری برای «قابل استفاده در کار» — فهرست‌های کاری و پیکرها همین تابع‌ها را
   صدا می‌زنند؛ بانک خام دست‌نخورده می‌ماند و هیچ دروازهٔ سمت سرور شل نمی‌شود. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.work', 'party-cycle-tests');
fs.mkdirSync(fixtureDir, { recursive: true });
const fixture = path.join(fixtureDir, 'party-cycle.cjs');
fs.writeFileSync(fixture, esbuild.buildSync({
  entryPoints: [path.join(root, 'src', 'party-cycle.js')], bundle: true,
  write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text);
const { hiddenCount, partyActive, partyCode, partyReview, pickable, protectedParty, usableParty, workList } = require(fixture);

const customer = (o = {}) => ({ id: 'c1', name: 'مشتری', customerCode: '', eligibility: { status: 'pending' }, ...o });
const supplier = (o = {}) => ({ id: 's1', name: 'تامین‌کننده', supplierCode: '', eligibility: { status: 'pending' }, ...o });

test('the working list is only approved and active records', () => {
  const bank = [
    customer({ id: 'ok', eligibility: { status: 'approved' } }),
    customer({ id: 'pending' }),
    customer({ id: 'rejected', eligibility: { status: 'rejected' } }),
    customer({ id: 'inactive', eligibility: { status: 'approved' }, active: false }),
    customer({ id: 'legacyActive', eligibility: { status: 'approved' }, active: true }),
  ];
  assert.deepEqual(workList(bank).map(c => c.id), ['ok', 'legacyActive']);
  assert.equal(hiddenCount(bank), 3, 'تأییدنشده، ردشده و غیرفعال از کار بیرون‌اند');
  assert.equal(usableParty(bank[0]), true);
  assert.equal(partyActive(customer()), true, 'رکورد بی‌«active» فعال شمرده می‌شود');
  assert.equal(partyReview(customer({ eligibility: undefined })), 'pending', 'رکورد بدون صلاحیت، در انتظار است');
  assert.equal(partyReview(customer({ eligibility: { status: 'bogus' } })), 'pending', 'وضعیت ناشناخته، تأیید شده نیست');
});

test('pickers keep the record already chosen on an old document so editing cannot silently change it', () => {
  const approved = customer({ id: 'ok', eligibility: { status: 'approved' } });
  const frozen = customer({ id: 'old', eligibility: { status: 'rejected' }, active: false });
  const bank = [approved, frozen];
  assert.deepEqual(pickable(bank, '').map(c => c.id), ['ok'], 'بدون انتخاب، فقط فهرست کاری');
  assert.deepEqual(pickable(bank, 'old').map(c => c.id), ['ok', 'old'], 'رکورد انتخاب‌شدهٔ قبلی حفظ می‌شود');
  assert.deepEqual(pickable(bank, 'ok').map(c => c.id), ['ok'], 'انتخابِ فهرست کاری دوباره نمی‌شود');
  assert.deepEqual(pickable(undefined, 'x').map(c => c.id), [], 'بانک خالی، پیکر را نمی‌شکند');
  assert.deepEqual(pickable([approved], 'missing').map(c => c.id), ['ok'], 'انتخاب ناموجود جعل نمی‌شود');
});

test('the code field follows the party kind and legacy supplier columns stay readable', () => {
  assert.equal(partyCode(customer({ customerCode: 'C-000007' }), 'customer'), 'C-000007');
  assert.equal(partyCode(supplier({ supplierCode: 'S-000007' }), 'supplier'), 'S-000007');
  assert.equal(partyCode(supplier({ supplierCode: 'S-000007' }), 'customer'), '', 'کد تامین‌کننده، کد مشتری نیست');
  assert.equal(partyCode(supplier({ code: 'OLD-1' }), 'supplier'), '', 'ستون قدیمی «code» جانشین کد یکتا نمی‌شود');
});

test('protected records are the ones the server will not let a generic write remove', () => {
  assert.equal(protectedParty(customer()), false, 'رکورد تازهٔ بی‌کد و تأییدنشده محفظ نیست');
  const cases = [
    ['customer', customer({ customerCode: 'C-000001' })],
    ['customer', customer({ eligibility: { status: 'approved' } })],
    ['customer', customer({ eligibility: { status: 'rejected' } })],
    ['supplier', supplier({ supplierCode: 'S-000001' })],
    ['supplier', supplier({ eligibility: { status: 'approved' } })],
  ];
  for (const [kind, party] of cases) assert.equal(protectedParty(party, kind), true, `${kind} دارای کد یا تصمیم، محفظ است`);
});

test('every list gate is a pure read: the bank array itself is never rewritten', () => {
  const bank = [customer({ id: 'a' }), customer({ id: 'b', eligibility: { status: 'approved' } })];
  const snapshot = JSON.stringify(bank);
  workList(bank); pickable(bank, 'a'); hiddenCount(bank); bank.filter(usableParty);
  assert.equal(JSON.stringify(bank), snapshot, 'هیچ رکوردی از بانک پاک یا تغییر نمی‌کند');
});
