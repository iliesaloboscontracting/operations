// Office batch upload of tip dockets (20 Nov 2026, Ilies: "yes build it, deploy once it passes"): /receipts "Upload a
// batch of dockets" - Managers and Admins only. A batch is for one project; each photo (one per request) becomes a SENT
// TIP receipt marked as an office batch (officeBatchId, siteLinkId "office-batch:<id>", no sender resource), read by the
// same pipeline as a phone docket. Checked here:
//   (1) access: Manager / Admin allowed; VIEWER, COORDINATOR, YARD, ACCOUNTS, TIMESHEETS, DIRECTOR and signed out refused;
//       only the batch's own uploader adds to it;
//   (2) a batch makes SENT TIP receipts marked as an office batch, on the project, asbestos unanswered (never "No");
//   (3) non-image bytes are refused (a PDF / text dressed as a JPEG, a WAV dressed as a WebP) and nothing is saved;
//   (4) the same photo twice (same bytes) is refused - in one batch and across batches;
//   (5) reading (runner.readReceipt in a tsx child with a stand-in reader - no Claude, no outbound call): the job comes
//       from the docket's date; a docket number already sent from a phone, and the same docket photographed twice, are
//       To check with "already sent"; tip costs (tipDocketsByProject) count each docket number once; CONFIRM needs the
//       asbestos answer, and a duplicate can't be confirmed into the costs;
//   (6) nothing from a batch reaches a site link (the supervisor's My receipts, the daily log's docket count), no $.
// Security review fixes (Ilies approved 20 Nov 2026, "approve DB-001 to DB-005 ... b"):
//   (7) DB-001 the "already counted" confirm check holds for phone and batch dockets, either order;
//   (8) DB-003 another docket from a batch photo needs the asbestos answer;
//   (9) option b "None of this batch is asbestos": Manager+ only, unanswered + not set aside only, kept, confirms nothing;
//   (10) DB-004 a 4 MB photo refused; used-up SENT rows don't hide a fresh one;
//   (11) DB-005 ten parallel photos into a batch of 95 stop at 100.
// WRITES on the test copy: a project with two jobs, a supervisor link, phone and batch dockets, four batches (one with 95
// set-aside rows, one with 25 used-up rows).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const JPEG_B64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
// A distinct photo each time: the same 1x1 JPEG with a different tail after its end marker.
const photo = (tail) => "data:image/jpeg;base64," + Buffer.concat([Buffer.from(JPEG_B64, "base64"), Buffer.from(`rc96-${tail}`)]).toString("base64");
const addDays = (iso, n) => new Date(new Date(iso + "T00:00:00.000Z").getTime() + n * 86_400_000).toISOString().slice(0, 10);

