import { useState } from 'react';
import { Bell } from 'lucide-react';
import { normalizeDigits, formatTyping, cleanNumber } from './smart.js';
import { useCreditFile, CreditFileStrip, ApprovalDocument } from './CreditFile.jsx';
import './form-field.css';
import './workflow.css';

const MANAGER = 'مدیر چاپخانه';
const FINANCE = 'مدیر مالی';
const number = (value) => Number(normalizeDigits(String(value)).replace(/[,٬،\s]/g, ''));
const fmt = (value) => Number(value || 0).toLocaleString('fa-IR');
const emptyShortage = () => ({ description: '', qty: '', unit: 'بند', dueDate: '' });

function Field({ label, children }) {
  return <label className="workflow-field psx-field">
    <span className="psx-field-label">{label}:</span>
    <span className="psx-field-control">{children}</span>
  </label>;
}
function BusyButton({ busy, children, danger, disabled, onClick }) { return <button type="button" disabled={busy || disabled} className={`workflow-button${danger ? ' workflow-danger' : ''}`} onClick={onClick}>{busy ? 'در حال ثبت…' : children}</button>; }

export function EmergencyStopForm({ onAction, onClose }) {
  const [orderNumber, setOrderNumber] = useState('');
  const [kind, setKind] = useState('pause');
  const [reason, setReason] = useState('');
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    if (!orderNumber.trim() || reason.trim().length < 3 || !requested) { setError('شمارهٔ سفارش، شرح درخواست مشتری و تأیید دریافت درخواست لازم است.'); return; }
    setBusy(true); setError('');
    try {
      const result = await onAction(normalizeDigits(orderNumber).trim(), 'stop', { kind, reason, customerRequest: true });
      if (result.ok) onClose(); else setError(result.error);
    } catch (_) { setError('ثبت توقف انجام نشد؛ دوباره تلاش کنید و توقف را به واحدهای درگیر اطلاع دهید.'); }
    finally { setBusy(false); }
  }
  return <div className="workflow-box">
    <p>درخواست مشتری بلافاصله ثبت می‌شود و به تأیید مدیر نیاز ندارد. وضعیت کار انجام‌شده و مواد مصرفی حفظ می‌شود.</p>
    <Field label="شمارهٔ سفارش"><input dir="ltr" inputMode="numeric" value={orderNumber} onChange={e => setOrderNumber(e.target.value)} autoFocus /></Field>
    <Field label="نوع درخواست"><select value={kind} onChange={e => setKind(e.target.value)}><option value="pause">توقف موقت</option><option value="cancel">لغو سفارش و ارجاع تسویه به مالی</option></select></Field>
    <Field label="شرح درخواست مشتری و نحوهٔ دریافت آن"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={2000} /></Field>
    <label className="workflow-check"><input type="checkbox" checked={requested} onChange={e => setRequested(e.target.checked)} />درخواست توقف یا لغو را از مشتری دریافت کرده‌ام.</label>
    {error && <p role="alert" className="workflow-error">{error}</p>}
    <BusyButton busy={busy} danger onClick={submit}>ثبت فوری توقف</BusyButton>
    <small>ابلاغ به مشتری و همکار بیرونی تا اتصال مسیر ارسال، در صف پیگیری باقی می‌ماند.</small>
  </div>;
}

