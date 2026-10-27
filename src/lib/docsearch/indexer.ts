// LCI phase 6: one refresh of the index from a source. Incremental: a file is downloaded and re-read only when its
// etag (or its folder / level) changed. Only files in approved folders, never denied ones, are read at all. Files
// that have gone are removed - but only after a COMPLETE run, so a run stopped part-way (throttled, refused) never
// drops documents it simply didn't reach. Design §6.
import { FOLDERS, folderFor, revisionOf } from "./folders";
import { extOf, extractText, isSupported, MAX_FILE_BYTES } from "./extract";
import { finishRun, knownEtag, markSeen, putDoc, removeUnseen, startRun } from "./index";
import { SourceStop, type DocSource } from "./sources/types";
import { scrub } from "./graphSetup";

export type RunResult = { seen: number; added: number; updated: number; removed: number; unreadable: number; error: string | null; complete: boolean };

export async function refreshIndex(source: DocSource, approvedIds?: Set<string>): Promise<RunResult> {
  const run = startRun(source.name);
  const r: RunResult = { seen: 0, added: 0, updated: 0, removed: 0, unreadable: 0, error: null, complete: false };
  const folders = FOLDERS.filter((f) => (approvedIds ? approvedIds.has(f.id) : f.approved));
  try {
    for (const folder of folders) {
      for await (const file of source.listFiles(folder.pattern)) {
        const f = folderFor(file.path, approvedIds);
        if (!f) continue; // denied (or matched by no approved folder after all) - not read
        const id = `${source.name}:${file.id}`;
        r.seen++;
        const known = knownEtag(id);
        if (known && known.etag === file.etag && known.level === f.level && known.folder_id === f.id) { markSeen(id, run); continue; }
        const base = { id, folderId: f.id, folderLabel: f.label, level: f.level, name: file.name, path: file.path, webUrl: file.webUrl, modified: file.modified, revision: revisionOf(file.name), etag: file.etag, size: file.size, ext: extOf(file.name) };
        let ex: Awaited<ReturnType<typeof extractText>>;
        if (!isSupported(file.name)) ex = { status: "UNSUPPORTED", text: "", why: `.${extOf(file.name) || "?"} files aren't read` };
        else if (file.size > MAX_FILE_BYTES) ex = { status: "TOO_BIG", text: "", why: "over 25 MB" };
        else {
          try {
            ex = await extractText(file.name, await source.download(file));
          } catch (e) {
            if (e instanceof SourceStop) throw e;
            ex = { status: "UNREADABLE", text: "", why: "couldn't be downloaded" };
          }
        }
        if (ex.status !== "OK") r.unreadable++;
        const what = putDoc({ ...base, status: ex.status, why: ex.status === "OK" ? null : ex.why, text: ex.text }, run);
        r[what]++;
      }
    }
    r.removed = removeUnseen(source.name, run);
    r.complete = true;
  } catch (e) {
    r.error = scrub(e instanceof Error ? e.message : "the refresh failed");
  }
  finishRun(run, r);
  return r;
}
