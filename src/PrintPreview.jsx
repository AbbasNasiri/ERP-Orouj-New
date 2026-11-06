import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { paginatePrint } from './print-pagination.js';
import { registerCloseBlocker } from './close-registry.mjs';
import './print-pages.css';

// The very same measured pages are used for preview, the printer and Save as PDF.
export default function PrintPreview({ children, onClose, toolbar, initialPaper = 'A4', lockedPaper, orientation = 'portrait', pdfName = 'برگه' }) {
  const closer = useRef(onClose); closer.current = onClose;
  useEffect(() => registerCloseBlocker(() => ({ title: 'پیش‌نمایش چاپ', dirty: false, close: () => closer.current?.() })), []);
  const [selectedPaper, setPaper] = useState(initialPaper === 'A5' ? 'A5' : 'A4');
  const paperLocked = lockedPaper === 'A4' || lockedPaper === 'A5';
  const paper = paperLocked ? lockedPaper : selectedPaper;
  const cssOrientation = orientation === 'landscape' ? 'landscape' : 'portrait';
  const [status, setStatus] = useState({ ready: false, count: 0, error: '' });
  const [pdfState, setPdfState] = useState({ busy: false, message: '' });
  const source = useRef(null), pages = useRef(null);
  const canExportPdf = typeof window.printshopApi?.savePdf === 'function';
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setStatus({ ready: false, count: 0, error: '' });
    (async () => {
      try {
        await document.fonts.ready;
        if (cancelled) return;
        const count = await paginatePrint(source.current, pages.current, { paper, orientation, signal: controller.signal });
        if (!cancelled) setStatus({ ready: true, count, error: '' });
      } catch (error) {
        if (!cancelled) setStatus({ ready: false, count: 0, error: error.message || 'صفحه‌بندی انجام نشد.' });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [children, paper, orientation]);

  async function exportPdf() {
    setPdfState({ busy: true, message: 'در حال ساخت PDF…' });
    try {
      const r = await window.printshopApi.savePdf(paper, pdfName, orientation);
      if (r?.ok) setPdfState({ busy: false, message: `PDF ذخیره شد (${r.paper})` });
      else if (r?.canceled) setPdfState({ busy: false, message: '' });
      else setPdfState({ busy: false, message: r?.error || 'PDF ذخیره نشد.' });
    } catch (error) {
      setPdfState({ busy: false, message: error?.message || 'PDF ذخیره نشد.' });
    }
  }

  return createPortal(<div className="print-root" dir="rtl" data-paper={paper} data-orientation={cssOrientation}>
    <style>{`@page { size: ${paper} ${cssOrientation}; margin: 0; }`}</style>
    <div className="no-print print-toolbar">
      <button type="button" disabled={!status.ready} onClick={() => window.print()}>چاپ</button>
      {canExportPdf && <button type="button" disabled={!status.ready || pdfState.busy} onClick={exportPdf}>ذخیره PDF</button>}
      <label>اندازهٔ کاغذ <select aria-label="اندازهٔ کاغذ" value={paper} disabled={paperLocked} onChange={e => setPaper(e.target.value)}><option value="A4">A4</option><option value="A5">A5</option></select></label>
      {toolbar}
      <span role="status">{pdfState.message || status.error || (status.ready ? `${new Intl.NumberFormat('fa-IR').format(status.count)} صفحه` : 'در حال صفحه‌بندی…')}</span>
      <button type="button" onClick={onClose}>بستن</button>
    </div>
    <div ref={source} className="print-source" aria-hidden="true" data-paper={paper} data-orientation={cssOrientation}>{children}</div>
    <div ref={pages} className="print-pages" data-paper={paper} data-orientation={cssOrientation} aria-label="پیش‌نمایش صفحات چاپ" aria-busy={!status.ready} />
  </div>, document.body);
}
