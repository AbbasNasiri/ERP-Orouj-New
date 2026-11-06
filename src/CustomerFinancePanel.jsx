import { useState } from 'react';
import { faDigits } from './smart.js';
import { orderGrandTotal, orderDiscount, orderTax, orderPayable, orderPaid, orderBalance, invoiceRows, hasQuotePricing } from './quote-money.mjs';
import './form-field.css';

/* پنل فقط‌نمایشی مشتری: ردیف‌ها را سرور از رکوردهای خودِ همین حساب ساخته است.
   هیچ مبلغی اینجا محاسبهٔ مجدد نمی‌شود؛ snapshot قیمت‌گذاری همان است که چاپخانه تأیید کرده. */
const colors = { primary: '#7A2048', dark: '#551531', cream: '#FBF6EC', border: '#E3D6BC', text: '#2B2320', muted: '#6C625B' };
const styles = {
  root: { display: 'flex', flexDirection: 'column', gap: 14, padding: 16, border: '1px solid #d7c7ae', borderRadius: 12, background: colors.cream, color: colors.text, fontSize: 13, lineHeight: 1.9 },
  head: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' },
  card: { border: '1px solid #fff', borderRadius: 10, background: '#fff', padding: 12 },
  kpis: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 158px), 1fr))', gap: 10 },
  kpi: { display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', border: '1px solid #e0d4c0', borderRadius: 10, background: '#fff' },
  kpiLabel: { fontSize: 11, fontWeight: 600, color: colors.muted },
  kpiValue: { fontSize: 15, fontWeight: 800, color: colors.dark },
  button: { padding: '8px 14px', border: `1px solid ${colors.primary}`, borderRadius: 8, font: 'inherit', fontWeight: 700, cursor: 'pointer', color: '#fff', background: colors.primary },
  ghost: { padding: '4px 10px', border: `1px solid ${colors.primary}`, borderRadius: 7, font: 'inherit', fontWeight: 700, fontSize: 11.5, cursor: 'pointer', color: colors.primary, background: '#fff' },
  note: { margin: 0, color: colors.muted },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { padding: '7px 8px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', background: '#f3ece0', borderBottom: '1px solid #d7c7ae' },
  td: { padding: '6px 8px', borderBottom: '1px solid #eee3d2', whiteSpace: 'nowrap' },
  num: { fontVariantNumeric: 'tabular-nums' },
};
const money = value => (Number(value) || 0).toLocaleString('en-US');
const DIGITS = '0123456789';
/* موتور فاکتور ردیف‌های قیمت‌گذاری‌شده را با رقم فارسی می‌دهد. یک جدول نباید دو
   دستگاه رقم داشته باشد، پس ردیف‌های مبلغ اینجا به لاتین می‌نشینند. شمارهٔ سند و
   تاریخ شمسی مثل بقیهٔ برنامه فارسی‌اند (بند ۳/۶). */
const latin = value => String(value ?? '').replace(/[۰-۹]/g, d => DIGITS[d.charCodeAt(0) - 0x06F0])
  .replace(/[٠-٩]/g, d => DIGITS[d.charCodeAt(0) - 0x0660]).replace(/٬/g, ',');
const faDay = iso => { const d = new Date(`${iso || ''}T00:00:00`); return iso && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('fa-IR') : '—'; };
const faStamp = at => { const d = new Date(Number(at) || 0); return Number.isNaN(d.getTime()) || !at ? '—' : d.toLocaleDateString('fa-IR'); };
const DOCUMENT_NAMES = { quote: 'پیش‌فاکتور', invoice: 'فاکتور', statement: 'صورت وضعیت' };
const DOCUMENT_STATUS = { issued: 'صادر شده', void: 'لغو شده' };
const readable = order => order.pricing === undefined || hasQuotePricing(order);

function Totals({ label, value, amount }) {
  return <div style={styles.kpi}><span style={styles.kpiLabel}>{label}</span><strong style={styles.kpiValue}>{amount ? money(value) : value}</strong></div>;
}

