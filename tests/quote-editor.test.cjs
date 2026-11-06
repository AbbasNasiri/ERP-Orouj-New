'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Compile the real component without changing its public exports or adding a
// browser/test-renderer dependency. Fixtures stay inside the project workspace.
const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.work', 'quote-editor-tests');
fs.mkdirSync(fixtureDir, { recursive: true });
const source = fs.readFileSync(path.join(root, 'src', 'QuoteEditor.jsx'), 'utf8');
const compiled = esbuild.buildSync({
  stdin: { contents: `${source}\nexport { canonical, initialDraft }; export { EDITOR_INVOICE_COLUMNS } from './invoice-columns.js';`, resolveDir: path.join(root, 'src'), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' },
}).outputFiles[0].text;
const fixture = path.join(fixtureDir, 'QuoteEditor.cjs');
fs.writeFileSync(fixture, compiled);
const { canonical, initialDraft, lineDescriptionSuggestions, QuoteEditor, EDITOR_INVOICE_COLUMNS } = require(fixture);

function input() {
  return { currency: 'IRR', materials: [{ id: 'paper', description: 'کاغذ', qty: '۲', unit: 'بند', rate: '۱۲۳٬۴۵۶', customerSupplied: false }], services: [{ id: 'print', description: 'چاپ', qty: '1', unit: 'خدمت', rate: '۱۰۰۰' }], offers: [], serviceMarkupPercent: '۲۰', taxPercent: '۰', discount: '۰' };
}
function order(overrides = {}) {
  return { id: 'order-1', quoteRev: 1, status: 'در انتظار تایید', customerId: 'customer-1', items: [], pricing: { input: input() }, ...overrides };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.props?.children);
}
function flatten(node, result = []) {
  if (node == null || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child => flatten(child, result)); return result; }
  if (typeof node.type === 'function') return flatten(node.type(node.props), result);
  result.push(node); flatten(node.props?.children, result); return result;
}

