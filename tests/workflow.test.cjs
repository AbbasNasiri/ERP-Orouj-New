const test = require('node:test');
const assert = require('node:assert/strict');
const { applyOrderAction, MANAGER, FINANCE, STAFF, holdReasons, holdState } = require('../electron/workflow.js');
const now = () => Date.parse('2026-10-22T09:00:00Z');
const manager = { id: 'm', name: 'Manager', role: MANAGER };
const finance = { id: 'f', name: 'Finance', role: FINANCE };
const pending = () => ({ id: 'o1', orderNumber: '1001', customerId: 'c1', status: 'در انتظار تایید', quoteRev: 1, items: [{ id: 'i1', stage: 'لیتوگرافی', materialsDeducted: true }], history: [] });
const act = (order, action, payload, actor = manager, extra = {}) => applyOrderAction(order, action, payload, actor, { now, ...extra });
const confirm = (order) => act(order, 'confirm_customer', { evidence: 'Customer confirmed by phone' }, finance).order;
const release = (order) => act(order, 'release_production', { materialReview: { checked: true, shortages: [] } }).order;

test('a quote requires customer confirmation and only the manager can release it', () => {
  const o = pending();
  assert.throws(() => release(o), /تأیید مشتری/);
  const confirmed = confirm(o);
  assert.equal(confirmed.status, o.status);
  assert.deepEqual(o, pending());
  for (const role of STAFF.filter(r => r !== MANAGER)) {
    assert.throws(() => act(confirmed, 'release_production', { materialReview: { checked: true, shortages: [] } }, { id: role, role }), { code: 'FORBIDDEN' });
  }
  assert.equal(release(confirmed).status, 'تایید شده');
});

test('the customer confirmation is tied to the quote revision', () => {
  const order = confirm(pending());
  assert.throws(() => release({ ...order, quoteRev: 2 }), /نسخهٔ فعلی/);
});

test('بدهی باز با تیک خالی جلو نمی‌رود؛ فقط مجوز مستند اجازهٔ تولید را باز می‌کند', () => {
  const o = confirm(pending());
  const payload = { materialReview: { checked: true, shortages: [{ description: 'Text paper', qty: 105, unit: 'بند', dueDate: '2026-10-24' }] } };
  assert.throws(() => act(o, 'release_production', payload, manager, { hasOpenDebt: true }), /بدهی باز/);
  /* کنترل منفی: تیکِ «اجازهٔ صریح مدیر» به‌تنهایی سند نیست و payload نمی‌تواند مجوز بسازد —
     سند را فقط سرور (options) می‌گذارد. */
  assert.throws(() => act(o, 'release_production', { ...payload, debtApproved: true }, manager, { hasOpenDebt: true }), /مجوز مستند/);
  assert.throws(() => act(o, 'release_production', { ...payload, debtApproved: true, creditReason: 'مشتری تسویه را متعهد شده است' }, manager, { hasOpenDebt: true }), /مجوز مستند/);
  const approval = { id: 'ca-1', reason: 'مشتری تسویهٔ هفتهٔ آینده را کتباً متعهد شده است', openTotal: 5000, overBy: 2000, ceiling: 100000 };
  assert.throws(() => act(o, 'release_production', { ...payload, debtApproved: true }, manager, { hasOpenDebt: true, creditApproval: { reason: 'کوتاه' } }), /مجوز مستند/);
  const result = act(o, 'release_production', { ...payload, debtApproved: true }, manager, { hasOpenDebt: true, creditApproval: approval });
  const doc = result.order.workflow.productionAuthorization.creditApproval;
  assert.equal(result.order.workflow.productionAuthorization.conditional, true);
  assert.deepEqual([doc.id, doc.by, doc.amount, doc.overBy, doc.ceiling], ['ca-1', 'Manager', 5000, 2000, 100000], 'سند می‌گوید چه کسی، چه مبلغی و با چه سقفی مجوز داده');
  assert.equal(doc.at, now(), 'زمان مجوز روی سند ثبت می‌شود');
  assert.equal(doc.reason, approval.reason);
  assert.equal(result.order.workflow.materialReview.shortages[0].responsibleRole, FINANCE);
  assert.ok(result.notifications.some(n => n.audience === 'finance'));
  assert.ok(result.notifications.some(n => n.audience === 'customer'));
  /* اطلاع مالی جملهٔ بی‌رقم است: مبلغ از این مسیر فاش نمی‌شود. */
  const financeNote = result.notifications.find(n => n.audience === 'finance' && n.message.includes('بدهی باز'));
  assert.equal(/[0-9]/.test(financeNote.message), false, 'رقم در اطلاع مالی ننشسته است');
  assert.throws(() => act(o, 'release_production', { materialReview: { checked: true, shortages: [{ description: 'Text paper', qty: 105, unit: 'بند', dueDate: '2026-10-21' }] } }), /مهلت تأمین/);
});

