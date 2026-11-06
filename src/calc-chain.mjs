/* موتور محاسبهٔ چاپخانه — زنجیرهٔ مرحله‌به‌مرحله که پیش از هر عدد، بانک دانش را می‌خواند.
   سه قاعدهٔ بنیادی:
   ۱) هیچ عددی hardcode نمی‌شود؛ فرم، ورق، ظرفیت زینک و حداقل صحافی از بانک (src/knowledge.mjs) می‌آید.
   ۲) دادهٔ ناکامل = سؤال، نه حدس. مثلاً نبودِ «بلوک رنگ» زینک را ۱۵۲ نمی‌کند، سؤال می‌پرسد.
   ۳) کاغذ با ورق شمرده می‌شود و زینک با قطعه؛ این دو هرگز در یک ستون جمع نمی‌شوند. */

import { pieceFit, parseSheetSize, findPaper } from './smart.js';
import { buildBank, findCut, findPress, findBinding, STATUS_APPROVED } from './knowledge.mjs';

const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const num = v => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };

/* نیم‌فرم رقعی/وزیری ۰٫۷۵ به یک تکهٔ ۸ و یک تکهٔ ۴ صفحه‌ای شکسته می‌شود؛ هر تکه روی خودش دورو چاپ می‌شود. */
function chunksOf(pages, formPages) {
  const out = [];
  let rest = pages;
  while (rest > 0) { const size = Math.min(rest, Math.max(4, formPages / 2)); out.push(size); rest -= size; }
  return out;
}
function ratioLabel(pages, formPages) {
  const ratio = pages / formPages;
  if (ratio === 0.5) return 'نصف';
  if (ratio === 0.25) return 'یک‌چهارم';
  if (ratio === 0.75) return 'سه‌چهارم';
  return `${Math.round(ratio * 100)}٪`;
}

const stage = (code, name) => ({ code, name, values: null, lines: [], steps: [], questions: [], blockers: [], rulesUsed: [] });
const ask = (st, field, why, help) => st.questions.push({ field, why, help: help || '' });
/* قاعده‌ای که این گام از بانک مصرف کرده — برای ردپای «چه قانونی عدد را ساخت» در برگه‌ها. */
const useRule = (st, bank, ...codes) => codes.forEach(code => {
  const rule = (bank.rules || []).find(r => r.code === code);
  if (rule) st.rulesUsed.push({ code: rule.code, version: rule.version, status: rule.status, name: rule.name });
});
const useEntry = (st, e) => st.rulesUsed.push({ code: e.code, version: e.version, status: e.status, name: e.name });

/* ── گام ۱ و ۲: قطع و فرم‌بندی ─────────────────────────────── */
export function calcForms(facts, bank) {
  const st = stage('forms', 'قطع و فرم‌بندی');
  const cut = findCut(bank, facts.cut);
  if (!cut) { st.blockers.push(`قطع «${facts.cut || '—'}» در بانک دانش تعریف نشده است.`); ask(st, 'cut', 'قطع کار را از فهرست بانک انتخاب کنید.'); return st; }
  useEntry(st, cut);
  useRule(st, bank, 'rule-form');
  if (cut.status !== STATUS_APPROVED) ask(st, 'cut.approval', `قطع «${cut.name}» هنوز در بانک تأیید نشده است.`, 'در میز دایرةالمعارف تأیید شود.');
  if (!(cut.formPages > 0)) { ask(st, 'formPages', `تعداد صفحهٔ فرم برای «${cut.name}» در بانک تعریف نشده است.`, 'مقدار را در دایرةالمعارف وارد کنید.'); return st; }
  if (!(cut.paperPages > 0)) { ask(st, 'paperPages', `تعداد صفحهٔ هر ورق کاغذ برای «${cut.name}» در بانک تعریف نشده است.`); return st; }

  const pages = num(facts.pages);
  if (!(pages > 0)) { st.blockers.push('تعداد صفحه وارد نشده است.'); ask(st, 'pages', 'تعداد صفحه لازم است.'); return st; }
  const formPages = cut.formPages;
  const exact = pages / formPages;
  const full = Math.floor(exact + 1e-9);
  const partial = pages - full * formPages;
  if (partial && !(cut.partials || []).includes(partial)) {
    st.blockers.push(`${pages} صفحه بر فرم ${formPages} صفحه‌ای «${cut.name}» نمی‌نشیند؛ باقی‌ماندهٔ ${partial} صفحه مجاز نیست.`);
    ask(st, 'pages', `باقی‌ماندهٔ ${partial} صفحه با فرم‌بندی «${cut.name}» سازگار نیست.`, 'تعداد صفحه را با مشتری نهایی کنید.');
    return st;
  }
  st.values = { cut: cut.name, trim: cut.trim, formPages, paperPages: cut.paperPages, formSheet: cut.formSheet, paperSheet: cut.paperSheet, partials: cut.partials || [], pages, exact: r2(exact), full, partial, charged: Math.ceil(exact - 1e-9) };
  st.steps.push(`${pages} صفحه ÷ ${formPages} = ${r2(exact)} فرم (${full} فرم کامل${partial ? ` + یک ${partial === formPages / 2 ? 'نیم‌فرم' : 'فرم'} ${partial} صفحه‌ای` : ''}).`);
  return st;
}

