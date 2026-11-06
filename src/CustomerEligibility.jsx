import { useRef, useState } from 'react';
import { PARTY_LABEL, REVIEW_NAMES, partyActive, partyCode, partyReview } from './party-cycle.js';
import './form-field.css';

const normalize = value => String(value ?? '').replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase().trim();
/* وضعیت‌های نمایشی: سه وضعیت صلاحیت + «غیرفعال» که از بانک کاری بیرون می‌رود. */
const stateOf = party => partyActive(party) ? partyReview(party) : `inactive:${partyReview(party)}`;
const STATE_NAMES = {
  pending: 'در انتظار بررسی', approved: 'تأیید شده', rejected: 'رد شده',
  'inactive:pending': 'در انتظار بررسی · غیرفعال', 'inactive:approved': 'تأیید شده · غیرفعال', 'inactive:rejected': 'رد شده · غیرفعال',
};
const STATE_COLORS = {
  approved: ['#e8f3e6', '#27652d'], rejected: ['#fae8e8', '#a42222'], pending: ['#fff0d1', '#67440e'],
  'inactive:approved': ['#eeeae4', '#5a5148'], 'inactive:pending': ['#eeeae4', '#5a5148'], 'inactive:rejected': ['#eeeae4', '#5a5148'],
};
const styles = {
  root: { display: 'flex', flexDirection: 'column', gap: 14, padding: 16, border: '1px solid #d7c7ae', borderRadius: 12, background: '#fffdf8', color: '#2b2320', fontSize: 13, lineHeight: 1.9 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  field: { flex: '1 1 240px', minWidth: 0, fontWeight: 600 },
  fieldBlock: { width: '100%', minWidth: 0, fontWeight: 600 },
  input: { boxSizing: 'border-box', width: '100%', padding: '4px 9px', border: '1px solid #bcae97', borderRadius: 8, font: 'inherit', fontWeight: 400, color: '#2b2320', background: '#fff' },
  card: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: '1px solid #e0d4c0', borderRadius: 10, background: '#fff' },
  button: { padding: '8px 12px', border: '1px solid #7a2048', borderRadius: 8, font: 'inherit', color: '#fff', background: '#7a2048', cursor: 'pointer' },
  secondary: { background: '#fff', color: '#7a2048' },
  danger: { background: '#fff', borderColor: '#a42222', color: '#a42222' },
  note: { margin: 0, color: '#63594f' },
  tab: active => ({ padding: '7px 14px', border: `1px solid ${active ? '#7a2048' : '#bcae97'}`, borderRadius: 8, font: 'inherit', fontWeight: 700, cursor: 'pointer', color: active ? '#fff' : '#7a2048', background: active ? '#7a2048' : '#fff' }),
};

function ActionButton({ disabled, children, onClick, secondary, danger }) {
  return <button type="button" disabled={disabled} onClick={onClick} style={{ ...styles.button, ...(secondary ? styles.secondary : {}), ...(danger ? styles.danger : {}), ...(disabled ? { opacity: 0.5, cursor: 'default' } : {}) }}>{children}</button>;
}

