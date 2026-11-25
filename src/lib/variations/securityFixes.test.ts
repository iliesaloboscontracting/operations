// Variation dockets - the security fixes (Ilies approved VD-001..VD-006, 25 Nov 2026) and the status-filter bug fix.
// VD-001 only the sender corrects a docket, every correction shown; VD-002 the Building Agent login looks only;
// VD-003 the kill switch leaves the office working; VD-004 the PNG is walked chunk by chunk (CRC, allowlist, IEND at
// the very end) and two identical signatures are refused; VD-005 the record line under the client's pad. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_NO_STATUS, currentStatus, docketNo, isAgentEmail, replaceRefusal } from "./rules";
import { ALLOWED_CHUNKS, IDENTICAL_SIGNATURES, checkPng, crc32, identicalSignatures, parseSignature } from "./signature";
import { BUILDING_AGENT_EMAIL } from "../session";

// A real canvas signature: canvas.toDataURL("image/png") from Chrome 156 (25 Nov 2026), 48 x 16, white with a stroke.
const CHROME = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAABAElEQVR4AdSU0Q2DIBRFXzqIMziAMziAiziD/07iJM7gAK7Q9jS5BBpTqQJRE3L1AXIOUR7Pm18Pu/mVVGBZFqOV3JMkAkAPw2B1XbvGM/XcMqcEAAS0foOTgvXr6qOm/pR5SAAYgAUnoL7vbRxHa5pGpc8npbEaz3w34OTNXwIsLBhSawO+rquRXdfZNE02z3MRmSiBGHDJKKuqshIyPwWOgEvAz5wymwKpwH0J3aeWCQRygkvAzxQygYBOCS3CT6mfU7VcGSvTtm2A4ATYfV5Cb0lw1vtucOwdAJrjBJjE8VdqxwWwl3D5MhzP1DTPCVDwO3i+WtviCwSuBhzD8wIAAP//z7+xigAAAAZJREFUAwDlCsFw2LDIgQAAAABJRU5ErkJggg==";
const ONE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const buf = (b64: string) => Buffer.from(b64, "base64");
const err = (x: unknown) => (x && typeof x === "object" && "error" in x ? (x as { error: string }).error : null);
// One PNG chunk with its real CRC.
const chunk = (type: string, data: Buffer = Buffer.alloc(0)) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
// Put a chunk in just before IEND (the last 12 bytes).
const inject = (png: Buffer, c: Buffer) => Buffer.concat([png.subarray(0, png.length - 12), c, png.subarray(png.length - 12)]);
const chunksOf = (png: Buffer) => { const r = checkPng(png); return "chunks" in r ? r.chunks : r; };

// ---------- VD-004 ----------

test("VD-004: real canvas PNGs pass - Chrome's IHDR, IDAT x N, IEND; the CRC is the PNG / zlib one", () => {
  assert.deepEqual(chunksOf(buf(CHROME)), ["IHDR", "IDAT", "IDAT", "IEND"]);
  assert.deepEqual(chunksOf(buf(ONE)), ["IHDR", "IDAT", "IEND"]);
  assert.ok(!err(parseSignature(`data:image/png;base64,${CHROME}`, "client")));
  assert.equal(crc32(Buffer.from("IEND", "latin1")), 0xae426082, "IEND's well-known CRC");
  // Safari / ImageIO may add a colour profile, pHYs or iDOT - allowed; a palette PNG's PLTE / tRNS too.
  for (const t of ["sRGB", "gAMA", "pHYs", "iCCP", "cHRM", "iDOT", "tRNS"]) {
    assert.ok(ALLOWED_CHUNKS.includes(t), t);
    assert.ok(!err(checkPng(inject(buf(CHROME), chunk(t, Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 1]))))), `${t} is allowed`);
  }
});

