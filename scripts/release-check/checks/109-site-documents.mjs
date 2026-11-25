// Site documents (Ilies approved 25 Nov 2026: "yes build it, deploy once it passes") - plans, SWMS sign-on, the pre-start
// meeting, the toolbox talk and the incident report on the supervisor's link; the office register; incidents for the
// owner and DIRECTOR logins only.
//   (1) Links: GET answers a SUPERVISOR link and a HANDOVER link on its own job only (DRIVER, POSTER, OFFICE, switched-off,
//       expired and made-up links 404, nothing saved); the link home says `siteDocs` on those two only.
//   (2) Office uploads by their bytes: a PDF plan, a JPEG plan, a PDF SWMS (v1); HTML called a PDF, a JPEG SWMS 400; the
//       Building Agent, a VIEWER and a DIRECTOR 403. Files: the link opens its own project's plan (application/pdf,
//       nosniff, inline, a CSP), never another project's or an archived one (404).
//   (3) The crew picker: today's sign-ins on that job, people only - not another job's, a removed or rejected sign-in, a
//       truck sign-in or the supervisor; a person not signed in can't sign anything (400).
//   (4) SWMS: a crew member signs v1 (201), again 409, the supervisor signs; v2 is uploaded -> signing v1 409, the same
//       person signs v2 (201); the register and "on site today and not signed" follow; the A4 sheet page loads.
//   (5) Pre-start: crew + supervisor signatures, 201 "Pre-start"; a second is "Pre-start 2"; another job's crew, the same
//       signature twice, a $ amount 400; a late arrival signs on (late), again 409; the record otherwise unchanged.
//       Toolbox talk: the coordinator sets the topic of the week (with a PDF), the link sees it, runs it, the tile says done.
//   (6) Incident: sent (201) -> the link gets number, date and type ONLY, never the words again; notifiable without the
//       prompt / answer 400, with it 201 (recorded); its photo through the fake bucket is readable on the link only until
//       it's sent; the access matrix - the owner and DIRECTOR 200; MANAGER, ADMIN (with the director tick), ADMIN_PLAIN,
//       MANAGER_DIRECTOR, COORDINATOR, VIEWER, ACCOUNTS, TIMESHEETS, YARD and the Building Agent 403; no login 401;
//       follow-up notes (append-only, stale 409); 10 a day a link (11th 429).
//   (7) The office pages matrix: MANAGER, ADMIN, the owner, COORDINATOR (and the Building Agent, read only) 200; VIEWER,
//       TIMESHEETS, ACCOUNTS, DIRECTOR, YARD 403; no login 401. Signatures image/png with a sandboxing CSP; the Building
//       Agent 403 on a signature.
//   (8) A POST from another site 403; PATCH / PUT / DELETE 405 on link and office routes.
//   (9) The owner's alert (alertIncident in a tsx child, throwaway VAPID keys, a stub push host) reaches the owner's phone
//       only, "Incident report INC-xxxx sent - <project> (<supervisor>)", no health detail, no money.
//  (10) SITE_DOCS=off (routes in a tsx child): the link routes 503, no tile; the office store still reads.
//  (11) No dollar figure in any link reply; no outbound call.
// WRITES on the test copy: made-up people, two projects with a job today each, sign-ins, links of every kind, files,
// SWMS versions, signatures, records, a topic, incident reports (all kept - append-only), a photo, test phone devices.
// Links revoked, people switched off and projects completed at the end.
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
// A real, different 2x2 PNG for every signer (the same drawing twice is refused).
let seed = 1;
const sig = () => {
  const n = seed++;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const px = (k) => [n & 255, (n >> 8) & 255, k * 40, 255];
  const raw = Buffer.from([0, ...px(1), ...px(2), 0, ...px(3), ...px(4)]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + png.toString("base64");
};
const PDF = (tag) => Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n`);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), randomBytes(2000)]);
const dataUrl = (mime, b) => `data:${mime};base64,${b.toString("base64")}`;
const OFFICE_YES = ["MANAGER", "ADMIN", "OWNER", "COORDINATOR"];
const OFFICE_NO = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"];
const INC_YES = ["OWNER", "DIRECTOR"];
const INC_NO = ["MANAGER", "ADMIN", "ADMIN_PLAIN", "MANAGER_DIRECTOR", "COORDINATOR", "VIEWER", "ACCOUNTS", "TIMESHEETS", "YARD", "OPS_AI"];

export default {
  id: "site-documents",
  title: "Site documents: SUPERVISOR + own-job HANDOVER links only, crew sign on from today's sign-ins, SWMS versions re-signed, pre-start / toolbox / late sign-on, incidents owner + DIRECTOR only, files by bytes, append-only, kill switch, no $, no outbound",
  writes: true, timeoutMs: 480_000,
  applies: (c) => c.hasPath("src/lib/siteDocs/rules.ts") || "needs lib/siteDocs/rules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    for (const k of [...OFFICE_YES, ...OFFICE_NO, ...INC_NO]) if (!c.users[k]) return t.block(`no ${k} test login`);
    const { readFileSync } = await import("node:fs");
    const net = () => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
    const net0 = net();
    const tag = Date.now().toString(36);
    const made = { people: [], links: [], projects: [] };
    const seen = []; // every link reply - scanned for "$" + digit at the end
    const call = async (method, link, rest, body, headers) => {
      const r = await c.req(method, c.site(link, rest), null, body, headers);
      const text = await r.text().catch(() => "");
      seen.push([`${method} ${rest}`, text]);
      let j = null; try { j = JSON.parse(text); } catch { /* */ }
      return { status: r.status, body: j, text, headers: r.headers };
    };
    try {
      // ---- seed ----
      const mk = async (name, extra = {}) => { const r = await db.resource.create({ data: { name: `${name} ${tag}`, type: "PERSONNEL", category: "Labourer", role: "Labourer", status: "AVAILABLE", ...extra } }); made.people.push(r.id); return r; };
      const S = await mk("RC Doc super S", { category: "Site Manager", role: "Supervisor" }), S2 = await mk("RC Doc super S2", { category: "Site Manager", role: "Supervisor" });
      const H = await mk("RC Doc stand-in H"), D = await mk("RC Doc driver D", { role: "Driver" }), O = await mk("RC Doc office O");
      const W1 = await mk("RC Doc crew W1"), W2 = await mk("RC Doc crew W2"), W3 = await mk("RC Doc removed W3"), W4 = await mk("RC Doc rejected W4"), W5 = await mk("RC Doc other job W5");
      const P = await db.project.create({ data: { name: `RC Doc job ${tag}`, status: "ACTIVE", address: "1 Test St Wolli Creek", jobNo: "26_998" } });
      const Q = await db.project.create({ data: { name: `RC Doc other job ${tag}`, status: "ACTIVE" } });
      made.projects.push(P.id, Q.id);
      const day = new Date(`${c.today}T00:00:00.000Z`);
      const J = await db.job.create({ data: { projectId: P.id, title: P.name, date: day, shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
      const J2 = await db.job.create({ data: { projectId: Q.id, title: Q.name, date: day, shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
      await db.assignment.create({ data: { jobId: J.id, resourceId: S.id, role: "Supervisor" } });
      await db.assignment.create({ data: { jobId: J2.id, resourceId: S2.id, role: "Supervisor" } });
      const at = new Date(Date.now() - 2 * 3600_000);
      const signIn = (job, data) => db.siteAttendance.create({ data: { jobId: job.id, date: c.today, signInAt: at, signInMethod: "SUPERVISOR_QR", ...data } });
      const a1 = await signIn(J, { resourceId: W1.id, workerName: W1.name }), a2 = await signIn(J, { resourceId: W2.id, workerName: W2.name });
      const aHire = await signIn(J, { resourceId: null, workerName: `RC Hire Joe ${tag}`, company: "Advanced Labour Hire" });
      const aRem = await signIn(J, { resourceId: W3.id, workerName: W3.name, removedAt: new Date(), status: "REJECTED" });
      const aRej = await signIn(J, { resourceId: W4.id, workerName: W4.name, status: "REJECTED" });
      const aSelf = await signIn(J, { resourceId: S.id, workerName: S.name });
      const aOther = await signIn(J2, { resourceId: W5.id, workerName: W5.name });
      const later = new Date(Date.now() + 36 * 3_600_000);
      const L = {
        sup: await makeLink(db, "SUPERVISOR", S.id), sup2: await makeLink(db, "SUPERVISOR", S2.id),
        handover: await makeLink(db, "HANDOVER", H.id, { jobId: J.id, expiresAt: later }),
        driver: await makeLink(db, "DRIVER", D.id), poster: await makeLink(db, "POSTER", null, { projectId: P.id }), office: await makeLink(db, "OFFICE", O.id),
        off: await makeLink(db, "SUPERVISOR", S.id, { revokedAt: new Date() }), expired: await makeLink(db, "HANDOVER", H.id, { jobId: J.id, expiresAt: new Date(Date.now() - 60_000) }),
      };
      for (const l of Object.values(L)) made.links.push(l.id);
      const fake = { secret: "y".repeat(32) };
      const counts = async () => JSON.stringify(await Promise.all([db.swmsSignature.count(), db.siteDocRecord.count(), db.siteDocSignature.count(), db.incidentReport.count()]));

      // ---- (1) links ----
      const n0 = await counts();
      for (const [name, link, want] of [["supervisor", L.sup, 200], ["hand-over", L.handover, 200], ["driver", L.driver, 404], ["poster", L.poster, 404], ["office", L.office, 404], ["switched-off", L.off, 404], ["expired hand-over", L.expired, 404], ["made-up", fake, 404]]) {
        t.status((await call("GET", link, "/documents")).status, want, `GET documents on a ${name} link`);
        if (want !== 200) {
          t.status((await call("POST", link, "/documents/records", { kind: "PRESTART", jobId: J.id, topics: [{ key: "SAFETY" }], crew: [], supervisorSignature: sig() })).status, 404, `POST a pre-start on a ${name} link`);
          t.status((await call("POST", link, "/documents/incident", {})).status, 404, `POST an incident on a ${name} link`);
        }
      }
      t.ok(n0 === (await counts()), "nothing saved by any refused link");
      const homes = {};
      for (const [k, l] of Object.entries({ sup: L.sup, handover: L.handover, office: L.office, driver: L.driver })) homes[k] = (await call("GET", l, "")).body;
      t.ok(!!homes.sup?.siteDocs && !!homes.handover?.siteDocs, "the link home has the Site documents tile on the supervisor and hand-over links", JSON.stringify(homes.sup?.siteDocs));
      t.ok(homes.office && !("siteDocs" in homes.office) && homes.driver && !("siteDocs" in homes.driver), "...and not on the office or driver link");
      t.ok(homes.sup?.siteDocs?.toolboxDue === true, "the tile says the toolbox talk is due this week");

      // ---- (2) office uploads ----
      const up = (who, body) => c.post("/api/site-documents/files", who, body);
      const planP = await up("MANAGER", { projectId: P.id, kind: "PLAN", title: "Level 2 demolition plan", fileName: "plan-l2.pdf", dataUrl: dataUrl("application/pdf", PDF("plan")) });
      t.status(planP, 201, "a Manager uploads a PDF plan");
      const planPId = (await planP.json().catch(() => ({})))?.file?.id ?? "-";
      const photoP = await up("COORDINATOR", { projectId: P.id, kind: "PLAN", title: "Site access photo", fileName: "access.jpg", dataUrl: dataUrl("image/jpeg", JPEG) });
      t.status(photoP, 201, "the coordinator uploads a JPEG plan");
      const photoPId = (await photoP.json().catch(() => ({})))?.file?.id ?? "-";
      const planQ = await up("ADMIN", { projectId: Q.id, kind: "PLAN", title: "Other job plan", fileName: "q.pdf", dataUrl: dataUrl("application/pdf", PDF("q")) });
      const planQId = (await planQ.json().catch(() => ({})))?.file?.id ?? "-";
      const v1r = await up("MANAGER", { projectId: P.id, kind: "SWMS", title: "Demolition SWMS", fileName: "swms.pdf", dataUrl: dataUrl("application/pdf", PDF("swms v1")) });
      const v1 = (await v1r.json().catch(() => ({})))?.file;
      t.ok(v1r.status === 201 && v1?.version === 1, "a SWMS upload is version 1", JSON.stringify(v1));
      const files0 = await db.siteDocFile.count();
      t.status(await up("MANAGER", { projectId: P.id, kind: "PLAN", title: "Evil", fileName: "evil.pdf", dataUrl: dataUrl("application/pdf", Buffer.from("<html><script>alert(1)</script></html>")) }), 400, "HTML called a PDF (magic bytes)");
      t.status(await up("MANAGER", { projectId: P.id, kind: "PLAN", title: "Disguised", fileName: "x.png", dataUrl: dataUrl("image/png", PDF("x")) }), 400, "a PDF labelled PNG");
      t.status(await up("MANAGER", { projectId: P.id, kind: "SWMS", title: "Photo SWMS", fileName: "swms.jpg", dataUrl: dataUrl("image/jpeg", JPEG) }), 400, "a JPEG as a SWMS");
      t.status(await up("MANAGER", { projectId: P.id, kind: "PLAN", title: "Plan $500", fileName: "p.pdf", dataUrl: dataUrl("application/pdf", PDF("p")) }), 400, "a $ in the title");
      t.status(await up("OPS_AI", { projectId: P.id, kind: "PLAN", title: "Agent plan", fileName: "a.pdf", dataUrl: dataUrl("application/pdf", PDF("a")) }), 403, "the Building Agent can't upload");
      for (const who of ["VIEWER", "DIRECTOR", "ACCOUNTS", "YARD", "TIMESHEETS"]) t.status(await up(who, { projectId: P.id, kind: "PLAN", title: "x", fileName: "a.pdf", dataUrl: dataUrl("application/pdf", PDF("a")) }), 403, `${who} can't upload`);
      t.status(await c.req("POST", "/api/site-documents/files", "MANAGER", { projectId: P.id, kind: "PLAN", title: "x", fileName: "a.pdf", dataUrl: dataUrl("application/pdf", PDF("a")) }, { Origin: "https://evil.example" }), 403, "an upload from another site");
      t.ok((await db.siteDocFile.count()) === files0, "nothing saved by any refused upload");
      // Archive one plan: hidden from the link, never deleted.
      t.status(await c.post(`/api/site-documents/files/${photoPId}/archive`, "OPS_AI", { note: "agent tidy" }), 403, "the Building Agent can't archive");
      t.status(await c.post(`/api/site-documents/files/${photoPId}/archive`, "MANAGER", {}), 400, "archiving needs a reason");
      t.status(await c.post(`/api/site-documents/files/${photoPId}/archive`, "MANAGER", { note: "Wrong photo" }), 201, "a Manager archives a plan with a reason");
      t.status(await c.post(`/api/site-documents/files/${photoPId}/archive`, "MANAGER", { note: "Again" }), 409, "...once");
      t.ok(!!(await db.siteDocFile.findUnique({ where: { id: photoPId } })), "the archived file's row is still there");
      const view0 = (await call("GET", L.sup, "/documents")).body;
      const vj = view0?.jobs?.find?.((j) => j.id === J.id);
      t.ok(!!vj && !view0.jobs.some((j) => j.id === J2.id), "the supervisor sees its own job today, not another supervisor's");
      t.ok(vj?.plans?.length === 1 && vj.plans[0].id === planPId, "the link lists its project's plan - not the archived one, not another project's", JSON.stringify(vj?.plans));
      const pf = await call("GET", L.sup, `/documents/files/${planPId}`);
      t.ok(pf.status === 200 && pf.headers.get("content-type") === "application/pdf" && pf.headers.get("x-content-type-options") === "nosniff" && /^inline; filename="/.test(pf.headers.get("content-disposition") ?? "") && /default-src 'none'/.test(pf.headers.get("content-security-policy") ?? "") && pf.text.startsWith("%PDF-"),
        "the link opens its plan: application/pdf, nosniff, inline, a CSP", `${pf.status} ${pf.headers.get("content-type")} ${pf.headers.get("content-security-policy")}`);
      t.status((await call("GET", L.sup, `/documents/files/${planQId}`)).status, 404, "another project's plan (cross-project)");
      t.status((await call("GET", L.sup2, `/documents/files/${planPId}`)).status, 404, "another supervisor's link can't open this project's plan");
      t.status((await call("GET", L.sup, `/documents/files/${photoPId}`)).status, 404, "an archived plan");
      t.status((await call("GET", L.sup, `/documents/files/${"z".repeat(25)}`)).status, 404, "a made-up file");
      const sj = await c.get(`/api/site-documents/files/${photoPId}`, "COORDINATOR");
      t.ok(sj.status === 200 && sj.headers.get("content-type") === "image/jpeg" && /sandbox/.test(sj.headers.get("content-security-policy") ?? ""), "the office still opens the archived JPEG (image/jpeg, sandbox CSP)");

      // ---- (3) the crew picker ----
      const crewIds = (vj?.crew ?? []).map((x) => x.id);
      t.ok(crewIds.includes(a1.id) && crewIds.includes(a2.id) && crewIds.includes(aHire.id), "today's crew on the job: staff and the hire worker", JSON.stringify(crewIds.length));
      t.ok(![aRem.id, aRej.id, aSelf.id, aOther.id].some((x) => crewIds.includes(x)), "never a removed / rejected sign-in, the supervisor, or another job's");
      t.ok(vj?.crew?.find?.((x) => x.id === aHire.id)?.company === "Advanced Labour Hire", "the hire worker shows with their company");

      // ---- (4) SWMS ----
      const swms = (body) => call("POST", L.sup, "/documents/swms", { jobId: J.id, fileId: v1?.id, understood: true, signature: sig(), ...body });
      const nS = await db.swmsSignature.count();
      for (const [name, body, want] of [
        ["another job's crew member", { attendanceId: aOther.id }, 400], ["a removed sign-in", { attendanceId: aRem.id }, 400], ["a rejected sign-in", { attendanceId: aRej.id }, 400],
        ["not ticked", { attendanceId: a1.id, understood: false }, 400], ["no signature", { attendanceId: a1.id, signature: null }, 400],
        ["a JPEG signature", { attendanceId: a1.id, signature: dataUrl("image/png", JPEG) }, 400], ["another supervisor's job", { attendanceId: a1.id, jobId: J2.id }, 403],
        ["a file that isn't the SWMS", { attendanceId: a1.id, fileId: planPId }, 409],
      ]) t.status((await swms(body)).status, want, `SWMS sign-on refused: ${name}`);
      t.ok((await db.swmsSignature.count()) === nS, "nothing saved by any refused SWMS sign-on");
      const s1 = await swms({ attendanceId: a1.id });
      t.status(s1.status, 201, "W1 signs SWMS v1");
      t.status((await swms({ attendanceId: a1.id })).status, 409, "W1 again on v1 (one a person a version)");
      t.status((await swms({ supervisor: true })).status, 201, "the supervisor signs v1");
      t.status((await call("POST", L.handover, "/documents/swms", { jobId: J.id, fileId: v1?.id, understood: true, signature: sig(), attendanceId: aHire.id })).status, 201, "the hand-over link signs the hire worker on (its own job)");
      const v2r = await up("MANAGER", { projectId: P.id, kind: "SWMS", title: "Demolition SWMS rev B", fileName: "swms-b.pdf", dataUrl: dataUrl("application/pdf", PDF("swms v2")) });
      const v2 = (await v2r.json().catch(() => ({})))?.file;
      t.ok(v2r.status === 201 && v2?.version === 2, "a second SWMS upload is version 2");
      t.status((await swms({ attendanceId: a2.id })).status, 409, "signing the superseded v1 after v2 is uploaded");
      t.status((await swms({ attendanceId: a1.id, fileId: v2?.id })).status, 201, "a new version: W1 signs again (v2)");
      const reg1 = (await c.json(`/api/site-documents/swms/${v1?.id}`, "MANAGER")).body;
      const reg2 = (await c.json(`/api/site-documents/swms/${v2?.id}`, "COORDINATOR")).body;
      t.ok(reg1?.signatures?.length === 3 && reg1.file?.current === false && reg2?.signatures?.length === 1 && reg2.file?.current === true, "the register: v1 three sign-ons (superseded), v2 one (current)", JSON.stringify({ a: reg1?.signatures?.length, b: reg2?.signatures?.length }));
      const notSigned = (reg2?.notSigned ?? []).map((x) => x.name);
      t.ok(notSigned.includes(W2.name) && notSigned.some((n) => n.includes("RC Hire Joe")) && !notSigned.includes(W1.name), "on site today and not signed v2: W2 and the hire worker, not W1", JSON.stringify(notSigned));
      const prj = (await c.json(`/api/site-documents?projectId=${P.id}`, "MANAGER")).body;
      t.ok(prj?.currentSwmsId === v2?.id && prj?.swms?.find?.((x) => x.id === v1?.id)?.superseded === true, "the project shows v2 current, v1 superseded");
      const vs = (await call("GET", L.sup, "/documents")).body?.jobs?.find?.((j) => j.id === J.id);
      t.ok(vs?.swms?.id === v2?.id && vs.swms.version === 2 && vs.crew.find((x) => x.id === a1.id)?.swmsSigned === true && vs.crew.find((x) => x.id === a2.id)?.swmsSigned === false, "the link: v2 current, W1 signed, W2 not");
      t.status((await call("GET", L.sup, `/documents/files/${v1?.id}`)).status, 404, "the link can't open the superseded SWMS");
      t.status((await call("GET", L.sup, `/documents/files/${v2?.id}`)).status, 200, "...it opens the current one");
      t.status(await c.get(`/site-documents/swms/${v2?.id}`, "MANAGER"), 200, "the A4 sign-on sheet page loads");
      // The coordinator from his dashboard (Ilies, 25 Nov 2026: "allow him to upload documents aswell from his dashboard
      // which the crew get on their apps"): a plan and a new SWMS version, then they're on the supervisor's link.
      const cPlan = await up("COORDINATOR", { projectId: P.id, kind: "PLAN", title: `RC coordinator drawing ${tag}`, fileName: "drawing.pdf", dataUrl: dataUrl("application/pdf", PDF("coord plan")) });
      t.status(cPlan, 201, "the coordinator uploads a plan");
      const cPlanId = (await cPlan.json().catch(() => ({})))?.file?.id ?? "-";
      const cSw = await up("COORDINATOR", { projectId: P.id, kind: "SWMS", title: "Demolition SWMS rev C", fileName: "swms-c.pdf", dataUrl: dataUrl("application/pdf", PDF("swms v3")) });
      const v3 = (await cSw.json().catch(() => ({})))?.file;
      t.ok(cSw.status === 201 && v3?.version === 3, "the coordinator uploads a new SWMS version (v3)", JSON.stringify(v3));
      const vc = (await call("GET", L.sup, "/documents")).body?.jobs?.find?.((j) => j.id === J.id);
      t.ok(vc?.plans?.some?.((p) => p.id === cPlanId) && vc?.swms?.id === v3?.id && vc.swms.version === 3 && vc.crew.every((x) => x.swmsSigned === false), "...both show on the supervisor's link for that project (v3 current, nobody signed it yet)");
      t.status((await call("GET", L.sup, `/documents/files/${cPlanId}`)).status, 200, "...and the supervisor opens the coordinator's plan");
      t.status((await call("GET", L.sup2, `/documents/files/${cPlanId}`)).status, 404, "...another project's supervisor can't");
      const sum = (await c.json("/api/site-documents?summary=1", "COORDINATOR")).body;
      t.ok(typeof sum?.notSigned === "number" && sum.projects?.some?.((p) => p.id === P.id && p.hasSwms && p.notSigned >= 3), "the coordinator's card summary: people on site today who haven't signed the current SWMS", JSON.stringify(sum?.projects?.find?.((p) => p.id === P.id)));
      for (const who of ["VIEWER", "DIRECTOR", "ACCOUNTS", "YARD"]) t.status(await c.get("/api/site-documents?summary=1", who), 403, `${who} reading the card summary`);
      t.status(await c.get("/coordinator", "COORDINATOR"), 200, "the coordinator's dashboard loads");

      // ---- (5) pre-start ----
      const rec = (link, body) => call("POST", link, "/documents/records", body);
      const pre = (x = {}) => ({ kind: "PRESTART", jobId: J.id, topics: [{ key: "SAFETY", notes: `RC edge protection ${tag}` }, { key: "PPE" }, { key: "OTHER", notes: "Crane lift 10am" }], notes: "",
        crew: [{ attendanceId: a1.id, understood: true, signature: sig() }, { attendanceId: a2.id, understood: true, signature: sig() }], supervisorSignature: sig(), ...x });
      const nR = await counts();
      const dup = sig();
      for (const [name, body] of [
        ["another job's crew", pre({ crew: [{ attendanceId: aOther.id, understood: true, signature: sig() }] })],
        ["the same signature twice", pre({ crew: [{ attendanceId: a1.id, understood: true, signature: dup }], supervisorSignature: dup })],
        ["a $ amount", pre({ notes: "crane hire $900" })], ["no topic", pre({ topics: [] })], ["not ticked", pre({ crew: [{ attendanceId: a1.id, understood: false, signature: sig() }] })],
        ["no supervisor signature", pre({ supervisorSignature: null })],
      ]) t.status((await rec(L.sup, body)).status, 400, `pre-start refused: ${name}`);
      t.status((await rec(L.sup, pre({ jobId: J2.id }))).status, 403, "a pre-start on another supervisor's job");
      t.ok((await counts()) === nR, "nothing saved by any refused pre-start");
      const p1 = await rec(L.sup, pre());
      t.ok(p1.status === 201 && p1.body?.record?.label === "Pre-start", "a pre-start with two crew and the supervisor", `${p1.status} ${p1.body?.error ?? p1.body?.record?.label}`);
      const pid = p1.body?.record?.id ?? "-";
      const p2 = await rec(L.handover, pre({ crew: [] }));
      t.ok(p2.status === 201 && p2.body?.record?.label === "Pre-start 2", "a second one that day is \"Pre-start 2\" (the hand-over link, no crew yet)", p2.body?.record?.label);
      const snapRec = async (id) => JSON.stringify(await db.siteDocRecord.findUnique({ where: { id }, select: { kind: true, seq: true, jobId: true, content: true, notes: true, supervisorName: true, createdAt: true } }));
      const before = await snapRec(pid);
      const late = (x = {}) => call("POST", L.sup, `/documents/records/${pid}/sign`, { attendanceId: aHire.id, understood: true, signature: sig(), ...x });
      t.status((await late({ attendanceId: aOther.id })).status, 400, "a late sign-on by someone not signed in on the job");
      t.status((await call("POST", L.sup2, `/documents/records/${pid}/sign`, { attendanceId: aHire.id, understood: true, signature: sig() })).status, 403, "another supervisor's link can't add to it");
      const l1 = await late();
      t.ok(l1.status === 201 && l1.body?.record?.signed?.some?.((s) => s.late) && l1.body.record.signedCrew.includes(aHire.id), "a late arrival signs on (marked late)", `${l1.status} ${l1.body?.error ?? ""}`);
      t.status((await late()).status, 409, "...once");
      t.status((await late({ attendanceId: a1.id })).status, 409, "someone already on it can't sign twice");
      const sigs = await db.siteDocSignature.findMany({ where: { recordId: pid }, select: { role: true, late: true, attendanceId: true } });
      t.ok(sigs.length === 4 && sigs.filter((s) => s.role === "SUPERVISOR").length === 1 && sigs.filter((s) => s.late).length === 1, "the record: 2 crew + the supervisor + 1 late sign-on", JSON.stringify(sigs.map((s) => [s.role, s.late])));
      t.ok((await snapRec(pid)) === before, "the record itself is unchanged after the late sign-on");

      // ---- toolbox talk + topic of the week ----
      const monday = (() => { const d = new Date(`${c.today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
      t.status(await c.post("/api/site-documents/topic", "OPS_AI", { week: monday, title: "Agent topic", points: ["x"] }), 403, "the Building Agent can't set the topic");
      t.status(await c.post("/api/site-documents/topic", "COORDINATOR", { week: (() => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 2); return d.toISOString().slice(0, 10); })(), title: "Not a Monday", points: [] }), 400, "a topic week must be a Monday");
      const tp = await c.post("/api/site-documents/topic", "COORDINATOR", { week: monday, title: `RC Silica dust ${tag}`, points: ["Wet cutting", "P2 masks on"], fileName: "silica.pdf", dataUrl: dataUrl("application/pdf", PDF("topic")) });
      t.status(tp, 201, "the coordinator sets this week's topic with a PDF");
      const vt = (await call("GET", L.sup, "/documents")).body;
      t.ok(vt?.topic?.title === `RC Silica dust ${tag}` && vt.topic.points.length === 2 && vt.topic.hasPdf === true, "the link sees the topic of the week");
      const tf = await call("GET", L.sup, `/documents/topic/${vt?.topic?.id}`);
      t.ok(tf.status === 200 && tf.headers.get("content-type") === "application/pdf", "the link opens the topic PDF");
      t.status((await call("GET", L.sup, `/documents/topic/${"q".repeat(25)}`)).status, 404, "another topic id");
      const tb = await rec(L.sup, { kind: "TOOLBOX", jobId: J.id, source: "OFFICE", topicId: vt?.topic?.id, points: "Went through wet cutting", sitePoints: "Level 3 slab saw", crew: [{ attendanceId: a2.id, understood: true, signature: sig() }], supervisorSignature: sig() });
      t.ok(tb.status === 201 && tb.body?.record?.label === "Toolbox talk" && tb.body.record.title === `RC Silica dust ${tag}`, "a toolbox talk on the topic of the week", `${tb.status} ${tb.body?.error ?? ""}`);
      t.status((await rec(L.sup, { kind: "TOOLBOX", jobId: J.id, source: "OFFICE", topicId: "x".repeat(25), points: "abc", crew: [], supervisorSignature: sig() })).status, 409, "a stale topic of the week");
      const vt2 = (await call("GET", L.sup, "/documents")).body?.jobs?.find?.((j) => j.id === J.id);
      t.ok(vt2?.toolboxDone === true && (await call("GET", L.sup, "")).body?.siteDocs?.toolboxDue === false, "the tile now says the toolbox talk is done this week");
      const rd = (await c.json(`/api/site-documents/records/${tb.body?.record?.id}`, "MANAGER")).body?.record;
      t.ok(rd?.toolbox?.source === "OFFICE" && rd.toolbox.officePoints?.length === 2 && rd.signatures?.length === 2, "the office's record: the topic, its points and the signatures");
      t.status(await c.get(`/site-documents/records/${pid}`, "COORDINATOR"), 200, "the printable record page loads");

      // ---- (6) incidents ----
      const inc = (link, x = {}) => call("POST", link, "/documents/incident", {
        jobId: J.id, type: "NEAR_MISS", treatment: "NONE", bodyPart: "Not applicable", occurredAt: (() => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() - 600_000)).map((q) => [q.type, q.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; })(),
        location: "Level 3 east stairs", people: [a1.id], others: "", whatHappened: `RC secret words ${tag}: ply sheet slid off the stack`, immediateAction: "Taped off, re-strapped", witnesses: "", serious: false,
        promptShown: false, safeworkCalled: null, photoIds: [], signature: sig(), ...x,
      });
      const nI = await db.incidentReport.count();
      t.status((await inc(L.sup, { type: "DANGEROUS" })).status, 400, "a dangerous incident without the SafeWork box shown");
      t.status((await inc(L.sup, { treatment: "MEDICAL", promptShown: true })).status, 400, "medical treatment without the SafeWork answer");
      t.status((await inc(L.sup, { people: [aOther.id] })).status, 400, "a person not signed in on this job");
      t.status((await inc(L.sup, { whatHappened: "Broke the client's door, about $2,000" })).status, 400, "a $ amount");
      t.status((await inc(L.sup, { jobId: J2.id })).status, 403, "another supervisor's job");
      t.ok((await db.incidentReport.count()) === nI, "nothing saved by any refused report");
      // A photo through the (fake) bucket: readable on the link only until the report is sent.
      const op = (name, body) => call("POST", L.sup, `/documents/media/${name}`, body);
      const bytes = JPEG;
      const st = await op("start", { area: "INCIDENT", jobId: J.id, kind: "PHOTO", mime: "image/jpeg", size: bytes.length });
      let photoId = null;
      if (st.status === 201) {
        await fetch(st.body.put.url, { method: "PUT", headers: { "Content-Type": st.body.put.contentType }, body: bytes });
        const done = await op("complete", { mediaId: st.body.mediaId });
        photoId = done.status === 200 ? st.body.mediaId : null;
        t.ok(!!photoId, "an incident photo uploads (fake bucket, READY)", `${done.status}`);
        t.status((await op("start", { jobId: J.id, kind: "VIDEO", mime: "video/mp4", size: 1000, durationSec: 5 })).status, 400, "a video is refused (photos only)");
        t.status((await op("start", { jobId: J2.id, kind: "PHOTO", mime: "image/jpeg", size: 1000 })).status, 403, "a photo for another supervisor's job");
        t.status((await call("GET", L.sup, `/documents/media/${photoId}`)).status, 302, "the link previews its photo before sending");
      } else t.note(`incident photos couldn't start (${st.status}) - the media bucket isn't set up on this run`);
      const i1 = await inc(L.sup, { photoIds: photoId ? [photoId] : [] });
      t.status(i1.status, 201, "the supervisor sends a near miss");
      const keys = Object.keys(i1.body?.incident ?? {}).sort().join();
      t.ok(keys === "day,number,sentAt,type" && /^INC-\d{4,}$/.test(i1.body.incident.number), "the link gets back number, date and type ONLY", keys);
      const num1 = i1.body?.incident?.number;
      const row1 = await db.incidentReport.findFirst({ where: { number: Number((num1 ?? "INC-0").slice(4)) } });
      const iid = row1?.id ?? "-";
      t.ok(!!row1 && row1.siteLinkId === L.sup.id && row1.people.includes(W1.name) && row1.notifiable === false, "saved with the crew member picked, not notifiable");
      if (photoId) {
        t.status((await call("GET", L.sup, `/documents/media/${photoId}`)).status, 404, "after Send the link can't read the photo back");
        t.status((await call("GET", L.sup, `/media/${photoId}`)).status, 404, "...nor through the daily log's media route");
        const po = await c.get(`/api/directors/incidents/${iid}/photo/${photoId}`, "OWNER");
        t.ok(po.status === 302 && /no-store/.test(po.headers.get("cache-control") ?? ""), "the owner opens the photo (a no-store redirect)", `${po.status}`);
        t.status(await c.get(`/api/directors/incidents/${iid}/photo/${photoId}`, "MANAGER"), 403, "a Manager can't");
      }
      const i2 = await inc(L.handover, { type: "INJURY", treatment: "LOST_TIME", bodyPart: "Hand", promptShown: true, safeworkCalled: "NOT_YET" });
      t.status(i2.status, 201, "a lost-time injury with the SafeWork box shown and answered (hand-over link)");
      const row2 = await db.incidentReport.findFirst({ where: { number: Number((i2.body?.incident?.number ?? "INC-0").slice(4)) } });
      t.ok(row2?.notifiable === true && row2.promptShown === true && row2.safeworkCalled === "NOT_YET" && row2.linkKind === "HANDOVER", "the prompt and the answer are recorded");
      const lv = await call("GET", L.sup, "/documents");
      t.ok(lv.body?.incidents?.some?.((x) => x.number === num1) && lv.body.incidents.every((x) => Object.keys(x).sort().join() === "day,number,sentAt,type") && !lv.text.includes(`RC secret words ${tag}`), "the link's list: number, date and type only - never the words");
      for (const who of INC_YES) {
        t.status(await c.get("/api/directors/incidents", who), 200, `${who} lists incident reports`);
        t.status(await c.get(`/api/directors/incidents/${iid}`, who), 200, `${who} opens one`);
        t.status(await c.get(`/api/directors/incidents/${iid}/signature`, who), 200, `${who} sees the signature`);
      }
      for (const who of [...INC_NO, null]) {
        const want = who ? 403 : 401;
        t.status(await c.get("/api/directors/incidents", who), want, `${who ?? "no login"} listing incident reports`);
        t.status(await c.get(`/api/directors/incidents/${iid}`, who), want, `${who ?? "no login"} opening one`);
        t.status(await c.get(`/api/directors/incidents/${iid}/signature`, who), want, `${who ?? "no login"} its signature`);
        t.status(await c.post(`/api/directors/incidents/${iid}/events`, who, { kind: "INVESTIGATION", note: "nosy" }), want, `${who ?? "no login"} adding a note`);
      }
      const det = (await c.json(`/api/directors/incidents/${iid}`, "DIRECTOR")).body?.incident;
      t.ok(det?.whatHappened?.includes(`RC secret words ${tag}`) && det.status === "OPEN" && det.hasSignature, "a DIRECTOR reads the details, Open");
      const snapInc = async () => JSON.stringify(await db.incidentReport.findUnique({ where: { id: iid } }));
      const b4 = await snapInc();
      t.status(await c.post(`/api/directors/incidents/${iid}/events`, "DIRECTOR", { kind: "INVESTIGATION", note: "Spoke to the crew", from: "OPEN" }), 201, "a DIRECTOR adds an investigation note");
      t.status(await c.post(`/api/directors/incidents/${iid}/events`, "OWNER", { kind: "CLOSED", note: "Done", from: "OPEN" }), 409, "a stale page");
      t.status(await c.post(`/api/directors/incidents/${iid}/events`, "OWNER", { kind: "CLOSED", note: "", from: "INVESTIGATING" }), 400, "closing needs a note");
      t.status(await c.post(`/api/directors/incidents/${iid}/events`, "OWNER", { kind: "CLOSED", note: "New straps on every stack", from: "INVESTIGATING" }), 201, "the owner closes it");
      t.status(await c.req("POST", `/api/directors/incidents/${iid}/events`, "OWNER", { kind: "REOPENED", note: "x y z", from: "CLOSED" }, { Origin: "https://evil.example" }), 403, "a follow-up POST from another site");
      const ev = await db.incidentEvent.findMany({ where: { incidentId: iid }, orderBy: { createdAt: "asc" } });
      t.ok(ev.length === 2 && ev[0].status === "INVESTIGATING" && ev[1].status === "CLOSED" && ev[1].byUserId === c.users.OWNER.id, "both notes kept, with who");
      t.ok((await snapInc()) === b4, "the report itself is byte-for-byte the same");
      for (const pg of ["/incidents", `/incidents/${iid}`, "/directors/incidents"]) t.status(await c.get(pg, pg.startsWith("/directors") ? "DIRECTOR" : "OWNER"), 200, `page ${pg.replace(iid, ":id")} loads`);
      // 10 reports a link a Sydney day.
      let okN = await db.incidentReport.count({ where: { siteLinkId: L.sup.id } }), last = 0;
      while (okN < 11) { const r = await inc(L.sup); last = r.status; if (r.status !== 201) break; okN++; }
      t.ok(okN === 10 && last === 429, "10 incident reports a day on one link; the 11th 429", `${okN} then ${last}`);

      // ---- (7) office pages matrix ----
      const recId = pid;
      const sigRow = await db.siteDocSignature.findFirst({ where: { recordId: recId }, select: { id: true } });
      const swRow = await db.swmsSignature.findFirst({ where: { fileId: v1?.id ?? "-" }, select: { id: true } });
      const officeGets = ["/api/site-documents", `/api/site-documents?projectId=${P.id}`, "/api/site-documents/records", `/api/site-documents/records/${recId}`, `/api/site-documents/swms/${v1?.id}`, "/api/site-documents/topic", `/api/site-documents/files/${planPId}`];
      for (const who of [...OFFICE_YES, "OPS_AI"]) for (const g of officeGets) t.status(await c.get(g, who), 200, `${who} GET ${g.replace(/[a-z0-9]{20,}/g, ":id")}`);
      for (const who of [...OFFICE_NO, null]) {
        const want = who ? 403 : 401;
        for (const g of officeGets) t.status(await c.get(g, who), want, `${who ?? "no login"} GET ${g.replace(/[a-z0-9]{20,}/g, ":id")}`);
        t.status(await c.get(`/api/site-documents/records/${recId}/signature/${sigRow?.id}`, who), want, `${who ?? "no login"} a record signature`);
      }
      const rs = await c.get(`/api/site-documents/records/${recId}/signature/${sigRow?.id}`, "COORDINATOR");
      const rsb = Buffer.from(await rs.arrayBuffer());
      t.ok(rs.status === 200 && rs.headers.get("content-type") === "image/png" && rsb.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) && rs.headers.get("content-security-policy") === "default-src 'none'; sandbox" && /no-store/.test(rs.headers.get("cache-control") ?? ""), "a record signature: a PNG, sandboxing CSP, never cached");
      t.status(await c.get(`/api/site-documents/swms/signature/${swRow?.id}`, "MANAGER"), 200, "a Manager sees a SWMS signature");
      t.status(await c.get(`/api/site-documents/records/${recId}/signature/${sigRow?.id}`, "OPS_AI"), 403, "the Building Agent can't see a record signature");
      t.status(await c.get(`/api/site-documents/swms/signature/${swRow?.id}`, "OPS_AI"), 403, "...or a SWMS signature");
      t.ok((await c.json(`/api/site-documents/records/${recId}`, "OPS_AI")).body?.record?.signaturesHidden === true, "the Building Agent sees the record with 'Signature hidden'");
      t.status(await c.get(`/api/site-documents/records/${"z".repeat(25)}/signature/${sigRow?.id}`, "MANAGER"), 404, "a signature asked for under another record");
      for (const who of ["MANAGER", "COORDINATOR"]) for (const pg of ["/site-documents", "/site-documents/topic"]) t.status(await c.get(pg, who), 200, `page ${pg} loads for ${who}`);
      const detail = (await c.json(`/api/site-documents/records/${recId}`, "MANAGER")).body;
      t.ok(!JSON.stringify(detail ?? {}).includes("iVBOR") && !Object.keys(detail?.record ?? {}).some((k) => /price|rate|amount|cost/i.test(k)), "the office record carries no signature bytes and no money field");

      // ---- (8) never edited ----
      for (const m of ["PATCH", "PUT", "DELETE"]) {
        t.status((await call(m, L.sup, "/documents/records", {})).status, 405, `${m} on the link's records route`);
        t.status((await call(m, L.sup, "/documents/incident", {})).status, 405, `${m} on the link's incident route`);
        t.status(await c.req(m, `/api/site-documents/files/${planPId}`, "ADMIN", {}), 405, `${m} on an office file`);
        t.status(await c.req(m, `/api/site-documents/records/${recId}`, "ADMIN", {}), 405, `${m} on a record`);
        t.status(await c.req(m, `/api/directors/incidents/${iid}`, "OWNER", {}), 405, `${m} on an incident`);
      }

      // ---- (9) the owner's alert + (10) the kill switch ----
      const sub = () => { const ecdh = createECDH("prime256v1"); ecdh.generateKeys(); return { ecdh, auth: randomBytes(16), keys: { p256dh: ecdh.getPublicKey().toString("base64url") } }; };
      const endpoint = (who) => `https://fcm.googleapis.com/fcm/send/rc-doc-${who}-${tag}-${randomBytes(6).toString("hex")}`;
      const ow = sub(), owEp = endpoint("owner"), adEp = endpoint("admin"), diEp = endpoint("director");
      const reg = (who, ep, s) => c.post("/api/push", who, { subscription: { endpoint: ep, keys: { p256dh: s.keys.p256dh, auth: s.auth.toString("base64url") } }, label: "RC site docs" });
      t.status(await reg("OWNER", owEp, ow), 200, "the owner turns on alerts");
      t.status(await reg("ADMIN", adEp, sub()), 200, "another Admin turns on alerts");
      t.status(await reg("DIRECTOR", diEp, sub()), 200, "a director turns on alerts");
      const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
      const guard = path.join(c.p.appDir, "scripts", "release-check", "lib", "outbound-guard.cjs");
      const runChild = (name, lines) => {
        const script = path.join(c.p.files, `rc109-${name}-${tag}.mts`);
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
          `const { alertIncident } = await import(${JSON.stringify(fileUrl("src/lib/siteDocs/incidents.ts"))});`,
          `const a = await alertIncident(${JSON.stringify(iid)}); const n1 = seen.length;`,
          `process.env.SITE_DOCS = "off"; const b = await alertIncident(${JSON.stringify(iid)}); const n2 = seen.length;`,
          `console.log("RESULT " + JSON.stringify({ a, b, n1, n2, seen })); process.exit(0);`,
        ]);
        const pathOf = (ep) => new URL(ep).pathname;
        const ownerDevs = new Set((await db.pushDevice.findMany({ where: { user: { active: true, email: c.users.OWNER.email } }, select: { endpoint: true } })).map((d) => { try { const u = new URL(d.endpoint); return `${u.hostname}${u.pathname}`; } catch { return ""; } }));
        const toOw = (res?.seen ?? []).filter((s) => s.path === pathOf(owEp));
        t.ok(!!res && toOw.length === 1, "the incident alert reached the owner's phone (stub push host)", res ? JSON.stringify({ a: res.a, n: res.n1 }) : "child failed");
        t.ok(!!res && res.seen.every((s) => ownerDevs.has(`${s.host}${s.path}`)) && !res.seen.some((s) => s.path === pathOf(adEp) || s.path === pathOf(diEp)), "...the owner's phones only - never another Admin's or a director's");
        t.ok(res?.b === 0 && res?.n2 === res?.n1, "SITE_DOCS=off: no alert");
        let payload = null;
        try { payload = JSON.parse(createRequire(path.join(c.p.appDir, "package.json"))("http_ece").decrypt(Buffer.from(toOw[0].body, "base64"), { version: "aes128gcm", privateKey: ow.ecdh, authSecret: ow.auth }).toString("utf8")); }
        catch (e) { t.note(`couldn't decrypt the stubbed push: ${String(e?.message ?? e).slice(0, 120)}`); }
        t.ok(payload?.title === "Incident report sent" && payload?.url === `/incidents/${iid}` && payload?.body === `Incident report ${num1} sent - ${P.name} (${S.name})`, "the alert's words and where it opens", JSON.stringify(payload));
        // The project's and the supervisor's names carry a random tag (it could spell "w1" or "ply") - checked without them.
        const words = JSON.stringify(payload ?? {}).split(P.name).join("").split(S.name).join("");
        t.ok(!!payload && noMoney(words) && !/near miss|injury|treatment|stairs|ply|secret|W1/i.test(words), "no health detail and no money in the alert");

        const k = runChild("off", [
          `process.env.SITE_DOCS = "off";`,
          `const ctx = { params: Promise.resolve({ token: ${JSON.stringify(L.sup.secret)} }) };`,
          `const v = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/documents/route.ts"))});`,
          `const r = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/documents/records/route.ts"))});`,
          `const i = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/documents/incident/route.ts"))});`,
          `const m = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/documents/media/[op]/route.ts"))});`,
          `const h = await import(${JSON.stringify(fileUrl("src/app/api/site/[token]/route.ts"))});`,
          `const g = await v.GET(new Request("http://x/"), ctx); const p = await r.POST(new Request("http://x/", { method: "POST", body: "{}" }), ctx);`,
          `const ip = await i.POST(new Request("http://x/", { method: "POST", body: "{}" }), ctx);`,
          `const ms = await m.POST(new Request("http://x/", { method: "POST", body: "{}" }), { params: Promise.resolve({ token: ${JSON.stringify(L.sup.secret)}, op: "start" }) });`,
          `const home = await (await h.GET(new Request("http://x/"), ctx)).json();`,
          `const off = await import(${JSON.stringify(fileUrl("src/lib/siteDocs/office.ts"))});`,
          `const list = await off.officeProjects(); const one = await off.officeProject(${JSON.stringify(P.id)});`,
          `console.log("RESULT " + JSON.stringify({ g: g.status, gBody: await g.json(), p: p.status, ip: ip.status, ms: ms.status, homeHas: "siteDocs" in home, homePerson: home.person, office: { list: list.some((x) => x.id === ${JSON.stringify(P.id)}), one: one?.project?.id === ${JSON.stringify(P.id)} } })); process.exit(0);`,
        ]);
        t.ok(k?.g === 503 && k?.p === 503 && k?.ip === 503 && k?.ms === 503 && /switched off/.test(k?.gBody?.error ?? ""), "SITE_DOCS=off: the link routes 503 with plain words", JSON.stringify(k));
        t.ok(k?.homePerson === S.name && k?.homeHas === false, "...and the link's home has no Site documents tile");
        t.ok(k?.office?.list === true && k.office.one === true, "...the office still reads", JSON.stringify(k?.office));
      } else t.block("no tsx in the candidate's node_modules - the alert and the kill switch couldn't be run");

      // ---- source: the tile ----
      const src = (rel) => { try { return readFileSync(path.join(c.p.appDir, rel), "utf8"); } catch { return ""; } };
      t.ok(/info\.siteDocs && \(info\.kind === "SUPERVISOR" \|\| info\.kind === "HANDOVER"\)/.test(src("src/app/site/[token]/page.tsx")), "the tile shows on supervisor and hand-over links only (source)");
      t.ok(/<SiteDocsCard \/>/.test(src("src/app/coordinator/page.tsx")) && /api\/site-documents\/files/.test(src("src/components/siteDocs/UploadForm.tsx")), "the Site documents card (upload) on the coordinator's dashboard (source)");
      t.ok(src("src/components/site/IncidentForm.tsx").includes("SAFEWORK_PROMPT") && src("src/lib/siteDocs/rules.ts").includes("This may need to be reported to SafeWork NSW straight away."), "the red SafeWork box wording (source)");

      // ---- (11) ----
      const bad = seen.filter(([, text]) => !noMoney(text));
      t.ok(bad.length === 0, "no dollar figure in any link reply", bad.map(([w]) => w).join(", "));
      t.ok(net() === net0, "no outbound call");
    } finally {
      await db.siteLink.updateMany({ where: { id: { in: made.links } }, data: { revokedAt: new Date() } }).catch(() => {});
      await db.resource.updateMany({ where: { id: { in: made.people } }, data: { active: false } }).catch(() => {});
      await db.project.updateMany({ where: { id: { in: made.projects } }, data: { status: "COMPLETED" } }).catch(() => {});
    }
  },
};
