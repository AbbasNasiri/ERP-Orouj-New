import PrintPreview from './PrintPreview.jsx';
import { numberToWords, faDigits } from './smart.js';
import { INVOICE_COLUMNS } from './invoice-columns.js';
import './official-invoice.css';

const fmt = value => Number(value || 0).toLocaleString('fa-IR', { maximumFractionDigits: 6 });
const missing = value => String(value || '').trim() || 'ثبت نشده';
function Party({ title, party = {}, code }) {
  return <section className="official-party">
    <h2>{title}</h2>
    <div className="official-party-row">
      <span className="official-party-name">نام شخص حقیقی / حقوقی: <strong>{missing(party.name)}</strong></span>
      <span>نوع شخص: {missing(party.entityType)}</span>
      {code && <span>کد طرف حساب: <bdi>{code}</bdi></span>}
      <span>شماره اقتصادی: <bdi>{missing(party.economicCode)}</bdi></span>
    </div>
    <div className="official-party-row">
      <span>شناسه ملی: <bdi>{missing(party.nationalId)}</bdi></span>
      <span>کد ملی: <bdi>{missing(party.nationalCode)}</bdi></span>
      <span>شماره ثبت: <bdi>{missing(party.registerNo)}</bdi></span>
      <span>کدپستی: <bdi>{missing(party.postalCode)}</bdi></span>
      <span>تلفن / نمابر: <bdi>{missing(party.phone)}{party.fax ? ` / ${party.fax}` : ''}</bdi></span>
    </div>
    <div className="official-party-row">
      <span>استان: {missing(party.province)}</span><span>شهر: {missing(party.city)}</span>
      <span className="official-party-address">نشانی کامل: {missing(party.address)}</span>
    </div>
  </section>;
}

export default function OfficialInvoice({ document: record, onClose, formatDate }) {
  const { order, customer = {}, seller = {}, invoice } = record.snapshot;
  const date = new Date(record.createdAt).toISOString().slice(0, 10);
  const rows = invoice?.rows || [];
  const totals = invoice?.totals;
  const paid = (order.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const columns = [3, 9, 18, 5, 4, 9, 9, 7, 9, 4, 9, 14];
  return <PrintPreview onClose={onClose} orientation="landscape" lockedPaper="A4" pdfName={`فاکتور-${record.number}`}>
    <article className="official-invoice" dir="rtl">
      <header className="official-invoice-heading">
        <div><strong>{missing(seller.name)}</strong><div>مرجع سفارش: <bdi>{record.orderNumber}</bdi></div></div>
        <h1>صورتحساب فروش کالا و خدمات</h1>
        <div>شماره سریال: <bdi>{faDigits(record.number)}</bdi><br />تاریخ صدور: {formatDate(date)}<br />وضعیت: {record.status === 'void' ? 'باطل شده' : 'صادر شده'}</div>
      </header>
      <div className="official-tax-reference">شماره منحصر به فرد مالیاتی: <bdi>{missing(record.tax?.taxId)}</bdi> — وضعیت ثبت سامانه مؤدیان: {record.tax?.status === 'accepted' ? 'پذیرفته شده' : 'تأیید نشده'}</div>
      <Party title="مشخصات فروشنده" party={seller} />
      <Party title="مشخصات خریدار" party={customer} code={customer.customerCode || order.customerCode} />
      <div className="official-invoice-subject">موضوع سفارش: {order.title || '—'} — واحد مبالغ: ریال</div>
      {!totals ? <p>این سند قدیمی فاقد نسخهٔ ثابت ردیف‌های این قالب است؛ اطلاعات آن باید با حفظ اصل سند بررسی شود.</p> : <>
        <table className="official-invoice-lines">
          <colgroup>{columns.map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
          <thead><tr>{INVOICE_COLUMNS.map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.map((row, i) => <tr key={`${row.id}-${i}`}>
            <td>{fmt(i + 1)}</td><td><bdi>{row.itemCode || '—'}</bdi></td>
            <td className="official-description">{row.description}{row.customerSupplied && ' (مواد متعلق به مشتری؛ بدون فروش)'}{row.freeOffer && ' (رایگان)'}</td>
            <td>{fmt(row.qty)}</td><td>{row.unit}</td><td>{fmt(row.unitPrice)}</td><td>{fmt(row.grossAmount)}</td><td>{fmt(row.discountAmount)}</td><td>{fmt(row.taxableAmount)}</td><td>{fmt(row.taxPercent)}</td><td>{fmt(row.taxAmount)}</td><td>{fmt(row.total)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th colSpan={6}>جمع کل (ریال)</th>{['grossAmount', 'discountAmount', 'taxableAmount'].map(key => <th key={key}>{fmt(totals[key])}</th>)}<th>—</th><th>{fmt(totals.taxAmount)}</th><th>{fmt(totals.total)}</th></tr></tfoot>
        </table>
        <div className="financial-print-closing official-invoice-closing">
          <p><strong>جمع کل صورتحساب به حروف:</strong> {numberToWords(totals.total)} ریال</p>
          <p>دریافت ثبت‌شده تا زمان صدور: {fmt(paid)} ریال — مانده در زمان صدور: {fmt(totals.total - paid)} ریال. تغییر دریافت‌های بعدی در صورت‌حساب جدید نمایش داده می‌شود.</p>
          <p>شرایط و نحوه تسویه: {record.snapshot.settlement?.method || 'در این نسخه ثبت نشده'} — مرجع سند حسابداری: {record.journalNumber ? faDigits(record.journalNumber) : 'هنوز ثبت نشده'}</p>
          {record.status === 'void' && <p><strong>سند باطل شده:</strong> {record.voidReason} — {record.voidedAt ? formatDate(new Date(record.voidedAt).toISOString().slice(0, 10)) : ''}</p>}
          <div className="official-signatures"><span>مهر و امضای فروشنده</span><span>مهر و امضای خریدار</span></div>
          <p className="official-invoice-note">این نسخهٔ چاپی به‌تنهایی تأیید ثبت مالیاتی نیست؛ اطلاعات ناقص باید پیش از صدور صورتحساب مالیاتی تکمیل شوند.</p>
        </div>
      </>}
    </article>
  </PrintPreview>;
}