test('every staff role can stop immediately without manager approval; consumption is preserved', () => {
  const o = release(confirm(pending()));
  for (const role of STAFF) {
    const result = act(o, 'stop', { kind: 'pause', reason: 'Customer asked to pause', customerRequest: true }, { id: role, name: role, role });
    assert.equal(result.order.status, 'متوقف');
    assert.deepEqual(result.order.items, o.items);
    assert.ok(result.notifications.some(n => n.audience === 'management'));
    assert.ok(result.notifications.some(n => n.audience === 'partners'));
  }
});

test('only the manager can resume a paused order, and cancellation is not a pause', () => {
  const o = release(confirm(pending()));
  const stopped = act(o, 'stop', { kind: 'pause', reason: 'Customer request', customerRequest: true }, finance).order;
  assert.throws(() => act(stopped, 'resume', { reason: 'Customer approved' }, finance), { code: 'FORBIDDEN' });
  assert.equal(act(stopped, 'resume', { reason: 'Customer approved' }).order.status, o.status);
  const cancelled = act(stopped, 'stop', { kind: 'cancel', reason: 'Customer cancelled', customerRequest: true }, finance).order;
  assert.throws(() => act(cancelled, 'resume', { reason: 'Customer approved' }), /لغوشده/);
});

test('finance can settle cancellation without manager approval and amounts stay out of history', () => {
  const o = act(release(confirm(pending())), 'stop', { kind: 'cancel', reason: 'Customer cancelled', customerRequest: true }, finance).order;
  const payload = { services: 1000, materials: 200, partners: 300, paid: 2000, explanation: 'Verified work and consumed materials' };
  const result = act(o, 'settle_cancellation', payload, finance);
  assert.equal(result.order.workflow.cancellationSettlement.balance, -500);
  assert.deepEqual(result.order.items, o.items);
  assert.ok(result.notifications.some(n => n.audience === 'management'));
  assert.ok(result.notifications.some(n => n.audience === 'customer'));
  assert.ok(!result.order.history.at(-1).text.includes('500'));
  assert.throws(() => act(o, 'settle_cancellation', { ...payload, materials: -1 }, finance));
  assert.throws(() => act(o, 'settle_cancellation', payload, { role: 'انباردار' }), { code: 'FORBIDDEN' });
});

const clerk = { id: 'c', name: 'Clerk', role: 'کارشناس سفارشات' };
const printSupervisor = { id: 'p', name: 'Print supervisor', role: 'سرپرست چاپ' };
const bindSupervisor = { id: 'b', name: 'Binding supervisor', role: 'سرپرست صحافی' };
const releasedAt = (stage = 'ثبت سفارش') => {
  const o = pending();
  o.items[0].stage = stage;
  delete o.items[0].materialsDeducted;
  return release(confirm(o));
};

