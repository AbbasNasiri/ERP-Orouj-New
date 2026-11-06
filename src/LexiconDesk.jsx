import { useRef, useState } from 'react';
import './document-panels.css';
import './lexicon-desk.css';

const faDigits = (value) => String(value).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
const toLatinDigits = (value) => String(value).replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function RenameCell({ value, label, canEdit, onCommit }) {
  const [text, setText] = useState(value);
  if (!canEdit) return <span>{value}</span>;
  /* مقدار از خودِ DOM خوانده می‌شود: اگر تایپ و بلور در یک نوبت رخ دهند، state هنوز تازه نشده است. */
  return <input
    aria-label={label}
    value={text}
    onChange={(event) => setText(event.target.value)}
    onBlur={(event) => { const next = clean(event.currentTarget.value); setText(value); if (next && next !== value) onCommit(next); }}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
  />;
}

function TableShell({ title, hint, head, canEdit, rows, addFields, onAdd }) {
  const [draft, setDraft] = useState(() => addFields.map(() => ''));
  const addBox = useRef(null);
  function submit() {
    /* همان دلیلِ RenameCell: مقادیر تازه از DOM خوانده می‌شوند، نه از state که ممکن است هنوز ننوشته باشد. */
    const nodes = addBox.current ? [...addBox.current.querySelectorAll('input')] : [];
    const values = (nodes.length === addFields.length ? nodes : addFields.map(() => ({ value: '' }))).map(node => clean(node.value));
    if (values.some(v => !v)) return;
    if (onAdd(values) !== false) setDraft(addFields.map(() => ''));
  }
  const count = typeof rows === 'function' ? rows().length : rows.length;
  return (
    <section className="document-panel">
      <header className="document-heading"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div><span className="document-badge">{faDigits(count)} ردیف</span></header>
      <div className="document-table-wrap lexicon-grid">
        <table>
          <thead><tr>{head.map(cell => <th key={cell}>{cell}</th>)}{canEdit && <th>حذف</th>}</tr></thead>
          <tbody>{typeof rows === 'function' ? rows() : rows}{!count && <tr><td className="document-empty" colSpan={head.length + (canEdit ? 1 : 0)}>ردیفی ثبت نشده است.</td></tr>}</tbody>
        </table>
      </div>
      {canEdit && (
        <div className="document-actions lexicon-add" ref={addBox}>
          {addFields.map((field, index) => (
            <input key={field.label} aria-label={`${title}: ${field.label}`} value={draft[index]} placeholder={field.placeholder}
              inputMode={field.numeric ? 'decimal' : undefined} dir={field.ltr ? 'ltr' : undefined}
              onChange={(event) => setDraft(current => current.map((cell, i) => (i === index ? event.target.value : cell)))}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }} />
          ))}
          <button type="button" onClick={submit} disabled={draft.some(cell => !clean(cell))}>افزودن</button>
        </div>
      )}
    </section>
  );
}