test("VD-004: text, EXIF and unknown chunks, a bad CRC, no IDAT and anything after IEND are refused", () => {
  const png = buf(CHROME);
  for (const t of ["tEXt", "zTXt", "iTXt", "eXIf", "abCd", "evIL"]) assert.equal(err(checkPng(inject(png, chunk(t, Buffer.from("Comment\0<script>alert(1)</script>", "latin1"))))), `chunk ${t}`, t);
  const bad = Buffer.from(png); bad[45] ^= 0xff; // a byte inside the first IDAT's data (IHDR is bytes 8-32, the IDAT's data starts at 41)
  assert.equal(err(checkPng(bad)), "bad CRC");
  const ihdr = png.subarray(8, 8 + 25);
  assert.equal(err(checkPng(Buffer.concat([png.subarray(0, 8), ihdr, chunk("IEND")]))), "no image data");
  assert.equal(err(checkPng(Buffer.concat([png, Buffer.from("<html>")]))), "bytes after the end");
  assert.equal(err(checkPng(Buffer.concat([png, chunk("IDAT", Buffer.from([1]))]))), "bytes after the end", "another chunk after IEND");
  assert.equal(err(checkPng(png.subarray(0, png.length - 3))), "cut short");
  assert.equal(err(checkPng(Buffer.concat([png.subarray(0, 8), chunk("IDAT", Buffer.from([1])), ihdr, png.subarray(33)]))), "not a PNG", "IHDR must come first");
  assert.equal(err(checkPng(inject(png, ihdr))), "not a PNG", "a second IHDR");
  assert.equal(err(checkPng(Buffer.concat([png.subarray(0, png.length - 12), chunk("IEND", Buffer.from([0]))]))), "not a PNG", "IEND with data");
  // parseSignature turns every one of these into the plain "sign again" words.
  assert.match(err(parseSignature(`data:image/png;base64,${inject(png, chunk("tEXt", Buffer.from("x\0y"))).toString("base64")}`, "client")) ?? "", /sign again/);
});

