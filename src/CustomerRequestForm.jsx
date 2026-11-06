import { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from './ExitGuard.jsx';
import './form-field.css';

const colors = { primary: '#7A2048', dark: '#551531', cream: '#FBF6EC', border: '#E3D6BC', text: '#2B2320', error: '#B3261E' };
const box = { border: `1px solid ${colors.border}`, borderRadius: 12, padding: 20, background: '#fff', color: colors.text };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '4px 9px', border: `1px solid ${colors.border}`, borderRadius: 8, font: 'inherit', fontWeight: 400, background: '#fff', color: colors.text };
const buttonStyle = { border: 0, borderRadius: 8, padding: '10px 18px', background: colors.primary, color: '#fff', font: 'inherit', fontWeight: 700, cursor: 'pointer' };
const digits = value => String(value).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
const approved = customer => customer?.eligibility?.status === 'approved' && typeof customer.customerCode === 'string' && !!customer.customerCode.trim();
const seed = customer => ({ product: '', quantity: '', specifications: '', deadline: '', phone: customer?.mobile || customer?.phone || '', extra: '' });

function compose(draft) {
  const product = draft.product.trim();
  const quantity = digits(draft.quantity.trim());
  const phone = digits(draft.phone.trim());
  if (!product) throw new Error('نوع محصول را وارد کنید.');
  if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) throw new Error('تعداد باید عدد صحیح مثبت باشد.');
  if (!phone) throw new Error('شماره تماس را وارد کنید.');
  if (phone.length > 40) throw new Error('شماره تماس نباید بیشتر از ۴۰ نویسه باشد.');
  const text = [`محصول: ${product}`, `تعداد: ${Number(quantity)}`,
    draft.specifications.trim() ? `مشخصات: ${draft.specifications.trim()}` : '',
    draft.deadline.trim() ? `موعد پیشنهادی: ${draft.deadline.trim()}` : '',
    `شماره تماس: ${phone}`, draft.extra.trim() ? `توضیحات تکمیلی: ${draft.extra.trim()}` : ''].filter(Boolean).join('\n');
  if (text.length < 8 || text.length > 4000) throw new Error('متن نهایی درخواست باید بین ۸ تا ۴۰۰۰ نویسه باشد.');
  return { text, phone };
}