/* ── گام ۳: بلوک رنگ (پرسش، نه حدس) ───────────────────────── */
export function calcColourPlan(facts, bank) {
  const st = stage('colour', 'بلوک رنگ');
  const pages = num(facts.pages);
  if (facts.colourPlan === undefined) {
    ask(st, 'colourPlan', 'مشخص نیست همهٔ متن هم‌رنگ است یا صفحه‌هایی با رنگ متفاوت دارد.', 'اگر همه یک‌رنگ است «یکدست» را بزن؛ در غیر این صورت صفحه و رنگ هر بلوک را وارد کن.');
    return st;
  }
  if (facts.colourPlan === null) {
    const colors = num(facts.textColors) || 1;
    st.values = { declared: false, ranges: [{ pages, colors, label: '' }] };
    st.steps.push(`یکدست: ${pages} صفحه ${colors} رنگ.`);
    return st;
  }
  const ranges = (facts.colourPlan || []).filter(r => num(r.pages) > 0).map(r => ({ pages: num(r.pages), colors: num(r.colors) || 1, label: r.label || '' }));
  const sum = ranges.reduce((s, r) => s + r.pages, 0);
  if (!ranges.length) { ask(st, 'colourPlan', 'بلوک رنگی تعریف نشده است.'); return st; }
  if (sum !== pages) { st.blockers.push(`جمع صفحه‌های بلوک‌های رنگی (${sum}) با تعداد صفحه (${pages}) برابر نیست.`); ask(st, 'colourPlan', 'جمع بلوک‌های رنگی با تعداد کل صفحه نمی‌خواند.'); return st; }
  st.values = { declared: true, ranges };
  st.steps.push(ranges.map(r => `${r.pages} صفحه ${r.colors} رنگ${r.label ? ` (${r.label})` : ''}`).join(' + '));
  (bank.colours || []).filter(c => ranges.some(r => r.colors === c.plates)).forEach(c => useEntry(st, c));
  return st;
}

/* ── گام ۴: ماشین و روش چاپ ────────────────────────────────── */
export function calcPress(facts, bank, forms) {
  const st = stage('press', 'ماشین چاپ');
  const press = findPress(bank, facts.method === 'دیجیتال' ? 'دیجیتال' : facts.press);
  if (!press) { st.blockers.push('ماشین یا روش چاپ در بانک پیدا نشد.'); ask(st, 'press', 'ماشین چاپ را مشخص کنید.'); return st; }
  useEntry(st, press);
  useRule(st, bank, press.offset ? 'rule-pressfit' : 'rule-digital');
  const paperSheet = facts.paperSheet || (forms.values && forms.values.paperSheet) || null;
  let formSheet = press.offset ? (forms.values && forms.values.formSheet) : null;
  if (press.offset && paperSheet && formSheet && formSheet[0] * formSheet[1] > paperSheet[0] * paperSheet[1]) formSheet = paperSheet;
  st.values = { name: press.name, offset: !!press.offset, plateFactor: press.plateFactor, formSheet, paperSheet, platePages: press.offset && forms.values ? Math.max(1, forms.values.formPages * press.plateFactor) : 0 };
  st.steps.push(press.offset ? `ماشین ${press.name} — هر زینک ${st.values.platePages} صفحه (قاعدهٔ فرم کامل = ۲ زینک به‌ازای هر رنگ).` : 'چاپ دیجیتال: زینک لازم نیست.');
  return st;
}

