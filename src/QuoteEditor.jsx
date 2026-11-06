import { Fragment, useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from './ExitGuard.jsx';
import { EDITOR_INVOICE_COLUMNS } from './invoice-columns.js';
import { coverRun, textRun } from './print-run.mjs';
import './form-field.css';
import './quote-editor.css';

const id = () => globalThis.crypto?.randomUUID?.() || `quote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const digits = value => String(value ?? '').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[٬,،\s]/g, '').replace(/٫/g, '.').replace(/[−–]/g, '-');
const padItemCode = value => { const text = digits(value); return /^\d{1,13}$/.test(text) ? text.padStart(13, '0') : text; };

// هر ردیف فاکتور با نام دسته آغاز می‌شود تا هیچ فاکتوری بدون کاغذ، چاپ، صحافی و خدمات تکمیلی نباشد.
const QUICK_CATEGORIES = [
  { key: 'paper', group: 'materials', label: 'کاغذ و مقوا', unit: 'ورق' },
  { key: 'textPrint', group: 'services', label: 'چاپ متن', unit: 'نسخه' },
  { key: 'coverPrint', group: 'services', label: 'چاپ جلد', unit: 'ورق' },
  { key: 'binding', group: 'services', label: 'صحافی', unit: 'نسخه' },
  { key: 'finishing', group: 'services', label: 'خدمات تکمیلی', unit: 'خدمت' },
];
function categoryOf(description) {
  const text = String(description || '').trim();
  if (text.startsWith('کاغذ و مقوا')) return 'paper';
  if (text.startsWith('چاپ جلد')) return 'coverPrint';
  if (text.startsWith('چاپ')) return 'textPrint';
  if (text.startsWith('صحافی')) return 'binding';
  if (text.startsWith('خدمات تکمیلی')) return 'finishing';
  return '';
}
const format = value => Number(value || 0).toLocaleString('fa-IR');
const revisionOf = order => Number(order.quoteRev) || 1;
/* آینهٔ UI از CONTRACT_MODES در electron/billing.js؛ سرور همان لیست را اعتبارسنجی می‌کند.
   تصمیم کارفرما (اصلاحات ۱۷/بند ۳): حالت قرارداد در فرم پیش‌فاکتور انتخاب می‌شود و
   پیش‌فرض «ثابت» است؛ عوض‌کردنش نسخهٔ تازهٔ پیش‌فاکتور و تأیید دوبارهٔ مشتری می‌خواهد. */
const CONTRACT_MODES = ['ثابت', 'تعداد واقعی'];
const sourceOf = order => JSON.stringify({ items: order.items || [], customerId: order.customerId || '', title: order.title || '', description: order.description || '' });
const material = () => ({ id: id(), description: '', qty: '1', unit: 'عدد', rate: '', customerSupplied: false });
const service = () => ({ id: id(), description: '', qty: '1', unit: 'خدمت', rate: '' });
const offer = () => ({ id: id(), description: '', internalCost: '' });

function initialDraft(order, inventory) {
  if (order.pricing?.input) {
    const saved = structuredClone(order.pricing.input);
    return { materials: [], services: [], offers: [], serviceMarkupPercent: 20, taxPercent: 0, discount: 0, contractMode: CONTRACT_MODES[0], ...saved, currency: 'IRR' };
  }
  const draft = { currency: 'IRR', materials: [], services: [], offers: [], serviceMarkupPercent: '20', taxPercent: '0', discount: '0', contractMode: CONTRACT_MODES[0] };
  const addMaterial = (description, row, supplied) => draft.materials.push({ ...material(), description, qty: row.qty ?? '', unit: row.qtyUnit || row.unitLabel || 'عدد', rate: '', customerSupplied: !!supplied, inventoryItemId: row.inventoryItemId || undefined });
  const addService = (description, qty = '1', unit = 'خدمت') => draft.services.push({ ...service(), description, qty, unit });
  for (const [index, item] of (order.items || []).entries()) {
    const label = item.productName || item.productType || `قلم ${index + 1}`;
    const sp = item.spec || {};
    const n = item.analysis?.ok ? item.analysis.numbers : null;
    const suppliedOf = stock => stock?.ownerType === 'مشتری' && !!order.customerId && stock.ownerCustomerId === order.customerId;
    for (const group of ['papers', 'coverPapers', 'coverLining']) {
      for (const row of (item[group] || [])) {
        if (!row.description && !row.inventoryItemId && !String(row.qty || '').trim()) continue;
        const stock = inventory.find(entry => entry.id === row.inventoryItemId);
        addMaterial(`کاغذ و مقوا — ${label} — ${row.description || stock?.name || 'مادهٔ بدون شرح'}`, row, suppliedOf(stock));
      }
    }
    for (const row of (item.lithoMaterials || [])) {
      if (!row.description && !row.inventoryItemId && !String(row.qty || '').trim()) continue;
      const stock = inventory.find(entry => entry.id === row.inventoryItemId);
      const description = `چاپ متن — ${label} — ${row.description || stock?.name || 'زینک'}`;
      if (/زینک/.test(`${stock?.category || ''} ${row.description || ''}`)) addService(description, row.qty ?? '1', row.qtyUnit || row.unitLabel || 'عدد');
      else addMaterial(description, row, suppliedOf(stock));
    }
    for (const group of ['bindingMaterials', 'coverCellophane']) {
      for (const row of (item[group] || [])) {
        if (!row.description && !row.inventoryItemId && !String(row.qty || '').trim()) continue;
        const stock = inventory.find(entry => entry.id === row.inventoryItemId);
        addMaterial(`خدمات تکمیلی — ${label} — ${row.description || stock?.name || 'مادهٔ بدون شرح'}`, row, suppliedOf(stock));
      }
    }
    for (const row of (item.services || [])) {
      if (row.serviceType || row.notes) addService(`خدمات تکمیلی — ${label} — ${row.serviceType || 'خدمت'}${row.notes ? ` — ${row.notes}` : ''}`);
    }
    if (item.hasDesign) addService(`خدمات تکمیلی — ${label} — طراحی${item.designDescription ? ` — ${item.designDescription}` : ''}`);
    const digital = sp.printMethod === 'دیجیتال';
    const run = n ? { net: n.qty, waste: n.runWaste, total: n.runQty } : textRun(item.qty, item.waste);
    addService(`چاپ متن — ${label} — ${digital ? 'دیجیتال' : 'افست'}${sp.textColors ? `، ${sp.textColors} رنگ` : ''}${n?.forms ? `، ${n.forms} فرم` : ''}${run.waste ? `، ${run.waste} باطله` : ''}`, run.total || '1', item.qtyUnit || 'نسخه');
    if (item.bindingType && item.bindingType !== 'بدون صحافی') addService(`صحافی — ${label} — ${item.bindingType}`, item.qty || '1', item.qtyUnit || 'نسخه');
    if (item.coverEnabled) {
      const cover = n?.coverSheetsTotal
        ? { press: item.press || '2 ورقی', coversPerSheet: n.coverFit, waste: n.coverWasteSheets, sheets: n.coverSheetsTotal }
        : coverRun(item.qty, item.coverPress);
      addService(`چاپ جلد — ${label} — ${cover.press}، ${cover.coversPerSheet} جلد در هر ورق${cover.waste ? `، ${cover.waste} باطله` : ''}`, cover.sheets || '1', 'ورق');
    }
  }
  return draft;
}

function numeric(value, label, { positive = false, integer = false, optional = false } = {}) {
  const text = digits(value);
  if (!text) {
    if (optional) return undefined;
    throw new Error(`${label}: مقدار را وارد کنید.`);
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(`${label}: عدد معتبر وارد کنید.`);
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0) || number > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(number))) {
    throw new Error(`${label}: ${integer ? 'عدد صحیح' : 'عدد'} ${positive ? 'بزرگ‌تر از صفر' : 'صفر یا مثبت'} و در محدودهٔ مجاز لازم است.`);
  }
  return number;
}

function canonical(draft) {
  const label = (value, name) => { if (!String(value || '').trim()) throw new Error(`${name}: شرح را وارد کنید.`); return String(value).trim(); };
  const lines = (rows, isMaterial) => rows.map((row, index) => {
    const name = `${isMaterial ? 'ماده' : 'خدمت'} ردیف ${index + 1}`;
    const line = { id: row.id, description: label(row.description, name), unit: label(row.unit, `${name}، واحد`), qty: numeric(row.qty, `${name}، مقدار`, { positive: true }), rate: 0 };
    const itemCode = digits(row.itemCode);
    if (itemCode) {
      if (!/^\d{1,13}$/.test(itemCode)) throw new Error(`${name}: شناسه کالا یا خدمت باید فقط رقم و حداکثر ۱۳ رقم باشد.`);
      line.itemCode = itemCode.padStart(13, '0');
    }
    if (isMaterial) {
      line.customerSupplied = row.customerSupplied === true;
      line.rate = line.customerSupplied ? 0 : numeric(row.rate, `${name}، نرخ فروش روز به ریال`, { integer: true });
    } else if (row.offset) {
      const offset = { plates: numeric(row.offset.plates, `${name}، تعداد زینک`, { positive: true, integer: true }), run: numeric(row.offset.run, `${name}، تیراژ چاپ`, { positive: true, integer: true }), ratePerBlock: numeric(row.offset.ratePerBlock, `${name}، تعرفهٔ هر زینک`, { integer: true }), blockSize: 5000 };
      if (row.offset.mode) offset.mode = row.offset.mode;
      if (offset.run > 5000 && !offset.mode) throw new Error(`${name}: برای تیراژ بالای ۵۰۰۰، روش محاسبه را انتخاب کنید.`);
      line.qty = 1; line.offset = offset;
    } else line.rate = numeric(row.rate, `${name}، نرخ خدمت به ریال`, { integer: true });
    return line;
  });
  return {
    currency: 'IRR', materials: lines(draft.materials, true), services: lines(draft.services, false),
    offers: draft.offers.map((row, index) => {
      const line = { id: row.id, description: label(row.description, `آفر ردیف ${index + 1}`) };
      const cost = numeric(row.internalCost, `آفر ردیف ${index + 1}، هزینهٔ داخلی`, { integer: true, optional: true });
      if (cost !== undefined) line.internalCost = cost;
      return line;
    }),
    serviceMarkupPercent: numeric(draft.serviceMarkupPercent, 'درصد سود خدمات'), taxPercent: numeric(draft.taxPercent, 'درصد مالیات'), discount: numeric(draft.discount, 'تخفیف', { integer: true }),
    /* صریح فرستاده می‌شود تا نسخهٔ تازه از حالتِ قراردادِ بی‌خبر فرق نکند؛ سرور همان را در
       پیش‌فاکتورِ تأییدشده نگه می‌دارد و فاکتورِ تحویلی از همان می‌خواند (billing.contractMode). */
    contractMode: CONTRACT_MODES.includes(draft.contractMode) ? draft.contractMode : CONTRACT_MODES[0],
  };
}

function Field({ label, children }) { return <label className="quote-field psx-field psx-stacked"><span className="psx-field-label">{label}:</span><span className="psx-field-control">{children}</span></label>; }
const quantityDisplay = value => {
  const raw = digits(value); if (!raw || !/^\d*(\.\d*)?$/.test(raw)) return raw;
  const [whole, fraction] = raw.split('.');
  return (whole ? Number(whole).toLocaleString('fa-IR') : '') + (fraction === undefined ? '' : '٫' + fraction.replace(/\d/g, n => '۰۱۲۳۴۵۶۷۸۹'[Number(n)]));
};
function NumberInput({ value, onChange, integer = false, disabled = false }) { return <input value={quantityDisplay(value)} onChange={e => onChange(digits(e.target.value))} inputMode={integer ? 'numeric' : 'decimal'} dir="ltr" disabled={disabled} autoComplete="off" />; }

const moneyDisplay = value => { const raw = digits(value); if (!raw) return ''; const number = Number(raw); return Number.isFinite(number) ? number.toLocaleString('fa-IR') : raw; };
// The stored draft keeps plain digits; only the display carries the three-digit separators.
function MoneyInput({ value, onChange, disabled = false, ...rest }) { return <input {...rest} value={moneyDisplay(value)} onChange={e => onChange(digits(e.target.value))} inputMode="numeric" dir="ltr" disabled={disabled} autoComplete="off" />; }

const cellId = (group, index, key) => `qc-${group}-${index}-${key}`;
const MAIN_CELLS = ['itemCode', 'description', 'qty', 'unit', 'rate'];
const OFFSET_CELLS = ['plates', 'run', 'ratePerBlock', 'mode'];
function focusCell(group, index, key) { const element = typeof document === 'undefined' ? null : document.getElementById(cellId(group, index, key)); element?.focus?.(); }
// Spreadsheet-style cell movement: left/right walk the columns of the row (RTL: left is the next column),
// up/down and Enter walk the rows and keep the same column.
function makeNavigate(group, index, key, cells, rowCount) {
  return event => {
    const step = { ArrowLeft: 1, ArrowRight: -1 }[event.key];
    if (step !== undefined) {
      const target = cells.indexOf(key) + step;
      if (target < 0 || target >= cells.length) return;
      event.preventDefault(); focusCell(group, index, cells[target]); return;
    }
    const vertical = event.key === 'ArrowDown' ? 1 : event.key === 'Enter' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!vertical) return;
    const target = index + vertical;
    if (target < 0 || target >= rowCount) return;
    event.preventDefault(); focusCell(group, target, key);
  };
}

function lineAmount(result, group, row) {
  const lines = result?.[group === 'materials' ? 'materials' : 'services'];
  const match = Array.isArray(lines) ? lines.find(entry => entry.id === row.id) : null;
  return match?.cost;
}
export function lineDescriptionSuggestions(orders) {
  const seen = new Set();
  const collect = input => { if (!input) return; for (const group of ['materials', 'services']) for (const line of (input[group] || [])) { const text = String(line.description || '').trim(); if (text) seen.add(text); } };
  for (const order of orders || []) {
    collect(order.pricing?.input);
    for (const snapshot of (order.quoteHistory || [])) collect(snapshot.input);
    for (const item of (order.items || [])) {
      if (item.productName) seen.add(String(item.productName).trim());
      for (const row of (item.services || [])) if (row.serviceType) seen.add(String(row.serviceType).trim());
    }
  }
  return [...seen].filter(Boolean).slice(0, 60);
}

function Summary({ result }) {
  return <div className="quote-summary" aria-label="ریز محاسبهٔ پیش‌فاکتور">
    <p>فروش مواد + هزینهٔ خدمات + سود فقط خدمات − تخفیف + مالیات = مبلغ نهایی</p>
    <dl>{[['فروش مواد', result.materialsCost], ['هزینهٔ خدمات', result.servicesCost], ['سود خدمات', result.serviceMarkupAmount], ['تخفیف', result.discount ?? result.discountAmount ?? 0], ['مبلغ پیش از مالیات', result.subtotal], ['مالیات', result.taxAmount], ['مبلغ نهایی', result.total]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{format(value)} ریال</dd></div>)}</dl>
    {result.offers?.length > 0 && <p>آفر برای مشتری رایگان است. هزینهٔ داخلی ثبت‌شده: {format(result.knownOffersInternalCost)} ریال؛ هزینهٔ نامشخص: {format(result.offersWithUnknownCost)} ردیف.</p>}
    {result.materials?.length > 0 && <details><summary>جزئیات مواد</summary>{result.materials.map((row, index) => <p key={row.id || index}>{row.description} — {format(row.qty)} {row.unit} — {row.customerSupplied ? 'تأمین مشتری؛ مبلغ فروش صفر' : `${format(row.cost)} ریال`}</p>)}</details>}
    {result.services?.length > 0 && <details><summary>جزئیات خدمات</summary>{result.services.map((row, index) => <p key={row.id || index}>{row.description} — {format(row.cost)} ریال</p>)}</details>}
  </div>;
}

export function QuoteEditor({ order, inventory = [], suggestions = [], onPreview, onSave }) {
  const [draft, setDraft] = useState(() => initialDraft(order, inventory));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [preview, setPreview] = useState(null);
  const [savedPreviewKey, setSavedPreviewKey] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);
  const base = useRef({ id: order.id, revision: revisionOf(order), pricing: JSON.stringify(order.pricing || null), source: sourceOf(order) });
  const scope = useRef(0);
  const inFlight = useRef(false);
  const draftKey = JSON.stringify(draft);
  const dirty = draftKey !== baseline;
  useUnsavedChanges({ dirty, busy, title: 'قیمت‌گذاری سفارش', onDiscard: reset });
  const locked = order.status !== 'در انتظار تایید' || !!order.workflow?.productionAuthorization || !!order.workflow?.stop;
  const currentRevision = revisionOf(order);
  const currentPricing = JSON.stringify(order.pricing || null);
  const currentSource = sourceOf(order);
  function reset() {
    scope.current += 1; inFlight.current = false; setBusy('');
    const next = initialDraft(order, inventory);
    setDraft(next); setBaseline(JSON.stringify(next)); setPreview(null); setSavedPreviewKey(''); setConflict(false); setError(''); setMessage(''); setResetRequested(false);
    base.current = { id: order.id, revision: revisionOf(order), pricing: JSON.stringify(order.pricing || null), source: sourceOf(order) };
  }
  useEffect(() => {
    if (base.current.id !== order.id) { reset(); return; }
    if (base.current.revision !== currentRevision || base.current.pricing !== currentPricing || base.current.source !== currentSource) {
      if (dirty || busy) setConflict(true);
      else reset();
    }
  }, [order.id, currentRevision, currentPricing, currentSource, dirty, busy]);
  function patch(patchValue) { setDraft(previous => ({ ...previous, ...patchValue })); setError(''); setMessage(''); }
  function patchRow(group, rowId, values) { patch({ [group]: draft[group].map(row => row.id === rowId ? { ...row, ...values } : row) }); }
  function remove(group, rowId) { patch({ [group]: draft[group].filter(row => row.id !== rowId) }); }
  function move(group, row) {
    const target = group === 'materials' ? 'services' : 'materials';
    const next = { id: row.id, description: row.description, itemCode: row.itemCode, inventoryItemId: row.inventoryItemId, qty: row.qty, unit: row.unit, rate: row.rate, ...(target === 'materials' ? { customerSupplied: false } : {}) };
    patch({ [group]: draft[group].filter(entry => entry.id !== row.id), [target]: [...draft[target], next] });
  }
  function quickAdd(spec) {
    const row = spec.group === 'materials'
      ? { ...material(), description: `${spec.label} — `, unit: spec.unit, qty: '1' }
      : { ...service(), description: `${spec.label} — `, unit: spec.unit, qty: '1' };
    patch({ [spec.group]: [...draft[spec.group], row] });
  }
  async function calculate() {
    if (inFlight.current || locked) return;
    inFlight.current = true;
    const requestScope = scope.current;
    setError(''); setMessage(''); setBusy('preview');
    try {
      const input = canonical(draft);
      const response = await onPreview(input);
      if (scope.current !== requestScope) return;
      if (!response?.ok || !response.result) throw new Error(response?.error || 'پیش‌نمایش محاسبه دریافت نشد.');
      setPreview({ result: response.result, input, draftKey });
    } catch (e) { if (scope.current === requestScope) { setPreview(null); setError(e?.message || 'محاسبه انجام نشد.'); } }
    finally { if (scope.current === requestScope) { inFlight.current = false; setBusy(''); } }
  }
  async function save() {
    if (inFlight.current || locked || conflict || !preview || preview.draftKey !== draftKey || savedPreviewKey === draftKey) return;
    inFlight.current = true;
    const requestScope = scope.current;
    setBusy('save'); setError(''); setMessage('');
    try {
      const response = await onSave(preview.input, base.current.revision);
      if (scope.current !== requestScope) return;
      if (!response?.ok) throw new Error(response?.error || 'قیمت ثبت نشد.');
      setBaseline(draftKey); setSavedPreviewKey(draftKey); setMessage('قیمت ثبت شد؛ تأیید مشتری و اجازهٔ مدیر همچنان جداگانه لازم است.'); setConflict(false);
    } catch (e) { if (scope.current === requestScope) setError(e?.message || 'قیمت ثبت نشد؛ پیش‌نویس شما حفظ شده است.'); }
    finally { if (scope.current === requestScope) { inFlight.current = false; setBusy(''); } }
  }
  const currentPreview = preview?.draftKey === draftKey ? preview.result : null;
  const categoryCounts = {};
  for (const row of [...draft.materials, ...draft.services]) { const key = categoryOf(row.description); if (key) categoryCounts[key] = (categoryCounts[key] || 0) + 1; }
  const requiredCategories = QUICK_CATEGORIES.filter(spec => spec.key !== 'coverPrint' || (order.items || []).some(item => item.coverEnabled));
  const missingCategories = requiredCategories.filter(spec => !categoryCounts[spec.key]);
  return <section className="quote-editor" aria-label="قیمت‌گذاری مواد و خدمات" dir="rtl">
    <header><strong>قیمت‌گذاری مواد و خدمات — ریال</strong><span>نسخهٔ مبنا: {format(base.current.revision)}</span></header>
    <p>نرخ فروش روز مواد را وارد کنید؛ ارزش ریالی انبار وارد محاسبه نمی‌شود. سود فقط روی خدمات اعمال می‌شود. طبقه‌بندی مواد و خدمات قابل اصلاح است.</p>
    {locked && <p className="quote-warning" role="status">ویرایش قیمت فقط برای پیش‌فاکتور در انتظار تأیید مجاز است. سفارش تولیدی یا متوقف نیازمند مسیر بازنگری است.</p>}
    {conflict && <div className="quote-warning" role="alert">نسخهٔ سفارش یا قیمت ذخیره‌شده تغییر کرده است. پیش‌نویس شما حفظ شده؛ برای جلوگیری از بازنویسی، ذخیره غیرفعال است. ابتدا نسخهٔ جدید را بارگذاری کنید.</div>}
    {dirty && <p className="quote-warning">تغییرات این بخش هنوز ثبت نشده‌اند؛ قیمت سفارش تا ذخیره تغییر نمی‌کند. بستن این پنجره می‌تواند پیش‌نویس را از بین ببرد.</p>}
    <fieldset disabled={locked || !!busy}>
      <div className="quote-categories" aria-label="دسته‌های فاکتور">
        <div className="quote-category-list">
          {QUICK_CATEGORIES.map(spec => {
            const count = categoryCounts[spec.key] || 0;
            const required = requiredCategories.includes(spec);
            return <span key={spec.key} className={`quote-category${count ? ' is-present' : required ? ' is-missing' : ''}`}>{spec.label}: {count ? `${format(count)} ردیف` : required ? 'ثبت نشده' : 'ندارد'}</span>;
          })}
        </div>
        <div className="quote-category-actions">
          {QUICK_CATEGORIES.map(spec => <button type="button" key={spec.key} className="quote-secondary" onClick={() => quickAdd(spec)}>افزودن {spec.label}</button>)}
        </div>
        {missingCategories.length > 0 && <p className="quote-warning">دسته‌های الزامی فاکتور هنوز ردیف ندارند: {missingCategories.map(spec => spec.label).join('، ')}. با دکمه‌های بالا همان دسته را اضافه کنید.</p>}
      </div>
      {['materials', 'services'].map(group => {
        const rows = draft[group];
        const heads = [...EDITOR_INVOICE_COLUMNS.slice(0, 3), 'دسته', ...EDITOR_INVOICE_COLUMNS.slice(3, 5),
          `${EDITOR_INVOICE_COLUMNS[5]}${group === 'materials' ? ' — نرخ فروش روز' : ''} (ریال)`, `${EDITOR_INVOICE_COLUMNS[6]} (ریال)`,
          group === 'materials' ? 'مواد مشتری' : 'چاپ افست', 'حذف'];
        const columnSum = rows.reduce((total, row) => total + (Number(lineAmount(currentPreview, group, row)) || 0), 0);
        return <div className="quote-group" key={group}>
          <h3>{group === 'materials' ? 'مواد اولیه با نرخ فروش روز' : 'خدمات مشمول سود'}</h3>
          {rows.length === 0 && <p className="quote-muted">ردیفی ثبت نشده است.</p>}
          {rows.length > 0 && <div className="quote-table-scroll">
            <table className="quote-table">
              <caption>{group === 'materials' ? 'ردیف‌های مواد' : 'ردیف‌های خدمات'} — با کلیدهای جهت و Enter بین خانه‌ها جابه‌جا شوید؛ ترتیب ستون‌ها (ردیف، شناسه، شرح، مقدار، واحد، مبلغ واحد، مبلغ کل) مانند فاکتور رسمی است و تخفیف و مالیات در سطح سند اعمال می‌شوند، نه در ردیف.</caption>
              <thead><tr>{heads.map(head => <th key={head} scope="col">{head}</th>)}</tr></thead>
              <tbody>{rows.map((row, index) => {
                const stock = inventory.find(entry => entry.id === row.inventoryItemId);
                const cost = lineAmount(currentPreview, group, row);
                const nav = key => makeNavigate(group, index, key, MAIN_CELLS, rows.length);
                const subNav = key => makeNavigate(group, index, key, OFFSET_CELLS, rows.length);
                return <Fragment key={row.id}><tr>
                  <th scope="row" title={stock ? `مرجع انبار: ${stock.name}` : undefined}>{format(index + 1)}{!String(row.itemCode || '').trim() ? <small className="quote-flag">شناسه ندارد</small> : null}</th>
                  <td><input id={cellId(group, index, 'itemCode')} aria-label="شناسه کالا / خدمت (حداکثر ۱۳ رقم؛ کوتاه‌تر با صفر کامل می‌شود)" title="خالی بماند یا کد کوتاه‌تر به‌طور خودکار با صفر از چپ به ۱۳ رقم کامل شود." value={row.itemCode || ''} onChange={e => patchRow(group, row.id, { itemCode: e.target.value })} onBlur={() => patchRow(group, row.id, { itemCode: padItemCode(row.itemCode) })} onKeyDown={nav('itemCode')} inputMode="numeric" dir="ltr" maxLength={13} /></td>
                  <td><input id={cellId(group, index, 'description')} aria-label="شرح کالا یا خدمات" list={`quote-descriptions-${group}`} value={row.description || ''} onChange={e => { const value = e.target.value; const match = inventory.find(entry => entry.name === value.trim()); patchRow(group, row.id, { description: value, inventoryItemId: match?.id || row.inventoryItemId }); }} onKeyDown={nav('description')} maxLength={500} />{stock ? <small className="quote-muted"> مرجع انبار: {stock.name}</small> : null}</td>
                  <td><select aria-label="دسته" value={group} onChange={() => move(group, row)}><option value="materials">مادهٔ اولیه</option><option value="services">خدمت</option></select></td>
                  <td><input id={cellId(group, index, 'qty')} aria-label="مقدار" value={quantityDisplay(row.qty)} onChange={e => patchRow(group, row.id, { qty: digits(e.target.value) })} onKeyDown={nav('qty')} disabled={!!row.offset} inputMode="decimal" dir="ltr" /></td>
                  <td><input id={cellId(group, index, 'unit')} aria-label="واحد مبنای نرخ" value={row.unit || ''} onChange={e => patchRow(group, row.id, { unit: e.target.value })} onKeyDown={nav('unit')} maxLength={50} /></td>
                  <td>{row.offset ? <span className="quote-muted">تعرفه در خانهٔ افست</span> : <MoneyInput id={cellId(group, index, 'rate')} aria-label={heads[6]} onKeyDown={nav('rate')} value={row.customerSupplied ? '0' : row.rate} disabled={row.customerSupplied === true} onChange={rate => patchRow(group, row.id, { rate })} />}</td>
                  <td className="quote-amount" dir="ltr">{cost === undefined ? '—' : row.customerSupplied ? '۰ (تأمین مشتری)' : format(cost)}</td>
                  <td>{group === 'materials' ? <label className="quote-check"><input type="checkbox" checked={row.customerSupplied === true} onChange={e => patchRow(group, row.id, { customerSupplied: e.target.checked })} />متعلق به مشتری</label> : <label className="quote-check"><input type="checkbox" checked={!!row.offset} onChange={e => patchRow(group, row.id, { offset: e.target.checked ? { plates: '', run: '', ratePerBlock: '', blockSize: 5000, mode: '' } : undefined, qty: '1', unit: 'خدمت', rate: '' })} />حداقل بلوک کامل تا ۵۰۰۰</label>}</td>
                  <td><button type="button" className="quote-remove" onClick={() => remove(group, row.id)}>حذف</button></td>
                </tr>{row.offset && <tr><td className="quote-offset-cell" colSpan={heads.length}><div className="quote-offset">
                    {[['plates', 'تعداد زینک'], ['run', 'تیراژ چاپ هر زینک'], ['ratePerBlock', 'تعرفهٔ هر زینک تا ۵۰۰۰ — ریال']].map(([key, label]) => <label key={key} className="quote-field"><span className="psx-field-label">{label}:</span><MoneyInput id={cellId(group, index, key)} aria-label={label} onKeyDown={subNav(key)} value={row.offset[key]} onChange={value => patchRow(group, row.id, { offset: { ...row.offset, [key]: value } })} /></label>)}
                    <label className="quote-field"><span className="psx-field-label">روش محاسبه برای بالای ۵۰۰۰:</span><select id={cellId(group, index, 'mode')} aria-label="روش محاسبه برای بالای ۵۰۰۰" onKeyDown={subNav('mode')} value={row.offset.mode || ''} onChange={e => patchRow(group, row.id, { offset: { ...row.offset, mode: e.target.value } })}><option value="">انتخاب نشده؛ تا ۵۰۰۰ لازم نیست</option><option value="ceilBlocks">دورهای کامل ۵۰۰۰تایی</option><option value="proportional">تناسب کل تیراژ پس از حداقل</option></select></label>
                  </div></td></tr>}
                </Fragment>;
              })}</tbody>
              <tfoot><tr><th scope="row">جمع</th><td colSpan={6}>جمع ستون مبلغ کل از پاسخ محاسبهٔ بک‌اند؛ پیش از تخفیف، سود خدمات و مالیات.</td><td className="quote-amount" dir="ltr">{currentPreview ? format(columnSum) : '—'}</td><td colSpan={2} /></tr></tfoot>
            </table>
            <datalist id={`quote-descriptions-${group}`}>{suggestions.map(text => <option key={text} value={text} />)}</datalist>
          </div>}
          <button type="button" className="quote-secondary" onClick={() => patch({ [group]: [...rows, group === 'materials' ? material() : service()] })}>افزودن {group === 'materials' ? 'ماده' : 'خدمت'}</button>
        </div>;
      })}
      <div className="quote-group"><h3>آفر رایگان برای مشتری</h3>
        {draft.offers.length > 0 && <div className="quote-table-scroll"><table className="quote-table">
          <caption>آفر از مشتری دریافت نمی‌شود؛ هزینهٔ داخلی جدا از جمع کل نگه داشته می‌شود.</caption>
          <thead><tr>{['ردیف', 'شرح آفر', 'هزینهٔ واقعی داخلی — ریال؛ خالی یعنی نامشخص', 'قابل دریافت از مشتری', 'حذف'].map(head => <th key={head} scope="col">{head}</th>)}</tr></thead>
          <tbody>{draft.offers.map((row, index) => <tr key={row.id}><th scope="row">{format(index + 1)}</th><td><input id={cellId('offers', index, 'description')} aria-label="شرح آفر" value={row.description || ''} onChange={e => patchRow('offers', row.id, { description: e.target.value })} maxLength={500} /></td><td><MoneyInput aria-label="هزینهٔ داخلی (ریال)" value={row.internalCost} onChange={internalCost => patchRow('offers', row.id, { internalCost })} /></td><td className="quote-amount">صفر</td><td><button type="button" className="quote-remove" onClick={() => remove('offers', row.id)}>حذف</button></td></tr>)}</tbody>
        </table></div>}
        <button type="button" className="quote-secondary" onClick={() => patch({ offers: [...draft.offers, offer()] })}>افزودن آفر</button>
      </div>
      <div className="quote-grid quote-parameters"><Field label="حالت قرارداد؛ مبنای فاکتور تحویلی"><select aria-label="حالت قرارداد" value={draft.contractMode || CONTRACT_MODES[0]} onChange={e => patch({ contractMode: e.target.value })}>{CONTRACT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}</select></Field><Field label="درصد سود فقط خدمات"><NumberInput value={draft.serviceMarkupPercent} onChange={serviceMarkupPercent => patch({ serviceMarkupPercent })} /></Field><Field label="درصد مالیات؛ نرخ قانونی را مسئول مالی تعیین می‌کند"><NumberInput value={draft.taxPercent} onChange={taxPercent => patch({ taxPercent })} /></Field><Field label="تخفیف — ریال"><MoneyInput value={draft.discount} onChange={discount => patch({ discount })} /></Field></div>
      {/* تصمیم کارفرما: حالت قرارداد از پیش‌فاکتور خوانده می‌شود، نه از سفارشِ باز. */}
      <p className="quote-muted">حالت قرارداد: در «ثابت» تحویلِ بیشتر از سفارش ریالی اضافه نمی‌سازد؛ در «تعداد واقعی» هر نسخهٔ تحویلی نرخِ خودش را دارد. ردیف‌های ثابت (زینک، کاغذِ ورق، جلدِ ورق) یک‌بار طلب می‌شوند و در فاکتور بعدی تکرار نمی‌شوند. عوض‌کردن این خانه نسخهٔ تازهٔ پیش‌فاکتور و تأیید دوبارهٔ مشتری را می‌خواهد.</p>
    </fieldset>
    {error && <p className="quote-error" role="alert">{error}</p>}
    {message && <p className="quote-success" role="status">{message}</p>}
    {currentPreview && <><strong>پیش‌نمایش محاسبه؛ ثبت نهایی فقط با دکمهٔ ذخیره</strong><Summary result={currentPreview} /></>}
    {!currentPreview && preview && <p className="quote-muted">پس از تغییر داده‌ها، پیش‌نمایش قبلی معتبر نیست؛ دوباره محاسبه کنید.</p>}
    {!preview && order.pricing?.result && <><strong>محاسبهٔ ذخیره‌شده</strong><Summary result={order.pricing.result} /></>}
    <div className="quote-actions"><button type="button" disabled={locked || !!busy} onClick={calculate}>{busy === 'preview' ? 'در حال محاسبه…' : 'محاسبه و پیش‌نمایش'}</button><button type="button" disabled={locked || !!busy || conflict || !currentPreview || savedPreviewKey === draftKey} onClick={save}>{busy === 'save' ? 'در حال ذخیره…' : 'ذخیرهٔ قیمت محاسبه‌شده'}</button><button type="button" className="quote-secondary" disabled={!!busy} onClick={() => dirty ? setResetRequested(true) : reset()}>بارگذاری نسخهٔ ذخیره‌شده</button></div>
    {resetRequested && <div className="quote-warning" role="alert"><p>پیش‌نویس ذخیره‌نشده کنار گذاشته شود و نسخهٔ فعلی سفارش بارگذاری شود؟</p><div className="quote-actions"><button type="button" onClick={reset}>بله، بارگذاری نسخهٔ ذخیره‌شده</button><button type="button" className="quote-secondary" onClick={() => setResetRequested(false)}>حفظ پیش‌نویس</button></div></div>}
  </section>;
}

export default QuoteEditor;
