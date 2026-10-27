// LCI phase 6: LocalFolderSource - for tests only (D6-5). Reads a local folder laid out like the SharePoint library
// ("<root>/01_Projects - Live/<job>/22_001_09_HSE & Site Management/04_SWMS/x.pdf"). Never used in production.
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { underPattern } from "../folders";
import type { DocSource, SourceFile } from "./types";

export class LocalFolderSource implements DocSource {
  readonly name = "local" as const;
  constructor(private root: string) {
    if (process.env.NODE_ENV === "production") throw new Error("LocalFolderSource is for tests only.");
  }

  private async *walk(dir: string, rel: string, depth: number): AsyncIterable<SourceFile> {
    if (depth > 12) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const abs = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) yield* this.walk(abs, r, depth + 1);
      else if (e.isFile()) {
        const st = await fs.stat(abs);
        yield { id: r, name: e.name, path: r, webUrl: null, modified: st.mtime.toISOString(), etag: createHash("sha1").update(`${st.size}:${st.mtimeMs}`).digest("hex"), size: st.size };
      }
    }
  }

  async *listFiles(pattern: string): AsyncIterable<SourceFile> {
    for await (const f of this.walk(this.root, "", 0)) {
      const folder = f.path.split("/").slice(0, -1).join("/");
      if (underPattern(folder, pattern)) yield f;
    }
  }

  async download(file: SourceFile) {
    const abs = path.resolve(this.root, file.path);
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) throw new Error("outside the test folder");
    return fs.readFile(abs);
  }
}
