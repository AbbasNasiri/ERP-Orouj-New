import { Fragment, useEffect, useRef, useState } from 'react';
import { catalogSchemas, catalogSheets, readCatalogWorkbookDetails } from './catalog-workbook.mjs';
import { saveWorkbook } from './excel.js';
import './catalog-transfer.css';

const TEXT_KEYS = new Set(['id', 'ownerCustomerId', 'nationalCode', 'nationalId', 'registerNo', 'economicCode', 'postalCode', 'phone', 'mobile', 'repPhone']);
const fa = value => Number(value).toLocaleString('fa-IR');
const HELP = {
  customers: 'نام هر ردیف الزامی است. مشتری واردشده تا تأیید مدیر در فهرست کاری نمی‌آید و برای ثبت سفارش قابل استفاده نیست.',
  suppliers: 'نام هر ردیف الزامی است. تأمین‌کنندهٔ واردشده تا تأیید مدیر در فهرست کاری نمی‌آید.',
  inventory: 'شرح، دسته، مالک و نوع موجودی هر ردیف الزامی است. موجودی اولیهٔ هر قلم یک گردش «ورود» می‌سازد. برای کالای امانی مشتری، مشتری مالک باید از قبل در بانک مشتریان باشد و شناسه‌اش همین‌جا وارد شود.',
};

