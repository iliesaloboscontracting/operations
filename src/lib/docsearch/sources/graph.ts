// LCI phase 6: GraphSource - the only code that calls Microsoft Graph. Read-only: a client-credentials token (POST to
// login.microsoftonline.com), then GETs to graph.microsoft.com; a file's bytes come from the 302 Graph gives, to a
// pre-signed URL on the tenant's SharePoint host (no Authorization header sent there). Every URL is checked against
// graphSetup's allowlist before fetch, each call times out after 20 s, redirects are never followed automatically,
// and errors are scrubbed. The fetch is passed in so tests never reach Microsoft. Design §5.
import { allowedApiHost, allowedDownloadHost, rolesProblem, scrub, tokenRoles, type GraphSetup } from "../graphSetup";
import { LIBRARY_ROOT } from "../folders";
import { MAX_FILE_BYTES } from "../extract";
import { SourceStop, type DocSource, type SourceFile } from "./types";

type Ok = Extract<GraphSetup, { ok: true }>;
export type GFetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; redirect: "manual"; signal: AbortSignal }) =>
  Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; body?: ReadableStream<Uint8Array> | null }>;
const TIMEOUT_MS = 20_000;
const G = "https://graph.microsoft.com/v1.0";

type Item = { id: string; name: string; size?: number; webUrl?: string; eTag?: string; lastModifiedDateTime?: string; folder?: unknown; file?: unknown };

export class GraphSource implements DocSource {
  readonly name = "graph" as const;
  private token: { value: string; until: number } | null = null;
  private driveId: string | null = null;
  constructor(private s: Ok, private f: GFetch) {}

  private secrets() { return [this.s.clientSecret, this.token?.value]; }

