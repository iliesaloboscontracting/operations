// LCI phase 6: just enough of a zip reader to take one file out of a .docx (or any zip), with Node's own zlib - no
// library. Reads the central directory (so data descriptors don't matter), stored (0) and deflated (8) entries only,
// and refuses anything that would expand past a limit (zip bombs). `npm test` (docsearch.test.ts).
import { inflateRawSync } from "zlib";

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;
const MAX_OUT = 50 * 1024 * 1024;

export function zipEntry(buf: Buffer, name: string): Buffer | null {
  // End of central directory: the last 22..65557 bytes.
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === EOCD) { e = i; break; }
  if (e < 0) return null;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== CEN) return null;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nlen);
    if (entryName === name) {
      if (usize > MAX_OUT || off + 30 > buf.length || buf.readUInt32LE(off) !== LOC) return null;
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_OUT });
      return null;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

// The text of a Word .docx: each paragraph on its own line, tabs and breaks kept as spaces / new lines.
export function docxText(buf: Buffer): string | null {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) return null;
  const s = xml.toString("utf8");
  return s
    .replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
