const PAPERS = { A4: [210, 297], A5: [148, 210] };
const OMIT = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'NOSCRIPT']);
const ATOMIC = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT', 'HR']);
const number = value => value.toLocaleString('fa-IR', { useGrouping: false });
const important = (element, values) => { for (const [property, value] of Object.entries(values)) element.style.setProperty(property, value, 'important'); };

async function resourcesReady(source) {
  const doc = source.ownerDocument;
  if (doc.fonts?.ready) await doc.fonts.ready;
  const images = [...source.querySelectorAll('img'), ...(source.tagName === 'IMG' ? [source] : [])];
  await Promise.all(images.map(image => new Promise((resolve, reject) => {
    if (image.complete) { Promise.resolve(image.decode?.()).catch(() => {}).then(resolve); return; }
    let timer;
    const finish = () => { clearTimeout(timer); image.removeEventListener('load', finish); image.removeEventListener('error', finish); resolve(); };
    image.addEventListener('load', finish, { once: true }); image.addEventListener('error', finish, { once: true });
    timer = setTimeout(() => { image.removeEventListener('load', finish); image.removeEventListener('error', finish); reject(new Error('بارگذاری تصویر چاپ کامل نشد؛ دوباره تلاش کنید.')); }, 10000);
  })));
}

function omit(node) { return node.nodeType === 8 || (node.nodeType === 1 && (OMIT.has(node.tagName) || node.matches('.no-print,[data-print-omit],[hidden]'))); }

/** Clone into a print-only tree. Never change the React-owned source tree. */
function copy(node, deep = true) {
  if (omit(node)) return null;
  const clone = node.cloneNode(false);
  if (node.nodeType !== 1) return clone;
  clone.removeAttribute('id'); clone.removeAttribute('autofocus');
  for (const attribute of [...clone.attributes]) if (/^on/i.test(attribute.name)) clone.removeAttribute(attribute.name);
  if (clone.matches('.print-source,.a4-sheet,.a5-sheet')) {
    clone.classList.remove('print-source', 'a4-sheet', 'a5-sheet');
    clone.removeAttribute('aria-hidden');
    important(clone, { width: '100%', 'min-width': '0', 'max-width': '100%', height: 'auto', 'min-height': '0', 'max-height': 'none', padding: '0', margin: '0', display: 'block', flex: 'none', 'box-shadow': 'none', overflow: 'visible', position: 'static', visibility: 'visible', left: 'auto', top: 'auto', 'pointer-events': 'auto' });
  }
  clone.style.setProperty('overflow-wrap', 'anywhere');
  if (clone.tagName === 'PRE') clone.style.whiteSpace = 'pre-wrap';
  if (clone.tagName === 'TABLE') important(clone, { width: '100%', 'max-width': '100%', 'table-layout': 'fixed' });
  if (['IMG', 'SVG', 'CANVAS', 'VIDEO'].includes(clone.tagName.toUpperCase())) clone.style.maxWidth = '100%';
  if (node.tagName === 'INPUT') { clone.value = node.value; clone.checked = node.checked; }
  if (node.tagName === 'TEXTAREA') clone.textContent = node.value;
  else if (deep) for (const child of node.childNodes) { const next = copy(child); if (next) clone.append(next); }
  if (node.tagName === 'CANVAS') {
    clone.width = node.width; clone.height = node.height;
    clone.getContext('2d')?.drawImage(node, 0, 0);
  }
  return clone;
}

function textBoundary(node, offset) {
  const walker = node.ownerDocument.createTreeWalker(node, 4);
  let current, remaining = offset;
  while ((current = walker.nextNode())) {
    if (remaining <= current.data.length) return [current, remaining];
    remaining -= current.data.length;
  }
  return [node, node.childNodes.length];
}

function textFragment(node, start, end) {
  const doc = node.ownerDocument;
  if (node.nodeType === 3) return doc.createTextNode(node.data.slice(start, end));
  const range = doc.createRange(); range.selectNodeContents(node);
  if (start > 0) range.setStart(...textBoundary(node, start));
  if (end < node.textContent.length) range.setEnd(...textBoundary(node, end));
  const fragment = copy(node, false);
  const contents = range.cloneContents();
  for (const child of [...contents.childNodes]) { const cloned = copy(child); if (cloned) fragment.append(cloned); }
  return fragment;
}

