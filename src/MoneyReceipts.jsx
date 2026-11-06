import { Fragment, useEffect, useState } from 'react';
import { normalizeDigits, faDigits } from './smart.js';
import './document-panels.css';

/* اصلاحات ۱۷/بند ۲/۳: دفترِ رسیدِ وجه، درون‌خطی در همان صفحهٔ سفارش (بدون فرمِ تو در تو).
   هیچ رقمی اینجا ساخته نمی‌شود: مبلغ، وضعیت چک، پیشنهادِ تخصیص و باقی‌ماندهٔ «پیش‌پرداخت» را
   سرور در be:receipts می‌سازد و نوشتن فقط از سه مسیر be:recordReceipt / be:receiptCheque /
   be:voidReceipt است. ردیفِ paymentsِ سفارش چیزی جز بازتابِ همین دفتر نیست.
   تصمیم کارفرما: چکِ وصول‌نشده مطالبه را کم می‌کند ولی نقدِ صندوق نیست — پس «چک در دست» و
   «نقدِ صندوق» دو خانهٔ جدااند و هیچ‌کدام با دیگری جمع نمی‌شود. */

const CHEQUE = 'چک';
const VOID = 'void';
const digits = value => normalizeDigits(String(value ?? '')).replace(/[^\d]/g, '');
/* شمارهٔ رسید را سرور می‌سازد، پس دیدنش فارسی است؛ شمارهٔ چک عددِ چاپیِ بانک است و دست‌نخورده می‌ماند. */
const showNo = value => (value == null ? '' : faDigits(value));
const amountOf = value => { const n = Number(digits(value)); return Number.isSafeInteger(n) ? n : 0; };
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EMPTY_FORM = { amount: '', method: 'نقد', receivedAt: '', note: '', chequeNumber: '', chequeBank: '', chequeBranch: '', chequeDue: '' };

const box = { padding: '5px 8px', border: '1px solid #d0c4b8', borderRadius: 7, fontSize: 13, background: '#fff', color: '#2b2320', width: '100%', boxSizing: 'border-box' };
const caption = { fontSize: 12, color: '#6c625b', display: 'flex', flexDirection: 'column', gap: 3 };
const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'left' };

function Labelled({ text, width, children }) {
  return <label style={{ ...caption, width }}>{text}:{children}</label>;
}

/* پنج خانهٔ جمع، هر پنج از سرور: «چک در دست» و «نقدِ صندوق» هرگز با هم جمع نمی‌شوند. */
function Totals({ totals, statuses, fmt, faDate }) {
  const cards = [
    ['جمع دریافت‌های زنده', totals.gross, 'رسیدِ باطل‌شده و چکِ برگشتی در این جمع نیست'],
    ['تخصیص‌خورده', totals.allocated, 'هر ریال یا به فاکتور/سفارش خورده یا پیش‌پرداخت است'],
    ['پیش‌پرداخت', totals.advance, 'باقی‌ماندهٔ رسیدِ تخصیص‌نیافته'],
    ['چک در دست وصول', totals.pendingCheque, 'مطالبه را کم می‌کند، نقدِ صندوق نه'],
    ['نقدِ صندوق', totals.cleared, 'وصول‌شده و دریافتِ غیرچکی'],
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
      {cards.map(([label, value, hint]) => (
        <div key={label} title={hint} style={{ border: '1px solid #e3d8ce', borderRadius: 10, padding: '7px 10px', background: '#fbf7f3' }}>
          <div style={{ fontSize: 12, color: '#6b5d54' }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, ...num }}>{`${fmt(Number(value) || 0)} ریال`}</div>
        </div>
      ))}
      <div className="document-footnote" style={{ alignSelf: 'center' }}>
        وضعیت‌های چک: {Object.values(statuses || {}).join(' / ')} — برای بازگشتِ پول، رسید باطل می‌شود؛ «در دست» مقصدِ عملیت نیست.
      </div>
    </div>
  );
}

