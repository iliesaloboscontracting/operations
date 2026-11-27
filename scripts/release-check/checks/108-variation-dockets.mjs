// Variation / Day docket (Ilies approved 25 Nov 2026: "yes build it, deploy once it passes") - his paper docket on a
// supervisor's phone, the client signs with a finger, the office prints it.
//   (1) Links: GET / POST answer a SUPERVISOR link and a HANDOVER link only (DRIVER, POSTER, OFFICE, switched-off and
//       made-up links 404, nothing saved); the link's home says `variations` on those two only; a supervisor sees only
//       its own jobs today, with the project details filled in (a "$" in the client's name never reaches the phone).
//   (2) Refused with nothing saved: unsigned by the client, unsigned by Lobos, a JPEG / HTML "signature", a $ figure or a
//       money phrase in any box, a bad time, another supervisor's job (403), a hand-over link on another job (403).
//   (3) A supervisor sends one: 201 with its V-number; the docket, tasks (hours worked out: men x time), items and both
//       signatures (real PNG bytes) are saved, linkKind SUPERVISOR, the person's id; the hand-over link sends one on its
//       own job (HANDOVER). Five sent at once get five different, consecutive numbers.
//   (4) Nothing can be edited after sending: PATCH / PUT / DELETE on the link route and the office routes 405; the
//       docket (and its rows and signatures) byte-for-byte the same after office status changes; a correction is a new
//       docket naming the one it replaces (the original unchanged, "replaced by" shown); replacing another job's docket 400.
//   (5) The office: /api/variations, ?summary=1, a docket, its signatures and the pages - MANAGER, ADMIN, the owner and
//       the COORDINATOR yes; VIEWER, TIMESHEETS, ACCOUNTS, DIRECTOR, YARD 403, no login 401. The signature is image/png.
//   (6) Office status: the coordinator marks Priced (201), a VIEWER can't (403), a stale page 409, back a step with no
//       reason 400, a Manager marks Sent to client; the filter and the "to price" card follow; every change kept.
//   (7) Photos through the media bucket (the local fake bucket - never the real one): a docket photo uploads (READY), the
//       docket cites it, the office route redirects to it (Manager) and refuses a Viewer; a video, another link's photo or
//       a photo for another job is refused.
//   (8) 30 dockets a Sydney day per link - the 31st 429, nothing saved.
//   (9) The phone alert: alertSigned in a tsx child with throwaway VAPID keys and a STUB push host (nothing leaves the
//       machine) reaches the coordinator's and the owner's phones only - never another Admin's - with the words
//       "Variation V-xxxx signed - <project> (<supervisor>)", /variations/<id>, no money.
//  (10) The kill switch VARIATION_DOCKETS=off (the routes run in a tsx child): 503 with plain words, the home has no
//       `variations`.
//  (11) No dollar figure in any link reply or in the alert; no outbound call.
//   Security fixes (Ilies approved VD-001..VD-006, 25 Nov 2026): VD-001 a docket is corrected only by the person who
//   sent it (another person on the same job 400 with the plain words, nothing saved) and the office shows every
//   correction; VD-002 the Building Agent login lists and reads a docket (no signatures, no photos, canSetStatus false)
//   but gets 403 on status, signature and photo with nothing saved; VD-003 with the switch off the office still reads
//   the dockets (the store, run in the tsx child); VD-004 a signature with an injected tEXt chunk or the same image
//   twice is refused, the signature route sends a sandboxing CSP; VD-006 an expired hand-over link 404 on GET, POST and
//   a photo start, TIMESHEETS / ACCOUNTS / DIRECTOR / YARD 403 on the photo route, a status POST from another site 403.
// WRITES on the test copy: made-up people, two projects with a job today each, links of every kind, dockets (kept -
// they're append-only), status events, a docket photo, test phone-alert devices. Links revoked and people switched off
// at the end.
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
// A real canvas signature: canvas.toDataURL("image/png") from Chrome 156 (25 Nov 2026) - IHDR, IDAT, IDAT, IEND.
const CHROME_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAABAElEQVR4AdSU0Q2DIBRFXzqIMziAMziAiziD/07iJM7gAK7Q9jS5BBpTqQJRE3L1AXIOUR7Pm18Pu/mVVGBZFqOV3JMkAkAPw2B1XbvGM/XcMqcEAAS0foOTgvXr6qOm/pR5SAAYgAUnoL7vbRxHa5pGpc8npbEaz3w34OTNXwIsLBhSawO+rquRXdfZNE02z3MRmSiBGHDJKKuqshIyPwWOgEvAz5wymwKpwH0J3aeWCQRygkvAzxQygYBOCS3CT6mfU7VcGSvTtm2A4ATYfV5Cb0lw1vtucOwdAJrjBJjE8VdqxwWwl3D5MhzP1DTPCVDwO3i+WtviCwSuBhzD8wIAAP//z7+xigAAAAZJREFUAwDlCsFw2LDIgQAAAABJRU5ErkJggg==";
// The same PNG with an extra chunk put in before IEND (a correct CRC). Since the iPhone fix (26 Nov 2026) an optional
// chunk such as tEXt is stripped, not refused; an unknown REQUIRED chunk (upper-case first letter, "ABCD") is refused.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const withText = (dataUrl, type = "ABCD") => {
  const png = Buffer.from(dataUrl.slice(22), "base64");
  const data = Buffer.from("Comment\0<script>alert(1)</script>", "latin1");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return "data:image/png;base64," + Buffer.concat([png.subarray(0, png.length - 12), len, td, crc, png.subarray(png.length - 12)]).toString("base64");
};
const JPEG_AS_PNG = "data:image/png;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQ";
const HTML_AS_PNG = `data:image/png;base64,${Buffer.from("<html><script>alert(1)</script></html>").toString("base64")}`;
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const jpeg = (size) => Buffer.concat([JPEG_HEAD, randomBytes(size - JPEG_HEAD.length)]);
const OFFICE_YES = ["MANAGER", "ADMIN", "OWNER", "COORDINATOR"];
const OFFICE_NO = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"];
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };

