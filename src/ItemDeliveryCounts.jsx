import { useState } from 'react';
import { normalizeDigits } from './smart.js';

/* اصلاحات ۱۷/بند ۳/۳ (تصمیم کارفرما: «دو جا: سالم در تولید، تحویلی در تحویل»):
   سه عددِ هر قلم جدا ثبت می‌شوند و هیچ‌کدام از دو تای دیگر ساخته نمی‌شود —
   «سفارش‌شده» همان تیراژ قلم است، «سالم» را کنترل کیفیت می‌نویسد و
   «تحویل‌قابل‌صورتحساب» را همان لحظهٔ تحویل. پول فقط از عدد سوم می‌آید، پس
   تعدادِ سالمِ انبارطلبِ مشتری را زیاد نمی‌کند.
   این پنل هیچ مبلغی نمی‌سازد: فقط عددِ تایپ‌شده را به سرور می‌دهد و همان
   رد یا پذیرش را می‌نویسد. سقفِ تحویل، بازنویسیِ ثبت‌شده و مجوزِ نقش را سرور
   می‌شمارد (electron/workflow.js record_quality/record_delivery).
   بند ۳/۵ (تصمیم کارفرما به پرسش ۱): دو عدد دو شغل دارند — «سالم» را فقط
   «ناظر کیفیت» می‌نویسد و ردیفِ تحویل را امضاکنندگانِ همان مرحله؛ پس پنل دو
   اجازهٔ جدا می‌گیرد و بی‌اجازه هیچ خانهٔ نوشتنی نمی‌سازد. */

const fa = value => Number(value || 0).toLocaleString('fa-IR');
const digits = value => normalizeDigits(String(value ?? '')).replace(/[^\d]/g, '');
const toNumber = value => { const n = Number(digits(value)); return Number.isSafeInteger(n) ? n : null; };

const box = { border: '1px solid #d0c4b8', borderRadius: 8, padding: '4px 8px', fontSize: 12, color: '#2b2320', background: '#fff', width: '100%', boxSizing: 'border-box' };
const caption = { fontSize: 11, color: '#6c625b', display: 'flex', flexDirection: 'column', gap: 3 };
const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'left' };
const head = { fontSize: 11, color: '#6c625b', fontWeight: 700 };

function Labelled({ text, children, width }) {
  return <label style={{ ...caption, width }}>{text}:{children}</label>;
}

/* جمعِ تحویل‌ها از ردیف‌های خودِ قلم خوانده می‌شود؛ همان ردیف‌هایی که سرور می‌سازد. */
function Numbers({ item, delivered, remaining, faDate }) {
  const quality = item.quality || null;
  const cells = [
    ['سفارش‌شده', `${fa(Number(item.qty) || 0)} ${item.qtyUnit || 'نسخه'}`, 'همان تیراژِ واردشده در فرم سفارش'],
    ['سالم', quality ? `${fa(quality.good)} ${item.qtyUnit || 'نسخه'}` : 'ثبت نشده', 'کنترل کیفیت — «ناظر کیفیت»؛ تا ثبت نشود سقفِ تحویل بی‌مبناست'],
    ['تحویل‌شده', `${fa(delivered)} ${item.qtyUnit || 'نسخه'}`, 'جمعِ ردیف‌های تحویل؛ مبنای فاکتور تحویلی'],
    ['ماندهٔ تحویل', `${fa(remaining)} ${item.qtyUnit || 'نسخه'}`, 'سفارش‌شده کمِ تحویل‌شده'],
  ];
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
    {cells.map(([label, value, hint]) => <div key={label} title={hint} style={{ border: '1px solid #e3d8ce', borderRadius: 8, padding: '4px 7px', background: '#fbf7f3' }}>
      <div style={head}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, ...num }}>{value}</div>
    </div>)}
    {quality && <div style={{ ...caption, alignSelf: 'center' }}>تاریخ کنترل: {faDate(quality.at)}{quality.by?.name ? ` — ${quality.by.name}` : ''}{quality.note ? ` — ${quality.note}` : ''}</div>}
  </div>;
}

