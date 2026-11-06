'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = import(pathToFileURL(path.resolve(__dirname, '../src/order-payload.js')).href);

test('the general order form passes stored workflow fields through untouched', async () => {
  const { withoutWorkflowWrites, FORM_WORKFLOW_FIELDS } = await load;
  const stored = {
    id: 'o1', orderNumber: '1001', managerOverrideDebt: true, approvedAt: '2026-10-20',
    workflow: { revision: 3, productionAuthorization: { by: 'مدیر چاپخانه' } }, pricing: { schemaVersion: 1 },
    onHold: true, holdReason: 'کسری کاغذ', quoteHistory: [{ rev: 1 }],
  };
  const form = { ...stored, title: 'ویرایش شد', managerOverrideDebt: false, approvedAt: '', workflow: {}, pricing: null, onHold: false, holdReason: '', quoteHistory: [] };
  const next = withoutWorkflowWrites(form, stored);
  assert.equal(next.title, 'ویرایش شد');
  for (const key of FORM_WORKFLOW_FIELDS) assert.deepEqual(next[key], stored[key], key);
});

test('a brand-new order carries no workflow or approval field', async () => {
  const { withoutWorkflowWrites, FORM_WORKFLOW_FIELDS } = await load;
  const next = withoutWorkflowWrites({ id: 'o9', intent: 'proforma', managerOverrideDebt: false, onHold: false, holdReason: '' }, undefined);
  FORM_WORKFLOW_FIELDS.forEach(key => assert.equal(Object.prototype.hasOwnProperty.call(next, key), false, key));
  assert.equal(next.intent, 'proforma');
});

test('legacy records keep their shape and a manager approval cannot be cleared from the form', async () => {
  const { withoutWorkflowWrites } = await load;
  const legacy = { id: 'o2', orderNumber: '1002' };
  assert.equal(Object.prototype.hasOwnProperty.call(withoutWorkflowWrites({ ...legacy, managerOverrideDebt: false }, legacy), 'managerOverrideDebt'), false);
  const approved = { id: 'o3', managerOverrideDebt: true, approvedAt: '2026-10-20' };
  const kept = withoutWorkflowWrites({ id: 'o3', managerOverrideDebt: false, approvedAt: '' }, approved);
  assert.equal(kept.managerOverrideDebt, true);
  assert.equal(kept.approvedAt, '2026-10-20');
});
