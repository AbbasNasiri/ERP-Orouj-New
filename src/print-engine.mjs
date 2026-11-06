export const CUTS = {
  'وزیری': { formPages: 16, paperPages: 32, partials: [8, 4], trim: [17, 24] },
  'رقعی': { formPages: 16, paperPages: 32, partials: [8, 4], trim: [14.5, 21] },
  'رحلی': { formPages: 8, paperPages: 16, partials: [4], trim: [21, 29] },
};

export const PRESSES = {
  '4.5 ورقی': { plateFactor: 1, offset: true, sheet: [70, 100] },
  '2 ورقی': { plateFactor: 0.5, offset: true, sheet: [50, 70] },
  'GTO': { plateFactor: 0.25, offset: true, sheet: [35, 50] },
  'دیجیتال': { plateFactor: 0, offset: false },
};

const positiveInt = value => Number.isInteger(value) && value > 0;
const sheetsFor = (pages, paperPages, copies) => Math.ceil((pages / paperPages) * copies);

export const PAPER_CALIPER_MM_PER_GSM = 0.0012;
const fitsSheet = (inner, outer) => (inner[0] <= outer[0] && inner[1] <= outer[1]) || (inner[0] <= outer[1] && inner[1] <= outer[0]);

export function planBook(input) {
  const errors = [];
  const cut = (input.catalog?.cuts ?? CUTS)[input.cut];
  const press = (input.catalog?.presses ?? PRESSES)[input.press];
  const qty = input.qty, waste = input.waste ?? 0, pages = input.pages;
  const colorRanges = input.colorRanges ?? [{ pages, colors: input.colors ?? 1 }];
  const cover = input.cover ?? null;
  if (!cut) errors.push('قطع تعریف نشده است.');
  if (!press) errors.push('ماشین یا روش چاپ تعریف نشده است.');
  if (!positiveInt(pages)) errors.push('تعداد صفحه معتبر نیست.');
  if (!positiveInt(qty)) errors.push('تیراژ معتبر نیست.');
  if (!Number.isInteger(waste) || waste < 0) errors.push('باطله معتبر نیست.');
  if (errors.length) return { ok: false, errors };

  const rangePages = colorRanges.reduce((sum, range) => sum + range.pages, 0);
  if (colorRanges.some(range => !positiveInt(range.pages) || !positiveInt(range.colors))) errors.push('بازهٔ رنگی معتبر نیست.');
  else if (rangePages !== pages) errors.push(`جمع صفحه‌های بازه‌های رنگی (${rangePages}) با تعداد صفحه (${pages}) برابر نیست.`);
  if (cover && (!positiveInt(cover.perSheet) || !positiveInt(cover.colors) || ![1, 2].includes(cover.sides))) errors.push('مشخصات جلد معتبر نیست؛ تعداد جلد در هر ورق، رنگ و رو لازم است.');
  if (errors.length) return { ok: false, errors };

  const fullForms = Math.floor(pages / cut.formPages);
  const remainder = pages % cut.formPages;
  if (remainder && !cut.partials.includes(remainder)) {
    errors.push(`${pages} صفحه برای قطع ${input.cut} قابل فرم‌بندی نیست؛ باقی‌ماندهٔ ${remainder} صفحه مجاز نیست.`);
    return { ok: false, errors };
  }

  const paperSize = input.paperSize ?? [70, 100];
  if (press.sheet && !fitsSheet(press.sheet, paperSize)) {
    errors.push(`ورق ${paperSize[0]}×${paperSize[1]} کوچک‌تر از برگ ماشین ${input.press} (${press.sheet[0]}×${press.sheet[1]}) است.`);
    return { ok: false, errors };
  }
  const runQty = qty + waste;
  const ratio = remainder ? remainder / cut.formPages : 0;
  const forms = [];
  if (fullForms) forms.push({ kind: 'کامل', pages: cut.formPages, count: fullForms, ratio: 1, printRun: runQty, instruction: `${fullForms} فرم ${cut.formPages} صفحه‌ای کامل، پشت‌ورو — ${runQty} برگ برای هر فرم` });
  if (remainder) { const kind = ratio === 0.5 ? 'نیم‌فرم' : 'یک‌چهارم فرم'; const run = Math.ceil(runQty * ratio); forms.push({ kind, pages: remainder, count: 1, ratio, printRun: run, instruction: `${kind} ${remainder} صفحه‌ای، روی خودش دورو — ${ratio === 0.5 ? 'نصف' : 'یک‌چهارم'} تیراژ: ${run} برگ` }); }

  const paperSheets = sheetsFor(pages, cut.paperPages, runQty);
  const plateCapacity = press.offset ? cut.formPages * press.plateFactor : 0;
  const warnings = [];
  const smallestUnit = Math.min(cut.formPages, ...cut.partials);
  for (const range of colorRanges) {
    if (range.pages % smallestUnit) warnings.push(`بازهٔ ${range.pages} صفحه‌ای ${range.colors} رنگ روی نیم‌فرم ${smallestUnit} صفحه‌ای نمی‌نشیند؛ رنگ‌پذیری را نهایی کنید.`);
  }
  const textPlates = press.offset ? colorRanges.reduce((sum, range) => sum + Math.ceil(range.pages / plateCapacity) * range.colors, 0) : 0;
  const coverPlates = press.offset && cover ? cover.colors * cover.sides : 0;
  const coverSheets = cover ? Math.ceil(runQty / cover.perSheet) : 0;
  const coverNet = cover ? Math.ceil(qty / cover.perSheet) : 0;
  return {
    ok: true,
    errors,
    warnings,
    paper: { sheets: paperSheets, netSheets: sheetsFor(pages, cut.paperPages, qty), wasteSheets: paperSheets - sheetsFor(pages, cut.paperPages, qty), bands: paperSheets / 500, pressSheets: press.offset ? paperSheets / press.plateFactor : paperSheets },
    coverPaper: cover ? { sheets: coverSheets, netSheets: coverNet, wasteSheets: coverSheets - coverNet } : null,
    plates: { needed: press.offset, capacityPages: plateCapacity, text: textPlates, cover: coverPlates, total: textPlates + coverPlates },
    forms,
    coverGeometry: coverGeometry(input, cut),
    binding: { textForms: Math.ceil(pages / cut.formPages), coverForms: 1, total: Math.ceil(pages / cut.formPages) + 1 },
  };
}

function coverGeometry(input, cut) {
  const textGsm = Number(input.textGsm);
  if (!(textGsm > 0)) return null;
  const caliperMm = Number(input.caliperMm) || textGsm * (Number(input.leafFactor) > 0 ? Number(input.leafFactor) : PAPER_CALIPER_MM_PER_GSM);
  const spineExtraMm = input.spineExtraMm == null ? 1 : Number(input.spineExtraMm);
  const spineMm = Math.round(((input.pages / 2) * caliperMm + spineExtraMm) * 10) / 10;
  const bleedCm = input.bleedCm == null ? 0.3 : Number(input.bleedCm);
  const [w, h] = cut.trim;
  return { spineMm, openWidthCm: Math.round((2 * w + spineMm / 10 + 2 * bleedCm) * 100) / 100, openHeightCm: Math.round((h + 2 * bleedCm) * 100) / 100, bleedCm };
}
