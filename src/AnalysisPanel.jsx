import { CircleCheck, TriangleAlert } from 'lucide-react';

const number = value => Number(value || 0).toLocaleString('fa-IR');
const sheetName = value => Array.isArray(value) ? value.map(number).join(' × ') : String(value || '');
export default function AnalysisPanel({ a }) {
  if (!a) return null;
  const n = a.numbers || {};
  const rows = [
    ['کاغذ متن', [n.textGsm && `${number(n.textGsm)} گرم`, sheetName(n.sheet), n.pagesPerSheet ? `هر ورق ${number(n.pagesPerSheet)} صفحه` : ''].filter(Boolean).join(' · '), n.textSheetsTotal, 'ورق'],
    ...(!n.digital && n.textPlates ? [['زینک متن', n.colorRangeLabel ? `${n.colorRangeLabel} · ${number(n.textFormsCharged)} فرم` : `${number(n.textColors)} رنگ · ${number(n.forms)} فرم`, n.textPlates, 'زینک']] : []),
    ...(n.coverSheetsTotal ? [['کاغذ / مقوای جلد', [n.coverGsm && `${number(n.coverGsm)} گرم`, sheetName(n.coverSheet), n.coverFit ? `${number(n.coverFit)} جلد در ورق` : ''].filter(Boolean).join(' · '), n.coverSheetsTotal, 'ورق']] : []),
    ...(n.coverPlates ? [['زینک جلد', `${number(n.coverColors)} رنگ · ${number(n.coverSides)} رو`, n.coverPlates, 'زینک']] : []),
    ...(n.cellArea ? [['سلفون', n.cellLabel || n.cellType || '—', n.cellArea, 'مترمربع']] : []),
    ...(n.bindingFormsCharged ? [['صحافی', `متن + جلد${n.bindingMinForms ? ` · ${n.bindingRule}` : ''}`, n.bindingFormsCharged, 'فرم / نسخه']] : (n.bindingForms ? [['صحافی', 'فرم متن و جلد برای هر نسخه', n.bindingForms, 'فرم / نسخه']] : [])),
    ...(n.runQty ? [['تیراژ چاپ', `${number(n.qty)} نسخه + ${number(n.runWaste)} باطله`, n.runQty, 'نسخه']] : []),
  ];
  return <section className={`analysis-panel${a.ok ? '' : ' analysis-panel-error'}`} aria-label="نتیجهٔ تحلیل سفارش">
    <header className="analysis-panel-header"><h3>{a.ok ? <CircleCheck size={18}/> : <TriangleAlert size={18}/>} {a.ok ? 'نتیجهٔ تحلیل و محاسبه' : 'تحلیل کامل نشد'}</h3><span>{a.ok ? 'برآورد قابل بازبینی' : 'منتظر تأیید شما — عددی ساخته نشد'}</span></header>
    {(a.errors || []).map((error, i) => <p className="analysis-error" key={i}>{error}</p>)}
    {a.ok && <div className="analysis-table-wrap"><table className="analysis-table"><thead><tr>{['ردیف', 'بخش', 'مشخصات', 'مقدار', 'واحد'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(([part, description, qty, unit], index) => <tr key={part}><td data-label="ردیف">{number(index + 1)}</td><td data-label="بخش">{part}</td><td data-label="مشخصات">{description || '—'}</td><td data-label="مقدار" className="analysis-number">{number(qty)}</td><td data-label="واحد">{unit}</td></tr>)}</tbody></table></div>}
    {(a.warnings || []).length > 0 && <ul className="analysis-warnings">{a.warnings.map((warning, i) => <li key={i}><TriangleAlert size={15}/><span>{warning}</span></li>)}</ul>}
    {!a.ok && (a.waiting || []).length > 0 && <div className="analysis-wait-rows"><table><thead><tr><th>بخش</th><th>مقدار</th><th>واحد</th></tr></thead><tbody>{a.waiting.map((row, i) => <tr key={i}><td>{row.part}</td><td className="analysis-gap">— —</td><td>{row.unit}</td></tr>)}</tbody></table></div>}
    {a.ok && (a.steps || []).length > 0 && <details className="analysis-details"><summary>جزئیات فنی و فرض‌های محاسبه</summary><ol>{a.steps.map((step, i) => <li key={i}>{step}</li>)}</ol></details>}
    {a.ok && <p className="analysis-footnote">انتخاب مواد در جزئیات تولید قابل بازبینی است. موجودی باید بررسی شود؛ قیمت‌گذاری در کارتابل مالی انجام می‌شود.</p>}
    {!a.ok && (a.waiting || []).length > 0 && <p className="analysis-footnote">عددِ حدسی نوشته نمی‌شود. فیلدهای زردرنگ فقط پیشنهادند؛ با زدن «تأیید» جواب می‌شوند و جدول پر می‌شود.</p>}
  </section>;
}
