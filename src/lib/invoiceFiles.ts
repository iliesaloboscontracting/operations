// Uploaded invoice files (24 Oct 2026): PDFs, photos and accounts' invoice
// register spreadsheets. Stored outside the app folder so a rebuild never
// touches them - INVOICE_FILE_DIR, or ../operations-invoice-files next to the
// app. Only the server reads them; the browser gets one through
// GET /api/invoice-inbox/files/:uploadId behind a login.
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export type InvoiceFileKind = "PDF" | "IMAGE" | "SHEET";

const TYPES: Record<string, { ext: string; kind: InvoiceFileKind; max: number }> = {
  "application/pdf": { ext: "pdf", kind: "PDF", max: 15 * 1024 * 1024 },
  "image/jpeg": { ext: "jpg", kind: "IMAGE", max: 8 * 1024 * 1024 },
  "image/png": { ext: "png", kind: "IMAGE", max: 8 * 1024 * 1024 },
  "image/webp": { ext: "webp", kind: "IMAGE", max: 8 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", kind: "SHEET", max: 10 * 1024 * 1024 },
  "text/csv": { ext: "csv", kind: "SHEET", max: 10 * 1024 * 1024 },
};
const BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, t]) => [t.ext, mime]));

export function invoiceFileDir() {
  return process.env.INVOICE_FILE_DIR || path.resolve(process.cwd(), "..", "operations-invoice-files");
}

// Browsers don't always label spreadsheets/CSVs consistently, so the file's
// own extension decides when the type is blank or generic.
function mimeFor(given: string, originalName: string) {
  if (TYPES[given]) return given;
  const ext = originalName.toLowerCase().split(".").pop() ?? "";
  return BY_EXT[ext === "jpeg" ? "jpg" : ext] ?? null;
}

// Takes a data URL + the original file name from the browser, checks type and
// size, and writes it under a random name. Returns the stored name and kind.
export async function saveInvoiceFile(
  dataUrl: unknown,
  originalName: unknown,
): Promise<{ fileName: string; kind: InvoiceFileKind } | { error: string }> {
  if (typeof dataUrl !== "string" || typeof originalName !== "string") return { error: "No file was sent." };
  const m = dataUrl.match(/^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: "That file couldn't be read." };
  const mime = mimeFor(m[1], originalName);
  if (!mime) return { error: "Upload a PDF, a photo (JPEG/PNG), or a spreadsheet (.xlsx or .csv)." };
  const t = TYPES[mime];
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { error: "The file is empty." };
  if (bytes.length > t.max) return { error: `The file is too large (max ${Math.round(t.max / 1024 / 1024)} MB).` };
  const fileName = `${Date.now()}-${randomBytes(8).toString("hex")}.${t.ext}`;
  await fs.mkdir(invoiceFileDir(), { recursive: true });
  await fs.writeFile(path.join(invoiceFileDir(), fileName), bytes);
  return { fileName, kind: t.kind };
}

// Stored names are only ever ones saveInvoiceFile made - refuse anything else
// so a name can never point outside the folder.
function safePath(fileName: string) {
  if (!/^\d+-[0-9a-f]{16}\.(pdf|jpg|png|webp|xlsx|csv)$/.test(fileName)) throw new Error("Bad invoice file name");
  return path.join(invoiceFileDir(), fileName);
}

export function invoiceMimeOf(fileName: string) {
  return BY_EXT[fileName.split(".").pop() ?? ""] ?? "application/octet-stream";
}

export async function readInvoiceFile(fileName: string): Promise<Buffer> {
  return fs.readFile(safePath(fileName));
}
