'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'undo.mjs')).href;

test('form undo: one continuous edit in a field is one step back, not one per character', async t => {
  const { createUndoStack } = await import(moduleUrl);
  let clock = 1_000_000;
  const stack = createUndoStack({ start: '{"qty":"1"}', now: () => clock });
  assert.equal(stack.depth, 0, 'a freshly opened form has nothing to go back to');
  for (const next of ['{"qty":"12"}', '{"qty":"123"}', '{"qty":"1234"}']) { stack.record(next); clock += 120; }
  assert.equal(stack.depth, 1, 'typing through a field is one edit, so one برگشت');
  assert.equal(stack.undo(), '{"qty":"1"}', 'back returns the value the field had before this edit');
  assert.equal(stack.depth, 0);
  assert.equal(stack.undo(), null, 'and once there is nothing left, undo claims nothing');
  clock += 1_500;
  for (const next of ['{"qty":"5"}', '{"qty":"56"}']) { stack.record(next); clock += 900; }
  assert.equal(stack.depth, 1, 'slow typing into the same field is still one step back');
});

test('form undo: a different field, a different item and adding a row each count as their own step', async t => {
  const { createUndoStack, changedTag } = await import(moduleUrl);
  let clock = 1_000_000;
  const opened = '{"phone":"0912","deliveryDate":"","items":[{"id":"i1","qty":"500"}]}';
  const stack = createUndoStack({ start: opened, now: () => clock });
  const phone = '{"phone":"0912111","deliveryDate":"","items":[{"id":"i1","qty":"500"}]}';
  const date = '{"phone":"0912111","deliveryDate":"1405/08/12","items":[{"id":"i1","qty":"500"}]}';
  const itemQty = '{"phone":"0912111","deliveryDate":"1405/08/12","items":[{"id":"i1","qty":"525"}]}';
  const secondItem = '{"phone":"0912111","deliveryDate":"1405/08/12","items":[{"id":"i1","qty":"525"},{"id":"i2","qty":"100"}]}';
  const otherItem = '{"phone":"0912111","deliveryDate":"1405/08/12","items":[{"id":"i1","qty":"525"},{"id":"i2","qty":"200"}]}';
  assert.equal(changedTag(opened, phone), 'phone');
  assert.equal(changedTag(phone, date), 'deliveryDate');
  assert.equal(changedTag(date, itemQty), 'item:i1', 'a row of the order is its own step, not a lump');
  assert.equal(changedTag(itemQty, secondItem), 'items', 'adding a row is counted apart from editing one');
  for (const next of [phone, date, itemQty, secondItem, otherItem]) { stack.record(next); clock += 80; }
  assert.equal(stack.depth, 5, 'five different edits = five steps back');
  assert.equal(stack.undo(), secondItem);
  assert.equal(stack.undo(), itemQty);
  assert.equal(stack.undo(), date);
  assert.equal(stack.undo(), phone);
});

test('form undo: separate edits stack in order and the stack stays bounded', async t => {
  const { createUndoStack } = await import(moduleUrl);
  let clock = 1_000_000;
  const stack = createUndoStack({ start: '{"a":1}', now: () => clock });
  for (const next of ['{"a":2}', '{"a":3}', '{"a":4}']) { clock += 5_000; stack.record(next); }
  assert.equal(stack.depth, 3);
  assert.equal(stack.undo(), '{"a":3}', 'the newest edit goes back first');
  assert.equal(stack.undo(), '{"a":2}');
  assert.equal(stack.undo(), '{"a":1}', 'three steps reach the state the form was opened with');
  clock += 5_000; stack.record('{"a":5}');
  assert.equal(stack.undo(), '{"a":1}', 'editing after a برگشت is itself a step that can be undone');
  const big = createUndoStack({ start: '{"n":0}', limit: 3, now: () => clock });
  for (const n of [1, 2, 3, 4]) { clock += 5_000; big.record(`{"n":${n}}`); }
  assert.equal(big.depth, 3, 'memory is bounded: the oldest snapshot is dropped, the recent ones are kept');
  assert.equal(big.undo(), '{"n":3}');
});

test('form undo: rewinding to the opened state clears the way-back history and re-opening is not a change', async t => {
  const { createUndoStack } = await import(moduleUrl);
  let clock = 1_000_000;
  const stack = createUndoStack({ start: '{"items":[]}', now: () => clock });
  clock += 5_000; stack.record('{"items":[1]}');
  clock += 5_000; stack.record('{"items":[1,2]}');
  assert.equal(stack.depth, 2);
  assert.equal(stack.rewind('{"items":[]}'), '{"items":[]}', 'rewind hands back the state the form was opened with');
  assert.equal(stack.depth, 0, 'after rewinding there is no half-way back left to offer');
  assert.equal(stack.record('{"items":[]}'), 0, 'feeding the identical state adds no step');
  clock += 5_000;
  assert.equal(stack.record('{"items":[9]}'), 1, 'the next edit is a fresh step measured from the rewound state');
  assert.equal(stack.undo(), '{"items":[]}', 'and it is undoable');
});

test('form undo: the order form wires the stack to a visible برگشت button and the keyboard', async t => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  assert.ok(src.includes("import { createUndoStack } from './undo.mjs'"), 'the form uses the shared stack, not an ad-hoc one');
  assert.ok(/undoRef\.current\.record\(JSON\.stringify\(o\)\)/.test(src), 'every change of the form value is recorded');
  assert.ok(src.includes('onClick={undoEdit}'), 'برگشت is a visible button, not only a shortcut');
  assert.ok(src.includes('onClick={rewindForm}'), 'going back to the opened form is offered separately');
  assert.ok(/key\.toLowerCase\(\) !== 'z'/.test(src), 'Ctrl+Z is bound to the same step-back');
  /* کنترل منفی: دروازهٔ بستن فرم دست‌نخورده است — برگشت نباید جای «ثبت نشده را دور ریختی» را بگیرد */
  const guard = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'ExitGuard.jsx'), 'utf8');
  assert.ok(guard.includes('هنوز ثبت نشده است'), 'closing an unregistered form still asks first');
});