test("VD-004: the client's and the supervisor's signatures can't be the same image", () => {
  const a = parseSignature(`data:image/png;base64,${CHROME}`, "client"), b = parseSignature(`data:image/png;base64,${ONE}`, "Lobos");
  assert.ok(!err(a) && !err(b));
  assert.equal(identicalSignatures(a as { sha256: string }, a as { sha256: string }), true);
  assert.equal(identicalSignatures(a as { sha256: string }, b as { sha256: string }), false);
  assert.match(IDENTICAL_SIGNATURES, /can't be identical/);
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /if \(identicalSignatures\(cust, lobos\)\) return \{ error: IDENTICAL_SIGNATURES, status: 400 \}/);
  const route = readFileSync(path.join(__dirname, "..", "..", "app", "api", "variations", "[id]", "signature", "[role]", "route.ts"), "utf8");
  assert.match(route, /"Content-Security-Policy": "default-src 'none'; sandbox"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
});

// ---------- VD-001 ----------

test("VD-001: only the person who sent a docket can correct it - same project, or the same job with no project", () => {
  const job = { id: "job1", projectId: "p1" };
  const mine = { number: 12, jobId: "job0", projectId: "p1", resourceId: "pol" };
  assert.equal(replaceRefusal(mine, job, "pol", 12), null, "the sender, same project (another day's job) - fine");
  assert.equal(replaceRefusal(mine, job, "sam", 12), "You can only correct a docket you sent. Ask the supervisor who sent V-0012, or the office.");
  assert.equal(replaceRefusal({ ...mine, resourceId: null }, job, "pol", 12), "You can only correct a docket you sent. Ask the supervisor who sent V-0012, or the office.");
  assert.equal(replaceRefusal(mine, job, null, 12), "You can only correct a docket you sent. Ask the supervisor who sent V-0012, or the office.");
  assert.equal(replaceRefusal({ ...mine, projectId: "p2" }, job, "pol", 12), "V-0012 isn't a docket on this job.");
  assert.equal(replaceRefusal(null, job, "pol", 99), "V-0099 isn't a docket on this job.");
  const noProject = { id: "job9", projectId: null };
  assert.equal(replaceRefusal({ ...mine, projectId: null, jobId: "job9" }, noProject, "pol", 12), null);
  assert.equal(replaceRefusal({ ...mine, projectId: null, jobId: "job8" }, noProject, "pol", 12), "V-0012 isn't a docket on this job.");
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /replaceRefusal\(r, job, link\.person\.id, p\.replaces\)/);
  assert.match(store, /select: \{ id: true, number: true, jobId: true, projectId: true, resourceId: true \}/);
  // Every correction is shown, not just the newest.
  assert.match(store, /async function correctionsOf\(/);
  assert.doesNotMatch(store, /the newest correction wins/);
  const page = readFileSync(path.join(__dirname, "..", "..", "app", "variations", "[id]", "page.tsx"), "utf8");
  assert.match(page, /d\.corrections\.map\(/);
  assert.equal(docketNo(15), "V-0015");
});

// ---------- VD-002 ----------

test("VD-002: the Building Agent login looks only - no status, no signature, no photo", () => {
  assert.ok(isAgentEmail(BUILDING_AGENT_EMAIL, BUILDING_AGENT_EMAIL));
  assert.ok(isAgentEmail(` ${BUILDING_AGENT_EMAIL.toUpperCase()} `, BUILDING_AGENT_EMAIL));
  assert.ok(!isAgentEmail("iliesa@loboscontracting.com.au", BUILDING_AGENT_EMAIL));
  assert.ok(!isAgentEmail(null, BUILDING_AGENT_EMAIL));
  assert.equal(AGENT_NO_STATUS, "The Building Agent login can't change a docket's status.");
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /if \(isAgent\(who\)\) return \{ error: AGENT_NO_STATUS, status: 403 \}/);
  assert.match(store, /canSetStatus: mayReadVariations\(who\.role\) && !agent/);
  assert.match(store, /photoIds: agent \? \[\] :/);
  const api = path.join(__dirname, "..", "..", "app", "api", "variations", "[id]");
  for (const f of [path.join(api, "signature", "[role]", "route.ts"), path.join(api, "photo", "[mediaId]", "route.ts")]) {
    assert.match(readFileSync(f, "utf8"), /if \(isAgent\(g\.user\)\) return NextResponse\.json\(\{ error: AGENT_NO_FILES \}, \{ status: 403 \}\)/, path.basename(path.dirname(f)));
  }
  const page = readFileSync(path.join(__dirname, "..", "..", "app", "variations", "[id]", "page.tsx"), "utf8");
  assert.match(page, /Signature hidden/);
});

// ---------- VD-003 / VD-005 ----------

test("VD-003: the kill switch is the link side and the alerts only - the office routes don't check it", () => {
  const rules = readFileSync(path.join(__dirname, "rules.ts"), "utf8");
  assert.match(rules, /The office still reads, prints and prices the dockets already sent/);
  const api = path.join(__dirname, "..", "..", "app", "api", "variations");
  for (const rel of ["route.ts", "[id]/route.ts", "[id]/status/route.ts"]) assert.doesNotMatch(readFileSync(path.join(api, ...rel.split("/")), "utf8"), /variationsOn/, rel);
  assert.match(readFileSync(path.join(__dirname, "store.ts"), "utf8"), /export async function alertSigned[\s\S]*?if \(!variationsOn\(\)\) return 0;/);
});

test("VD-005: the line the client reads under the signature pad", () => {
  const screen = readFileSync(path.join(__dirname, "..", "..", "components", "site", "VariationDocket.tsx"), "utf8");
  assert.ok(screen.includes("Lobos keeps this docket, your name and signature as the record of this work."));
});

// ---------- the status filter (bug fix) ----------

test("the status filter and the to-price card ask the database - complete however many dockets; the same newest-event rule", () => {
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /ORDER BY e\."createdAt" DESC, e\."id" DESC LIMIT 1\), 'TO_PRICE'\)/);
  assert.match(store, /export async function toPriceCard[\s\S]*?countWithStatus\("TO_PRICE"\)/);
  assert.doesNotMatch(store, /take: 2000/, "the card never loads every docket");
  assert.doesNotMatch(store, /\.filter\(\(r\) => !f\.status \|\| r\.status === f\.status\)/, "no in-memory status filter after a 500 cut");
  const t = (ms: number) => new Date(ms);
  assert.equal(currentStatus([{ id: "a1", status: "PRICED", createdAt: t(5) }, { id: "a2", status: "SENT_TO_CLIENT", createdAt: t(5) }]), "SENT_TO_CLIENT", "same moment: the later id");
  assert.equal(currentStatus([{ id: "a9", status: "PRICED", createdAt: t(4) }, { id: "a2", status: "TO_PRICE", createdAt: t(5) }]), "TO_PRICE", "time first");
});