test('completing a section records the confirmation, advances exactly one stage and cannot be repeated', () => {
  const o = releasedAt();
  const first = act(o, 'complete_stage', { itemId: 'i1', stage: 'ثبت سفارش', note: 'پروف تایید شد' }, clerk);
  assert.equal(first.order.items[0].stage, 'طراحی و پروف');
  assert.equal(first.order.items[0].stageCompletions['ثبت سفارش'].by.role, 'کارشناس سفارشات');
  assert.equal(first.order.items[0].stageCompletions['ثبت سفارش'].nextStage, 'طراحی و پروف');
  assert.equal(first.order.items[0].stageCompletions['ثبت سفارش'].note, 'پروف تایید شد');
  assert.equal(first.order.status, o.status);
  assert.ok(first.notifications.some(n => n.audience === 'staff'));
  assert.throws(() => act(first.order, 'complete_stage', { itemId: 'i1', stage: 'ثبت سفارش' }, clerk), { code: 'STAGE_CONFLICT' });
  assert.equal(first.order.items[0].stage, 'طراحی و پروف');
  const forged = structuredClone(first.order);
  forged.items[0].stage = 'ثبت سفارش';
  assert.throws(() => act(forged, 'complete_stage', { itemId: 'i1', stage: 'ثبت سفارش' }, clerk), /قبلاً به پایان رسیده/);
});

test('each section is finished only by its own role and the page cannot be forged into the workflow', () => {
  const o = releasedAt('چاپ');
  assert.throws(() => act(o, 'complete_stage', { itemId: 'i1', stage: 'چاپ' }, finance), { code: 'FORBIDDEN' });
  assert.throws(() => act(o, 'complete_stage', { itemId: 'i1', stage: 'چاپ' }, clerk), { code: 'FORBIDDEN' });
  const printed = act(o, 'complete_stage', { itemId: 'i1', stage: 'چاپ' }, printSupervisor).order;
  assert.equal(printed.items[0].stage, 'صحافی');
  assert.throws(() => act(printed, 'complete_stage', { itemId: 'i1', stage: 'صحافی' }, printSupervisor), { code: 'FORBIDDEN' });
  assert.equal(act(printed, 'complete_stage', { itemId: 'i1', stage: 'صحافی' }, bindSupervisor).order.items[0].stage, 'خدمات تکمیلی');
  assert.throws(() => act(o, 'complete_stage', {}), /یافت نشد/);
});

test('completion needs a valid production authorization for the current quote revision', () => {
  const unreleased = pending();
  unreleased.items[0].stage = 'ثبت سفارش';
  assert.throws(() => act(unreleased, 'complete_stage', { itemId: 'i1', stage: 'ثبت سفارش' }), /اجازهٔ معتبر/);
  const o = releasedAt();
  assert.throws(() => act({ ...o, quoteRev: 2 }, 'complete_stage', { itemId: 'i1', stage: 'ثبت سفارش' }), /نسخهٔ فعلی/);
});

test('the delivery section closes the order and no further workflow action is accepted', () => {
  const o = releasedAt('تحویل');
  const result = act(o, 'complete_stage', { itemId: 'i1', stage: 'تحویل', note: 'تحویل به مشتری با فاکتور' }, clerk);
  assert.equal(result.order.status, 'تحویل شده');
  assert.equal(result.order.deliveredAt, '2026-10-22');
  assert.equal(result.order.deliveredBy.role, 'کارشناس سفارشات');
  assert.equal(result.order.items[0].stage, 'تحویل');
  assert.ok(result.notifications.some(n => n.audience === 'customer'));
  assert.ok(result.notifications.some(n => n.audience === 'finance'));
  for (const [action, payload] of [['complete_stage', { itemId: 'i1', stage: 'تحویل' }], ['change_stage', { itemId: 'i1', newStage: 'تحویل' }], ['stop', { kind: 'pause', reason: 'Customer request', customerRequest: true }], ['resume', { reason: 'Continue work' }], ['confirm_customer', { evidence: 'Confirmed again' }]]) {
    assert.throws(() => act(result.order, action, payload), { code: 'FORBIDDEN' });
  }
});