export default function ItemDeliveryCounts({ order, item, canRecordQuality, canRecordDelivery, onAction, faDate = d => d, compact }) {
  const quality = item.quality || null;
  const deliveries = item.deliveries || [];
  const delivered = deliveries.reduce((sum, row) => sum + (Number(row.billable) || 0), 0);
  const remaining = Math.max(0, (Number(item.qty) || 0) - delivered);
  const unit = item.qtyUnit || 'نسخه';
  const [good, setGood] = useState(() => String(digits(item.qty)));
  const [goodNote, setGoodNote] = useState('');
  const [billable, setBillable] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  /* ثبت‌شده ویرایش نمی‌شود (مثل سندِ مالی): سرور مسیر تغییر را سندِ اصلاحیِ بند ۴ می‌داند. */
  if (!canRecordQuality && !canRecordDelivery && !quality && !deliveries.length) return null;

  async function submit(action, payload, okMessage) {
    if (busy) return;
    setBusy(action); setError(''); setDone('');
    try {
      const result = await onAction(order.id, action, { itemId: item.id, ...payload });
      if (result && result.ok) { setDone(okMessage); setGood(''); setGoodNote(''); setBillable(''); setNote(''); }
      else setError((result && result.error) || 'ثبت انجام نشد.');
    } catch (_) { setError('ثبت انجام نشد؛ ارتباط با سرور برقرار نشد.'); }
    finally { setBusy(''); }
  }

  const goodValue = toNumber(good);
  const billableValue = toNumber(billable);
  const label = item.productName || item.productType || 'این قلم';

  return <div className={compact ? undefined : 'psx-card'} style={{ border: '1px solid #e0d5c9', borderRadius: 10, padding: compact ? 6 : 9, background: '#fffdf9', display: 'flex', flexDirection: 'column', gap: 7 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <strong style={{ fontSize: 12 }}>عددهای تولید و تحویل — {label}</strong>
      <span style={head}>مبنای فاکتور تحویلی: ردیف‌های تحویل، نه تعدادِ سالم</span>
    </div>
    <Numbers item={item} delivered={delivered} remaining={remaining} faDate={faDate} />
    {error && <div role="alert" style={{ color: '#b3261e', fontSize: 12, lineHeight: 1.6 }}>{error}</div>}
    {done && <div role="status" style={{ color: '#1e6b3a', fontSize: 12 }}>{done}</div>}

    {canRecordQuality && !quality && <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <Labelled text={`تعداد سالم — ${unit}`} width={140}><input name="good" inputMode="numeric" dir="ltr" style={box} value={good} onChange={event => setGood(digits(event.target.value))} /></Labelled>
        <Labelled text="شرح کنترل کیفیت"><input name="good-note" style={box} maxLength={2000} value={goodNote} onChange={event => setGoodNote(event.target.value)} placeholder="مثلاً ۲۰ نسخه پاشیدگی رنگ" /></Labelled>
        <button type="button" name="record-quality" disabled={busy === 'record_quality' || goodValue === null} onClick={() => submit('record_quality', { good: goodValue, ...(goodNote.trim() ? { note: goodNote.trim() } : {}) }, 'تعداد سالم ثبت شد؛ پس از آن قابل ویرایش نیست.')}>
          {busy === 'record_quality' ? 'در حال ثبت…' : 'ثبت تعداد سالم'}
        </button>
      </div>
      <div style={head}>تولیدِ اضافه مجاز است؛ سقفِ تحویل را همین عدد تعیین می‌کند.</div>
    </div>}
    {canRecordQuality && quality && <div style={head}>تعداد سالم ثبت شده است؛ برای تغییر آن سندِ اصلاحی لازم است (بند ۴).</div>}

    <div>
      <strong style={{ fontSize: 12 }}>ردیف‌های تحویل ({fa(deliveries.length)})</strong>
      <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['تاریخ', `تحویل‌قابل‌صورتحساب (${unit})`, 'شرح', 'ثبت‌کننده'].map(h => <th key={h} style={{ ...head, borderBottom: '1px solid #e0d5c9', padding: '2px 6px', textAlign: 'right' }}>{h}</th>)}</tr></thead>
          <tbody>
            {deliveries.map(row => <tr key={row.id}>
              <td style={{ padding: '2px 6px', borderBottom: '1px solid #f0e8de' }}>{faDate(row.at)}</td>
              <td style={{ padding: '2px 6px', borderBottom: '1px solid #f0e8de', ...num }}>{fa(row.billable)}</td>
              <td style={{ padding: '2px 6px', borderBottom: '1px solid #f0e8de' }}>{row.note || '—'}</td>
              <td style={{ padding: '2px 6px', borderBottom: '1px solid #f0e8de' }}>{(row.by && row.by.name) || '—'}</td>
            </tr>)}
            {!deliveries.length && <tr><td colSpan={4} style={{ padding: '4px 6px', color: '#6c625b' }}>هنوز تحویلی ثبت نشده است؛ پس فاکتور تحویلی هم صادر نمی‌شود.</td></tr>}
          </tbody>
        </table>
      </div>
      {canRecordDelivery && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
        <Labelled text={`مقدار این تحویل — ${unit}`} width={150}><input name="billable" inputMode="numeric" dir="ltr" style={box} value={billable} onChange={event => setBillable(digits(event.target.value))} /></Labelled>
        <Labelled text="شرح تحویل"><input name="delivery-note" style={box} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} placeholder="نام تحویل‌گیرنده / شماره بار" /></Labelled>
        <button type="button" name="record-delivery" disabled={busy === 'record_delivery' || !billableValue} onClick={() => submit('record_delivery', { billable: billableValue, ...(note.trim() ? { note: note.trim() } : {}) }, 'تحویل ثبت شد؛ میز فاکتور همین مقدار را صورتحساب می‌کند.')}>
          {busy === 'record_delivery' ? 'در حال ثبت…' : 'ثبت این تحویل'}
        </button>
        <span style={head}>هر تحویلِ بخشی یک ردیفِ تازه است و ردیفِ قبلی عوض نمی‌شود. «اتمام و تایید نهایی» سفارش را می‌بندد؛ برای تحویلِ پلکانی همان ردیف‌ها را ثبت کنید.</span>
      </div>}
    </div>
  </div>;
}
