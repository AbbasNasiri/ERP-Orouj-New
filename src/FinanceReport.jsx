import { useEffect, useMemo, useState } from 'react';
import PrintPreview from './PrintPreview.jsx';
import { saveWorkbook } from './excel.js';
import './document-panels.css';

/* بند ۵/ث: گزارش مالی و تسویه. هیچ مبلغی اینجا ساخته نمی‌شود — فروش/پیش‌ازمالیات/دریافتی/باقی‌مانده و
   وضعیتِ سند را سرور در `financeReport` از snapshotِ سفارش و جدول اسناد می‌خواند (PRC-12).
   «مالیات ۱۰٪ فرضی» فقط پیش‌نمایش است (عدد قانونی نیست) و هیچ‌جا ذخیره نمی‌شود.
   «اتمام سفارش» تعریف‌نشده است؛ پس «وضعیت سند» واقعیتِ سند را نشان می‌دهد، نه پایان کار. */
const EMPTY = { from: '', to: '', customerId: '', docStatus: '', onlyDebt: false, taxPreview: false };
const iso = d => new Date(d).toISOString().slice(0, 10);
const DOC_LABEL = { invoice: 'فاکتور', quote: 'پیش‌فاکتور', none: 'بی‌سند' };

export default function FinanceReport({ customers = [], DateInput, faDate, fmt, onOpenOrder }) {
  const [draft, setDraft] = useState(EMPTY);
  const [query, setQuery] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState({ totalRecords: 0, salesPreTax: 0, received: 0, openDebt: 0, invoiceCount: 0, unansweredQuotes: 0, debtors: 0 });
  const [taxPreview, setTaxPreview] = useState(false);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(false);
  const nf = v => (fmt ? fmt(v) : String(v ?? ''));
  const df = d => (d ? (faDate ? faDate(d) : d) : '—');
  const money = v => (v === null || v === undefined ? '—' : nf(v));

  useEffect(() => {
    let alive = true;
    const api = window.printshopApi;
    if (!api || typeof api.financeReport !== 'function') { setRows([]); setError('گزارش مالی فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.'); return; }
    setError('');
    api.financeReport(query).then(
      res => { if (!alive) return; if (res && res.ok) { setRows(res.rows || []); setKpis(res.kpis || kpis); setTaxPreview(!!res.taxPreview); } else { setRows([]); setError((res && res.error) || 'خواندن گزارش ممکن نشد.'); } },
      () => { if (alive) { setRows([]); setError('خواندن گزارش ممکن نشد.'); } },
    );
    return () => { alive = false; };
  }, [query]);

  const customerOptions = useMemo(() => customers.filter(c => c && c.id).map(c => ({ id: c.id, name: c.name || c.id })), [customers]);
  const head = useMemo(() => {
    const cols = ['سفارش', 'مشتری', 'تاریخ', 'فروش (ریال)', 'دریافتی (ریال)', 'باقی‌مانده (ریال)', 'وضعیت سند', 'تأیید مشتری', 'مجوز تولید'];
    if (taxPreview) cols.push('مالیات ۱۰٪ فرضی (ریال)', 'جمع فرضی (ریال)');
    return cols;
  }, [taxPreview]);
  const cellRow = r => {
    const cells = [r.orderNumber || '—', r.customerName || '—', df(r.date), money(r.sales), money(r.received), money(r.balance),
      DOC_LABEL[r.docStatus] || '—', r.customerConfirmed ? 'بله' : 'خیر', r.hasLicense ? 'بله' : 'خیر'];
    if (taxPreview) cells.push(r.previewTax === undefined ? '—' : nf(r.previewTax), r.previewTotal === undefined ? '—' : nf(r.previewTotal));
    return cells;
  };
  const moneyCol = i => i === 3 || i === 4 || i === 5 || (taxPreview && (i === head.length - 2 || i === head.length - 1));

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
    const detail = [head, ...rows.map(r => cellRow(r).map((c, i) => (i === 2 ? (r.date || '') : c)))];
    const summary = [['شاخص', 'مقدار (ریال/عدد)'], ['کل رکوردها', kpis.totalRecords], ['فروش پیش از مالیات', kpis.salesPreTax],
      ['دریافت‌شده', kpis.received], ['بدهی باز', kpis.openDebt], ['فاکتور صادر', kpis.invoiceCount],
      ['پیش‌فاکتور بی‌پاسخ', kpis.unansweredQuotes], ['مشتری بدهکار', kpis.debtors]];
    saveWorkbook(`گزارش-مالی-${iso(new Date()).replace(/-/g, '')}.xlsx`, [{ name: 'گزارش مالی', rows: detail }, { name: 'شاخص‌ها', rows: summary }]);
  }

  const box = { padding: '5px 8px', border: '1px solid #d0c4b8', borderRadius: 7, fontSize: 13, background: '#fff', color: '#2b2320' };
  const chip = on => ({ ...box, cursor: 'pointer', fontWeight: on ? 800 : 500, background: on ? '#7a2048' : '#fff', color: on ? '#fff' : '#2b2320' });
  const cards = [
    ['فروش بازه (پیش از مالیات)', money(kpis.salesPreTax), 'از snapshotِ سفارش'],
    ['دریافت‌شده', money(kpis.received), 'جمع پرداخت‌ها'],
    ['بدهی باز', money(kpis.openDebt), 'فقط ماندهٔ مثبت'],
    ['فاکتور صادر', nf(kpis.invoiceCount), 'سند فاکتورِ صادرشده'],
    ['پیش‌فاکتور بی‌پاسخ', nf(kpis.unansweredQuotes), 'بدون تأیید مشتری'],
    ['مشتری بدهکار', nf(kpis.debtors), 'دارای ماندهٔ مثبت'],
  ];

  return (
    <section className="document-panel" dir="rtl">
      <header className="document-heading"><div><h2>گزارش مالی و تسویه</h2><p>هر مبلغ از snapshotِ ذخیره‌شده روی سفارش خوانده می‌شود؛ در این گزارش هیچ قیمتی دوباره حساب نمی‌شود. فقط مدیر چاپخانه و مدیر مالی این صفحه را می‌بینند.</p></div></header>

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
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>وضعیت سند
          <select value={draft.docStatus} onChange={e => set('docStatus', e.target.value)} style={box}>
            <option value="">همه</option><option value="invoice">فاکتور</option><option value="quote">پیش‌فاکتور</option><option value="none">بی‌سند</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>مشتری
          <select value={draft.customerId} onChange={e => set('customerId', e.target.value)} style={box}>
            <option value="">همه</option>{customerOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={draft.onlyDebt} onChange={e => set('onlyDebt', e.target.checked)} /> فقط دارای بدهی</label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}><input type="checkbox" checked={draft.taxPreview} onChange={e => set('taxPreview', e.target.checked)} /> محاسبهٔ مالیات ۱۰٪ (فرضی)</label>
        <button type="button" onClick={apply} style={{ ...box, cursor: 'pointer', fontWeight: 800 }}>اعمال فیلتر</button>
        <button type="button" onClick={reset} style={{ ...box, cursor: 'pointer' }}>پاک‌کردن</button>
        <button type="button" onClick={() => setPrinting(true)} disabled={!rows.length} style={{ ...box, cursor: 'pointer' }}>چاپ A4/A5</button>
        <button type="button" onClick={exportExcel} disabled={!rows.length} style={{ ...box, cursor: 'pointer' }}>خروجی اکسل ({nf(rows.length)} ردیف)</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
        {cards.map(([label, value, hint]) => (
          <div key={label} style={{ border: '1px solid #e3d8ce', borderRadius: 10, padding: '8px 10px', background: '#fbf7f3' }}>
            <div style={{ fontSize: 12, color: '#6b5d54' }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#2b2320' }}>{value}</div>
            <div style={{ fontSize: 11, color: '#8a7a70' }}>{hint}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ color: '#b3261e', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div className="document-table-wrap"><table><thead><tr>{[...head, 'اقدام'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {rows.map(r => <tr key={r.orderId} style={r.balance !== null && r.balance > 0 ? { background: '#fff4f2' } : undefined}>
          {cellRow(r).map((c, i) => <td key={i} style={{ textAlign: moneyCol(i) ? 'left' : undefined, color: i === 5 && r.balance !== null && r.balance > 0 ? '#b3261e' : undefined, fontWeight: i === 5 && r.balance > 0 ? 800 : undefined }}><bdi>{c}</bdi></td>)}
          <td>{onOpenOrder && <button type="button" onClick={() => onOpenOrder(r.orderId)} style={{ ...box, cursor: 'pointer' }}>همین سفارش</button>}</td>
        </tr>)}
        {!rows.length && !error && <tr><td colSpan={head.length + 1} className="document-empty">سفارشی با این مشخصات در بازه پیدا نشد.</td></tr>}
      </tbody></table></div>

      <div style={{ marginTop: 10, fontSize: 12, color: '#7a5a20', background: '#fdf6e3', border: '1px solid #e7d59f', borderRadius: 8, padding: '8px 10px' }}>
        محدودیت واقعی: «اتمام سفارش» هنوز تعریف نشده، پس «فروش» یعنی مجموعِ سفارش‌های دارای پیش‌فاکتورِ معتبر در بازه (نه فقط بسته‌شده‌ها)؛ برای دیدنِ «فاکتورشده» فیلتر «وضعیت سند = فاکتور» را بزنید. ستون «مالیات ۱۰٪» فقط پیش‌نمایشِ فرضی است، عدد قانونی نیست و هیچ‌جا ذخیره نمی‌شود. سفارش‌های بدون snapshot مبلغ «—» می‌گیرند، نه صفر.
      </div>

      {printing && (
        <PrintPreview onClose={() => setPrinting(false)} pdfName={`گزارش-مالی-${iso(new Date()).replace(/-/g, '')}`}>
          <ReportSheet settings={{ company: {} }} head={head} rows={rows.map(r => cellRow(r))} kpis={kpis} moneyCol={moneyCol} />
        </PrintPreview>
      )}
    </section>
  );
}

function ReportSheet({ settings, head, rows, kpis, moneyCol }) {
  const co = (settings && settings.company) || {};
  const th = { border: '1px solid #000', padding: '3px 4px', fontSize: 9, background: '#E6E6E6', fontWeight: 800, textAlign: 'center' };
  const td = { border: '1px solid #000', padding: '3px 4px', fontSize: 9, textAlign: 'center', verticalAlign: 'top' };
  return (
    <div style={{ direction: 'rtl', color: '#000', fontSize: 11 }}>
      <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{co.name || 'گزارش مالی و تسویه'}</div>
        <div style={{ fontWeight: 800, fontSize: 13 }}>گزارش مالی و تسویه</div>
        <div style={{ fontSize: 10, marginTop: 2 }}>{`فروش (پیش از مالیات): ${kpis.salesPreTax}  |  دریافتی: ${kpis.received}  |  بدهی باز: ${kpis.openDebt}  |  فاکتور: ${kpis.invoiceCount}  |  بی‌پاسخ: ${kpis.unansweredQuotes}  |  مشتری بدهکار: ${kpis.debtors}`}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{head.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>{r.map((c, j) => <td key={j} style={{ ...td, textAlign: moneyCol && moneyCol(j) ? 'left' : 'center' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
