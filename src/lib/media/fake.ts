// Large uploads (10 Nov 2026) - a LOCAL stand-in for the bucket, for `next dev` and the release check (MEDIA_STORE=fake,
// MEDIA_FAKE_DIR=<a folder>). It does what the protocol needs from the real one - signed PUT / part / GET addresses,
// multipart (create / list / complete / abort), HEAD, ranged GET and versions - against that folder, through a tiny
// HTTP server on 127.0.0.1 (a random port, or MEDIA_FAKE_PORT) that this server process starts the first time it's
// needed. Nothing here ever leaves the machine. Signed addresses are HMAC'd with a key made fresh in this process and
// expire like the real ones; a PUT must send the Content-Type it was signed for and exactly the length (PS-043 - a
// bigger or smaller body is 403, as Lightsail does with a signed content-length). MEDIA_FAKE_VERSIONING=off makes it
// behave like a bucket with versioning off (HEAD gives no version - PS-045). Never deletes anything.
import http from "http";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { MediaStoreError, type HeadResult, type MediaStore, type UploadPartRef } from "./store";

type Grant = { op: "put" | "part" | "get"; key: string; exp: number; ct?: string; len?: number; uploadId?: string; n?: number; v?: string | null; dl?: string | null };
type ObjMeta = { contentType: string; versions: string[]; key?: string }; // newest last
const versioningOn = () => process.env.MEDIA_FAKE_VERSIONING !== "off";
type UploadMeta = { key: string; contentType: string; createdAt: number; state: "OPEN" | "DONE" | "ABORTED" };

const g = globalThis as unknown as { __mediaFake?: { secret: Buffer; server: http.Server | null; base: Promise<string> | null } };
const state = () => (g.__mediaFake ??= { secret: randomBytes(32), server: null, base: null });
const b64 = (x: string | Buffer) => Buffer.from(x).toString("base64url");
const keyDir = (root: string, key: string) => path.join(root, "objects", createHash("sha256").update(key).digest("hex"));
const uploadDir = (root: string, id: string) => {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new MediaStoreError("fake", "NO_UPLOAD");
  return path.join(root, "uploads", id);
};
const readJson = async <T>(f: string): Promise<T | null> => { try { return JSON.parse(await fsp.readFile(f, "utf8")) as T; } catch { return null; } };
const md5 = (b: Buffer) => `"${createHash("md5").update(b).digest("hex")}"`;

function sign(grant: Grant): string {
  const body = b64(JSON.stringify(grant));
  return `${body}.${b64(createHmac("sha256", state().secret).update(body).digest())}`;
}
function verify(token: string | null): Grant | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  // Compare the signature as written, not as decoded: a 32-byte MAC is 43 base64url characters whose last one carries
  // only 4 bits, so a decode-then-compare accepted a last character changed within its 2 discarded bits (S3 compares
  // the exact string too).
  const want = Buffer.from(b64(createHmac("sha256", state().secret).update(body).digest()));
  const got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const gr = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Grant;
    return gr.exp >= Date.now() ? gr : null;
  } catch { return null; }
}

export class FakeMediaStore implements MediaStore {
  readonly name = "fake" as const;
  constructor(private root: string) {}

