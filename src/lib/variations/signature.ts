// The finger signatures on a variation docket (Ilies, 25 Nov 2026: the client signs on the supervisor's phone). The
// phone sends each one as a PNG data URL; here it's decoded and checked by its own bytes and capped at 200 KB.
// VD-004 (Ilies approved 25 Nov 2026): the whole file is walked chunk by chunk from the 8-byte PNG signature - each
// chunk's length, type, data and CRC - and it must stop at an IEND that ends exactly at the end of the file. Only the
// image chunks a canvas writes are kept (IHDR first, at least one IDAT): text (tEXt / zTXt / iTXt), EXIF and any other
// optional chunk are stripped before storing (iPhone fix, 26 Nov 2026 - they used to be refused, which blocked iPhones);
// an unknown required chunk is refused; nothing after IEND. The bytes are stored in the database with the docket (VariationSignature) so
// they're in the nightly backup with it.
//
// What phones really send (canvas.toDataURL("image/png")): Chrome / Edge / Android Chrome (Skia) write IHDR, IDAT x N,
// IEND - tested 25 Nov 2026 on Chrome 156; Firefox the same. Safari (WebKit -> Apple ImageIO) can add a colour profile
// (iCCP, or sRGB / gAMA / cHRM) and pHYs, and ImageIO's iDOT (byte offsets for parallel decoding, no text) - allowed
// here so an iPhone signature isn't refused.
import { createHash } from "crypto";
import { LIMITS } from "./rules";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const ALLOWED_CHUNKS: readonly string[] = ["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "sRGB", "gAMA", "pHYs", "iCCP", "cHRM", "iDOT"];

// CRC-32 (the PNG / zlib one), from a small table - no dependency on the Node version.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type Signature = { png: Buffer; bytes: number; sha256: string; width: number; height: number };
type Refused = { error: string };

// At most this many chunks in one signature (VD-008: a canvas writes a handful; this stops a file of thousands of tiny ones).
export const MAX_CHUNKS = 256;

// A PNG's own bytes and shape, or the reason it isn't an acceptable one.
// iPhone fix (Ilies approved 26 Nov 2026, after an iPhone's client signature was refused on site): an OPTIONAL chunk
// (an "ancillary" one - lower-case first letter, PNG spec 5.4) that isn't on the list - text, EXIF, a newer colour
// chunk Safari writes - is no longer a refusal: it's STRIPPED, and `png` is the rebuilt file without it, so its data is
// never stored or served. A REQUIRED chunk that isn't IHDR / PLTE / IDAT / IEND is still refused, and so is everything
// else here (CRCs, IHDR first, an IDAT, IEND at the very end, the size and byte caps). iDOT (Apple's byte offsets to the
// IDATs) is dropped too whenever anything is stripped, because its offsets would then be wrong.
export function checkPng(png: Buffer): { width: number; height: number; chunks: string[]; stripped: string[]; png: Buffer } | Refused {
  if (png.length < 8 + 25 + 12) return { error: "too small" };
  if (png.length > LIMITS.signatureBytes) return { error: "too big" };
  if (!png.subarray(0, 8).equals(PNG_MAGIC)) return { error: "not a PNG" };
  const chunks: string[] = [];
  const stripped: string[] = [];
  const kept: { type: string; bytes: Buffer }[] = [];
  let o = 8, idat = 0, width = 0, height = 0, seen = 0;
  for (;;) {
    if (o + 12 > png.length) return { error: "cut short" };
    if (++seen > MAX_CHUNKS) return { error: "too many chunks" };
    const len = png.readUInt32BE(o);
    const type = png.subarray(o + 4, o + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type)) return { error: "not a PNG" };
    const end = o + 12 + len;
    if (len > png.length || end > png.length) return { error: "cut short" };
    if (png.readUInt32BE(o + 8 + len) !== crc32(png.subarray(o + 4, o + 8 + len))) return { error: "bad CRC" };
    if (!chunks.length && (type !== "IHDR" || len !== 13)) return { error: "not a PNG" };
    if (chunks.length && type === "IHDR") return { error: "not a PNG" };
    if (!ALLOWED_CHUNKS.includes(type)) {
      const optional = type.charCodeAt(0) >= 97; // lower-case first letter = ancillary
      if (!optional) return { error: `chunk ${type}` };
      stripped.push(type);
      o = end;
      continue;
    }
    chunks.push(type);
    kept.push({ type, bytes: png.subarray(o, end) });
    if (type === "IHDR") {
      width = png.readUInt32BE(o + 8);
      height = png.readUInt32BE(o + 12);
      if (width < 1 || height < 1 || width > LIMITS.signatureSide || height > LIMITS.signatureSide) return { error: "odd size" };
    }
    if (type === "IDAT") idat++;
    if (type === "IEND") {
      if (len !== 0) return { error: "not a PNG" };
      if (end !== png.length) return { error: "bytes after the end" };
      break;
    }
    o = end;
  }
  if (!idat) return { error: "no image data" };
  if (!stripped.length) return { width, height, chunks, stripped, png };
  // Rebuild without the stripped chunks (and without iDOT, whose offsets no longer hold).
  const keep = kept.filter((k) => k.type !== "iDOT");
  if (keep.length !== kept.length) stripped.push("iDOT");
  return { width, height, chunks: keep.map((k) => k.type), stripped, png: Buffer.concat([PNG_MAGIC, ...keep.map((k) => k.bytes)]) };
}

// A refused or tidied signature goes in the server log - chunk names and sizes only, never the image or any text from
// it - so a phone that sends something new can be seen and fixed (26 Nov 2026).
export function logSignature(where: string, what: string) {
  console.warn(`[signature] ${where}: ${what.replace(/[^\w ,.:()>/-]/g, "?").slice(0, 200)}`);
}

// "data:image/png;base64,...." -> the checked PNG, or a refusal in plain words.
export function parseSignature(dataUrl: string, who: "client" | "Lobos"): Signature | Refused {
  const refuse = { error: who === "client" ? "The client's signature didn't come through - ask them to sign again." : "Your signature didn't come through - sign again." };
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) { logSignature(`variation ${who}`, `refused: not a PNG data URL (length ${dataUrl.length}, starts ${dataUrl.slice(0, 14)})`); return refuse; }
  const b64 = dataUrl.slice(prefix.length);
  if (b64.length > Math.ceil((LIMITS.signatureBytes * 4) / 3) + 4) return { error: "That signature is too big - clear it and sign again." };
  // Base64 only (no spaces or anything else).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) { logSignature(`variation ${who}`, "refused: not clean base64"); return refuse; }
  const raw = Buffer.from(b64, "base64");
  const ok = checkPng(raw);
  if ("error" in ok) { logSignature(`variation ${who}`, `refused: ${ok.error} (${raw.length} bytes)`); return ok.error === "too big" ? { error: "That signature is too big - clear it and sign again." } : refuse; }
  if (ok.stripped.length) logSignature(`variation ${who}`, `stripped ${ok.stripped.join(",")} (${raw.length} -> ${ok.png.length} bytes)`);
  const png = ok.png;
  return { png, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), width: ok.width, height: ok.height };
}

// VD-004: the client's and the supervisor's signatures are two different drawings - the same image twice is refused.
export const IDENTICAL_SIGNATURES = "The two signatures can't be identical - the client signs, then you sign.";
export const identicalSignatures = (a: Pick<Signature, "sha256">, b: Pick<Signature, "sha256">) => a.sha256 === b.sha256;
