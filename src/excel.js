import * as XLSX from 'xlsx';

/* sheets: [{ name, rows: [[cell, ...], ...] }]  — first row is the header */
export async function saveWorkbook(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    const widths = [];
    s.rows.forEach(r => r.forEach((c, i) => { const len = String(c ?? '').length; widths[i] = Math.min(40, Math.max(widths[i] || 8, len + 2)); }));
    ws['!cols'] = widths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  wb.Workbook = { Views: [{ RTL: true }] };
  const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  if (window.printshopApi && window.printshopApi.saveFile) return window.printshopApi.saveFile(filename, b64);
  const a = document.createElement('a');
  a.href = 'data:application/octet-stream;base64,' + b64; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  return { ok: true };
}