  private async base(): Promise<string> {
    const s = state();
    if (!s.base) {
      s.base = new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => { this.serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); }); });
        server.on("error", reject);
        server.listen(Number(process.env.MEDIA_FAKE_PORT) || 0, "127.0.0.1", () => {
          const a = server.address();
          s.server = server;
          server.unref(); // never what keeps a process (or a test run) alive
          resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
        });
      });
    }
    return s.base;
  }

  private async putObject(key: string, contentType: string, bytes: Buffer): Promise<{ etag: string; versionId: string }> {
    const d = keyDir(this.root, key);
    await fsp.mkdir(d, { recursive: true });
    const meta = (await readJson<ObjMeta>(path.join(d, "meta.json"))) ?? { contentType, versions: [] };
    const versionId = `v${meta.versions.length + 1}-${randomBytes(4).toString("hex")}`;
    await fsp.writeFile(path.join(d, `${versionId}.bin`), bytes);
    meta.versions.push(versionId);
    meta.contentType = contentType;
    meta.key = key;
    await fsp.writeFile(path.join(d, "meta.json"), JSON.stringify(meta));
    return { etag: md5(bytes), versionId };
  }
  private async object(key: string, versionId: string | null): Promise<{ file: string; contentType: string; versionId: string } | null> {
    const d = keyDir(this.root, key);
    const meta = await readJson<ObjMeta>(path.join(d, "meta.json"));
    if (!meta?.versions.length) return null;
    const v = versionId ?? meta.versions[meta.versions.length - 1];
    if (!meta.versions.includes(v)) return null;
    return { file: path.join(d, `${v}.bin`), contentType: meta.contentType, versionId: v };
  }

  // The stub: PUT /o (whole object), PUT /p (a part), GET /o (a version, Range allowed), OPTIONS (CORS) - each only
  // with a valid, unexpired signed grant for exactly that key and method.
  private async serve(req: http.IncomingMessage, res: http.ServerResponse) {
    const origin = req.headers.origin;
    const cors: Record<string, string> = origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "ETag", Vary: "Origin" } : {};
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "PUT, GET, HEAD", "Access-Control-Allow-Headers": req.headers["access-control-request-headers"] ?? "*", "Access-Control-Max-Age": "600" });
      return void res.end();
    }
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const gr = verify(u.searchParams.get("t"));
    const deny = (code: number) => { res.writeHead(code, cors); res.end(); };
    if (!gr) return deny(403);
    if (req.method === "PUT" && (u.pathname === "/o" || u.pathname === "/p")) {
      // PS-043: the signed length - a declared length that differs is refused before reading, a body that differs after.
      if (gr.len == null || Number(req.headers["content-length"]) !== gr.len) { req.resume(); return deny(403); }
      const chunks: Buffer[] = [];
      let got = 0;
      for await (const c of req) { got += (c as Buffer).length; if (got <= gr.len) chunks.push(c as Buffer); } // past the length: drained, refused below
      const bytes = Buffer.concat(chunks);
      if (got !== gr.len) return deny(403);
      if (u.pathname === "/o") {
        if (gr.op !== "put" || (req.headers["content-type"] ?? "") !== gr.ct) return deny(403); // the type is part of the signature
        const { etag, versionId } = await this.putObject(gr.key, gr.ct!, bytes);
        res.writeHead(200, { ...cors, ETag: etag, "x-amz-version-id": versionId });
        return void res.end();
      }
      if (gr.op !== "part" || !gr.uploadId || !gr.n) return deny(403);
      const dir = uploadDir(this.root, gr.uploadId);
      const meta = await readJson<UploadMeta>(path.join(dir, "meta.json"));
      if (!meta || meta.state !== "OPEN" || meta.key !== gr.key) return deny(404);
      await fsp.writeFile(path.join(dir, `part-${gr.n}.bin`), bytes);
      res.writeHead(200, { ...cors, ETag: md5(bytes) });
      return void res.end();
    }
    if ((req.method === "GET" || req.method === "HEAD") && u.pathname === "/o" && gr.op === "get") {
      const o = await this.object(gr.key, gr.v ?? null);
      if (!o) return deny(404);
      const size = (await fsp.stat(o.file)).size;
      const headers: Record<string, string> = {
        ...cors, "Content-Type": gr.ct ?? o.contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300",
        "Content-Disposition": gr.dl ? `attachment; filename="${gr.dl}"` : "inline",
      };
      const m = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
      if (m) {
        const start = Number(m[1]), end = Math.min(size - 1, m[2] ? Number(m[2]) : size - 1);
        if (start > end) { res.writeHead(416, cors); return void res.end(); }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) });
        if (req.method === "HEAD") return void res.end();
        return void fs.createReadStream(o.file, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, "Content-Length": String(size) });
      if (req.method === "HEAD") return void res.end();
      return void fs.createReadStream(o.file).pipe(res);
    }
    deny(405);
  }

  async presignPut(key: string, mime: string, bytes: number, ttlSec: number) {
    return `${await this.base()}/o?t=${sign({ op: "put", key, ct: mime, len: bytes, exp: Date.now() + ttlSec * 1000 })}`;
  }
  async createMultipart(key: string, mime: string) {
    const id = randomBytes(16).toString("hex");
    const dir = uploadDir(this.root, id);
    await fsp.mkdir(dir, { recursive: true });
    const meta: UploadMeta = { key, contentType: mime, createdAt: Date.now(), state: "OPEN" };
    await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
    return id;
  }
  async presignPart(key: string, uploadId: string, n: number, bytes: number, ttlSec: number) {
    return `${await this.base()}/p?t=${sign({ op: "part", key, uploadId, n, len: bytes, exp: Date.now() + ttlSec * 1000 })}`;
  }
  private async openUpload(key: string, uploadId: string) {
    const dir = uploadDir(this.root, uploadId);
    const meta = await readJson<UploadMeta>(path.join(dir, "meta.json"));
    if (!meta || meta.key !== key || meta.state !== "OPEN") throw new MediaStoreError("fake", "NO_UPLOAD");
    return { dir, meta };
  }
  async listParts(key: string, uploadId: string): Promise<UploadPartRef[]> {
    const { dir } = await this.openUpload(key, uploadId);
    const out: UploadPartRef[] = [];
    for (const f of await fsp.readdir(dir)) {
      const m = /^part-(\d+)\.bin$/.exec(f);
      if (!m) continue;
      const bytes = await fsp.readFile(path.join(dir, f));
      out.push({ n: Number(m[1]), etag: md5(bytes), size: bytes.length });
    }
    return out.sort((a, b) => a.n - b.n);
  }
  async completeMultipart(key: string, uploadId: string, parts: UploadPartRef[]) {
    const { dir, meta } = await this.openUpload(key, uploadId);
    const bufs: Buffer[] = [];
    for (const p of [...parts].sort((a, b) => a.n - b.n)) {
      const bytes = await fsp.readFile(path.join(dir, `part-${p.n}.bin`)).catch(() => null);
      if (!bytes || md5(bytes) !== p.etag) throw new MediaStoreError("completeMultipart", "InvalidPart");
      bufs.push(bytes);
    }
    await this.putObject(key, meta.contentType, Buffer.concat(bufs));
    await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify({ ...meta, state: "DONE" }));
  }
  async abortMultipart(key: string, uploadId: string) {
    const { dir, meta } = await this.openUpload(key, uploadId);
    await fsp.writeFile(path.join(dir, "meta.json"), JSON.stringify({ ...meta, state: "ABORTED" })); // the parts stay on disk (a fake)
  }
  async head(key: string): Promise<HeadResult | null> {
    const o = await this.object(key, null);
    if (!o) return null;
    return { size: (await fsp.stat(o.file)).size, contentType: o.contentType, versionId: versioningOn() ? o.versionId : null };
  }
  async getRange(key: string, versionId: string | null, start: number, end: number) {
    const o = await this.object(key, versionId);
    if (!o) throw new MediaStoreError("getRange", "NotFound");
    const fh = await fsp.open(o.file, "r");
    try {
      const size = (await fh.stat()).size;
      const last = Math.min(end, size - 1);
      if (last < start) return new Uint8Array(0);
      const buf = Buffer.alloc(last - start + 1);
      await fh.read(buf, 0, buf.length, start);
      return new Uint8Array(buf);
    } finally { await fh.close(); }
  }
  async listVersions() {
    const out: { key: string; versionId: string | null; size: number }[] = [];
    const dir = path.join(this.root, "objects");
    for (const d of await fsp.readdir(dir).catch(() => [] as string[])) {
      const meta = await readJson<ObjMeta>(path.join(dir, d, "meta.json"));
      if (!meta?.key) continue;
      for (const v of meta.versions) out.push({ key: meta.key, versionId: v, size: (await fsp.stat(path.join(dir, d, `${v}.bin`))).size });
    }
    return out;
  }
  async listUploads() {
    const out: { key: string; uploadId: string; bytes: number }[] = [];
    const dir = path.join(this.root, "uploads");
    for (const id of await fsp.readdir(dir).catch(() => [] as string[])) {
      const meta = await readJson<UploadMeta>(path.join(dir, id, "meta.json"));
      if (!meta || meta.state !== "OPEN") continue;
      let bytes = 0;
      for (const f of await fsp.readdir(path.join(dir, id))) if (/^part-\d+\.bin$/.test(f)) bytes += (await fsp.stat(path.join(dir, id, f))).size;
      out.push({ key: meta.key, uploadId: id, bytes });
    }
    return out;
  }
  async presignGet(key: string, versionId: string | null, ttlSec: number, o: { mime: string; download?: string | null }) {
    return `${await this.base()}/o?t=${sign({ op: "get", key, v: versionId, ct: o.mime, dl: o.download ? o.download.replace(/[^A-Za-z0-9._-]/g, "") : null, exp: Date.now() + ttlSec * 1000 })}`;
  }
}