function OrderDetails({ order, documents }) {
  const rows = readable(order) ? invoiceRows(order, true) : [];
  return <div style={{ ...styles.card, margin: '6px 0 10px' }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>ردیف‌های هزینه</div>
    {order.pricing !== undefined && !readable(order)
      ? <p style={{ ...styles.note, color: '#a42222' }}>قیمت‌گذاری این سفارش در سرور سازگار نیست؛ برای دیدن مبالغ با چاپخانه هماهنگ کنید.</p>
      : rows.length
        ? <table style={styles.table}>
          <thead><tr><th style={styles.th}>شرح</th><th style={styles.th}>تعداد</th><th style={styles.th}>بهای واحد</th><th style={{ ...styles.th, textAlign: 'left' }}>جمع</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <td style={styles.td}>{row.desc}{row.spec ? <span style={{ color: colors.muted }}> — {latin(row.spec)}</span> : ''}</td>
            <td style={styles.td}>{latin(row.qty)}</td>
            <td style={{ ...styles.td, ...styles.num }}>{latin(row.price)}</td>
            <td style={{ ...styles.td, textAlign: 'left', ...styles.num }}>{money(row.total)}</td>
          </tr>)}</tbody>
        </table>
        : <p style={styles.note}>ردیفی برای نمایش ثبت نشده است.</p>}
    <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>پرداخت‌های شما</div>
        {(order.payments || []).length ? <table style={styles.table}>
          <thead><tr><th style={styles.th}>تاریخ</th><th style={styles.th}>روش</th><th style={{ ...styles.th, textAlign: 'left' }}>مبلغ (ریال)</th></tr></thead>
          <tbody>{(order.payments || []).map(p => <tr key={p.id}><td style={styles.td}>{faDay(p.date)}</td><td style={styles.td}>{p.method || '—'}</td><td style={{ ...styles.td, textAlign: 'left', ...styles.num }}>{money(p.amount)}</td></tr>)}</tbody>
        </table> : <p style={styles.note}>پرداختی ثبت نشده است.</p>}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>اسناد این سفارش</div>
        {documents.length ? <table style={styles.table}>
          <thead><tr><th style={styles.th}>نوع سند</th><th style={styles.th}>شماره</th><th style={styles.th}>نسخهٔ پیش‌فاکتور</th><th style={styles.th}>تاریخ صدور</th><th style={{ ...styles.th, textAlign: 'left' }}>وضعیت</th></tr></thead>
          <tbody>{documents.map(d => <tr key={d.id}><td style={styles.td}>{DOCUMENT_NAMES[d.type] || d.type}</td><td style={styles.td}><bdi>{faDigits(d.number)}</bdi></td><td style={{ ...styles.td, ...styles.num }}>{faDigits(d.quoteRevision ?? '—')}</td><td style={styles.td}>{faStamp(d.createdAt)}</td><td style={{ ...styles.td, textAlign: 'left' }}>{DOCUMENT_STATUS[d.status] || d.status}</td></tr>)}</tbody>
        </table> : <p style={styles.note}>هنوز سندی برای این سفارش صادر نشده است.</p>}
      </div>
    </div>
  </div>;
}

