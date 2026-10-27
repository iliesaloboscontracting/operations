import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { deflateRawSync } from "zlib";
import ExcelJS from "exceljs";
import { FOLDERS, denied, folderFor, levelsFor, revisionOf, underPattern, canSearch } from "./folders";
import { MARK_CLOSE, MARK_OPEN, snippetParts, toFtsQuery } from "./query";
import { docxText, zipEntry } from "./zip";
import { extractText } from "./extract";
import { allowedApiHost, allowedDownloadHost, graphSetup, rolesProblem, scrub, tokenRoles } from "./graphSetup";
import { GraphSource, type GFetch } from "./sources/graph";
import { SourceStop } from "./sources/types";

const SWMS = "01_Projects - Live/26_161 - Test Job/22_001_09_HSE & Site Management/04_SWMS/SWMS Night Works Rev C.pdf";
const CONTRACT = "01_Projects - Live/26_161 - Test Job/22_001_05_Contract/Subcontract.pdf";
const PAYROLL = "01_Projects - Live/26_161 - Test Job/22_001_14_Timesheets & Payroll/week 12.xlsx";
const ALL = new Set(FOLDERS.map((f) => f.id));

// ---------- folders and roles ----------
test("a folder pattern matches its folder and everything under it, '*' = any one folder", () => {
  assert.ok(underPattern(SWMS, "01_Projects - Live/*/22_001_09_HSE & Site Management/04_SWMS"));
  assert.ok(!underPattern("01_Projects - Live/26_161/22_001_05_Contract/x.pdf", "01_Projects - Live/*/22_001_09_HSE & Site Management/04_SWMS"));
  assert.ok(!underPattern("01_Projects - Live", "01_Projects - Live/*/22_001_05_Contract"), "a parent isn't inside");
});

test("nothing is read until a folder is approved (every draft ships approved: false)", () => {
  assert.ok(FOLDERS.every((f) => !f.approved));
  assert.equal(folderFor(SWMS), null);
  assert.equal(folderFor(SWMS, ALL)?.id, "proj-swms");
});

test("the deny list wins - HR, payroll, finance, legal, contact lists, incident reports, passwords", () => {
  assert.equal(folderFor(PAYROLL, ALL), null);
  for (const p of ["05_Employment & HR/x.pdf", "08_Finance/x.pdf", "09_Legal/x.docx", "01_Projects - Live/J/22_001_02_Contact Lists/list.xlsx",
    "01_Projects - Live/J/22_001_09_HSE & Site Management/06_Incident Report/r.pdf", "12. CLAUDE/notes.md", "Passwords sheet - Victoria .xlsx",
    "01_Projects - Live/J/22_001_09_HSE & Site Management/04_SWMS/worker TFN form.pdf"]) assert.ok(denied(p), p);
  assert.ok(!denied(SWMS));
  assert.ok(!denied("01_Projects - Live/J/22_001_09_HSE & Site Management/04_SWMS/Supervisor SWMS.pdf"), "supervisor isn't 'super'");
});

test("each role sees only its levels", () => {
  assert.deepEqual(levelsFor({ role: "ADMIN" }), ["MANAGER", "COMMERCIAL"]);
  assert.deepEqual(levelsFor({ role: "MANAGER" }), ["MANAGER"]);
  assert.deepEqual(levelsFor({ role: "MANAGER", directorAccess: true }), ["MANAGER", "COMMERCIAL"]);
  for (const role of ["VIEWER", "TIMESHEETS", "DIRECTOR", "ACCOUNTS"]) {
    assert.deepEqual(levelsFor({ role, directorAccess: true }), [], role);
    assert.equal(canSearch({ role }), false, role);
  }
  assert.equal(folderFor(CONTRACT, ALL)?.level, "COMMERCIAL");
  assert.equal(folderFor(SWMS, ALL)?.level, "MANAGER");
});

test("revision from the file name", () => {
  assert.equal(revisionOf("SWMS Night Works Rev C.pdf"), "Rev C");
  assert.equal(revisionOf("Scope_rev.2.docx"), "Rev 2");
  assert.equal(revisionOf("Drawing A101 R3.pdf"), "Rev 3");
  assert.equal(revisionOf("Programme v4.xlsx"), "v4");
  assert.equal(revisionOf("Revised scope.pdf"), null);
  assert.equal(revisionOf("Contract.pdf"), null);
});

// ---------- query ----------
test("what people type never becomes FTS syntax", () => {
  assert.equal(toFtsQuery("night works"), '"night" AND "works"*');
  // Operators and column filters become plain quoted words; single letters are dropped.
  assert.equal(toFtsQuery('name:secret OR "x" NEAR(a b)'), '"name" AND "secret" AND "OR" AND "NEAR"*');
  assert.equal(toFtsQuery("  ** -- "), null);
  assert.ok(toFtsQuery("a".repeat(500))!.length < 60);
  const parts = snippetParts(`All ${MARK_OPEN}night${MARK_CLOSE} work`);
  assert.deepEqual(parts, [{ text: "All ", hit: false }, { text: "night", hit: true }, { text: " work", hit: false }]);
});

