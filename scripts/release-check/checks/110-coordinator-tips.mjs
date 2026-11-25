// The coordinator on /receipts - TIP dockets only (Ilies approved 25 Nov 2026: "See and check, with $" and "Tip dockets
// only"; lib/receipts/tipsAccess.ts, lib/auth.ts guardTipsOrManager):
//   (1) the page loads for him; the list (Check these / All) is TIP only whatever `kind` / `vehicleId` asks, with the
//       printed price; no truck list; the "Check these" count is tip dockets only; a Manager's list is unchanged (fuel and
//       odometer still there);
//   (2) a FUEL, own-money FUEL, PURCHASE receipt and an odometer reading: every op 404 for him, nothing changed;
//   (3) photos: a TIP docket's photo 200, a FUEL / PURCHASE / odometer photo 404 (a Manager still gets the FUEL one);
//   (4) he confirms, corrects (tonnes) + moves a docket to another job and confirms, and sets one aside - kept with his name;
//   (5) tip rates: GET 200, adding / retiring 403; Mismatches 200; indicators = jobs only (no `trucks`), vehicleId 403;
//       a Manager's indicators still carry the trucks;
//   (6) batches: "None of this batch is asbestos" 200 for him (the batch docket answered); starting a batch and the
//       batch project picker 403 (upload stays Manager+);
//   (7) VIEWER / TIMESHEETS / ACCOUNTS / DIRECTOR / YARD 403 on every receipts route and the tip rates, no login 401.
// Security follow-up (Ilies, 25 Nov 2026): CT-002 he keeps Read again and Add docket and may change the printed price;
// CT-001 Read again capped for every role - 3 per receipt (the 4th 429, the docket unchanged) and 40 per login per Sydney
// day (in a tsx child: RECEIPT_READING on, no Claude key, photo-less dockets, the outbound guard preloaded); CT-003 a tip
// docket made from a FUEL receipt's photo shows him no photo, his Add docket / price correction / Read again work, an
// unknown batch 404 on no-asbestos, and the Building Agent login still lists FUEL and ODOMETER.
// WRITES on the test copy: a person + supervisor link, a project with two jobs, four photos (1x1 JPEG), six tip dockets
// (+ one he adds), a fuel, an own-money fuel and a purchase receipt, an odometer reading, a batch with one docket, a
// NO_ASBESTOS event. The test receipts are set aside at the end (kept, never deleted).
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeLink } from "../lib/setup.mjs";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";

