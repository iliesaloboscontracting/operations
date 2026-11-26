// Site documents (Ilies approved 25 Nov 2026): what a phone may send (amounts refused), the crew picker (only today's
// sign-ins on that job), one signature a person a SWMS version (a new version needs everyone again), the SafeWork
// prompt, immutability (no update / delete anywhere, raw SQL too), who sees incidents, the owner-only alert with no
// health detail, INC- numbering with several phones at once, files by their bytes, the kill switch. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  BODY_PARTS, INCIDENT_TYPES, LIMITS, PRESTART_TOPICS, SAFEWORK_PROMPT, TREATMENTS, allDifferent, alertRecipients, allocateNumber, crewList, currentSwms,
  fileHeaders, incidentAlert, incidentEvent, incidentNo, incidentStatus, isNotifiable, linkMayUse, linkSafe, mayReadIncidents, mayReadSiteDocs, mondayOf,
  parseArchive, parseFileMeta, parseIncident, parseRecord, parseSignOn, parseTopic, personKey, pickCrew, pickable, safeFileName, siteDocsOn, weekOf,
  lateSignOnJobs, newSwmsAlert, newSwmsRecipients, scrubbedError, signedAfterSignOut,
  type CrewRow,
} from "./rules";
import { checkUpload, readSignature, sniffFile } from "./checks";
import { COORDINATOR_PAGES, ROLES, YARD_PAGES, isCoordinatorPage, isYardPage } from "../roles";
import { OWNER_EMAIL } from "../owner";
import { assertNoMoney } from "../moneyGuard";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG2 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAABAElEQVR4AdSU0Q2DIBRFXzqIMziAMziAiziD/07iJM7gAK7Q9jS5BBpTqQJRE3L1AXIOUR7Pm18Pu/mVVGBZFqOV3JMkAkAPw2B1XbvGM/XcMqcEAAS0foOTgvXr6qOm/pR5SAAYgAUnoL7vbRxHa5pGpc8npbEaz3w34OTNXwIsLBhSawO+rquRXdfZNE02z3MRmSiBGHDJKKuqshIyPwWOgEvAz5wymwKpwH0J3aeWCQRygkvAzxQygYBOCS3CT6mfU7VcGSvTtm2A4ATYfV5Cb0lw1vtucOwdAJrjBJjE8VdqxwWwl3D5MhzP1DTPCVDwO3i+WtviCwSuBhzD8wIAAP//z7+xigAAAAZJREFUAwDlCsFw2LDIgQAAAABJRU5ErkJggg==";
const id = (n: number) => `cm${String(n).padStart(23, "0")}`;
const err = (x: unknown) => (x && typeof x === "object" && "error" in x ? (x as { error: string }).error : null);
const crew = (n: number, x: Partial<CrewRow> = {}): CrewRow => ({ id: id(n), jobId: id(1), resourceId: id(500 + n), workerName: `Worker ${n}`, company: null, place: null, status: "CONFIRMED", removedAt: null, ...x });
const sign = (n: number) => ({ attendanceId: id(n), understood: true, signature: PNG });
const prestart = (x: Record<string, unknown> = {}) => ({ kind: "PRESTART", jobId: id(1), topics: [{ key: "SAFETY", notes: "Edge protection level 3" }, { key: "PPE" }], notes: "", crew: [sign(10)], supervisorSignature: PNG2, ...x });
const toolbox = (x: Record<string, unknown> = {}) => ({ kind: "TOOLBOX", jobId: id(1), source: "OWN", title: "Silica dust", points: "Wet cutting, masks on", sitePoints: "", crew: [], supervisorSignature: PNG2, ...x });
const NOW = new Date("2026-11-25T03:00:00.000Z"); // 2pm Sydney
const local = (s: string) => new Date(`${s}:00+11:00`);
const incident = (x: Record<string, unknown> = {}) => ({
  jobId: id(1), type: "NEAR_MISS", treatment: "NONE", bodyPart: "Not applicable", occurredAt: "2026-11-25T13:30", location: "Level 3 east stairs",
  people: [id(10)], others: "", whatHappened: "A sheet of ply slid off the stack near the stairs.", immediateAction: "Area taped off, stack re-strapped.",
  witnesses: "", serious: false, promptShown: false, safeworkCalled: null, photoIds: [], signature: PNG, ...x,
});

// ---------- validation ----------

test("a pre-start: a ticked topic, Other says what, notes capped, no amounts", () => {
  const ok = parseRecord(prestart()) as { topics: { key: string; label: string; notes: string | null }[] };
  assert.ok(!err(ok));
  assert.deepEqual(ok.topics.map((t) => t.key), ["SAFETY", "PPE"]);
  assert.equal(ok.topics[1].notes, null);
  assert.equal(err(parseRecord(prestart({ topics: [] }))), "Tick what was covered.");
  assert.equal(err(parseRecord(prestart({ topics: [{ key: "OTHER" }] }))), "Other: say what it was.");
  assert.ok(!err(parseRecord(prestart({ topics: [{ key: "OTHER", notes: "Crane lift at 10" }] }))));
  assert.ok(err(parseRecord(prestart({ topics: [{ key: "GOLD" }] }))), "a topic not on the list");
  assert.ok(err(parseRecord(prestart({ topics: [{ key: "SAFETY", notes: "x".repeat(LIMITS.topicNote + 1) }] }))));
  assert.ok(err(parseRecord(prestart({ notes: "x".repeat(LIMITS.note + 1) }))));
  assert.match(err(parseRecord(prestart({ notes: "extra $400 for the crane" }))) ?? "", /Leave prices and amounts off/);
  assert.match(err(parseRecord(prestart({ topics: [{ key: "SAFETY", notes: "client pays 200 dollars" }] }))) ?? "", /amounts/);
  assert.equal(err(parseRecord(prestart({ jobId: "../etc" }))), "Which job is it for?");
  assert.equal(err(parseRecord(prestart({ supervisorSignature: null }))), "Sign it yourself as the supervisor.");
  assert.equal(PRESTART_TOPICS.length, 11);
  assert.deepEqual(PRESTART_TOPICS.map((t) => t.label).slice(0, 2), ["Safety", "Environment changes (weather, dust, noise)"]);
});

