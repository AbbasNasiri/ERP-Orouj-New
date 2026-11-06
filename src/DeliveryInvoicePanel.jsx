import { useEffect, useState } from 'react';
import { faDigits } from './smart.js';
import './document-panels.css';

/* اصلاحات ۱۷/بند ۳/۳: «الان روی این سفارش چند ریال قابل صورتحساب است» را فقط سرور می‌شمارد
   (be:invoiceProposal از پیش‌فاکتورِ تأییدشده + سه عددِ هر قلم + دفتر صورتحساب). این پنل
   هیچ ریالی نمی‌سازد: ردیف‌ها و جمع‌ها را همان‌طور که be:invoiceProposal می‌دهد نشان می‌دهد،
   و صدور فقط با be:documentAction(issue_partial_invoice) است. «چرا هنوز نه» هم از همان
   قاعدهٔ صدور می‌آید (canIssue/issueBlock)، پس پنل عددی را که سرور رد می‌کند آماده نمی‌کند. */

const fa = value => Number(value || 0).toLocaleString('fa-IR');
const ROLE_LABEL = { per_copy: 'هر نسخه‌ای', fixed: 'ثابت (یک‌بار)' };
const tile = { border: '1px solid #e3d8ce', borderRadius: 10, padding: '7px 10px', background: '#fbf7f3' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 };