/**
 * Real DOM pagination for Chromium/Electron. The host must be attached, visible
 * for layout, and independent of source. Returns the number of physical pages.
 * Long table rows degrade to labelled full-width cell fragments; their thead is
 * still repeated. Unbreakable graphics are uniformly reduced, never cropped.
 * If an impossible layout cannot fit, reject rather than silently discard data.
 */
export async function paginatePrint(source, host, { paper = 'A4', orientation = 'portrait', signal } = {}) {
  if (!PAPERS[paper]) throw new Error('اندازهٔ کاغذ باید A4 یا A5 باشد.');
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('جهت کاغذ باید portrait یا landscape باشد.');
  if (!source?.ownerDocument || !host?.ownerDocument || source.ownerDocument !== host.ownerDocument || source === host || source.contains(host) || host.contains(source)) throw new Error('منبع چاپ و میزبان باید دو عنصر مستقل در یک سند باشند.');
  if (!host.isConnected) throw new Error('میزبان چاپ باید برای اندازه‌گیری به سند متصل باشد.');
  await resourcesReady(source);
  if (signal?.aborted) return 0;
  const doc = host.ownerDocument, view = doc.defaultView;
  const [width, height] = orientation === 'landscape' ? [...PAPERS[paper]].reverse() : PAPERS[paper];
  const inherited = view.getComputedStyle(source);
  const pages = [];
  let current, scratch;
  host.replaceChildren();
  host.dataset.printPaper = paper;
  host.dataset.orientation = orientation;
  function makePage(measuring = false) {
    const page = doc.createElement('section'); page.className = `print-page print-page-${paper.toLowerCase()}`;
    important(page, { width: `${width}mm`, height: `${height}mm`, padding: '10mm', 'box-sizing': 'border-box', display: 'block', overflow: 'visible', 'break-after': 'page', 'page-break-after': 'always' });
    page.style.fontFamily = inherited.fontFamily; page.style.fontSize = inherited.fontSize; page.style.lineHeight = inherited.lineHeight;
    page.style.direction = inherited.direction; page.style.color = inherited.color;
    const header = doc.createElement('div'); header.className = 'print-page-header';
    important(header, { height: '6mm', 'box-sizing': 'border-box', display: 'block', overflow: 'visible' });
    const label = doc.createElement('span'); label.className = 'print-page-number'; header.append(label);
    const content = doc.createElement('div'); content.className = 'print-page-content';
    important(content, { height: 'calc(100% - 6mm)', width: '100%', 'box-sizing': 'border-box', display: 'flow-root', overflow: 'visible', 'min-height': '0', 'max-height': 'none' });
    page.append(header, content); host.append(page);
    if (measuring) { important(page, { position: 'absolute', left: '-100000px', top: '0', visibility: 'hidden', 'pointer-events': 'none' }); page.dataset.printMeasurement = 'true'; }
    return { page, header, label, content, contexts: new Map(), hasContent: false };
  }
  function nextPage() {
    if (pages.length >= 10000) throw new Error('تعداد صفحات بیش از حد مجاز است؛ محتوا را بررسی کنید.');
    current = makePage(); pages.push(current);
    if (!current.content.clientHeight || !current.content.clientWidth) throw new Error('میزبان چاپ پنهان است یا اندازهٔ قابل محاسبه ندارد.');
    return current;
  }
  function fits(page) {
    const rect = page.content.getBoundingClientRect();
    if (page.content.scrollHeight > page.content.clientHeight + 1 || page.content.scrollWidth > page.content.clientWidth + 1) return false;
    for (const child of page.content.children) if (child.getBoundingClientRect().bottom > rect.bottom + 0.8) return false;
    return true;
  }
  function parentFor(page, contexts) {
    let parent = page.content;
    for (const context of contexts) {
      const existing = page.contexts.get(context);
      if (existing?.outer.isConnected) { parent = existing.inner; continue; }
      let outer, inner;
      if (context.build) ({ outer, inner } = context.build());
      else {
        outer = copy(context, false); inner = outer;
        important(outer, { height: 'auto', 'min-height': '0', 'max-height': 'none', display: 'block', flex: 'none', position: 'static', overflow: 'visible', 'break-inside': 'auto', 'page-break-inside': 'auto' });
      }
      parent.append(outer); page.contexts.set(context, { outer, inner }); parent = inner;
    }
    return parent;
  }
  function fitsEmpty(node, contexts) {
    scratch.content.replaceChildren(); scratch.contexts.clear();
    const parent = parentFor(scratch, contexts), clone = copy(node);
    if (!clone) return true;
    parent.append(clone); const result = fits(scratch); scratch.content.replaceChildren(); scratch.contexts.clear(); return result;
  }
  function attempt(node, contexts) {
    const parent = parentFor(current, contexts), clone = copy(node);
    if (!clone) return true;
    parent.append(clone);
    if (fits(current)) { if (clone.nodeType !== 3 || clone.data.trim()) current.hasContent = true; return true; }
    clone.remove(); return false;
  }
  function atomic(node, contexts) {
    if (current.hasContent) nextPage();
    const parent = parentFor(current, contexts), clone = copy(node);
    if (!clone) return;
    parent.append(clone);
    if (clone.nodeType !== 1) throw new Error('متن چاپ در فضای صفحه جا نمی‌شود.');
    const bounds = current.content.getBoundingClientRect(), rect = clone.getBoundingClientRect();
    const availableHeight = bounds.bottom - rect.top - 1;
    const neededWidth = Math.max(rect.width, clone.scrollWidth), neededHeight = Math.max(rect.height, clone.scrollHeight);
    let scale = Math.min(1, (bounds.width - 1) / Math.max(neededWidth, 1), availableHeight / Math.max(neededHeight, 1));
    if (!(scale > 0)) throw new Error('سربرگ یا فاصله‌گذاری بلوک، تمام فضای چاپ را اشغال کرده است.');
    // Chromium zoom participates in layout, unlike a transform that can leave
    // the original overflow box behind. It is applied only to indivisible data.
    for (let tries = 0; tries < 12; tries++) {
      clone.style.setProperty('zoom', String(scale), 'important');
      if (fits(current)) { current.hasContent = true; return; }
      scale *= 0.9;
    }
    throw new Error('یک بلوک چاپی قابل تقسیم یا جاگذاری نیست؛ اندازهٔ آن را اصلاح کنید.');
  }
  function splitText(node, contexts) {
    const text = node.nodeType === 3 ? node.data : node.textContent;
    let start = 0;
    while (start < text.length) {
      const parent = parentFor(current, contexts);
      let low = start + 1, high = text.length, best = start;
      while (low <= high) {
        const end = Math.floor((low + high) / 2), fragment = textFragment(node, start, end);
        parent.append(fragment); const fit = fits(current); fragment.remove();
        if (fit) { best = end; low = end + 1; } else high = end - 1;
      }
      if (best === start) {
        if (current.hasContent) { nextPage(); continue; }
        const remaining = textFragment(node, start, text.length);
        if (remaining.nodeType === 3) { const span = doc.createElement('span'); span.append(remaining); atomic(span, contexts); }
        else atomic(remaining, contexts);
        return;
      }
      if (best < text.length) {
        const prefix = text.slice(start, best), space = Math.max(prefix.lastIndexOf(' '), prefix.lastIndexOf('\n'), prefix.lastIndexOf('\t'));
        if (space >= 0 && space > prefix.length / 2) best = start + space + 1;
        // Never split a UTF-16 surrogate pair between pages.
        if (best > start && /[\uD800-\uDBFF]/.test(text[best - 1]) && /[\uDC00-\uDFFF]/.test(text[best])) best--;
        if (best === start) { if (current.hasContent) { nextPage(); continue; } best = Math.min(text.length, start + 2); }
      }
      const fragment = textFragment(node, start, best); parent.append(fragment); current.hasContent = true;
      if (!fits(current)) { fragment.remove(); atomic(textFragment(node, start, best), contexts); }
      start = best;
      if (start < text.length) nextPage();
    }
  }
  function table(node, contexts) {
    const rows = [...node.children].flatMap(child => child.tagName === 'TR' ? [child] : ['TBODY', 'TFOOT'].includes(child.tagName) ? [...child.children].filter(row => row.tagName === 'TR') : []);
    if (!rows.length) { atomic(node, contexts); return; }
    const header = node.tHead;
    const labels = header ? [...header.rows[header.rows.length - 1]?.cells || []].map(cell => cell.textContent.trim()) : [];
    const columns = Math.max(1, ...rows.map(row => [...row.cells].reduce((count, cell) => count + (cell.colSpan || 1), 0)));
    const tableContext = { build() {
      const outer = copy(node, false);
      for (const child of node.children) if (['CAPTION', 'COLGROUP', 'THEAD'].includes(child.tagName)) { const cloned = copy(child); if (cloned) outer.append(cloned); }
      const inner = doc.createElement('tbody'); outer.append(inner); return { outer, inner };
    } };
    const nested = [...contexts, tableContext];
    rows.forEach((row, rowIndex) => {
      const rowSpans = [...row.cells].some(cell => cell.rowSpan > 1);
      if (!rowSpans && attempt(row, nested)) return;
      if (!rowSpans && fitsEmpty(row, nested)) { nextPage(); if (attempt(row, nested)) return; }
      // A single oversized row cannot be moved forever. Print labelled cell
      // contents as continuation rows, retaining every child and the table head.
      [...row.cells].forEach((cell, cellIndex) => {
        const cellContext = { build() {
          const outer = doc.createElement('tr'), td = doc.createElement('td'), inner = doc.createElement('div');
          td.colSpan = columns; td.className = 'print-cell-continuation';
          const caption = doc.createElement('div'); caption.className = 'print-cell-label';
          caption.textContent = `ردیف ${number(rowIndex + 1)} — ${labels[cellIndex] || `ستون ${number(cellIndex + 1)}`}`;
          td.append(caption, inner); outer.append(td); return { outer, inner };
        } };
        if (!cell.childNodes.length) place(doc.createTextNode('—'), [...nested, cellContext]);
        else for (const child of cell.childNodes) place(child, [...nested, cellContext]);
      });
    });
  }
  function place(node, contexts = []) {
    if (omit(node)) return;
    const element = node.nodeType === 1 ? node : null;
    // A deliberate page break: start the following block on a fresh page.
    if (element && element.matches('[data-print-break]')) {
      if (current.hasContent) nextPage();
      return;
    }
    // An ancestor holding a deliberate break is never copied whole; descend so
    // the break itself is honoured at its own level.
    const deliberate = element ? element.querySelector('[data-print-break]') : null;
    if (!deliberate && attempt(node, contexts)) return;
    // Tables fill the remaining page row by row. Moving a whole table (or its
    // containing card) first can waste almost an entire preceding page.
    if (!deliberate && element && element.tagName === 'TABLE') { table(node, contexts); return; }
    const containsTable = !deliberate && element && element.querySelector('table');
    if (!deliberate && !containsTable && fitsEmpty(node, contexts)) { nextPage(); if (attempt(node, contexts)) return; }
    if (node.nodeType === 3) { splitText(node, contexts); return; }
    if (node.nodeType !== 1) return;
    if (ATOMIC.has(node.tagName.toUpperCase()) || !node.childNodes.length) { atomic(node, contexts); return; }
    const inline = [...node.children].every(child => !['TABLE', 'DIV', 'P', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HEADER', 'FOOTER', 'MAIN', 'PRE'].includes(child.tagName) && !ATOMIC.has(child.tagName.toUpperCase()));
    if (inline && node.textContent.length) { splitText(node, contexts); return; }
    for (const child of node.childNodes) place(child, [...contexts, node]);
  }
  try {
    nextPage(); scratch = makePage(true);
    place(source);
    // Remove empty wrapper-only pages left by an attempted whole-block move.
    const filled = pages.filter(page => page.hasContent);
    const finalPages = filled.length ? filled : [pages[0]];
    for (const page of pages) if (!finalPages.includes(page)) page.page.remove();
    finalPages.forEach((page, index) => {
      page.label.textContent = `صفحه ${number(index + 1)} از ${number(finalPages.length)}`;
      page.page.dataset.pageNumber = String(index + 1);
      if (index === finalPages.length - 1) important(page.page, { 'break-after': 'auto', 'page-break-after': 'auto' });
      if (!fits(page)) throw new Error('محتوا پس از صفحه‌بندی از اندازهٔ صفحه بیشتر است؛ چاپ متوقف شد.');
    });
    return finalPages.length;
  } catch (error) {
    host.replaceChildren();
    throw error;
  } finally { scratch?.page.remove(); }
}

export default paginatePrint;
