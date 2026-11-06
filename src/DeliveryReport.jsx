import { useEffect, useMemo, useState } from 'react';
import PrintPreview from './PrintPreview.jsx';
import { saveWorkbook } from './excel.js';
import './document-panels.css';

/* بند ۵/ت: گزارش تحویل. هیچ عددی اینجا ساخته نمی‌شود — هر دو جدول («باید تحویل شود» و «تحویل‌شده در بازه»)
   را سرور در `deliveryReport` حساب می‌کند؛ این صفحه فقط فیلتر را می‌فرستد، نتیجه را می‌خواند و همان را چاپ/اکسل می‌کند.
   ستون پولی ندارد. محدودیت‌های واقعی در کادر قرمز اعلام شده‌اند. */
const EMPTY = { from: '', to: '', customerId: '', onlyOverdue: false };
const iso = d => new Date(d).toISOString().slice(0, 10);

export default function DeliveryReport({ customers = [], DateInput, faDate, fmt, onOpenOrder }) {
  const [draft, setDraft] = useState(EMPTY);
  const [query, setQuery] = useState(EMPTY);
  const [due, setDue] = useState([]);
  const [delivered, setDelivered] = useState([]);
  const [kpis, setKpis] = useState({ totalRecords: 0, dueCount: 0, dueOverdue: 0, dueReady: 0, deliveredCount: 0, deliveredLate: 0 });
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const nf = v => (fmt ? fmt(v) : String(v ?? ''));
  const df = d => (d ? (faDate ? faDate(d) : d) : '—');

  useEffect(() => {
    let alive = true;
    const api = window.printshopApi;
    if (!api || typeof api.deliveryReport !== 'function') { setDue([]); setDelivered([]); setError('گزارش تحویل فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.'); return; }
    setError('');
    api.deliveryReport(query).then(
      res => { if (!alive) return; if (res && res.ok) { setDue(res.due || []); setDelivered(res.delivered || []); setKpis(res.kpis || kpis); } else { setDue([]); setDelivered([]); setError((res && res.error) || 'خواندن گزارش ممکن نشد.'); } },
      () => { if (alive) { setDue([]); setDelivered([]); setError('خواندن گزارش ممکن نشد.'); } },
    );
    return () => { alive = false; };
  }, [query]);

  const customerOptions = useMemo(() => customers.filter(c => c && c.id).map(c => ({ id: c.id, name: c.name || c.id })), [customers]);
  const dueHead = ['سفارش', 'مشتری', 'محصول', 'موعد تحویل', 'روز تا موعد', 'مرحلهٔ فعلی', 'وضعیت', 'روش تحویل', 'نشانی', 'تحویل‌گیرنده', 'تماس'];
  const dueCell = r => [r.orderNumber || '—', r.customerName || '—', r.product, df(r.dueDate), r.daysToDue === null ? '—' : nf(r.daysToDue),
    r.stage, r.status || '—', r.method || '—', r.address || '—', r.receiver || '—', r.phone || '—'];
  const delHead = ['سفارش', 'مشتری', 'محصول', 'تاریخ تحویل', 'ثبت‌کنندهٔ تحویل (سرور)', 'موعد', 'تأخیر', 'روش تحویل', 'نشانی', 'تحویل‌گیرنده (فرم)'];
  const delCell = r => [r.orderNumber || '—', r.customerName || '—', r.product, df(r.deliveredAt),
    r.deliveredByName ? `${r.deliveredByName}${r.deliveredByRole ? ` — ${r.deliveredByRole}` : ''}` : '—',
    df(r.dueDate), r.late ? 'دیرکرد' : 'به‌موقع', r.method || '—', r.address || '—', r.receiver || '—'];

  function shortcut(kind) {
    const now = new Date();
    let from = '', to = '';
    if (kind === 'today') { from = to = iso(now); }
    else if (kind === 'week') { from = iso(now.getTime() - 6 * 86400000); to = iso(now); }
    else if (kind === 'month') { from = iso(new Date(now.getFullYear(), now.getMonth(), 1)); to = iso(now); }
    setDraft(d => ({ ...d, from, to }));
  }
  const set = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));
  const apply = () => setQuery({ ...draft });
  const reset = () => { setDraft(EMPTY); setQuery(EMPTY); };

  const hasRows = due.length > 0 || delivered.length > 0;
  function exportExcel() {
    const dueSheet = [dueHead, ...due.map(r => dueCell(r).map((c, i) => (i === 3 ? (r.dueDate || '') : c)))];
    const delSheet = [delHead, ...delivered.map(r => delCell(r).map((c, i) => (i === 3 ? (r.deliveredAt || '') : i === 5 ? (r.dueDate || '') : c)))];
    const summary = [['شاخص', 'مقدار'], ['کل رکوردها', kpis.totalRecords], ['باید تحویل شود', kpis.dueCount],
      ['گذشته از موعد', kpis.dueOverdue], ['آمادهٔ تحویل', kpis.dueReady], ['تحویل‌شده در بازه', kpis.deliveredCount], ['تحویل با دیرکرد', kpis.deliveredLate]];
    saveWorkbook(`گزارش-تحویل-${iso(new Date()).replace(/-/g, '')}.xlsx`, [{ name: 'باید تحویل شود', rows: dueSheet }, { name: 'تحویل‌شده', rows: delSheet }, { name: 'شاخص‌ها', rows: summary }]);
  }

  const box = { padding: '5px 8px', border: '1px solid #d0c4b8', borderRadius: 7, fontSize: 13, background: '#fff', color: '#2b2320' };
  const chip = on => ({ ...box, cursor: 'pointer', fontWeight: on ? 800 : 500, background: on ? '#7a2048' : '#fff', color: on ? '#fff' : '#2b2320' });
  const cards = [
    ['باید تحویل شود', kpis.dueCount, `از ${nf(kpis.totalRecords)} رکورد کل`],
    ['گذشته از موعد', kpis.dueOverdue, 'قرمز در جدول اول'],
    ['آمادهٔ تحویل', kpis.dueReady, 'مرحلهٔ آخر تمام'],
    ['تحویل‌شده در بازه', kpis.deliveredCount, 'دارای تاریخ تحویل'],
    ['تحویل با دیرکرد', kpis.deliveredLate, 'تاریخ تحویل بعد از موعد'],
  ];

  return (
    <section className="document-panel" dir="rtl">
      <header className="document-heading"><div><h2>گزارش تحویل</h2><p>دو جدول: «باید تحویل شود» بر اساس موعدِ ثبت‌شده و «تحویل‌شده در بازه» بر اساس تاریخِ تحویلِ سروری. اعداد و تاریخ‌ها را سرور حساب می‌کند؛ این صفحه فقط می‌خواند.</p></div></header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>از تاریخ
          <div style={{ minWidth: 150 }}>{DateInput ? <DateInput value={draft.from} onChange={v => set('from', v)} /> : <input type="date" value={draft.from} onChange={e => set('from', e.target.value)} style={box} />}</div>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>تا تاریخ
          <div style={{ minWidth: 150 }}>{DateInput ? <DateInput value={draft.to} onChange={v => set('to', v)} /> : <input type="date" value={draft.to} onChange={e => set('to', e.target.value)} style={box} />}</div>
        </label>
        <span style={{ fontSize: 11, color: '#6b5d54' }}>بازه هم روی موعدِ جدول اول و هم روی تاریخ تحویلِ جدول دوم اعمال می‌شود.</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>میان‌بر:
          <button type="button" style={chip(!draft.from && !draft.to)} onClick={() => shortcut('all')}>همه</button>
          <button type="button" style={chip(draft.from && draft.from === draft.to && draft.to === iso(new Date()))} onClick={() => shortcut('today')}>امروز</button>
          <button type="button" style={chip(false)} onClick={() => shortcut('week')}>۷ روز</button>
          <button type="button" style={chip(false)} onClick={() => shortcut('month')}>این ماه</button>
        </span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>مشتری
          <select value={draft.customerId} onChange={e => set('customerId', e.target.value)} style={box}>
            <option value="">همه</option>{customerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={draft.onlyOverdue} onChange={e => set('onlyOverdue', e.target.checked)} /> فقط گذشته از موعد (جدول اول)</label>
        <button type="button" onClick={apply} style={{ ...box, cursor: 'pointer', fontWeight: 800 }}>اعمال فیلتر</button>
        <button type="button" onClick={reset} style={{ ...box, cursor: 'pointer' }}>پاک‌کردن</button>
        <button type="button" onClick={() => setPrinting(true)} disabled={!hasRows} style={{ ...box, cursor: 'pointer' }}>چاپ A4/A5</button>
        <button type="button" onClick={exportExcel} disabled={!hasRows} style={{ ...box, cursor: 'pointer' }}>خروجی اکسل ({nf(due.length + delivered.length)} ردیف)</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        {cards.map(([label, value, hint]) => (
          <div key={label} style={{ border: '1px solid #e3d8ce', borderRadius: 10, padding: '8px 10px', background: '#fbf7f3' }}>
            <div style={{ fontSize: 12, color: '#6b5d54' }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#2b2320' }}>{nf(value)}</div>
            <div style={{ fontSize: 11, color: '#8a7a70' }}>{hint}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ color: '#b3261e', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <h3 style={{ fontSize: 14, margin: '6px 0 6px', color: '#2b2320' }}>باید تحویل شود (بر اساس موعد ثبت‌شده)</h3>
      <div className="document-table-wrap"><table><thead><tr>{[...dueHead, 'اقدام'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {due.map(r => <tr key={r.orderId} style={r.overdue ? { background: '#fff4f2' } : r.ready ? { background: '#f1f8f2' } : undefined}>
          {dueCell(r).map((c, i) => <td key={i} style={i === 4 && r.overdue ? { color: '#b3261e', fontWeight: 800 } : undefined}><bdi>{c}</bdi></td>)}
          <td>{onOpenOrder && <button type="button" onClick={() => onOpenOrder(r.orderId)} style={{ ...box, cursor: 'pointer' }}>همین سفارش</button>}</td>
        </tr>)}
        {!due.length && !error && <tr><td colSpan={dueHead.length + 1} className="document-empty">سفارش در انتظار تحویلی با این مشخصات نیست.</td></tr>}
      </tbody></table></div>

      <h3 style={{ fontSize: 14, margin: '14px 0 6px', color: '#2b2320' }}>تحویل‌شده در بازه</h3>
      <div className="document-table-wrap"><table><thead><tr>{delHead.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {delivered.map(r => <tr key={r.orderId} style={r.late ? { background: '#fff4f2' } : undefined}>
          {delCell(r).map((c, i) => <td key={i} style={i === 6 && r.late ? { color: '#b3261e', fontWeight: 800 } : undefined}><bdi>{c}</bdi></td>)}
        </tr>)}
        {!delivered.length && !error && <tr><td colSpan={delHead.length} className="document-empty">در این بازه سفارشی تحویل نشده است.</td></tr>}
      </tbody></table></div>

      <div style={{ marginTop: 10, fontSize: 12, color: '#a12a20', background: '#fdecea', border: '1px solid #e6a8a0', borderRadius: 8, padding: '8px 10px' }}>
        محدودیت واقعی: «تاریخ آماده‌سازی» فیلد جداگانه ندارد؛ تحویل فقط وضعیت و تاریخ/ثبت‌کننده را می‌نویسد. ستون «تحویل‌گیرنده» همان مقدارِ تایپ‌شده در فرم است، نه امضای احرازشدهٔ مشتری. تحویلِ سفارش هیچ کالای امانی مشتری را به انبار برنمی‌گرداند. این گزارش ستون مبلغ ندارد.
      </div>

      {printing && (
        <PrintPreview onClose={() => setPrinting(false)} pdfName={`گزارش-تحویل-${iso(new Date()).replace(/-/g, '')}`}>
          <ReportSheet settings={{ company: {} }} dueHead={dueHead} due={due.map(r => dueCell(r))} delHead={delHead} delivered={delivered.map(r => delCell(r))} kpis={kpis} />
        </PrintPreview>
      )}
    </section>
  );
}

function ReportSheet({ settings, dueHead, due, delHead, delivered, kpis }) {
  const co = (settings && settings.company) || {};
  const th = { border: '1px solid #000', padding: '3px 4px', fontSize: 9, background: '#E6E6E6', fontWeight: 800, textAlign: 'center' };
  const td = { border: '1px solid #000', padding: '3px 4px', fontSize: 9, textAlign: 'center', verticalAlign: 'top' };
  const table = (title, head, rows) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 11, marginBottom: 3 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{head.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}</tbody>
      </table>
      {!rows.length && <div style={{ fontSize: 9, color: '#555' }}>—</div>}
    </div>
  );
  return (
    <div style={{ direction: 'rtl', color: '#000', fontSize: 11 }}>
      <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{co.name || 'گزارش تحویل'}</div>
        <div style={{ fontWeight: 800, fontSize: 13 }}>گزارش تحویل</div>
        <div style={{ fontSize: 10, marginTop: 2 }}>{`باید تحویل شود: ${kpis.dueCount}  |  گذشته از موعد: ${kpis.dueOverdue}  |  آماده: ${kpis.dueReady}  |  تحویل‌شده: ${kpis.deliveredCount}  |  دیرکرد: ${kpis.deliveredLate}`}</div>
      </div>
      {table('باید تحویل شود (بر اساس موعد ثبت‌شده)', dueHead, due)}
      {table('تحویل‌شده در بازه', delHead, delivered)}
    </div>
  );
}
