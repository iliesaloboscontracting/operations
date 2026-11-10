// Large uploads (10 Nov 2026) - what an uploaded object really is, from its first bytes, and (for an MP4 / MOV) how long
// it is, from its movie header. The server reads these from the bucket after the phone says it's done - whatever the
// phone said the file was. Pure; `npm test` (media.test.ts).
import type { MediaKind } from "./rules";

export type Sniffed = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "video/mp4" | "video/quicktime" | "video/webm" | null;

// HEIF brands: an iPhone photo is "heic"; "mif1" / "msf1" are the general HEIF image brands.
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "avif"]);
const QT_ATOMS = new Set(["moov", "mdat", "wide", "free", "skip", "pnot"]);

const ascii = (b: Uint8Array, at: number, n: number) => (b.length >= at + n ? String.fromCharCode(...b.subarray(at, at + n)) : "");

// The type the first bytes say (at least 12 are needed).
export function sniff(b: Uint8Array): Sniffed {
  const at = (i: number, ...v: number[]) => b.length >= i + v.length && v.every((x, k) => b[i + k] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm"; // EBML (WebM / Matroska)
  const box = ascii(b, 4, 4);
  if (box === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (HEIF_BRANDS.has(brand)) return "image/heic";
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (QT_ATOMS.has(box)) return "video/quicktime"; // an older QuickTime file that starts straight with an atom
  return null;
}

// Do the bytes fit what the phone said? A photo must be a photo type, a video a video type; within the family the
// exact type must match, except MP4 / MOV (the same container - phones label them loosely) and HEIC / HEIF.
export function matchesClaim(kind: MediaKind, claimed: string, b: Uint8Array): boolean {
  const real = sniff(b);
  if (!real) return false;
  if (kind === "PHOTO") {
    if (!real.startsWith("image/")) return false;
    if (claimed === "image/heic" || claimed === "image/heif") return real === "image/heic";
    return real === claimed;
  }
  if (!real.startsWith("video/")) return false;
  if (claimed === "video/webm") return real === "video/webm";
  return real === "video/mp4" || real === "video/quicktime";
}

// The length of an MP4 / MOV in seconds from its movie header ("mvhd"), when these bytes hold it - the start of the
// file (a "fast start" file) or its end (a phone recording, where the header is written last). null = not found.
export function mp4DurationSec(b: Uint8Array): number | null {
  for (let i = 4; i + 24 <= b.length; i++) {
    if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue; // "mvhd"
    const v = new DataView(b.buffer, b.byteOffset + i + 4);
    const version = v.getUint8(0);
    if (version === 0) {
      if (i + 4 + 20 > b.length) return null;
      const scale = v.getUint32(12), dur = v.getUint32(16);
      if (scale > 0) return dur / scale;
    } else if (version === 1) {
      if (i + 4 + 32 > b.length) return null;
      const scale = v.getUint32(20), dur = Number(v.getBigUint64(24));
      if (scale > 0) return dur / scale;
    }
    return null;
  }
  return null;
}
