import { useState } from 'react';
import { ApprovalDocument, CreditApprovalForm, CreditStatusBadge, creditStyles } from './CreditFile.jsx';
import './document-panels.css';

/* اصلاحات ۱۷/بند ۱: میز «پروندهٔ اعتباری مشتری‌ها». هر عدد از `be:creditFiles` می‌آید —
   سقف، مهلت، بدهی قطعی، سررسیدگذشته، پیش‌پرداخت، تعهد، تعهد خالص و اعتبار قابل‌استفاده را سرور
   از فاکتورهای صادرشده و سفارش‌های تأییدشده حساب کرده است. این صفحه عددی حساب نمی‌کند؛
   فقط همان ردیف‌ها را نشان می‌دهد، سیاست را به `be:saveCreditPolicy` و مجوز مدیر را به `be:approveCreditException` می‌سپارد. */

const MANAGER = 'مدیر چاپخانه';
const { control, label, num } = creditStyles;
const digits = v => String(v ?? '').replace(/[^\d]/g, '');

async function savePolicy(input) {
  const api = window.printshopApi;
  if (!api || typeof api.saveCreditPolicy !== 'function') return { ok: false, error: 'ثبت سیاست فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.' };
  return api.saveCreditPolicy(input);
}

function Cell({ children, tone }) {
  return <td style={{ ...num, color: tone, fontWeight: tone ? 800 : 400 }}>{children}</td>;
}

function PolicyEditor({ row, canWrite, onDone }) {
  const [draft, setDraft] = useState({
    ceiling: String(row.ceiling ?? 0), termDays: String(row.termDays ?? 0),
    warnPercent: String(row.warnPercent ?? 80), note: row.policyNote || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  async function save() {
    setBusy(true); setError('');
    const res = await savePolicy({
      customerId: row.customerId, ceiling: Number(draft.ceiling) || 0, termDays: Number(draft.termDays) || 0,
      warnPercent: Number(draft.warnPercent) || 0, note: draft.note,
    });
    setBusy(false);
    if (res && res.ok === false) setError(res.error || 'سیاست ثبت نشد.'); else onDone(true);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid #e3d6bc', borderRadius: 10, padding: 12, background: '#f7f0e4' }}>
      <strong>سیاست اعتبار — {row.customerName}</strong>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600, width: 170 }}><span style={label}>سقف اعتبار (ریال):</span><input inputMode="numeric" dir="ltr" style={control} disabled={!canWrite} value={draft.ceiling} onChange={e => set('ceiling', digits(e.target.value))} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600, width: 130 }}><span style={label}>مهلت پرداخت (روز):</span><input inputMode="numeric" dir="ltr" style={control} disabled={!canWrite} value={draft.termDays} onChange={e => set('termDays', digits(e.target.value))} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600, width: 110 }}><span style={label}>درصد هشدار:</span><input inputMode="numeric" dir="ltr" style={control} disabled={!canWrite} value={draft.warnPercent} onChange={e => set('warnPercent', digits(e.target.value))} /></label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontWeight: 600, flex: '1 1 220px' }}><span style={label}>یادداشت پرونده:</span><input style={control} disabled={!canWrite} value={draft.note} onChange={e => set('note', e.target.value)} maxLength={500} /></label>
        <button type="button" disabled={!canWrite || busy} onClick={save}>{busy ? 'در حال ثبت…' : 'ثبت سیاست'}</button>
        <button type="button" className="document-secondary" onClick={() => onDone(false)}>بستن</button>
      </div>
      <div className="document-footnote">
        مبنای فعلی: {row.policySource || 'تنظیم نشده'}{row.policyUpdatedBy ? ` — آخرین تغییر: ${row.policyUpdatedBy}` : ''} — نقدی یعنی مهلت ۰ روز؛ ۱۵ و ۳۰ روزه را همین‌جا وارد کنید.
      </div>
      {error && <div className="document-error" role="alert">{error}</div>}
      {!canWrite && <div className="document-footnote">نویسندهٔ سیاست اعتبار فقط مدیر چاپخانه و مدیر مالی است.</div>}
    </div>
  );
}