/* focusId/compact: همان کارتِ بررسی، تنها برای یک رکورد، داخل مودال؛ فهرست‌ها خودشان جای پنل بزرگ را گرفته‌اند. */
export default function CustomerEligibility({ kind = 'customer', customers = [], suppliers = [], onAction, onRefresh, defaultKind, focusId = null, compact = false }) {
  const [tab, setTab] = useState(defaultKind || kind);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const inFlight = useRef(false);
  const label = PARTY_LABEL[tab];
  const codeField = tab === 'supplier' ? 'supplierCode' : 'customerCode';
  const bank = tab === 'supplier' ? suppliers : customers;
  const search = normalize(query);
  const rows = focusId ? bank.filter(party => party.id === focusId) : bank.filter(party => {
    const matchesState = stateFilter === 'all' || stateOf(party) === stateFilter;
    const haystack = normalize(`${party.name || ''} ${party[codeField] || ''} ${party.phone || ''} ${party.mobile || ''}`);
    return matchesState && (!search || haystack.includes(search));
  });
  const states = ['all', 'pending', 'approved', 'rejected', 'inactive:approved', 'inactive:rejected', 'inactive:pending'];
  /* همان شرطی که دکمه را غیرفعال می‌کند، در act هم بررسی می‌شود تا هیچ درخواستی برخلاف وضعیت رکورد ثبت نشود. */
  function allows(party, action) {
    const status = partyReview(party), active = partyActive(party), code = partyCode(party, tab);
    if (action === 'approve') return status !== 'approved';
    if (action === 'issue_number') return status === 'approved' && active && !code;
    if (action === 'reject') return status !== 'rejected';
    if (action === 'activate') return !active;
    if (action === 'deactivate') return active;
    if (action === 'erase') return !code && status !== 'approved';
    return false;
  }

  async function act(party, action) {
    if (inFlight.current) return;
    const reason = String(reasons[party.id] || '').trim();
    if (['approve', 'reject'].includes(action) && (reason.length < 3 || reason.length > 2000)) {
      setFeedback({ id: party.id, error: `شرح تصمیم مدیر برای تأیید یا رد ${label}، بین ۳ تا ۲۰۰۰ نویسه لازم است.` }); return;
    }
    if (!allows(party, action)) return;
    const ask = globalThis.window?.confirm;
    if (action === 'erase' && typeof ask === 'function' && !ask(`«${party.name || label}» برای همیشه از بانک اطلاعاتی حذف شود؟ این کار بازگشت ندارد.`)) return;
    if (typeof onAction !== 'function') { setFeedback({ id: party.id, error: 'ارتباط با عملیات امن طرف‌ها در دسترس نیست.' }); return; }
    inFlight.current = true; setBusy({ id: party.id, action }); setFeedback(null);
    try {
      const result = await onAction(tab, party.id, action, ['approve', 'reject'].includes(action) ? { reason } : {});
      if (!result?.ok) throw new Error(result?.error || 'عملیات ثبت نشد.');
      const recorded = { approve: `تأیید ${label}`, reject: `رد ${label} و غیرفعال شدن آن`, issue_number: `صدور کد یکتای ${label}`, activate: 'فعال کردن', deactivate: 'غیرفعال کردن', erase: 'حذف کامل از بانک' }[action];
      let refreshWarning = '';
      if (onRefresh) {
        try {
          const refreshed = await onRefresh(tab);
          if (refreshed?.ok === false) refreshWarning = ' دریافت فهرست تازه انجام نشد؛ دوباره تازه‌سازی کنید.';
        } catch (_) { refreshWarning = ' دریافت فهرست تازه انجام نشد؛ دوباره تازه‌سازی کنید.'; }
      }
      if (action === 'erase') setFeedback({ id: null, success: `${recorded} در سرور ثبت شد.` });
      else setFeedback({ id: party.id, success: `${recorded} در سرور ثبت شد.${refreshWarning || ' مقادیر نمایش‌داده‌شده از آخرین اطلاعات دریافتی هستند.'}` });
      setReasons(previous => ({ ...previous, [party.id]: '' }));
    } catch (error) { setFeedback({ id: party.id, error: error?.message || 'عملیات ثبت نشد؛ دوباره تلاش کنید.' }); }
    finally { inFlight.current = false; setBusy(null); }
  }

  async function refresh() {
    if (inFlight.current || !onRefresh) return;
    inFlight.current = true; setBusy({ id: null, action: 'refresh' }); setFeedback(null);
    try {
      const result = await onRefresh(tab);
      if (result?.ok === false) throw new Error(result.error || 'دریافت فهرست انجام نشد.');
      setFeedback({ id: null, success: 'درخواست تازه‌سازی انجام شد؛ فهرست از اطلاعات دریافتی نمایش داده می‌شود.' });
    } catch (error) { setFeedback({ id: null, error: error?.message || 'دریافت فهرست انجام نشد.' }); }
    finally { inFlight.current = false; setBusy(null); }
  }

  return <section dir="rtl" aria-label={compact ? `بررسی ${label}` : `تأیید و کد ${label}ها`} style={compact ? { ...styles.root, padding: 0, border: 0, background: 'transparent' } : styles.root}>
    {!compact && <div style={{ ...styles.row, justifyContent: 'space-between' }}>
      <strong style={{ fontSize: 16 }}>تعریف ← تأیید ← کد یکتا</strong>
      <div style={styles.row} role="tablist" aria-label="نوع طرف">
        {Object.keys(PARTY_LABEL).map(k => <button key={k} type="button" role="tab" aria-selected={tab === k} style={styles.tab(tab === k)} onClick={() => { setTab(k); setFeedback(null); }}>{PARTY_LABEL[k]}ها</button>)}
      </div>
    </div>}
    {!compact && <p style={styles.note}>اول رکورد را تعریف کنید، سپس آن را تأیید یا رد نمایید. کد یکتا فقط پس از تأیید صادر می‌شود؛ رکوردِ رد شده غیرفعال می‌ماند و کدی نمی‌گیرد، بنابراین همان شماره به نفر بعدی می‌رسد. فعال و غیرفعال کردن در هر وضعیتی ممکن است و «حذف از بانک» تنها برای رکورد بی‌کد و تأییدنشده کار می‌کند. پس از تأیید و صدور کد، حساب کاربری مشتری را در بخش «کاربران» بسازید. کد {label}، شناسه است و رمز ورود محسوب نمی‌شود.</p>}
    {!compact && <div style={styles.row}>
      <label className="psx-field" style={styles.field}><span className="psx-field-label">جست‌وجوی نام، کد یا تلفن:</span><span className="psx-field-control"><input style={styles.input} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="نام یا کد…" /></span></label>
      <label className="psx-field" style={styles.field}><span className="psx-field-label">وضعیت:</span><span className="psx-field-control"><select style={styles.input} value={stateFilter} onChange={event => setStateFilter(event.target.value)}>{states.map(s => <option key={s} value={s}>{s === 'all' ? `همهٔ ${label}ها (بانک کامل)` : STATE_NAMES[s]}</option>)}</select></span></label>
      {onRefresh && <ActionButton secondary disabled={!!busy} onClick={refresh}>{busy?.action === 'refresh' ? 'در حال دریافت…' : 'تازه‌سازی فهرست'}</ActionButton>}
    </div>}
    {feedback && <p role={feedback.error ? 'alert' : 'status'} style={{ margin: 0, color: feedback.error ? '#a42222' : '#27652d', fontWeight: 600 }}>{feedback.id && <span>{bank.find(party => party.id === feedback.id)?.name || label}: </span>}{feedback.error || feedback.success}</p>}
    {!compact && <p style={styles.note}>{rows.length.toLocaleString('fa-IR')} رکورد در این نمایش — بانک کامل {bank.length.toLocaleString('fa-IR')} رکورد دارد و با فیلتر وضعیت قابل دیدن است.</p>}
    {rows.length === 0 && <p style={styles.note}>{compact ? 'این رکورد دیگر در بانک نیست؛ فهرست را تازه کنید.' : 'رکوردی با این جست‌وجو و وضعیت پیدا نشد.'}</p>}
    {rows.map(party => {
      const state = stateOf(party);
      const status = partyReview(party);
      const active = partyActive(party);
      const code = partyCode(party, tab);
      const reason = reasons[party.id] || '';
      const submitting = busy?.id === party.id;
      return <article key={party.id} style={styles.card} aria-label={`بررسی ${party.name || label}`}>
        <div style={{ ...styles.row, justifyContent: 'space-between' }}>
          <strong>{party.name || 'بدون نام'}{party.isMarketer && tab === 'customer' && <span style={{ marginRight: 8, padding: '2px 8px', borderRadius: 7, background: '#f3e6ee', color: '#7a2048', fontSize: 11, fontWeight: 700 }}>بازاریاب</span>}</strong>
          <span style={{ padding: '3px 10px', borderRadius: 8, background: STATE_COLORS[state][0], color: STATE_COLORS[state][1] }}>{STATE_NAMES[state]}</span>
        </div>
        <div style={styles.row}>
          <span>کد {label}: <strong><bdi>{code || 'صادر نشده'}</bdi></strong></span>
          <span>وضعیت صلاحیت: <strong>{REVIEW_NAMES[status]}</strong></span>
          {party.phone && <span>تلفن: <bdi>{party.phone}</bdi></span>}
          {party.mobile && <span>همراه: <bdi>{party.mobile}</bdi></span>}
        </div>
        {party.eligibility?.reason && <p style={styles.note}>شرح آخرین تصمیم: {party.eligibility.reason}</p>}
        <label className="psx-field psx-stacked" style={styles.fieldBlock}><span className="psx-field-label">شرح تصمیم مدیر برای {party.name || label}؛ برای تأیید یا رد الزامی است:</span><span className="psx-field-control"><textarea style={{ ...styles.input, resize: 'vertical', minHeight: 60 }} value={reason} maxLength={2000} disabled={!!busy} onChange={event => setReasons(previous => ({ ...previous, [party.id]: event.target.value }))} placeholder="مبنای تأیید یا دلیل رد را بنویسید." /></span></label>
        <div style={styles.row}>
          <ActionButton disabled={!!busy || !allows(party, 'approve') || reason.trim().length < 3} onClick={() => act(party, 'approve')}>{submitting && busy.action === 'approve' ? 'در حال ثبت تأیید…' : `۱. تأیید ${label}`}</ActionButton>
          <ActionButton secondary disabled={!!busy || !allows(party, 'issue_number')} onClick={() => act(party, 'issue_number')}>{submitting && busy.action === 'issue_number' ? 'در حال صدور کد…' : code ? `کد صادر شده: ${code}` : '۲. صدور کد یکتا'}</ActionButton>
          <ActionButton danger disabled={!!busy || !allows(party, 'reject') || reason.trim().length < 3} onClick={() => act(party, 'reject')}>{submitting && busy.action === 'reject' ? 'در حال ثبت رد…' : 'رد و غیرفعال کردن'}</ActionButton>
          <ActionButton secondary disabled={!!busy || !allows(party, active ? 'deactivate' : 'activate')} onClick={() => act(party, active ? 'deactivate' : 'activate')}>{submitting && ['activate', 'deactivate'].includes(busy.action) ? 'در حال ثبت…' : active ? 'غیرفعال کردن' : 'فعال کردن'}</ActionButton>
          <ActionButton danger disabled={!!busy || !allows(party, 'erase')} onClick={() => act(party, 'erase')}>{submitting && busy.action === 'erase' ? 'در حال حذف…' : 'حذف از بانک'}</ActionButton>
        </div>
        {status !== 'approved' && <small style={styles.note}>تا پیش از تأیید، این رکورد در فهرست کاری و فرم‌ها نمایش داده نمی‌شود.</small>}
        {status === 'approved' && <small style={styles.note}>{code ? 'تأیید شده و در فهرست کاری است؛ کد یکتای آن صادر شده.' : 'تأیید شده و در فهرست کاری است؛ برای اسناد رسمی، کد یکتا را صادر کنید.'}</small>}
        {active === false && <small style={styles.note}>غیرفعال است: در هیچ فهرست کاری انتخاب نمی‌شود، اما پیشینهٔ اسناد آن پاک نمی‌شود.</small>}
      </article>;
    })}
  </section>;
}