test('an order becomes ready for delivery only when every item reaches the delivery section', () => {
  const o = releasedAt('کنترل کیفیت');
  o.items.push({ id: 'i2', stage: 'کنترل کیفیت' });
  const one = act(o, 'complete_stage', { itemId: 'i1', stage: 'کنترل کیفیت' }, bindSupervisor).order;
  assert.equal(one.items[0].stage, 'تحویل');
  assert.notEqual(one.status, 'آماده تحویل');
  const both = act(one, 'complete_stage', { itemId: 'i2', stage: 'کنترل کیفیت' }, bindSupervisor).order;
  assert.equal(both.status, 'آماده تحویل');
  assert.ok(both.history.at(-1).text.includes('کنترل کیفیت'));
  const delivered = act(both, 'complete_stage', { itemId: 'i1', stage: 'تحویل' }, clerk).order;
  assert.notEqual(delivered.status, 'تحویل شده');
  const closed = act(delivered, 'complete_stage', { itemId: 'i2', stage: 'تحویل' }, clerk).order;
  assert.equal(closed.status, 'تحویل شده');
});

test('production release is refused while an item has a calculation error', () => {
  const o = confirm(pending());
  o.items[0].analysis = { ok: false, errors: ['306 صفحه برای قطع وزیری قابل فرم‌بندی نیست'] };
  assert.throws(() => release(o), /خطای محاسبه/);
  o.items[0].analysis = { ok: true, errors: [] };
  assert.equal(release(o).status, 'تایید شده');
});

const digitalSupervisor = { id: 'd', name: 'Digital supervisor', role: 'سرپرست چاپ دیجیتال' };
const lithoSupervisor = { id: 'l', name: 'Litho supervisor', role: 'سرپرست لیتوگرافی' };
const offsetSupervisor = { id: 'o', name: 'Offset supervisor', role: 'سرپرست چاپ' };
const at = (stage, printMethod) => {
  const o = pending();
  o.items[0].stage = stage;
  if (printMethod) o.items[0].spec = { printMethod };
  delete o.items[0].materialsDeducted;
  return release(confirm(o));
};

test('a digital item walks its own path and never reaches the plate section', () => {
  const o = at('طراحی و پروف', 'دیجیتال');
  assert.throws(() => act(o, 'change_stage', { itemId: 'i1', newStage: 'لیتوگرافی و زینک' }, manager), /در مسیر/);
  assert.throws(() => act(o, 'complete_stage', { itemId: 'i1', stage: 'طراحی و پروف' }, lithoSupervisor), { code: 'FORBIDDEN' });
  const printed = act(o, 'complete_stage', { itemId: 'i1', stage: 'طراحی و پروف' }, clerk).order;
  assert.equal(printed.items[0].stage, 'چاپ دیجیتال');
  assert.throws(() => act(printed, 'complete_stage', { itemId: 'i1', stage: 'چاپ دیجیتال' }, offsetSupervisor), { code: 'FORBIDDEN' });
  const cut = act(printed, 'complete_stage', { itemId: 'i1', stage: 'چاپ دیجیتال' }, digitalSupervisor).order;
  assert.equal(cut.items[0].stage, 'برش و تکمیلی');
  const qc = act(cut, 'complete_stage', { itemId: 'i1', stage: 'برش و تکمیلی' }, bindSupervisor).order;
  assert.equal(qc.items[0].stage, 'کنترل کیفیت و تحویل به مشتری');
  assert.equal(qc.status, 'آماده تحویل');
  const closed = act(qc, 'complete_stage', { itemId: 'i1', stage: 'کنترل کیفیت و تحویل به مشتری' }, clerk).order;
  assert.equal(closed.status, 'تحویل شده');
  assert.equal(closed.deliveredAt, '2026-10-22');
});

test('an offset item walks plate, offset print and binding and closes at the same delivery box', () => {
  const o = at('طراحی و پروف');
  assert.throws(() => act(o, 'change_stage', { itemId: 'i1', newStage: 'چاپ دیجیتال' }, manager), /در مسیر/);
  assert.throws(() => act(o, 'complete_stage', { itemId: 'i1', stage: 'طراحی و پروف' }, digitalSupervisor), { code: 'FORBIDDEN' });
  const plated = act(o, 'complete_stage', { itemId: 'i1', stage: 'طراحی و پروف' }, clerk).order;
  assert.equal(plated.items[0].stage, 'لیتوگرافی و زینک');
  const printed = act(plated, 'complete_stage', { itemId: 'i1', stage: 'لیتوگرافی و زینک' }, lithoSupervisor).order;
  assert.equal(printed.items[0].stage, 'چاپ افست');
  assert.throws(() => act(printed, 'complete_stage', { itemId: 'i1', stage: 'چاپ افست' }, digitalSupervisor), { code: 'FORBIDDEN' });
  const bound = act(printed, 'complete_stage', { itemId: 'i1', stage: 'چاپ افست' }, offsetSupervisor).order;
  assert.equal(bound.items[0].stage, 'صحافی و تکمیلی');
  const qc = act(bound, 'complete_stage', { itemId: 'i1', stage: 'صحافی و تکمیلی' }, bindSupervisor).order;
  assert.equal(qc.items[0].stage, 'کنترل کیفیت و تحویل به مشتری');
  assert.equal(qc.status, 'آماده تحویل');
  assert.equal(act(qc, 'complete_stage', { itemId: 'i1', stage: 'کنترل کیفیت و تحویل به مشتری' }, finance).order.status, 'تحویل شده');
});