function CustomerDetail({ row, money, role, fmt, faDate, onOpenOrder, onReload }) {
  const [editing, setEditing] = useState(false);
  const [approvalFor, setApprovalFor] = useState('');
  const canWritePolicy = role === MANAGER || role === 'مدیر مالی';
  const line = (row.lines || []).find(l => l.orderId === approvalFor);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 12px 12px' }}>
      {editing && <PolicyEditor row={row} canWrite={canWritePolicy} onDone={saved => { setEditing(false); if (saved) onReload(); }} />}
      {money && (
        <div>
          <strong>ردیف‌های بدهی و تعهد</strong>
          <div className="document-table-wrap" style={{ marginTop: 6 }}>
            <table>
              <thead><tr>{['سفارش', 'نوع', 'منبع مبلغ', 'تاریخ سند', 'سررسید', 'قابل پرداخت', 'پرداخت‌شده', 'مانده', 'پیش‌پرداخت', 'اقدام'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {(row.lines || []).map(l => (
                  <tr key={l.orderId} style={l.overdue ? { background: '#fff4f2' } : undefined}>
                    <td><bdi>{l.orderNumber || 'معلق'}</bdi></td>
                    <td>{l.kind === 'definite' ? 'بدهی قطعی' : 'تعهد (بی‌فاکتور)'}</td>
                    <td>{l.source}</td>
                    <td>{l.documentDate ? faDate(l.documentDate) : '—'}</td>
                    <td>{l.dueDate ? faDate(l.dueDate) : '—'}{l.overdue ? ' — گذشته از موعد' : ''}</td>
                    <Cell>{fmt(l.payable)}</Cell>
                    <Cell>{fmt(l.paid)}</Cell>
                    <Cell tone={l.open > 0 ? '#b3261e' : undefined}>{fmt(l.open)}</Cell>
                    <Cell tone={l.advance > 0 ? '#3c6835' : undefined}>{fmt(l.advance)}</Cell>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="document-secondary" onClick={() => onOpenOrder && onOpenOrder(l.orderId)}>همین سفارش</button>
                      {role === MANAGER && <button type="button" onClick={() => setApprovalFor(approvalFor === l.orderId ? '' : l.orderId)}>مجوز استثنایی</button>}
                    </td>
                  </tr>
                ))}
                {!(row.lines || []).length && <tr><td colSpan={10} className="document-empty">ردیف باز یا تعهدی برای این مشتری ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {approvalFor && <CreditApprovalForm
        key={approvalFor}
        customerId={row.customerId}
        orderId={approvalFor}
        summary={line ? `سفارش ${line.orderNumber || 'معلق'} — ماندهٔ باز این ردیف ${fmt(line.open)} ریال؛ اعدادِ سند از پروندهٔ هم‌زمان خوانده می‌شود.` : ''}
        onDone={() => { setApprovalFor(''); onReload(); }}
      />}
      {money ? (
        <div>
          <strong>اسناد مجوز استثنایی ({(row.approvals || []).length.toLocaleString('fa-IR')})</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            {(row.approvals || []).map(a => <ApprovalDocument key={a.id} approval={a} fmt={fmt} faDate={faDate} showOrder />)}
            {!(row.approvals || []).length && <div className="document-footnote">هنوز مجوز مستندی برای این مشتری ثبت نشده است.</div>}
          </div>
        </div>
      ) : (
        <div className="document-footnote">رقم‌های این پرونده برای نقش شما نمایش داده نمی‌شود؛ وضعیت و شمارش‌ها همان چیزی است که کارشناس سفارشات نیاز دارد.</div>
      )}
      {money && <div className="document-actions">
        <button type="button" className="document-secondary" onClick={() => setEditing(v => !v)}>{editing ? 'بستن ویرایش سیاست' : 'ویرایش سقف و مهلت'}</button>
      </div>}
    </div>
  );
}

export default function CreditFilesPanel({ data, role, fmt, faDate, onOpenOrder }) {
  const [openId, setOpenId] = useState(null);
  const rows = data.rows || [];
  const k = data.kpis;
  const money = !!data.money;
  const nf = v => fmt(Number(v) || 0);
  const heads = money
    ? ['مشتری', 'تلفن', 'سقف اعتبار', 'مهلت', 'بدهی قطعی', 'سررسیدگذشته', 'پیش‌پرداخت', 'تعهد', 'تعهد خالص', 'قابل استفاده', 'مصرف سقف', 'وضعیت', 'جزئیات']
    : ['مشتری', 'تلفن', 'فاکتورهای باز', 'سفارش‌های تأییدشده', 'وضعیت', 'جزئیات'];
  const cards = k ? [['مشتری‌های دارای پرونده', k.customers], ['سقف تعیین‌شده', k.withCeiling], ['در حالت هشدار', k.warning], ['مسدود', k.blocked], ['دارای ماندهٔ باز', k.openDebt], ['سررسیدگذشته', k.overdue], ['بی‌سقف', k.noPolicy]] : [];
  const allLines = rows.flatMap(r => (r.lines || []).map(l => ({ ...l, customerName: r.customerName })));
  return (
    <section className="document-panel" dir="rtl">
      <header className="document-heading">
        <div>
          <h2>پروندهٔ اعتباری مشتری‌ها</h2>
          <p>یک قاعده برای همهٔ ایستگاه‌ها: بدهی قطعی از فاکتورِ صادرشده، تعهد از سفارشِ تأییدشدهٔ بی‌فاکتور، تعهد خالص = بدهی قطعی + تعهد − پیش‌پرداختِ قابل‌استفاده، و اعتبار قابل‌استفاده = سقف − تعهد خالص.</p>
        </div>
        <button type="button" className="document-secondary" onClick={data.reload}>تازه‌سازی از سرور</button>
      </header>
      {data.error && <div className="document-error" role="alert">{data.error}</div>}
      {k && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {cards.map(([t, v]) => <div key={t} style={{ border: '1px solid #e3d8ce', borderRadius: 10, padding: '8px 10px', background: '#fbf7f3' }}>
            <div style={{ fontSize: 12, color: '#6b5d54' }}>{t}</div><div style={{ fontSize: 22, fontWeight: 800 }}>{nf(v)}</div>
          </div>)}
        </div>
      )}
      {!money && !data.error && <div className="document-footnote">نقش شما رقم‌ها را نمی‌بیند؛ جمع مطالبات و مبالغ فاکتور در «خلاصه مالی» چاپخانه ثبت می‌ماند.</div>}
      <div className="document-table-wrap">
        <table>
          <thead><tr>{heads.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(r => <CustomerRow key={r.customerId} row={r} money={money} heads={heads.length} fmt={fmt} faDate={faDate} role={role}
              open={openId === r.customerId} onToggle={() => setOpenId(openId === r.customerId ? null : r.customerId)}
              onOpenOrder={onOpenOrder} onReload={data.reload} />)}
            {!rows.length && !data.error && <tr><td colSpan={heads.length} className="document-empty">پرونده‌ای برای نمایش نیست — مشتری‌ای که نه سیاستی دارد و نه ردیف باز، در این جدول نمی‌آید.</td></tr>}
          </tbody>
        </table>
      </div>
      {money && (
        <div>
          <h3>همهٔ ردیف‌های باز (از همین پرونده‌ها)</h3>
          <div className="document-table-wrap" style={{ marginTop: 6 }}>
            <table>
              <thead><tr>{['مشتری', 'سفارش', 'نوع', 'منبع مبلغ', 'سررسید', 'مانده'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {allLines.map(l => <tr key={`${l.customerName}-${l.orderId}`} style={l.overdue ? { background: '#fff4f2' } : undefined}>
                  <td>{l.customerName}</td>
                  <td><bdi>{l.orderNumber || 'معلق'}</bdi></td>
                  <td>{l.kind === 'definite' ? 'بدهی قطعی' : 'تعهد'}</td>
                  <td>{l.source}</td>
                  <td>{l.dueDate ? faDate(l.dueDate) : '—'}{l.overdue ? ' — گذشته از موعد' : ''}</td>
                  <Cell tone={l.open > 0 ? '#b3261e' : undefined}>{fmt(l.open)}</Cell>
                </tr>)}
                {!allLines.length && <tr><td colSpan={6} className="document-empty">هیچ ماندهٔ باز یا تعهدی در کل سیستم ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="document-footnote">هر ردیف یک سند است؛ سقف اعتبار روی «تعهد خالص» همان مشتری اعمال می‌شود، نه روی جمع این ستون.</div>
        </div>
      )}
    </section>
  );
}

function CustomerRow({ row, money, heads, fmt, faDate, role, open, onToggle, onOpenOrder, onReload }) {
  return (
    <>
      <tr>
        <td style={{ fontWeight: 700 }}>{row.customerName || '—'}</td>
        <td><bdi>{row.phone || '—'}</bdi></td>
        {money ? <>
          <Cell>{fmt(row.ceiling)}</Cell>
          <Cell>{`${fmt(row.termDays)} روز`}</Cell>
          <Cell tone={row.definiteDebt > 0 ? '#b3261e' : undefined}>{fmt(row.definiteDebt)}</Cell>
          <Cell tone={row.overdueDebt > 0 ? '#b3261e' : undefined}>{fmt(row.overdueDebt)}</Cell>
          <Cell tone={row.advance > 0 ? '#3c6835' : undefined}>{fmt(row.advance)}</Cell>
          <Cell>{fmt(row.commitment)}</Cell>
          <Cell tone={row.netCommitment > 0 ? '#8a5a10' : undefined}>{fmt(row.netCommitment)}</Cell>
          <Cell tone={row.ceiling > 0 && row.available <= 0 ? '#b3261e' : undefined}>{fmt(row.available)}</Cell>
          <Cell tone={row.usedPercent > 100 ? '#b3261e' : row.usedPercent >= row.warnPercent ? '#8a5a10' : undefined}>{row.ceiling > 0 ? `${fmt(row.usedPercent)}٪` : '—'}</Cell>
        </> : <>
          <Cell>{fmt(row.openCount)}</Cell>
          <Cell>{fmt(row.committedCount)}</Cell>
        </>}
        <td><CreditStatusBadge status={row.status} /></td>
        <td><button type="button" className="document-secondary" aria-expanded={open} onClick={onToggle}>{open ? 'بستن' : 'دیدن پرونده'}</button></td>
      </tr>
      {open && <tr><td colSpan={heads} style={{ padding: 0 }}>
        <CustomerDetail row={row} money={money} role={role} fmt={fmt} faDate={faDate} onOpenOrder={onOpenOrder} onReload={onReload} />
      </td></tr>}
    </>
  );
}
