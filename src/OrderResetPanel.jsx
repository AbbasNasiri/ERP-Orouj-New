import { useRef, useState } from 'react';
import './OrderResetPanel.css';

const labels = { orders: 'سفارش و درخواست قدیمی', documents: 'سند مالی وابسته', events: 'رویداد سفارش', notifications: 'اعلان مرتبط با سفارش' };

export default function OrderResetPanel({ onPreview, onReset }) {
  const [preview, setPreview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const busy = useRef(false);
  async function inspect() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); setPreview(null); setConfirmation(''); setAcknowledged(false); setResult(null);
    try {
      const next = await onPreview?.();
      if (!next?.ok) throw new Error(next?.error || 'بررسی پاکسازی در دسترس نیست.');
      setPreview(next);
    } catch (failure) { setError(failure.message || 'بررسی پاکسازی انجام نشد.'); }
    finally { busy.current = false; setPending(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || !preview || !acknowledged || confirmation !== preview.confirmationPhrase || reason.trim().length < 8) return;
    busy.current = true; setPending(true); setError('');
    try {
      const next = await onReset?.({ previewToken: preview.previewToken, expectedCount: preview.expectedCount, confirmation, reason: reason.trim() });
      if (!next?.ok) throw new Error(next?.error || 'پاکسازی انجام نشد.');
      setResult(next); setPreview(null); setConfirmation(''); setAcknowledged(false);
    } catch (failure) {
      setError(failure.message || 'پاکسازی انجام نشد.');
      setPreview(null); setConfirmation(''); setAcknowledged(false);
    } finally { busy.current = false; setPending(false); }
  }
  const valid = preview && acknowledged && confirmation === preview.confirmationPhrase && reason.trim().length >= 8;
  return <section className="order-reset-panel" dir="rtl" aria-labelledby="order-reset-title">
    <h2 id="order-reset-title">پاکسازی سفارش‌های آزمایشی</h2>
    <p>این ابزار نگهداری فقط در اختیار مدیر چاپخانه است. همه سفارش‌ها و درخواست‌ها، بایگانی سفارش و اسناد مالی و اعلان‌های وابسته پاک می‌شوند؛ انتخاب چند سفارش در این ابزار وجود ندارد.</p>
    <div className="order-reset-warning">
      <strong>این عملیات برای شروع دوباره آزمون برنامه است.</strong>
      <p>حذف عادی فاکتور قطعی مجاز نمی‌شود. اطلاعات مشتریان، موجودی و گردش انبار، رسیدها، تأمین‌کنندگان، کاربران، تنظیمات و پرداخت بازاریاب‌ها حفظ می‌شوند. مواد مصرف‌شده به انبار برنمی‌گردند؛ سوابق حفظ‌شده ممکن است به شماره سفارش پاک‌شده ارجاع داشته باشند.</p>
      <p>پیش از حذف، پشتیبان کامل بانک ساخته می‌شود. اگر پشتیبان ساخته نشود، حذف انجام نمی‌شود. شماره‌های استفاده‌شده حفظ می‌شوند. پس از موفقیت، همه کاربران باید دوباره وارد شوند.</p>
    </div>
    <button type="button" onClick={inspect} disabled={pending || !onPreview}>{pending ? 'در حال بررسی…' : 'بررسی تعداد و آماده‌سازی تأیید'}</button>
    {error && <p className="order-reset-error" role="alert">{error}</p>}
    {result && <div role="status"><p>پاکسازی انجام شد. برای ادامه دوباره وارد شوید.</p><p>پشتیبان پیش از پاکسازی: <bdi className="order-reset-backup">{result.backupFile}</bdi></p></div>}
    {preview && <form onSubmit={submit}>
      <dl>{Object.entries(labels).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Number(preview.counts?.[key] || 0).toLocaleString('fa-IR')}</dd></div>)}</dl>
      <p>این بررسی پنج دقیقه اعتبار دارد؛ تغییر داده‌ها نیاز به بررسی مجدد دارد.</p>
      <label>دلیل پاکسازی (حداقل ۸ کاراکتر):<textarea value={reason} maxLength={1000} disabled={pending} onChange={event => setReason(event.target.value)} /></label>
      <label className="order-reset-ack"><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} /><span>دامنه پاکسازی و حفظ موجودی فعلی انبار را خواندم و داده‌ها برای آزمون هستند.</span></label>
      <label>برای تأیید، عبارت «{preview.confirmationPhrase}» را دقیق وارد کنید:<input value={confirmation} autoComplete="off" disabled={pending} onChange={event => setConfirmation(event.target.value)} /></label>
      <button className="order-reset-submit" type="submit" disabled={!valid || pending || !onReset}>{pending ? 'در حال پشتیبان‌گیری و پاکسازی…' : 'ساخت پشتیبان و پاکسازی همه سفارش‌های آزمایشی'}</button>
    </form>}
  </section>;
}
