/* تنظیمات مشترک خروجی PDF. تنها مرجع اندازهٔ کاغذ و حاشیه، تا پنجرهٔ چاپ و آزمون‌ها یک چیز را بسنجند.
   حاشیهٔ صفر عمدی است: هر صفحهٔ چاپ‌شده خودش ۱۰ میلی‌متر حاشیه داخلی دارد و حاشیهٔ افزودهٔ مرورگر
   همان «فضای اضافی»ای است که محتوا را از A4 بیرون می‌اندازد. */
const MM_PER_INCH = 25.4;
const PAPERS = { A4: [210, 297], A5: [148, 210] };

function paperMm(paper, orientation = 'portrait') {
  if (!['portrait', 'landscape'].includes(orientation)) throw new RangeError('Unsupported paper orientation');
  const dimensions = PAPERS[paper === 'A5' ? 'A5' : 'A4'];
  return orientation === 'landscape' ? [...dimensions].reverse() : [...dimensions];
}

/* printBackground:false یعنی حتی اگر جایی رنگ پس‌زمینه بماند، در PDF نمی‌آید.
   preferCSSPageSize:true تا اندازه‌ای که صفحه‌بندی واقعی اعلام کرده (@page) ملاک باشد. */
function pdfPrintOptions(paper = 'A4', orientation = 'portrait') {
  const [widthMm, heightMm] = paperMm(paper, orientation);
  return {
    printBackground: false,
    preferCSSPageSize: true,
    headerFooter: false,
    landscape: orientation === 'landscape',
    pageSize: paper === 'A5' ? 'A5' : 'A4',
    displayHeaderFooter: false,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    paperWidth: widthMm / MM_PER_INCH,
    paperHeight: heightMm / MM_PER_INCH,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  };
}

function safePdfName(name) {
  /* پسوند تکراری مجاز نیست: «a.pdf.pdf» باید «a.pdf» شود، پس همهٔ پسوندهای انتهایی پاک می‌شوند. */
  const base = String(name ?? '')
    .replace(/[<>:"|?*\x00-\x1f\\/:]/g, '_')
    .replace(/(\.pdf\s*)+$/i, '')
    .trim()
    .slice(0, 150);
  return `${base || 'برگه'}.pdf`;
}

module.exports = { PAPERS, paperMm, pdfPrintOptions, safePdfName };