// ---------- extractors ----------
function makeZip(files: Record<string, string>) {
  const locals: Buffer[] = [], cens: Buffer[] = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content)), n = Buffer.from(name);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(content.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(content.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(off, 42);
    locals.push(loc, n, data); cens.push(cen, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(cens), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const DOCX = makeZip({ "[Content_Types].xml": "<x/>", "word/document.xml": '<w:document><w:body><w:p><w:r><w:t>Hoarding &amp; scaffold</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">The principal provides the </w:t></w:r><w:r><w:t>hoarding along the frontage.</w:t></w:r></w:p></w:body></w:document>' });

test("Word .docx text through the built-in zip reader", async () => {
  assert.equal(docxText(DOCX), "Hoarding & scaffold\nThe principal provides the hoarding along the frontage.");
  assert.equal(zipEntry(DOCX, "nope.xml"), null);
  assert.equal(zipEntry(Buffer.from("not a zip at all"), "word/document.xml"), null);
  const r = await extractText("Scope.docx", DOCX);
  assert.equal(r.status, "OK");
});

test("a zip claiming a huge expanded size is refused (zip bomb)", () => {
  const z = makeZip({ "word/document.xml": "<w:p/>" });
  const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  z.writeUInt32LE(900 * 1024 * 1024, cd + 24);
  assert.equal(zipEntry(z, "word/document.xml"), null);
});

test("Excel .xlsx text, sheet by sheet", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Plant");
  ws.addRow(["Item", "Note"]); ws.addRow(["Excavator 5.5t", "needs a spotter at night"]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const r = await extractText("Register.xlsx", buf);
  assert.equal(r.status, "OK");
  assert.match(r.text, /# Plant/);
  assert.match(r.text, /Excavator 5\.5t \| needs a spotter at night/);
});

const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 66>>stream
BT /F1 12 Tf 20 50 Td (Night works need a spotter and a lighting plan) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
test("PDF text through unpdf; scans and junk are 'not readable', not guessed", async () => {
  const r = await extractText("SWMS.pdf", Buffer.from(PDF));
  assert.equal(r.status, "OK");
  assert.match(r.text, /Night works need a spotter/);
  assert.equal((await extractText("scan.pdf", Buffer.from("%PDF-1.4 garbage"))).status, "UNREADABLE");
  assert.equal((await extractText("photo.jpg", Buffer.from("x"))).status, "UNSUPPORTED");
  assert.equal((await extractText("old.doc", Buffer.from("x"))).status, "UNSUPPORTED");
});

// ---------- the index: each role sees only its folders ----------
test("search returns only the levels a role may see (filter in SQL)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "docidx-"));
  process.env.SEARCH_INDEX_PATH = path.join(dir, "search.db");
  const idx = await import("./index");
  try {
    const run = idx.startRun("test");
    const row = (id: string, p: string, text: string) => {
      const f = folderFor(p, ALL)!;
      idx.putDoc({ id: `test:${id}`, folderId: f.id, folderLabel: f.label, level: f.level, name: p.split("/").pop()!, path: p, webUrl: null, modified: "2026-10-01", revision: null, etag: "1", size: 1, ext: "pdf", status: "OK", why: null, text }, run);
    };
    row("swms", SWMS, "Night works need a spotter and a lighting plan.");
    row("contract", CONTRACT, "The principal provides the hoarding and a night works allowance.");
    const asRole = (u: { role: string; directorAccess?: boolean }) => idx.search("night works", levelsFor(u)).hits.map((h) => h.id).sort();
    assert.deepEqual(asRole({ role: "ADMIN" }), ["test:contract", "test:swms"]);
    assert.deepEqual(asRole({ role: "MANAGER" }), ["test:swms"], "a Manager never sees contracts");
    assert.deepEqual(asRole({ role: "MANAGER", directorAccess: true }), ["test:contract", "test:swms"]);
    for (const role of ["VIEWER", "TIMESHEETS", "DIRECTOR", "ACCOUNTS"]) assert.deepEqual(asRole({ role }), [], role);
    assert.match(idx.search("spotters", ["MANAGER"]).hits[0].snippet, /spotter/, "stemming: spotters finds spotter");
    assert.equal(idx.status(["MANAGER"]).documents, 1, "status counts only what this login may see");
    // A complete run that no longer sees the contract removes it.
    const run2 = idx.startRun("test");
    idx.markSeen("test:swms", run2);
    assert.equal(idx.removeUnseen("test", run2), 1);
    assert.deepEqual(idx.search("night", ["MANAGER", "COMMERCIAL"]).hits.map((h) => h.id), ["test:swms"]);
  } finally {
    idx.closeIndex();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the index refuses to live under prisma/", async () => {
  const idx = await import("./index");
  assert.throws(() => idx.openIndex(path.join(tmpdir(), "x", "prisma", "search.db")), /outside prisma/);
});

// ---------- Microsoft Graph: off, hosts, permissions, scrubbing ----------
test("Graph is OFF unless all three settings are set", () => {
  assert.equal(graphSetup({}).ok, false);
  assert.equal(graphSetup({ GRAPH_TENANT_ID: "11111111-1111-1111-1111-111111111111", GRAPH_CLIENT_ID: "x" }).ok, false);
  const s = graphSetup({ GRAPH_TENANT_ID: "11111111-1111-1111-1111-111111111111", GRAPH_CLIENT_ID: "app", GRAPH_CLIENT_SECRET: "s3cret-value" });
  assert.ok(s.ok && s.siteHost === "lobosdemolition.sharepoint.com");
  assert.equal(graphSetup({ GRAPH_TENANT_ID: "11111111-1111-1111-1111-111111111111", GRAPH_CLIENT_ID: "a", GRAPH_CLIENT_SECRET: "b", GRAPH_SITE: "evil.com:/sites/x" }).ok, false);
});

test("only Microsoft's two hosts, and the tenant's SharePoint host for a pre-signed download", () => {
  assert.ok(allowedApiHost("https://graph.microsoft.com/v1.0/sites"));
  assert.ok(allowedApiHost("https://login.microsoftonline.com/t/oauth2/v2.0/token"));
  for (const u of ["http://graph.microsoft.com/x", "https://graph.microsoft.com.evil.com/x", "https://user:pw@graph.microsoft.com/x", "https://graph.microsoft.com:8443/x", "https://example.com"]) assert.ok(!allowedApiHost(u), u);
  assert.ok(allowedDownloadHost("https://lobosdemolition.sharepoint.com/_layouts/15/download.aspx?tempauth=x", "lobosdemolition.sharepoint.com"));
  assert.ok(!allowedDownloadHost("https://other.sharepoint.com/x", "lobosdemolition.sharepoint.com"));
});

const jwt = (roles: string[]) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ roles })).toString("base64url")}.sig`;
test("refuses to run with any permission beyond Sites.Selected", () => {
  assert.equal(rolesProblem(tokenRoles(jwt(["Sites.Selected"]))), null);
  for (const r of [["Sites.Read.All"], ["Sites.Selected", "Files.ReadWrite.All"], ["Sites.FullControl.All"], ["Sites.Manage.All"], []]) assert.ok(rolesProblem(r), r.join());
  assert.ok(rolesProblem(tokenRoles("not-a-token")));
});

test("errors never carry a secret or a token", () => {
  const t = scrub(`failed client_secret=abcdef123 Bearer ${jwt(["x"])} https://x.sharepoint.com/d?tempauth=SECRETVALUE`, ["abcdef123"]);
  assert.ok(!/abcdef123|SECRETVALUE|eyJ/.test(t), t);
});

