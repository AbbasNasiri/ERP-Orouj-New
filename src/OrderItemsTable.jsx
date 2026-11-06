import { Fragment, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { lexicon } from './smart.js';
import { CELLO_OPTIONS, celloComboOf, celloPatch, celloLabel } from './cellophane.js';
import { coverRun } from './print-run.mjs';
import './order-items-table.css';

const fa = value => Number(value || 0).toLocaleString('fa-IR');
const HEADS = ['ردیف', 'شرح محصول', 'نوع محصول', 'قطع', 'صفحات', 'کاغذ متن', 'گرماژ', 'رنگ متن', 'کاغذ جلد', 'گرماژ جلد', 'سلفون', 'صحافی', 'روش چاپ', 'تیراژ', 'واحد', 'وضعیت', 'عملیات'];
const PAPER_CATS = ['کاغذ', 'مقوا'];
const dash = <span className="oit-na">—</span>;
const text = value => <span className="oit-static">{value}</span>;
const pair = (title, value) => (value === null || value === undefined || value === '' ? null : <span className="oit-dv"><span className="oit-dt">{title}</span><span className="oit-dvv">{value}</span></span>);
const size = sheet => (Array.isArray(sheet) && sheet.length === 2 ? `${sheet[0]}×${sheet[1]}` : '');
const faToEn = s => String(s || '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const parseSize = text => { const m = faToEn(text).match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i); return m ? [Number(m[1]), Number(m[2])] : null; };
const sameSize = (a, b) => !!a && !!b && ((a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]));
/* اگر سایز کالای انتخاب‌شده با ورق موردنیازِ محاسبه نخواند، متن هشدار برمی‌گرداند */
export function stockSizeWarning(stock, needed) {
  const have = parseSize(stock && stock.size);
  const need = (needed || []).filter(s => Array.isArray(s) && s.length === 2);
  if (!have || !need.length) return '';
  if (need.some(s => sameSize(have, s))) return '';
  return `سایز این کالا (${have[0]}×${have[1]}) با ورق موردنیاز کار (${need.map(size).join(' یا ')}) نمی‌خواند؛ کالای دیگری انتخاب کنید.`;
}

function statusOf(item) {
  if (!item.analysis) return { text: 'بدون محاسبه', tone: 'idle' };
  if (item.analysis.error || (item.analysis.errors || []).length) return { text: 'نیاز به بررسی', tone: 'warn' };
  if (item.analysis.ok === false && (item.analysis.waiting || []).length) return { text: 'منتظر تأیید', tone: 'warn' };
  return { text: 'محاسبه شد', tone: 'ok' };
}

/* کارفرما (۱۴۰۵/۰۸/۰۳): یک قلمِ کتاب/مجله دو ردیف نمایشی دارد — متن، و جلد و صحافی —
   چون دایرةالمعارف آن نوع را «جلد و صحافی دارد» می‌شناسد. داده همان یک قلم می‌ماند. */
const n0 = (item, key) => ((item.analysis || {}).numbers || {})[key];
const partsOf = (item, bookLike) => (bookLike && item.coverEnabled ? ['text', 'cover'] : ['text']);

export default function OrderItemsTable({ items, productTypes, qtyUnits, bindingTypes, bookLikeTypes, colorOpts, pressTypes, inventory, customers, canAddStock, onAddStock, onAddProductType, onRemoveProductType, onAddQtyUnit, onRemoveQtyUnit, optionSelect, onChangeItem, onRemoveItem, onAddItem, onOpenItem, onRecalc }) {
  const [openRows, setOpenRows] = useState(() => []);
  const [zoom, setZoom] = useState(false);
  const hostRef = useRef(null);
  const toggleRow = key => setOpenRows(rows => rows.includes(key) ? rows.filter(row => row !== key) : [...rows, key]);
  const patch = (item, changes) => onChangeItem({ ...item, ...changes });
  const patchSpec = (item, key, value) => {
    const spec = { ...item.spec, [key]: value };
    // تغییر قطع یا رنگ، تأیید قبلیِ پرسش موتور را باطل می‌کند.
    if (key === 'textColors') ['colourUniform', 'colourBlocks', 'colourConfirmed'].forEach(k => delete spec[k]);
    if (key === 'sizeKey') ['cutForm', 'cutFormConfirmed', 'colourUniform', 'colourBlocks', 'colourConfirmed'].forEach(k => delete spec[k]);
    onChangeItem({ ...item, spec });
  };
  const specSelect = (item, key, value, aria, children, extra) => <select aria-label={aria} value={value ?? ''} onChange={event => patchSpec(item, key, extra ? extra(event.target.value) : event.target.value)}>{children}</select>;
  const itemSelect = (item, key, value, aria, children, extra) => <select aria-label={aria} value={value ?? ''} onChange={event => patch(item, { [key]: event.target.value, ...(extra ? extra(event.target.value) : {}) })}>{children}</select>;
  const totalRun = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

  const toggleZoom = () => {
    const modal = hostRef.current && hostRef.current.closest('.ui-modal');
    const next = !zoom;
    if (modal) modal.classList.toggle('is-zoom', next);
    setZoom(next);
  };

  /* ردیف موادِ مصرفیِ همان قلم: «برداشت از» و «مرکز هزینه» از اینجا خوانده می‌شود. */
  const materialOf = (rows) => (rows || []).find(row => row.inventoryItemId) || (rows || [])[0] || null;
  const neededSheets = (item, key) => {
    if (key === 'papers') return [n0(item, 'sheet')];
    if (key === 'coverPapers') return [n0(item, 'coverSheet')];
    return [];
  };
  const stockOptions = (item, rows, cats, key) => {
    const need = neededSheets(item, key);
    const wanted = [...inventory.filter(stock => cats.includes(stock.category))]
      .sort((a, b) => (stockSizeWarning(a, need) ? 1 : 0) - (stockSizeWarning(b, need) ? 1 : 0));
    const chosen = materialOf(rows);
    const unique = [...new Map(wanted.map(stock => [stock.id, stock])).keys()];
    return <>
      <option value="">— انتخاب —</option>
      {chosen && chosen.inventoryItemId && !unique.includes(chosen.inventoryItemId) ? <option value={chosen.inventoryItemId}>{chosen.description || 'مصرف ثبت‌شده'}</option> : null}
      {unique.map(id => { const st = inventory.find(stock => stock.id === id); return <option key={id} value={id}>{st.name}{st.size ? ` (${st.size})` : ''}{stockSizeWarning(st, need) ? ' ⚠ سایز نمی‌خواند' : ''}</option>; })}
    </>;
  };
  const pickMaterial = (item, key, id) => {
    const stock = inventory.find(entry => entry.id === id) || null;
    const rows = item[key] || [];
    const first = materialOf(rows);
    const next = {
      ...(first || { inventoryItemId: '', description: '', owner: 'چاپخانه', ownerCustomerId: '', ownerName: 'چاپخانه', qty: '', qtyUnit: 'ورق', unitLabel: 'ورق' }),
      inventoryItemId: id || '',
      description: stock ? `${stock.name}${stock.gramaj ? ' - گراماژ ' + stock.gramaj : ''}${stock.size ? ' - سایز ' + stock.size : ''}` : '',
      owner: stock ? (stock.ownerType || 'چاپخانه') : 'چاپخانه',
      ownerCustomerId: stock ? (stock.ownerCustomerId || '') : '',
      ownerName: stock ? (stock.ownerType === 'مشتری' ? `مشتری: ${(customers.find(c => c.id === stock.ownerCustomerId) || {}).name || '—'}` : 'چاپخانه') : 'چاپخانه',
      qtyUnit: stock && stock.unitMode === 'band_sheet' ? 'بند' : 'ورق',
      unitLabel: stock && stock.unitMode === 'band_sheet' ? 'بند' : (stock ? (stock.simpleUnit || 'ورق') : 'ورق'),
    };
    const rest = rows.filter(row => row !== first);
    patch(item, { [key]: [next, ...rest] });
  };
  const setMaterialQty = (item, key, value) => {
    const rows = item[key] || [];
    const first = materialOf(rows);
    if (!first) return;
    patch(item, { [key]: rows.map(row => row === first ? { ...row, qty: value } : row) });
  };
  const materialCell = (item, key, title, cats, extra) => {
    const row = materialOf(item[key]);
    return <>
      {extra}
      {pair('مرکز هزینه', row ? (row.ownerName || 'چاپخانه') : null)}
      <label className="oit-dfield"><span className="oit-dt">برداشت از</span>
        <select aria-label={`${title} — برداشت از انبار`} value={row ? row.inventoryItemId : ''} onChange={event => pickMaterial(item, key, event.target.value)}>{stockOptions(item, item[key], cats, key)}</select>
        {(() => { const st = row && inventory.find(s => s.id === row.inventoryItemId); const w = st ? stockSizeWarning(st, neededSheets(item, key)) : ''; return w ? <small className="oit-sizewarn" role="alert">{w}</small> : null; })()}
        {canAddStock && onAddStock
          ? <button type="button" className="oit-addstock" onClick={() => onAddStock(cats[0])}>+ افزودن کالا به انبار</button>
          : (inventory.some(stock => cats.includes(stock.category)) ? null : <small className="oit-nostock">کالا موجود نیست؛ از مدیر بخواهید در انبار ثبت کند.</small>)}
      </label>
      <label className="oit-dfield"><span className="oit-dt">مقدار</span>
        <span className="oit-dq"><input aria-label={`${title} — مقدار مصرف`} type="number" min="0" dir="ltr" value={row ? row.qty : ''} onChange={event => setMaterialQty(item, key, event.target.value)} /><bdi>{row ? row.unitLabel : 'ورق'}</bdi></span>
      </label>
    </>;
  };

  /* ستون‌های ردیفِ جزئیات: هر مقدار زیر همان ستون و با عنوان خودش */
  const detailCells = (item, part) => {
    const sp = item.spec || {};
    const a = item.analysis || {};
    const n = a.numbers || {};
    const cover = part === 'cover';
    const press = cover ? (item.coverPress || '') : (item.press || '');
    const pressOptions = <label className="oit-dfield"><span className="oit-dt">{cover ? 'ماشین جلد' : 'ماشین چاپ'}</span>
      <select aria-label={cover ? 'ماشین چاپ جلد' : 'ماشین چاپ متن'} value={press} onChange={event => patch(item, { [cover ? 'coverPress' : 'press']: event.target.value })}>{pressTypes.map(type => <option key={type} value={type}>{type}</option>)}</select>
    </label>;
    const statusFlags = <>
      {(item.assumptions || []).length ? pair('فرض‌ها', `${fa(item.assumptions.length)} فرض`) : null}
      {(a.warnings || []).length ? pair('هشدارها', `${fa(a.warnings.length)} هشدار`) : null}
      {(a.errors || []).length ? pair('خطاها', a.errors[0]) : null}
      <button type="button" className="oit-recalc" onClick={() => onRecalc(item)}>محاسبهٔ مجدد</button>
    </>;
    if (cover) return [
      pair('بخش از قلم', `${item.productName || item.productType || '—'} — جلد و صحافی`),
      pair('نوع جلد', item.coverType),
      <>
        {pair('جلد باز', n.coverW ? `${n.coverW}×${n.coverH} سانتی‌متر` : null)}
        {pair('عطف کتاب', n.spine ? `${n.spine} سانتی‌متر` : null)}
        {pair('در هر ورق', n.coverFit ? `${fa(n.coverFit)} جلد` : null)}
      </>,
      null, null, null, null,
      materialCell(item, 'coverPapers', 'مقوای جلد', PAPER_CATS, pair('گرماژ', n.coverGsm ? `${fa(n.coverGsm)} گرم` : (sp.coverGsm ? `${fa(sp.coverGsm)} گرم` : null))),
      pair('ورق جلد مصرفی', n.coverSheetsTotal ? `${fa(n.coverSheetsTotal)} ورق` : null),
      sp.cellophane ? materialCell(item, 'coverCellophane', 'سلفون جلد', ['سلفون'], pair('سلفون', `${celloLabel(sp)}${n.cellArea ? ` — ${fa(n.cellArea)} مترمربع` : ''}`)) : null,
      <>
        {pair('فرم × تیراژ', n.bindingFormsCharged ? `${fa(n.bindingFormsCharged)} فرم${n.bindingFormsCharged > n.bindingForms ? ` (حداقل ${fa(n.bindingMinForms)})` : ''} × ${fa(n.runQty || Number(item.qty) || 0)}` : (n.bindingForms ? `${fa(n.bindingForms)} × ${fa(Number(item.qty) || 0)}` : null))}
        <label className="oit-dfield"><span className="oit-dt">توضیح صحافی</span><input aria-label="توضیحات صحافی / تولید" value={item.bindingNotes || ''} onChange={event => patch(item, { bindingNotes: event.target.value })} /></label>
      </>,
      <>
        {pair('فرم ماشین', n.pressForm ? `${fa(n.pressForm)} صفحه` : null)}
        {pair('زینک جلد', n.coverPlates ? `${fa(n.coverPlates)} قطعه (${fa(n.coverColors || sp.coverColors || 0)} رنگ × ${fa(n.coverSides || sp.coverSides || 1)} رو)` : null)}
        {pressOptions}
      </>,
      item.coverEnabled ? pair('تیراژ جلد', (() => {
        if (n.coverSheetsTotal) {
          const sheet = n.coverSheet ? n.coverSheet.join('×') : '';
          return `${fa(n.coverSheetsNet)} خالص + ${fa(n.coverWasteSheets)} باطله = ${fa(n.coverSheetsTotal)} ورق${sheet ? ` ${sheet}` : ''} (${fa(n.coverFit || 1)} جلد در هر ورق${n.coverColors ? ` — ${fa(n.coverColors)} رنگ` : ''})`;
        }
        const run = coverRun(item.qty, item.coverPress);
        return `${fa(run.sheetsNet)} خالص + ${fa(run.waste)} باطله = ${fa(run.sheets)} ورق (${fa(run.coversPerSheet)} جلد در هر ورق — ${run.press})`;
      })()) : null,
      null,
      statusFlags,
    ];
    const bookLike = bookLikeTypes.includes(item.productType);
    return [
      pair('بخش از قلم', `${item.productName || item.productType || '—'}${partsOf(item, bookLike).length > 1 ? ' — متن' : ''}`),
      pair('جلد و صحافی دارد', bookLike ? (item.coverEnabled ? 'بله (دایرةالمعارف)' : 'بله — جلد خاموش است') : 'خیر'),
      <>
        {pair('در هر ورق', n.fit ? `${fa(n.fit)} قطعه${n.pagesPerSheet ? ` — با تا ${fa(n.pagesPerSheet)} صفحه` : ''}` : null)}
        {pair('قطع چاپی', size(n.trim))}
      </>,
      <>
        {pair('کاغذ مصرفی با تیراژ', n.textSheetsTotal ? `${fa(n.textSheetsTotal)} ورق` : null)}
        {pair('برای هر نسخه', n.sheetsPerCopy ? `${fa(n.sheetsPerCopy)} ورق` : null)}
      </>,
      materialCell(item, 'papers', 'کاغذ متن', PAPER_CATS, pair('هر ورق', size(n.sheet))),
      null,
      <>
        {pair('زینک متن', n.textPlates ? `${fa(n.textPlates)} قطعه${n.platesPerColor ? ` (${fa(n.platesPerColor)} × ${fa(n.textColors)} رنگ)` : ''}` : null)}
        {!bookLike ? <label className="oit-dfield"><span className="oit-dt">رو / پشت</span>
          <select aria-label="رو یا پشت چاپ" value={String(sp.textSides || 1)} onChange={event => patchSpec(item, 'textSides', Number(event.target.value))}><option value="1">یک‌رو</option><option value="2">دورو (رو و پشت)</option></select>
        </label> : null}
      </>,
      null, null,
      !bookLike && sp.cellophane ? materialCell(item, 'bindingMaterials', 'سلفون', ['سلفون'], pair('سلفون', celloLabel(sp))) : null,
      !item.coverEnabled ? <>
        {pair('فرم صحافی', n.bindingFormsCharged ? `${fa(n.bindingFormText)} متن + ${fa(n.bindingFormCover)} جلد = ${fa(n.bindingFormsCharged)} فرم${n.bindingFormsCharged > n.bindingForms ? ` (حداقل ${fa(n.bindingMinForms)})` : ''}` : (n.bindingForms ? `${fa(n.bindingForms)} فرم` : null))}
        <label className="oit-dfield"><span className="oit-dt">توضیح صحافی</span><input aria-label="توضیحات صحافی / تولید" value={item.bindingNotes || ''} onChange={event => patch(item, { bindingNotes: event.target.value })} /></label>
      </> : null,
      <>
        {pair('فرم ماشین', n.pressForm ? `${fa(n.pressForm)} صفحه — ${fa(n.textFormsCharged ?? n.forms ?? 0)} فرم` : null)}
        {pair('دستور چاپ', n.pressPlan && n.pressPlan.length ? n.pressPlan.map(p => `${fa(p.sheets)} ورق ${fa(p.pages)} ص`).join(' + ') : null)}
        {pair('باطله', n.runWaste ? `${fa(n.runWaste)} ${item.qtyUnit || 'نسخه'}` : (item.waste ? `${fa(item.waste)} ${item.qtyUnit || 'نسخه'}` : (n.textSheetsTotal && n.textSheetsNet ? `${fa(n.textSheetsTotal - n.textSheetsNet)} ورق` : null)))}
        {pressOptions}
      </>,
      pair('ورق متن', n.textSheetsTotal ? `${fa(n.textSheetsNet)} خالص + ${fa(n.textWasteSheets)} باطله = ${fa(n.textSheetsTotal)}` : (n.textSheetsNet ? `${fa(n.textSheetsNet)} + ${fa((n.textSheetsTotal || 0) - n.textSheetsNet)}` : null)),
      null,
      statusFlags,
    ];
  };

  return <div className="oit" ref={hostRef}>
    <div className="oit-bar">
      <button type="button" className="oit-zoom" aria-pressed={zoom} onClick={toggleZoom}>{zoom ? 'بازگرداندن' : 'بزرگ‌نمایی'}</button>
      <span className="oit-bari">«جزئیات» همان ردیف را باز می‌کند: هر مقدار زیر ستون خودش. لیست با «Ctrl + اسکرول» افقی جابه‌جا می‌شود.</span>
    </div>
    <div className="oit-scroll">
      <table className="oit-table">
        <caption>هر قلم یک یا دو ردیف است (کتاب و مجله: متن + جلد و صحافی). قیمت‌گذاری در بخش «خلاصه مالی» انجام می‌شود، نه اینجا.</caption>
        <thead><tr>{HEADS.map(head => <th key={head} scope="col">{head}</th>)}</tr></thead>
        <tbody>{items.map((item, index) => {
          const sp = item.spec || {};
          const bookLike = bookLikeTypes.includes(item.productType);
          const parts = partsOf(item, bookLike);
          const status = statusOf(item);
          return <Fragment key={item.id}>{parts.map((part, partIndex) => {
            const cover = part === 'cover';
            const key = `${item.id}:${part}`;
            const open = openRows.includes(key);
            const rowNo = parts.length > 1 ? `${fa(index + 1)}-${partIndex === 0 ? 'ا' : 'ب'}` : fa(index + 1);
            return <Fragment key={part}>
              <tr className={`oit-part${cover ? ' oit-cover' : ''}${open ? ' oit-open' : ''}`}>
                <th scope="row">{rowNo}</th>
                <td>{cover ? text(`${item.productName || item.productType || '—'} — جلد و صحافی`) : <input aria-label="شرح محصول" value={item.productName || ''} onChange={event => patch(item, { productName: event.target.value })} placeholder="مثلاً کتاب آموزشی" maxLength={200} />}</td>
                <td>{cover ? text(item.productType) : optionSelect({ options: productTypes, value: item.productType, onChange: value => patch(item, { productType: value }), onAddOption: onAddProductType, onRemoveOption: onRemoveProductType, placeholder: 'نوع جدید', ariaLabel: 'نوع محصول' })}</td>
                <td>{cover ? (size(n0(item, 'coverSheet')) ? text(`ورق جلد ${size(n0(item, 'coverSheet'))}`) : dash) : specSelect(item, 'sizeKey', sp.sizeKey || '', 'قطع', <><option value="">— انتخاب —</option>{Object.keys(lexicon.trimSizes).map(key => <option key={key} value={key}>{key}</option>)}</>)}</td>
                <td>{cover ? dash : (bookLike ? <input aria-label="تعداد صفحات" type="number" min="1" dir="ltr" value={sp.pages || ''} onChange={event => patchSpec(item, 'pages', event.target.value)} /> : dash)}</td>
                <td>{cover ? dash : specSelect(item, 'textKind', sp.textKind || '', 'نوع کاغذ متن', <><option value="">— انتخاب —</option>{lexicon.paperKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}</>)}</td>
                <td>{cover ? dash : <input aria-label="گرماژ کاغذ متن" type="number" min="0" dir="ltr" value={sp.textGsm || ''} onChange={event => patchSpec(item, 'textGsm', event.target.value)} />}</td>
                <td>{cover ? dash : specSelect(item, 'textColors', String(sp.textColors || 4), 'رنگ چاپ متن', colorOpts.map(([value, label]) => <option key={value} value={String(value)}>{label}</option>))}</td>
                <td>{cover ? specSelect(item, 'coverKind', sp.coverKind || '', 'نوع کاغذ جلد', <><option value="">— ندارد —</option>{lexicon.paperKinds.map(kind => <option key={kind} value={kind}>{kind}</option>)}</>) : dash}</td>
                <td>{cover ? <input aria-label="گرماژ جلد" type="number" min="0" dir="ltr" value={sp.coverGsm || ''} onChange={event => patchSpec(item, 'coverGsm', event.target.value)} /> : dash}</td>
                <td>{(!cover && item.coverEnabled) ? dash : <select aria-label="سلفون" value={celloComboOf(sp)} onChange={event => onChangeItem({ ...item, spec: { ...item.spec, ...celloPatch(event.target.value) } })}><option value="">بدون سلفون</option>{CELLO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}</td>
                <td>{(!cover && item.coverEnabled) ? dash : itemSelect(item, 'bindingType', item.bindingType || '', 'نوع صحافی', bindingTypes.map(type => <option key={type} value={type}>{type}</option>), value => ({ coverType: value.startsWith('گالینگور') ? 'سخت (گالینگور)' : 'نرم (شومیز)' }))}</td>
                <td>{cover ? text(sp.printMethod || 'افست') : specSelect(item, 'printMethod', sp.printMethod || 'افست', 'روش چاپ', ['افست', 'دیجیتال'].map(method => <option key={method} value={method}>{method}</option>))}</td>
                <td>{cover ? text(fa(Number(item.qty) || 0)) : <input aria-label="شمارگان (تیراژ)" type="number" min="0" dir="ltr" value={item.qty || ''} onChange={event => patch(item, { qty: event.target.value })} />}</td>
                <td>{cover ? text(item.qtyUnit) : optionSelect({ options: qtyUnits, value: item.qtyUnit, onChange: value => patch(item, { qtyUnit: value }), onAddOption: onAddQtyUnit, onRemoveOption: onRemoveQtyUnit, placeholder: 'واحد جدید', ariaLabel: 'واحد شمارگان' })}</td>
                <td><span className={`oit-status oit-${status.tone}`}>{status.text}</span>{open ? null : (item.assumptions || []).length ? <small className="oit-flag">{fa(item.assumptions.length)} فرض</small> : null}</td>
                <td className="oit-actions">
                  {!cover && bookLike ? <label className="oit-cover-toggle" title="با این تیک، ردیف «جلد و صحافی» ساخته می‌شود"><input type="checkbox" checked={!!item.coverEnabled} onChange={event => patch(item, { coverEnabled: event.target.checked })} /><span>جلد</span></label> : null}
                  <button type="button" className="oit-detail" aria-expanded={open} onClick={() => toggleRow(key)}>{open ? 'بستن' : 'جزئیات'}</button>
                  <button type="button" className="oit-remove" aria-label={`حذف قلم ${index + 1}`} title="حذف این قلم" onClick={() => onRemoveItem(item.id)}><Trash2 size={15} /></button>
                </td>
              </tr>
              {open ? <tr className={`oit-detail-row${cover ? ' oit-cover' : ''}`}>
                <th scope="row"></th>
                {detailCells(item, part).map((cell, cellIndex) => <td key={cellIndex}>{cell || dash}</td>)}
                <td className="oit-actions"><button type="button" className="oit-more" onClick={() => onOpenItem(item)}>ویرایش کامل قلم</button></td>
              </tr> : null}
            </Fragment>;
          })}</Fragment>;
        })}</tbody>
        <tfoot><tr>
          <th scope="row">جمع</th>
          <td colSpan={12} className="oit-total">{fa(items.length)} قلم — {fa(totalRun)} تعداد تیراژ ثبت‌شده</td>
          <td colSpan={4}><button type="button" className="oit-add" onClick={onAddItem}>+ افزودن قلم دستی</button></td>
        </tr></tfoot>
      </table>
    </div>
  </div>;
}