// Deterministic hooks host exercises the component's actual handlers, effects,
// asynchronous callbacks and rerenders. It does not duplicate their rules.
function mount(props) {
  let values = [], cursor = 0, effects = [], changed = false, tree;
  const hooks = {
    // Row-table fragments resolve React.Fragment through this stub, so it must carry the real symbol.
    Fragment: React.Fragment,
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { const value = typeof next === 'function' ? next(values[index]) : next; if (!Object.is(value, values[index])) { values[index] = value; changed = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect, dependencies) {
      const index = cursor++, previous = values[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) { values[index] = dependencies; effects.push(effect); }
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === 'react' ? hooks : require(name), module, module.exports);
  const component = module.exports.QuoteEditor;
  const api = {
    render(next = props) {
      props = next;
      for (let tries = 0; tries < 30; tries++) {
        cursor = 0; changed = false; effects = []; tree = component(props);
        const pending = effects; effects = []; pending.forEach(effect => effect());
        if (!changed) return tree;
      }
      throw new Error('Component failed to settle');
    },
    nodes: () => flatten(tree),
    button(label) { const button = api.nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(button, `Missing button: ${label}`); return button; },
    // Row-table cells carry an aria-label; the parameter fields keep a <label> with a trailing colon (UI-11).
    field(label, index = 0) {
      const byAria = api.nodes().filter(node => ['input', 'select'].includes(node.type) && (node.props['aria-label'] === label || String(node.props['aria-label'] || '').startsWith(`${label} (`)));
      if (byAria.length > index) return byAria[index];
      const wrapper = api.nodes().filter(node => node.type === 'label' && text(node.props.children?.[0]) === `${label}:`)[index];
      assert.ok(wrapper, `Missing field: ${label}`);
      return flatten(wrapper).find(node => ['input', 'select'].includes(node.type));
    },
    change(label, value, index = 0) { api.field(label, index).props.onChange({ target: { value } }); api.render(); },
    content: () => text(tree),
  };
  api.render(); return api;
}

test('rates accept Persian/Arabic digits but missing, negative, malformed and fractional money cannot become zero', () => {
  const original = input();
  assert.equal(canonical(original).materials[0].rate, 123456);
  original.services[0].rate = '١٢٣٤';
  assert.equal(canonical(original).services[0].rate, 1234);
  for (const value of ['', ' ', '−۱', '-1', 'نامعلوم', 'NaN', 'Infinity', '۱۲٫۵']) {
    const draft = input(); draft.materials[0].rate = value;
    assert.throws(() => canonical(draft), /ماده ردیف 1/);
  }
  for (const value of ['۰', '−۲', 'نامعلوم']) {
    const draft = input(); draft.materials[0].qty = value;
    assert.throws(() => canonical(draft), /مقدار/);
  }
  const draft = input(); draft.materials[0].qty = '۹۶٫۲۵';
  assert.equal(canonical(draft).materials[0].qty, 96.25);
});

test('seed never substitutes stock book value or legacy selling totals for a missing current rate', () => {
  const stock = [{ id: 'p1', ownerType: 'مشتری', ownerCustomerId: 'customer-1', category: 'کاغذ', unitValue: 999999 }, { id: 'p2', ownerType: 'مشتری', ownerCustomerId: 'someone-else', unitValue: 888888 }];
  const draft = initialDraft(order({ pricing: undefined, items: [{ id: 'item', unitPrice: 777777, designPrice: 666666, hasDesign: true, papers: [{ inventoryItemId: 'p1', description: 'امانت مشتری', qty: 105, qtyUnit: 'بند' }, { inventoryItemId: 'p2', description: 'موجودی مشتری دیگر', qty: 2 }], services: [{ serviceType: 'صحافی', price: 555555 }] }] }), stock);
  assert.equal(draft.materials[0].customerSupplied, true);
  assert.equal(draft.materials[1].customerSupplied, false);
  assert.ok([...draft.materials, ...draft.services].every(line => line.rate === ''));
  assert.throws(() => canonical(draft), /نرخ فروش/);
  assert.ok(!JSON.stringify(draft).includes('999999'));
  draft.materials.splice(1); draft.services.forEach(line => { line.rate = '۱۰۰'; });
  const quote = canonical(draft);
  assert.equal(quote.materials[0].rate, 0);
  assert.equal(quote.materials[0].qty, 105);
});

test('lithography plates are editable services; ordinary lithography consumables remain editable materials', () => {
  const draft = initialDraft(order({ pricing: undefined, items: [{ lithoMaterials: [{ description: 'زینک دورورقی', qty: 200 }, { description: 'داروی ظهور', qty: 1 }] }] }), []);
  assert.ok(draft.services.some(line => line.description.includes('زینک')));
  assert.ok(draft.materials.some(line => line.description.includes('داروی ظهور')));
  const html = renderToStaticMarkup(React.createElement(QuoteEditor, { order: order({ pricing: { input: draft } }) }));
  assert.ok(html.includes('مادهٔ اولیه'));
  assert.ok(html.includes('خدمت'));
  const ui = mount({ order: order(), onPreview: async () => ({ ok: true, result: {} }) });
  ui.field('دسته', 0).props.onChange({ target: { value: 'services' } }); ui.render();
  assert.equal(ui.nodes().filter(node => node.type === 'input' && node.props.value === 'کاغذ').length, 1);
  assert.equal(ui.nodes().filter(node => node.type === 'select' && node.props.value === 'materials').length, 0);
});

test('loaded offset quotes retain plate/run policy and use normalized service quantity, not a saved derived price', () => {
  const saved = input(); saved.services[0] = { id: 'offset', description: 'چاپ متن', qty: 1, unit: 'خدمت', rate: 999999, offset: { plates: 200, run: 2000, ratePerBlock: 20000000, blockSize: 5000 } };
  const normalized = canonical(initialDraft(order({ pricing: { input: saved } }), []));
  assert.equal(normalized.services[0].qty, 1);
  assert.equal(normalized.services[0].rate, 0);
  assert.equal(normalized.services[0].offset.plates, 200);
  saved.services[0].offset.run = 5001;
  assert.throws(() => canonical(saved), /روش محاسبه/);
  saved.services[0].offset.mode = 'ceilBlocks';
  assert.equal(canonical(saved).services[0].offset.mode, 'ceilBlocks');
});

test('polling preserves an edited rate and blocks stale save when source specifications change within the same quote revision', async () => {
  let saves = 0;
  const props = { order: order(), onPreview: async () => ({ ok: true, result: { total: 500 } }), onSave: async () => { saves++; return { ok: true }; } };
  const ui = mount(props);
  ui.change('مبلغ واحد — نرخ فروش روز (ریال)', '۲۲۲');
  ui.render({ ...props, order: { ...props.order } });
  assert.equal(ui.field('مبلغ واحد — نرخ فروش روز (ریال)').props.value, '۲۲۲');
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  ui.render({ ...props, order: { ...props.order, items: [{ id: 'new-spec', qty: 3000 }] } });
  assert.equal(ui.field('مبلغ واحد — نرخ فروش روز (ریال)').props.value, '۲۲۲');
  assert.ok(ui.content().includes('پیش‌نویس شما حفظ شده'));
  assert.equal(ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.disabled, true);
  await ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.onClick();
  assert.equal(saves, 0);
});

test('save uses the captured revision and recovers when its successful refresh arrives before the callback resolves', async () => {
  const saving = deferred(); let saveArgs;
  const props = { order: order(), onPreview: async () => ({ ok: true, result: { total: 500 } }), onSave: (value, expected) => { saveArgs = [value, expected]; return saving.promise; } };
  const ui = mount(props); ui.change('مبلغ واحد — نرخ فروش روز (ریال)', '۲۲۲');
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  const request = ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.onClick(); ui.render();
  const refreshed = { ...props, order: { ...props.order, quoteRev: 2, pricing: { input: saveArgs[0], result: { total: 500 } } } };
  ui.render(refreshed);
  assert.equal(saveArgs[1], 1);
  saving.resolve({ ok: true }); await request; ui.render(refreshed);
  assert.ok(!ui.content().includes('برای جلوگیری از بازنویسی'));
  assert.equal(ui.field('مبلغ واحد — نرخ فروش روز (ریال)').props.value, '۲۲۲'); // display form; the stored draft keeps 222
  assert.ok(ui.content().includes('نسخهٔ مبنا: ۲'));
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render(refreshed);
  assert.equal(ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.disabled, false);
});

test('late preview for a different order cannot authorize saving its prices on the new order', async () => {
  const waiting = deferred(); let saved = false;
  const props = { order: order(), onPreview: () => waiting.promise, onSave: async () => { saved = true; return { ok: true }; } };
  const ui = mount(props);
  const request = ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  const changed = { ...props, order: order({ id: 'order-2', quoteRev: 7 }) };
  ui.render(changed);
  waiting.resolve({ ok: true, result: { total: 111 } }); await request; ui.render(changed);
  assert.equal(ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.disabled, true);
  assert.ok(!ui.content().includes('پیش‌نمایش محاسبه؛ ثبت نهایی'));
  assert.equal(saved, false);
});

test('an unchanged preview is required, a failed save preserves the draft, and production/stop states lock edits', async () => {
  let saved = 0;
  const props = { order: order(), onPreview: async () => ({ ok: true, result: { total: 10 } }), onSave: async () => { saved++; return { ok: false, error: 'ارتباط قطع شد' }; } };
  const ui = mount(props);
  assert.equal(ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.disabled, true);
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  ui.change('مبلغ واحد — نرخ فروش روز (ریال)', '۳۰۰');
  assert.equal(ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.disabled, true);
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  await ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.onClick(); ui.render();
  assert.equal(saved, 1);
  assert.equal(ui.field('مبلغ واحد — نرخ فروش روز (ریال)').props.value, '۳۰۰');
  assert.ok(ui.content().includes('ارتباط قطع شد'));
  for (const override of [{ status: 'تایید شده' }, { workflow: { stop: { kind: 'pause' } } }, { workflow: { productionAuthorization: { at: 1 } } }]) {
    ui.render({ ...props, order: order(override) });
    assert.equal(ui.button('محاسبه و پیش‌نمایش').props.disabled, true);
    assert.equal(ui.button('ذخیرهٔ قیمت محاسبه‌شده').props.disabled, true);
  }
});

test('pricing rows render as an editable row table whose heads match the official invoice columns', () => {
  const html = renderToStaticMarkup(React.createElement(QuoteEditor, { order: order(), onPreview: async () => ({ ok: true, result: {} }) }));
  assert.ok(!html.includes('quote-row'), 'the tall per-row cards must be replaced by table rows');
  const heads = html.split('</thead>')[0].split('<th scope="col">').slice(1).map(cell => cell.split('</th>')[0]);
  assert.deepEqual(heads, ['ردیف', 'شناسه کالا / خدمت', 'شرح کالا یا خدمات', 'دسته', 'مقدار', 'واحد', 'مبلغ واحد — نرخ فروش روز (ریال)', 'مبلغ کل (ریال)', 'مواد مشتری', 'حذف'], 'invoice column order: ردیف، شناسه، شرح، مقدار، واحد، مبلغ واحد، مبلغ کل');
  const services = html.split('</thead>')[1].split('<th scope="col">').slice(1).map(cell => cell.split('</th>')[0]);
  assert.deepEqual(services, ['ردیف', 'شناسه کالا / خدمت', 'شرح کالا یا خدمات', 'دسته', 'مقدار', 'واحد', 'مبلغ واحد (ریال)', 'مبلغ کل (ریال)', 'چاپ افست', 'حذف']);
  assert.equal((html.match(/<table class="quote-table"/g) || []).length, 2, 'one row table per group');
  assert.ok(html.includes('با کلیدهای جهت و Enter بین خانه‌ها جابه‌جا شوید'));
  assert.ok(html.includes('ترتیب ستون‌ها (ردیف، شناسه، شرح، مقدار، واحد، مبلغ واحد، مبلغ کل) مانند فاکتور رسمی است'));
  assert.ok(html.includes('تخفیف و مالیات در سطح سند اعمال می‌شوند، نه در ردیف'), 'discount and VAT stay document-level, as in the definitive invoice');
  assert.ok(html.includes('<th scope="row"'), 'rows carry row headers for screen readers');
  assert.ok(html.includes('<tfoot>'), 'row sums live in the table footer');
  // The invoice head list is shared source; the editor may only add its own columns and the currency suffix.
  const shared = head => head.replace(/ — نرخ فروش روز/, '').replace(/ \(ریال\)$/, '');
  const editorOnly = new Set(['دسته', 'مواد مشتری', 'چاپ افست', 'حذف']);
  assert.deepEqual(heads.filter(head => !editorOnly.has(head)).map(shared), EDITOR_INVOICE_COLUMNS, 'editor columns follow the printed invoice');
  assert.deepEqual(services.filter(head => !editorOnly.has(head)).map(shared), EDITOR_INVOICE_COLUMNS);
  const invoiceSource = fs.readFileSync(path.join(root, 'src', 'OfficialInvoice.jsx'), 'utf8');
  assert.ok(invoiceSource.includes("from './invoice-columns.js'"), 'the printed invoice must use the shared head list');
  assert.ok(!invoiceSource.includes("'جمع با مالیات و عوارض'"), 'a second copy of the invoice column names would drift from the editor');
});

test('money cells display three-digit grouped Persian numbers while the engine receives plain integer digits', async () => {
  let captured;
  const props = { order: order(), onPreview: value => { captured = value; return Promise.resolve({ ok: true, result: { materials: [], services: [] } }); } };
  const ui = mount(props);
  ui.field('مبلغ واحد — نرخ فروش روز (ریال)').props.onChange({ target: { value: '۱٬۲۳۴٬۵۶۷' } }); ui.render();
  assert.equal(ui.field('مبلغ واحد — نرخ فروش روز (ریال)').props.value, '۱٬۲۳۴٬۵۶۷', 'grouped display form');
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  assert.equal(captured.materials[0].rate, 1234567);
  assert.ok(!JSON.stringify(captured).includes('٬'), 'separators never reach the input sent for calculation');
  assert.ok(!JSON.stringify(captured).includes('۱'), 'Persian digits never reach the input sent for calculation');
  ui.render({ ...props });
  assert.equal(ui.field('مبلغ واحد — نرخ فروش روز (ریال)').props.value, '۱٬۲۳۴٬۵۶۷', 'a rerender must not rewrite the number being edited');
});

test('amount column and footer sum are read from the backend result and go stale on any edit', async () => {
  const amounts = () => ui.nodes().filter(node => node.type === 'td' && node.props.className === 'quote-amount').map(text);
  const props = { order: order(), onPreview: async value => ({ ok: true, result: { materials: [{ id: value.materials[0].id, cost: 246912 }], services: [{ id: 'not-a-row-of-this-order', cost: 999999 }], total: 246912 } }) };
  const ui = mount(props);
  assert.deepEqual(amounts(), ['—', '—', '—', '—'], 'without a calculation the table invents no numbers');
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  assert.deepEqual(amounts(), ['۲۴۶٬۹۱۲', '۲۴۶٬۹۱۲', '—', '۰']);
  assert.ok(!ui.content().includes('۹۹۹٬۹۹۹'), 'a backend line that is not this row is never shown against it');
  ui.change('مبلغ واحد — نرخ فروش روز (ریال)', '۳۰۰');
  assert.deepEqual(amounts(), ['—', '—', '—', '—'], 'editing a row invalidates its amount and both sums');
});

test('arrow keys and Enter move between pricing cells like a spreadsheet and stop at the table edges', () => {
  const focused = [];
  globalThis.document = { getElementById: id => ({ focus: () => focused.push(id), id }) };
  try {
    const ui = mount({ order: order(), onPreview: async () => ({ ok: true, result: {} }) });
    ui.button('افزودن ماده').props.onClick(); ui.render();
    const press = (label, key, index = 0) => { let prevented = false; ui.field(label, index).props.onKeyDown({ key, preventDefault: () => { prevented = true; } }); return prevented; };
    assert.equal(press('شناسه کالا / خدمت', 'ArrowLeft'), true);
    assert.equal(press('شناسه کالا / خدمت', 'ArrowLeft', 1), true);
    assert.equal(press('مقدار', 'ArrowDown'), true);
    assert.equal(press('مبلغ واحد — نرخ فروش روز (ریال)', 'Enter'), true);
    assert.equal(press('مبلغ واحد — نرخ فروش روز (ریال)', 'ArrowUp', 1), true);
    assert.deepEqual(focused, ['qc-materials-0-description', 'qc-materials-1-description', 'qc-materials-1-qty', 'qc-materials-1-rate', 'qc-materials-0-rate']);
    focused.length = 0;
    assert.equal(press('شناسه کالا / خدمت', 'ArrowRight'), false, 'the first column has nothing to its right');
    assert.equal(press('مبلغ واحد — نرخ فروش روز (ریال)', 'ArrowLeft'), false, 'rate is the last editable column');
    assert.equal(press('مقدار', 'ArrowUp'), false, 'the first row cannot move up');
    assert.equal(press('مقدار', 'ArrowDown', 1), false, 'the last row cannot move down');
    assert.deepEqual(focused, [], 'the edges stay put instead of stealing focus');
    // The offset sub-grid moves through its own four cells (the services row is the last checkbox).
    const boxes = ui.nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox');
    boxes[boxes.length - 1].props.onChange({ target: { checked: true } }); ui.render();
    assert.equal(press('تعداد زینک', 'ArrowLeft'), true);
    assert.equal(press('روش محاسبه برای بالای ۵۰۰۰', 'ArrowRight'), true);
    assert.deepEqual(focused, ['qc-services-0-run', 'qc-services-0-ratePerBlock']);
  } finally { delete globalThis.document; }
});

test('rows without a stable 13-digit code are flagged and the warehouse reference stays a display hint', () => {
  const inventory = [{ id: 'p1', name: 'کاغذ ۸۰ گرمی', ownerType: 'خرید' }];
  const ui = mount({ order: order(), inventory, onPreview: async () => ({ ok: true, result: {} }) });
  const flags = () => ui.nodes().filter(node => node.type === 'small' && node.props.className === 'quote-flag').length;
  assert.equal(flags(), 2, 'both seeded rows lack a goods code');
  ui.change('شناسه کالا / خدمت', '1234567890123');
  assert.equal(flags(), 1);
  ui.change('شرح کالا یا خدمات', 'کاغذ ۸۰ گرمی');
  assert.ok(ui.content().includes('مرجع انبار: کاغذ ۸۰ گرمی'), 'typing a known stock name links the row for display only');
  const draft = initialDraft(order({ pricing: undefined, items: [{ id: 'i', papers: [{ inventoryItemId: 'p1', description: 'کاغذ ۸۰ گرمی', qty: 10 }] }] }), inventory);
  assert.equal(draft.materials[0].inventoryItemId, 'p1');
  const quote = canonical({ ...input(), materials: draft.materials.map(row => ({ ...row, rate: '۱۰۰' })) });
  assert.equal(quote.materials[0].inventoryItemId, undefined, 'the warehouse link is never persisted into the priced input');
  assert.equal(quote.materials[0].rate, 100);
});

test('a short goods code is completed to 13 digits with leading zeros and the empty code stays empty', () => {
  const original = input();
  original.materials[0].itemCode = '۱۲۳۴';
  assert.equal(canonical(original).materials[0].itemCode, '0000000001234');
  original.materials[0].itemCode = '1234567890123';
  assert.equal(canonical(original).materials[0].itemCode, '1234567890123');
  original.materials[0].itemCode = '  ';
  assert.equal(Object.hasOwn(canonical(original).materials[0], 'itemCode'), false);
  for (const value of ['12345678901234', '12a', '<script>']) {
    original.materials[0].itemCode = value;
    assert.throws(() => canonical(original), /شناسه کالا/);
  }
});

test('the seed covers every invoice category and uses the cover press run', () => {
  const item = {
    id: 'book', productName: 'کتاب آزمایشی', productType: 'کتاب', qty: 2000, qtyUnit: 'نسخه', waste: 100,
    bindingType: 'شومیز', coverEnabled: true, coverPress: '2 ورقی', spec: { textColors: 2, printMethod: 'افست' },
    papers: [{ description: 'تحریر ۷۰', qty: 120 }], coverPapers: [{ description: 'مقوای جلد', qty: 1050 }],
    lithoMaterials: [{ description: 'زینک دورورقی', qty: 158 }], coverCellophane: [{ description: 'سلفون براق', qty: 1050 }],
    services: [{ serviceType: 'بسته‌بندی', notes: 'کارتن' }],
  };
  const draft = initialDraft(order({ pricing: undefined, items: [item] }), []);
  const descriptions = [...draft.materials, ...draft.services].map(row => row.description);
  for (const category of ['کاغذ و مقوا', 'چاپ متن', 'چاپ جلد', 'صحافی', 'خدمات تکمیلی']) {
    assert.ok(descriptions.some(text => text.startsWith(category)), `missing invoice category: ${category}`);
  }
  const textRow = draft.services.find(row => row.description.startsWith('چاپ متن') && row.description.includes('افست'));
  assert.equal(Number(textRow.qty), 2100, 'text print run is net circulation plus waste');
  const coverRow = draft.services.find(row => row.description.startsWith('چاپ جلد'));
  assert.equal(Number(coverRow.qty), 1050, 'two-up cover press: 1000 sheets + 50 waste');
  assert.match(coverRow.unit, /ورق/);
});

test('description suggestions reuse saved quote lines, every revision snapshot and product names without duplicating', () => {
  const orders = [
    { pricing: { input: { materials: [{ description: ' کاغذ ۸۰ گرمی ' }], services: [{ description: 'صحافی' }, { description: '  ' }] } }, quoteHistory: [{ input: { materials: [{ description: 'کاغذ گلاسه ۱۵۰' }] } }, { input: {} }], items: [{ productName: 'کتاب راحلی', services: [{ serviceType: 'بسته‌بندی' }] }] },
    { pricing: { input: { materials: [{ description: 'کاغذ ۸۰ گرمی' }] } } },
  ];
  assert.deepEqual(lineDescriptionSuggestions(orders), ['کاغذ ۸۰ گرمی', 'صحافی', 'کاغذ گلاسه ۱۵۰', 'کتاب راحلی', 'بسته‌بندی']);
  assert.equal(lineDescriptionSuggestions([{ pricing: { input: { materials: Array.from({ length: 80 }, (_, i) => ({ description: `شرح ${i}` })) } } }]).length, 60, 'the suggestion list is capped');
  assert.deepEqual(lineDescriptionSuggestions(undefined), []);
  const html = renderToStaticMarkup(React.createElement(QuoteEditor, { order: order(), suggestions: ['کاغذ ۸۰ گرمی'], onPreview: async () => ({ ok: true, result: {} }) }));
  assert.ok(html.includes('<datalist id="quote-descriptions-materials"><option value="کاغذ ۸۰ گرمی"></option></datalist>'));
  assert.ok(html.includes('list="quote-descriptions-materials"'), 'free text stays possible: the cell suggests, it never restricts');
});

test('the offer table and the document-level discount keep their heads, separators and zero charge to the customer', () => {
  const ui = mount({ order: order({ pricing: { input: { ...input(), offers: [{ id: 'o1', description: 'برش رایگان', internalCost: '۲۵۰۰۰۰' }] } } }), onPreview: async () => ({ ok: true, result: {} }) });
  assert.equal(ui.field('هزینهٔ داخلی (ریال)').props.value, '۲۵۰٬۰۰۰');
  assert.ok(ui.content().includes('صفر'), 'an offer is never chargeable to the customer');
  assert.ok(ui.content().includes('هزینهٔ داخلی جدا از جمع کل نگه داشته می‌شود'));
  ui.change('تخفیف — ریال', '۱٬۵۰۰٬۰۰۰');
  assert.equal(ui.field('تخفیف — ریال').props.value, '۱٬۵۰۰٬۰۰۰');
  assert.equal(canonical({ ...input(), discount: '۱٬۵۰۰٬۰۰۰' }).discount, 1500000);
});

/* اصلاحات ۱۷/بند ۳ — تصمیم کارفرما: حالت قرارداد در همان فرمِ پیش‌فاکتور انتخاب می‌شود،
   پیش‌فرض «ثابت» است و عوض‌کردنش نسخهٔ تازهٔ پیش‌فاکتور + تأیید دوبارهٔ مشتری را می‌خواهد.
   کنترل منفی: مقداری که در فهرستِ سرور نیست به موتور نمی‌رسد. */
test('حالت قرارداد: پیش‌فرض «ثابت»، هر دو گزینه در همان فرم و عددِ دست‌کاری‌شده به موتور نمی‌رسد', async () => {
  let captured;
  const props = { order: order(), onPreview: value => { captured = value; return Promise.resolve({ ok: true, result: { materials: [], services: [] } }); } };
  const ui = mount(props);
  assert.deepEqual(ui.field('حالت قرارداد').props.children.map(option => option.props.value), ['ثابت', 'تعداد واقعی'], 'دو حالتِ مجازِ سرور (billing.CONTRACT_MODES) در خانه هستند');
  assert.equal(ui.field('حالت قرارداد').props.value, 'ثابت', 'پیش‌فاکتورِ بازنشده «ثابت» است');
  assert.ok(ui.content().includes('عوض‌کردن این خانه نسخهٔ تازهٔ پیش‌فاکتور و تأیید دوبارهٔ مشتری را می‌خواهد'), 'قاعدهٔ کارفرما زیرِ همان خانه نوشته شده');
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  assert.equal(captured.contractMode, 'ثابت', 'پیش‌فاکتورِ قدیمی که کلید ندارد با همان پیش‌فرض محاسبه می‌شود');
  ui.change('حالت قرارداد', 'تعداد واقعی');
  await ui.button('محاسبه و پیش‌نمایش').props.onClick(); ui.render();
  assert.equal(captured.contractMode, 'تعداد واقعی', 'انتخابِ تازه به همان ورودیِ موتور می‌رسد');
  assert.equal(canonical(input()).contractMode, 'ثابت', 'کلیدِ غایب از پیش‌فاکتورِ ذخیره‌شده صفر یا خالی نمی‌شود');
  assert.equal(canonical({ ...input(), contractMode: 'اقشاری' }).contractMode, 'ثابت', 'کنترل منفی: حالتِ مجازِ سرور جای مقدارِ دست‌کاری‌شده می‌نشیند');
});