export default {
  id: "docket-batch", title: "Docket batch upload: Manager/Admin only, SENT office-batch tip receipts, non-images and repeat photos refused, duplicates flagged and counted once, nothing on a link",
  writes: true, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/app/api/receipts/batches/route.ts") || "the candidate has no docket batch upload",
  async run(t, c) {
    const db = c.db;
    const tag = Date.now().toString(36).toUpperCase();
    const today = c.today, earlier = addDays(today, -9);
    const sup = await db.resource.findFirst({ where: { type: "PERSONNEL", active: true }, select: { id: true, name: true } });
    if (!sup) return t.block("no active Labour-register person for a supervisor link");
    const project = await db.project.create({ data: { name: `RC96 batch site ${tag}`, status: "ACTIVE" } });
    const jobToday = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    const jobEarlier = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${earlier}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    await db.assignment.create({ data: { jobId: jobToday.id, resourceId: sup.id } });
    const supLink = await makeLink(db, "SUPERVISOR", sup.id);
    const linkBodies = [];
    const keep = async (r) => { const text = await r.text().catch(() => ""); linkBodies.push(text); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, body: j }; };
    const logBefore = (await keep(await c.get(c.site(supLink, "/log"), null))).body;
    const sentBefore = (logBefore?.jobs ?? []).find((j) => j.jobId === jobToday.id || j.id === jobToday.id)?.docketsSent ?? null;

    // (1) access.
    for (const role of ["VIEWER", "COORDINATOR", "YARD", "ACCOUNTS", "TIMESHEETS", "DIRECTOR"]) {
      if (!c.users[role]) { t.note(`no ${role} test login on this build - skipped`); continue; }
      t.status(await c.post("/api/receipts/batches", role, { projectId: project.id }), [401, 403], `${role} can't start a batch`);
    }
    t.status(await c.post("/api/receipts/batches", null, { projectId: project.id }), 401, "signed out can't start a batch");
    t.status(await c.post("/api/receipts/batches", "MANAGER", { projectId: "cnotarealproject000000000" }), 400, "an unknown project is refused");
    const start = async (who) => { const r = await c.post("/api/receipts/batches", who, { projectId: project.id }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const b1 = await start("MANAGER");
    t.ok(b1.status === 201 && b1.body.id, "a Manager starts a batch for the project", `${b1.status}`);
    const b2 = await start("ADMIN");
    t.ok(b2.status === 201 && b2.body.id, "an Admin starts one too", `${b2.status}`);
    if (!b1.body.id || !b2.body.id) return t.block("couldn't start the batches");
    const send = async (batchId, who, dataUrl) => { const r = await c.post(`/api/receipts/batches/${batchId}`, who, { dataUrl }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    for (const role of ["VIEWER", "COORDINATOR", "YARD", "ACCOUNTS", "TIMESHEETS", "DIRECTOR"]) {
      if (!c.users[role]) continue;
      t.status((await send(b1.body.id, role, photo(`deny-${role}`))).status, [401, 403], `${role} can't add a photo`);
    }
    t.status((await send(b1.body.id, null, photo("deny-anon"))).status, 401, "signed out can't add a photo");
    t.status((await send(b1.body.id, "ADMIN", photo("not-mine"))).status, 404, "only the batch's own uploader adds to it");

    // (3) non-image bytes, before anything else is in.
    const before = await db.receipt.count({ where: { officeBatchId: b1.body.id } });
    const pdf = "data:image/jpeg;base64," + Buffer.from("%PDF-1.7 release check").toString("base64");
    const wav = "data:image/webp;base64," + Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1").toString("base64");
    t.status((await send(b1.body.id, "MANAGER", pdf)).status, 400, "a PDF sent as a JPEG is refused");
    t.status((await send(b1.body.id, "MANAGER", wav)).status, 400, "a WAV sent as a WebP is refused");
    t.status((await send(b1.body.id, "MANAGER", "data:application/pdf;base64,JVBERi0=")).status, 400, "a PDF is refused");
    t.ok((await db.receipt.count({ where: { officeBatchId: b1.body.id } })) === before, "nothing saved for them");

    // (2) the batch: five photos (A, B, C, D and A2 - the same docket as A photographed again), one repeat file.
    const names = ["A", "B", "C", "D", "A2"];
    const ids = {};
    for (const n of names) { const r = await send(b1.body.id, "MANAGER", photo(`${tag}-${n}`)); ids[n] = r.body.id; t.ok(r.status === 201 && r.body.id, `photo ${n} goes in`, `${r.status} ${r.body.error ?? ""}`); }
    const rows = await db.receipt.findMany({ where: { officeBatchId: b1.body.id }, include: { photos: true } });
    t.ok(rows.length === 5 && rows.every((r) => r.kind === "TIP" && r.status === "SENT" && r.projectId === project.id && r.jobId === null && r.asbestos === null && r.sentByResourceId === null && r.siteLinkId === `office-batch:${b1.body.id}`),
      "five SENT tip receipts, marked as the office batch, on the project, asbestos unanswered, no link", JSON.stringify(rows.map((r) => [r.status, r.asbestos, r.siteLinkId.slice(0, 13)])));
    t.ok(rows.every((r) => r.photos.length === 1 && /^[0-9a-f]{64}$/.test(r.photos[0].sha256 ?? "") && r.photos[0].siteLinkId === null), "each with its photo and its hash");
    const office = (await c.json(`/api/receipts?day=${today}`, "MANAGER")).body;
    const oRow = (office?.rows ?? []).find((x) => x.id === ids.A);
    t.ok(oRow?.batch?.id === b1.body.id && oRow.batch.by, "the Receipts list marks it 'Office batch' with who uploaded it", oRow ? JSON.stringify(oRow.batch) : "row not in the list");

    // (4) the same photo twice: in the same batch, and in another batch.
    const again = await send(b1.body.id, "MANAGER", photo(`${tag}-B`));
    t.ok(again.status === 409 && /already in/.test(again.body.error ?? ""), "the same photo again in the batch is refused (409)", `${again.status} ${again.body.error ?? ""}`);
    const across = await send(b2.body.id, "ADMIN", photo(`${tag}-C`));
    t.ok(across.status === 409 && /already in/.test(across.body.error ?? ""), "...and in another batch", `${across.status}`);
    t.ok((await db.receipt.count({ where: { officeBatchId: { in: [b1.body.id, b2.body.id] } } })) === 5, "no receipt made for a repeat photo");

    // A phone docket already in with D's number (the "27 already sent via the app").
    const phone = await db.receipt.create({ data: { kind: "TIP", siteLinkId: supLink.id, sentBy: sup.name, sentByResourceId: sup.id, jobId: jobEarlier.id, projectId: project.id, asbestos: false, status: "READ", docketNo: `RC96-${tag}-D`, tipSite: "Release Check Tip", tonnes: 5, docketAt: new Date(`${earlier}T01:00:00.000Z`) } });

    // (5) reading, with a stand-in reader, in the order A, B, C, D, A2.
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    if (!existsSync(tsxCli)) return t.block("no tsx in the candidate's node_modules - the reading steps need it");
    const env = (() => { try { return Object.fromEntries(readFileSync(c.p.envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "").trim()]; })); } catch { return {}; } })();
    const readings = [
      { id: ids.A, docketNo: `RC96-${tag}-A`, dateTime: `${earlier}T09:10` }, // -> the earlier job
      { id: ids.B, docketNo: `RC96-${tag}-B`, dateTime: `${today}T08:00` }, // -> today's job
      { id: ids.C, docketNo: `RC96-${tag}-C`, dateTime: `${addDays(today, -30)}T10:00` }, // no job that day -> project only
      { id: ids.D, docketNo: `RC96-${tag}-D`, dateTime: `${earlier}T11:00` }, // already sent from a phone
      { id: ids.A2, docketNo: `RC96 ${tag} a`, dateTime: `${earlier}T09:10` }, // A photographed twice
    ];
    const lib = (f) => JSON.stringify("file:///" + path.join(c.p.appDir, "src", "lib", "receipts", f).split(path.sep).join("/"));
    const script = path.join(c.p.files, `rc96-read-${tag}.mts`);
    writeFileSync(script, [
      `import { readReceipt } from ${lib("runner.ts")};`,
      `import { tipDocketsByProject } from ${lib("tipStore.ts")};`,
      `const queue = ${JSON.stringify(readings)};`,
      `let cur = null;`,
      `const reader = {`,
      `  tip: async () => ({ documentType: "tip_docket", docketNo: cur.docketNo, dateTime: cur.dateTime, tipSite: "Release Check Tip", wasteType: "Mixed C&D", tonnesNet: "6.2", rego: "", priceExGst: "", priceIncGst: "", unclear: [], note: "" }),`,
      `  fuel: async () => { throw new Error("not used"); }, purchase: async () => { throw new Error("not used"); }, odometer: async () => { throw new Error("not used"); },`,
      `};`,
      `for (const q of queue) { cur = q; await readReceipt(q.id, reader); }`,
      `await new Promise((r) => setTimeout(r, 1500));`,
      `const list = (await tipDocketsByProject()).get(${JSON.stringify(project.id)}) ?? [];`,
      `console.log("RESULT " + JSON.stringify(list.map((d) => d.docketNo)));`,
      `process.exit(0);`,
    ].join("\n"));
    let out = "";
    try {
      const childEnv = { ...process.env, ...env, RECEIPT_READING: "on" };
      delete childEnv.ANTHROPIC_API_KEY;
      out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: childEnv, encoding: "utf8", timeout: 120_000 });
    } catch (e) { out = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
    const m = /RESULT (\[.*\])/.exec(out);
    t.ok(!!m, "the reading pipeline ran with the stand-in reader", m ? "" : out.slice(-200));
    const get = async (id) => db.receipt.findUnique({ where: { id } });
    const why = (r) => { try { return JSON.parse(r?.checkReasons ?? "[]"); } catch { return []; } };
    const [A, B, C, D, A2] = await Promise.all(names.map((n) => get(ids[n])));
    t.ok(A?.jobId === jobEarlier.id && B?.jobId === jobToday.id, "the job comes from the docket's date (one job that day)", `${A?.jobId === jobEarlier.id} ${B?.jobId === jobToday.id}`);
    t.ok(C?.jobId === null && C?.projectId === project.id, "no job that day: stays on the project with no job");
    t.ok([A, B, C].every((r) => r?.status === "CHECK" && why(r).some((x) => /asbestos yes or no/.test(x))), "every batch docket waits for the asbestos answer (To check)", [A, B, C].map((r) => r?.status).join(","));
    t.ok(D?.status === "CHECK" && why(D).some((x) => /already sent/.test(x) && x.includes(sup.name)), "a docket number already sent from a phone is flagged 'already sent'", JSON.stringify(why(D)).slice(0, 200));
    t.ok(A2?.status === "CHECK" && why(A2).some((x) => /already sent/.test(x)), "the same docket photographed twice is flagged 'already sent'");
    t.ok(!why(C).some((x) => /more than 2 days/.test(x)), "a month-old docket in a batch isn't flagged for its age");

    // CONFIRM needs the asbestos answer; a duplicate can't be confirmed into the costs.
    const conf = await c.post(`/api/receipts/${ids.A}`, "MANAGER", { op: "CONFIRM" });
    t.ok(conf.status === 400 && /asbestos/.test((await conf.json().catch(() => ({}))).error ?? ""), "Confirm without the asbestos answer is refused", `${conf.status}`);
    t.status(await c.post(`/api/receipts/${ids.A}`, "MANAGER", { op: "CORRECT", fields: { asbestos: false }, confirm: true }), 200, "answering 'not asbestos' and confirming works");
    const dupConf = await c.post(`/api/receipts/${ids.A2}`, "MANAGER", { op: "CORRECT", fields: { asbestos: false }, confirm: true });
    t.ok(dupConf.status === 409 && /already in/.test((await dupConf.json().catch(() => ({}))).error ?? ""), "the second photo of the same docket can't be confirmed (409)", `${dupConf.status}`);
    const dConf = await c.post(`/api/receipts/${ids.D}`, "MANAGER", { op: "CORRECT", fields: { asbestos: false }, confirm: true });
    t.status(dConf, 409, "nor the docket already sent from the phone");
    const counted = await db.receipt.findMany({ where: { kind: "TIP", projectId: project.id, status: { in: ["READ", "CONFIRMED"] } }, select: { docketNo: true } });
    const norm = (s) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const byNo = counted.reduce((acc, r) => ((acc[norm(r.docketNo)] = (acc[norm(r.docketNo)] ?? 0) + 1), acc), {});
    t.ok(Object.values(byNo).every((n) => n === 1) && byNo[norm(`RC96-${tag}-A`)] === 1 && byNo[norm(`RC96-${tag}-D`)] === 1, "tip costs: each docket number counted once", JSON.stringify(byNo));
    if (m) {
      const list = JSON.parse(m[1]).map(norm);
      t.ok(new Set(list).size === list.length && list.filter((x) => x === norm(`RC96-${tag}-D`)).length === 1, "tipDocketsByProject (what Tracking adds) had no docket twice after reading", JSON.stringify(list));
    }
    t.ok(phone.id && (await get(phone.id))?.status === "READ", "the phone docket is untouched");

    // (7) DB-001: the "already counted" check holds for every tip confirm, phone or batch, in either order.
    const marker = `office-batch:${b2.body.id}`;
    const tipRow = (data) => db.receipt.create({ data: { kind: "TIP", projectId: project.id, asbestos: false, status: "CHECK", tipSite: "Release Check Tip", tonnes: 4, docketAt: new Date(`${earlier}T02:00:00.000Z`), ...data } });
    const asPhone = { siteLinkId: supLink.id, sentBy: sup.name, sentByResourceId: sup.id, jobId: jobEarlier.id };
    const asBatch = { siteLinkId: marker, sentBy: "Release check office", officeBatchId: b2.body.id };
    const e1 = await tipRow({ ...asBatch, docketNo: `RC96-${tag}-X1` }), p1 = await tipRow({ ...asPhone, docketNo: `rc96 ${tag} x1` });
    t.status(await c.post(`/api/receipts/${e1.id}`, "MANAGER", { op: "CONFIRM" }), 200, "DB-001: a batch docket is confirmed");
    t.status(await c.post(`/api/receipts/${p1.id}`, "MANAGER", { op: "CONFIRM" }), 409, "DB-001: then a phone docket with the same number + tip site can't be confirmed");
    const p2 = await tipRow({ ...asPhone, docketNo: `RC96-${tag}-X2` }), e2 = await tipRow({ ...asBatch, docketNo: `RC96-${tag}-X2` });
    t.status(await c.post(`/api/receipts/${p2.id}`, "MANAGER", { op: "CONFIRM" }), 200, "DB-001: a phone docket is confirmed");
    t.status(await c.post(`/api/receipts/${e2.id}`, "MANAGER", { op: "CONFIRM" }), 409, "DB-001: then the batch docket with the same number + tip site can't be");
    const p3 = await tipRow({ ...asPhone, docketNo: `RC96-${tag}-X3` }), p4 = await tipRow({ ...asPhone, docketNo: `RC96-${tag}-X3` });
    t.status(await c.post(`/api/receipts/${p3.id}`, "MANAGER", { op: "CONFIRM" }), 200, "DB-001: two phone dockets, one number: the first confirms");
    t.status(await c.post(`/api/receipts/${p4.id}`, "MANAGER", { op: "CONFIRM" }), 409, "DB-001: ...the second can't (phone dockets are covered too)");

    // (8) DB-003: another docket from a batch photo needs the asbestos answer.
    const extra = { jobId: jobToday.id, tipSite: "Release Check Tip", docketNo: `RC96-${tag}-EXTRA`, docketAt: `${today}T10:00`, wasteType: "Mixed C&D", tonnes: 3.1, rego: "" };
    const noAns = await c.post(`/api/receipts/${ids.B}`, "MANAGER", { op: "ADD_DOCKET", fields: extra });
    t.ok(noAns.status === 400 && /asbestos/.test((await noAns.json().catch(() => ({}))).error ?? ""), "DB-003: no asbestos answer -> 400", `${noAns.status}`);
    const withAns = await c.post(`/api/receipts/${ids.B}`, "MANAGER", { op: "ADD_DOCKET", fields: { ...extra, asbestos: false } });
    const wa = await withAns.json().catch(() => ({}));
    const added = wa.id ? await get(wa.id) : null;
    t.ok(withAns.status === 200 && added?.status === "CONFIRMED" && added.asbestos === false && added.officeBatchId === b1.body.id, "DB-003: 'not asbestos' -> CONFIRMED, asbestos false, still the office batch", `${withAns.status}`);

    // (9) Option b: "None of this batch is asbestos".
    await c.post(`/api/receipts/${ids.C}`, "MANAGER", { op: "CORRECT", fields: { asbestos: true } }); // someone answered C: yes
    await c.post(`/api/receipts/${ids.A2}`, "MANAGER", { op: "REJECT", reason: "Release check - same docket twice" });
    for (const role of ["VIEWER", "COORDINATOR", "YARD", "ACCOUNTS", "TIMESHEETS", "DIRECTOR"]) {
      if (!c.users[role]) continue;
      t.status(await c.post(`/api/receipts/batches/${b1.body.id}/no-asbestos`, role, {}), [401, 403], `option b: ${role} refused`);
    }
    t.status(await c.post(`/api/receipts/batches/${b1.body.id}/no-asbestos`, null, {}), 401, "option b: signed out refused");
    const nb = await c.post(`/api/receipts/batches/${b1.body.id}/no-asbestos`, "ADMIN", {});
    const nbj = await nb.json().catch(() => ({}));
    const [B9, C9, D9, A29] = await Promise.all([ids.B, ids.C, ids.D, ids.A2].map(get));
    t.ok(nb.status === 200 && nbj.changed === 2 && B9?.asbestos === false && D9?.asbestos === false, "option b (any Manager+, here an Admin who didn't upload it): the two unanswered dockets become not asbestos", `${nb.status} ${JSON.stringify(nbj)}`);
    t.ok(C9?.asbestos === true, "...never one a person already answered (C stays asbestos)");
    t.ok(A29?.asbestos === null && A29?.status === "REJECTED", "...nor one set aside");
    t.ok(B9?.status === "CHECK" && D9?.status === "CHECK", "...and it confirms nothing");
    const ev = await db.receiptBatchEvent.findMany({ where: { batchId: b1.body.id } });
    t.ok(ev.length === 1 && ev[0].action === "NO_ASBESTOS" && ev[0].count === 2 && ev[0].by && ev[0].byId, "who, when and how many are kept (ReceiptBatchEvent)");
    t.status(await c.post(`/api/receipts/${ids.B}`, "MANAGER", { op: "CONFIRM" }), 200, "the asbestos question no longer blocks B's confirm");
    t.status(await c.post(`/api/receipts/${ids.B}`, "MANAGER", { op: "CORRECT", fields: { asbestos: true } }), 200, "a single docket can still be changed afterwards");
    const again2 = await (await c.post(`/api/receipts/batches/${b1.body.id}/no-asbestos`, "MANAGER", {})).json().catch(() => ({}));
    t.ok(again2.changed === 0 && (await db.receiptBatchEvent.count({ where: { batchId: b1.body.id } })) === 2 && (await get(ids.B))?.asbestos === true, "pressed again: nothing changes (B stays yes), and the press is kept too");
    const listed = ((await c.json(`/api/receipts?day=${today}`, "MANAGER")).body?.rows ?? []).find((x) => x.id === ids.D);
    t.ok(listed && !(listed.reasons ?? []).some((x) => /asbestos yes or no/.test(x)), "the list drops the 'asbestos yes or no?' note once it's answered");

    // (10) DB-004: a 4 MB photo is refused before it's read; used-up rows don't hide a fresh one.
    const big = "data:image/jpeg;base64," + Buffer.concat([Buffer.from(JPEG_B64, "base64"), Buffer.alloc(4 * 1024 * 1024, 7)]).toString("base64");
    const bigR = await send(b1.body.id, "MANAGER", big);
    t.ok([400, 413].includes(bigR.status), "DB-004: a 4 MB JPEG is refused (the page shrinks it first)", `${bigR.status}`);
    const b3 = await start("MANAGER");
    const used = JSON.stringify({ tries: 3, lastError: "Couldn't read it this time" });
    const old = new Date(Date.now() - 3600_000);
    await db.receipt.createMany({ data: Array.from({ length: 25 }, () => ({ kind: "TIP", siteLinkId: `office-batch:${b3.body.id}`, sentBy: "Release check office", officeBatchId: b3.body.id, projectId: project.id, status: "SENT", reading: used, sentAt: old })) });
    const fresh = await send(b3.body.id, "MANAGER", photo(`${tag}-fresh`));
    t.status(fresh.status, 201, "a fresh photo goes in after 25 used-up ones");
    if (fresh.body.id) await db.receipt.update({ where: { id: fresh.body.id }, data: { sentAt: new Date(Date.now() - 120_000) } });
    const script2 = path.join(c.p.files, `rc96-due-${tag}.mts`);
    writeFileSync(script2, [
      `import { dueReceipts, readReceipt } from ${lib("runner.ts")};`,
      `const reader = { tip: async () => ({ documentType: "tip_docket", docketNo: "RC96-${tag}-FRESH", dateTime: "${today}T07:00", tipSite: "Release Check Tip", wasteType: "Mixed C&D", tonnesNet: "2", rego: "", priceExGst: "", priceIncGst: "", unclear: [], note: "" }), fuel: async () => { throw new Error("x"); }, purchase: async () => { throw new Error("x"); }, odometer: async () => { throw new Error("x"); } };`,
      `const [first] = await dueReceipts({ officeBatchId: ${JSON.stringify(b3.body.id)} }, 1);`,
      `if (first) await readReceipt(first, reader);`,
      `console.log("RESULT " + JSON.stringify({ first }));`,
      `process.exit(0);`,
    ].join("\n"));
    let out2 = "";
    try {
      const childEnv = { ...process.env, ...env, RECEIPT_READING: "on" };
      delete childEnv.ANTHROPIC_API_KEY;
      out2 = execFileSync(process.execPath, [tsxCli, script2], { cwd: c.p.appDir, env: childEnv, encoding: "utf8", timeout: 120_000 });
    } catch (e) { out2 = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
    const due = /RESULT (\{.*\})/.exec(out2);
    const freshRow = fresh.body.id ? await get(fresh.body.id) : null;
    t.ok(due && JSON.parse(due[1]).first === fresh.body.id && freshRow?.status !== "SENT", "DB-004: past 25 used-up SENT receipts the fresh one is found and read (stand-in reader)", due ? `${freshRow?.status}` : out2.slice(-200));

    // (11) DB-005: ten photos at once into a batch holding 95 -> never over 100.
    const b4 = await start("MANAGER");
    await db.receipt.createMany({ data: Array.from({ length: 95 }, () => ({ kind: "TIP", siteLinkId: `office-batch:${b4.body.id}`, sentBy: "Release check office", officeBatchId: b4.body.id, projectId: project.id, status: "REJECTED" })) });
    const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => send(b4.body.id, "MANAGER", photo(`${tag}-burst-${i}`))));
    const inB4 = await db.receipt.count({ where: { officeBatchId: b4.body.id } });
    t.ok(inB4 === 100 && burst.filter((r) => r.status === 201).length === 5 && burst.filter((r) => r.status === 429).length === 5, "DB-005: 10 parallel photos into a batch of 95 -> 5 in, 5 refused (429), 100 in the batch", `${inB4} ${burst.map((r) => r.status).join(",")}`);

    // (6) nothing on a link.
    const mine = await keep(await c.get(c.site(supLink, "/receipts"), null));
    const text = JSON.stringify(mine.body ?? {});
    t.ok(mine.status === 200 && names.every((n) => !text.includes(ids[n])), "the supervisor's My receipts never lists a batch docket", mine.status);
    const logAfter = (await keep(await c.get(c.site(supLink, "/log"), null))).body;
    const sentAfter = (logAfter?.jobs ?? []).find((j) => j.jobId === jobToday.id || j.id === jobToday.id)?.docketsSent ?? null;
    if (sentBefore === null && sentAfter === null) t.note("today's job isn't on the supervisor's daily log here - docket count step not run");
    else t.ok(sentAfter === sentBefore, "the daily log's 'dockets sent' leaves the batch out (B is on today's job)", `${sentBefore} -> ${sentAfter}`);
    t.ok(linkBodies.every(noMoney), `no $ in ${linkBodies.length} link answers`);

    // Tidy (nothing deleted): the link revoked, the project inactive.
    await db.siteLink.update({ where: { id: supLink.id }, data: { revokedAt: new Date() } }).catch(() => {});
    await db.project.update({ where: { id: project.id }, data: { status: "INACTIVE" } }).catch(() => {});
  },
};