/* ── گام ۵: زینک ───────────────────────────────────────────── */
export function calcZinc(forms, colour, press, bank) {
  const st = stage('zinc', 'زینک');
  if (!forms.values || !colour.values || !press.values) { ask(st, 'zinc', 'پیش از زینک، فرم‌بندی و بلوک رنگ باید کامل باشد.'); return st; }
  if (!press.values.offset) { st.values = { text: 0, cover: 0, total: 0, ranges: [], digital: true }; st.steps.push('دیجیتال: بدون زینک.'); useRule(st, bank, 'rule-digital'); return st; }
  useRule(st, bank, 'rule-plate');
  const platePages = press.values.platePages;
  const ranges = colour.values.ranges.map(r => {
    const perColor = Math.ceil(r.pages / platePages);
    return { ...r, platePages: perColor, plates: perColor * r.colors };
  });
  const text = ranges.reduce((s, r) => s + r.plates, 0);
  st.values = { text, cover: 0, total: text, ranges, platePages };
  st.lines = ranges.map(r => ({ label: `${r.pages} صفحه ${r.colors} رنگ${r.label ? ` — ${r.label}` : ''}`, perColor: r.platePages, plates: r.plates, zincSize: press.values.formSheet }));
  st.steps.push(`زینک متن: ${st.lines.map(l => `${l.perColor} رو × ${l.label.split(' — ')[0]} = ${l.plates}`).join(' + ')} → جمع ${text} قطعه.`);
  return st;
}

/* ── گام ۶ و ۷: تیراژ هر فرم و کاغذ ───────────────────────── */
export function calcPaperAndRun(facts, forms, colour, press, stock, bank) {
  const st = stage('paper', 'کاغذ متن');
  if (!forms.values || !colour.values || !press.values) { ask(st, 'paper', 'فرم‌بندی و رنگ کامل نشده است.'); return st; }
  useRule(st, bank, 'rule-paper');
  const qty = num(facts.qty);
  if (!(qty > 0)) { st.blockers.push('تیراژ وارد نشده است.'); return st; }
  const waste = facts.waste === undefined || facts.waste === null || facts.waste === '' ? num(facts.defaultWaste) : num(facts.waste);
  const runQty = qty + waste;
  const pages = forms.values.pages;
  const paperPages = forms.values.paperPages;
  const net = Math.ceil((pages / paperPages) * qty);
  const total = Math.ceil((pages / paperPages) * runQty);

  const plan = [];
  for (const r of colour.values.ranges) {
    const full = Math.floor(r.pages / forms.values.formPages + 1e-9);
    const partial = r.pages - full * forms.values.formPages;
    if (full > 0) plan.push({ label: `${full} فرم ${forms.values.formPages} صفحه‌ای${r.label ? ` (${r.label})` : ''}`, forms: full, pages: forms.values.formPages, sheets: full * runQty, workAndTurn: false, colors: r.colors });
    for (const chunk of chunksOf(partial, forms.values.formPages)) plan.push({ label: `۱ فرم ${chunk} صفحه‌ای روی خودش دورو${r.label ? ` (${r.label})` : ''}`, forms: 1, pages: chunk, sheets: Math.ceil((runQty * chunk) / forms.values.formPages), workAndTurn: true, colors: r.colors, ratio: ratioLabel(chunk, forms.values.formPages) });
  }
  const pressSheets = plan.reduce((s, row) => s + row.sheets, 0);
  if (plan.some(row => row.workAndTurn)) useRule(st, bank, 'rule-half', 'rule-wat');
  const sheetsPerBand = stock && stock.unitMode === 'band_sheet' ? num(stock.sheetsPerBand) : 0;
  st.values = { qty, waste, runQty, sheetsPerCopy: r2(pages / paperPages), net, wasteSheets: total - net, total, bands: sheetsPerBand ? r2(total / sheetsPerBand) : 0, bandsPer: sheetsPerBand, pressPlan: plan, pressSheets, sheet: stock && stock.sheetSize ? stock.sheetSize : forms.values.paperSheet, invId: stock ? stock.id : null, invName: stock ? stock.name : null };
  st.steps.push(`کاغذ متن: ${pages} ÷ ${paperPages} × (${qty} + ${waste} باطله) = ${total.toLocaleString('en-US')} ورق (${net.toLocaleString('en-US')} خالص + ${(total - net).toLocaleString('en-US')} باطله)${st.values.bands ? ` — معادل ${st.values.bands} بند (هر بند ${sheetsPerBand} ورق)` : ''}.`);
  st.steps.push(`دستور چاپ: ${plan.map(p => `${p.forms} فرم ${p.pages} صفحه‌ای ${p.workAndTurn ? 'روی خودش دورو' : 'پشت‌ورو'} ${p.sheets.toLocaleString('en-US')} ورق`).join(' + ')} → جمع ${pressSheets.toLocaleString('en-US')} ورق ماشین.`);
  if (!sheetsPerBand) ask(st, 'paper.stock', 'برگ «بند» محاسبه نشد چون واحد انبار این کالا بند-ورق نیست.');
  return st;
}

