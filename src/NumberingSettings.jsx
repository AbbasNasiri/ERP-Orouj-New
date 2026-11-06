import { useEffect, useRef, useState } from 'react';
import { faDigits } from './smart.js';
import './document-panels.css';

const LABELS = { order: 'سفارش', quote: 'پیش‌فاکتور', invoice: 'فاکتور', statement: 'صورت‌حساب', letter: 'نامه', receipt: 'رسید', stockmovement: 'گردش انبار', consignmentreceipt: 'رسید امانت', moneyreceipt: 'رسید وجه' };
const digits = value => String(value).replace(/[۰-۹]/g, item => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(item))).replace(/[٠-٩]/g, item => String('٠١٢٣٤٥٦٧٨٩'.indexOf(item)));
function positiveInteger(value, label, max = Number.MAX_SAFE_INTEGER, min = 1) {
  const raw = digits(value).trim();
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) throw new Error(min === 0 ? `${label} باید عدد صحیح بین ۰ و ۱۲ باشد.` : `${label} باید عدد صحیح مثبت باشد.`);
  return Number(raw);
}
function normalized(settings, original) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('تنظیمات شماره‌گذاری معتبر نیست.');
  return Object.fromEntries(Object.entries(LABELS).map(([key, name]) => {
    const row = settings[key];
    if (!row || typeof row.prefix !== 'string' || row.prefix.length > 30 || /[\x00-\x1f\x7f]/.test(row.prefix) || typeof row.enabled !== 'boolean') throw new Error(`تنظیمات ${name} معتبر نیست.`);
    const start = positiveInteger(row.start, `شماره شروع ${name}`);
    const next = positiveInteger(row.next, `شماره بعدی ${name}`);
    const width = positiveInteger(row.width, `تعداد رقم ${name}`, 12, 0);
    if (next < start) throw new Error(`شماره بعدی ${name} نباید کمتر از شماره شروع باشد.`);
    if (original && next < Number(original[key].next)) throw new Error(`شماره بعدی ${name} نباید به عقب برگردد.`);
    return [key, { prefix: row.prefix, start, next, width, enabled: row.enabled }];
  }));
}

export default function NumberingSettings({ onLoad, onSave }) {
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const generation = useRef(0);

  async function load() {
    if (busy.current) return;
    if (typeof onLoad !== 'function') { setError('دریافت تنظیمات در دسترس نیست.'); return; }
    const request = ++generation.current;
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await onLoad();
      if (!result?.ok) throw new Error(result?.error || 'تنظیمات دریافت نشد.');
      const next = normalized(result.settings);
      if (request === generation.current) { setDraft(next); setBaseline(next); }
    } catch (failure) { if (request === generation.current) setError(failure?.message || 'تنظیمات دریافت نشد.'); }
    finally { if (request === generation.current) { busy.current = false; setPending(false); } }
  }

  useEffect(() => { load(); return () => { generation.current++; }; }, []);

  function change(key, field, value) {
    if (busy.current) return;
    setDraft(current => ({ ...current, [key]: { ...current[key], [field]: value } }));
    setMessage('');
  }

  async function save(event) {
    event?.preventDefault();
    if (busy.current || !draft || !baseline) return;
    if (typeof onSave !== 'function') { setError('ذخیره تنظیمات در دسترس نیست.'); return; }
    let settings;
    try { settings = normalized(draft, baseline); } catch (failure) { setError(failure.message); return; }
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await onSave(settings);
      if (!result?.ok) throw new Error(result?.error || 'تنظیمات ذخیره نشد.');
      // The returned server settings are authoritative, including concurrently
      // allocated counters. Never fabricate a successful counter increment here.
      if (!result.settings) throw new Error('ذخیره تأیید شد؛ تنظیمات نهایی دریافت نشد. بررسی مجدد را بزنید.');
      const next = normalized(result.settings);
      setDraft(next); setBaseline(next); setMessage('تنظیمات شماره‌گذاری ذخیره شد.');
    } catch (failure) { setError(failure?.message || 'تنظیمات ذخیره نشد؛ دوباره تلاش کنید.'); }
    finally { busy.current = false; setPending(false); }
  }

  return <section className="document-panel" dir="rtl">
    <header className="document-heading"><div><h2>شماره‌گذاری اسناد</h2><p>پیشوند و مسیر شماره‌گذاری هر نوع سند را مستقل تنظیم کنید.</p></div>
      <button type="button" className="document-secondary" onClick={load} disabled={pending || !onLoad}>بررسی مجدد</button>
    </header>
    <p className="document-footnote">شماره بعدی فقط می‌تواند افزایش پیدا کند. شماره‌های قبلاً صادرشده و سابقه اسناد با تغییر این تنظیمات بازنویسی نمی‌شوند.</p>
    {error && <div role="alert" className="document-error">{error}</div>}
    {message && <div role="status" className="document-success">{message}</div>}
    {!draft ? <p role="status">{pending ? 'در حال دریافت تنظیمات…' : 'برای نمایش تنظیمات، بررسی مجدد را بزنید.'}</p> : <form onSubmit={save}>
      <fieldset disabled={pending}>
        <div className="document-table-wrap numbering-grid"><table><thead><tr><th>نوع سند</th><th>پیشوند</th><th>شماره شروع</th><th>شماره بعدی</th><th>تعداد رقم</th><th>فعال</th><th>نمونه شماره بعدی</th></tr></thead><tbody>
          {Object.entries(LABELS).map(([key, name]) => <tr key={key}>
            <td>{name}</td>
            <td><input aria-label={`پیشوند ${name}`} name={`${key}-prefix`} value={draft[key].prefix} maxLength={30} onChange={event => change(key, 'prefix', event.target.value)} /></td>
            <td><input aria-label={`شماره شروع ${name}`} name={`${key}-start`} inputMode="numeric" value={draft[key].start} onChange={event => change(key, 'start', event.target.value)} /></td>
            <td><input aria-label={`شماره بعدی ${name}`} name={`${key}-next`} inputMode="numeric" value={draft[key].next} onChange={event => change(key, 'next', event.target.value)} /></td>
            <td><input aria-label={`تعداد رقم ${name}`} name={`${key}-width`} inputMode="numeric" value={draft[key].width} onChange={event => change(key, 'width', event.target.value)} /></td>
            <td><input aria-label={`فعال بودن ${name}`} name={`${key}-enabled`} type="checkbox" checked={draft[key].enabled} onChange={event => change(key, 'enabled', event.target.checked)} /></td>
            <td><bdi>{faDigits(`${draft[key].prefix}${digits(draft[key].next).padStart(Math.max(0, Math.min(Number(digits(draft[key].width)) || 0, 12)), '0')}`)}</bdi></td>
          </tr>)}
        </tbody></table></div>
        <div className="document-actions" style={{ marginTop: 16 }}><button type="submit" disabled={pending || !onSave}>{pending ? 'در حال ذخیره…' : 'ذخیره شماره‌گذاری'}</button></div>
      </fieldset>
    </form>}
  </section>;
}
