// Quote files on purchase / hire requests (2 Nov 2026): a supplier's quote as a PDF or a photo (JPEG, PNG, WebP).
// Stored outside the app folder so a rebuild never touches them - PURCHASE_FILE_DIR (server:
// /srv/operations/purchase-files - add it to the nightly backup and the off-site copy), or ../operations-purchase-files
// next to the app. Only the server reads them; a person gets one through an authorised route
// (/api/purchases/quotes/:id/file, or the OFFICE link's own /api/site/:token/purchases/quotes/:id/file) - never a
// public path. Same checks as compliance files: the type from the data URL or the name, the size cap, the magic bytes.
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { contentMatches } from "../invoiceFiles";

export const QUOTE_FILE_TYPES: Record<string, { ext: string; max: number }> = {
  "application/pdf": { ext: "pdf", max: 15 * 1024 * 1024 },
  "image/jpeg": { ext: "jpg", max: 10 * 1024 * 1024 },
  "image/png": { ext: "png", max: 10 * 1024 * 1024 },
  "image/webp": { ext: "webp", max: 10 * 1024 * 1024 },
};
const BY_EXT = Object.fromEntries(Object.entries(QUOTE_FILE_TYPES).map(([mime, t]) => [t.ext, mime]));
const isWebp = (b: Buffer) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
const looksRight = (ext: string, b: Buffer) => (ext === "webp" ? isWebp(b) : contentMatches(ext, b));

export function purchaseFileDir() {
  return process.env.PURCHASE_FILE_DIR || path.resolve(process.cwd(), "..", "operations-purchase-files");
}

// Check a sent file (no disk) -> its bytes and type, or why not. Split from saving so `npm test` can check the rules.
export function checkQuoteFile(dataUrl: unknown, originalName: unknown): { bytes: Buffer; mime: string; ext: string; name: string } | { error: string } {
  if (typeof dataUrl !== "string" || typeof originalName !== "string" || !originalName.trim()) return { error: "No file was sent." };
  const m = dataUrl.match(/^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: "That file couldn't be read." };
  const ext0 = originalName.toLowerCase().split(".").pop() ?? "";
  const mime = QUOTE_FILE_TYPES[m[1]] ? m[1] : BY_EXT[ext0 === "jpeg" ? "jpg" : ext0];
  if (!mime) return { error: "Use a PDF or a photo (JPEG, PNG or WebP) for the quote." };
  const t = QUOTE_FILE_TYPES[mime];
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { error: "The file is empty." };
  if (bytes.length > t.max) return { error: `The file is too large (max ${Math.round(t.max / 1024 / 1024)} MB).` };
  if (!looksRight(t.ext, bytes)) return { error: `That file doesn't look like a real .${t.ext} - save it again and re-send.` };
  return { bytes, mime, ext: t.ext, name: originalName.trim().slice(0, 120) };
}

// PQ-001 (2 Nov 2026): the name is chosen first and recorded with the quote; the file is written only once the
// version-guarded save has gone through, so a request that lost a race never leaves a file behind.
export const quoteFileName = (ext: string) => `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
export async function writeQuoteFile(fileName: string, bytes: Buffer): Promise<void> {
  if (!isStoredName(fileName)) throw new Error("Bad purchase file name");
  await fs.mkdir(purchaseFileDir(), { recursive: true });
  await fs.writeFile(path.join(purchaseFileDir(), fileName), bytes, { flag: "wx" }); // never over an existing file
}

// Stored names are only ever ones quoteFileName made - anything else is refused, so a name can never point outside.
export const isStoredName = (fileName: string) => /^\d+-[0-9a-f]{16}\.(pdf|jpg|png|webp)$/.test(fileName);
export async function readQuoteFile(fileName: string): Promise<Buffer> {
  if (!isStoredName(fileName)) throw new Error("Bad purchase file name");
  return fs.readFile(path.join(purchaseFileDir(), fileName));
}