/* ── گام ۸: جلد ────────────────────────────────────────────── */
export function calcCover(facts, forms, press, stock, settings, colour) {
  const st = stage('cover', 'جلد');
  const cover = facts.cover;
  if (!cover || !cover.enabled) { st.values = { enabled: false }; return st; }
  if (!forms.values) { ask(st, 'cover', 'فرم‌بندی مشخص نیست.'); return st; }
  const c = settings.calc;
  const trim = facts.trim || forms.values.trim;
  const pages = forms.values.pages;
  const gsm = num(cover.gsm) || num(c.defaultCoverGsm);
  if (!num(cover.gsm)) ask(st, 'cover.gsm', `گرماژ جلد مشخص نبود؛ ${gsm} گرم از بانک تنظیمات استفاده شد.`);
  const textGsm = num(facts.paper && facts.paper.gsm) || num(c.defaultCoverGsm);
  const caliper = stock && num(stock.caliperMm) > 0 ? num(stock.caliperMm) : textGsm * num(c.leafThicknessFactor);
  const spine = r2((pages / 2) * caliper / 10);
  const cw = r1(trim[0] * 2 + spine + num(c.coverExtraCm));
  const ch = r1(trim[1] + num(c.coverExtraCm));
  const stockSheet = stock && parseSheetSize(stock.size);
  const coverSheet = facts.coverSheet || stockSheet || [70, 100];
  if (!stockSheet) ask(st, 'cover.stock', `اندازهٔ ورق مقوای جلد «${cover.kind || '—'} ${gsm} گرم» در انبار پیدا نشد؛ ${coverSheet[0]}×${coverSheet[1]} فرض شد.`, 'کالا را در انبار با سایز ورق ثبت کنید.');
  const fit = pieceFit(coverSheet, cw, ch, num(c.coverMarginCm));
  if (!(fit > 0)) { st.blockers.push(`جلد باز (${cw}×${ch}) روی ورق ${coverSheet[0]}×${coverSheet[1]} جا نمی‌شود.`); return st; }
  const qty = num(facts.qty), runQty = num(facts.runQty) || qty;
  const net = Math.ceil(qty / fit), total = Math.ceil(runQty / fit);
  const colors = num(cover.colors) || 4, sides = num(cover.sides) || 1;
  const plates = press.values && press.values.offset ? colors * sides : 0;
  st.values = { enabled: true, spine, cw, ch, coverSheet, fit, net, total, wasteSheets: total - net, colors, sides, plates, area100: r2(cw * ch / 100), invId: stock ? stock.id : null, invName: stock ? stock.name : null };
  st.lines = [{ label: `ورق جلد ${coverSheet[0]}×${coverSheet[1]}`, qty: total, unit: 'ورق' }, { label: `زینک جلد ${colors} رنگ ${sides === 2 ? 'دورو' : 'یک‌رو'}`, qty: plates, unit: 'قطعه' }];
  st.steps.push(`عطف ≈ ${spine} سانتی‌متر، جلد باز ${cw}×${ch} → ${fit} جلد در هر ورق ${coverSheet[0]}×${coverSheet[1]}؛ (${qty} + ${runQty - qty} باطله) ÷ ${fit} = ${total.toLocaleString('en-US')} ورق، زینک جلد ${plates} قطعه.`);
  return st;
}