function Money({ label, value, hint, strong }) {
  return <div title={hint} style={{ ...tile, ...(strong ? { borderColor: '#b9976b', background: '#fbf3e6' } : {}) }}>
    <div style={{ fontSize: 12, color: '#6b5d54' }}>{label}</div>
    <div style={{ fontSize: 19, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}><bdi>{`${fa(Number(value) || 0)} ریال`}</bdi></div>
  </div>;
}

export default function DeliveryInvoicePanel({ orders = [], onIssuePartial, onProposal, onRefresh }) {
  const [orderId, setOrderId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce(n => n + 1);

  /* «message» بی این effect پاک نمی‌شود: صدور موفق، nonce را بالا می‌برد تا پیشنهاد تازه
     خوانده شود و پاک‌کردنِ اینجا پیامِ «صادر شد» را در همان دورِ رندر محو می‌کرد. */
  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    if (!orderId || typeof onProposal !== 'function') return undefined;
    onProposal(orderId).then(
      result => { if (!alive) return; if (result && result.ok) setData(result); else setError((result && result.error) || 'پیشنهاد صورتحساب از سرور خوانده نشد.'); },
      () => { if (alive) setError('پیشنهاد صورتحساب از سرور خوانده نشد؛ اتصال با خطا روبه‌رو شد.'); },
    );
    return () => { alive = false; };
  }, [orderId, nonce]);

  async function issue() {
    if (busy || !data || !data.canIssue) return;
    setBusy('issue'); setError(''); setMessage('');
    try {
      const result = await onIssuePartial(data.orderId);
      if (result && result.ok) {
        setMessage(result.document?.number ? `فاکتور تحویلی با شمارهٔ ${faDigits(result.document.number)} صادر شد؛ ردیف‌های آن در دفتر صورتحساب قفل شد.` : 'فاکتور تحویلی صادر شد.');
        setNonce(n => n + 1);
        if (typeof onRefresh === 'function') await onRefresh().catch(() => {});
      } else setError((result && result.error) || 'فاکتور تحویلی صادر نشد.');
    } catch (failure) { setError(failure?.message || 'فاکتور تحویلی صادر نشد.'); }
    finally { setBusy(''); }
  }

  const rows = data?.rows || [];
  const items = data?.items || [];
  const invoices = data?.invoices || [];
  const totals = data?.totals || {};
  const cumulative = data?.cumulative || {};
  const billed = invoices.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0);

  return <section className="document-panel" dir="rtl">
    <header className="document-heading">
      <div>
        <h2>فاکتور تحویلی — بر مبنای مقدار تحویل‌شده</h2>
        <p>هر تحویل می‌تواند فاکتورِ خودش را داشته باشد. ردیف‌های «هر نسخه‌ای» به اندازهٔ تحویلِ تازه طلب می‌شوند و ردیف‌های ثابت (زینک، کاغذِ ورق، جلدِ ورق) یک‌بار کامل؛ به همین دلیل دو فاکتور روی یک سفارش هیچ ردیفی را دوبار نمی‌گیرند.</p>
      </div>
      <button className="document-secondary" type="button" onClick={reload} disabled={!!busy}>تازه‌سازی پیشنهاد</button>
    </header>

    <label className="document-field">سفارش
      <select name="proposalOrder" value={orderId} onChange={event => { setMessage(''); setOrderId(event.target.value); }}>
        <option value="">انتخاب سفارش…</option>
        {orders.map(order => <option key={order.id} value={order.id}>{order.orderNumber} — {order.customerName || order.title || 'بدون عنوان'}</option>)}
      </select>
    </label>

    {error && <div className="document-error" role="alert">{error}</div>}
    {message && <div className="document-success" role="status">{message}</div>}
    {!orderId && !error && <p className="document-footnote">سفارش را انتخاب کنید؛ عددها و مبلغِ قابل صورتحساب را سرور می‌خواند، نه این صفحه.</p>}

    {data && <>
      <div style={gridStyle}>
        <Money label="مبلغ تأییدشدهٔ پیش‌فاکتور" value={data.approvedTotal} hint="جمعِ نهایی همان نسخهٔ پیش‌فاکتور؛ جمعِ فاکتورهای تحویلی سر به سر به همین عدد می‌رسد." />
        <Money label="این فاکتور" value={totals.totalAmount} hint="اختلافِ جمعِ امروز با آنچه در دفتر صورتحساب ثبت شده." strong />
        <Money label="جمعِ فاکتورهای زندهٔ این نسخه" value={billed} hint="فاکتورِ باطل‌شده در این جمع نیست و بدهی نمی‌سازد." />
        <Money label="باقی‌ماندهٔ قابل صورتحساب" value={Math.max(0, (data.approvedTotal || 0) - billed)} hint="پس از صدورِ این فاکتور، این مقدار باقی می‌ماند." />
      </div>
      <p className="document-footnote">حالت قرارداد: <bdi>{data.contractMode}</bdi> — نسخهٔ مبنا: {fa(data.quoteRevision)} — جمعِ انباشته تا امروز: {fa(cumulative.total)} ریال (پیش از تخفیف {fa(cumulative.taxable)}، مالیات {fa(cumulative.tax)}).</p>

      <h3>سه عددِ هر قلم</h3>
      <div className="document-table-wrap"><table>
        <thead><tr><th>قلم</th><th>سفارش‌شده</th><th>تعداد سالم</th><th>تحویل‌شده</th><th>ماندهٔ تحویل</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.itemId}>
          <td>{item.label || '—'}</td>
          <td>{fa(item.ordered)}</td>
          <td>{item.good === null || item.good === undefined ? 'ثبت نشده' : fa(item.good)}</td>
          <td>{fa(item.delivered)}</td>
          <td>{fa(item.remaining)}</td>
        </tr>)}
        {!items.length && <tr><td colSpan={5} className="document-empty">این سفارش قلمی ندارد.</td></tr>}
        </tbody></table></div>

      <h3>ردیف‌های این فاکتور</h3>
      <div className="document-table-wrap"><table>
        <thead><tr><th>شرح ردیف</th><th>نقش</th><th>مقدار</th><th>واحد</th><th>جمع تا امروز (ریال)</th><th>مبلغ این فاکتور (ریال)</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.lineId}>
          <td>{row.description}</td>
          <td>{ROLE_LABEL[row.role] || row.role}{row.customerSupplied ? ' — تأمین مشتری' : ''}</td>
          <td>{fa(row.qty)}</td>
          <td>{row.unit || '—'}</td>
          <td>{fa(row.cumulativeAmount)}</td>
          <td><bdi>{fa(row.amount)}</bdi></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={6} className="document-empty">ردیفی برای طلب نمانده است.</td></tr>}
        </tbody>
        <tfoot><tr><th colSpan={5} scope="row">جمع این سند — مالیات {fa(totals.taxAmount)}، تخفیف {fa(totals.discountAmount)}، سود خدمات {fa(totals.markupAmount)}</th><td><bdi>{fa(totals.totalAmount)}</bdi></td></tr></tfoot>
      </table></div>

      {(data.warnings || []).length > 0 && <div className="document-error" role="alert">{data.warnings.map(text => <p key={text}>{text}</p>)}</div>}
      {!data.canIssue && <div className="document-error" role="status">صدور فاکتور تحویلی بسته است: {data.issueBlock}</div>}

      <div className="document-actions">
        <button type="button" name="issue-partial" disabled={!data.canIssue || busy === 'issue' || !onIssuePartial} onClick={issue}>{busy === 'issue' ? 'در حال صدور…' : `صدور فاکتور تحویلی — ${fa(totals.totalAmount)} ریال`}</button>
      </div>

      <h3>فاکتورهای تحویلی این سفارش ({fa(invoices.length)})</h3>
      <div className="document-table-wrap"><table>
        <thead><tr><th>شماره</th><th>نوع صورتحساب</th><th>مبلغ (ریال)</th><th>تاریخ صدور</th><th>وضعیت</th></tr></thead>
        <tbody>{invoices.map(invoice => <tr key={invoice.id}>
          <td><bdi>{invoice.number ? faDigits(invoice.number) : '—'}</bdi></td>
          <td>{invoice.billingMode === 'partial' ? 'بر پایهٔ تحویل' : 'فاکتور کامل'}</td>
          <td>{fa(invoice.total)}</td>
          <td>{invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString('fa-IR') : '—'}</td>
          <td><span className={`document-badge ${invoice.status === 'void' ? 'document-void' : ''}`}>{invoice.status === 'void' ? 'باطل‌شده' : 'صادرشده'}</span></td>
        </tr>)}
        {!invoices.length && <tr><td colSpan={5} className="document-empty">هنوز فاکتور تحویلی روی این نسخه صادر نشده است.</td></tr>}
        </tbody></table></div>
      <p className="document-footnote">ابطالِ یکی از این فاکتورها ردیف‌هایش را از دفتر صورتحساب بیرون می‌برد و سقفِ امروز را پایین می‌آید؛ شمارهٔ سندِ باطل‌شده برای همیشه رزور می‌ماند و دوباره صادر نمی‌شود.</p>
    </>}
  </section>;
}