export default function CatalogTransfer({ data = {}, onImport, role = '', initialDataset = 'customers' }) {
  const allowed = Object.entries(catalogSchemas).filter(([, spec]) => (spec.writeRoles || []).includes(role)).map(([key]) => key);
  const first = allowed.includes(initialDataset) ? initialDataset : (allowed[0] || '');
  const [dataset, setDataset] = useState(first), [rows, setRows] = useState([]), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null), [ack, setAck] = useState(false);
  const [details, setDetails] = useState(null), [fileName, setFileName] = useState('');
  const generation = useRef(0), inFlight = useRef(false), fileRef = useRef(null), timer = useRef(null);
  const schema = catalogSchemas[dataset] || { fields: [] };
  const errorsByRow = new Map((preview?.errors || []).map(item => [Number(item.row) - 2, item.error]));
  const numericIds = rows.some(row => schema.fields.some(([key]) => TEXT_KEYS.has(key) && typeof row[key] === 'number'));

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(value) {
    generation.current++; clearTimeout(timer.current);
    setDataset(value); setRows([]); setPreview(null); setError(''); setResult(null); setAck(false);
    setDetails(null); setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function reset() {
    change(dataset);
  }

  async function validate(next) {
    const scope = ++generation.current;
    inFlight.current = true; setBusy(true);
    try {
      const response = await onImport(dataset, next, { commit: false });
      if (scope !== generation.current) return;
      setPreview(response);
      setAck(false);
      if (!response?.ok && response?.code !== 'VALIDATION_FAILED') setError(response?.error || 'بررسی فایل انجام نشد.');
      else setError('');
    } catch (failure) { if (scope === generation.current) { setPreview(null); setError(failure.message); } }
    finally { if (scope === generation.current) { inFlight.current = false; setBusy(false); } }
  }

  function recheck(next) {
    setRows(next); setPreview(null); setAck(false); setResult(null); setError('');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => validate(next), 450);
  }

  function edit(index, key, value) {
    recheck(rows.map((row, position) => position === index ? { ...row, [key]: value } : row));
  }

  function addRow() {
    recheck([...rows, Object.fromEntries(schema.fields.map(([key]) => [key, '']))]);
  }

  function removeRow(index) {
    recheck(rows.filter((_, position) => position !== index));
  }

  async function choose(file) {
    if (!file || inFlight.current) return;
    const scope = ++generation.current;
    inFlight.current = true; setBusy(true); setError(''); setPreview(null); setRows([]); setResult(null); setAck(false); setDetails(null);
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) throw new Error('فایل XLSX کمتر از ۵ مگابایت انتخاب کنید.');
      const parsed = readCatalogWorkbookDetails(await file.arrayBuffer(), dataset);
      if (scope !== generation.current) return;
      setRows(parsed.rows); setFileName(file.name); setDetails(parsed);
      inFlight.current = false;
      await validate(parsed.rows);
    } catch (failure) { if (scope === generation.current) setError(failure.message); }
    finally { if (scope === generation.current) { inFlight.current = false; setBusy(false); } if (fileRef.current) fileRef.current.value = ''; }
  }

  async function commit() {
    if (inFlight.current || !ack || !preview?.ok || busy) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const next = await onImport(dataset, rows, { commit: true, fingerprint: preview.fingerprint });
      if (!next?.ok) throw new Error(next?.error || 'ورود اطلاعات انجام نشد.');
      setResult(next); setRows([]); setPreview(null); setAck(false);
    } catch (failure) { setError(failure.message); setPreview(null); setAck(false); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function download(template) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { const next = await saveWorkbook(`${template ? 'قالب' : 'اطلاعات'}-${schema.label}.xlsx`, catalogSheets(dataset, template ? [] : data[dataset] || [])); if (!next?.ok && !next?.canceled) throw new Error('خروجی ذخیره نشد.'); }
    catch (failure) { setError(failure.message); } finally { inFlight.current = false; setBusy(false); }
  }

  function jumpToError(item) {
    const row = document.getElementById(`catalog-row-${Number(item.row) - 2}`);
    const label = String(item.error || '').split(':')[0].trim();
    const column = schema.fields.findIndex(([, name]) => name === label);
    row?.scrollIntoView({ block: 'center' });
    const inputs = row?.querySelectorAll('input');
    (column >= 0 ? inputs?.[column] : inputs?.[0])?.focus();
  }

  const step = result ? 4 : preview?.ok ? 3 : rows.length ? 2 : 1;
  const stepClass = index => `catalog-step${step === index ? ' is-current' : step > index ? ' is-done' : ''}`;

  if (!allowed.length) return <section className="catalog-transfer" dir="rtl">
    <header><h2>ورود اطلاعات از اکسل</h2><p>برای نقش شما ورود اطلاعات پایه باز نیست. برای این کار با مدیر چاپخانه هماهنگ کنید.</p></header>
  </section>;

  return <section className="catalog-transfer" dir="rtl">
    <header>
      <h2>ورود اطلاعات از اکسل</h2>
      <p>فایل XLSX سیستم قدیم را انتخاب کنید. ردیف‌ها همین‌جا خوانده می‌شوند، هر خانه را می‌توانید اصلاح کنید و تا دکمهٔ ثبت را نزنید هیچ چیزی در بانک اطلاعاتی نوشته نمی‌شود. ورود فقط ردیف جدید می‌افزاید؛ اطلاعات قبلی جایگزین یا حذف نمی‌شود.</p>
    </header>
    <ol className="catalog-steps">
      <li className={stepClass(1)}>۱. بخش و فایل</li>
      <li className={stepClass(2)}>۲. بررسی و اصلاح</li>
      <li className={stepClass(3)}>۳. ثبت در بانک</li>
      <li className={stepClass(4)}>۴. نتیجه</li>
    </ol>
    <div className="catalog-transfer-toolbar">
      <label>بخش:
        <select value={dataset} disabled={busy} onChange={event => change(event.target.value)}>
          {allowed.map(key => <option key={key} value={key}>{catalogSchemas[key].label}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={() => download(true)}>دریافت قالب خالی</button>
      <button type="button" disabled={busy} onClick={() => download(false)}>خروجی فهرست فعلی</button>
      <label className="catalog-file">انتخاب فایل XLSX<input ref={fileRef} type="file" accept=".xlsx" disabled={busy} onChange={event => choose(event.target.files?.[0])}/></label>
    </div>
    <p className="catalog-help">{HELP[dataset]}</p>
    <p className="catalog-help">این خروجی شامل اسناد مالی، مانده حساب، تاریخچهٔ گردش‌ها و کد مشتری صادرشده نیست؛ پشتیبان کامل از بخش نگهداری بانک تهیه می‌شود.</p>
    {details && <div className="catalog-fileinfo">
      <strong>فایل «{fileName}» خوانده شد.</strong>
      <span>شیت «{details.sheet}»، سرسطر در ردیف {details.headerRow.toLocaleString('fa-IR')}، {details.recognized.length.toLocaleString('fa-IR')} ستون شناسایی شد.</span>
      {details.missing.length > 0 && <span>ستون‌های غایب: {details.missing.join('، ')} — خانه‌هایشان خالی است و باید در جدول پایین پر شوند.</span>}
      {details.ignored.length > 0 && <span>ستون‌های نادیده‌گرفته‌شده: {details.ignored.join('، ')} — به آن‌ها نوشته نمی‌شود.</span>}
    </div>}
    {busy && <p role="status">در حال بررسی یا ذخیره…</p>}
    {error && <p className="catalog-error" role="alert">{error}</p>}
    {preview && !preview.ok && <p className="catalog-error" role="alert">{preview.errors?.length ? `${preview.errors.length.toLocaleString('fa-IR')} ردیف ایراد دارد؛ هر خانه را در جدول زیر اصلاح کنید.` : (preview.error || 'بررسی انجام نشد.')}</p>}
    {rows.length > 0 && <div className="catalog-editor">
      <div className="catalog-editor-head">
        <strong>اصلاح در همین فرم — {rows.length.toLocaleString('fa-IR')} ردیف{preview && !preview.ok && preview.errors?.length ? `، ${preview.errors.length.toLocaleString('fa-IR')} ایراد` : ''}</strong>
        <div className="catalog-editor-actions">
          {preview && !preview.ok && preview.errors?.length > 0 && <button type="button" disabled={busy} onClick={() => jumpToError(preview.errors[0])}>رفتن به اولین ایراد</button>}
          <button type="button" disabled={busy || rows.length >= 2000} onClick={addRow}>افزودن ردیف</button>
          <button type="button" disabled={busy} onClick={reset}>شروع دوباره</button>
        </div>
      </div>
      <p className="catalog-hint">هر خانه را می‌توانید همین‌جا اصلاح کنید؛ بعد از هر تغییر، همان ردیف‌ها دوباره در سرور بررسی می‌شوند. شناسه و تلفن باید متن باشند: اگر اکسل شماره را عدد ذخیره کرده، همان عدد را ببینید و شماره را با صفر ابتدای آن دوباره تایپ کنید. ستون خالی در فایل هم در همین جدول قابل تکمیل است.</p>
      {numericIds && <p className="catalog-warning">برخی شناسه‌ها یا شماره‌ها در اکسل به‌صورت عدد ذخیره شده‌اند. ابتدای شماره‌ها را با صفر دوباره تایپ کنید؛ تبدیل خودکار ممکن است صفر ابتدای شماره را برنگرداند.</p>}
      <div className="catalog-grid-scroll">
        <table className="catalog-grid">
          <caption>همه ستون‌ها؛ ردیف‌های دارای ایراد با رنگ مشخص شده‌اند.</caption>
          <thead><tr><th scope="col">ردیف</th>{schema.fields.map(([key, label]) => <th key={key} scope="col">{label}</th>)}<th scope="col">حذف</th></tr></thead>
          <tbody>{rows.map((row, index) => {
            const problem = errorsByRow.get(index);
            return <Fragment key={index}>
              <tr id={`catalog-row-${index}`} className={problem ? 'catalog-row-error' : ''}>
                <th scope="row">{fa(index + 1)}</th>
                {schema.fields.map(([key, label, type]) => <td key={key}><input aria-label={`${label} ردیف ${fa(index + 1)}`} dir={TEXT_KEYS.has(key) ? 'ltr' : 'auto'} inputMode={type === 'number' ? 'decimal' : undefined} value={String(row[key] ?? '')} onChange={event => edit(index, key, event.target.value)} /></td>)}
                <td><button type="button" className="catalog-remove" disabled={busy} onClick={() => removeRow(index)}>حذف</button></td>
              </tr>
              {problem && <tr className="catalog-row-error"><td colSpan={schema.fields.length + 2}>ردیف {fa(index + 1)}: {problem}</td></tr>}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
    </div>}
    {preview?.ok && <div className="catalog-confirm">
      <label><input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)}/>افزودن {preview.count.toLocaleString('fa-IR')} ردیف جدید را تأیید می‌کنم.</label>
      <button type="button" disabled={busy || !ack} onClick={commit}>پشتیبان‌گیری و ثبت در بانک اطلاعاتی</button>
    </div>}
    {preview?.ok && <p className="catalog-help">پس از ثبت، {dataset === 'inventory' ? 'هر قلم با گردش موجودی اولیه در انبار ثبت می‌شود' : `ردیف‌ها در فهرست «${schema.label}» با وضعیت «در انتظار بررسی» می‌مانند تا مدیر تأیید کند`}. پیش از نوشتن، یک نسخهٔ پشتیبان کامل خودکار ساخته می‌شود.</p>}
    {result?.ok && <div className="catalog-result" role="status">
      <strong>{result.count.toLocaleString('fa-IR')} ردیف در «{schema.label}» ثبت شد.</strong>
      <p>پشتیبان پیش از ورود: <bdi>{result.backupFile}</bdi></p>
      <button type="button" disabled={busy} onClick={reset}>ورود فایل دیگر</button>
    </div>}
  </section>;
}