export default {
  id: "coordinator-tips", title: "Coordinator on Receipts: tip dockets only - see and check, with $; fuel / odometer / reimbursements never",
  writes: true, timeoutMs: 240_000,
  applies: (c) => c.hasPath("src/lib/receipts/tipsAccess.ts") || "the candidate has no coordinator tip-docket access (lib/receipts/tipsAccess.ts)",
  async run(t, c) {
    const db = c.db, U = c.users, C = "COORDINATOR";
    if (!U.COORDINATOR || !U.MANAGER) return t.block("no COORDINATOR / MANAGER test login (lib/setup.mjs TEST_ROLES)");
    const tag = Date.now().toString(36).toUpperCase();
    const today = c.today;
    const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

    // ---- setup ----
    const person = await db.resource.create({ data: { type: "PERSONNEL", name: `RC110 Supervisor ${tag}`, category: "Labourer", active: true } });
    const link = await makeLink(db, "SUPERVISOR", person.id);
    const project = await db.project.create({ data: { name: `RC110 tip site ${tag}`, status: "ACTIVE" } });
    const job1 = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    const job2 = await db.job.create({ data: { projectId: project.id, title: project.name, date: new Date(`${yesterday}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE" } });
    const photo = async () => { const r = await c.post(c.site(link, "/receipts/photos"), null, { dataUrl: JPEG }); return (await r.json().catch(() => ({}))).id; };
    const [pTip, pFuel, pPurchase, pOdo] = [await photo(), await photo(), await photo(), await photo()];
    if (!pTip || !pFuel || !pPurchase || !pOdo) return t.block("couldn't upload the test photos through a supervisor link");
    const base = { siteLinkId: link.id, sentBy: person.name, sentByResourceId: person.id };
    const tip = (n, data) => db.receipt.create({ data: { ...base, kind: "TIP", jobId: job1.id, projectId: project.id, asbestos: false, docketNo: `RC110-${n}-${tag}`, tipSite: `RC110 Tip ${tag}`, wasteType: "Mixed", tonnes: 4.2, priceExGst: 321.5, rego: "RC110", ...data } });
    const A = await tip("A", { status: "CHECK", checkReasons: JSON.stringify(["Release check - to check"]), photos: { connect: [{ id: pTip }] } });
    const B = await tip("B", { status: "READ" });
    const Cx = await tip("C", { status: "CHECK" });
    const vehicle = await db.resource.findFirst({ where: { type: "VEHICLE", ownership: "OWNED", active: true }, select: { id: true } });
    const fuel = await db.receipt.create({ data: { ...base, kind: "FUEL", vehicleId: vehicle?.id ?? null, status: "CHECK", litres: 80, pricePerLitre: 1.99, fuelTotal: 159.2, station: "RC110 Fuel", photos: { connect: [{ id: pFuel }] } } });
    const ownFuel = await db.receipt.create({ data: { ...base, kind: "FUEL", vehicleId: vehicle?.id ?? null, status: "CHECK", ownMoney: true, purpose: "FUEL", litres: 20, fuelTotal: 39.8 } });
    const purchase = await db.receipt.create({ data: { ...base, kind: "PURCHASE", status: "CHECK", ownMoney: true, purpose: "TOOLS", note: "RC110", photos: { connect: [{ id: pPurchase }] } } });
    const odo = await db.odometerReading.create({ data: { vehicleId: vehicle?.id ?? "rc110-vehicle", siteAttendanceId: `rc110-${tag}`, siteLinkId: link.id, sentBy: person.name, status: "CHECK", km: 123456 } });
    await db.receiptPhoto.update({ where: { id: pOdo }, data: { odometerReadingId: odo.id } });
    const batch = await db.receiptBatch.create({ data: { projectId: project.id, createdById: U.MANAGER.id, createdBy: "Release check MANAGER" } });
    const inBatch = await db.receipt.create({ data: { kind: "TIP", siteLinkId: `office-batch:${batch.id}`, sentBy: "Release check MANAGER", officeBatchId: batch.id, projectId: project.id, status: "READ", asbestos: null, docketNo: `RC110-BATCH-${tag}`, tipSite: `RC110 Tip ${tag}`, wasteType: "Mixed", tonnes: 3 } });
    const notTip = [fuel.id, ownFuel.id, purchase.id, odo.id];
    // CT-003 (a): a tip docket typed in from the FUEL receipt's photo (photoFromReceiptId = the fuel receipt).
    const D = await tip("D", { status: "CHECK", photoFromReceiptId: fuel.id });
    // CT-001: two photo-less tip dockets for the Read again caps (read in a tsx child; no photo = nothing to send anywhere).
    const E = await tip("E", { status: "CHECK" });
    const F = await tip("F", { status: "CHECK" });

    try {
      // ---- (1) the page and the list ----
      const pg = await c.text("/receipts", C);
      t.ok(pg.status === 200 && !/Application error/.test(pg.text), "the /receipts page loads for him", pg.status);
      const asks = ["?check=1", "", "?kind=FUEL", "?kind=ODOMETER&check=1", "?kind=PURCHASE", `?vehicleId=${vehicle?.id ?? "x"}&check=1`, `?day=${today}`];
      for (const q of asks) {
        const r = await c.json(`/api/receipts${q}`, C);
        const rows = r.body?.rows ?? [];
        t.ok(r.status === 200 && rows.every((x) => x.type === "TIP"), `list ${q || "(all)"}: 200, tip dockets only`, `${r.status} ${[...new Set(rows.map((x) => x.type))].join(",")}`);
        t.ok(!rows.some((x) => notTip.includes(x.id)), `list ${q || "(all)"}: no fuel / own-money / purchase / odometer record`);
        t.ok(Array.isArray(r.body?.trucks) && r.body.trucks.length === 0, `list ${q || "(all)"}: no truck list`);
        t.ok(rows.some((x) => x.id === A.id), `list ${q || "(all)"}: our tip docket is there (kind / truck filters ignored)`);
      }
      const mine = (await c.json("/api/receipts?check=1", C)).body;
      const rowA = (mine?.rows ?? []).find((x) => x.id === A.id);
      t.ok(rowA && rowA.read?.priceExGst === 321.5 && rowA.read?.tonnes === 4.2 && rowA.read?.tipSite && rowA.photoIds?.includes(pTip), "he sees the docket with its photo, what was read and the printed price", JSON.stringify(rowA?.read ?? null));
      t.ok(!/"type":"(FUEL|ODOMETER)"|"litres"|"fuelTotal"|"pricePerLitre"|"km":/.test(JSON.stringify(mine)), "no fuel or odometer field anywhere in his reply");
      // "Check these" count: tip dockets only, the same rule the store uses (CHECK, or SENT with its tries used up).
      const since = new Date(Date.now() - 90 * 86_400_000);
      const tipChecks = await db.receipt.count({ where: { kind: "TIP", ownMoney: false, status: "CHECK", sentAt: { gte: since } } });
      const tipSent = (await db.receipt.findMany({ where: { kind: "TIP", ownMoney: false, status: "SENT", sentAt: { gte: since } }, select: { reading: true } }))
        .filter((r) => { try { return (JSON.parse(r.reading ?? "{}").tries ?? 0) >= 3; } catch { return false; } }).length;
      t.ok(mine?.toCheck === tipChecks + tipSent, "his Check these count is tip dockets only", `${mine?.toCheck} vs ${tipChecks + tipSent}`);
      const mgr = (await c.json("/api/receipts?check=1", "MANAGER")).body;
      const mgrIds = (mgr?.rows ?? []).map((x) => x.id);
      t.ok(mgrIds.includes(fuel.id) && mgrIds.includes(odo.id) && mgrIds.includes(A.id) && !mgrIds.includes(purchase.id), "a Manager's list is unchanged: tips, fuel and odometer (never a purchase)");
      t.ok((mgr?.toCheck ?? 0) >= (mine?.toCheck ?? 0) + 2, "a Manager's count still includes fuel and odometer", `${mgr?.toCheck} vs ${mine?.toCheck}`);
      t.status(await c.get("/api/receipts?jobs=1", C), 200, "the move-to-job list loads for him");

      // ---- (2) no op on anything but a tip docket ----
      const snap = async () => JSON.stringify(await Promise.all([db.receipt.findMany({ where: { id: { in: [fuel.id, ownFuel.id, purchase.id] } }, orderBy: { id: "asc" } }), db.odometerReading.findUnique({ where: { id: odo.id } })]));
      const before = await snap();
      for (const [id, what] of [[fuel.id, "a FUEL receipt"], [ownFuel.id, "an own-money FUEL receipt"], [purchase.id, "a PURCHASE (reimbursement) receipt"]]) {
        for (const body of [{ op: "CONFIRM" }, { op: "REJECT", reason: "rc110 not mine" }, { op: "CORRECT", fields: { station: "x" } }, { op: "READ_AGAIN" }, { op: "ADD_DOCKET", fields: { tipSite: "x", docketNo: "x", docketAt: `${today}T09:00`, tonnes: 1, jobId: job1.id, asbestos: false } }])
          t.status(await c.post(`/api/receipts/${id}`, C, body), 404, `${what}: ${body.op} 404 for him`);
      }
      for (const body of [{ op: "CONFIRM" }, { op: "REJECT", reason: "rc110 not mine" }, { op: "CORRECT", fields: { km: 1 } }])
        t.status(await c.post(`/api/receipts/${odo.id}`, C, { ...body, type: "ODOMETER" }), 404, `an odometer reading: ${body.op} 404 for him`);
      t.status(await c.post(`/api/receipts/${odo.id}`, C, { op: "CONFIRM" }), 404, "an odometer id sent as a receipt: 404");
      t.ok((await snap()) === before, "the fuel, own-money, purchase and odometer records are byte-for-byte unchanged");

      // ---- (3) photos ----
      t.status(await c.get(`/api/receipts/photos/${pTip}`, C), 200, "a tip docket's photo: 200 for him");
      for (const [p, what] of [[pFuel, "a FUEL receipt's"], [pPurchase, "a PURCHASE receipt's"], [pOdo, "an odometer"]])
        t.status(await c.get(`/api/receipts/photos/${p}`, C), [403, 404], `${what} photo refused for him`);
      t.status(await c.get(`/api/receipts/photos/${pFuel}`, "MANAGER"), 200, "a Manager still gets the fuel photo");
      // CT-003 (a): a tip docket sharing a FUEL receipt's photo shows him no photo; the fuel photo stays 404.
      const rowD = ((await c.json(`/api/receipts?day=${today}`, C)).body?.rows ?? []).find((x) => x.id === D.id);
      t.ok(rowD && Array.isArray(rowD.photoIds) && rowD.photoIds.length === 0, "CT-003 a: a tip docket made from a fuel receipt's photo - empty photoIds for him", JSON.stringify(rowD?.photoIds ?? null));
      t.status(await c.get(`/api/receipts/photos/${pFuel}`, C), 404, "CT-003 a: ...and that fuel photo 404 for him");
      const mRowD = ((await c.json(`/api/receipts?day=${today}`, "MANAGER")).body?.rows ?? []).find((x) => x.id === D.id);
      t.ok(mRowD?.photoIds?.includes(pFuel), "CT-003 a: a Manager still sees the shared photo on it");

      // ---- (4) checking: confirm, correct + move, set aside ----
      const conf = await c.post(`/api/receipts/${B.id}`, C, { op: "CONFIRM" });
      t.status(conf, 200, "he confirms a tip docket");
      t.ok((await db.receipt.findUnique({ where: { id: B.id } }))?.status === "CONFIRMED", "...it's CONFIRMED");
      const corr = await c.post(`/api/receipts/${A.id}`, C, { op: "CORRECT", fields: { tonnes: "5.1", jobId: job2.id, asbestos: false }, confirm: true });
      t.status(corr, 200, "he corrects the tonnes, moves it to the right job and confirms");
      const a2 = await db.receipt.findUnique({ where: { id: A.id } });
      const log = (() => { try { return JSON.parse(a2?.reading ?? "{}"); } catch { return {}; } })();
      t.ok(a2?.tonnes === 5.1 && a2?.jobId === job2.id && a2?.status === "CONFIRMED" && a2?.correctedBy === "Release check COORDINATOR"
        && (log.corrections ?? []).some((x) => x.field === "jobId" && x.by === "Release check COORDINATOR"), "...saved, moved and kept with his name", JSON.stringify({ t: a2?.tonnes, s: a2?.status, by: a2?.correctedBy }));
      t.status(await c.post(`/api/receipts/${Cx.id}`, C, { op: "REJECT", reason: "Release check - duplicate photo" }), 200, "he sets one aside");
      t.ok((await db.receipt.findUnique({ where: { id: Cx.id } }))?.status === "REJECTED", "...it's set aside");

      // CT-003 (b) / CT-002 (Ilies, 25 Nov 2026: "he can have all of them", "Yes, he can change prices").
      const addR = await c.post(`/api/receipts/${A.id}`, C, { op: "ADD_DOCKET", fields: { jobId: job1.id, tipSite: `RC110 Tip ${tag}`, docketNo: `RC110-ADD-${tag}`, docketAt: `${today}T10:15`, wasteType: "Mixed", tonnes: "2.5", rego: "RC110", asbestos: false } });
      const addJ = await addR.json().catch(() => ({}));
      t.status(addR, 200, "CT-003 b: he adds another docket from a tip docket's photo");
      const added = addJ.id ? await db.receipt.findUnique({ where: { id: addJ.id } }) : null;
      t.ok(added?.kind === "TIP" && added?.status === "CONFIRMED" && added?.photoFromReceiptId === A.id && added?.correctedBy === "Release check COORDINATOR", "CT-003 b: ...a confirmed tip docket sharing the photo, with his name");
      const price = await c.post(`/api/receipts/${B.id}`, C, { op: "CORRECT", fields: { priceExGst: "350" } });
      t.status(price, 200, "CT-003 b: he corrects the printed price");
      const b2 = await db.receipt.findUnique({ where: { id: B.id } });
      const bLog = (() => { try { return JSON.parse(b2?.reading ?? "{}"); } catch { return {}; } })();
      t.ok(b2?.priceExGst === 350 && (bLog.corrections ?? []).some((x) => x.field === "priceExGst" && x.before === 321.5 && x.after === 350 && x.by === "Release check COORDINATOR"),
        "CT-003 b: ...saved, kept with his name and the before / after", JSON.stringify({ p: b2?.priceExGst }));
      const ra = await c.post(`/api/receipts/${E.id}`, C, { op: "READ_AGAIN" });
      const raJ = await ra.json().catch(() => ({}));
      t.ok(ra.status === 503 && /switched off/.test(raJ.error ?? ""), "CT-003 b: his Read again on a tip docket gets past the wall (503 only because reading is off on the test copy; the tsx child below runs it)", `${ra.status} ${raJ.error ?? ""}`);

      // ---- (5) tip rates, mismatches, indicators ----
      const rates = await c.json("/api/tip-rates", C);
      t.ok(rates.status === 200 && Array.isArray(rates.body?.rates), "tip rates: he reads them", rates.status);
      t.status(await c.post("/api/tip-rates", C, { tipSite: "RC110", wasteType: "", ratePerTonneExGst: 50, validFrom: today, source: "rc" }), 403, "tip rates: adding one refused");
      t.status(await c.post(`/api/tip-rates/${rates.body?.rates?.[0]?.id ?? "x"}`, C, { op: "RETIRE", reason: "rc110" }), 403, "tip rates: retiring one refused");
      t.status(await c.post("/api/tip-rates", "MANAGER", { tipSite: "RC110", wasteType: "", ratePerTonneExGst: 50, validFrom: today, source: "rc" }), 403, "tip rates: still Admin only (a Manager 403)");
      const mm = await c.json("/api/receipts?mismatches=1", C);
      t.ok(mm.status === 200 && Array.isArray(mm.body?.uninvoiced) && Array.isArray(mm.body?.invoicesWithoutDockets), "Mismatches: 200 for him, with amounts", mm.status);
      const ind = await c.json("/api/receipts?indicators=1", C);
      t.ok(ind.status === 200 && Array.isArray(ind.body?.jobs) && !("trucks" in (ind.body ?? {})), "indicators: jobs only for him (no trucks key)", JSON.stringify(Object.keys(ind.body ?? {})));
      t.ok(!/"(lastKm|kmPerDay|latestPer100|avgPer100|fuelByWeek|fuelByDay)"/.test(JSON.stringify(ind.body)), "indicators: no km, fuel or L/100 km anywhere in his reply");
      t.ok((ind.body?.jobs ?? []).some((j) => j.projectId === project.id), "indicators: our job's tip loads are there");
      t.status(await c.get(`/api/receipts?indicators=1&vehicleId=${vehicle?.id ?? "x"}`, C), 403, "indicators: a truck (vehicleId) refused");
      const mInd = await c.json("/api/receipts?indicators=1", "MANAGER");
      t.ok(mInd.status === 200 && Array.isArray(mInd.body?.trucks) && Array.isArray(mInd.body?.jobs), "a Manager's indicators still carry the trucks");
      if (vehicle) t.ok(Array.isArray((await c.json(`/api/receipts?indicators=1&vehicleId=${vehicle.id}`, "MANAGER")).body?.trucks), "a Manager's single-truck indicators unchanged");

      // ---- (6) batches ----
      t.status(await c.get("/api/receipts?batchProjects=1", C), 403, "the batch project picker refused for him (upload stays Manager+)");
      t.status(await c.post("/api/receipts/batches", C, { projectId: project.id }), 403, "starting a batch refused for him");
      t.status(await c.post(`/api/receipts/batches/${batch.id}`, C, { dataUrl: JPEG }), 403, "adding a photo to a batch refused for him");
      const nb = await c.post(`/api/receipts/batches/${batch.id}/no-asbestos`, C, {});
      t.status(nb, 200, "'None of this batch is asbestos': 200 for him");
      t.ok((await db.receipt.findUnique({ where: { id: inBatch.id } }))?.asbestos === false, "...the batch docket is answered not-asbestos");
      t.ok(!!(await db.receiptBatchEvent.findFirst({ where: { batchId: batch.id, byId: U.COORDINATOR.id, action: "NO_ASBESTOS" } })), "...kept with his name (ReceiptBatchEvent)");
      t.status(await c.post("/api/receipts/batches/cnotarealbatch00000000000/no-asbestos", C, {}), 404, "CT-003 c: no-asbestos on an unknown batch id 404");

      // CT-003 (d): the Building Agent (Operations AI, a MANAGER login) keeps the whole list.
      if (U.OPS_AI) {
        const ag = (await c.json("/api/receipts?check=1", "OPS_AI")).body;
        const types = new Set((ag?.rows ?? []).map((x) => x.type));
        const agIds = (ag?.rows ?? []).map((x) => x.id);
        t.ok(types.has("FUEL") && types.has("ODOMETER") && agIds.includes(fuel.id) && agIds.includes(odo.id), "CT-003 d: the Building Agent login's list still has FUEL and ODOMETER rows", [...types].join(","));
      } else t.note("no OPS_AI (Building Agent) login on the copy - CT-003 d not run");

      // ---- CT-001: Read again caps, in a tsx child (RECEIPT_READING on, no Claude key, photo-less dockets, the outbound
      // guard preloaded - nothing leaves the machine) ----
      const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
      if (!existsSync(tsxCli)) t.block("no tsx in the candidate's node_modules - the Read again caps need it");
      else {
        const lib = (f) => JSON.stringify("file:///" + path.join(c.p.appDir, "src", "lib", "receipts", f).split(path.sep).join("/"));
        const script = path.join(c.p.files, `rc110-readagain-${tag}.mts`);
        writeFileSync(script, [
          `import { receiptAction } from ${lib("office.ts")};`,
          `import { takeDailyReadAgain } from ${lib("readAgain.ts")};`,
          `const who = { name: "Release check COORDINATOR", id: ${JSON.stringify(U.COORDINATOR.id)} };`,
          `const out = [];`,
          `for (let i = 0; i < 4; i++) out.push(await receiptAction(who, ${JSON.stringify(E.id)}, { op: "READ_AGAIN" }, { tipsOnly: true }));`,
          `const busy = { name: "RC110 busy", id: "rc110-busy-${tag}" };`,
          `for (let i = 0; i < 40; i++) takeDailyReadAgain(busy.id);`,
          `out.push(await receiptAction(busy, ${JSON.stringify(F.id)}, { op: "READ_AGAIN" }));`,
          `console.log("RESULT " + JSON.stringify(out));`,
          `process.exit(0);`,
        ].join("\n"));
        const guard = path.join(c.p.appDir, "scripts", "release-check", "lib", "outbound-guard.cjs");
        const env = { ...process.env, ...(c.childEnv ?? {}), RECEIPT_READING: "on", NODE_OPTIONS: `--require ${JSON.stringify(guard)}`, RELEASE_CHECK_NET_LOG: c.p.netLog };
        delete env.ANTHROPIC_API_KEY;
        const fBefore = JSON.stringify(await db.receipt.findUnique({ where: { id: F.id } }));
        let out = "";
        try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env, encoding: "utf8", timeout: 120_000 }); } catch (e) { out = String(e?.stdout ?? "") + String(e?.stderr ?? ""); }
        const m = /RESULT (\[.*\])/.exec(out);
        const res = m ? JSON.parse(m[1]) : null;
        if (t.ok(!!res, "CT-001: the Read again steps ran", m ? "" : out.slice(-300))) {
          t.ok(res.slice(0, 3).every((x) => x.ok === true), "CT-001: the first three Read again on one docket go ahead (his, tips-only)", JSON.stringify(res.slice(0, 3)));
          t.ok(res[3]?.status === 429 && res[3]?.error === "Read again used up for this docket - correct it by hand.", "CT-001: the 4th on that docket 429 'used up'", JSON.stringify(res[3]));
          t.ok(res[4]?.status === 429 && res[4]?.error === "Read again limit reached for today.", "CT-001: a login's 41st of the day 429 'limit reached'", JSON.stringify(res[4]));
        }
        const e2 = await db.receipt.findUnique({ where: { id: E.id } });
        const eLog = (() => { try { return JSON.parse(e2?.reading ?? "{}"); } catch { return {}; } })();
        t.ok(eLog.manualReads === 3, "CT-001: the docket's log counts 3 manual re-reads - the 4th changed nothing", String(eLog.manualReads));
        t.ok(JSON.stringify(await db.receipt.findUnique({ where: { id: F.id } })) === fBefore, "CT-001: the docket refused on the daily cap is byte-for-byte unchanged");
      }

      // ---- (7) nobody else gets in ----
      for (const role of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD"]) {
        if (!U[role]) { t.note(`no ${role} test login - skipped`); continue; }
        for (const pth of ["/api/receipts", "/api/receipts?check=1", "/api/receipts?indicators=1", "/api/receipts?mismatches=1", "/api/receipts?jobs=1", "/api/tip-rates", `/api/receipts/photos/${pTip}`])
          t.status(await c.get(pth, role), 403, `${role}: GET ${pth.split("?")[0]}${pth.includes("?") ? "?" + pth.split("?")[1] : ""} refused`);
        t.status(await c.post(`/api/receipts/${Cx.id}`, role, { op: "CONFIRM" }), 403, `${role}: a receipt action refused`);
        t.status(await c.post(`/api/receipts/batches/${batch.id}/no-asbestos`, role, {}), 403, `${role}: the batch no-asbestos refused`);
      }
      for (const pth of ["/api/receipts", "/api/tip-rates", `/api/receipts/photos/${pTip}`]) t.status(await c.get(pth, null), 401, `signed out: ${pth} 401`);
    } finally {
      // Tidy: our test receipts set aside (kept), the link revoked, the person switched off.
      await db.receipt.updateMany({ where: { OR: [{ id: { in: [fuel.id, ownFuel.id, purchase.id] } }, { projectId: project.id }] }, data: { status: "REJECTED" } }).catch(() => {});
      await db.odometerReading.update({ where: { id: odo.id }, data: { status: "REJECTED" } }).catch(() => {});
      await db.siteLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } }).catch(() => {});
      await db.resource.update({ where: { id: person.id }, data: { active: false } }).catch(() => {});
    }
  },
};
