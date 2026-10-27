// LCI phase 6: the text-reading itself - PDF (unpdf: Mozilla's pdf.js, no native code), Word .docx (the zip reader
// below, no library), Excel .xlsx (exceljs), plain text. Plain JavaScript on purpose (DS-015, security review, Ilies
// approved 27 Oct 2026): it runs inside a worker thread with its own memory cap and a time limit
// (extract-worker.mjs, started by extract.ts), loaded by Node straight from the app folder - no bundler step - and the
// same file is what the tests and zip.ts use. Anything unreadable is "not readable", never guessed at.
import { inflateRawSync } from "node:zlib";

export const MAX_PDF_PAGES = 300;
export const MAX_CHARS = 200_000;
export const MAX_XLSX_UNPACKED = 100 * 1024 * 1024; // DS-015: an .xlsx expanding past 100 MB isn't opened at all
const MAX_ENTRY_OUT = 50 * 1024 * 1024;

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;

/** Walk a zip's central directory (so data descriptors don't matter). @returns {{ name: string, method: number, csize: number, usize: number, off: number }[] | null} */
export function zipDirectory(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === EOCD) { e = i; break; }
  if (e < 0) return null;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN) return null;
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString("utf8", p + 46, p + 46 + nlen), method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20), usize: buf.readUInt32LE(p + 24), off: buf.readUInt32LE(p + 42) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** Total unpacked size a zip declares, or null when it isn't a readable zip. @param {Buffer} buf @returns {number | null} */
export function zipUnpackedSize(buf) {
  const dir = zipDirectory(buf);
  return dir ? dir.reduce((n, e) => n + e.usize, 0) : null;
}

/** One file out of a zip - stored or deflated only, refused past 50 MB (zip bombs). @param {Buffer} buf @param {string} name @returns {Buffer | null} */
export function zipEntry(buf, name) {
  const dir = zipDirectory(buf);
  const e = dir?.find((x) => x.name === name);
  if (!e) return null;
  if (e.usize > MAX_ENTRY_OUT || e.off + 30 > buf.length || buf.readUInt32LE(e.off) !== LOC) return null;
  const start = e.off + 30 + buf.readUInt16LE(e.off + 26) + buf.readUInt16LE(e.off + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_OUT });
  return null;
}

/** The text of a Word .docx: each paragraph on its own line. @param {Buffer} buf @returns {string | null} */
export function docxText(buf) {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) return null;
  return xml.toString("utf8")
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function pdfText(buf) {
  const { getDocumentProxy } = await import("unpdf");
  // pdf.js 6 has no eval / new Function path at all (the CVE-2024-4367 font-code route is gone); fonts never become code.
  const doc = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  let out = "";
  for (let i = 1; i <= pages && out.length < MAX_CHARS; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("") + "\n";
  }
  await doc.cleanup().catch(() => undefined);
  return out;
}

async function xlsxText(buf) {
  const unpacked = zipUnpackedSize(buf);
  if (unpacked === null || unpacked > MAX_XLSX_UNPACKED) throw new Error("xlsx refused");
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = [];
  wb.eachSheet((ws) => {
    out.push(`# ${ws.name}`);
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, (c) => { const t = c.text?.trim(); if (t) cells.push(t); });
      if (cells.length) out.push(cells.join(" | "));
    });
  });
  return out.join("\n");
}

const clean = (t) => t.replace(/\u0000/g, "").replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, MAX_CHARS);

/** Read one supported file. @param {string} ext @param {Buffer} buf @returns {Promise<{ status: "OK", text: string } | { status: "UNREADABLE", text: "", why: string }>} */
export async function extractCore(ext, buf) {
  try {
    const raw = ext === "pdf" ? await pdfText(buf) : ext === "docx" ? docxText(buf) : ext === "xlsx" ? await xlsxText(buf) : buf.toString("utf8");
    const text = clean(raw ?? "");
    if (text.replace(/\s/g, "").length < 20) return { status: "UNREADABLE", text: "", why: ext === "pdf" ? "no text layer (a scan?)" : "no text found" };
    return { status: "OK", text };
  } catch {
    return { status: "UNREADABLE", text: "", why: "the file couldn't be opened" };
  }
}
