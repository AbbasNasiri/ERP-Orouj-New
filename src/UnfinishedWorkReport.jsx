import { useEffect, useMemo, useState } from 'react';
import PrintPreview from './PrintPreview.jsx';
import { saveWorkbook } from './excel.js';
import './document-panels.css';

/* بند ۵/پ: گزارش کارهای ناتمام. هیچ عددی اینجا ساخته نمی‌شود — مرحلهٔ فعلی، واحد مسئول،
   آخرین تحرک، روز بی‌تحرک، فاصله تا موعد و بدهی را سرور در `unfinishedWork` حساب می‌کند؛
   این صفحه فقط فیلتر را می‌فرستد، نتیجه را می‌خواند و همان را چاپ/اکسل می‌کند.
   «علت انتظار» و «مسئول پیگیری» عمداً ستون ندارند: چنین فیلدی در سفارش ثبت نمی‌شود. */
const STAGES = ['ثبت سفارش', 'طراحی و پروف', 'لیتوگرافی و زینک', 'چاپ افست', 'چاپ دیجیتال', 'صحافی و تکمیلی', 'برش و تکمیلی', 'کنترل کیفیت و تحویل به مشتری',
  'طراحی', 'پروف', 'لیتوگرافی', 'چاپ', 'صحافی', 'خدمات تکمیلی', 'کنترل کیفیت', 'تحویل'];
const EMPTY = { from: '', to: '', stage: '', customerId: '', onlyOverdue: false, onlyNoLicense: false };
const iso = d => new Date(d).toISOString().slice(0, 10);

