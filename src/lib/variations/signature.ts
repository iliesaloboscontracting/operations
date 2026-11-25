// The finger signatures on a variation docket (Ilies, 25 Nov 2026: the client signs on the supervisor's phone). The
// phone sends each one as a PNG data URL; here it's decoded and checked by its own bytes - the PNG signature, an IHDR
// chunk first with a sensible size, an IEND at the end - and capped at 200 KB. Anything else is refused. The bytes are
// stored in the database with the docket (VariationSignature) so they're in the nightly backup with it.
import { createHash } from "crypto";
import { LIMITS } from "./rules";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]); // "IEND" + its fixed CRC

export type Signature = { png: Buffer; bytes: number; sha256: string; width: number; height: number };

// A PNG's own first bytes and shape, or the reason it isn't one.
export function checkPng(png: Buffer): { width: number; height: number } | { error: string } {
  if (png.length < 8 + 25 + 12) return { error: "too small" };
  if (png.length > LIMITS.signatureBytes) return { error: "too big" };
  if (!png.subarray(0, 8).equals(PNG_MAGIC)) return { error: "not a PNG" };
  if (png.readUInt32BE(8) !== 13 || png.subarray(12, 16).toString("latin1") !== "IHDR") return { error: "not a PNG" };
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (width < 1 || height < 1 || width > LIMITS.signatureSide || height > LIMITS.signatureSide) return { error: "odd size" };
  if (!png.subarray(png.length - 8).equals(IEND)) return { error: "cut short" };
  return { width, height };
}

// "data:image/png;base64,...." -> the checked PNG, or a refusal in plain words.
export function parseSignature(dataUrl: string, who: "client" | "Lobos"): Signature | { error: string } {
  const refuse = { error: who === "client" ? "The client's signature didn't come through - ask them to sign again." : "Your signature didn't come through - sign again." };
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) return refuse;
  const b64 = dataUrl.slice(prefix.length);
  // Base64 only (no spaces or anything else), and never more than the cap could hold.
  if (b64.length > Math.ceil((LIMITS.signatureBytes * 4) / 3) + 4) return { error: "That signature is too big - clear it and sign again." };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return refuse;
  const png = Buffer.from(b64, "base64");
  const ok = checkPng(png);
  if ("error" in ok) return ok.error === "too big" ? { error: "That signature is too big - clear it and sign again." } : refuse;
  return { png, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), ...ok };
}
