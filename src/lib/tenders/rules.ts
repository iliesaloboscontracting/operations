// Directors -> Tenders (17 Nov 2026, Ilies: "yes build the tenders tab"). Plain rules shared by the API routes, the
// page and the tests. The tab reads Lobos Estimating's tender register through tenders-board.v1 (server to server,
// the x-lobos-board key) - Estimating is the one source of truth; nothing here keeps its own copy.

export const BOARD_SCHEMA = "tenders-board.v1";

// The shared key Estimating checks (BOARD_SECRET, at least 16 characters, the same value in both .env files).
export const boardSecret = (env: Record<string, string | undefined> = process.env) =>
  (env.BOARD_SECRET ?? "").length >= 16 ? env.BOARD_SECRET! : null;

// Ids we pass on to Estimating in a path: letters, digits, _ and - only (no slashes, dots or encoded tricks).
export const safeId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));

// A quote file the director attaches: PDF or Word (.docx), 7 MB (Next cuts a body at 10 MB; files travel base64).
export const QUOTE_FILE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
export function quoteFileKind(fileName: string, dataUrl: string): "pdf" | "docx" | null {
  const mime = /^data:([^;,]+)[;,]/.exec(dataUrl)?.[1] ?? "";
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const kind = QUOTE_FILE_TYPES[mime];
  if (kind && ext === kind) return kind as "pdf" | "docx";
  return null;
}
// The first bytes have to match too (a renamed file is refused): PDF "%PDF", .docx is a zip "PK".
export function bytesMatch(kind: "pdf" | "docx", bytes: Uint8Array) {
  if (kind === "pdf") return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

// Just the file's own name, tidied, for x-file-name (Estimating takes the basename again; belt and braces).
export const cleanFileName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? "quote").replace(/[^\w .()-]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "quote";

export type QuoteMeta = { version?: number; quoteNo?: string; builder: string; valueExGst: number; revision?: string; submittedDate?: string };

// What a director typed on the "Log my quote" form -> the x-quote-meta Estimating reads. Words and one value only.
export function quoteMeta(input: Record<string, unknown>, needQuoteNo: boolean): { meta: QuoteMeta } | { error: string } {
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
  const builder = text(input.builder, 120);
  if (builder.length < 2) return { error: "Which builder was the quote for?" };
  const value = typeof input.valueExGst === "number" ? input.valueExGst : Number(String(input.valueExGst ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) return { error: "Enter the quote value ex GST." };
  const quoteNo = text(input.quoteNo, 40);
  if (needQuoteNo && !quoteNo) return { error: "Enter the quote number (e.g. 26_543)." };
  const submittedDate = text(input.submittedDate, 10);
  if (submittedDate && !isIsoDate(submittedDate)) return { error: "The date isn't valid." };
  const meta: QuoteMeta = { builder, valueExGst: Math.round(value * 100) / 100 };
  if (quoteNo) meta.quoteNo = quoteNo;
  const revision = text(input.revision, 20);
  if (revision) meta.revision = revision;
  if (submittedDate) meta.submittedDate = submittedDate;
  if (typeof input.version === "number" && Number.isInteger(input.version)) meta.version = input.version;
  return { meta };
}

// Plain words for Estimating's error codes.
export function estimatingWords(status: number, code?: string, error?: string): string {
  if (status === 0) return "Estimating isn't answering right now - try again shortly.";
  switch (code) {
    case "board-key": return "The Tenders link to Estimating isn't set up yet (BOARD_SECRET).";
    case "routing-not-configured": return "The tender routing (who looks after which tenders) hasn't been set up in Estimating yet.";
    case "not-an-issuer": return "Only Ilies, Yoel and Nick can assign tenders or log quotes.";
    case "stale": return "Someone changed this tender a moment ago - refresh and try again.";
    case "too-large": return "That file is too large (7 MB) - save a smaller copy.";
  }
  if (status === 409) return error ?? "That clashes with another tender - refresh and check.";
  return error ?? `Estimating refused it (${status}).`;
}
