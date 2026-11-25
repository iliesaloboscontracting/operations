// The finger signatures on a variation docket (Ilies, 25 Nov 2026: the client signs on the supervisor's phone). The
// phone sends each one as a PNG data URL; here it's decoded and checked by its own bytes and capped at 200 KB.
// VD-004 (Ilies approved 25 Nov 2026): the whole file is walked chunk by chunk from the 8-byte PNG signature - each
// chunk's length, type, data and CRC - and it must stop at an IEND that ends exactly at the end of the file. Only the
// image chunks a canvas writes are allowed (IHDR first, at least one IDAT): no text (tEXt / zTXt / iTXt), no EXIF, no
// unknown chunk, nothing after IEND. The bytes are stored in the database with the docket (VariationSignature) so
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

// A PNG's own bytes and shape, or the reason it isn't an acceptable one.
export function checkPng(png: Buffer): { width: number; height: number; chunks: string[] } | Refused {
  if (png.length < 8 + 25 + 12) return { error: "too small" };
  if (png.length > LIMITS.signatureBytes) return { error: "too big" };
  if (!png.subarray(0, 8).equals(PNG_MAGIC)) return { error: "not a PNG" };
  const chunks: string[] = [];
  let o = 8, idat = 0, width = 0, height = 0;
  for (;;) {
    if (o + 12 > png.length) return { error: "cut short" };
    const len = png.readUInt32BE(o);
    const type = png.subarray(o + 4, o + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type)) return { error: "not a PNG" };
    const end = o + 12 + len;
    if (len > png.length || end > png.length) return { error: "cut short" };
    if (png.readUInt32BE(o + 8 + len) !== crc32(png.subarray(o + 4, o + 8 + len))) return { error: "bad CRC" };
    if (!chunks.length && (type !== "IHDR" || len !== 13)) return { error: "not a PNG" };
    if (chunks.length && type === "IHDR") return { error: "not a PNG" };
    if (!ALLOWED_CHUNKS.includes(type)) return { error: `chunk ${type}` };
    chunks.push(type);
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
  return { width, height, chunks };
}

// "data:image/png;base64,...." -> the checked PNG, or a refusal in plain words.
export function parseSignature(dataUrl: string, who: "client" | "Lobos"): Signature | Refused {
  const refuse = { error: who === "client" ? "The client's signature didn't come through - ask them to sign again." : "Your signature didn't come through - sign again." };
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return refuse;
  const b64 = dataUrl.slice(prefix.length);
  if (b64.length > Math.ceil((LIMITS.signatureBytes * 4) / 3) + 4) return { error: "That signature is too big - clear it and sign again." };
  // Base64 only (no spaces or anything else).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return refuse;
  const png = Buffer.from(b64, "base64");
  const ok = checkPng(png);
  if ("error" in ok) return ok.error === "too big" ? { error: "That signature is too big - clear it and sign again." } : refuse;
  return { png, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), width: ok.width, height: ok.height };
}

// VD-004: the client's and the supervisor's signatures are two different drawings - the same image twice is refused.
export const IDENTICAL_SIGNATURES = "The two signatures can't be identical - the client signs, then you sign.";
export const identicalSignatures = (a: Pick<Signature, "sha256">, b: Pick<Signature, "sha256">) => a.sha256 === b.sha256;