  private async call(url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) {
    if (!allowedApiHost(url)) throw new SourceStop("Refused: not a Microsoft address this app may call.");
    if (init.method === "POST" && !url.startsWith("https://login.microsoftonline.com/")) throw new SourceStop("Refused: the app only reads from SharePoint.");
    try {
      return await this.f(url, { method: init.method, headers: init.headers ?? {}, body: init.body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new SourceStop(scrub(`Microsoft didn't answer (${(e as Error).name === "TimeoutError" ? "timed out" : "no connection"}).`, this.secrets()));
    }
  }

  private async getToken() {
    if (this.token && this.token.until > Date.now() + 60_000) return this.token.value;
    const res = await this.call(`https://login.microsoftonline.com/${encodeURIComponent(this.s.tenantId)}/oauth2/v2.0/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.s.clientId, client_secret: this.s.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
    });
    const text = await res.text().catch(() => "");
    let j: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
    try { j = JSON.parse(text); } catch { /* not JSON */ }
    if (res.status !== 200 || !j.access_token) throw new SourceStop(scrub(`Microsoft refused the app's sign-in: ${j.error ?? `HTTP ${res.status}`}`, this.secrets()));
    const problem = rolesProblem(tokenRoles(j.access_token));
    if (problem) throw new SourceStop(problem);
    this.token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3000) * 1000 };
    return this.token.value;
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await this.call(url, { method: "GET", headers: { Authorization: `Bearer ${await this.getToken()}`, Accept: "application/json" } });
    if (res.status === 429 || res.status === 503) throw new SourceStop("Microsoft asked us to slow down - the rest is read next night.");
    const text = await res.text().catch(() => "");
    if (res.status === 404) return null as T;
    if (res.status < 200 || res.status >= 300) throw new SourceStop(scrub(`Microsoft said: HTTP ${res.status} ${text.slice(0, 120)}`, this.secrets()));
    return JSON.parse(text) as T;
  }

  private async drive() {
    if (this.driveId) return this.driveId;
    const site = await this.getJson<{ id: string } | null>(`${G}/sites/${this.s.site}`);
    if (!site) throw new SourceStop("The SharePoint site wasn't found - check GRAPH_SITE and that the app was granted it.");
    const d = await this.getJson<{ id: string } | null>(`${G}/sites/${encodeURIComponent(site.id)}/drive`);
    if (!d) throw new SourceStop("The site's document library wasn't found.");
    return (this.driveId = d.id);
  }

  private async *children(relPath: string): AsyncIterable<Item> {
    const encoded = [LIBRARY_ROOT, ...relPath.split("/").filter(Boolean)].map(encodeURIComponent).join("/");
    let url: string | undefined = `${G}/drives/${encodeURIComponent(await this.drive())}/root:/${encoded}:/children?$top=200&$select=id,name,size,webUrl,eTag,lastModifiedDateTime,folder,file`;
    while (url) {
      const page: { value: Item[]; "@odata.nextLink"?: string } | null = await this.getJson(url);
      if (!page) return;
      yield* page.value;
      url = page["@odata.nextLink"];
    }
  }

  private async *walk(relPath: string, depth: number): AsyncIterable<SourceFile> {
    if (depth > 8) return;
    for await (const it of this.children(relPath)) {
      const p = `${relPath}/${it.name}`;
      if (it.folder) yield* this.walk(p, depth + 1);
      else if (it.file) yield { id: it.id, name: it.name, path: p, webUrl: it.webUrl ?? null, modified: it.lastModifiedDateTime ?? "", etag: it.eTag ?? it.lastModifiedDateTime ?? "", size: it.size ?? 0 };
    }
  }

  // Expand "*" segments by listing the parent's folders, then walk each match.
  async *listFiles(pattern: string): AsyncIterable<SourceFile> {
    const segs = pattern.split("/");
    const expand = async function* (this: GraphSource, prefix: string, i: number): AsyncIterable<SourceFile> {
      if (i === segs.length) { yield* this.walk(prefix, 0); return; }
      if (segs[i] !== "*") { yield* expand.call(this, prefix ? `${prefix}/${segs[i]}` : segs[i], i + 1); return; }
      for await (const it of this.children(prefix)) if (it.folder) yield* expand.call(this, `${prefix}/${it.name}`, i + 1);
    };
    yield* expand.call(this, "", 0);
  }

  async download(file: SourceFile) {
    if (file.size > MAX_FILE_BYTES) throw new Error("too big");
    const res = await this.call(`${G}/drives/${encodeURIComponent(await this.drive())}/items/${encodeURIComponent(file.id)}/content`, { method: "GET", headers: { Authorization: `Bearer ${await this.getToken()}` } });
    if (res.status === 429 || res.status === 503) throw new SourceStop("Microsoft asked us to slow down - the rest is read next night.");
    const loc = res.headers.get("location");
    if (res.status !== 302 || !loc || !allowedDownloadHost(loc, this.s.siteHost)) throw new Error(scrub(`download refused (HTTP ${res.status})`, this.secrets()));
    // DS-015: the bytes are streamed and the download is cut off the moment it passes 25 MB, whatever the listing
    // said - never buffered whole first.
    const stop = new AbortController();
    let bytes: Awaited<ReturnType<GFetch>>;
    try {
      // The pre-signed URL carries its own short-lived permission: no Authorization header goes to it.
      bytes = await this.f(loc, { method: "GET", headers: {}, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), stop.signal]) });
    } catch {
      throw new Error("download timed out");
    }
    if (bytes.status !== 200) throw new Error(`download failed (HTTP ${bytes.status})`);
    return readCapped(bytes, MAX_FILE_BYTES, stop);
  }
}

// Read a response body up to `cap` bytes: refused at once by its Content-Length, or cut off (and the request aborted)
// as soon as the running total passes the cap. A response with no stream falls back to arrayBuffer, still checked.
export async function readCapped(res: { headers: { get(n: string): string | null }; arrayBuffer(): Promise<ArrayBuffer>; body?: ReadableStream<Uint8Array> | null }, cap: number, stop?: AbortController): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > cap) { stop?.abort(); throw new Error("too big"); }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cap) throw new Error("too big");
    return buf;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { await reader.cancel().catch(() => undefined); stop?.abort(); throw new Error("too big"); }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export const realGraphFetch: GFetch = (url, init) => fetch(url, { ...init, cache: "no-store" });