/** Customer must come from the authenticated customer-profile API, not a customer list. */
export default function CustomerRequestForm({ customer, onSubmit, onRefresh }) {
  const [draft, setDraft] = useState(() => seed(customer));
  const [pending, setPending] = useState(false);
  useUnsavedChanges({ dirty: JSON.stringify(draft) !== JSON.stringify(seed(customer)), busy: pending, title: 'درخواست مشتری', onDiscard: () => setDraft(seed(customer)) });
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const busy = useRef(false);
  const current = useRef({ identity: '', allowed: false, generation: 0 });
  const identity = `${customer?.id || ''}|${customer?.customerCode || ''}`;
  if (current.current.identity !== identity) current.current = { identity, allowed: approved(customer), generation: current.current.generation + 1 };
  current.current.allowed = approved(customer);
  useEffect(() => {
    setDraft(seed(customer)); setError(''); setReceipt(null);
  }, [identity]);

  async function submit(event) {
    event?.preventDefault();
    if (busy.current || !current.current.allowed) return;
    let payload;
    try { payload = compose(draft); } catch (failure) { setError(failure.message); return; }
    if (typeof onSubmit !== 'function') { setError('امکان ثبت درخواست در دسترس نیست.'); return; }
    const generation = current.current.generation;
    busy.current = true; setPending(true); setError(''); setReceipt(null);
    try {
      const result = await onSubmit(payload.text, payload.phone);
      if (generation !== current.current.generation || !current.current.allowed) return;
      if (!result?.ok) throw new Error(result?.error || 'درخواست ثبت نشد؛ دوباره تلاش کنید.');
      setReceipt({ number: result.requestNumber || result.orderNumber || '', code: customer.customerCode });
      setDraft(seed(customer));
    } catch (failure) {
      if (generation === current.current.generation) setError(failure?.message || 'ارتباط برقرار نشد؛ دوباره تلاش کنید.');
    } finally { busy.current = false; setPending(false); }
  }

  async function refresh() {
    if (busy.current || typeof onRefresh !== 'function') return;
    busy.current = true; setPending(true); setError('');
    try {
      const result = await onRefresh();
      if (result?.ok === false) throw new Error(result.error || 'بررسی وضعیت انجام نشد.');
    } catch (failure) { setError(failure?.message || 'بررسی وضعیت انجام نشد.'); }
    finally { busy.current = false; setPending(false); }
  }

  if (!approved(customer)) return <section dir="rtl" style={box}>
    <h2 style={{ color: colors.dark, marginTop: 0 }}>ثبت درخواست چاپ</h2>
    <p>برای ثبت درخواست، پرونده مشتری باید تأیید شود و کد مشتری صادر شود.</p>
    <p style={{ color: '#6C625B' }}>پس از بررسی چاپخانه، وضعیت حساب خود را دوباره بررسی کنید.</p>
    {error && <p role="alert" style={{ color: colors.error }}>{error}</p>}
    <button type="button" disabled={pending || !onRefresh} onClick={refresh} style={{ ...buttonStyle, opacity: pending || !onRefresh ? 0.55 : 1 }}>{pending ? 'در حال بررسی…' : 'بررسی مجدد وضعیت'}</button>
  </section>;

  const field = (name, label, options = {}) => <label className="psx-field">
    <span className="psx-field-label">{label}:{options.required ? ' *' : ''}</span>
    <span className="psx-field-control">{options.multiline ? <textarea name={name} value={draft[name]} disabled={pending} maxLength={4000} rows={options.rows || 3} onChange={event => setDraft(value => ({ ...value, [name]: event.target.value }))} style={{ ...inputStyle, resize: 'vertical' }} />
      : <input name={name} value={draft[name]} disabled={pending} type={options.type || 'text'} inputMode={options.inputMode} required={options.required} maxLength={name === 'phone' ? 40 : 300} onChange={event => setDraft(value => ({ ...value, [name]: event.target.value }))} style={inputStyle} />}</span>
  </label>;

  return <section dir="rtl" style={{ ...box, background: colors.cream }}>
    <h2 style={{ color: colors.dark, marginTop: 0 }}>درخواست جدید چاپ</h2>
    <p>کد مشتری: <strong><bdi>{customer.customerCode}</bdi></strong></p>
    <p style={{ color: '#6C625B', lineHeight: 1.9 }}>مشخصات را وارد کنید تا چاپخانه درخواست شما را بررسی و قیمت‌گذاری کند. شروع تولید پس از تأیید مشتری و اجازه مدیر چاپخانه انجام می‌شود.</p>
    {receipt && <div role="status" style={{ padding: 12, border: '1px solid #A9C6AE', background: '#EDF6EF', borderRadius: 8, marginBottom: 14 }}>
      درخواست ثبت شد.{receipt.number ? <> شماره پیگیری: <strong><bdi>{receipt.number}</bdi></strong>.</> : ' شماره سفارش پس از تأیید قیمت و تأیید شما صادر می‌شود؛ تا آن زمان درخواست معلق است.'} کد مشتری: <strong><bdi>{receipt.code}</bdi></strong>
    </div>}
    <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14 }}>
        {field('product', 'نوع محصول', { required: true })}
        {field('quantity', 'تعداد', { required: true, inputMode: 'numeric' })}
        {field('phone', 'شماره تماس', { required: true, type: 'tel' })}
        {field('deadline', 'موعد پیشنهادی — اختیاری')}
      </div>
      {field('specifications', 'مشخصات محصول', { multiline: true })}
      <div style={{ fontSize: 12, color: '#6C625B' }}>مانند قطع و ابعاد، تعداد صفحات، رنگ چاپ، جنس کاغذ، جلد و نوع صحافی.</div>
      {field('extra', 'توضیحات تکمیلی', { multiline: true, rows: 2 })}
      {error && <div role="alert" style={{ color: colors.error }}>{error}</div>}
      <div><button type="submit" disabled={pending} style={{ ...buttonStyle, opacity: pending ? 0.55 : 1 }}>{pending ? 'در حال ثبت…' : 'ثبت درخواست'}</button></div>
    </form>
  </section>;
}