export function OrderWorkflowPanel({ order, role, onAction, DateInput, faDate, fmtMoney }) {
  const [evidence, setEvidence] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [shortages, setShortages] = useState([]);
  const [debtApproved, setDebtApproved] = useState(false);
  const [creditReason, setCreditReason] = useState('');
  const [reason, setReason] = useState('');
  const [settlement, setSettlement] = useState({ services: '', materials: '', partners: '', paid: '', explanation: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const workflow = order.workflow || {};
  const manager = role === MANAGER;
  const finance = role === FINANCE || manager;
  const pending = order.status === 'در انتظار تایید';
  const confirmed = workflow.customerConfirmation && workflow.customerConfirmation.quoteRevision === (Number(order.quoteRev) || 1);
  /* اصلاحات ۱۷/بند ۱: «بدهی باز» را این پنل حساب نمی‌کند؛ پرونده را از سرور می‌خواند و
     دلیلِ عبور را به همان شکل در جدول سند مجوز ثبت می‌کند. */
  const money = fmtMoney || fmt;
  const credit = useCreditFile({ customerId: order.customerId, orderId: order.id });
  const openDebt = !!(credit.data && credit.data.file && credit.data.file.openTotal > 0);
  const creditDoc = credit.data && credit.data.approval;
  async function submit(action, payload) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await onAction(order.id, action, payload);
      if (result.ok) { setMessage('ثبت شد. اعلان‌های مربوط در برنامه و صف پیگیری قرار گرفتند.'); credit.reload(); } else setError(result.error);
    } catch (_) { setError('ثبت عملیات انجام نشد؛ وضعیت قبلی حفظ شده است.'); }
    finally { setBusy(false); }
  }
  const patchShortage = (index, patch) => setShortages(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const finalSettlement = workflow.cancellationSettlement;
  return <section className="workflow-box" aria-label="گردش و مجوزهای سفارش">
    <strong>گردش و مجوزهای سفارش</strong>
    {!pending && !workflow.productionAuthorization && !workflow.stop && !['درخواست مشتری', 'بایگانی', 'تحویل شده'].includes(order.status) && <p className="workflow-error">این سفارش قدیمی، مجوز تولید در ساختار جدید ندارد و برای ادامه نیازمند بررسی و انتقال سوابق است.</p>}
    {workflow.stop && <p className="workflow-error">{workflow.stop.kind === 'cancel' ? 'لغو سفارش' : 'توقف موقت'} — {workflow.stop.reason}<br />ثبت‌کننده: {workflow.stop.by.name}</p>}
    {pending && <>
      <p>{confirmed ? 'تأیید مشتری ثبت شده؛ سفارش هنوز اجازهٔ شروع تولید ندارد.' : 'پیش‌فاکتور تا ثبت تأیید مشتری و اجازهٔ مدیر وارد تابلوی تولید نمی‌شود.'}</p>
      {!confirmed && [MANAGER, FINANCE, 'کارشناس سفارشات'].includes(role) && <div className="workflow-group">
        <Field label="شرح تأیید مشتری؛ مانند تماس یا تأیید کتبی"><textarea rows={2} value={evidence} onChange={e => setEvidence(e.target.value)} maxLength={2000} /></Field>
        <BusyButton busy={busy} disabled={evidence.trim().length < 3} onClick={() => submit('confirm_customer', { evidence })}>ثبت تأیید مشتری</BusyButton>
      </div>}
      {manager && confirmed && <div className="workflow-group">
        <label className="workflow-check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />وضعیت مواد اولیه را بررسی کرده‌ام؛ کسری‌ها در زیر ثبت می‌شوند.</label>
        {shortages.map((row, i) => <div className="workflow-shortage" key={i}>
          <Field label="مادهٔ موردنیاز"><input value={row.description} onChange={e => patchShortage(i, { description: e.target.value })} /></Field>
          <Field label="مقدار کسری"><input inputMode="decimal" value={row.qty} onChange={e => patchShortage(i, { qty: e.target.value })} /></Field>
          <Field label="واحد"><input value={row.unit} onChange={e => patchShortage(i, { unit: e.target.value })} /></Field>
          <Field label="مهلت تأمین توسط مالی">{DateInput ? <DateInput value={row.dueDate} onChange={value => patchShortage(i, { dueDate: value })} /> : <input type="date" value={row.dueDate} onChange={e => patchShortage(i, { dueDate: e.target.value })} />}</Field>
          <button type="button" className="workflow-link" onClick={() => setShortages(rows => rows.filter((_, n) => n !== i))}>حذف ردیف کسری</button>
        </div>)}
        <button type="button" className="workflow-link" onClick={() => setShortages(rows => [...rows, emptyShortage()])}>افزودن کسری و مهلت تأمین</button>
        {openDebt && <div className="workflow-group">
          <CreditFileStrip data={credit.data} fmt={money} faDate={faDate} heading="پروندهٔ اعتباری مشتری — مبنای اجازهٔ تولید" compact />
          {creditDoc
            ? <ApprovalDocument approval={creditDoc} fmt={money} faDate={faDate} />
            : <Field label="دلیل مجوز عبور از بدهی؛ حداقل ۱۰ نویسه — همین متن با نام و زمان شما سند می‌شود"><textarea rows={2} value={creditReason} onChange={e => setCreditReason(e.target.value)} maxLength={2000} /></Field>}
          {!creditDoc && <label className="workflow-check"><input type="checkbox" checked={debtApproved} onChange={e => setDebtApproved(e.target.checked)} />ادامهٔ تولید با این بدهی باز را به‌عنوان مدیر چاپخانه می‌پذیرم.</label>}
        </div>}
        {/* سند مجوز فعال، پذیرشِ صریح مدیر است؛ تیکِ جدا فقط وقتی لازم است که سندی هنوز نیست. */}
        <BusyButton busy={busy} disabled={!reviewed || (openDebt && !creditDoc && (creditReason.trim().length < 10 || !debtApproved))} onClick={() => submit('release_production', { materialReview: { checked: reviewed, shortages: shortages.map(s => ({ ...s, qty: number(s.qty) })) }, debtApproved: !!creditDoc || debtApproved, ...(creditReason.trim() ? { creditReason: creditReason.trim() } : {}) })}>{shortages.length ? 'اجازهٔ مشروط تولید و ارجاع تأمین به مالی' : 'اجازهٔ مدیر برای شروع تولید'}</BusyButton>
      </div>}
    </>}
    {workflow.productionAuthorization && workflow.productionAuthorization.creditApproval && <ApprovalDocument approval={workflow.productionAuthorization.creditApproval} fmt={money} faDate={faDate} />}
    {workflow.materialReview && workflow.materialReview.shortages.length > 0 && <div><strong>تعهدهای تأمین مواد</strong>{workflow.materialReview.shortages.map((s, i) => <p key={i}>{s.description} — {fmt(s.qty)} {s.unit} — مهلت: {faDate ? faDate(s.dueDate) : s.dueDate} — مسئول: {s.responsibleRole}</p>)}</div>}
    {manager && workflow.stop && workflow.stop.kind === 'pause' && <div className="workflow-group">
      <Field label="شرح اجازهٔ ادامهٔ کار"><textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} /></Field>
      <BusyButton busy={busy} disabled={reason.trim().length < 3} onClick={() => submit('resume', { reason })}>اجازهٔ مدیر برای ادامهٔ کار</BusyButton>
    </div>}
    {finance && workflow.stop && workflow.stop.kind === 'cancel' && <div className="workflow-group">
      <strong>تعیین تکلیف مالی لغو — مبالغ به ریال</strong>
      <div className="workflow-grid">{[['services', 'کار انجام‌شده'], ['materials', 'مواد مصرف‌شده'], ['partners', 'تعهدات همکاران'], ['paid', 'وجه دریافتی از مشتری']].map(([key, label]) => <Field key={key} label={label}><input inputMode="numeric" dir="ltr" value={formatTyping(settlement[key])} onChange={e => setSettlement(s => ({ ...s, [key]: cleanNumber(e.target.value) }))} /></Field>)}</div>
      <Field label="شرح و مبنای تسویه"><textarea value={settlement.explanation} onChange={e => setSettlement(s => ({ ...s, explanation: e.target.value }))} rows={3} /></Field>
      <BusyButton busy={busy} disabled={settlement.explanation.trim().length < 3} onClick={() => submit('settle_cancellation', { ...Object.fromEntries(['services', 'materials', 'partners', 'paid'].map(key => [key, number(settlement[key])])), explanation: settlement.explanation })}>ثبت تسویه و اطلاع مدیر</BusyButton>
      {finalSettlement && <p>تسویهٔ ثبت‌شده: {finalSettlement.balance >= 0 ? 'بدهکاری مشتری' : 'قابل استرداد به مشتری'} — {fmt(Math.abs(finalSettlement.balance))} ریال</p>}
    </div>}
    {error && <p className="workflow-error" role="alert">{error}</p>}
    {message && <p className="workflow-success" role="status">{message}</p>}
  </section>;
}

