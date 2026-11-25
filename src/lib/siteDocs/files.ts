// The office's site document files (plans & drawings, SWMS versions, topic-of-the-week PDFs - 25 Nov 2026). Stored
// outside the app folder so a rebuild never touches them: SITE_DOC_FILE_DIR (server: /srv/operations/sitedoc-files -
// add it to the nightly backup and the off-site copy as sitedoc-files-<stamp>.tar.gz), or ../operations-sitedoc-files
// next to the app. Only the server reads them; a person gets one through an authorised route (the office's
// /api/site-documents/files/:id, or the link's own /api/site/:token/documents/files/:id) - never a public path.
// Nothing is ever deleted or overwritten (keep everything forever).
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export function siteDocFileDir() {
  return process.env.SITE_DOC_FILE_DIR || path.resolve(process.cwd(), "..", "operations-sitedoc-files");
}
export const newFileName = (ext: string) => `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
// Stored names are only ever ones newFileName made - anything else is refused, so a name can never point outside.
export const isStoredName = (fileName: string) => /^\d+-[0-9a-f]{16}\.(pdf|jpg|png)$/.test(fileName);
export async function writeSiteDocFile(fileName: string, bytes: Buffer): Promise<void> {
  if (!isStoredName(fileName)) throw new Error("Bad site document file name");
  await fs.mkdir(siteDocFileDir(), { recursive: true });
  await fs.writeFile(path.join(siteDocFileDir(), fileName), bytes, { flag: "wx" }); // never over an existing file
}
export async function readSiteDocFile(fileName: string): Promise<Buffer> {
  if (!isStoredName(fileName)) throw new Error("Bad site document file name");
  return fs.readFile(path.join(siteDocFileDir(), fileName));
}