export default {
  id: "variation-dockets",
  title: "Variation / day dockets: SUPERVISOR + own-job HANDOVER links only, signed before Send, no $ anywhere, numbered safely, never edited, office matrix, coordinator status, photos, alert to coordinator + owner only, kill switch, no outbound",
  writes: true, timeoutMs: 420_000,
  applies: (c) => c.hasPath("src/lib/variations/rules.ts") || "needs lib/variations/rules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    for (const k of [...OFFICE_YES, ...OFFICE_NO]) if (!c.users[k]) return t.block(`no ${k} test login`);
    if (!c.users.OPS_AI) return t.block("no Building Agent (OPS_AI) test login");
    const net0 = netLines(c);
    const tag = Date.now().toString(36);
    const made = { people: [], links: [], projects: [] };
    const seen = []; // every link reply - scanned for "$" + digit at the end
    const call = async (method, link, rest, body) => {
      const r = await c.req(method, c.site(link, rest), null, body);
      const text = await r.text().catch(() => "");
      seen.push([`${method} ${rest}`, text]);
      let j = null; try { j = JSON.parse(text); } catch { /* */ }
      return { status: r.status, body: j, text };
    };
    const send = (link, body) => call("POST", link, "/variation", body);
    try {
      // ---- seed ----
      const mk = async (name, extra = {}) => { const r = await db.resource.create({ data: { name: `${name} ${tag}`, type: "PERSONNEL", category: "Site Manager", role: "Supervisor", status: "AVAILABLE", ...extra } }); made.people.push(r.id); return r; };
      const S = await mk("RC Var super S"), S2 = await mk("RC Var super S2"), H = await mk("RC Var stand-in H"), D = await mk("RC Var driver D", { category: "Labourer", role: "Driver" }), O = await mk("RC Var office O");
      const P = await db.project.create({ data: { name: `RC Var job ${tag}`, status: "ACTIVE", client: "RC Client $500 Pty", address: "1 Test St Wolli Creek", jobNo: "26_999" } });
      const Q = await db.project.create({ data: { name: `RC Var other job ${tag}`, status: "ACTIVE" } });
      made.projects.push(P.id, Q.id);
      const day = new Date(`${c.today}T00:00:00.000Z`);
      const J = await db.job.create({ data: { projectId: P.id, title: P.name, date: day, shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
      const J2 = await db.job.create({ data: { projectId: Q.id, title: Q.name, date: day, shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
      await db.assignment.create({ data: { jobId: J.id, resourceId: S.id, role: "Supervisor" } });
      await db.assignment.create({ data: { jobId: J2.id, resourceId: S2.id, role: "Supervisor" } });
      const later = new Date(Date.now() + 36 * 3_600_000);
      const L = {
        sup: await makeLink(db, "SUPERVISOR", S.id),
        sup2: await makeLink(db, "SUPERVISOR", S2.id),
        sup3: await makeLink(db, "SUPERVISOR", S.id), // the day-cap test
        handover: await makeLink(db, "HANDOVER", H.id, { jobId: J.id, expiresAt: later }),
        driver: await makeLink(db, "DRIVER", D.id),
        poster: await makeLink(db, "POSTER", null, { projectId: P.id }),
        office: await makeLink(db, "OFFICE", O.id),
        off: await makeLink(db, "SUPERVISOR", S.id, { revokedAt: new Date() }),
        expired: await makeLink(db, "HANDOVER", H.id, { jobId: J.id, expiresAt: new Date(Date.now() - 60_000) }),
      };
      for (const l of Object.values(L)) made.links.push(l.id);
      const fake = { secret: "x".repeat(32) };
      const dockets = () => db.variationDocket.count();
      const base = (x = {}) => ({
        jobId: J.id, ticks: ["VARIATION", "RUBBISH"], otherText: "",
        tasks: [{ description: `RC extra partition wall ${tag}`, men: 3, start: "07:00", finish: "10:30" }, { description: "RC night cut", men: 2, start: "22:00", finish: "01:00", hours: 5 }],
        items: [{ quantity: 2, unit: "LOADS", type: "Mixed waste", comment: "two skips" }], // loads (28 Nov 2026)
        note: "", photoIds: [], customerName: "Sam Client", customerPosition: "Site manager", customerSignature: PNG, lobosPosition: "Supervisor", lobosSignature: CHROME_PNG, ...x,
      });

      // ---- (1) links ----
      const n0 = await dockets();
      for (const [name, link, want] of [["supervisor", L.sup, 200], ["hand-over", L.handover, 200], ["driver", L.driver, 404], ["poster", L.poster, 404], ["office", L.office, 404], ["switched-off", L.off, 404], ["expired hand-over", L.expired, 404], ["made-up", fake, 404]]) {
        t.status((await call("GET", link, "/variation")).status, want, `GET variation on a ${name} link`);
        if (want !== 200) t.status((await send(link, base())).status, 404, `POST variation on a ${name} link`);
      }
      t.ok(n0 === (await dockets()), "nothing saved by any refused link");
      const homes = {};
      for (const [k, l] of Object.entries({ sup: L.sup, handover: L.handover, office: L.office, driver: L.driver })) homes[k] = (await call("GET", l, "")).body;
      t.ok(homes.sup?.variations === true && homes.handover?.variations === true, "the link home says variations on the supervisor and hand-over links");
      t.ok(homes.office && !("variations" in homes.office) && homes.driver && !("variations" in homes.driver), "...and not on the office or driver link");
      const v = (await call("GET", L.sup, "/variation")).body;
      const vj = v?.jobs?.find?.((j) => j.id === J.id);
      t.ok(!!vj && !v.jobs.some((j) => j.id === J2.id), "the supervisor sees its own job today, not another supervisor's", JSON.stringify(v?.jobs?.map((j) => j.id === J.id)));
      t.ok(vj?.projectName === P.name && vj?.jobNo === "26_999" && vj?.address === "1 Test St Wolli Creek" && vj?.day === c.today, "the project details are filled in", JSON.stringify(vj));
      t.ok(!!vj?.client && !vj.client.includes("$") && vj.client.includes("RC Client"), "a $ in the client's name never reaches the phone", vj?.client);
      t.ok(v?.lobosName === S.name, "Lobos sign-off is the link's person");
      t.ok(v?.itemMode === "LOADS", "28 Nov 2026: the phone gets the loads rows (How many loads + Material type)", v?.itemMode);
      const hv = (await call("GET", L.handover, "/variation")).body;
      t.ok(hv?.jobs?.length === 1 && hv.jobs[0].id === J.id && hv.lobosName === H.name, "the hand-over link sees only its own job");

      // ---- (2) refused, nothing saved ----
      t.status((await call("POST", L.expired, "/variation/media/start", { jobId: J.id, kind: "PHOTO", mime: "image/jpeg", size: 1000 })).status, 404, "VD-006: a photo start on an expired hand-over link");
      const n1 = await dockets();
      const refuse = [
        ["VD-004: an unknown required chunk in the Lobos signature", base({ lobosSignature: withText(CHROME_PNG) }), 400],
        ["VD-004: the same image as both signatures", base({ lobosSignature: PNG }), 400],
        ["no client signature", base({ customerSignature: null }), 400],
        ["no Lobos signature", base({ lobosSignature: "" }), 400],
        ["a JPEG as the client's signature", base({ customerSignature: JPEG_AS_PNG }), 400],
        ["HTML as the Lobos signature", base({ lobosSignature: HTML_AS_PNG }), 400],
        ["a $ figure in a task", base({ tasks: [{ description: "Extra wall $450", men: 1 }] }), 400],
        ["a money phrase in the note", base({ note: "client agreed 1200 dollars" }), 400],
        ["a $ figure in an item", base({ items: [{ quantity: 1, type: "Skip $380" }] }), 400],
        ["loads: a part load (2.5)", base({ items: [{ quantity: 2.5, type: "Mixed waste" }] }), 400],
        ["loads: no number of loads", base({ items: [{ type: "Mixed waste" }] }), 400],
        ["loads: no material type", base({ items: [{ quantity: 1, type: "" }] }), 400],
        ["a bad time", base({ tasks: [{ description: "Extra wall", start: "7am", finish: "9am" }] }), 400],
        ["no ticks", base({ ticks: [] }), 400],
        ["another supervisor's job", base({ jobId: J2.id }), 403],
      ];
      for (const [name, body, want] of refuse) t.status((await send(L.sup, body)).status, want, name);
      t.ok(/can't be identical/.test((await send(L.sup, base({ lobosSignature: PNG }))).body?.error ?? ""), "VD-004: \"The two signatures can't be identical\"");
      t.status((await send(L.handover, base({ jobId: J2.id }))).status, 403, "a hand-over link on a job it doesn't cover");
      t.ok((await dockets()) === n1, "nothing saved by any refused send");

      // ---- (3) send ----
      const r1 = await send(L.sup, base());
      t.status(r1.status, 201, "the supervisor sends a signed docket");
      const num1 = r1.body?.docket?.number;
      t.ok(/^V-\d{4,}$/.test(num1 ?? ""), "it gets a V-number", num1);
      const d1 = await db.variationDocket.findFirst({ where: { id: r1.body?.docket?.id ?? "-" }, include: { tasks: { orderBy: { n: "asc" } }, items: true, signatures: true } });
      t.ok(d1 && d1.jobId === J.id && d1.projectId === P.id && d1.linkKind === "SUPERVISOR" && d1.resourceId === S.id && d1.lobosName === S.name && d1.client === P.client, "saved with the job, project details, link kind and person");
      t.ok(d1?.tasks?.[0]?.hoursCalc === 10.5 && d1.tasks[0].hours === 10.5 && d1.tasks[1].hoursCalc === 6 && d1.tasks[1].hours === 5, "hours: 3 men x 3.5 h = 10.5; past midnight 2 x 3 = 6, the typed 5 kept beside it", JSON.stringify(d1?.tasks?.map((x) => [x.hours, x.hoursCalc])));
      t.ok(d1?.items?.length === 1 && d1.items[0].unit === "LOADS" && d1.items[0].quantity === 2 && d1.items[0].type === "Mixed waste", "the load row: 2 loads of mixed waste", JSON.stringify(d1?.items?.map((x) => [x.quantity, x.unit, x.type])));
      const sig = d1?.signatures ?? [];
      t.ok(sig.length === 2 && sig.every((s) => Buffer.from(s.png).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) && sig.map((s) => s.role).sort().join() === "CUSTOMER,LOBOS", "both signatures stored as real PNGs");
      const rh = await send(L.handover, base());
      t.status(rh.status, 201, "the hand-over link sends one on its own job");
      t.ok((await db.variationDocket.findUnique({ where: { id: rh.body?.docket?.id ?? "-" } }))?.linkKind === "HANDOVER", "...recorded as HANDOVER");
      const race = await Promise.all(Array.from({ length: 5 }, () => send(L.sup, base())));
      const nums = race.map((r) => Number((r.body?.docket?.number ?? "V-0").slice(2))).sort((a, b) => a - b);
      t.ok(race.every((r) => r.status === 201) && new Set(nums).size === 5 && nums[4] - nums[0] === 4, "five sent at once: five different, consecutive numbers", JSON.stringify(nums));
      t.ok((await db.variationDocket.groupBy({ by: ["number"], _count: { number: true }, having: { number: { _count: { gt: 1 } } } })).length === 0, "no docket number used twice on the copy");

      // ---- (5) office access ----
      const id1 = d1?.id ?? "-";
      for (const who of OFFICE_YES) {
        t.status(await c.get("/api/variations", who), 200, `${who} lists the dockets`);
        t.status(await c.get("/api/variations?summary=1", who), 200, `${who} reads the to-price card`);
        t.status(await c.get(`/api/variations/${id1}`, who), 200, `${who} opens a docket`);
      }
      for (const who of [...OFFICE_NO, null]) {
        const want = who ? 403 : 401;
        t.status(await c.get("/api/variations", who), want, `${who ?? "no login"} listing the dockets`);
        t.status(await c.get("/api/variations?summary=1", who), want, `${who ?? "no login"} reading the card`);
        t.status(await c.get(`/api/variations/${id1}`, who), want, `${who ?? "no login"} opening a docket`);
        t.status(await c.get(`/api/variations/${id1}/signature/customer`, who), want, `${who ?? "no login"} reading a signature`);
        t.status(await c.post(`/api/variations/${id1}/status`, who, { status: "PRICED" }), want, `${who ?? "no login"} setting the status`);
      }
      const sr = await c.get(`/api/variations/${id1}/signature/customer`, "COORDINATOR");
      const sb = Buffer.from(await sr.arrayBuffer());
      t.ok(sr.status === 200 && sr.headers.get("content-type") === "image/png" && sb.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) && /no-store/.test(sr.headers.get("cache-control") ?? ""), "the signature is a PNG, never cached");
      t.ok(sr.headers.get("content-security-policy") === "default-src 'none'; sandbox" && sr.headers.get("x-content-type-options") === "nosniff", "VD-004: the signature is served with a sandboxing CSP and nosniff", sr.headers.get("content-security-policy"));
      t.status(await c.get(`/api/variations/${id1}/signature/other`, "MANAGER"), 404, "an unknown signature role");
      for (const who of ["MANAGER", "COORDINATOR"]) {
        t.status(await c.get("/variations", who), 200, `the Variations page loads for ${who}`);
        t.status(await c.get(`/variations/${id1}`, who), 200, `the docket page loads for ${who}`);
      }
      const det = (await c.json(`/api/variations/${id1}`, "MANAGER")).body?.docket;
      t.ok(det?.number === num1 && det.status === "TO_PRICE" && det.taskRows?.[1]?.edited === true && det.signatures?.customer && det.signatures?.lobos, "the docket: To price, edited hours marked, both signatures");
      t.ok(!JSON.stringify(det ?? {}).includes("iVBOR"), "the docket's data never carries the signature bytes");
      t.ok(!Object.keys(det ?? {}).some((k) => /price|rate|amount|cost/i.test(k)), "no money field in the office docket");

      // ---- (6) status + (4) never edited ----
      const snap = async (id) => JSON.stringify(await db.variationDocket.findUnique({ where: { id }, include: { tasks: { orderBy: { n: "asc" } }, items: { orderBy: { n: "asc" } }, signatures: { select: { role: true, sha256: true, bytes: true } } } }));
      const before = await snap(id1);
      const evCount = () => db.variationStatusEvent.count({ where: { docketId: id1 } });
      const e0 = await evCount();
      t.status(await c.req("POST", `/api/variations/${id1}/status`, "COORDINATOR", { status: "PRICED", from: "TO_PRICE" }, { Origin: "https://evil.example" }), 403, "VD-006: a status POST from another site");
      // VD-002: the Building Agent login looks only.
      t.status(await c.get("/api/variations", "OPS_AI"), 200, "VD-002: the Building Agent login lists the dockets");
      const ag = await c.json(`/api/variations/${id1}`, "OPS_AI");
      t.ok(ag.status === 200 && ag.body?.docket?.canSetStatus === false && ag.body.docket.filesHidden === true && ag.body.docket.photoIds?.length === 0, "VD-002: ...and reads one with no status buttons, signatures or photos", JSON.stringify({ s: ag.status, c: ag.body?.docket?.canSetStatus, h: ag.body?.docket?.filesHidden }));
      const agS = await c.post(`/api/variations/${id1}/status`, "OPS_AI", { status: "PRICED", from: "TO_PRICE" });
      const agSb = await agS.json().catch(() => ({}));
      t.ok(agS.status === 403 && agSb.error === "The Building Agent login can't change a docket's status.", "VD-002: the Building Agent login can't change the status", `${agS.status} ${agSb.error}`);
      for (const role of ["customer", "lobos"]) t.status(await c.get(`/api/variations/${id1}/signature/${role}`, "OPS_AI"), 403, `VD-002: the Building Agent login can't open the ${role} signature`);
      t.ok((await evCount()) === e0, "VD-002 / VD-006: nothing saved by the refused status changes");
      const card0 = (await c.json("/api/variations?summary=1", "COORDINATOR")).body;
      const p1 = await c.post(`/api/variations/${id1}/status`, "COORDINATOR", { status: "PRICED", from: "TO_PRICE" });
      t.status(p1, 201, "the coordinator marks it Priced");
      t.status(await c.post(`/api/variations/${id1}/status`, "MANAGER", { status: "SENT_TO_CLIENT", from: "TO_PRICE" }), 409, "a stale page (still says To price)");
      t.status(await c.post(`/api/variations/${id1}/status`, "MANAGER", { status: "TO_PRICE", from: "PRICED" }), 400, "back a step with no reason");
      t.status(await c.post(`/api/variations/${id1}/status`, "MANAGER", { status: "SENT_TO_CLIENT", from: "PRICED", note: "priced at $900" }), 400, "an amount in the note");
      t.status(await c.post(`/api/variations/${id1}/status`, "MANAGER", { status: "SENT_TO_CLIENT", from: "PRICED" }), 201, "a Manager marks it Sent to client");
      const ev = await db.variationStatusEvent.findMany({ where: { docketId: id1 }, orderBy: { createdAt: "asc" } });
      t.ok(ev.length === 2 && ev[0].status === "PRICED" && ev[0].byUserId === c.users.COORDINATOR.id && ev[1].status === "SENT_TO_CLIENT" && ev[1].fromStatus === "PRICED", "every change kept, with who", JSON.stringify(ev.map((e) => e.status)));
      const sent = (await c.json("/api/variations?status=SENT_TO_CLIENT", "MANAGER")).body;
      t.ok(sent?.rows?.some?.((r) => r.id === id1) && !(await c.json("/api/variations?status=TO_PRICE", "MANAGER")).body?.rows?.some?.((r) => r.id === id1), "the status filter follows");
      const card1 = (await c.json("/api/variations?summary=1", "COORDINATOR")).body;
      t.ok(card1?.count === card0?.count - 1, "the to-price card drops by one", `${card0?.count} -> ${card1?.count}`);
      t.ok((await snap(id1)) === before, "the signed docket is byte-for-byte the same after the status changes");
      for (const m of ["PATCH", "PUT", "DELETE"]) {
        t.status((await call(m, L.sup, "/variation", base())).status, 405, `${m} on the link route`);
        t.status(await c.req(m, `/api/variations/${id1}`, "ADMIN", { customerName: "changed" }), 405, `${m} /api/variations/:id as an Admin`);
        t.status(await c.req(m, `/api/variations/${id1}/status`, "ADMIN", {}), 405, `${m} on the status route`);
      }
      t.status(await c.post(`/api/variations/${id1}`, "ADMIN", { customerName: "changed" }), 405, "POST /api/variations/:id");
      t.status(await c.post("/api/variations", "ADMIN", {}), 405, "POST /api/variations");
      t.ok((await snap(id1)) === before, "still the same after every write attempt");
      // A correction is a new docket.
      const fix = await send(L.sup, base({ replaces: num1, note: "corrected: 4 men not 3" }));
      t.status(fix.status, 201, "a correction is sent as a new docket naming the one it replaces");
      t.ok(fix.body?.docket?.replaces === num1 && fix.body.docket.number !== num1, "...with its own number, replacing the old one");
      t.ok((await snap(id1)) === before, "the original docket is unchanged");
      t.ok((await c.json(`/api/variations/${id1}`, "MANAGER")).body?.docket?.replacedBy?.startsWith(fix.body?.docket?.number ?? "-"), "the office sees it replaced by the correction");
      const n2 = await dockets();
      const hx = await send(L.handover, base({ replaces: num1 }));
      t.ok(hx.status === 400 && hx.body?.error === `You can only correct a docket you sent. Ask the supervisor who sent ${num1}, or the office.`, "VD-001: another person on the same job can't correct it", `${hx.status} ${hx.body?.error}`);
      t.ok((await dockets()) === n2, "VD-001: nothing saved");
      const fix2 = await send(L.sup, base({ replaces: num1, note: "corrected again: finish 11:00" }));
      t.status(fix2.status, 201, "VD-001: the sender corrects it a second time");
      const dd = (await c.json(`/api/variations/${id1}`, "MANAGER")).body?.docket;
      t.ok(JSON.stringify(dd?.corrections?.map((x) => x.number)) === JSON.stringify([fix.body?.docket?.number, fix2.body?.docket?.number]) && dd?.replacedBy === `${fix.body?.docket?.number}, ${fix2.body?.docket?.number}`,
        "VD-001: the office shows every correction, oldest first", JSON.stringify({ c: dd?.corrections?.map((x) => x.number), r: dd?.replacedBy }));
      const listed = (await c.json("/api/variations", "MANAGER")).body?.rows?.find?.((r) => r.id === id1);
      t.ok(listed?.replacedBy === dd?.replacedBy, "VD-001: ...on the list too", listed?.replacedBy);
      t.ok((await snap(id1)) === before, "the original is still unchanged after two corrections");
      const other = await send(L.sup2, base({ jobId: J2.id }));
      t.status(other.status, 201, "another supervisor sends one on their job");
      t.status((await send(L.sup, base({ replaces: other.body?.docket?.number }))).status, 400, "replacing another job's docket");

      // ---- (7) photos ----
      const op = async (link, name, body) => call("POST", link, `/variation/media/${name}`, body);
      const put = async (url, bytes, ct) => (await fetch(url, { method: "PUT", headers: ct ? { "Content-Type": ct } : {}, body: bytes })).status;
      const upload = async (link, jobId) => {
        const bytes = jpeg(40_000);
        const s = await op(link, "start", { area: "VARIATION", jobId, kind: "PHOTO", mime: "image/jpeg", size: bytes.length });
        if (s.status !== 201) return { start: s.status };
        await put(s.body.put.url, bytes, s.body.put.contentType);
        const done = await op(link, "complete", { mediaId: s.body.mediaId });
        return { start: s.status, done: done.status, ref: done.body?.ref, id: s.body.mediaId };
      };
      const up = await upload(L.sup, J.id);
      if (up.start === 201) {
        t.ok(up.done === 200 && up.ref === `media:${up.id}`, "a docket photo uploads to the (fake) bucket and is READY", JSON.stringify(up));
        t.status((await op(L.sup, "start", { jobId: J.id, kind: "VIDEO", mime: "video/mp4", size: 1000, durationSec: 5 })).status, 400, "a video is refused (photos only)");
        t.status((await op(L.sup, "start", { jobId: J2.id, kind: "PHOTO", mime: "image/jpeg", size: 1000 })).status, 403, "a photo for another supervisor's job");
        t.status((await op(L.driver, "start", { jobId: J.id, kind: "PHOTO", mime: "image/jpeg", size: 1000 })).status, 404, "a driver link can't upload docket photos");
        const up2 = await upload(L.sup2, J2.id);
        t.status((await send(L.sup, base({ photoIds: [up2.id ?? "nope0000000000"] }))).status, 400, "another link's photo on the docket");
        const withPhoto = await send(L.sup, base({ photoIds: [up.id] }));
        t.status(withPhoto.status, 201, "a docket with its photo");
        const pid = withPhoto.body?.docket?.id ?? "-";
        const pr = await c.get(`/api/variations/${pid}/photo/${up.id}`, "MANAGER");
        t.ok(pr.status === 302 && /no-store/.test(pr.headers.get("cache-control") ?? ""), "the office opens the photo (a no-store redirect to a signed read)", `${pr.status}`);
        t.status(await c.get(`/api/variations/${pid}/photo/${up.id}`, "VIEWER"), 403, "a Viewer can't");
        for (const who of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD", "OPS_AI"]) t.status(await c.get(`/api/variations/${pid}/photo/${up.id}`, who), 403, `VD-006 / VD-002: ${who} can't open the photo`);
        t.status(await c.get(`/api/variations/${id1}/photo/${up.id}`, "MANAGER"), 404, "a photo another docket doesn't cite");
        t.status((await call("GET", L.sup2, `/variation/media/${up.id}`)).status, 404, "another link can't read it back");
      } else t.note(`docket photos couldn't start (${up.start}) - the media bucket isn't set up on this run`);

      // ---- (8) the day's cap ----
      let ok3 = 0, last = 0;
      for (let i = 0; i < 31; i++) { const r = await send(L.sup3, base({ tasks: [{ description: `RC cap ${i}` }] })); last = r.status; if (r.status === 201) ok3 += 1; else break; }
      t.ok(ok3 === 30 && last === 429, "30 dockets a day on one link; the 31st 429", `${ok3} then ${last}`);
      t.ok((await db.variationDocket.count({ where: { siteLinkId: L.sup3.id } })) === 30, "nothing saved for the 31st");

      // ---- (9) the alert ----
      const sub = () => { const ecdh = createECDH("prime256v1"); ecdh.generateKeys(); return { ecdh, auth: randomBytes(16), keys: { p256dh: ecdh.getPublicKey().toString("base64url") } }; };
      const endpoint = (who) => `https://fcm.googleapis.com/fcm/send/rc-var-${who}-${tag}-${randomBytes(6).toString("hex")}`;
      const co = sub(), ow = sub(), coEp = endpoint("coord"), owEp = endpoint("owner"), adEp = endpoint("admin");
      const reg = (who, ep, s) => c.post("/api/push", who, { subscription: { endpoint: ep, keys: { p256dh: s.keys.p256dh, auth: s.auth.toString("base64url") } }, label: "RC variations" });
      t.status(await reg("COORDINATOR", coEp, co), 200, "the coordinator turns on alerts");
      t.status(await reg("OWNER", owEp, ow), 200, "the owner turns on alerts");
      t.status(await reg("ADMIN", adEp, sub()), 200, "another Admin turns on alerts");
      const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
      const guard = path.join(c.p.appDir, "scripts", "release-check", "lib", "outbound-guard.cjs");
      const runChild = (name, lines) => {
        const script = path.join(c.p.files, `rc108-${name}-${tag}.mts`);
        writeFileSync(script, lines.join("\n"));
        let out = "";
        try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: { ...process.env, ...(c.childEnv ?? {}), NODE_OPTIONS: `--require ${JSON.stringify(guard)}`, RELEASE_CHECK_NET_LOG: c.p.netLog }, encoding: "utf8", timeout: 120_000 }); }
        catch (e) { out = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
        try { return JSON.parse(out.split("\n").find((l) => l.startsWith("RESULT "))?.slice(7) ?? "null"); } catch { return null; }
      };
      const fileUrl = (rel) => "file:///" + path.join(c.p.appDir, ...rel.split("/")).split(path.sep).join("/").replace(/\[/g, "%5B").replace(/\]/g, "%5D");
      if (existsSync(tsxCli) && c.p.files) {
        const res = runChild("alert", [
          `import https from "node:https";`, `import { EventEmitter } from "node:events";`, `import { createRequire } from "node:module";`,
          `const req = createRequire(${JSON.stringify(path.join(c.p.appDir, "package.json"))});`,
          `const webpush = req("web-push"); const keys = webpush.generateVAPIDKeys();`,
          `process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.VAPID_SUBJECT = "mailto:release-check@example.test";`,
          `const seen = [];`,
          `https.request = (opts, cb) => { const r = new EventEmitter(); const chunks = []; r.write = (b) => { chunks.push(Buffer.from(b)); return true; }; r.destroy = () => {}; r.setTimeout = () => r;`,
          `  r.end = () => { seen.push({ host: opts.hostname, path: opts.path, body: Buffer.concat(chunks).toString("base64") }); const res = new EventEmitter(); res.statusCode = 201; res.headers = {}; cb(res); process.nextTick(() => res.emit("end")); }; return r; };`,
          `const { alertSigned } = await import(${JSON.stringify(fileUrl("src/lib/variations/store.ts"))});`,
          `const a = await alertSigned(${JSON.stringify(id1)}); const n1 = seen.length;`,
          `process.env.VARIATION_DOCKETS = "off"; const b = await alertSigned(${JSON.stringify(id1)}); const n2 = seen.length;`,
          `console.log("RESULT " + JSON.stringify({ a, b, n1, n2, seen })); process.exit(0);`,
        ]);
        const pathOf = (ep) => new URL(ep).pathname;
        const allowed = new Set((await db.pushDevice.findMany({ where: { user: { active: true, OR: [{ role: "COORDINATOR" }, { email: c.users.OWNER.email }] } }, select: { endpoint: true } })).map((d) => { try { const u = new URL(d.endpoint); return `${u.hostname}${u.pathname}`; } catch { return ""; } }));
        const toCo = (res?.seen ?? []).filter((s) => s.path === pathOf(coEp)), toOw = (res?.seen ?? []).filter((s) => s.path === pathOf(owEp));
        t.ok(!!res && toCo.length === 1 && toOw.length === 1, "the signed docket alert reached the coordinator's and the owner's phones (stub push host)", res ? JSON.stringify({ a: res.a, n: res.n1 }) : "child failed");
        t.ok(!!res && res.seen.every((s) => allowed.has(`${s.host}${s.path}`)) && !res.seen.some((s) => s.path === pathOf(adEp)), "...only coordinator / owner phones - never another Admin's");
        t.ok(res?.b === 0 && res?.n2 === res?.n1, "VARIATION_DOCKETS=off: no alert");
        let payload = null;
        try { payload = JSON.parse(createRequire(path.join(c.p.appDir, "package.json"))("http_ece").decrypt(Buffer.from(toCo[0].body, "base64"), { version: "aes128gcm", privateKey: co.ecdh, authSecret: co.auth }).toString("utf8")); }
        catch (e) { t.note(`couldn't decrypt the stubbed push: ${String(e?.message ?? e).slice(0, 120)}`); }
        t.ok(payload?.title === "Variation docket signed" && payload?.url === `/variations/${id1}` && payload?.body === `Variation ${num1} signed - ${P.name} (${S.name})`, "the alert's words and where it opens", JSON.stringify(payload));
        t.ok(!!payload && noMoney(JSON.stringify(payload)), "no money in the alert");

        // ---- (10) the kill switch ----
        const k = runChild("off", [
          `process.env.VARIATION_DOCKETS = "off";`,
          `const ctx = { params: Promise.resolve({ token: ${JSON.stringify(L.sup.secret)} }) };`,
          `const v = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/variation/route.ts"))});`,
          `const m = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/variation/media/[op]/route.ts"))});`,
          `const h = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/route.ts"))});`,
          `const g = await v.GET(new Request("http://x/"), ctx); const p = await v.POST(new Request("http://x/", { method: "POST", body: "{}" }), ctx);`,
          `const ms = await m.POST(new Request("http://x/", { method: "POST", body: "{}" }), { params: Promise.resolve({ token: ${JSON.stringify(L.sup.secret)}, op: "start" }) });`,
          `const home = await (await h.GET(new Request("http://x/"), ctx)).json();`,
          // VD-003: the office side never looks at the switch - its data still comes back (the store the office routes call).
          `const st = await import(${JSON.stringify(fileUrl("src/lib/variations/store.ts"))});`,
          `const list = await st.officeList({}); const card = await st.toPriceCard(); const one = await st.officeDetail(${JSON.stringify(id1)}, { id: "x", name: "RC", role: "MANAGER", email: "rc@release-check.test" });`,
          `const office = { list: list.rows.some((r) => r.id === ${JSON.stringify(id1)}), card: typeof card.count === "number", one: one?.id === ${JSON.stringify(id1)} };`,
          `console.log("RESULT " + JSON.stringify({ g: g.status, gBody: await g.json(), p: p.status, ms: ms.status, homeHas: "variations" in home, homePerson: home.person, office })); process.exit(0);`,
        ]);
        t.ok(k?.g === 503 && k?.p === 503 && k?.ms === 503 && /switched off/.test(k?.gBody?.error ?? ""), "VARIATION_DOCKETS=off: the link routes 503 with plain words", JSON.stringify(k));
        t.ok(k?.homePerson === S.name && k?.homeHas === false, "...and the link's home has no Variation docket tile");
        t.ok(k?.office?.list === true && k.office.card === true && k.office.one === true, "VD-003: with the switch off the office still reads the dockets (list, card, docket) - 200", JSON.stringify(k?.office));
        const offSrc = ["src/app/api/variations/route.ts", "src/app/api/variations/[id]/route.ts", "src/app/api/variations/[id]/status/route.ts"].map((rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return "variationsOn"; } });
        t.ok(offSrc.every((x) => !x.includes("variationsOn")), "VD-003: the office routes never check the switch (source)");
      } else t.block("no tsx in the candidate's node_modules - the alert and the kill switch couldn't be run");

      // ---- source: the tile, the office pages ----
      const src = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
      t.ok(/info\.variations && \(info\.kind === "SUPERVISOR" \|\| info\.kind === "HANDOVER"\)/.test(src("src/app/site/[token]/page.tsx")), "the tile shows on supervisor and hand-over links only (source)");
      t.ok(/disabled=\{!!missing \|\| busy\}/.test(src("src/components/site/VariationDocket.tsx")) && /!customerSig \? "The client needs to sign\."/.test(src("src/components/site/VariationDocket.tsx")), "Send stays off until the client has signed (source)");
      t.ok(src("src/components/site/VariationDocket.tsx").includes("Lobos keeps this docket, your name and signature as the record of this work."), "VD-005: the record line under the client's signature pad (source)");
      t.ok(/VariationsCard/.test(src("src/app/coordinator/page.tsx")), "the Variations to price card on the coordinator's dashboard (source)");

      // ---- (11) ----
      const bad = seen.filter(([, text]) => !noMoney(text));
      t.ok(bad.length === 0, "no dollar figure in any link reply", bad.map(([w]) => w).join(", "));
      t.ok(netLines(c) === net0, "no outbound call");
    } finally {
      await db.siteLink.updateMany({ where: { id: { in: made.links } }, data: { revokedAt: new Date() } }).catch(() => {});
      await db.resource.updateMany({ where: { id: { in: made.people } }, data: { active: false } }).catch(() => {});
      await db.project.updateMany({ where: { id: { in: made.projects } }, data: { status: "COMPLETED" } }).catch(() => {});
    }
  },
};