test("GraphSource: token roles checked, GETs only, download goes to the pre-signed URL without the token", async () => {
  const s = graphSetup({ GRAPH_TENANT_ID: "11111111-1111-1111-1111-111111111111", GRAPH_CLIENT_ID: "app", GRAPH_CLIENT_SECRET: "s3cret-value" });
  assert.ok(s.ok);
  const calls: { url: string; method: string; auth?: string }[] = [];
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => JSON.stringify(body), arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer as ArrayBuffer });
  const mk = (roles: string[]): GFetch => async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    if (url.includes("/oauth2/v2.0/token")) return res(200, { access_token: jwt(roles), expires_in: 3600 });
    if (url.endsWith("/sites/lobosdemolition.sharepoint.com:/sites/Management")) return res(200, { id: "site1" });
    if (url.endsWith("/sites/site1/drive")) return res(200, { id: "drive1" });
    if (url.includes("/children")) return res(200, { value: [{ id: "f1", name: "SWMS Rev A.pdf", size: 10, webUrl: "https://lobosdemolition.sharepoint.com/x", eTag: "e1", lastModifiedDateTime: "2026-10-01T00:00:00Z", file: {} }] });
    if (url.includes("/content")) return res(302, "", { location: "https://lobosdemolition.sharepoint.com/_layouts/15/download.aspx?tempauth=abc" });
    if (url.startsWith("https://lobosdemolition.sharepoint.com/")) return res(200, "PDFBYTES");
    return res(404, {});
  };
  const good = new GraphSource(s, mk(["Sites.Selected"]));
  const files = [];
  for await (const f of good.listFiles("03_General/Methodologies")) files.push(f);
  assert.equal(files.length, 1);
  assert.equal((await good.download(files[0])).toString(), "PDFBYTES");
  const dl = calls.find((c) => c.url.startsWith("https://lobosdemolition.sharepoint.com/"))!;
  assert.equal(dl.auth, undefined, "no token sent to the pre-signed URL");
  assert.ok(calls.every((c) => c.method === "GET" || c.url.includes("login.microsoftonline.com")), "only the token request is a POST");
  calls.length = 0;
  const bad = new GraphSource(s, mk(["Sites.Selected", "Sites.ReadWrite.All"]));
  await assert.rejects(async () => { for await (const _ of bad.listFiles("03_General")) { /* nothing */ } }, (e: unknown) => e instanceof SourceStop && /ReadWrite/.test((e as Error).message));
  assert.ok(!calls.some((c) => c.url.includes("graph.microsoft.com")), "nothing read from Graph with a write permission");
});