/* ── گام ۹: صحافی ─────────────────────────────────────────── */
export function calcBinding(facts, bank, forms, colour, cover) {
  const st = stage('binding', 'صحافی');
  if (!forms.values || !colour.values) { ask(st, 'binding', 'فرم‌بندی و بلوک رنگ کامل نشده است.'); return st; }
  const binding = findBinding(bank, facts.binding);
  if (!binding) { ask(st, 'binding', `نوع صحافی «${facts.binding || '—'}» در بانک دانش نیست.`, 'در دایرةالمعارف تعریف و تأیید شود.'); return st; }
  useEntry(st, binding);
  useRule(st, bank, 'rule-binding');
  /* هر فرم متن — حتی نیم‌فرم — یک فرم صحافی است و جلد هم یک فرم. */
  const textForms = colour.values.ranges.reduce((s, r) => s + Math.ceil(r.pages / forms.values.formPages - 1e-9), 0);
  const coverForms = cover.values && cover.values.enabled ? 1 : 0;
  const raw = textForms + coverForms;
  const min = num(binding.minForms);
  const charged = Math.max(raw, min);
  st.values = { name: binding.name, textForms, coverForms, raw, minForms: min, charged, applied: charged > raw };
  st.steps.push(`فرم صحافی: ${textForms} فرم متن + ${coverForms} فرم جلد = ${raw} فرم${min ? ` (حداقل «${binding.name}» ${min} فرم${charged > raw ? ` — ${charged} فرم محاسبه می‌شود` : ' — رعایت شده است'})` : ''}.`);
  return st;
}

/* ── گام ۱۰: عملیات تکمیلی ─────────────────────────────────── */
export function calcFinishing(facts, bank, paper, cover) {
  const st = stage('finishing', 'عملیات تکمیلی');
  const wanted = (facts.finishing || []).map(f => (typeof f === 'string' ? f : f && f.name) || '').filter(Boolean);
  if (!wanted.length) { st.values = { lines: [] }; return st; }
  const lines = [];
  for (const name of wanted) {
    const rule = (bank.finishing || []).find(f => f.name === name || (f.matches || []).some(m => name.includes(m)));
    if (!rule) { ask(st, 'finishing', `عملیات «${name}» در بانک دانش تعریف نشده است.`); continue; }
    useEntry(st, rule);
    if (rule.code.startsWith('cello')) {
      const useCover = cover.values && cover.values.enabled;
      const sheet = useCover ? cover.values.coverSheet : (paper.values && paper.values.sheet) || [70, 100];
      const sheets = useCover ? cover.values.total : (paper.values && paper.values.total) || 0;
      const area = r2((sheet[0] * sheet[1] / 10000) * sheets);
      lines.push({ label: name, qty: area, unit: 'متر مربع', basis: `${sheets.toLocaleString('en-US')} ورق ${sheet[0]}×${sheet[1]}` });
      st.steps.push(`${name}: ${sheets.toLocaleString('en-US')} ورق × ${r2(sheet[0] * sheet[1] / 10000)} مترمربع = ${area.toLocaleString('en-US')} مترمربع.`);
    } else {
      lines.push({ label: name, qty: '', unit: rule.unit, basis: 'مقدار از تعریف عملیات خوانده می‌شود' });
      ask(st, `finishing.${rule.code}`, `مبنای محاسبهٔ «${name}» هنوز در بانک عدد ندارد.`, 'تعریف مقدار (بر اساس تیراژ/فرم/سطح) را در بانک وارد کنید.');
    }
  }
  st.values = { lines };
  st.lines = lines;
  return st;
}