export function WorkflowNotifications({ notifications, onRead, letterAlerts = [], onOpenLetters }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter(n => !n.read).length + letterAlerts.length;
  return <div className="workflow-notifications">
    <button type="button" className={`workflow-button notification-trigger${unread ? ' has-unread' : ''}`} aria-expanded={open} aria-label={unread > 0 ? `اعلان‌های داخلی — ${fmt(unread)} خوانده‌نشده` : 'اعلان‌های داخلی'} onClick={() => setOpen(v => !v)}><span className="notification-icon"><Bell size={17}/><span className="notification-ring" aria-hidden="true"/>{unread > 0 && <span className="notification-count" aria-hidden="true">{fmt(unread)}</span>}</span>اعلان‌های داخلی</button>
    {open && <div className="workflow-notice-list" aria-label="اعلان‌های داخلی">
      {letterAlerts.length > 0 && <div className="workflow-notice workflow-notice-letter">
        <strong>{fmt(letterAlerts.length)} نامه منتظر نظر شماست</strong>
        {letterAlerts.slice(0, 3).map(l => <p key={l.id}>{l.fromUnit || '—'} — {l.subject}</p>)}
        {letterAlerts.length > 3 && <p>و {fmt(letterAlerts.length - 3)} نامهٔ دیگر.</p>}
        <button type="button" className="workflow-link" onClick={onOpenLetters}>رفتن به نامه‌ها برای موافقت یا مخالفت</button>
      </div>}
      {notifications.length === 0 && letterAlerts.length === 0 && <p>اعلانی ثبت نشده است.</p>}
      {notifications.map(n => <div className="workflow-notice" key={n.id}><strong>سفارش {n.orderNumber}</strong><p>{n.message}</p>{['customer', 'partners'].includes(n.audience) && <small>در صف پیگیری ارسال؛ ارسال بیرونی هنوز انجام نشده است.</small>}{!n.read && <button type="button" className="workflow-link" onClick={() => onRead(n.id)}>خواندم</button>}</div>)}
    </div>}
  </div>;
}
