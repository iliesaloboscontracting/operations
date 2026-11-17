// Directors -> Tenders (17 Nov 2026, Ilies: "yes build the tenders tab"). Plain rules shared by the API routes, the
// page and the tests. The tab reads Lobos Estimating's tender register through tenders-board.v1 (server to server,
// the x-lobos-board key) - Estimating is the one source of truth; nothing here keeps its own copy.
import type { TendersBoardV1 } from "./board";

export const BOARD_SCHEMA = "tenders-board.v1";

// The shared key Estimating checks (BOARD_SECRET, at least 16 characters, the same value in both .env files).
export const boardSecret = (env: Record<string, string | undefined> = process.env) =>
  (env.BOARD_SECRET ?? "").length >= 16 ? env.BOARD_SECRET! : null;

// Ids we pass on to Estimating in a path: letters, digits, _ and - only (no slashes, dots or encoded tricks).
export const safeId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
// TND-004 (Ilies approved 17 Nov 2026): exactly what Estimating's board routes accept - a tender id (1-40) and a quote
// file id (6-20 lower-case letters / digits) - so nothing carrying the board key falls through to its other handlers.
export const tenderId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v);
export const fileId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]{6,20}$/.test(v);
const httpsOnly = (v: unknown) => (typeof v === "string" && /^https:\/\//i.test(v) ? v.slice(0, 2000) : null);

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

// TND-002 (Ilies approved 17 Nov 2026): only the agreed fields go to the browser, each coerced to its type - anything
// Estimating adds to the feed later (rates, notes, internal paths) stays on the server. Links are https only.
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const strs = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 200)) : []);
const isoDay = (v: unknown) => (isIsoDate(v) ? v : null);
const KEY = /^[a-z0-9_-]{1,40}$/;

export function toBoardDto(raw: unknown): TendersBoardV1 {
  const b = obj(raw);
  const routing = obj(b.routing);
  const period = obj(b.period);
  const v = obj(b.values_ex_gst);
  const counts: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(b.counts))) if (/^[a-zA-Z]{1,30}$/.test(k)) counts[k] = int0(n);
  const byPerson: TendersBoardV1["byPerson"] = {};
  for (const [k, p0] of Object.entries(obj(b.byPerson))) {
    if (!KEY.test(k)) continue;
    const p = obj(p0);
    byPerson[k] = { received: int0(p.received), open: int0(p.open), submitted: int0(p.submitted), won: int0(p.won), lost: int0(p.lost), overdue: int0(p.overdue), hitRate: num(p.hitRate), medianDaysToSubmit: num(p.medianDaysToSubmit) };
  }
  const bySource: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(b.bySource))) if (KEY.test(k)) bySource[k] = int0(n);
  const people = (Array.isArray(routing.people) ? routing.people : []).slice(0, 20).map(obj)
    .filter((p) => typeof p.key === "string" && KEY.test(p.key))
    .map((p) => ({ key: p.key as string, name: str(p.name, 60) ?? (p.key as string), scope: str(p.scope, 200) ?? "" }));
  const tenders = (Array.isArray(b.tenders) ? b.tenders : []).slice(0, 2000).map(obj).filter((t) => tenderId(t.id)).map((t) => {
    const qf = obj(t.quoteFile);
    return {
      id: t.id as string, version: int0(t.version), quoteNo: str(t.quoteNo, 40), name: str(t.name, 200) ?? "",
      client: str(t.client, 200), siteAddress: str(t.siteAddress, 300), builders: strs(t.builders), sources: strs(t.sources),
      receivedDate: isoDay(t.receivedDate), dueDate: isoDay(t.dueDate), status: str(t.status, 20) ?? "",
      assignee: typeof t.assignee === "string" && KEY.test(t.assignee) ? t.assignee : null,
      assignReason: str(t.assignReason, 300), assignedBy: str(t.assignedBy, 120),
      structuralFlag: t.structuralFlag === true, structuralNote: str(t.structuralNote, 300), workType: str(t.workType, 60),
      valueEstimate: num(t.valueEstimate), submittedValue: num(t.submittedValue),
      // No url from Estimating: the page links to /api/directors/tenders/:id/quote-files/:fid itself.
      quoteFile: fileId(qf.id) ? { id: qf.id as string, name: str(qf.name, 160) ?? "quote", revision: str(qf.revision, 20), at: str(qf.at, 40) ?? "", url: "" } : null,
      folderUrl: httpsOnly(t.folderUrl), portalUrl: httpsOnly(t.portalUrl),
      daysOpen: num(t.daysOpen), overdue: t.overdue === true, dueSoon: t.dueSoon === true,
    };
  });
  return {
    schema_version: str(b.schema_version, 40) ?? "", generated_at: str(b.generated_at, 40) ?? "", as_at: str(b.as_at, 10) ?? "",
    period: { from: isoDay(period.from) ?? "", to: isoDay(period.to) ?? "" },
    routing: { configured: routing.configured === true, people },
    counts, byPerson, bySource,
    byWeek: (Array.isArray(b.byWeek) ? b.byWeek : []).slice(0, 60).map(obj).map((w) => ({ weekStart: isoDay(w.weekStart) ?? "", received: int0(w.received), submitted: int0(w.submitted), won: int0(w.won) })),
    values_ex_gst: { submitted: num(v.submitted), won: num(v.won), openPipeline: num(v.openPipeline) },
    tenders,
  };
}
