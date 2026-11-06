import { useEffect, useMemo, useState } from 'react';
import PrintPreview from './PrintPreview.jsx';
import { saveWorkbook } from './excel.js';
import { faDigits } from './smart.js';
import './document-panels.css';

const EMPTY = { ownerType: '', itemId: '', from: '', to: '' };
const moveNo = r => faDigits(r.movementNumber || 'قدیمی');

/* بند ۵/ب: کاردکس و گردش انبار. هیچ عددی اینجا ساخته نمی‌شود — ردیف‌ها، نام ثبت‌کننده
   و «مانده پس از گردش» را سرور در `stockCardex` حساب می‌کند؛ این صفحه فقط فیلتر را
   می‌فرستد، نتیجه را می‌خواند و همان را چاپ/اکسل می‌کند. */
export default function InventoryMovements({ inventory = [], settings, DateInput, faDate, fmt }) {
  const [draft, setDraft] = useState(EMPTY);
  const [query, setQuery] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const nf = v => (fmt ? fmt(v) : String(v ?? ''));
  const df = iso => (faDate ? faDate(iso) : (iso || '—'));

  useEffect(() => {
    let alive = true;
    const api = window.printshopApi;
    if (!api || typeof api.stockCardex !== 'function') { setRows([]); setError('کاردکس فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.'); return; }
    setError('');
    api.stockCardex(query).then(
      res => { if (!alive) return; if (res && res.ok) setRows(res.rows || []); else { setRows([]); setError((res && res.error) || 'خواندن کاردکس ممکن نشد.'); } },
      () => { if (alive) { setRows([]); setError('خواندن کاردکس ممکن نشد.'); } },
    );
    return () => { alive = false; };
  }, [query]);

  const itemOptions = useMemo(() => inventory.filter(i => i && i.id).map(i => ({ id: i.id, name: i.name || i.id })), [inventory]);
  const summary = useMemo(() => {
    const byItem = new Map();
    for (const r of rows) {
      let e = byItem.get(r.itemId);
      if (!e) { e = { name: r.itemName, owner: r.ownerType, unit: r.unit, inQty: 0, outQty: 0, lastDate: '', closing: 0 }; byItem.set(r.itemId, e); }
      if (r.type === 'in') e.inQty += Number(r.qty) || 0; else e.outQty += Number(r.qty) || 0;
      if (String(r.date) >= String(e.lastDate)) { e.lastDate = r.date; e.closing = r.running; }
    }
    return [...byItem.values()];
  }, [rows]);

  const label = f => (f.ownerType === 'مشتری' ? 'مشتری' : f.ownerType === 'چاپخانه' ? 'چاپخانه' : 'همه');
  const rangeText = `${query.from ? df(query.from) : 'آغاز'} تا ${query.to ? df(query.to) : 'امروز'}`;
  const itemText = query.itemId ? (itemOptions.find(o => o.id === query.itemId)?.name || '—') : 'همه';

  const printHead = ['شماره گردش', 'کالا', 'تاریخ', 'نوع', 'مقدار', 'واحد', 'مرجع سفارش', 'ثبت‌کننده', 'مالک', 'مانده پس از گردش', 'شرح'];
  const printRows = rows.map(r => [moveNo(r), r.itemName, df(r.date), r.type === 'in' ? 'ورود' : 'خروج', nf(r.qty), r.unit, r.orderNumber || '—', r.actorName || '—', r.ownerType, nf(r.running), r.note || '—']);

  function exportExcel() {
    const moves = [printHead, ...rows.map(r => [r.movementNumber || 'قدیمی', r.itemName, r.date, r.type === 'in' ? 'ورود' : 'خروج', r.qty, r.unit, r.orderNumber || '', r.actorName || '', r.ownerType, r.running, r.note || ''])];
    const sums = [['کالا', 'مالک', 'واحد', 'جمع ورود', 'جمع خروج', 'ماندهٔ پایان'], ...summary.map(e => [e.name, e.owner, e.unit, e.inQty, e.outQty, e.closing])];
    saveWorkbook(`کاردکس-${df(new Date().toISOString().slice(0, 10)).replace(/\//g, '-')}.xlsx`, [{ name: 'گردش کالا', rows: moves }, { name: 'خلاصهٔ کالا', rows: sums }]);
  }

  const set = (k, v) => setDraft(prev => ({ ...prev, [k]: v }));
  const apply = () => setQuery({ ...draft });
  const reset = () => { setDraft(EMPTY); setQuery(EMPTY); };
  const box = { padding: '5px 8px', border: `1px solid #d0c4b8`, borderRadius: 7, fontSize: 13, background: '#fff', color: '#2b2320' };

  return (
    <section className="document-panel" dir="rtl">
      <header className="document-heading"><div><h2>کاردکس و گردش انبار</h2><p>شماره گردش مستقل است؛ ارجاع به تولید با شماره سفارش انجام می‌شود. ماندهٔ «پس از گردش» از ابتدای بازهٔ انتخابی جمع می‌شود.</p></div></header>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>مالک
          <select value={draft.ownerType} onChange={e => set('ownerType', e.target.value)} style={box}>
            <option value="">همه</option><option value="چاپخانه">چاپخانه</option><option value="مشتری">مشتری</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>کالا
          <select value={draft.itemId} onChange={e => set('itemId', e.target.value)} style={box}>
            <option value="">همه کالاها</option>{itemOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>از تاریخ
          <div style={{ minWidth: 150 }}>{DateInput ? <DateInput value={draft.from} onChange={v => set('from', v)} /> : <input type="date" value={draft.from} onChange={e => set('from', e.target.value)} style={box} />}</div>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>تا تاریخ
          <div style={{ minWidth: 150 }}>{DateInput ? <DateInput value={draft.to} onChange={v => set('to', v)} /> : <input type="date" value={draft.to} onChange={e => set('to', e.target.value)} style={box} />}</div>
        </label>
        <button type="button" onClick={apply} style={{ ...box, cursor: 'pointer', fontWeight: 800 }}>اعمال فیلتر</button>
        <button type="button" onClick={reset} style={{ ...box, cursor: 'pointer' }}>پاک‌کردن</button>
        <button type="button" onClick={() => setPrinting(true)} disabled={!rows.length} style={{ ...box, cursor: 'pointer' }}>چاپ A4/A5</button>
        <button type="button" onClick={exportExcel} disabled={!rows.length} style={{ ...box, cursor: 'pointer' }}>خروجی اکسل ({nf(rows.length)} ردیف)</button>
      </div>
      {error && <div style={{ color: '#b3261e', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div className="document-table-wrap"><table><thead><tr>{printHead.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {rows.map((r, i) => <tr key={r.itemId + ':' + (r.movementNumber || '') + ':' + r.date + ':' + i}>
          <td><bdi>{moveNo(r)}</bdi></td><td>{r.itemName}</td><td>{df(r.date)}</td><td>{r.type === 'in' ? 'ورود' : 'خروج'}</td>
          <td><bdi>{nf(r.qty)}</bdi></td><td>{r.unit}</td><td><bdi>{r.orderNumber || '—'}</bdi></td><td>{r.actorName || '—'}</td><td>{r.ownerType}</td>
          <td><bdi>{nf(r.running)}</bdi></td><td>{r.note || '—'}</td>
        </tr>)}
        {!rows.length && !error && <tr><td colSpan={printHead.length} className="document-empty">گردشی با این مشخصات ثبت نشده است.</td></tr>}
      </tbody></table></div>
      {printing && (
        <PrintPreview onClose={() => setPrinting(false)} pdfName={`کاردکس-${df(query.from || '').replace(/\//g, '-')}`}>
          <CardexSheet settings={settings} head={printHead} rows={printRows} meta={[['مالک', label(query)], ['کالا', itemText], ['بازهٔ تاریخ', rangeText]]} />
        </PrintPreview>
      )}
    </section>
  );
}

function CardexSheet({ settings, head, rows, meta }) {
  const co = (settings && settings.company) || {};
  const th = { border: '1px solid #000', padding: '3px 4px', fontSize: 9.5, background: '#E6E6E6', fontWeight: 800, textAlign: 'center' };
  const td = { border: '1px solid #000', padding: '3px 4px', fontSize: 9.5, textAlign: 'center', verticalAlign: 'top' };
  return (
    <div style={{ direction: 'rtl', color: '#000', fontSize: 11 }}>
      <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{co.name || 'کاردکس و گردش انبار'}</div>
        <div style={{ fontWeight: 800, fontSize: 13 }}>کاردکس و گردش انبار</div>
        <div style={{ fontSize: 10, marginTop: 2 }}>{meta.map(([k, v]) => `${k}: ${v}`).join('  |  ')}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{head.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