export default function MoneyReceiptLedger({ customerId, order, fmt = String, faDate = d => d, DateInput, onChanged }) {
  const [ledger, setLedger] = useState(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [manual, setManual] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [alloc, setAlloc] = useState({});
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  const [voidFor, setVoidFor] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const reload = () => setNonce(n => n + 1);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!customerId) return undefined;
    let alive = true;
    const api = window.printshopApi;
    if (!api || typeof api.receipts !== 'function') { setLedger(null); setError('دفتر رسید وجه فقط در نسخهٔ پایگاه دادهٔ امن در دسترس است.'); return undefined; }
    api.receipts({ customerId }).then(
      res => { if (!alive) return; if (res && res.ok) { setLedger(res); setError(''); } else { setLedger(null); setError((res && res.error) || 'خواندن دفتر رسید ممکن نشد.'); } },
      () => { if (alive) { setLedger(null); setError('خواندن دفتر رسید ممکن نشد.'); } },
    );
    return () => { alive = false; };
  }, [customerId, nonce]);

  /* پیشنهادِ تخصیص را سرور می‌شمارد: با هر تغییرِ مبلغ (یک مکثِ کوتاه) همان be:receipts
     با amountِ تایپ‌شده خوانده می‌شود. رابط فقط مبلغِ تایپ‌شده را می‌فرستد، نه عددی از خودش. */
  const typed = amountOf(form.amount);
  useEffect(() => {
    if (!typed || !customerId) { setProposal(null); return undefined; }
    let alive = true;
    const api = window.printshopApi;
    if (!api || typeof api.receipts !== 'function') return undefined;
    const timer = setTimeout(() => {
      api.receipts({ customerId, amount: typed }).then(res => {
        if (!alive) return;
        if (res && res.ok) { setProposal(res.proposal); setAlloc({}); } else setError((res && res.error) || 'پیشنهاد تخصیص خوانده نشد.');
      }, () => { if (alive) setError('پیشنهاد تخصیص خوانده نشد.'); });
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [typed, customerId, nonce]);

  if (!ledger) {
    return <section className="document-panel" dir="rtl">
      <header className="document-heading"><div><h2>دفتر رسید وجه</h2><p>پولِ دریافتی فقط با رسید ثبت می‌شود و به فاکتور یا سفارش تخصیص می‌خورد.</p></div></header>
      {error ? <><div className="document-error" role="alert">{error}</div><button type="button" className="document-secondary" onClick={reload}>تازه‌سازی از سرور</button></>
        : <div className="document-footnote">در حال خواندن دفتر…</div>}
    </section>;
  }

  const lines = ledger.lines || [];
  const receipts = ledger.receipts || [];
  const statuses = ledger.statuses || {};
  const chequeActions = ledger.chequeActions || {};
  const open = lines.filter(l => l.open > 0);
  const proposedOf = id => { const row = (proposal && proposal.rows || []).find(r => r.orderId === id); return row ? row.amount : 0; };
  const rowAmountOf = id => (alloc[id] !== undefined ? amountOf(alloc[id]) : proposedOf(id));
  const allocated = manual ? open.reduce((sum, l) => sum + rowAmountOf(l.orderId), 0) : (proposal ? proposal.rows.reduce((sum, r) => sum + r.amount, 0) : 0);
  const advance = Math.max(0, typed - allocated);
  const orderNumber = id => (lines.find(l => l.orderId === id) || {}).orderNumber || (order && order.id === id ? order.orderNumber : '') || '—';
  const cheque = form.method === CHEQUE;
  const today = form.receivedAt || isoToday();

  async function submit() {
    if (busy) return;
    if (!typed) { setError('مبلغ رسید باید عدد صحیح مثبت به ریال باشد.'); return; }
    setBusy('receipt'); setError(''); setDone('');
    const payload = {
      customerId, orderId: (order && order.id) || '', amount: typed, method: form.method, receivedAt: today, note: form.note,
      ...(cheque ? { chequeNumber: form.chequeNumber, chequeBank: form.chequeBank, chequeBranch: form.chequeBranch, chequeDue: form.chequeDue } : {}),
      /* دست‌نخورده یعنی سفور تصمیم بگیرد؛ تنها وقتی رابط «خودم تقسیم کنم» را زد، ردیف‌ها می‌روند. */
      ...(manual ? { allocations: open.map(l => ({ orderId: l.orderId, documentId: l.documentId || '', amount: rowAmountOf(l.orderId) })).filter(a => a.amount > 0) } : {}),
    };
    try {
      const res = await window.printshopApi.recordReceipt(payload);
      if (res && res.ok) {
        setDone(`رسید ${showNo(res.receipt.number)} ثبت شد — تخصیص ${fmt(res.allocated)} و پیش‌پرداخت ${fmt(res.advance)} ریال.`);
        /* روش هم مثل بقیه پاک می‌شود: «چک» با فیلدهای خالیِ چک، رسیدِ بعدی را حتماً رد می‌کند. */
        setForm(EMPTY_FORM); setManual(false); setProposal(null); reload(); onChanged && onChanged();
      } else setError((res && res.error) || 'رسید ثبت نشد.');
    } catch (e) { setError('رسید ثبت نشد؛ ارتباط با سرور برقرار نشد.'); }
    finally { setBusy(''); }
  }

  async function changeCheque(id, next) {
    if (busy) return;
    setBusy(`${id}-${next}`); setError(''); setDone('');
    try {
      const res = await window.printshopApi.receiptCheque(id, next);
      if (res && res.ok) { setDone(`رسید ${showNo(res.receipt.number)} — ${statuses[res.receipt.status] || res.receipt.status}.`); reload(); onChanged && onChanged(); }
      else setError((res && res.error) || 'وضعیت چک تغییر نکرد.');
    } catch (e) { setError('وضعیت چک تغییر نکرد؛ ارتباط با سرور برقرار نشد.'); }
    finally { setBusy(''); }
  }

  async function voidSelected() {
    if (busy || !voidFor) return;
    setBusy('void'); setError(''); setDone('');
    try {
      const res = await window.printshopApi.voidReceipt({ id: voidFor, reason: voidReason });
      if (res && res.ok) { setDone(`رسید ${showNo(res.receipt.number)} باطل شد؛ بدهی به پرونده برگشت.`); setVoidFor(''); setVoidReason(''); reload(); onChanged && onChanged(); }
      else setError((res && res.error) || 'ابطال انجام نشد.');
    } catch (e) { setError('ابطال انجام نشد؛ ارتباط با سرور برقرار نشد.'); }
    finally { setBusy(''); }
  }

  return (
    <section className="document-panel" dir="rtl">
      <header className="document-heading">
        <div>
          <h2>دفتر رسید وجه — {(order && order.customerName) || 'این مشتری'}</h2>
          <p>هر دریافت یک رسید با شمارهٔ خودکار دارد و ریال‌به‌ریال به فاکتورِ صادرشده، به سفارشِ تأییدشده یا به «پیش‌پرداخت» می‌نشیند. ردیف‌های پرداختِ همین سفارش بازتابِ این دفترند؛ از این صفحه چیزی جز رسید ثبت نمی‌شود.</p>
        </div>
        <button type="button" className="document-secondary" onClick={reload}>تازه‌سازی از سرور</button>
      </header>

      {error && <div className="document-error" role="alert">{error}</div>}
      {done && <div className="document-success" role="status">{done}</div>}

      <Totals totals={ledger.totals || {}} statuses={statuses} fmt={fmt} faDate={faDate} />

      <div>
        <strong>ثبت رسید</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 6, alignItems: 'end' }}>
          <Labelled text="مبلغ — ریال" width={170}><input name="amount" inputMode="numeric" dir="ltr" style={box} value={form.amount} onChange={e => set('amount', digits(e.target.value))} /></Labelled>
          <Labelled text="روش دریافت"><select name="method" style={box} value={form.method} onChange={e => set('method', e.target.value)}>{(ledger.methods || []).map(m => <option key={m} value={m}>{m}</option>)}</select></Labelled>
          <Labelled text="تاریخ دریافت"><div style={{ minWidth: 150 }}>{DateInput ? <DateInput name="receivedAt" value={today} onChange={v => set('receivedAt', v)} /> : <input name="receivedAt" style={box} value={today} readOnly />}</div></Labelled>
          <Labelled text="یادداشت"><input name="note" style={box} maxLength={500} value={form.note} onChange={e => set('note', e.target.value)} /></Labelled>
        </div>
        {cheque && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10, alignItems: 'end', background: '#f7f0e4', border: '1px solid #e3d6bc', borderRadius: 10, padding: 10 }}>
            <Labelled text="شماره چک"><input name="chequeNumber" style={box} maxLength={40} value={form.chequeNumber} onChange={e => set('chequeNumber', e.target.value)} /></Labelled>
            <Labelled text="بانک"><input name="chequeBank" style={box} maxLength={80} value={form.chequeBank} onChange={e => set('chequeBank', e.target.value)} /></Labelled>
            <Labelled text="شعبه"><input name="chequeBranch" style={box} maxLength={60} value={form.chequeBranch} onChange={e => set('chequeBranch', e.target.value)} /></Labelled>
            <Labelled text="سررسید چک"><div style={{ minWidth: 150 }}>{DateInput ? <DateInput name="chequeDue" value={form.chequeDue} onChange={v => set('chequeDue', v)} /> : <input name="chequeDue" style={box} value={form.chequeDue} readOnly />}</div></Labelled>
            <div className="document-footnote">چکِ تازه‌گرفته‌شده «در دست» است: مطالبهٔ مشتری را کم می‌کند، ولی تا روز وصول نقدِ صندوق شمرده نمی‌شود.</div>
          </div>
        )}
      </div>

      <div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>تخصیص وجه</strong>
          <button type="button" name="alloc-auto" className="document-secondary" onClick={() => setManual(false)} style={manual ? {} : { fontWeight: 800 }}>پیشنهاد سرور</button>
          <button type="button" name="alloc-manual" className="document-secondary" onClick={() => setManual(true)} style={manual ? { fontWeight: 800 } : {}}>خودم تقسیم کنم</button>
          <button type="button" name="record-receipt" disabled={busy === 'receipt' || !typed} onClick={submit}>{busy === 'receipt' ? 'در حال ثبت…' : 'ثبت رسید و تخصیص'}</button>
        </div>
        <div className="document-footnote" style={{ margin: '6px 0' }}>
          {manual
            ? 'مبلغ هر ردیف را می‌توانید عوض کنید؛ جمعِ بیشتر از ماندهٔ همان سفارش یا بیشتر از مبلغ رسید، کل درخواست را رد می‌کند.'
            : 'تا دست نزنید، سرور خودش اول فاکتورهای صادرشده را از سررسیدِ گذشته پر می‌کند و باقی‌مانده پیش‌پرداخت می‌ماند.'}
        </div>
        <div className="document-table-wrap">
          <table>
            <thead><tr>{['سفارش', 'نوع', 'منبع مبلغ', 'سررسید', 'مانده (ریال)', manual ? 'مبلغ این ردیف (ریال)' : 'پیشنهاد سرور (ریال)'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {open.map(l => (
                <tr key={l.orderId}>
                  <td><bdi>{l.orderNumber || 'معلق'}</bdi>{order && l.orderId === order.id ? ' — همین سفارش' : ''}</td>
                  <td>{l.kind === 'definite' ? 'بدهی قطعی' : 'تعهد (بی‌فاکتور)'}</td>
                  <td>{l.source}</td>
                  <td>{l.dueDate ? faDate(l.dueDate) : '—'}{l.overdue ? ' — گذشته از موعد' : ''}</td>
                  <td style={num}>{fmt(l.open)}</td>
                  <td style={num}>
                    {manual
                      ? <input name={`alloc-${l.orderId}`} inputMode="numeric" dir="ltr" style={box} value={alloc[l.orderId] === undefined ? String(proposedOf(l.orderId)) : alloc[l.orderId]} onChange={e => setAlloc(prev => ({ ...prev, [l.orderId]: digits(e.target.value) }))} />
                      : fmt(proposedOf(l.orderId))}
                  </td>
                </tr>
              ))}
              {!open.length && <tr><td colSpan={6} className="document-empty">این مشتری ردیفِ بازی ندارد؛ کلِ رسید «پیش‌پرداخت» می‌ماند و بعداً به فاکتور می‌خورد.</td></tr>}
              {typed > 0 && <tr><td colSpan={5} style={{ fontWeight: 700 }}>باقی‌مانده به‌عنوان پیش‌پرداخت{proposal && proposal.advance !== advance ? ' (پیشنهاد سرور: ' + fmt(proposal.advance) + ')' : ''}</td><td style={num}>{fmt(advance)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <strong>رسیدهای این مشتری ({fmt(receipts.length)})</strong>
        <div className="document-table-wrap" style={{ marginTop: 6 }}>
          <table>
            <thead><tr>{['رسید', 'تاریخ', 'روش', 'مبلغ (ریال)', 'وضعیت', 'تخصیص', 'چک', 'ثبت‌کننده', 'یادداشت', 'اقدام'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {receipts.map(r => {
                const allocatedSum = (r.allocations || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
                const mine = r.orderId === (order && order.id) || (r.allocations || []).some(a => a.orderId === (order && order.id));
                return (
                  <Fragment key={r.id}>
                    <tr style={mine ? { background: '#f3f8f1' } : undefined}>
                      <td><bdi>{showNo(r.number)}</bdi>{r.opening ? ' — افتتاحیه' : ''}</td>
                      <td>{faDate(r.receivedAt)}</td>
                      <td>{r.method}</td>
                      <td style={num}>{fmt(r.amount)}</td>
                      <td>{statuses[r.status] || r.status}</td>
                      <td>
                        {(r.allocations || []).map(a => <div key={a.id}><bdi>{orderNumber(a.orderId)}</bdi> — {a.documentId ? 'فاکتور' : 'سفارش'}: {fmt(a.amount)}</div>)}
                        {allocatedSum < r.amount && <div>پیش‌پرداخت: {fmt(r.amount - allocatedSum)}</div>}
                        {r.voidReason && <div className="document-footnote">ابطال: {r.voidReason}{r.voidedBy ? ` — ${r.voidedBy}` : ''}</div>}
                      </td>
                      <td>{r.cheque ? <div><bdi>{r.cheque.number}</bdi>{r.cheque.bank ? ` — ${r.cheque.bank}` : ''}{r.cheque.branch ? ` / ${r.cheque.branch}` : ''}{r.cheque.due && <div>سررسید {faDate(r.cheque.due)}</div>}{r.clearedAt && <div>وصول {faDate(r.clearedAt)}</div>}</div> : '—'}</td>
                      <td>{r.createdBy || '—'}</td>
                      <td>{r.note || '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(chequeActions[r.status] || []).map(next => (
                          <button type="button" key={next} name={`cheque-${next}-${r.id}`} className="document-secondary" disabled={!!busy} onClick={() => changeCheque(r.id, next)}>{statuses[next] || next}</button>
                        ))}
                        {r.status !== VOID && <button type="button" name={`void-${r.id}`} disabled={!!busy} onClick={() => { setVoidFor(voidFor === r.id ? '' : r.id); setVoidReason(''); setDone(''); }}>ابطال</button>}
                      </td>
                    </tr>
                    {voidFor === r.id && (
                      <tr><td colSpan={10} style={{ padding: 0 }}>
                        <div className="document-void-form">
                          <strong>ابطالِ رسید {showNo(r.number)} — این کادر یک سند می‌سازد، نه یک کلیک</strong>
                          <textarea name="void-reason" rows={2} maxLength={2000} style={box} value={voidReason} onChange={e => setVoidReason(e.target.value)} placeholder="دلیل ابطال (حداقل ۱۰ نویسه)" />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" name="void-submit" disabled={voidReason.trim().length < 10 || busy === 'void'} onClick={voidSelected}>{busy === 'void' ? 'در حال ابطال…' : 'ثبت ابطال'}</button>
                            <button type="button" className="document-secondary" onClick={() => setVoidFor('')}>بستن</button>
                          </div>
                          <div className="document-footnote">پس از ابطال، ردیف از بازتابِ سفارش بیرون می‌رود و بدهی همان لحظه به پروندهٔ اعتباری برمی‌گردد؛ خودِ ردیف در بانک می‌ماند.</div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
              {!receipts.length && <tr><td colSpan={10} className="document-empty">هنوز رسیدی برای این مشتری ثبت نشده است؛ دریافتِ وجه از کادرِ همین صفحه ثبت می‌شود.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="document-footnote">ستون «تاریخ» تاریخِ دریافت است، نه تاریخِ وصولِ چک؛ وصولِ قطعی و ابطال بازگشت‌ناپذیرند.</div>
      </div>
    </section>
  );
}
