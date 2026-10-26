// Stage 5: photos / PDFs of tickets and compliance documents. Stored outside the app folder so a rebuild never
// touches them - COMPLIANCE_FILE_DIR (server: /srv/operations/compliance-files, nightly backup + off-site), or
// ../operations-compliance-files next to the app. Only the server reads them; accounts and Admins get one through
// GET /api/compliance/files/:id behind guardAccounts(). Never reachable from a site link.
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { contentMatches } from "../invoiceFiles";

const TYPES: Record<string, { ext: string; max: number }> = {
  "application/pdf": { ext: "pdf", max: 15 * 1024 * 1024 },
  "image/jpeg": { ext: "jpg", max: 10 * 1024 * 1024 },
  "image/png": { ext: "png", max: 10 * 1024 * 1024 },
  "image/webp": { ext: "webp", max: 10 * 1024 * 1024 },
};
const BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, t]) => [t.ext, mime]));
// webp isn't in invoiceFiles' content check; a RIFF header is enough here.
const looksRight = (ext: string, b: Buffer) => (ext === "webp" ? b.subarray(0, 4).toString("ascii") === "RIFF" : contentMatches(ext, b));

export function complianceFileDir() {
  return process.env.COMPLIANCE_FILE_DIR || path.resolve(process.cwd(), "..", "operations-compliance-files");
}

export async function saveComplianceFile(dataUrl: unknown, originalName: unknown): Promise<{ fileName: string; mime: string; size: number } | { error: string }> {
  if (typeof dataUrl !== "string" || typeof originalName !== "string" || !originalName.trim()) return { error: "No file was sent." };
  const m = dataUrl.match(/^data:([^;,]*)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return { error: "That file couldn't be read." };
  const ext0 = originalName.toLowerCase().split(".").pop() ?? "";
  const mime = TYPES[m[1]] ? m[1] : BY_EXT[ext0 === "jpeg" ? "jpg" : ext0];
  if (!mime) return { error: "Use a PDF or a photo (JPEG, PNG or WebP)." };
  const t = TYPES[mime];
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { error: "The file is empty." };
  if (bytes.length > t.max) return { error: `The file is too large (max ${Math.round(t.max / 1024 / 1024)} MB).` };
  if (!looksRight(t.ext, bytes)) return { error: `That file doesn't look like a real .${t.ext} - save it again and re-send.` };
  const fileName = `${Date.now()}-${randomBytes(8).toString("hex")}.${t.ext}`;
  await fs.mkdir(complianceFileDir(), { recursive: true });
  await fs.writeFile(path.join(complianceFileDir(), fileName), bytes);
  return { fileName, mime, size: bytes.length };
}

// Stored names are only ever ones saveComplianceFile made - refuse anything else so a name can never point
// outside the folder.
function safePath(fileName: string) {
  if (!/^\d+-[0-9a-f]{16}\.(pdf|jpg|png|webp)$/.test(fileName)) throw new Error("Bad compliance file name");
  return path.join(complianceFileDir(), fileName);
}

export async function readComplianceFile(fileName: string): Promise<Buffer> {
  return fs.readFile(safePath(fileName));
}
