import { useCallback, useEffect, useState } from 'react';

/* اصلاحات ۱۷/بند ۱: هیچ عددی در این فایل حساب نمی‌شود. پروندهٔ اعتباری را سرور در
   `customerCreditFile` و `creditFiles` می‌سازد و رقم‌ها را برای نقش‌های بی‌حسابی سانسور کرده است؛
   اینجا فقط همان ردیف‌ها نشان داده می‌شوند و مجوز استثنایی مدیر به همین شکل در `credit_approvals` ثبت می‌شود،
   پس رابط دیگر «بدهی» را با فیلترِ خودش حساب نمی‌کند. */

const STATUS_STYLE = {
  'آزاد': { bg: '#E3F1E9', fg: '#1E6B3A' },
  'هشدار': { bg: '#F4E9C9', fg: '#6B5417' },
  'مسدود': { bg: '#F7DCDC', fg: '#7A2222' },
  'نیازمند مجوز': { bg: '#FBE3E0', fg: '#B3261E' },
  'سقف تعیین‌نشده': { bg: '#EDEDEA', fg: '#4A4A44' },
};

const box = { border: '1px solid #d0c4b8', borderRadius: 9, padding: 10, background: '#fff', fontSize: 12, lineHeight: 1.9 };
const label = { color: '#6C625B', fontSize: 11 };
const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const control = { font: 'inherit', padding: '6px 8px', border: '1px solid #cdbfa9', borderRadius: 7, background: '#fff', color: '#2B2320', boxSizing: 'border-box', width: '100%' };
const action = { font: 'inherit', fontWeight: 700, fontSize: 12, padding: '6px 12px', border: '1px solid #7A2048', borderRadius: 7, background: '#7A2048', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghost = { ...action, background: '#fff', color: '#7A2048' };
const danger = { ...action, background: '#fff', color: '#A32A21', borderColor: '#D5A29A' };

const moneyText = (fmt, value) => `${(fmt || (v => String(v)))(Number(value) || 0)} ریال`;
/* این فیلدها نسبت‌اند، نه مبلغ: پس «ریال» نمی‌گیرند و رقمشان برای نقش‌های بی‌حساب سانسور می‌شود. */
const PERCENT_KEYS = ['usedPercent', 'warnPercent'];

export function CreditStatusBadge({ status }) {
  if (!status) return null;
  const s = STATUS_STYLE[status] || { bg: '#EDEDEA', fg: '#4A4A44' };
  return <span style={{ ...num, display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontWeight: 700, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{status}</span>;
}

/* یک فراخوانی، یک پرونده. `newAmount` را فقط نقشی می‌فرستد که خودش قیمت را می‌بیند؛
   سرور برای بقیه آن را نادیده می‌گیرد، پس کارشناس نمی‌تواند با اعلام مبلغِ دلخواه تصمیم را عوض کند. */
export function useCreditFile({ customerId, orderId, newAmount }) {
  const [state, setState] = useState({ data: null, error: '', loading: false });
  const [nonce, setNonce] = useState(0);
  const amount = Number.isSafeInteger(Number(newAmount)) && Number(newAmount) > 0 ? Math.round(Number(newAmount)) : 0;
  const id = typeof orderId === 'string' && orderId ? orderId : '';
  useEffect(() => {
    let alive = true;
    const api = window.printshopApi;
    if (!customerId) { setState({ data: null, error: '', loading: false }); return; }
    if (!api || typeof api.customerCreditFile !== 'function') {
      setState({ data: null, error: 'پروندهٔ اعتباری فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.', loading: false });
      return;
    }
    setState(prev => ({ ...prev, loading: true }));
    api.customerCreditFile({ customerId, ...(id ? { orderId: id } : {}), ...(amount ? { newAmount: amount } : {}) }).then(
      res => { if (alive) setState(res && res.ok ? { data: res, error: '', loading: false } : { data: null, error: (res && res.error) || 'خواندن پروندهٔ اعتباری ممکن نشد.', loading: false }); },
      () => { if (alive) setState({ data: null, error: 'خواندن پروندهٔ اعتباری ممکن نشد.', loading: false }); },
    );
    return () => { alive = false; };
  }, [customerId, id, amount, nonce]);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { ...state, reload };
}

/* ردیف‌های پرونده از `fields` سرور ساخته می‌شود؛ کلیدی که سانسور شده در شیء پرونده نیست،
   پس همین حلقه برای کارشناس سفارجات خودبه‌خود بی‌رقم می‌ماند. */
export function CreditFileStrip({ data, fmt, faDate, heading, compact }) {
  if (!data || !data.file) return null;
  const f = data.file;
  const v = data.verdict || {};
  const show = (data.fields || []).filter(([key]) => f[key] !== undefined && key !== 'status');
  /* سه حالت، سه رنگ: عبور از سقف قرمز، آستانهٔ درصدی زرد، و سبز فقط وقتی پرونده آزاد است. */
  const warn = !v.needsApproval && (v.status === 'هشدار' || f.status === 'هشدار');
  const tone = v.needsApproval ? { bg: '#FBE3E0', border: '#B3261E' } : warn ? { bg: '#FBF3DC', border: '#8A5A10' } : { bg: '#EDF6EF', border: '#27652D' };
  const warnTone = Number.isFinite(Number(f.usedPercent)) && Number(f.usedPercent) >= Number(f.warnPercent);
  return (
    <div style={{ ...box, background: tone.bg, borderColor: tone.border, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>{heading || 'پروندهٔ اعتباری مشتری'}</strong>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <CreditStatusBadge status={v.status || f.status} />
          <span style={label}>مبنای سیاست: {f.policySource || '—'}</span>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(150px, 1fr))' : 'repeat(auto-fit, minmax(190px, 1fr))', gap: '4px 14px' }}>
        {show.map(([key, text, hint]) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px dotted #d9cdbb' }} title={hint}>
            <span style={label}>{text}:</span>
            <strong style={{ ...num, color: key === 'usedPercent' && warnTone ? '#8A5A10' : undefined }}>
              {key === 'termDays' ? `${(fmt || String)(Number(f[key]) || 0)} روز`
                : PERCENT_KEYS.includes(key) ? `${(fmt || String)(Number(f[key]) || 0)}٪`
                : moneyText(fmt, f[key])}
            </strong>
          </div>
        ))}
      </div>
      {v.text && <div style={{ fontWeight: 700 }}>{v.text}</div>}
      {(v.warnText || v.shortWarn) && <div style={{ color: '#8A5A10', fontWeight: 700 }}>{v.warnText || v.shortWarn}</div>}
      {v.shortText && <div style={{ fontWeight: v.needsApproval ? 700 : 400, color: v.needsApproval ? '#B3261E' : warn ? '#8A5A10' : '#27652D' }}>{v.shortText}</div>}
      {f.overdueCount > 0 && <div style={{ color: '#B3261E', fontWeight: 700 }}>{`${(fmt || String)(f.overdueCount)} فاکتور از موعد گذشته است${data.today && faDate ? ` — مبنای امروز: ${faDate(data.today)}` : ''}`}</div>}
    </div>
  );
}

/* سند مجوز: چه کسی، چه زمانی، برای کدام سفارش، به چه مبلغی و با چه دلیلی.
   ردیف حذف نمی‌شود؛ نسخهٔ جدید قبلی را جایگزین می‌کند و هر دو در پرونده می‌مانند. */
export function ApprovalDocument({ approval, fmt, faDate, showOrder }) {
  if (!approval) return null;
  /* دو شکل از همان سند: ردیفِ جدول credit_approvals (decidedAt/decidedBy/openTotal)
     و نسخهٔ وصل‌شده به اجازهٔ تولید روی خودِ سفارش (at/by/amount). */
  const stamp = new Date(Number(approval.decidedAt ?? approval.at) || 0);
  const timed = Number(approval.decidedAt ?? approval.at) > 0 && !Number.isNaN(stamp.getTime());
  const day = timed && faDate ? faDate(stamp.toISOString().slice(0, 10)) : '—';
  const time = timed ? stamp.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '';
  const who = approval.decidedBy || approval.by || '—';
  const openTotal = approval.openTotal !== undefined ? approval.openTotal : approval.amount;
  const hasMoney = Number.isFinite(Number(openTotal));
  return (
    <div style={{ ...box, background: '#F7F0E4', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 12 }}>سند مجوز استثنایی — {who}{approval.decidedRole ? ` (${approval.decidedRole})` : ''}</strong>
        <span style={label}><bdi>{day}</bdi>{time ? ` — ساعت ${time}` : ''}{approval.state && approval.state !== 'active' ? ' — جایگزین‌شده' : ''}</span>
      </div>
      <div style={{ fontSize: 12 }}>{approval.reason}</div>
      {hasMoney && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
          <span style={label}>ماندهٔ باز هنگام مجوز: <strong style={num}>{moneyText(fmt, openTotal)}</strong></span>
          <span style={label}>عبور از سقف: <strong style={num}>{moneyText(fmt, approval.overBy)}</strong></span>
          <span style={label}>سقف: <strong style={num}>{moneyText(fmt, approval.ceiling)}</strong></span>
          {approval.quoteRevision ? <span style={label}>نسخهٔ پیش‌فاکتور: <strong style={num}>{approval.quoteRevision}</strong></span> : null}
        </div>
      )}
      {showOrder && <div style={label}>برای کدام سفارش: <bdi>{approval.orderNumber || approval.orderId}</bdi>{approval.orderLabel ? ` — ${approval.orderLabel}` : ''}</div>}
    </div>
  );
}

/* ثبت مجوز فقط با مدیر چاپخانه و رمز او؛ سرور هر دو را دوباره می‌سنجد. */
export function CreditApprovalForm({ customerId, orderId, summary, onDone, callApprove }) {
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    if (busy) return;
    const call = callApprove || (window.printshopApi || {}).approveCreditException;
    if (typeof call !== 'function') { setError('ثبت مجوز فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.'); return; }
    setBusy(true); setError('');
    try {
      const res = await call({ customerId, orderId, reason: reason.trim(), pin: pin.trim() });
      if (res && res.ok) { setReason(''); setPin(''); onDone && onDone(res.approval); }
      else setError((res && res.error) || 'مجوز ثبت نشد.');
    } catch (_) { setError('مجوز ثبت نشد؛ ارتباط با سرور برقرار نشد.'); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ ...box, background: '#FFF6F3', borderColor: '#DDB6AE', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong style={{ fontSize: 12 }}>مجوز مستند بدهی — ثبت این کادر یک سند می‌سازد، نه فقط یک تیک</strong>
      {summary && <div style={{ fontSize: 11, color: '#6C625B' }}>{summary}</div>}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600 }}>
        <span style={label}>دلیل مجوز (حداقل ۱۰ نویسه — مبنای تصمیم، تضمین تسویه، …):</span>
        <textarea rows={2} maxLength={2000} style={control} value={reason} onChange={e => setReason(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600, width: 170 }}>
          <span style={label}>رمز مدیر چاپخانه:</span>
          <input type="password" inputMode="numeric" style={control} value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
        </label>
        <button type="button" style={reason.trim().length < 10 || !pin.trim() || busy ? { ...action, opacity: .45, cursor: 'default' } : action} disabled={reason.trim().length < 10 || !pin.trim() || busy} onClick={submit}>
          {busy ? 'در حال ثبت…' : 'ثبت سند مجوز'}
        </button>
      </div>
      {error && <div role="alert" style={{ color: '#9E2424', background: '#FFF0EC', border: '1px solid #E6C4B9', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>{error}</div>}
      <div style={{ fontSize: 11, color: '#6C625B' }}>رمز به‌تنهایی کنترل نیست؛ تا دلیل ثبت نشود اجازهٔ تولید باز نمی‌شود.</div>
    </div>
  );
}

export const creditStyles = { box, label, num, control, action, ghost, danger };

/* جدول همهٔ پرونده‌ها را یک‌بار سرور می‌سازد (be:creditFiles)؛ داشبورد، کارت‌های مالی و این پنل
   همه از همین یک پاسخ می‌خوانند تا هیچ ایستگاهی عددِ بدهیِ خودش را نسازد. */
export function useCreditFiles(enabled, refreshKey) {
  const [state, setState] = useState({ rows: [], kpis: null, money: false, today: '', error: '' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const api = window.printshopApi;
    if (!api || typeof api.creditFiles !== 'function') { setState({ rows: [], kpis: null, money: false, today: '', error: 'پروندهٔ اعتباری فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.' }); return; }
    api.creditFiles().then(
      res => { if (alive) setState(res && res.ok ? { rows: res.rows || [], kpis: res.kpis || null, money: !!res.money, today: res.today || '', error: '' } : { rows: [], kpis: null, money: false, today: '', error: (res && res.error) || 'خواندن پرونده‌های اعتباری ممکن نشد.' }); },
      () => { if (alive) setState({ rows: [], kpis: null, money: false, today: '', error: 'خواندن پرونده‌های اعتباری ممکن نشد.' }); },
    );
    return () => { alive = false; };
  }, [enabled, nonce, refreshKey]);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  return { ...state, reload };
}
