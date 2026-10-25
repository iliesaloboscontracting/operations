// Receipt and odometer photos are stored as files outside the app folder so a rebuild never touches
// them - RECEIPT_FILE_DIR (server: /srv/operations/receipt-files, in the nightly backup), or
// ../operations-receipt-files next to the app. Only the server reads or writes them; the office gets
// one through GET /api/receipts/photos/:id behind a login. A phone never loads one back.
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

// Phone photos are shrunk in the browser before upload (lib/imageResize.ts); a long docket may
// need more detail than a tool plate, so a little more room than tool photos.
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAGIC: Record<string, number[]> = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };

export function receiptFileDir() {
  return process.env.RECEIPT_FILE_DIR || path.resolve(process.cwd(), "..", "operations-receipt-files");
}

// Takes a data URL from the browser, checks it really is an image of an allowed type and size, and
// writes it under a random file name.
export async function saveReceiptPhoto(dataUrl: unknown): Promise<{ fileName: string } | { error: string }> {
  if (typeof dataUrl !== "string") return { error: "No photo was sent." };
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || !ALLOWED.has(m[1])) return { error: "The photo must be a JPEG, PNG or WebP image." };
  const ext = ALLOWED.get(m[1])!;
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { error: "The photo is empty." };
  if (bytes.length > MAX_BYTES) return { error: "The photo is too large - try again (it should shrink automatically)." };
  if (!MAGIC[ext].every((x, i) => bytes[i] === x)) return { error: "That doesn't look like a photo - take it again." };
  const fileName = `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
  await fs.mkdir(receiptFileDir(), { recursive: true });
  await fs.writeFile(path.join(receiptFileDir(), fileName), bytes);
  return { fileName };
}

// Stored names are only ever ones saveReceiptPhoto made - refuse anything else so a name can never
// point outside the folder.
function safePath(fileName: string) {
  if (!/^\d+-[0-9a-f]{16}\.(jpg|png|webp)$/.test(fileName)) throw new Error("Bad receipt file name");
  return path.join(receiptFileDir(), fileName);
}

export const receiptMimeOf = (fileName: string) => (fileName.endsWith(".png") ? "image/png" : fileName.endsWith(".webp") ? "image/webp" : "image/jpeg");

export async function readReceiptPhoto(fileName: string): Promise<Buffer> {
  return fs.readFile(safePath(fileName));
}