test("crew on a send: each ticked, each signed, nobody twice, capped", () => {
  assert.match(err(parseRecord(prestart({ crew: [{ attendanceId: id(10), understood: false, signature: PNG }] }))) ?? "", /I understand/);
  assert.ok(err(parseRecord(prestart({ crew: [{ attendanceId: id(10), understood: true }] }))));
  assert.ok(err(parseRecord(prestart({ crew: [{ attendanceId: "nope", understood: true, signature: PNG }] }))));
  assert.equal(err(parseRecord(prestart({ crew: [sign(10), sign(10)] }))), "Someone is on the list twice.");
  assert.ok(err(parseRecord(prestart({ crew: Array.from({ length: LIMITS.crewPerSend + 1 }, (_, i) => sign(100 + i)) }))));
  assert.ok(!err(parseRecord(prestart({ crew: [] }))), "no crew yet is fine - they sign on after");
});

test("a toolbox talk: the office's topic or your own, points discussed, no amounts", () => {
  assert.ok(!err(parseRecord(toolbox())));
  assert.equal(err(parseRecord(toolbox({ title: "" }))), "What's the topic?");
  assert.equal(err(parseRecord(toolbox({ points: "" }))), "Write the points you went through.");
  assert.ok(!err(parseRecord(toolbox({ source: "OFFICE", topicId: id(77), title: "" }))));
  assert.ok(err(parseRecord(toolbox({ source: "OFFICE", topicId: null }))));
  assert.ok(err(parseRecord(toolbox({ source: "BOTH" }))));
  assert.ok(err(parseRecord(toolbox({ sitePoints: "hire costs $90/hr" }))));
});

test("a sign-on: picked or the supervisor (SWMS only), ticked, signed", () => {
  assert.ok(!err(parseSignOn({ attendanceId: id(5), understood: true, signature: PNG }, { allowSupervisor: false })));
  assert.ok(!err(parseSignOn({ supervisor: true, understood: true, signature: PNG }, { allowSupervisor: true })));
  assert.ok(err(parseSignOn({ supervisor: true, understood: true, signature: PNG }, { allowSupervisor: false })), "a late sign-on is a crew member");
  assert.ok(err(parseSignOn({ attendanceId: id(5), understood: "yes", signature: PNG }, { allowSupervisor: false })));
  assert.ok(err(parseSignOn({ attendanceId: id(5), understood: true }, { allowSupervisor: false })));
});

test("an incident: the lists, when (not the future, not over 30 days), where, what happened, no amounts", () => {
  const ok = parseIncident(incident(), NOW, local) as { occurredAt: Date; notifiable: boolean; safeworkCalled: string | null };
  assert.ok(!err(ok), err(ok) ?? "");
  assert.equal(ok.occurredAt.toISOString(), "2026-11-25T02:30:00.000Z");
  assert.equal(ok.notifiable, false);
  assert.equal(ok.safeworkCalled, null);
  assert.deepEqual(INCIDENT_TYPES.map((t) => t.label), ["Injury", "Near miss", "Hazard", "Property damage", "Environmental", "Dangerous incident"]);
  assert.deepEqual(TREATMENTS.map((t) => t.label), ["None", "First aid", "Medical treatment", "Lost time"]);
  assert.ok((BODY_PARTS as readonly string[]).includes("Not applicable"));
  for (const [x, why] of [
    [{ type: "SPILL" }, "type"], [{ treatment: "" }, "treatment"], [{ bodyPart: "Tail" }, "body part"], [{ occurredAt: "yesterday" }, "time"],
    [{ occurredAt: "2026-11-25T16:30" }, "future"], [{ occurredAt: "2026-10-01T08:00" }, "over 30 days"], [{ location: "" }, "where"],
    [{ whatHappened: "fell" }, "what happened"], [{ immediateAction: "" }, "done straight away"], [{ people: ["x"] }, "a made-up person"],
    [{ people: Array.from({ length: LIMITS.people + 1 }, (_, i) => id(200 + i)) }, "too many people"], [{ photoIds: ["../x"] }, "a bad photo id"],
    [{ whatHappened: "x".repeat(LIMITS.whatHappened + 1) }, "too long"], [{ signature: undefined }, "unsigned"],
  ] as const) assert.ok(err(parseIncident(incident(x as Record<string, unknown>), NOW, local)), why);
  assert.match(err(parseIncident(incident({ whatHappened: "Damage to the client's glass door, about $2,000 to fix" }), NOW, local)) ?? "", /amounts/);
  const tidy = parseIncident(incident({ location: "  Level\u0007 3  ", witnesses: "Sam\r\n\r\n\r\n\r\nAlex\u0000" }), NOW, local) as { location: string; witnesses: string };
  assert.equal(tidy.location, "Level 3");
  assert.equal(tidy.witnesses, "Sam\n\nAlex");
});

// ---------- the SafeWork prompt ----------