export default function LexiconDesk({ canEdit, productTypes, onProductTypes, bookLikeTypes, onBookLikeTypes, bindingTypes, onBindingTypes, serviceTypes, onServiceTypes, paperKinds, onPaperKinds, trimSizes, onTrimSizes, engineCuts, onEngineCuts, enginePresses, onEnginePresses, printColors, onPrintColors, qtyUnits, onQtyUnits, invCategories, onInvCategories, requiredInvCategories, ledger, ledgerNote }) {
  const [warning, setWarning] = useState('');
  const reject = (text) => { setWarning(text); return false; };

  function rename(list, onChange, oldName, next) {
    if (list.some(item => item !== oldName && clean(item) === next)) return reject(`«${next}» در این فهرست وجود دارد.`);
    onChange(list.map(item => (item === oldName ? next : item)));
  }
  function add(list, onChange, name, tableTitle) {
    if (list.some(item => clean(item) === name)) return reject(`«${name}» در ${tableTitle} وجود دارد.`);
    onChange([...list, name]);
  }
  function remove(list, onChange, name, blocked) {
    if ((blocked || []).includes(name)) return reject(`«${name}» ستونِ اصلی انبار است و حذف نمی‌شود.`);
    onChange(list.filter(item => item !== name));
  }

  function listTable({ title, hint, nameHead, items, onChange, blocked, flagLabel }) {
    const head = flagLabel ? [nameHead, flagLabel] : [nameHead];
    return (
      <TableShell title={title} hint={hint} head={head} canEdit={canEdit}
        addFields={[{ label: nameHead, placeholder: `نام ${nameHead.toLowerCase()} جدید` }]}
        onAdd={([name]) => add(items, onChange, name, `«${title}»`)}
        rows={items.map(name => (
          <tr key={name}>
            <td><RenameCell value={name} label={`${title}: ${name}`} canEdit={canEdit} onCommit={next => rename(items, onChange, name, next)} /></td>
            {flagLabel && <td className="lexicon-flag"><input type="checkbox" aria-label={`${name}: ${flagLabel}`} checked={bookLikeTypes.includes(name)} disabled={!canEdit}
              onChange={() => onBookLikeTypes(bookLikeTypes.includes(name) ? bookLikeTypes.filter(x => x !== name) : [...bookLikeTypes, name])} /></td>}
            {canEdit && <td><button type="button" className="document-danger" onClick={() => remove(items, onChange, name, blocked)}>حذف</button></td>}
          </tr>
        ))} />
    );
  }

  const sizeNames = Object.keys(trimSizes);
  const nextColour = () => Math.max(0, ...printColors.map(pair => pair[0])) + 1;

  /* اصلاحات ۱۷/بند ۰: کدینگ و نگاشت رویداد→سند از سرور می‌آید و این‌جا فقط‌خواندنی است.
     تا کارفرما یا حسابدار تأیید نکند، هیچ سندی در دفترکل نوشته نمی‌شود. */
  function ledgerTables() {
    if (!ledger || !ledger.ok) {
      /* بدون جدول نگاشت نمی‌گذاریم؛ اگر سرور نپذیرفت، همان دلیلش نوشته می‌شود نه اینکه بخش غیب برود. */
      return ledgerNote ? <section className="document-panel"><header className="document-heading"><div><h3>دفترکل: کدینگ حساب‌ها و نگاشت رویداد به سند</h3><p>{ledgerNote}</p></div></header></section> : null;
    }
    const stats = ledger.check.stats;
    return (
      <>
        <section className="document-panel">
          <header className="document-heading"><div><h3>دفترکل: کدینگ حساب‌ها و نگاشت رویداد به سند</h3>
            <p>{ledger.approval.state}</p></div>
            <span className="document-badge">{faDigits(stats.accounts)} حساب · {faDigits(stats.rules)} قاعده</span></header>
          {!ledger.check.ok && <div role="alert" className="document-error">{ledger.check.errors.join(' — ')}</div>}
          <p className="document-footnote">
            {`قواعد ثبتیِ متوازن: ${faDigits(stats.balanced)} از ${faDigits(stats.posting)} · همینی که با دادهٔ امروز ثبت می‌شود: ${faDigits(stats.readyNow)} · منتظر گام‌های بعدی: ${faDigits(stats.waiting)} · قواعد مکانیزمی (سند تک‌خطی نمی‌دهند): ${faDigits(stats.mechanisms)} · حساب‌های بی‌کار: ${faDigits(stats.unusedAccounts.length)} · سطرهای دفترکلِ امروز: ${faDigits(ledger.live.entries || 0)}`}
          </p>
          {(ledger.resolvers || []).map(resolver => (
            <p className="document-footnote" key={resolver.key}><bdi dir="ltr">{resolver.key}</bdi> — {resolver.label}: {resolver.routes}</p>
          ))}
        </section>

        <TableShell title="کدینگ حساب‌ها" hint="گزیدهٔ حساب‌هایی که برای کار این چاپخانه لازم است؛ نه کل نمونهٔ اکسلی. تا تأیید شما منبع همه «پیشنهاد سیستم» است."
          head={['کد', 'عنوان حساب', 'گروه', 'ماهیت', 'قواعد ثبتی', 'منبع']} canEdit={false} addFields={[]} rows={ledger.accounts.map(account => (
            <tr key={account.code}>
              <td><bdi dir="ltr">{account.code}</bdi></td>
              <td>{account.title}</td>
              <td>{account.group}</td>
              <td>{account.nature}</td>
              <td>{faDigits(account.rules)}</td>
              <td>{account.approvedAt ? 'تأییدشده' : account.source}</td>
            </tr>
          ))} />

        <TableShell title="نگاشت رویداد به سند" hint="هر رویداد برنامه با چه حساب‌هایی و از کدام عدد سند می‌شود. مبالغ با نامِ فیلد نوشته شده‌اند، نه رقم."
          head={['رویداد', 'شرح داده', 'مسئول', 'بدهکار', 'بستانکار', 'وضعیت']} canEdit={false} addFields={[]} rows={ledger.rules.map(rule => (
            <tr key={rule.event}>
              <td>{rule.label}<div><bdi dir="ltr">{rule.event}</bdi></div></td>
              <td>{rule.kind === 'mechanism' ? rule.note : rule.source}</td>
              <td>{rule.kind === 'mechanism' ? '—' : rule.owner}</td>
              <td><bdi dir="ltr">{rule.debit || '—'}</bdi></td>
              <td><bdi dir="ltr">{rule.credit || '—'}</bdi></td>
              <td>{rule.kind === 'mechanism' ? 'سند تک‌خطی نمی‌دهد' : rule.status}</td>
            </tr>
          ))} />
      </>
    );
  }

  return (
    <div className="lexicon-desk">
      <section className="document-panel">
        <header className="document-heading"><div><h2>دایرةالمعارف چاپخانه</h2>
          <p>همهٔ واژه‌نامه‌های مرجع سفارش در یک‌جا. هر ردیفی که اینجا کم‌وزیاد شود، همان لحظه در فرم سفارش، تحلیل متن و جدول اقلام به کار می‌رود.</p></div></header>
        {warning && <div role="alert" className="document-error">{warning}</div>}
        {!canEdit && <p className="document-footnote">فقط مدیر چاپخانه می‌تواند این فهرست‌ها را تغییر دهد؛ مشاهده برای دیگر کارشناسان آزاد است.</p>}
      </section>

      {listTable({ title: 'نوع محصول', hint: 'با این نام‌ها سفارش ثبت می‌شود و در گفتار مشتری جست‌وجو می‌گردد.', nameHead: 'نام نوع محصول', items: productTypes, onChange: onProductTypes, blocked: ['سایر'], flagLabel: 'جلد و صحافی دارد' })}
      {listTable({ title: 'نوع صحافی', hint: 'نام صحافی در ردیف هزینهٔ صحافی و در فرمول واحد صحافی نوشته می‌شود.', nameHead: 'نام صحافی', items: bindingTypes, onChange: onBindingTypes })}
      {listTable({ title: 'خدمات تکمیلی', hint: 'لترپرس، یووی موضعی، برجسته‌کاری و مانند آن‌ها.', nameHead: 'نام خدمت', items: serviceTypes, onChange: onServiceTypes })}
      {listTable({ title: 'نوع کاغذ و مقوا', hint: 'در فیلد «نوع کاغذ متن/جلد» و در خواندن متن سفارش.', nameHead: 'نام کاغذ', items: paperKinds, onChange: onPaperKinds })}
      {listTable({ title: 'واحدهای تعداد', hint: 'واحد شمارگان در فرم سفارش.', nameHead: 'نام واحد', items: qtyUnits, onChange: onQtyUnits })}
      {listTable({ title: 'دسته‌های انبار', hint: 'دستهٔ کالا در کارت موجودی انبار.', nameHead: 'نام دسته', items: invCategories, onChange: onInvCategories, blocked: requiredInvCategories })}

      <TableShell title="قطع‌بندی چاپ (موتور محاسبه)" hint="صفحه در هر فرم، صفحه در هر ورق مادر ۷۰×۱۰۰ و نیم‌فرم‌های مجاز؛ برای هر قطعِ کتابی. نیم‌فرم‌ها را با ویرگول بنویسید (مثلاً ۸،۴)."
        head={['قطع', 'صفحه در فرم', 'صفحه در ورق مادر', 'نیم‌فرم‌های مجاز']} canEdit={canEdit}
        addFields={[{ label: 'نام قطع', placeholder: 'مثلاً وزیری' }, { label: 'صفحه در فرم', placeholder: '16', numeric: true, ltr: true }, { label: 'صفحه در ورق مادر', placeholder: '32', numeric: true, ltr: true }, { label: 'نیم‌فرم‌ها', placeholder: '8,4', ltr: true }]}
        onAdd={([name, fp, pp, parts]) => {
          const formPages = Number(toLatinDigits(fp)), paperPages = Number(toLatinDigits(pp));
          const partials = toLatinDigits(parts).split(/[,،]/).map(x => Number(x.trim())).filter(x => x);
          if (!Number.isInteger(formPages) || !Number.isInteger(paperPages) || formPages < 2 || paperPages % formPages) return reject('صفحه در ورق مادر باید مضرب صحیحِ صفحه در فرم باشد.');
          if (partials.some(p => !Number.isInteger(p) || p <= 0 || p >= formPages)) return reject('نیم‌فرم‌ها باید عدد صحیح و کوچک‌تر از صفحه در فرم باشند.');
          if (engineCuts[name]) return reject(`قطع «${name}» در موتور قبلاً ثبت شده است.`);
          const size = trimSizes[name] || [20, 28];
          onEngineCuts({ ...engineCuts, [name]: { formPages, paperPages, partials, trim: size } });
        }}
        rows={Object.keys(engineCuts).map(name => (
          <tr key={name}><td>{name}</td><td>{faDigits(engineCuts[name].formPages)}</td><td>{faDigits(engineCuts[name].paperPages)}</td><td>{engineCuts[name].partials.map(faDigits).join('، ') || '—'}</td>
            {canEdit && <td><button type="button" className="document-danger" onClick={() => { const { [name]: _, ...rest } = engineCuts; onEngineCuts(rest); }}>حذف</button></td>}</tr>
        ))} />

      <TableShell title="ماشین‌های چاپ (موتور محاسبه)" hint="ضریب زینک نسبت به ماشین ۴٫۵ ورقی (۱). دیجیتال ضریب صفر دارد و زینک نمی‌خواهد."
        head={['ماشین', 'ضریب زینک', 'برگ ماشین (سانتی‌متر)']} canEdit={canEdit}
        addFields={[{ label: 'نام ماشین', placeholder: 'مثلاً ۲ ورقی' }, { label: 'ضریب زینک', placeholder: '0.5', numeric: true, ltr: true }, { label: 'عرض برگ', placeholder: '50', numeric: true, ltr: true }, { label: 'ارتفاع برگ', placeholder: '70', numeric: true, ltr: true }]}
        onAdd={([name, factor, w, h]) => {
          const plateFactor = Number(toLatinDigits(factor)), sw = Number(toLatinDigits(w)), sh = Number(toLatinDigits(h));
          if (!(plateFactor > 0 && plateFactor <= 4) || !(sw > 0 && sw <= 200) || !(sh > 0 && sh <= 200)) return reject('ضریب زینک (تا ۴) و ابعاد برگ ماشین باید عددی معتبر باشند.');
          if (enginePresses[name]) return reject(`ماشین «${name}» قبلاً ثبت شده است.`);
          onEnginePresses({ ...enginePresses, [name]: { plateFactor, offset: true, sheet: [sw, sh] } });
        }}
        rows={Object.keys(enginePresses).map(name => (
          <tr key={name}><td>{name}</td><td>{faDigits(enginePresses[name].plateFactor)}</td><td>{enginePresses[name].offset ? `${faDigits(enginePresses[name].sheet[0])}×${faDigits(enginePresses[name].sheet[1])}` : 'بدون زینک'}</td>
            {canEdit && <td>{name === 'دیجیتال' ? '' : <button type="button" className="document-danger" onClick={() => { const { [name]: _, ...rest } = enginePresses; onEnginePresses(rest); }}>حذف</button>}</td>}</tr>
        ))} />
      <TableShell title="قطع‌ها" hint="ابعاد برش‌خوردهٔ محصول به سانتی‌متر؛ سطح کاغذ، فرم و زینک از همین جدول حساب می‌شود."
        head={['نام قطع', 'عرض (سانتی‌متر)', 'ارتفاع (سانتی‌متر)']} canEdit={canEdit}
        addFields={[{ label: 'نام قطع', placeholder: 'مثلاً وزیری' }, { label: 'عرض', placeholder: '17', numeric: true, ltr: true }, { label: 'ارتفاع', placeholder: '24', numeric: true, ltr: true }]}
        onAdd={([name, width, height]) => {
          const w = Number(toLatinDigits(width)), h = Number(toLatinDigits(height));
          if (!(w > 0) || !(h > 0) || w > 200 || h > 200) return reject('عرض و ارتفاع باید عددی بین ۰ تا ۲۰۰ سانتی‌متر باشد.');
          if (trimSizes[name]) return reject(`قطع «${name}» قبلاً ثبت شده است.`);
          onTrimSizes({ ...trimSizes, [name]: [w, h] });
        }}
        rows={sizeNames.map(name => (
          <tr key={name}>
            <td><RenameCell value={name} label={`قطع: ${name}`} canEdit={canEdit} onCommit={(next) => {
              if (trimSizes[next]) return reject(`قطع «${next}» قبلاً ثبت شده است.`);
              const rest = Object.fromEntries(sizeNames.filter(key => key !== name).map(key => [key, trimSizes[key]]));
              onTrimSizes({ ...rest, [next]: trimSizes[name] });
            }} /></td>
            {[0, 1].map(slot => (
              <td key={slot}><input aria-label={`${slot ? 'ارتفاع' : 'عرض'} ${name}`} inputMode="decimal" dir="ltr" defaultValue={trimSizes[name][slot]} disabled={!canEdit}
                onBlur={(event) => {
                  const value = Number(toLatinDigits(event.target.value));
                  if (value === trimSizes[name][slot]) return;
                  if (!(value > 0) || value > 200) { event.target.value = trimSizes[name][slot]; return reject(`ابعاد «${name}» باید عددی بین ۰ تا ۲۰۰ سانتی‌متر باشد.`); }
                  const other = trimSizes[name][1 - slot];
                  onTrimSizes({ ...trimSizes, [name]: slot ? [other, value] : [value, other] });
                }} /></td>
            ))}
            {canEdit && <td><button type="button" className="document-danger" onClick={() => onTrimSizes(Object.fromEntries(sizeNames.filter(key => key !== name).map(key => [key, trimSizes[key]])))}>حذف</button></td>}
          </tr>
        ))} />

      <TableShell title="رنگ چاپ" hint="کد عددی رنگ در شمارش زینک و دورِ چاپ به کار می‌رود. اگر کد جدیدی می‌افزایید، نرخ واحد چاپ آن هم باید در واحدهای تولید تعریف شده باشد."
        head={['کد', 'نام در رابط کاربری']} canEdit={canEdit}
        addFields={[{ label: 'نام رنگ', placeholder: `مثلاً ${faDigits(nextColour())} رنگه` }]}
        onAdd={([label]) => {
          const code = nextColour();
          if (code > 99) return reject('کد رنگ نباید از ۹۹ بالاتر برود.');
          onPrintColors([...printColors, [code, label]].sort((a, b) => a[0] - b[0]));
        }}
        rows={printColors.map((pair, index) => (
          <tr key={pair[0]}>
            <td><bdi>{faDigits(pair[0])}</bdi></td>
            <td><RenameCell value={pair[1]} label={`نام رنگ ${faDigits(pair[0])}`} canEdit={canEdit} onCommit={(next) => {
              if (printColors.some((other, i) => i !== index && other[1] === next)) return reject(`نام «${next}» برای کد دیگر استفاده شده است.`);
              onPrintColors(printColors.map((other, i) => (i === index ? [other[0], next] : other)));
            }} /></td>
            {canEdit && <td><button type="button" className="document-danger" onClick={() => onPrintColors(printColors.filter(other => other[0] !== pair[0]))}>حذف</button></td>}
          </tr>
        ))} />
      {ledgerTables()}
    </div>
  );
}