export default function CustomerFinancePanel({ customer, finance, onRefresh }) {
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  if (!customer || !customer.customerCode) return <section dir="rtl" style={styles.root}>
    <strong style={{ fontSize: 16, color: colors.dark }}>مالی من</strong>
    <p style={styles.note}>برای دیدن مالی، پروندهٔ شما باید تأیید شود و کد مشتری صادر شده باشد. پس از بررسی چاپخانه، «تازه‌سازی» را بزنید.</p>
  </section>;

  const orders = finance?.orders || [];
  const documents = finance?.documents || [];
  /* سفارشی که snapshot قیمتش سازگار نیست در جمع‌ها نمی‌آید؛ صفر جای آن عدد،
     ماندهٔ نادرست به مشتری نشان نمی‌دهد. ردیف خودش «—» و توضیح می‌گیرد. */
  const totals = orders.filter(readable).reduce((acc, order) => ({
    gross: acc.gross + orderGrandTotal(order), discount: acc.discount + orderDiscount(order),
    tax: acc.tax + orderTax(order), payable: acc.payable + orderPayable(order),
    paid: acc.paid + orderPaid(order), balance: acc.balance + orderBalance(order),
  }), { gross: 0, discount: 0, tax: 0, payable: 0, paid: 0, balance: 0 });

  async function refresh() {
    if (busy || typeof onRefresh !== 'function') return;
    setBusy(true); setMessage(null);
    try {
      const result = await onRefresh();
      if (result?.ok === false) throw new Error(result.error || 'دریافت اطلاعات انجام نشد.');
      setMessage({ kind: 'ok', text: 'اطلاعات از سرور تازه شد.' });
    } catch (failure) { setMessage({ kind: 'error', text: failure?.message || 'دریافت اطلاعات انجام نشد.' }); }
    finally { setBusy(false); }
  }

  return <section dir="rtl" aria-label="مالی من" style={styles.root}>
    <div style={styles.head}>
      <div>
        <strong style={{ fontSize: 16, color: colors.dark }}>مالی من</strong>
        <div style={{ ...styles.note, fontSize: 12 }}>کد مشتری: <strong><bdi>{customer.customerCode}</bdi></strong> — {customer.name || ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ padding: '3px 10px', borderRadius: 8, background: '#f3e6ee', color: colors.primary, fontSize: 11, fontWeight: 700 }}>فقط نمایش — بدون ثبت و ویرایش</span>
        {onRefresh && <button type="button" disabled={busy} onClick={refresh} style={{ ...styles.button, opacity: busy ? 0.55 : 1 }}>{busy ? 'در حال دریافت…' : 'تازه‌سازی'}</button>}
      </div>
    </div>
    <p style={styles.note}>مبالغی که اینجا می‌بینید همان پیش‌فاکتور و فاکتورهایی است که چاپخانه صادر کرده است؛ مبلغی در این بخش محاسبه یا تغییر نمی‌کند. برای هر سفارش، ردیف‌های هزینه، پرداخت‌ها و اسناد صادرشده را باز کنید.</p>
    {message && <p role={message.kind === 'error' ? 'alert' : 'status'} style={{ margin: 0, fontWeight: 700, color: message.kind === 'error' ? '#a42222' : '#27652d' }}>{message.text}</p>}
    {!finance && <p style={{ ...styles.note, fontWeight: 700 }}>هنوز اطلاعات مالی از سرور دریافت نشده است؛ «تازه‌سازی» را بزنید.</p>}
    {finance && <div style={styles.kpis}>
      <Totals label="جمع کل (ریال)" amount value={totals.gross} />
      <Totals label="تخفیف‌ها (ریال)" amount value={totals.discount} />
      <Totals label="مالیات (ریال)" amount value={totals.tax} />
      <Totals label="قابل پرداخت (ریال)" amount value={totals.payable} />
      <Totals label="پرداخت‌شده (ریال)" amount value={totals.paid} />
      <Totals label="باقی‌مانده (ریال)" amount value={totals.balance} />
    </div>}
    {finance && <div style={styles.card}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>سفارش‌های من ({orders.length.toLocaleString('fa-IR')})</div>
      {orders.length === 0 ? <p style={styles.note}>سفارشی به نام شما ثبت نشده است.</p>
        : <table style={styles.table}>
          <thead><tr>
            <th style={styles.th}>شماره</th><th style={styles.th}>تاریخ</th><th style={styles.th}>موضوع</th><th style={styles.th}>وضعیت</th>
            <th style={styles.th}>قابل پرداخت</th><th style={styles.th}>پرداخت‌شده</th><th style={styles.th}>باقی‌مانده</th><th style={styles.th}>اسناد</th><th style={styles.th}>جزئیات</th>
          </tr></thead>
          <tbody>{orders.map(order => {
            const docs = documents.filter(d => d.orderId === order.id);
            return <OrderRow key={order.id} order={order} docs={docs} open={openId === order.id} onToggle={() => setOpenId(openId === order.id ? null : order.id)} />;
          })}</tbody>
        </table>}
    </div>}
  </section>;
}

function OrderRow({ order, docs, open, onToggle }) {
  const stale = !readable(order);
  return <>
    <tr>
      <td style={styles.td}><bdi>{order.orderNumber || '—'}</bdi></td>
      <td style={styles.td}>{faDay(order.date)}</td>
      <td style={styles.td}>{order.title || '—'}</td>
      <td style={styles.td}>{order.status || '—'}</td>
      <td style={{ ...styles.td, ...styles.num }}>{stale ? '—' : money(orderPayable(order))}</td>
      <td style={{ ...styles.td, ...styles.num }}>{stale ? '—' : money(orderPaid(order))}</td>
      <td style={{ ...styles.td, ...styles.num, fontWeight: 700 }}>{stale ? '—' : money(orderBalance(order))}</td>
      <td style={styles.td}>{docs.length ? docs.map(d => DOCUMENT_NAMES[d.type] || d.type).join(' · ') : '—'}</td>
      <td style={styles.td}><button type="button" aria-expanded={open} onClick={onToggle} style={styles.ghost}>{open ? 'بستن' : 'دیدن ردیف‌ها'}</button></td>
    </tr>
    {open && <tr><td colSpan={9} style={{ padding: 0 }}><OrderDetails order={order} documents={docs} /></td></tr>}
  </>;
}