test('both paths close the order together when one mixed order finishes', () => {
  const o = at('برش و تکمیلی', 'دیجیتال');
  o.items.push({ id: 'i2', stage: 'صحافی و تکمیلی' });
  const digitalDone = act(o, 'complete_stage', { itemId: 'i1', stage: 'برش و تکمیلی' }, bindSupervisor).order;
  assert.notEqual(digitalDone.status, 'آماده تحویل');
  const offsetDone = act(digitalDone, 'complete_stage', { itemId: 'i2', stage: 'صحافی و تکمیلی' }, bindSupervisor).order;
  assert.equal(offsetDone.status, 'آماده تحویل');
  const first = act(offsetDone, 'complete_stage', { itemId: 'i1', stage: 'کنترل کیفیت و تحویل به مشتری' }, clerk).order;
  assert.equal(first.status, 'آماده تحویل');
  assert.equal(act(first, 'complete_stage', { itemId: 'i2', stage: 'کنترل کیفیت و تحویل به مشتری' }, clerk).order.status, 'تحویل شده');
});

test('an item already inside the old nine-stage track keeps walking it until migration', () => {
  const o = at('چاپ');
  const bound = act(o, 'complete_stage', { itemId: 'i1', stage: 'چاپ' }, offsetSupervisor).order;
  assert.equal(bound.items[0].stage, 'صحافی');
  assert.throws(() => act(bound, 'change_stage', { itemId: 'i1', newStage: 'چاپ دیجیتال' }, manager), /در مسیر/);
});

test('the hold box lists each approval leg only while it is genuinely missing', () => {
  const fresh = () => { const o = pending(); o.items[0].stage = 'ثبت سفارش'; return o; };
  const o = fresh();
  assert.deepEqual(holdReasons(o).map(r => r.key), ['manager', 'order', 'finance']);
  const confirmed = confirm(o);
  assert.deepEqual(holdReasons(confirmed, { financeApproved: true }).map(r => r.key), ['manager', 'order']);
  assert.equal(holdReasons(confirmed, { financeApproved: true })[1].detail.includes('ارجاع'), true);
  const referredOnly = { ...o, items: [{ id: 'i1', stage: 'طراحی و پروف' }] };
  assert.equal(holdReasons(referredOnly, { financeApproved: true })[1].detail.includes('مشتری'), true);
  const released = release(confirmed);
  assert.deepEqual(holdReasons(released, { financeApproved: true }).map(r => r.key), ['order']);
  assert.equal(holdReasons(released, { financeApproved: true })[0].detail.includes('ارجاع'), true);
  const referred = act(released, 'complete_stage', { itemId: 'i1', stage: 'ثبت سفارش' }, clerk).order;
  assert.deepEqual(holdReasons(referred, { financeApproved: true }), []);
  assert.equal(holdState(referred, { financeApproved: true }).held, false);
  assert.deepEqual(holdReasons(referred).map(r => r.key), ['finance']);
  const stopped = act(referred, 'stop', { kind: 'pause', reason: 'Customer asked', customerRequest: true }, manager).order;
  assert.equal(holdState(stopped).held, false);
  const legacy = confirm(pending());
  assert.deepEqual(holdReasons(legacy).map(r => r.key), ['manager', 'finance']);
});