test("the SafeWork prompt: dangerous incident, medical treatment, lost time or serious - and the answer is recorded", () => {
  assert.equal(isNotifiable({ type: "DANGEROUS", treatment: "NONE" }), true);
  assert.equal(isNotifiable({ type: "INJURY", treatment: "MEDICAL" }), true);
  assert.equal(isNotifiable({ type: "INJURY", treatment: "LOST_TIME" }), true);
  assert.equal(isNotifiable({ type: "INJURY", treatment: "FIRST_AID", serious: true }), true);
  assert.equal(isNotifiable({ type: "INJURY", treatment: "FIRST_AID" }), false);
  assert.equal(isNotifiable({ type: "NEAR_MISS", treatment: "NONE", serious: "yes" }), false, "only a real tick");
  assert.equal(err(parseIncident(incident({ type: "DANGEROUS", promptShown: false, safeworkCalled: "YES" }), NOW, local)), "Read the SafeWork box first.");
  assert.match(err(parseIncident(incident({ treatment: "MEDICAL", promptShown: true }), NOW, local)) ?? "", /Has SafeWork been called/);
  for (const a of ["YES", "NOT_YET", "NOT_NEEDED"]) {
    const ok = parseIncident(incident({ treatment: "LOST_TIME", promptShown: true, safeworkCalled: a }), NOW, local) as { notifiable: boolean; promptShown: boolean; safeworkCalled: string };
    assert.deepEqual([ok.notifiable, ok.promptShown, ok.safeworkCalled], [true, true, a]);
  }
  assert.equal((parseIncident(incident({ serious: true, promptShown: true, safeworkCalled: "NOT_YET" }), NOW, local) as { notifiable: boolean }).notifiable, true);
  // Not notifiable: an answer sent anyway isn't kept.
  assert.equal((parseIncident(incident({ safeworkCalled: "YES" }), NOW, local) as { safeworkCalled: string | null }).safeworkCalled, null);
  assert.ok(SAFEWORK_PROMPT.startsWith("This may need to be reported to SafeWork NSW straight away."));
  // Never contacts anyone: nothing in the feature calls out except the owner's push.
  for (const f of filesUnder(__dirname)) assert.doesNotMatch(readFileSync(f, "utf8"), /safework\.nsw|fetch\(\s*["'`]https?:|nodemailer|sendMail/i, path.basename(f));
});

// ---------- the crew picker ----------

test("the crew picker: only that job's sign-ins today, people only, not removed or rejected, one a person, never the supervisor", () => {
  const rows = [
    crew(1), crew(2, { resourceId: null, workerName: "Hire Joe", company: "Advanced Labour Hire" }), crew(3, { jobId: id(99) }),
    crew(4, { place: "VEHICLE" }), crew(5, { removedAt: new Date() }), crew(6, { status: "REJECTED" }), crew(7, { status: "TO_CONFIRM" }),
    crew(8, { resourceId: id(501) }), // a second sign-in of worker 1 (same person)
    crew(9, { resourceId: id(900) }), // the supervisor themselves
  ];
  assert.ok(pickable(rows[0], id(1)) && !pickable(rows[2], id(1)) && !pickable(rows[3], id(1)) && !pickable(rows[4], id(1)) && !pickable(rows[5], id(1)));
  const list = crewList(rows, id(1), id(900));
  assert.deepEqual(list.map((r) => r.id), [id(1), id(2), id(7)]);
  assert.deepEqual(pickCrew(list, id(2)), rows[1]);
  for (const bad of [id(3), id(4), id(5), id(6), id(9), id(404), "nope", null]) assert.match(err(pickCrew(list, bad)) ?? "", /signed in on this job|Pick the person/, String(bad));
  assert.match(err(pickCrew(list, id(3))) ?? "", /sign them in first/);
  // A hire worker is the same person by name + company, whatever the spacing or case.
  assert.equal(personKey({ resourceId: null, workerName: " hire  JOE ", company: "advanced labour hire" }), personKey({ resourceId: null, workerName: "Hire Joe", company: "Advanced Labour Hire" }));
  assert.notEqual(personKey({ resourceId: null, workerName: "Hire Joe", company: "Other Co" }), personKey({ resourceId: null, workerName: "Hire Joe", company: "Advanced Labour Hire" }));
  assert.equal(personKey({ resourceId: id(5), workerName: "x" }), `R:${id(5)}`);
  // The store only ever loads that job's own sign-ins (people, not removed, not rejected) and never writes one.
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /siteAttendance\.findMany\(\{ where: \{ jobId, place: null, removedAt: null, status: \{ not: "REJECTED" \} \}/);
  assert.match(store, /pickCrew\(await crewOf\(job\.id/);
});

// ---------- SWMS versions ----------

test("one signature a person a SWMS version; a new version needs everyone again", () => {
  // The register as the store keeps it: one row a (version, person) - the unique index refuses a second.
  const register = new Set<string>();
  const signOn = (fileId: string, a: { resourceId: string | null; workerName: string; company?: string | null }) => {
    const k = `${fileId}|${personKey(a)}`;
    if (register.has(k)) return "already";
    register.add(k);
    return "signed";
  };
  const v1 = { id: id(301), version: 1 }, v2 = { id: id(302), version: 2 };
  let cur = currentSwms([v1], new Set());
  assert.equal(cur?.id, v1.id);
  const joe = { resourceId: id(501), workerName: "Joe" };
  assert.equal(signOn(cur!.id, joe), "signed");
  assert.equal(signOn(cur!.id, { ...joe, workerName: "Joe (2nd sign-in)" }), "already", "the same person again - refused");
  cur = currentSwms([v1, v2], new Set());
  assert.equal(cur?.id, v2.id, "the new upload is the current version");
  assert.equal(signOn(cur!.id, joe), "signed", "a new version: Joe signs again");
  assert.equal(currentSwms([v1, v2], new Set([v2.id]))?.id, v1.id, "an archived newest version leaves the one before it current");
  assert.equal(currentSwms([v1, v2], new Set([v1.id, v2.id])), null);
  const schema = readFileSync(path.join(__dirname, "..", "..", "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /model SwmsSignature \{[\s\S]*?@@unique\(\[fileId, personKey\]\)/);
  assert.match(schema, /model SiteDocSignature \{[\s\S]*?@@unique\(\[recordId, personKey\]\)/);
  assert.match(schema, /model SiteDocFile \{[\s\S]*?@@unique\(\[projectId, kind, version\]\)/);
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /swmsSignature\.findMany\(\{ where: \{ fileId: sw\.id \}/, "already-signed is checked on THIS version");
  assert.match(store, /if \(!sw \|\| sw\.id !== body\.fileId\) return \{ error: "That isn't the current SWMS any more/, "only the current version can be signed");
});

// ---------- signatures ----------

test("signatures: real PNG bytes (the variation docket's checks), each person's own", () => {
  assert.ok(!err(readSignature(PNG, "Joe")));
  assert.match(err(readSignature(null, "Joe")) ?? "", /^Joe: sign in the white box/);
  assert.ok(err(readSignature("data:image/png;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQ", "Joe")), "a JPEG labelled PNG");
  assert.ok(err(readSignature("data:image/png;base64," + Buffer.from("<svg onload=alert(1)>").toString("base64"), "Joe")));
  assert.ok(err(readSignature("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9aw", "Joe")), "cut short");
  const a = readSignature(PNG, "a") as { sha256: string }, b = readSignature(PNG2, "b") as { sha256: string };
  assert.ok(allDifferent([a, b]) && !allDifferent([a, b, a]), "the same drawing twice is refused");
  const checks = readFileSync(path.join(__dirname, "checks.ts"), "utf8");
  assert.match(checks, /import \{ checkPng, logSignature \} from "\.\.\/variations\/signature"/, "reuses the variation PNG checks");
  assert.match(checks, /const png = ok\.png;/, "stores the PNG with optional chunks stripped (iPhone fix, 26 Nov 2026)");
});

// ---------- files ----------

const dataUrl = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString("base64")}`;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF")]);
const PNGB = Buffer.from(PNG.slice(22), "base64");
test("office files: by their own first bytes - PDF, JPEG, PNG; a SWMS / topic is a PDF; 7 MB", () => {
  assert.equal(sniffFile(PDF), "application/pdf");
  assert.equal(sniffFile(JPG), "image/jpeg");
  assert.equal(sniffFile(PNGB), "image/png");
  assert.equal(sniffFile(Buffer.from("<html><script>")), null);
  assert.equal((checkUpload(dataUrl("application/pdf", PDF), "Plan L2.pdf", "PLAN") as { mime: string }).mime, "application/pdf");
  assert.equal((checkUpload(dataUrl("image/jpeg", JPG), "site.jpeg", "PLAN") as { ext: string }).ext, "jpg");
  assert.equal((checkUpload(dataUrl("application/octet-stream", PDF), "swms.pdf", "SWMS") as { mime: string }).mime, "application/pdf");
  assert.ok(err(checkUpload(dataUrl("application/pdf", Buffer.from("<html><script>alert(1)</script>")), "evil.pdf", "PLAN")), "HTML called a PDF");
  assert.ok(err(checkUpload(dataUrl("image/png", PDF), "x.png", "PLAN")), "a PDF labelled PNG");
  assert.ok(err(checkUpload(dataUrl("application/pdf", PDF), "x.png", "PLAN")), "a PDF named .png");
  assert.equal(err(checkUpload(dataUrl("image/jpeg", JPG), "swms.jpg", "SWMS")), "A SWMS is a PDF.");
  assert.ok(err(checkUpload(dataUrl("image/png", PNGB), "t.png", "TOPIC")));
  assert.ok(err(checkUpload(dataUrl("application/pdf", Buffer.concat([PDF, Buffer.alloc(LIMITS.fileBytes)])), "big.pdf", "PLAN")), "over 7 MB");
  assert.ok(err(checkUpload("not a data url", "x.pdf", "PLAN")));
  assert.ok(err(checkUpload(dataUrl("application/pdf", Buffer.alloc(0)), "x.pdf", "PLAN")));
  assert.equal(safeFileName("Level 2 \"plan\"/../x", "pdf"), "Level 2 plan .. x.pdf");
  assert.ok(!/["\\/]/.test(safeFileName('a"b\\c/d', "png")));
  const h = fileHeaders("application/pdf", "plan.pdf");
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.match(h["Content-Disposition"], /^inline; filename="plan\.pdf"$/);
  assert.match(h["Content-Security-Policy"], /default-src 'none'/);
  assert.match(fileHeaders("image/png", "a.png")["Content-Security-Policy"], /sandbox/);
  assert.ok(!err(parseFileMeta({ projectId: id(1), kind: "SWMS", title: "Demolition SWMS" })));
  assert.ok(err(parseFileMeta({ projectId: id(1), kind: "TOPIC", title: "x" })));
  assert.ok(err(parseFileMeta({ projectId: id(1), kind: "PLAN", title: "Plan $500" })));
  assert.ok(err(parseArchive({ note: "" })) && !err(parseArchive({ note: "uploaded the wrong drawing" })));
  const files = readFileSync(path.join(__dirname, "files.ts"), "utf8");
  assert.match(files, /flag: "wx"/, "never written over an existing file");
  assert.match(files, /SITE_DOC_FILE_DIR/);
});

test("the topic of the week: a Monday, a title, short points, no amounts; weeks run Monday to Sunday (Sydney)", () => {
  assert.equal(mondayOf("2026-11-25"), "2026-11-23");
  assert.equal(mondayOf("2026-11-29"), "2026-11-23", "Sunday is still that week");
  assert.equal(mondayOf("2026-11-30"), "2026-11-30");
  assert.equal(weekOf(new Date("2026-11-29T14:30:00.000Z")), "2026-11-30", "Monday 1:30am in Sydney is the new week");
  assert.ok(!err(parseTopic({ week: "2026-11-23", title: "Silica dust", points: ["Wet cut", "P2 masks"] })));
  assert.deepEqual((parseTopic({ week: "2026-11-23", title: "Silica dust", points: "Wet cut\n\nP2 masks\n" }) as { points: string[] }).points, ["Wet cut", "P2 masks"]);
  assert.ok(err(parseTopic({ week: "2026-11-25", title: "Silica dust" })), "not a Monday");
  assert.ok(err(parseTopic({ week: "2026-11-23", title: "x" })));
  assert.ok(err(parseTopic({ week: "2026-11-23", title: "Silica", points: Array(LIMITS.points + 1).fill("p") })));
  assert.ok(err(parseTopic({ week: "2026-11-23", title: "Silica", points: ["fine $200"] })));
});

// ---------- immutable ----------

const filesUnder = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts")) out.push(f); } };
  try { walk(dir); } catch { /* missing */ }
  return out;
};
const MODELS = ["siteDocFile", "siteDocFileEvent", "swmsSignature", "siteDocRecord", "siteDocSignature", "siteDocTopic", "incidentReport", "incidentSignature", "incidentEvent"];
const TABLES = ["SiteDocFile", "SiteDocFileEvent", "SwmsSignature", "SiteDocRecord", "SiteDocSignature", "SiteDocTopic", "IncidentReport", "IncidentSignature", "IncidentEvent"];
test("immutable: no update or delete of a file, a record, a signature, a version, a topic or an incident - anywhere, raw SQL too", () => {
  const src = path.join(__dirname, "..", "..");
  const all = [...filesUnder(src), ...filesUnder(path.join(src, "..", "scripts")).filter((f) => !f.includes(`${path.sep}release-check${path.sep}`))];
  const call = new RegExp(String.raw`\b(${MODELS.join("|")})\.(update|updateMany|upsert|delete|deleteMany)\(`);
  const sql = new RegExp(String.raw`\b(UPDATE|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\s+"?(${TABLES.join("|")})\b`, "i");
  const bad = all.filter((f) => { const s = readFileSync(f, "utf8"); return call.test(s) || sql.test(s); });
  assert.deepEqual(bad.map((f) => path.relative(src, f)), [], "no file updates or deletes a site documents / incident row");
  const routes = [
    ...filesUnder(path.join(src, "app", "api", "site-documents")), ...filesUnder(path.join(src, "app", "api", "directors", "incidents")),
    ...filesUnder(path.join(src, "app", "api", "site", "[token]", "documents")),
  ];
  assert.ok(routes.length >= 20, `${routes.length} route files`);
  for (const f of routes) assert.doesNotMatch(readFileSync(f, "utf8"), /export const (PATCH|PUT|DELETE)\b|export async function (PATCH|PUT|DELETE)\b/, path.relative(src, f));
  const office = readFileSync(path.join(__dirname, "office.ts"), "utf8");
  assert.match(office, /siteDocFileEvent\.create\(\{ data: \{ fileId: id, action: "ARCHIVED"/, "archiving is its own row");
  assert.match(readFileSync(path.join(__dirname, "incidents.ts"), "utf8"), /incidentEvent\.create\(/, "follow-up is a new event");
  // Nothing in the feature touches hours or costs: sign-ins are only read.
  for (const f of filesUnder(__dirname)) assert.doesNotMatch(readFileSync(f, "utf8"), /prisma\.(siteAttendance|jobActual|allocationCost|timesheetWeek|assignment|hoursApproval)\.(create|update|upsert|delete|createMany|updateMany|deleteMany)/, path.basename(f));
  assert.ok(incidentEvent("OPEN", { kind: "CLOSED", note: "Investigated, toolbox talk held" }));
});

test("incident follow-up: Open -> Investigating -> Closed, reopen with why, notes always, a stale page told", () => {
  assert.equal(incidentStatus([]), "OPEN");
  assert.deepEqual(incidentEvent("OPEN", { kind: "INVESTIGATION", note: "Spoke to the crew" }), { kind: "INVESTIGATION", status: "INVESTIGATING", note: "Spoke to the crew" });
  assert.deepEqual(incidentEvent("INVESTIGATING", { kind: "ACTION", note: "New straps bought" }), { kind: "ACTION", status: "INVESTIGATING", note: "New straps bought" });
  assert.deepEqual(incidentEvent("INVESTIGATING", { kind: "CLOSED", note: "Done" }), { kind: "CLOSED", status: "CLOSED", note: "Done" });
  assert.ok(err(incidentEvent("CLOSED", { kind: "ACTION", note: "more" })), "closed: reopen first");
  assert.deepEqual(incidentEvent("CLOSED", { kind: "REOPENED", note: "Worker still sore" }), { kind: "REOPENED", status: "INVESTIGATING", note: "Worker still sore" });
  assert.ok(err(incidentEvent("OPEN", { kind: "REOPENED", note: "x y z" })));
  assert.ok(err(incidentEvent("OPEN", { kind: "CLOSED", note: "" })), "a note always");
  assert.match(err(incidentEvent("INVESTIGATING", { kind: "CLOSED", note: "Done", from: "OPEN" })) ?? "", /Someone changed it/);
  assert.ok(err(incidentEvent("OPEN", { kind: "ACTION", note: "paid $300 excess" })));
  assert.equal(incidentStatus([{ status: "INVESTIGATING", createdAt: new Date(1) }, { status: "CLOSED", createdAt: new Date(2) }]), "CLOSED");
});

// ---------- who sees what ----------

test("who sees incidents: the owner and DIRECTOR logins - nobody else", () => {
  const owner = { role: "ADMIN", email: OWNER_EMAIL };
  assert.ok(mayReadIncidents(owner, OWNER_EMAIL));
  assert.ok(mayReadIncidents({ ...owner, email: ` ${OWNER_EMAIL.toUpperCase()} ` }, OWNER_EMAIL));
  assert.ok(mayReadIncidents({ role: "DIRECTOR", email: "yoel@loboscontracting.com.au" }, OWNER_EMAIL));
  for (const role of ROLES.filter((r) => r !== "DIRECTOR")) assert.equal(mayReadIncidents({ role, email: "someone@loboscontracting.com.au" }, OWNER_EMAIL), false, role);
  assert.equal(mayReadIncidents({ role: "MANAGER", email: "iliesa+agent@loboscontracting.com.au" }, OWNER_EMAIL), false, "the Building Agent");
  assert.equal(mayReadIncidents({ role: "ADMIN", email: "nick@loboscontracting.com.au" }, OWNER_EMAIL), false, "another Admin (even with the director tick)");
  const auth = readFileSync(path.join(__dirname, "..", "auth.ts"), "utf8");
  assert.match(auth, /export async function guardIncidents\(\)[\s\S]*?mayReadIncidents\(user, OWNER_EMAIL\)/);
  const src = path.join(__dirname, "..", "..", "app", "api", "directors", "incidents");
  const routes = filesUnder(src);
  assert.ok(routes.length >= 5);
  for (const f of routes) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /await guardIncidents\(\)/, path.relative(src, f));
    assert.doesNotMatch(s, /guardDirector\(|guard\("/, "never the looser guards");
  }
  assert.ok(!(COORDINATOR_PAGES as readonly string[]).some((p) => p.includes("incident")) && !isCoordinatorPage("/incidents") && !isCoordinatorPage("/site-documents/incidents"));
  assert.ok(!isYardPage("/incidents"));
});

test("who reads the office's site documents: Managers, Admins and the coordinator; which links use them", () => {
  assert.deepEqual(ROLES.filter((r) => mayReadSiteDocs(r)).sort(), ["ADMIN", "COORDINATOR", "MANAGER"]);
  for (const r of ["VIEWER", "ACCOUNTS", "TIMESHEETS", "YARD", "DIRECTOR", "", "admin"]) assert.equal(mayReadSiteDocs(r), false, r);
  assert.ok((COORDINATOR_PAGES as readonly string[]).includes("/site-documents"));
  assert.ok(isCoordinatorPage("/site-documents?projectId=x") && isCoordinatorPage("/site-documents/topic") && isCoordinatorPage("/site-documents/records/abc") && isCoordinatorPage("/site-documents/swms/abc"));
  assert.ok(!isCoordinatorPage("/site-documents/records/abc/edit") && !(YARD_PAGES as readonly string[]).includes("/site-documents"));
  const p = { id: id(9) };
  assert.ok(linkMayUse({ kind: "SUPERVISOR", shared: false, person: p }) && linkMayUse({ kind: "HANDOVER", shared: false, person: p }));
  for (const kind of ["OFFICE", "DRIVER", "POSTER", "PLANT"]) assert.ok(!linkMayUse({ kind, shared: false, person: p }), kind);
  assert.ok(!linkMayUse({ kind: "OFFICE", shared: true, person: { id: null } }), "the yard's shared link");
  const auth = readFileSync(path.join(__dirname, "..", "auth.ts"), "utf8");
  assert.match(auth, /export async function guardSiteDocs\(\)[\s\S]*?mayReadSiteDocs\(user\.role\)/);
  const office = path.join(__dirname, "..", "..", "app", "api", "site-documents");
  for (const f of filesUnder(office)) assert.match(readFileSync(f, "utf8"), /await guardSiteDocs\(\)/, path.relative(office, f));
  // The Building Agent: never a signature, an upload, an archive or a topic.
  for (const rel of ["files/route.ts", "files/[id]/archive/route.ts", "topic/route.ts", "swms/signature/[id]/route.ts", "records/[id]/signature/[sigId]/route.ts"]) {
    assert.match(readFileSync(path.join(office, ...rel.split("/")), "utf8"), /if \(isAgent\(g\.user\)\) return NextResponse\.json\(\{ error: AGENT_NO_(WRITE|FILES) \}, \{ status: 403 \}\)/, rel);
  }
});

// ---------- the owner's alert ----------

test("the incident alert: the owner only, the number + project + supervisor - no health detail, no money", () => {
  const a = incidentAlert({ id: id(5), number: 4, projectName: "Bondi Rd strip-out", supervisor: "Pol Tuilagi" });
  assert.ok(a);
  assert.equal(a!.title, "Incident report sent");
  assert.equal(a!.body, "Incident report INC-0004 sent - Bondi Rd strip-out (Pol Tuilagi)");
  assert.equal(a!.url, `/incidents/${id(5)}`);
  for (const word of ["Injury", "Medical", "Lost time", "Hand", "First aid", "SafeWork", "Near miss"]) assert.ok(!JSON.stringify(a).includes(word), word);
  assert.ok(assertNoMoney(JSON.stringify(a)));
  const priced = incidentAlert({ id: id(5), number: 3, projectName: "$450 Coogee job", supervisor: "Pol" });
  assert.ok(priced && !priced.body.includes("$"));
  const users = [
    { id: "owner", email: OWNER_EMAIL.toUpperCase(), active: true }, { id: "owner-off", email: OWNER_EMAIL, active: false },
    { id: "admin", email: "nick@loboscontracting.com.au", active: true }, { id: "director", email: "yoel@loboscontracting.com.au", active: true },
    { id: "coord", email: "alex@loboscontracting.com.au", active: true },
  ];
  assert.deepEqual(alertRecipients(users, OWNER_EMAIL), ["owner"]);
  const inc = readFileSync(path.join(__dirname, "incidents.ts"), "utf8");
  assert.match(inc, /alertRecipients\(users, OWNER_EMAIL\)/);
  assert.match(inc, /pushToUsers\(to, msg/);
  assert.match(inc, /incidentAlert\(\{ id: d\.id, number: d\.number, projectName: d\.projectName, supervisor: d\.supervisorName \}\)/, "only these four fields go into the alert");
  assert.doesNotMatch(inc, /pushToAdmins|pushToSiteLinks/);
  assert.match(inc, /void alertIncident\(made\.id\)/, "sent after the report is saved, never holding up the send");
});

test("health details never reach an AI, LCI or a link after send", () => {
  const lib = path.join(__dirname, "..");
  const ai = [path.join(lib, "assistantTools.ts"), ...filesUnder(path.join(lib, "findings")), ...filesUnder(path.join(lib, "docsearch")), ...filesUnder(path.join(lib, "voice")), path.join(lib, "invoiceReading.ts")];
  for (const f of ai) { let s = ""; try { s = readFileSync(f, "utf8"); } catch { continue; } assert.doesNotMatch(s, /incident(Report|Event|Signature)|siteDocs\/incidents/i, path.relative(lib, f)); }
  for (const f of filesUnder(__dirname)) assert.doesNotMatch(readFileSync(f, "utf8"), /@anthropic-ai|api\.anthropic|openai/i, path.basename(f));
  // The link gets number / date / type only - from the send, and from its list.
  const inc = readFileSync(path.join(__dirname, "incidents.ts"), "utf8");
  assert.match(inc, /return \{ incident: \{ number: incidentNo\(made\.number\), day: job\.day, type: p\.type, sentAt: now\.toISOString\(\) \} \};/);
  const store = readFileSync(path.join(__dirname, "store.ts"), "utf8");
  assert.match(store, /prisma\.incidentReport\.findMany\(\{ where: \{ siteLinkId: link\.id, createdAt: \{ gte: since \} \}, select: \{ number: true, day: true, type: true, createdAt: true \}/);
  const linkRoutes = filesUnder(path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "documents"));
  for (const f of linkRoutes) assert.doesNotMatch(readFileSync(f, "utf8"), /incidentDetail|incidentList|incidentSignature/, path.basename(path.dirname(f)));
  // The incident photo is never read back on a link once it's on a sent report (and never through the daily log's route).
  const media = readFileSync(path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "documents", "media", "[op]", "route.ts"), "utf8");
  assert.match(media, /if \(await photoOnAReport\(id\)\)/);
  assert.match(readFileSync(path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "media", "[op]", "route.ts"), "utf8"), /row\.area === "INCIDENT"/);
});

// ---------- numbering ----------

test("INC-0001 numbers: one more than the highest; several phones at once all different, no gaps", async () => {
  assert.equal(incidentNo(1), "INC-0001");
  assert.equal(incidentNo(42), "INC-0042");
  assert.equal(incidentNo(12345), "INC-12345");
  const rows = new Set<number>();
  const pause = () => new Promise((r) => setTimeout(r, Math.random() * 4));
  const highest = async () => { await pause(); return Math.max(0, ...rows); };
  const create = async (n: number) => {
    await pause();
    if (rows.has(n)) throw Object.assign(new Error("Unique constraint failed on the fields: (`number`)"), { code: "P2002" });
    rows.add(n);
    return n;
  };
  const got = await Promise.all(Array.from({ length: 12 }, () => allocateNumber(highest, create)));
  assert.deepEqual(got.map((g) => g.number).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 1));
  const inc = readFileSync(path.join(__dirname, "incidents.ts"), "utf8");
  assert.match(inc, /const made = await serial\(/);
  assert.match(inc, /allocateNumber\(/);
  const schema = readFileSync(path.join(__dirname, "..", "..", "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /model IncidentReport \{[\s\S]*?number\s+Int\s+@unique/);
  assert.match(schema, /model SiteDocRecord \{[\s\S]*?@@unique\(\[jobId, kind, seq\]\)/, "\"Pre-start 2\" numbers are unique a job too");
});

// ---------- kill switch, money guard ----------

test("the kill switch SITE_DOCS=off; every link reply is checked for money", () => {
  assert.equal(siteDocsOn({}), true);
  assert.equal(siteDocsOn({ SITE_DOCS: "on" }), true);
  assert.equal(siteDocsOn({ SITE_DOCS: " OFF " }), false);
  assert.ok(linkSafe({ jobs: [{ label: "Bondi Rd" }] }));
  assert.ok(!linkSafe({ note: "$500" }) && !linkSafe({ note: "＄500" }));
  const src = path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "documents");
  const files = filesUnder(src);
  assert.ok(files.length >= 9);
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /if \(!siteDocsOn\(\)\) return off\(\)/, path.relative(src, f));
    assert.match(s, /resolveSiteDocsLink\(/, path.relative(src, f));
    assert.doesNotMatch(s, /NextResponse\.json\(out|NextResponse\.json\(await/, "JSON replies go through safe() (the money guard)");
  }
  // The office side never looks at the switch.
  for (const f of filesUnder(path.join(__dirname, "..", "..", "app", "api", "site-documents"))) assert.doesNotMatch(readFileSync(f, "utf8"), /siteDocsOn/);
  const home = readFileSync(path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "route.ts"), "utf8");
  assert.match(home, /linkMayUse\(link\) && siteDocsOn\(\) \? \{ siteDocs: await tileState\(link\) \} : \{\}/);
});

// ---------- security fixes and decisions (Ilies approved SD-001..SD-006, SD-009, SD-010, 26 Nov 2026) ----------

process.env.AUTH_SECRET ??= "unit-test-secret-0123456789abcdef";
test("SD-001: a document ticket is bound to the kind, the file and the link, lasts at most 15 minutes, can't be forged", async () => {
  const { makeDocTicket, readDocTicket, DOC_TICKET_MAX_MS } = await import("../signin");
  const t0 = 1_000_000;
  const t = makeDocTicket("F", id(31), id(41), t0);
  assert.deepEqual(readDocTicket(t, t0 + 60_000), { kind: "F", fileId: id(31), linkId: id(41) });
  assert.equal(readDocTicket(t, t0 + 11 * 60_000), null, "expired after 10 minutes");
  assert.ok(DOC_TICKET_MAX_MS <= 15 * 60_000);
  const [p, m] = t.split(".");
  const forged = Buffer.from(Buffer.from(p, "base64url").toString("utf8").replace(id(41), id(42))).toString("base64url");
  assert.equal(readDocTicket(`${forged}.${m}`, t0), null, "another link's id with the old signature");
  assert.equal(readDocTicket(`${p}.${m.slice(0, -1)}x`, t0), null, "a tampered signature");
  assert.equal(readDocTicket("nonsense", t0), null);
  assert.ok(/^[A-Za-z0-9_.-]+$/.test(t), "URL-safe");
  const route = readFileSync(path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "documents", "files", "[id]", "ticket", "route.ts"), "utf8");
  assert.match(route, /url: `\/api\/site\/doc\/\$\{makeDocTicket\("F", id, link\.id\)\}`/, "the ticket address holds the link's id, never its secret");
  const doc = readFileSync(path.join(__dirname, "..", "..", "app", "api", "site", "doc", "[ticket]", "route.ts"), "utf8");
  assert.match(doc, /readDocTicket\(/);
  assert.match(doc, /await linkById\(t\.linkId\)/);
  assert.match(doc, /await linkMayOpen\(link, t\.kind, t\.fileId\)/, "the file checks are run again when it's opened");
  assert.match(doc, /if \(!siteDocsOn\(\)\) return off\(\)/);
  for (const old of [["files", "[id]", "route.ts"], ["topic", "[id]", "route.ts"]]) {
    assert.throws(() => readFileSync(path.join(__dirname, "..", "..", "app", "api", "site", "[token]", "documents", ...old)), /ENOENT/, `the old token-path ${old[0]} route is gone`);
  }
});

test("SD-003: a failed incident save logs no typed text - the database's code only", async () => {
  const typed = "Joe crushed two fingers on his left hand";
  const dbErr = Object.assign(new Error(`Invalid \`prisma.incidentReport.create()\` invocation: { whatHappened: "${typed}" }`), { code: "P2003" });
  const e = scrubbedError("Saving an incident report", dbErr);
  assert.equal(e.message, "Saving an incident report failed (P2003)");
  assert.ok(!String(e.stack).includes(typed) && !("cause" in e && (e as { cause?: unknown }).cause));
  assert.equal(scrubbedError("x", new TypeError(typed)).message, "x failed (TypeError)");
  // Through the route wrapper that logs failures: nothing typed reaches the log.
  const { withErrorHandling } = await import("../apiHandler");
  const { NextRequest } = await import("next/server");
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(" ")); };
  try {
    const h = withErrorHandling(async () => { throw scrubbedError("Saving an incident report", dbErr); });
    const res = await h(new NextRequest("http://x/api/site/abcdefghijklmnopqrstuvwxyz/documents/incident", { method: "POST" }), {});
    assert.equal(res.status, 500);
  } finally { console.error = orig; }
  assert.ok(logged.length > 0 && logged.every((l) => !l.includes(typed) && !l.includes("Joe")), logged.join("|"));
  const inc = readFileSync(path.join(__dirname, "incidents.ts"), "utf8");
  assert.match(inc, /\} catch \(e\) \{\s*throw scrubbedError\("Saving an incident report", e\);/);
});

test("SD-012: a failed follow-up note save logs no typed text - the database's code only", async () => {
  const typed = "Worker still can't grip with his right hand";
  const dbErr = Object.assign(new Error(`Invalid \`prisma.incidentEvent.create()\` invocation: { note: "${typed}" }`), { code: "P2003" });
  const e = scrubbedError("Saving a follow-up note", dbErr);
  assert.equal(e.message, "Saving a follow-up note failed (P2003)");
  const { withErrorHandling } = await import("../apiHandler");
  const { NextRequest } = await import("next/server");
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(" ")); };
  try {
    const h = withErrorHandling(async () => { throw scrubbedError("Saving a follow-up note", dbErr); });
    assert.equal((await h(new NextRequest("http://x/api/directors/incidents/abc/events", { method: "POST" }), {})).status, 500);
  } finally { console.error = orig; }
  assert.ok(logged.length > 0 && logged.every((l) => !l.includes(typed) && !l.includes("grip")), logged.join("|"));
  const inc = readFileSync(path.join(__dirname, "incidents.ts"), "utf8");
  assert.match(inc, /\} catch \(err\) \{\s*throw scrubbedError\("Saving a follow-up note", err\);/);
});

test("SD-004: the incident routes are never cached", () => {
  const src = path.join(__dirname, "..", "..", "app", "api", "directors", "incidents");
  for (const rel of [["route.ts"], ["[id]", "route.ts"], ["[id]", "photo", "[mediaId]", "route.ts"]]) assert.match(readFileSync(path.join(src, ...rel), "utf8"), /"Cache-Control", "no-store"|"Cache-Control": "no-store"/, rel.join("/"));
});

test("SD-005: a signature made after the person signed out is flagged (nothing stored)", () => {
  const out = new Date("2026-11-25T05:00:00Z");
  assert.equal(signedAfterSignOut(new Date("2026-11-25T05:30:00Z"), out), true);
  assert.equal(signedAfterSignOut(new Date("2026-11-25T04:59:00Z"), out), false);
  assert.equal(signedAfterSignOut(new Date("2026-11-25T05:30:00Z"), null), false, "still signed in");
  const office = readFileSync(path.join(__dirname, "office.ts"), "utf8");
  assert.match(office, /afterSignOut: s\.afterSignOut \}\)\)\)/, "the SWMS register carries it");
  assert.match(office, /\(await withAfterSignOut\(r\.signatures\)\)/, "the record carries it");
});

test("SD-006: the report says the phone reported the SafeWork box was shown", () => {
  const ui = readFileSync(path.join(__dirname, "..", "..", "components", "incidents", "Incidents.tsx"), "utf8");
  assert.match(ui, /Phone reported the SafeWork box was shown/);
  assert.doesNotMatch(ui, /The supervisor was shown/);
  assert.match(readFileSync(path.join(__dirname, "incidents.ts"), "utf8"), /phoneReportedPromptShown: d\.promptShown/);
});

test("SD-010: a late arrival joins that week's toolbox talk any day of the week on that project; a pre-start same day only", () => {
  const jobs = [
    { id: id(1), projectId: id(70), day: "2026-11-27" }, // Friday, same project
    { id: id(2), projectId: id(71), day: "2026-11-27" }, // another project
    { id: id(3), projectId: id(70), day: "2026-11-30" }, // next Monday
  ];
  const tbx = { kind: "TOOLBOX", jobId: id(9), projectId: id(70), week: "2026-11-23" };
  assert.deepEqual(lateSignOnJobs(tbx, jobs).map((j) => j.id), [id(1)], "Friday's job on the same project, not next week's or another project's");
  assert.deepEqual(lateSignOnJobs({ ...tbx, projectId: null, jobId: id(1) }, jobs).map((j) => j.id), [id(1)], "no project: the same job only");
  assert.deepEqual(lateSignOnJobs({ kind: "PRESTART", jobId: id(9), projectId: id(70), week: "2026-11-23" }, jobs), [], "a pre-start stays on its own job (day)");
  assert.deepEqual(lateSignOnJobs({ kind: "PRESTART", jobId: id(1), projectId: id(70), week: "2026-11-23" }, jobs).map((j) => j.id), [id(1)]);
  assert.match(readFileSync(path.join(__dirname, "store.ts"), "utf8"), /const jobs = lateSignOnJobs\(rec, await docJobs\(link, now\)\)/);
});

test("new SWMS alert: the supervisors booked on the project today + 7 days and those jobs' hand-over links; words only", () => {
  const jobs = [{ id: id(1), crewIds: [id(500), id(501)] }, { id: id(2), crewIds: [id(502)] }];
  const links = [
    { id: "sup500", kind: "SUPERVISOR", resourceId: id(500), jobId: null }, { id: "sup502", kind: "SUPERVISOR", resourceId: id(502), jobId: null },
    { id: "sup999", kind: "SUPERVISOR", resourceId: id(999), jobId: null }, { id: "hand1", kind: "HANDOVER", resourceId: id(777), jobId: id(1) },
    { id: "hand9", kind: "HANDOVER", resourceId: id(777), jobId: id(9) }, { id: "drv500", kind: "DRIVER", resourceId: id(500), jobId: null },
    { id: "off500", kind: "OFFICE", resourceId: id(500), jobId: null }, { id: "post", kind: "POSTER", resourceId: null, jobId: id(1) },
  ];
  assert.deepEqual(newSwmsRecipients(jobs, links).sort(), ["hand1", "sup500", "sup502"]);
  const m = newSwmsAlert(id(70), "Bondi Rd strip-out", 3);
  assert.equal(m?.tag, `swms-${id(70).slice(-8)}-3`, "SD-014: the tag names the project and the version");
  assert.notEqual(newSwmsAlert(id(71), "Other job", 3)?.tag, m?.tag, "SD-014: another project's v3 has its own tag");
  assert.match(readFileSync(path.join(__dirname, "office.ts"), "utf8"), /newSwmsAlert\(projectId, p\.name, version\)/);
  assert.equal(m?.body, "New SWMS for Bondi Rd strip-out (v3) - get the crew to sign it at the next pre-start.");
  assert.equal(m?.url, "?go=docs");
  assert.ok(!newSwmsAlert(id(70), "$450 job", 2)?.body.includes("$"));
  const office = readFileSync(path.join(__dirname, "office.ts"), "utf8");
  assert.match(office, /void alertNewSwms\(m\.projectId, row\.version \?\? 1\)/, "sent after a SWMS upload, never holding it up");
  assert.match(office, /date: \{ gte: new Date\(`\$\{today\}T00:00:00\.000Z`\), lte: until \}/);
  assert.match(office, /pushToSiteLinks\(to, msg/);
  assert.match(office, /where: liveLinks\(/, "live links only");
});