/* ── زنجیرهٔ کامل ─────────────────────────────────────────── */
export function runChain(facts, ctx = {}) {
  const bank = ctx.bank || buildBank(ctx.savedLexicon || {});
  const settings = ctx.settings || { calc: {} };
  const stock = ctx.inventory
    ? { body: findPaper(ctx.inventory, { kind: facts.paper && facts.paper.kind, gsm: facts.paper && facts.paper.gsm, cats: ['کاغذ', 'مقوا'] }, ctx.customerId) }
    : {};
  if (stock.body) stock.body.sheetSize = parseSheetSize(stock.body.size);
  const coverStock = facts.cover && facts.cover.enabled && ctx.inventory
    ? findPaper(ctx.inventory, { kind: facts.cover.kind, gsm: facts.cover.gsm, cats: ['مقوا', 'کاغذ'] }, ctx.customerId) : null;

  const stages = {
    forms: calcForms(facts, bank),
    colour: calcColourPlan(facts, bank),
  };
  stages.press = calcPress(facts, bank, stages.forms);
  stages.zinc = calcZinc(stages.forms, stages.colour, stages.press, bank);
  stages.paper = calcPaperAndRun({ ...facts, defaultWaste: settings.calc.runWasteCopies }, stages.forms, stages.colour, stages.press, stock.body, bank);
  stages.cover = calcCover({ ...facts, runQty: (stages.paper.values || {}).runQty }, stages.forms, stages.press, coverStock, settings, stages.colour);
  if (stages.zinc.values && stages.cover.values && stages.cover.values.plates) {
    stages.zinc.values.cover = stages.cover.values.plates;
    stages.zinc.values.total = stages.zinc.values.text + stages.cover.values.plates;
    stages.zinc.lines.push({ label: `جلد ${stages.cover.values.colors} رنگ ${stages.cover.values.sides === 2 ? 'دورو' : 'یک‌رو'}`, perColor: stages.cover.values.colors, plates: stages.cover.values.plates, zincSize: stages.cover.values.coverSheet });
    stages.zinc.steps.push(`زینک جلد ${stages.cover.values.plates} قطعه → جمع زینک ${stages.zinc.values.total} قطعه.`);
  }
  stages.binding = calcBinding(facts, bank, stages.forms, stages.colour, stages.cover);
  stages.finishing = calcFinishing(facts, bank, stages.paper, stages.cover);

  const list = Object.values(stages);
  const questions = list.flatMap(s => s.questions.map(q => ({ ...q, stage: s.code, stageName: s.name })));
  const blockers = list.flatMap(s => s.blockers.map(b => ({ stage: s.code, text: b })));
  const rules = [...new Map(list.flatMap(s => s.rulesUsed.map(r => [r.code, r]))).values()];
  return {
    ok: blockers.length === 0 && list.every(s => (s.values !== null)),
    complete: questions.length === 0 && blockers.length === 0,
    bank: { schemaVersion: bank.schemaVersion, builtAt: bank.builtAt },
    rulesUsed: rules,
    stages,
    questions,
    blockers,
    steps: list.flatMap(s => s.steps),
    numbers: {
      pages: num(facts.pages), qty: num(facts.qty),
      waste: (stages.paper.values || {}).waste || 0,
      runQty: (stages.paper.values || {}).runQty || num(facts.qty),
      formPages: (stages.forms.values || {}).formPages || 0,
      paperPages: (stages.forms.values || {}).paperPages || 0,
      paperSheet: (stages.paper.values || {}).sheet || null,
      formSheet: (stages.press.values || {}).formSheet || null,
      textSheets: (stages.paper.values || {}).total || 0,
      textSheetsNet: (stages.paper.values || {}).net || 0,
      textBands: (stages.paper.values || {}).bands || 0,
      pressSheets: (stages.paper.values || {}).pressSheets || 0,
      plates: (stages.zinc.values || {}).total || 0,
      textPlates: (stages.zinc.values || {}).text || 0,
      coverPlates: (stages.zinc.values || {}).cover || 0,
      coverSheets: (stages.cover.values || {}).total || 0,
      bindingForms: (stages.binding.values || {}).charged || 0,
      finishingLines: (stages.finishing.values || {}).lines || [],
    },
  };
}
