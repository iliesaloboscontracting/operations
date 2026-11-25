// Browser helpers for the office's Site documents pages.
// A picked file as a data URL (to send it as JSON - 7 MB a file, lib/uploadLimits.ts).
export const readAsDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
// A4 printing: only #print-sheet prints.
export const PRINT_CSS = `
@page { size: A4; margin: 10mm; }
@media print {
  body * { visibility: hidden !important; }
  #print-sheet, #print-sheet * { visibility: visible !important; }
  #print-sheet { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: 0 !important; }
  #print-sheet tr, #print-sheet .keep { break-inside: avoid; }
}`;
