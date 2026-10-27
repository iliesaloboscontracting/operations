// LCI phase 6: where documents come from. GraphSource reads SharePoint (read-only, the real one); LocalFolderSource
// reads a local folder that mirrors the SharePoint paths (tests only - refused in production).
export type SourceFile = {
  id: string; // stable within the source (Graph item id / relative path)
  name: string;
  path: string; // below the library root, e.g. "01_Projects - Live/26_161 - X/22_001_09_HSE & Site Management/04_SWMS/a.pdf"
  webUrl: string | null; // opens the document (SharePoint re-checks the user's own permissions)
  modified: string; // ISO
  etag: string; // changes when the content changes
  size: number;
};

export interface DocSource {
  readonly name: "graph" | "local";
  // Every file under a folder pattern ("*" = any one folder name), recursively.
  listFiles(pattern: string): AsyncIterable<SourceFile>;
  download(file: SourceFile): Promise<Buffer>;
}

export class SourceStop extends Error {} // stop the whole run (throttled, refused permissions) - next night carries on
