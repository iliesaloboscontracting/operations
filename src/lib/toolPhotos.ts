// Tool photos (rating plate, condition, fault, toolbox check) are stored as
// files outside the app folder so a rebuild never touches them. The folder
// is TOOL_PHOTO_DIR, or ../operations-tool-photos next to the app.
// Only the server reads or writes them; the browser gets them through
// GET /api/tools/photos/:id behind a login.
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export const PHOTO_KINDS = ["PLATE", "CONDITION", "FAULT", "CHECK"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

// Phone photos are shrunk in the browser before upload (lib/imageResize.ts),
// so anything near this size is a mistake rather than a real photo.
const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export function photoDir() {
  return process.env.TOOL_PHOTO_DIR || path.resolve(process.cwd(), "..", "operations-tool-photos");
}

// Takes a data URL from the browser, checks it is an image of an allowed type
// and size, and writes it under a random file name. Returns the file name.
export async function savePhoto(dataUrl: unknown): Promise<{ fileName: string } | { error: string }> {
  if (typeof dataUrl !== "string") return { error: "No photo was sent." };
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || !ALLOWED.has(m[1])) return { error: "The photo must be a JPEG, PNG or WebP image." };
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { error: "The photo is empty." };
  if (bytes.length > MAX_BYTES) return { error: "The photo is too large - try again (it should shrink automatically)." };
  const fileName = `${Date.now()}-${randomBytes(8).toString("hex")}.${ALLOWED.get(m[1])}`;
  await fs.mkdir(photoDir(), { recursive: true });
  await fs.writeFile(path.join(photoDir(), fileName), bytes);
  return { fileName };
}

// File names are only ever ones savePhoto made - refuse anything else so a
// stored name can never point outside the photo folder.
function safePath(fileName: string) {
  if (!/^\d+-[0-9a-f]{16}\.(jpg|png|webp)$/.test(fileName)) throw new Error("Bad photo file name");
  return path.join(photoDir(), fileName);
}

export function mediaTypeOf(fileName: string): "image/jpeg" | "image/png" | "image/webp" {
  return fileName.endsWith(".png") ? "image/png" : fileName.endsWith(".webp") ? "image/webp" : "image/jpeg";
}

export async function readPhoto(fileName: string): Promise<Buffer> {
  return fs.readFile(safePath(fileName));
}
