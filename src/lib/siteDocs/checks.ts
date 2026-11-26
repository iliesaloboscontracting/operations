// Site documents - the checks that read bytes (server only: Buffer, crypto). The plain rules are ./rules.ts.
import { createHash } from "crypto";
import { checkPng, logSignature } from "../variations/signature";
import { FILE_TYPES, LIMITS, line, type FileKind } from "./rules";

type Err = { error: string };
export type Signature = { png: Buffer; bytes: number; sha256: string };
// A finger signature from the phone ("data:image/png;base64,..."), checked by its own bytes with the variation
// docket's checks (lib/variations/signature.ts checkPng - the chunk walk, CRCs, no text chunks, 200 KB cap).
export function readSignature(dataUrl: unknown, who: string): Signature | { error: string } {
  const refuse = { error: `${who}: the signature didn't come through - sign again.` };
  const prefix = "data:image/png;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) return { error: `${who}: sign in the white box first.` };
  const b64 = dataUrl.slice(prefix.length);
  if (b64.length > Math.ceil((LIMITS.signatureBytes * 4) / 3) + 4) return { error: `${who}: that signature is too big - clear it and sign again.` };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) { logSignature("site documents", "refused: not clean base64"); return refuse; }
  const raw = Buffer.from(b64, "base64");
  const ok = checkPng(raw);
  if ("error" in ok) { logSignature("site documents", `refused: ${ok.error} (${raw.length} bytes)`); return ok.error === "too big" ? { error: `${who}: that signature is too big - clear it and sign again.` } : refuse; }
  if (ok.stripped.length) logSignature("site documents", `stripped ${ok.stripped.join(",")} (${raw.length} -> ${ok.png.length} bytes)`);
  const png = ok.png; // optional chunks the phone added (e.g. Safari's) are stripped - see checkPng
  return { png, bytes: png.length, sha256: createHash("sha256").update(png).digest("hex") };
}

// The file's own first bytes: a PDF ("%PDF-"), a JPEG (FF D8 FF) or a PNG (the 8-byte signature) - whatever its name says.
export function sniffFile(b: Buffer): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}
// An uploaded file (a data URL + its name) -> its bytes and type, or why not. The type is what the bytes are - the name
// and the data URL's label must agree with it; a SWMS or a topic is a PDF.
export function checkUpload(dataUrl: unknown, originalName: unknown, kind: FileKind): { bytes: Buffer; mime: string; ext: string; name: string } | Err {
  if (typeof dataUrl !== "string" || typeof originalName !== "string" || !originalName.trim()) return { error: "No file was sent." };
  const m = dataUrl.match(/^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: "That file couldn't be read." };
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) return { error: "The file is empty." };
  if (bytes.length > LIMITS.fileBytes) return { error: "Too large (7 MB per file) - make it smaller or split it." };
  const sniffed = sniffFile(bytes);
  if (!sniffed) return { error: "Use a PDF, a JPEG or a PNG - that file isn't one." };
  if (kind !== "PLAN" && sniffed !== "application/pdf") return { error: kind === "SWMS" ? "A SWMS is a PDF." : "The topic's file is a PDF." };
  const ext = FILE_TYPES[sniffed].ext;
  const nameExt = (originalName.toLowerCase().split(".").pop() ?? "").replace("jpeg", "jpg");
  const label = m[1].toLowerCase();
  if (label && label !== "application/octet-stream" && label !== sniffed && !(label === "image/jpg" && sniffed === "image/jpeg")) return { error: `That file is really a ${ext.toUpperCase()} - save it again and re-send.` };
  if (nameExt && nameExt !== ext && ["pdf", "jpg", "png"].includes(nameExt)) return { error: `That file is really a ${ext.toUpperCase()} - rename it and re-send.` };
  return { bytes, mime: sniffed, ext, name: line(originalName, 120) };
}
