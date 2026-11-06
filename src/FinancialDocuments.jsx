import { useEffect, useRef, useState } from 'react';
import { faDigits } from './smart.js';
import DeliveryInvoicePanel from './DeliveryInvoicePanel.jsx';
import './document-panels.css';

const TYPES = { quote: 'پیش‌فاکتور', invoice: 'فاکتور', statement: 'صورت‌حساب' };
/* شمارهٔ سند سرور لاتین می‌ماند؛ فقط دیدن فارسی است (بند ۳/۶). */
const showNumber = value => (value ? faDigits(value) : '—');
function dateLabel(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString('fa-IR') : '—';
}

export default function FinancialDocuments({ documents = [], orders = [], documentType, onIssue, onVoid, onRefresh, onPrint, onProposal, onIssuePartial }) {
  const fixedType = Object.hasOwn(TYPES, documentType) ? documentType : null;
  const [tab, setTab] = useState('issued');
  const [orderId, setOrderId] = useState('');
  const [type, setType] = useState(fixedType || 'quote');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [voidId, setVoidId] = useState(null);
  const [reason, setReason] = useState('');
  const busy = useRef(false);
  const selectedType = fixedType || type;
  const scopedDocuments = fixedType ? documents.filter(document => document.type === fixedType) : documents;
  const issued = scopedDocuments.filter(document => document.status === 'issued');
  const voided = scopedDocuments.filter(document => document.status === 'void');
  const visible = tab === 'issued' ? issued : voided;
  useEffect(() => { setMessage(''); setError(''); setVoidId(null); setReason(''); }, [fixedType]);

  async function refreshAfterChange() {
    if (typeof onRefresh !== 'function') return;
    try {
      const result = await onRefresh();
      if (result?.ok === false) throw new Error(result.error || 'فهرست اسناد به‌روز نشد.');
    } catch (_) { setError('عملیات ثبت شد؛ دریافت فهرست تازه انجام نشد. بررسی مجدد را بزنید.'); }
  }

  async function issue(event) {
    event?.preventDefault();
    if (busy.current) return;
    if (!orderId || !orders.some(order => order.id === orderId)) { setError('سفارش مرتبط را انتخاب کنید.'); return; }
    if (!Object.hasOwn(TYPES, selectedType)) { setError('نوع سند معتبر نیست.'); return; }
    if (typeof onIssue !== 'function') { setError('امکان صدور سند در دسترس نیست.'); return; }
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await onIssue(orderId, selectedType);
      if (!result?.ok) throw new Error(result?.error || 'سند صادر نشد.');
      const number = result.document?.number;
      const wasVoided = result.document?.status === 'void';
      setMessage(wasVoided ? `سند${number ? ` با شماره ${showNumber(number)}` : ''} قبلاً باطل شده است؛ سند تازه‌ای صادر نشد.`
        : number ? `${TYPES[selectedType]} با شماره ${showNumber(number)} ${result.idempotent ? 'قبلاً صادر شده است' : 'صادر شد'}.` : 'سند صادر شد؛ فهرست را برای مشاهده شماره بررسی کنید.');
      setOrderId(''); setTab(wasVoided ? 'void' : 'issued');
      await refreshAfterChange();
    } catch (failure) { setError(failure?.message || 'صدور سند انجام نشد؛ دوباره تلاش کنید.'); }
    finally { busy.current = false; setPending(false); }
  }

  async function voidDocument(event) {
    event?.preventDefault();
    if (busy.current) return;
    if (!reason.trim()) { setError('دلیل ابطال را وارد کنید.'); return; }
    if (reason.trim().length > 1000) { setError('دلیل ابطال نباید بیش از ۱۰۰۰ نویسه باشد.'); return; }
    if (!issued.some(document => document.id === voidId)) { setError('این سند برای ابطال در دسترس نیست؛ فهرست را تازه کنید.'); return; }
    if (typeof onVoid !== 'function') { setError('امکان ابطال سند در دسترس نیست.'); return; }
    busy.current = true; setPending(true); setError(''); setMessage('');
    try {
      const result = await onVoid(voidId, reason.trim());
      if (!result?.ok) throw new Error(result?.error || 'سند باطل نشد.');
      setMessage('سند باطل شد و سابقه شماره آن حفظ می‌شود.'); setVoidId(null); setReason('');
      await refreshAfterChange();
    } catch (failure) { setError(failure?.message || 'ابطال سند انجام نشد؛ دوباره تلاش کنید.'); }
    finally { busy.current = false; setPending(false); }
  }

  async function refresh() {
    if (busy.current || typeof onRefresh !== 'function') return;
    busy.current = true; setPending(true); setError('');
    try {
      const result = await onRefresh();
      if (result?.ok === false) throw new Error(result.error || 'فهرست اسناد دریافت نشد.');
    } catch (failure) { setError(failure?.message || 'فهرست اسناد دریافت نشد.'); }
    finally { busy.current = false; setPending(false); }
  }

  async function print(document) {
    if (typeof onPrint !== 'function' || pending || document.status !== 'issued') return;
    try { await onPrint(document); } catch (failure) { setError(failure?.message || 'نمایش چاپ انجام نشد.'); }
  }

  return <section className="document-panel" dir="rtl">
    <header className="document-heading"><div><h2>{fixedType ? `${TYPES[fixedType]}‌ها` : 'اسناد مالی'}</h2><p>هر سند شماره مستقل دارد و به سفارش و نسخه پیش‌فاکتور ارجاع می‌دهد.</p></div>
      <button className="document-secondary" type="button" onClick={refresh} disabled={pending || !onRefresh}>بررسی مجدد</button>
    </header>
    <form className="document-issue" onSubmit={issue}>
      <h3>صدور سند جدید</h3>
      <fieldset disabled={pending} className="document-fields">
        <label>سفارش مرتبط<select name="documentOrder" value={orderId} onChange={event => setOrderId(event.target.value)}><option value="">انتخاب سفارش…</option>
          {orders.map(order => <option key={order.id} value={order.id}>{order.orderNumber} — {order.customerName || order.title || 'بدون عنوان'}</option>)}
        </select></label>
        <label>نوع سند<select name="documentType" value={selectedType} onChange={event => { if (!fixedType) setType(event.target.value); }}>{Object.entries(TYPES).filter(([key]) => !fixedType || key === fixedType).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <button type="submit" disabled={pending || !onIssue}>{pending ? 'در حال انجام…' : 'صدور سند'}</button>
      </fieldset>
    </form>
    {error && <div className="document-error" role="alert">{error}</div>}
    {message && <div className="document-success" role="status">{message}</div>}
    {selectedType === 'invoice' && typeof onProposal === 'function' && <DeliveryInvoicePanel orders={orders} onProposal={onProposal} onIssuePartial={onIssuePartial} onRefresh={onRefresh} />}
    <div className="document-tabs" aria-label="وضعیت اسناد">
      <button type="button" className={tab === 'issued' ? 'document-active' : 'document-secondary'} aria-pressed={tab === 'issued'} onClick={() => setTab('issued')}>صادرشده ({issued.length.toLocaleString('fa-IR')})</button>
      <button type="button" className={tab === 'void' ? 'document-active' : 'document-secondary'} aria-pressed={tab === 'void'} onClick={() => setTab('void')}>باطل‌شده ({voided.length.toLocaleString('fa-IR')})</button>
    </div>
    <div className="document-table-wrap"><table><thead><tr><th>شماره سند</th><th>نوع</th><th>شماره سفارش</th><th>نسخه پیش‌فاکتور</th><th>تاریخ صدور</th><th>وضعیت</th><th>اقدام</th></tr></thead><tbody>
      {visible.map(document => <tr key={document.id}>
        <td><strong><bdi>{showNumber(document.number)}</bdi></strong></td><td>{TYPES[document.type] || 'سند'}</td>
        <td><bdi>{document.orderNumber || '—'}</bdi></td><td>{Number.isSafeInteger(document.quoteRevision) ? document.quoteRevision.toLocaleString('fa-IR') : '—'}</td>
        <td>{dateLabel(document.createdAt)}</td><td><span className={`document-badge ${document.status === 'void' ? 'document-void' : ''}`}>{document.status === 'void' ? 'باطل‌شده' : 'صادرشده'}</span></td>
        <td><div className="document-actions"><button type="button" className="document-secondary" disabled={pending || !onPrint || document.status !== 'issued'} onClick={() => print(document)}>چاپ</button>
          {document.status === 'issued' && <button type="button" className="document-danger" disabled={pending || !onVoid} onClick={() => { setVoidId(document.id); setReason(''); setError(''); }}>ابطال</button>}
        </div></td>
      </tr>)}
      {!visible.length && <tr><td colSpan={7} className="document-empty">{tab === 'issued' ? 'هنوز سندی صادر نشده است.' : 'سند باطل‌شده‌ای وجود ندارد.'}</td></tr>}
    </tbody></table></div>
    {voidId && scopedDocuments.some(document => document.id === voidId) && <form className="document-void-form" onSubmit={voidDocument}>
      <h3>ابطال سند <bdi>{faDigits(documents.find(document => document.id === voidId)?.number)}</bdi></h3>
      <p>سابقه سند و شماره آن پس از ابطال باقی می‌ماند.</p>
      <label>دلیل ابطال:<textarea name="voidReason" value={reason} disabled={pending} maxLength={1000} rows={2} onChange={event => setReason(event.target.value)} /></label>
      <div className="document-actions"><button className="document-danger" type="submit" disabled={pending}>ثبت ابطال</button><button className="document-secondary" type="button" disabled={pending} onClick={() => { setVoidId(null); setReason(''); }}>انصراف</button></div>
    </form>}
  </section>;
}
