// PS-063 (Ilies approved 12 Nov 2026): at most PDF_SLOTS PDFs being made at once across the app - a PDF render is
// heavy, and the plant QR's download is public. Beyond that the caller answers 503 "Busy – try again in a moment."
// Kept on globalThis, so every route bundle in the one server process shares the same count (as the document-search
// refresh lock does).
export const PDF_SLOTS = 2;
export const PDF_BUSY = "Busy – try again in a moment.";

const g = globalThis as unknown as { __lobosPdfSlots?: { busy: number } };
const slots = () => (g.__lobosPdfSlots ??= { busy: 0 });

// Run `fn` holding a slot, or return null at once when all slots are taken.
export async function withPdfSlot<T>(fn: () => Promise<T>, max = PDF_SLOTS): Promise<T | null> {
  const s = slots();
  if (s.busy >= max) return null;
  s.busy++;
  try { return await fn(); } finally { s.busy--; }
}
export const pdfSlotsBusy = () => slots().busy;