export default function UnfinishedWorkReport({ customers = [], DateInput, faDate, fmt, onOpenOrder }) {
  const [draft, setDraft] = useState(EMPTY);
  const [query, setQuery] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState({ totalRecords: 0, open: 0, overdue: 0, awaitingMaterial: 0, idle7: 0, ready: 0, noLicense: 0 });
  const [moneyIncluded, setMoneyIncluded] = useState(false);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const nf = v => (fmt ? fmt(v) : String(v ?? ''));
  const df = d => (d ? (faDate ? faDate(d) : d) : '—');

  useEffect(() => {
    let alive = true;
    const api = window.printshopApi;
    if (!api || typeof api.unfinishedWork !== 'function') { setRows([]); setError('گزارش کارهای ناتمام فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.'); return; }
    setError('');
    api.unfinishedWork(query).then(
      res => { if (!alive) return; if (res && res.ok) { setRows(res.rows || []); setKpis(res.kpis || kpis); setMoneyIncluded(!!res.moneyIncluded); } else { setRows([]); setError((res && res.error) || 'خواندن گزارش ممکن نشد.'); } },
      () => { if (alive) { setRows([]); setError('خواندن گزارش ممکن نشد.'); } },
    );
    return () => { alive = false; };
  }, [query]);

  const customerOptions = useMemo(() => customers.filter(c => c && c.id).map(c => ({ id: c.id, name: c.name || c.id })), [customers]);
  const head = useMemo(() => {
    const cols = ['سفارش', 'مشتری', 'محصول', 'مرحلهٔ فعلی', 'واحد مسئول', 'آخرین تحرک', 'روز بی‌تحرک', 'موعد تحویل', 'روز تا موعد'];
    if (moneyIncluded) cols.push('بدهی (ریال)');
    return cols;
  }, [moneyIncluded]);
  const cellRow = r => {
    const cells = [r.orderNumber || '—', r.customerName || '—', r.product, r.stage, r.unit, df(r.lastMovement),
      r.idleDays === null ? '—' : nf(r.idleDays), df(r.dueDate), r.daysToDue === null ? '—' : nf(r.daysToDue)];
    if (moneyIncluded) cells.push(r.debt === null || r.debt === undefined ? '—' : nf(r.debt));
    return cells;
  };

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

  function exportExcel() {
    const detail = [head, ...rows.map(r => cellRow(r).map((c, i) => {
      if (i === 5) return r.lastMovement || '';
      if (i === 7) return r.dueDate || '';
      return c;
    }))];
    const summary = [['شاخص', 'مقدار'], ['کل رکوردها', kpis.totalRecords], ['سفارش باز', kpis.open], ['گذشته از موعد', kpis.overdue],
      ['در انتظار ماده', kpis.awaitingMaterial], ['بی‌تحرک بیش از ۷ روز', kpis.idle7], ['آماده تحویل', kpis.ready], ['بدون مجوز تولید', kpis.noLicense]];
    saveWorkbook(`کارهای-ناتمام-${iso(new Date()).replace(/-/g, '')}.xlsx`, [{ name: 'کارهای ناتمام', rows: detail }, { name: 'شاخص‌ها', rows: summary }]);
  }

  const box = { padding: '5px 8px', border: '1px solid #d0c4b8', borderRadius: 7, fontSize: 13, background: '#fff', color: '#2b2320' };
  const chip = on => ({ ...box, cursor: 'pointer', fontWeight: on ? 800 : 500, background: on ? '#7a2048' : '#fff', color: on ? '#fff' : '#2b2320' });
  const cards = [
    ['سفارش باز', kpis.open, `از ${nf(kpis.totalRecords)} رکورد کل`],
    ['گذشته از موعد', kpis.overdue, 'قرمز در جدول'],
    ['در انتظار ماده', kpis.awaitingMaterial, 'کسری تأمین‌نشده'],
    ['بی‌تحرک بیش از ۷ روز', kpis.idle7, 'از آخرین گردش'],
    ['آماده تحویل', kpis.ready, 'مرحلهٔ آخر تمام'],
    ['بدون مجوز تولید', kpis.noLicense, 'تأیید مشتری/مدیر مانده'],
  ];

  return (
    <section className="document-panel" dir="rtl">
      <header className="document-heading"><div><h2>گزارش کارهای ناتمام</h2><p>«باز» یعنی هنوز به تحویل/لغو/بایگانی نرسیده. مرحله، تحرک و بدهی را سرور حساب می‌کند؛ این صفحه فقط می‌خواند.</p></div></header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>از تاریخ
          <div style={{ minWidth: 150 }}>{DateInput ? <DateInput value={draft.from} onChange={v => set('from', v)} /> : <input type="date" value={draft.from} onChange={e => set('from', e.target.value)} style={box} />}</div>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>تا تاریخ
          <div style={{ minWidth: 150 }}>{DateInput ? <DateInput value={draft.to} onChange={v => set('to', v)} /> : <input type="date" value={draft.to} onChange={e => set('to', e.target.value)} style={box} />}</div>
        </label>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>میان‌بر:
          <button type="button" style={chip(!draft.from && !draft.to)} onClick={() => shortcut('all')}>همه</button>
          <button type="button" style={chip(draft.from && draft.from === draft.to && draft.to === iso(new Date()))} onClick={() => shortcut('today')}>امروز</button>
          <button type="button" style={chip(false)} onClick={() => shortcut('week')}>۷ روز</button>
          <button type="button" style={chip(false)} onClick={() => shortcut('month')}>این ماه</button>
        </span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>مرحله
          <select value={draft.stage} onChange={e => set('stage', e.target.value)} style={box}>
            <option value="">همهٔ مراحل</option>{STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>مشتری
          <select value={draft.customerId} onChange={e => set('customerId', e.target.value)} style={box}>
            <option value="">همه</option>{customerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={draft.onlyOverdue} onChange={e => set('onlyOverdue', e.target.checked)} /> فقط عقب‌افتاده</label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={draft.onlyNoLicense} onChange={e => set('onlyNoLicense', e.target.checked)} /> بدون مجوز تولید</label>
        <button type="button" onClick={apply} style={{ ...box, cursor: 'pointer', fontWeight: 800 }}>اعمال فیلتر</button>
        <button type="button" onClick={reset} style={{ ...box, cursor: 'pointer' }}>پاک‌کردن</button>
        <button type="button" onClick={() => setPrinting(true)} disabled={!rows.length} style={{ ...box, cursor: 'pointer' }}>چاپ A4/A5</button>
        <button type="button" onClick={exportExcel} disabled={!rows.length} style={{ ...box, cursor: 'pointer' }}>خروجی اکسل ({nf(rows.length)} ردیف)</button>
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

      <div className="document-table-wrap"><table><thead><tr>{[...head, 'اقدام'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {rows.map(r => <tr key={r.orderId} style={r.overdue ? { background: '#fff4f2' } : r.ready ? { background: '#f1f8f2' } : undefined}>
          {cellRow(r).map((c, i) => <td key={i} style={i === head.length - 1 && r.overdue ? { color: '#b3261e', fontWeight: 800 } : undefined}><bdi>{c}</bdi></td>)}
          <td>{onOpenOrder && <button type="button" onClick={() => onOpenOrder(r.orderId)} style={{ ...box, cursor: 'pointer' }}>همین سفارش</button>}</td>
        </tr>)}
        {!rows.length && !error && <tr><td colSpan={head.length + 1} className="document-empty">سفارش بازی با این مشخصات پیدا نشد.</td></tr>}
      </tbody></table></div>

      <div style={{ marginTop: 10, fontSize: 12, color: '#7a5a20', background: '#fdf6e3', border: '1px solid #e7d59f', borderRadius: 8, padding: '8px 10px' }}>
        محدودیت واقعی: «علت انتظار» و «مسئول پیگیری» در این گزارش نیست، چون چنین فیلدی در سفارش ثبت نمی‌شود. «آخرین تحرک» از تاریخِ گردشِ سروری خوانده می‌شود. ستون «بدهی» فقط برای مدیر چاپخانه و مدیر مالی نمایش داده می‌شود؛ برای بقیهٔ نقش‌ها اصلاً ساخته نمی‌شود.
      </div>

      {printing && (
        <PrintPreview onClose={() => setPrinting(false)} pdfName={`کارهای-ناتمام-${iso(new Date()).replace(/-/g, '')}`}>
          <ReportSheet settings={{ company: {} }} head={head} rows={rows.map(r => cellRow(r))} kpis={kpis} />
        </PrintPreview>
      )}
    </section>
  );
}

function ReportSheet({ settings, head, rows, kpis }) {
  const co = (settings && settings.company) || {};
  const th = { border: '1px solid #000', padding: '3px 4px', fontSize: 9, background: '#E6E6E6', fontWeight: 800, textAlign: 'center' };
  const td = { border: '1px solid #000', padding: '3px 4px', fontSize: 9, textAlign: 'center', verticalAlign: 'top' };
  return (
    <div style={{ direction: 'rtl', color: '#000', fontSize: 11 }}>
      <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{co.name || 'گزارش کارهای ناتمام'}</div>
        <div style={{ fontWeight: 800, fontSize: 13 }}>گزارش کارهای ناتمام</div>
        <div style={{ fontSize: 10, marginTop: 2 }}>{`باز: ${kpis.open}  |  گذشته از موعد: ${kpis.overdue}  |  در انتظار ماده: ${kpis.awaitingMaterial}  |  آماده تحویل: ${kpis.ready}  |  بدون مجوز: ${kpis.noLicense}`}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{head.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
