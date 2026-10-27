// LCI phase 6: text out of a document - PDF (unpdf: Mozilla's pdf.js, no native code), Word .docx (zip.ts, no
// library), Excel .xlsx (exceljs, already used), plain text. Anything else, a scan with no text layer, or a broken file
// is "not readable" - listed, never guessed at. Design: docs/lci/PHASE6-DESIGN.md §2 (limits D6-9).
import ExcelJS from "exceljs";
import { docxText } from "./zip";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_PAGES = 300;
export const MAX_CHARS = 200_000;

export type Extracted = { status: "OK"; text: string } | { status: "UNREADABLE" | "TOO_BIG" | "UNSUPPORTED"; text: ""; why: string };
export const SUPPORTED = ["pdf", "docx", "xlsx", "txt", "csv", "md"] as const;
export const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
export const isSupported = (name: string) => (SUPPORTED as readonly string[]).includes(extOf(name));

const clean = (t: string) => t.replace(/\u0000/g, "").replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, MAX_CHARS);
const fail = (status: "UNREADABLE" | "TOO_BIG" | "UNSUPPORTED", why: string): Extracted => ({ status, text: "", why });

async function pdfText(buf: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  // pdf.js 6 has no eval / new Function path at all (the CVE-2024-4367 font-code route is gone), so there's no
  // isEvalSupported switch to turn off; fonts are never turned into code.
  const doc = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  let out = "";
  for (let i = 1; i <= pages && out.length < MAX_CHARS; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("") + "\n";
  }
  await doc.cleanup().catch(() => undefined);
  return out;
}

async function xlsxText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  // exceljs's own Buffer type predates Node's generic Buffer.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`# ${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (c) => { const t = c.text?.trim(); if (t) cells.push(t); });
      if (cells.length) out.push(cells.join(" | "));
    });
  });
  return out.join("\n");
}

export async function extractText(name: string, buf: Buffer): Promise<Extracted> {
  const ext = extOf(name);
  if (!isSupported(name)) return fail("UNSUPPORTED", ext ? `.${ext} files aren't read` : "no file type");
  if (buf.length > MAX_FILE_BYTES) return fail("TOO_BIG", "over 25 MB");
  try {
    const raw = ext === "pdf" ? await pdfText(buf) : ext === "docx" ? docxText(buf) : ext === "xlsx" ? await xlsxText(buf) : buf.toString("utf8");
    const text = clean(raw ?? "");
    if (text.replace(/\s/g, "").length < 20) return fail("UNREADABLE", ext === "pdf" ? "no text layer (a scan?)" : "no text found");
    return { status: "OK", text };
  } catch {
    return fail("UNREADABLE", "the file couldn't be opened");
  }
}
