// Tipper loads (Ilies, 27 Nov 2026: "please build into the bins for the driver sections a option for the tippers we
// have within our fleet.. this allows the drivers to log waste collected in the tippers also"; per load "Tipper, job,
// waste type, photo"; "Yes - client's or ours"; tip docket "Suggest it, office confirms").
// - The access matrix: the tipper link routes answer a DRIVER link only (SUPERVISOR, HANDOVER, OFFICE, POSTER, a
//   switched-off link and a made-up one get 404); a supervisor's Bins screen doesn't offer it, a driver's does. The office
//   data answers Managers, Admins and the coordinator; VIEWER / TIMESHEETS / ACCOUNTS / DIRECTOR / YARD / no login refused;
//   every write is Manager+ (the coordinator is refused).
// - Photos are required (none, another link's photo or one already on a load refused - also two phones at once); only
//   our tippers (not the hook truck, not a hired vehicle), active jobs, Other needs a note, no amount in the note.
// - The tipper is prefilled from the driver's truck sign-in today.
// - No dollar figure in any link reply or office reply (the seeded tip docket has a price - it never shows).
// - The tip docket is suggested (same job, same driver) and matched only by a Manager+, its own figures unchanged; a
//   docket matched to a bin can't go on a load and the other way round.
// - Corrections / cancel are Manager+ with a reason and kept in RecordChange; the "is it a tipper?" switch is Manager+,
//   owned vehicles only, kept in the vehicle's history. Client's loads are counted per job on the Bins page. A client's
//   load alerts the active coordinator login(s) only (end to end through a stub push host), behind BIN_ALERTS /
//   TIPPER_ALERTS. Nothing is deleted; no outbound call.
// WRITES (tagged "RC ... <tag>", on the test copy only): people, projects, a job, vehicles, a truck sign-in, links,
// tipper loads with 1x1 photos, tip docket receipts, one bin entry, test phone-alert devices (fake fcm addresses).
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
const REFUSED = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD", null];
const NO_WRITE = ["COORDINATOR", ...REFUSED];
const label = (who) => who ?? "no login";
const netLines = (c) => { try { return readFileSync(c.p.netLog, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
const filesUnder = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(e.name)) out.push(f); } };
  try { walk(dir); } catch { /* missing folder */ }
  return out;
};
const MONEYISH = /priceExGst|priceIncGst|ratePerTonne|"price"|amount|412\.5|388\.25/;

export default {
  id: "tipper-loads", title: "Tipper loads: DRIVER links only, photo required, our tippers only (prefilled from the truck sign-in), no money anywhere, tip docket suggested + Manager+ confirms (one docket, one bin or load), Manager+ corrections logged, coordinator view-only + alert, nothing deleted",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/bins/tipperRules.ts") || "needs lib/bins/tipperRules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const net0 = netLines(c);
    const tag = Date.now().toString(36);
    const counts = async () => ({ loads: await db.tipperLoad.count(), photos: await db.tipperLoadPhoto.count() });

    // Seed.
    const mk = (name, extra = {}) => db.resource.create({ data: { name: `${name} ${tag}`, type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE", ...extra } });
    const S = await mk("RC Tip super S", { category: "Site Manager", role: "Supervisor" }), D = await mk("RC Tip driver D", { category: "Truck Driver" }), D2 = await mk("RC Tip driver E", { category: "Truck Driver" }), O = await mk("RC Tip office O");
    const veh = (name, extra = {}) => db.resource.create({ data: { name: `${name} ${tag}`, type: "VEHICLE", category: "Tipper", status: "AVAILABLE", ownership: "OWNED", ...extra } });
    const T1 = await veh("Tipper - RC1"), T2 = await veh("RC Hook Truck", { category: "Hook" }), T3 = await veh("Tipper - RC hired", { ownership: "HIRED" }), T4 = await veh("RC 7 Seater");
    const P = await db.project.create({ data: { name: `RC Tip job ${tag}`, status: "ACTIVE" } });
    const Q = await db.project.create({ data: { name: `RC Tip done ${tag}`, status: "COMPLETED" } });
    const J = await db.job.create({ data: { projectId: P.id, title: P.name, date: new Date(`${c.today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    await db.assignment.create({ data: { jobId: J.id, resourceId: D.id, role: "Truck Driver" } });
    // D signed in on the tipper's truck QR this morning (a sign-in point: place VEHICLE, no job).
    await db.siteAttendance.create({ data: { place: "VEHICLE", vehicleId: T1.id, placeLabel: T1.name, date: c.today, resourceId: D.id, workerName: D.name, signInAt: new Date(Date.now() - 2 * 3_600_000), signInMethod: "POSTER", status: "CONFIRMED" } });
    const L = {
      drv: await makeLink(db, "DRIVER", D.id),
      drv2: await makeLink(db, "DRIVER", D2.id),
      sup: await makeLink(db, "SUPERVISOR", S.id),
      handover: await makeLink(db, "HANDOVER", S.id, { jobId: J.id, expiresAt: new Date(Date.now() + 36 * 3_600_000) }),
      office: await makeLink(db, "OFFICE", O.id),
      poster: await makeLink(db, "POSTER", null, { projectId: P.id }),
      off: await makeLink(db, "DRIVER", D.id, { revokedAt: new Date() }),
    };
    const fake = { secret: "x".repeat(32) };
    const photo = async (link) => (await (await c.post(c.site(link, "/tipper-loads/photos"), null, { dataUrl: JPEG })).json().catch(() => ({}))).id;
    const before = await counts();

    // (1) Link access: a DRIVER link only.
    for (const [name, link, want] of [["driver", L.drv, 200], ["supervisor", L.sup, 404], ["hand-over", L.handover, 404], ["office", L.office, 404], ["poster", L.poster, 404], ["switched-off", L.off, 404], ["made-up", fake, 404]]) {
      t.status(await c.get(c.site(link, "/tipper-loads"), null), want, `GET tipper loads on a ${name} link`);
      t.status(await c.post(c.site(link, "/tipper-loads/photos"), null, { dataUrl: JPEG }), want === 200 ? 201 : 404, `tipper photo upload on a ${name} link`);
      if (want !== 200) t.status(await c.post(c.site(link, "/tipper-loads"), null, {}), 404, `POST a tipper load on a ${name} link`);
    }
    const supBins = (await c.json(c.site(L.sup, "/bins"), null)).body;
    const drvBins = (await c.json(c.site(L.drv, "/bins"), null)).body;
    t.ok(supBins?.options?.tipperLoads === false && drvBins?.options?.tipperLoads === true, "the Bins screen offers Tipper load on the driver's link only", JSON.stringify([supBins?.options?.tipperLoads, drvBins?.options?.tipperLoads]));
    const routes = filesUnder(path.join(c.p.appDir, "src", "app", "api", "site", "[token]", "tipper-loads"));
    t.ok(routes.length === 2 && routes.every((f) => { const s = readFileSync(f, "utf8"); return s.includes("resolveBinLink") && s.includes("isDriverLink(link)") && !/resolveLink\(/.test(s); }), "the tipper link routes use resolveBinLink + the DRIVER check only", routes.map((f) => path.basename(path.dirname(f))).join(","));

    // (2) The driver's options: our tippers only, prefilled from the truck sign-in; no money.
    const opt = await c.text(c.site(L.drv, "/tipper-loads"), null);
    const o = JSON.parse(opt.text || "{}").options;
    const ids = (o?.tippers ?? []).map((x) => x.id);
    t.ok(ids.includes(T1.id) && !ids.includes(T2.id) && !ids.includes(T3.id) && !ids.includes(T4.id), "our tippers: the Tipper, not the hook truck, the hired one or the 7 seater", JSON.stringify(o?.tippers?.map((x) => x.label)));
    t.ok(o?.prefill === T1.id, "the tipper is prefilled from today's truck sign-in");
    t.ok(o?.projects?.[0]?.id === P.id && o.projects[0].mine === true, "the driver's job today is first on the list");
    t.ok(!o?.projects?.some((p) => p.id === Q.id), "a completed job isn't on the list");
    t.ok(noMoney(opt.text) && !MONEYISH.test(opt.text), "no money in the options reply");
    const o2 = (await c.json(c.site(L.drv2, "/tipper-loads"), null)).body?.options;
    t.ok(o2 && o2.prefill === null, "a driver with no truck sign-in today gets no prefill (they pick)");

    // (3) Refusals.
    const base = { vehicleId: T1.id, projectId: P.id, use: "CLIENT", contents: "Mixed C&D" };
    const send = (link, body) => c.post(c.site(link, "/tipper-loads"), null, body);
    t.status(await send(L.drv, { ...base, photoIds: [] }), 400, "a load with no photo");
    t.status(await send(L.drv, { ...base }), 400, "a load with no photoIds at all");
    t.status(await send(L.drv, { ...base, photoIds: [await photo(L.drv2)] }), 400, "a load with another link's photo");
    t.status(await c.post(c.site(L.drv, "/tipper-loads/photos"), null, { dataUrl: "data:text/plain;base64,aGVsbG8=" }), 400, "a photo that isn't an image");
    t.status(await send(L.drv, { ...base, vehicleId: T2.id, photoIds: [await photo(L.drv)] }), 400, "the hook truck isn't a tipper");
    t.status(await send(L.drv, { ...base, vehicleId: T3.id, photoIds: [await photo(L.drv)] }), 400, "a hired vehicle isn't ours");
    t.status(await send(L.drv, { ...base, projectId: Q.id, photoIds: [await photo(L.drv)] }), 400, "a completed job");
    t.status(await send(L.drv, { ...base, contents: "OTHER", photoIds: [await photo(L.drv)] }), 400, "Other with no note");
    t.status(await send(L.drv, { ...base, contentsNote: "$300 a load", photoIds: [await photo(L.drv)] }), 400, "an amount in the note");

    // (4) Log a client's load and our load; a photo can't go on two loads (also two at once).
    const p1 = await photo(L.drv);
    const l1 = await send(L.drv, { ...base, contentsNote: "brick and  tile", photoIds: [p1] });
    t.status(l1, 201, "the driver logs a client's load");
    const l1b = await l1.json().catch(() => ({}));
    t.ok(noMoney(JSON.stringify(l1b)) && !MONEYISH.test(JSON.stringify(l1b)), "no money in the reply");
    const load1 = await db.tipperLoad.findFirst({ where: { linkId: L.drv.id, use: "CLIENT" }, include: { photos: true } });
    t.ok(load1 && load1.vehicleId === T1.id && load1.vehicleFromSignIn === true && load1.status === "LOGGED" && load1.loadedByResourceId === D.id && load1.photos.length === 1 && load1.contentsNote === "brick and tile",
      "saved: the tipper (from the sign-in), the job, who, the photo, the note tidied", JSON.stringify(load1 && { v: load1.vehicleFromSignIn, s: load1.status, n: load1.photos.length, note: load1.contentsNote }));
    t.status(await send(L.drv, { ...base, photoIds: [p1] }), 400, "the same photo on a second load");
    const pr = await photo(L.drv);
    const race = await Promise.all([send(L.drv, { ...base, use: "OURS", photoIds: [pr] }), send(L.drv, { ...base, use: "OURS", photoIds: [pr] })]);
    t.ok(race.map((r) => r.status).sort().join(",") === "201,400", "two sends with the same photo at once: one 201, one refused", race.map((r) => r.status).join(","));
    t.ok((await db.tipperLoadPhoto.count({ where: { id: pr, loadId: { not: null } } })) === 1, "the photo is on one load");
    const today = (await c.json(c.site(L.drv, "/tipper-loads"), null)).body?.options?.today ?? [];
    t.ok(today.length === 2 && today.some((r) => r.use === "Client's load") && today.some((r) => r.use === "Our load"), "the driver's Today shows the two loads", JSON.stringify(today.map((r) => r.use)));
    t.ok(today.every((r) => !Object.keys(r).some((k) => /price|rate|amount|cost|loadedBy|person/i.test(k))), "a link row is words and dates only");

    // (5) Office access. GET: Managers, Admins, the coordinator; everyone else refused. Photos the same.
    for (const who of ["MANAGER", "ADMIN", "COORDINATOR"]) t.status(await c.get("/api/bins/tipper-loads", who), 200, `${who} reads the tipper loads`);
    for (const who of REFUSED) t.status(await c.get("/api/bins/tipper-loads", who), [401, 403], `${label(who)} reading the tipper loads`);
    for (const who of ["MANAGER", "COORDINATOR"]) t.status(await c.get(`/api/bins/tipper-loads/photos/${p1}`, who), 200, `${who} opens a load photo`);
    for (const who of REFUSED) t.status(await c.get(`/api/bins/tipper-loads/photos/${p1}`, who), [401, 403], `${label(who)} opening a load photo`);
    const loose = await photo(L.drv);
    t.status(await c.get(`/api/bins/tipper-loads/photos/${loose}`, "MANAGER"), 404, "a photo not on a load isn't served");
    t.status(await c.get("/bins?tab=tipper", "COORDINATOR"), 200, "the Bins page (tipper tab) loads for the coordinator");

    // (6) The tip docket: suggested, confirmed by a Manager+ only; one docket, one bin or load.
    const tipR = await db.receipt.create({ data: {
      kind: "TIP", siteLinkId: L.drv.id, sentBy: D.name, sentByResourceId: D.id, sentAt: new Date(Date.now() + 3_600_000), jobId: J.id, projectId: P.id,
      asbestos: false, status: "READ", docketNo: `RC-T-${tag}`, tipSite: "RC Tip", wasteType: "Mixed C&D", tonnes: 4.2, priceExGst: 412.5 } });
    const off1 = await c.text(`/api/bins/tipper-loads?projectId=${P.id}`, "MANAGER");
    const row1 = JSON.parse(off1.text || "{}").loads?.find?.((r) => r.id === load1.id);
    t.ok(row1?.suggestions?.some((s) => s.receiptId === tipR.id && s.sameDriver), "the load suggests the driver's tip docket (same job, same driver)", JSON.stringify(row1?.suggestions ?? null).slice(0, 160));
    t.ok(!row1?.tip, "...not matched until a person confirms");
    t.ok(row1?.photos?.length === 1 && row1.fromSignIn === true, "the office row has the photo and says the tipper came from the sign-in");
    for (const [who, r] of [["MANAGER", off1], ["COORDINATOR", await c.text("/api/bins/tipper-loads", "COORDINATOR")], ["MANAGER bins", await c.text("/api/bins", "MANAGER")]]) {
      t.ok(r.status === 200 && noMoney(r.text) && !MONEYISH.test(r.text), `no money in the office data (${who})`, (r.text.match(MONEYISH) ?? [""])[0]);
    }
    for (const who of NO_WRITE) t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, who, { action: "tip-confirm", receiptId: tipR.id }), [401, 403], `${label(who)} confirming a load's tip docket`);
    t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "MANAGER", { action: "tip-confirm", receiptId: tipR.id }), 200, "a Manager confirms the tip docket");
    t.ok((await db.tipperLoad.findUnique({ where: { id: load1.id } })).tipReceiptId === tipR.id, "the load has its tip docket");
    const tipAfter = await db.receipt.findUnique({ where: { id: tipR.id } });
    t.ok(tipAfter.priceExGst === 412.5 && tipAfter.tonnes === 4.2 && tipAfter.status === "READ" && tipAfter.invoicedCostId === tipR.invoicedCostId, "the docket's own figures and status are unchanged");
    const load2 = await db.tipperLoad.findFirst({ where: { linkId: L.drv.id, use: "OURS", status: "LOGGED" } });
    t.status(await c.patch(`/api/bins/tipper-loads/${load2.id}`, "MANAGER", { action: "tip-confirm", receiptId: tipR.id }), 409, "the same docket on a second load");
    // A picked-up bin on the same job can't take that docket either - and a docket on a bin can't go on a load.
    const bin = await db.binMovement.create({ data: { projectId: P.id, size: "M9", use: "OURS", contents: "Mixed C&D", status: "PICKED_UP", deliveredBy: D.name, deliveredLinkId: L.drv.id, deliveredAt: new Date(Date.now() - 86_400_000), pickedUpAt: new Date(), pickedUpBy: D.name, pickedUpByResourceId: D.id, pickedUpLinkId: L.drv.id } });
    t.status(await c.patch(`/api/bins/${bin.id}`, "MANAGER", { action: "tip-confirm", receiptId: tipR.id }), 409, "a docket matched to a load can't be confirmed for a bin");
    const binHist = (await c.json("/api/bins", "MANAGER")).body?.history?.find?.((r) => r.id === bin.id);
    t.ok(!binHist?.suggestions?.some((s) => s.receiptId === tipR.id), "...and the bin isn't offered it");
    const tipB = await db.receipt.create({ data: { kind: "TIP", siteLinkId: L.drv.id, sentBy: D.name, sentByResourceId: D.id, sentAt: new Date(Date.now() + 2 * 3_600_000), projectId: P.id, asbestos: false, status: "READ", docketNo: `RC-B-${tag}`, priceExGst: 388.25 } });
    t.status(await c.patch(`/api/bins/${bin.id}`, "MANAGER", { action: "tip-confirm", receiptId: tipB.id }), 200, "a second docket is matched to the bin");
    t.status(await c.patch(`/api/bins/tipper-loads/${load2.id}`, "MANAGER", { action: "tip-confirm", receiptId: tipB.id }), 409, "a docket matched to a bin can't be confirmed for a load");
    const off2 = (await c.json(`/api/bins/tipper-loads?projectId=${P.id}`, "MANAGER")).body;
    t.ok(!off2?.loads?.find?.((r) => r.id === load2.id)?.suggestions?.some((s) => s.receiptId === tipB.id || s.receiptId === tipR.id), "...and the load isn't offered either taken docket");
    t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "ADMIN", { action: "tip-reject", receiptId: tipR.id }), 200, "an Admin says it's not this load's after all");
    t.ok((await db.tipperLoad.findUnique({ where: { id: load1.id } })).tipReceiptId === null, "...the match is taken off");
    t.ok((await db.recordChange.count({ where: { model: "TipperLoad", recordId: load1.id, field: "tipReceiptId" } })) === 2, "both tip decisions are in the history");

    // (7) Corrections and cancel: Manager+ with a reason, kept in the history; the coordinator is refused.
    for (const who of NO_WRITE) t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, who, { action: "correct", use: "OURS", reason: "RC refused" }), [401, 403], `${label(who)} correcting a load`);
    t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "MANAGER", { action: "correct", use: "OURS" }), 400, "a correction with no reason");
    t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "MANAGER", { action: "correct", vehicleId: T2.id, reason: "RC wrong truck" }), 400, "correcting onto a vehicle that isn't a tipper");
    t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "MANAGER", { action: "correct", use: "OURS", reason: "RC was ours" }), 200, "a Manager corrects client's -> ours");
    const rc = await db.recordChange.findFirst({ where: { model: "TipperLoad", recordId: load1.id, field: "use" } });
    t.ok(rc?.before === "CLIENT" && rc?.after === "OURS" && rc?.reason === "RC was ours" && rc?.changedById === c.users.MANAGER.id, "the correction is logged (before, after, reason, who)");
    t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "MANAGER", { action: "correct", use: "CLIENT", reason: "RC was the client's after all" }), 200, "and back");

    // (8) The "is it a tipper?" switch: Manager+, owned vehicles only, kept in the vehicle's history.
    for (const who of NO_WRITE) t.status(await c.patch(`/api/bins/tippers/${T2.id}`, who, { tipper: true }), [401, 403], `${label(who)} changing the tipper list`);
    t.status(await c.patch(`/api/bins/tippers/${T3.id}`, "MANAGER", { tipper: true }), 400, "a hired vehicle can't be made a tipper");
    t.status(await c.patch(`/api/bins/tippers/${T2.id}`, "MANAGER", { tipper: "yes" }), 400, "tipper must be yes or no");
    t.status(await c.patch(`/api/bins/tippers/${T2.id}`, "MANAGER", { tipper: true, reason: "RC carries a tipper body now" }), 200, "a Manager makes the hook truck a tipper");
    const o3 = (await c.json(c.site(L.drv, "/tipper-loads"), null)).body?.options;
    t.ok(o3?.tippers?.some((x) => x.id === T2.id), "...it's on the driver's list");
    t.ok(!!(await db.recordChange.findFirst({ where: { model: "Resource", recordId: T2.id, field: "tipper", after: "yes" } })), "...and in the vehicle's history");
    t.status(await c.patch(`/api/bins/tipper-loads/${load2.id}`, "MANAGER", { action: "correct", vehicleId: T2.id, reason: "RC it was the other truck" }), 200, "a load corrected onto it");
    t.ok((await db.tipperLoad.findUnique({ where: { id: load2.id } })).vehicleLabel === T2.name, "...with its name");
    t.status(await c.patch(`/api/bins/tippers/${T2.id}`, "ADMIN", { tipper: false, reason: "RC back to hook bins" }), 200, "an Admin takes it off again");
    const filt = (await c.json(`/api/bins/tipper-loads?vehicleId=${T2.id}`, "MANAGER")).body;
    t.ok(filt?.loads?.length === 1 && filt.loads[0].id === load2.id && filt.tippers.some((x) => x.id === T2.id), "the tipper filter finds its load (a vehicle a load names stays in the filter list)");
    t.ok((await c.json(`/api/bins/tipper-loads?use=OURS&projectId=${P.id}`, "MANAGER")).body?.loads?.every?.((r) => r.useKey === "OURS"), "the client's / ours filter");
    t.status(await c.patch(`/api/bins/tipper-loads/${load2.id}`, "MANAGER", { action: "cancel" }), 400, "a cancel with no reason");
    t.status(await c.patch(`/api/bins/tipper-loads/${load2.id}`, "MANAGER", { action: "cancel", reason: "RC logged twice" }), 200, "a Manager cancels a wrong load");
    const cx = await db.tipperLoad.findUnique({ where: { id: load2.id } });
    t.ok(cx?.status === "CANCELLED" && cx.cancelReason === "RC logged twice", "it's kept, marked cancelled, with the reason");
    t.status(await c.patch(`/api/bins/tipper-loads/${load2.id}`, "MANAGER", { action: "correct", use: "CLIENT", reason: "RC again" }), 409, "a cancelled load can't be changed");

    // (9) Client's loads by job: on the Bins page's Client's bins by job and on the tab - a direct count, no money.
    const want = await db.tipperLoad.count({ where: { projectId: P.id, use: "CLIENT", status: { not: "CANCELLED" } } });
    const cj = (await c.json(`/api/bins?from=${c.today}&to=${c.today}`, "COORDINATOR")).body?.clientByJob?.find?.((x) => x.projectId === P.id);
    t.ok(cj && cj.tipperLoads === want && want >= 1, "Client's bins by job counts the job's client's tipper loads", JSON.stringify(cj ?? null));
    const tj = (await c.json(`/api/bins/tipper-loads?from=${c.today}&to=${c.today}`, "MANAGER")).body?.clientByJob?.find?.((x) => x.projectId === P.id);
    t.ok(tj?.loads === want, "the tab's client's loads by job agrees");
    t.ok(!(await c.json("/api/bins/tipper-loads?from=2001-01-01&to=2001-01-02", "MANAGER")).body?.clientByJob?.some?.((x) => x.projectId === P.id), "a date range with no loads counts none");

    // (10) The alert to Alex, end to end through a stub push host (nothing leaves the machine): a client's load reaches
    // the coordinator's phone, words only; our load nothing; TIPPER_ALERTS=off and BIN_ALERTS=off nothing.
    const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
    const auth = randomBytes(16);
    const coEp = `https://fcm.googleapis.com/fcm/send/rc-tip-coord-${tag}-${randomBytes(6).toString("hex")}`;
    t.status(await c.post("/api/push", "COORDINATOR", { subscription: { endpoint: coEp, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }, label: "RC tipper" }), 200, "the coordinator turns on alerts");
    const tsxCli = path.join(c.p.appDir, "node_modules", "tsx", "dist", "cli.mjs");
    const client = await db.tipperLoad.findFirst({ where: { projectId: P.id, use: "CLIENT", status: "LOGGED" } });
    const ours = await db.tipperLoad.findFirst({ where: { projectId: P.id, use: "OURS" } });
    // TL-005: an our-load that the office will correct to a client's load inside the child (the alert after the commit).
    const ours3 = await db.tipperLoad.create({ data: { vehicleId: T1.id, vehicleLabel: T1.name, projectId: P.id, use: "OURS", contents: "Mixed C&D", status: "LOGGED", loadedBy: D.name, loadedByResourceId: D.id, linkId: L.drv.id } });
    if (existsSync(tsxCli) && c.p.files && client && ours) {
      const script = path.join(c.p.files, `rc112-alert-${tag}.mts`);
      const fileUrl = (rel) => "file:///" + path.join(c.p.appDir, ...rel.split("/")).split(path.sep).join("/");
      writeFileSync(script, [
        `import https from "node:https";`,
        `import { EventEmitter } from "node:events";`,
        `import { createRequire } from "node:module";`,
        `const req = createRequire(${JSON.stringify(path.join(c.p.appDir, "package.json"))});`,
        `const webpush = req("web-push");`,
        `const keys = webpush.generateVAPIDKeys();`,
        `process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey; process.env.VAPID_SUBJECT = "mailto:release-check@example.test";`,
        `delete process.env.BIN_ALERTS; delete process.env.TIPPER_ALERTS;`,
        `const seen = [];`,
        `https.request = (opts, cb) => {`,
        `  const r = new EventEmitter(); const chunks = [];`,
        `  r.write = (b) => { chunks.push(Buffer.from(b)); return true; }; r.destroy = () => {}; r.setTimeout = () => r;`,
        `  r.end = () => { seen.push({ host: opts.hostname, path: opts.path, body: Buffer.concat(chunks).toString("base64") });`,
        `    const res = new EventEmitter(); res.statusCode = 201; res.headers = {}; cb(res); process.nextTick(() => res.emit("end")); };`,
        `  return r;`,
        `};`,
        `const { alertClientTipper, changeTipperLoad } = await import(${JSON.stringify(fileUrl("src/lib/bins/tipperStore.ts"))});`,
        `const a = await alertClientTipper(${JSON.stringify(client.id)}); const afterClient = seen.length;`,
        `const b = await alertClientTipper(${JSON.stringify(ours.id)}); const afterOurs = seen.length;`,
        `process.env.TIPPER_ALERTS = "off"; const d = await alertClientTipper(${JSON.stringify(client.id)}); delete process.env.TIPPER_ALERTS;`,
        `process.env.BIN_ALERTS = "off"; const e = await alertClientTipper(${JSON.stringify(client.id)}); const afterOff = seen.length; delete process.env.BIN_ALERTS;`,
        `await changeTipperLoad(${JSON.stringify(ours3.id)}, { action: "correct", use: "CLIENT", reason: "RC TL-005 it was the client's" }, { id: null, name: "RC check" });`,
        `for (let i = 0; i < 40 && seen.length === afterOff; i++) await new Promise((r) => setTimeout(r, 100)); const afterCorrect = seen.length;`,
        `console.log("RESULT " + JSON.stringify({ a, b, d, e, afterClient, afterOurs, afterOff, afterCorrect, seen }));`,
        `process.exit(0);`,
      ].join("\n"));
      let out = "";
      const guard = path.join(c.p.appDir, "scripts", "release-check", "lib", "outbound-guard.cjs");
      try { out = execFileSync(process.execPath, [tsxCli, script], { cwd: c.p.appDir, env: { ...process.env, ...(c.childEnv ?? {}), NODE_OPTIONS: `--require ${JSON.stringify(guard)}`, RELEASE_CHECK_NET_LOG: c.p.netLog }, encoding: "utf8", timeout: 120_000 }); }
      catch (err) { out = String(err?.stdout ?? "") + String(err?.stderr ?? ""); }
      let res = null;
      try { res = JSON.parse(out.split("\n").find((l) => l.startsWith("RESULT "))?.slice(7) ?? "null"); } catch { /* checked below */ }
      t.ok(!!res && res.a >= 1, "a client's load alert reached a coordinator phone (through the stub push host)", res ? JSON.stringify({ a: res.a }) : out.slice(0, 200));
      const coordPhones = new Set((await db.pushDevice.findMany({ where: { user: { role: "COORDINATOR", active: true } }, select: { endpoint: true } })).map((x) => { try { const u = new URL(x.endpoint); return `${u.hostname}${u.pathname}`; } catch { return ""; } }));
      const toCoord = (res?.seen ?? []).slice(0, res?.afterClient ?? 0).filter((s) => s.path === new URL(coEp).pathname);
      t.ok(toCoord.length === 1 && (res?.seen ?? []).every((s) => coordPhones.has(`${s.host}${s.path}`)), "...to coordinator phones only (this check's coordinator once)");
      let payload = null;
      try {
        const ece = createRequire(path.join(c.p.appDir, "package.json"))("http_ece");
        payload = JSON.parse(ece.decrypt(Buffer.from(toCoord[0].body, "base64"), { version: "aes128gcm", privateKey: ecdh, authSecret: auth }).toString("utf8"));
      } catch (err) { t.note(`couldn't decrypt the stubbed push: ${String(err?.message ?? err).slice(0, 120)}`); }
      t.ok(payload?.title === "Client's tipper load" && payload?.url === "/bins?tab=tipper" && payload?.tag === `tip-client-${P.id}`.slice(0, 40) && payload?.silent === true, "the alert says \"Client's tipper load\", opens the tab, quiet, one tag per job", JSON.stringify(payload));
      t.ok(!!payload && noMoney(JSON.stringify(payload)) && payload.body.includes(`RC Tip job ${tag}`), "words only - the job and the tipper, no money", payload?.body);
      t.ok(res?.b === 0 && res?.afterOurs === res?.afterClient, "our load sends nothing");
      t.ok(res?.d === 0 && res?.e === 0 && res?.afterOff === res?.afterOurs, "TIPPER_ALERTS=off and BIN_ALERTS=off send nothing");
      // TL-005 (Ilies, 27 Nov 2026: "Yes, alert Alex"): our load corrected to a client's load -> the same quiet alert, after the commit.
      const afterFix = (res?.seen ?? []).slice(res?.afterOff ?? 0).filter((s) => s.path === new URL(coEp).pathname);
      let fixPayload = null;
      try { fixPayload = JSON.parse(createRequire(path.join(c.p.appDir, "package.json"))("http_ece").decrypt(Buffer.from(afterFix[0].body, "base64"), { version: "aes128gcm", privateKey: ecdh, authSecret: auth }).toString("utf8")); } catch { /* checked below */ }
      t.ok(afterFix.length === 1 && fixPayload?.title === "Client's tipper load" && fixPayload?.tag === `tip-client-${P.id}`.slice(0, 40) && noMoney(JSON.stringify(fixPayload)), "TL-005: an our-load corrected to a client's load alerts the coordinator once (same alert, per-job tag, no money)", JSON.stringify({ n: afterFix.length, title: fixPayload?.title }));
      t.ok((await db.tipperLoad.findUnique({ where: { id: ours3.id } })).use === "CLIENT", "...and the correction was saved");
    } else t.block("no tsx in the candidate's node_modules (or no client / our load) - the alert couldn't be run end to end");
    const storeSrc = readFileSync(path.join(c.p.appDir, "src", "lib", "bins", "tipperStore.ts"), "utf8");
    t.ok(/if \(input\.use === "CLIENT"\) void alertClientTipper\(/.test(storeSrc) && /tipperAlertsOn\(\)/.test(storeSrc) && /role: "COORDINATOR", active: true/.test(storeSrc), "a client's load alerts the active coordinator login(s) only, behind the kill switches");


    // (10b) The security follow-ups (Ilies approved TL-001..TL-005, 27 Nov 2026).
    // TL-001: the day's caps are re-counted just before the save, one at a time per link, and at most 3 uploads per link are in progress - 60
    // parallel uploads from one link store at most the cap (photos, loads, and the receipts path too).
    const D3 = await mk("RC Tip driver F", { category: "Truck Driver" });
    const capLink = await makeLink(db, "DRIVER", D3.id);
    for (let i = 0; i < 37; i++) await db.tipperLoadPhoto.create({ data: { fileName: `rc-cap-${tag}-${i}.jpg`, siteLinkId: capLink.id, takenBy: D3.name } });
    const burst = await Promise.all(Array.from({ length: 60 }, () => c.post(c.site(capLink, "/tipper-loads/photos"), null, { dataUrl: JPEG })));
    const codes = burst.map((r) => r.status);
    const stored = await db.tipperLoadPhoto.count({ where: { siteLinkId: capLink.id } });
    t.ok(stored <= 40 && codes.every((x) => x === 201 || x === 429) && codes.filter((x) => x === 201).length === stored - 37, "TL-001: 60 parallel load-photo uploads from one link store at most the cap of 40 (the rest 429)", JSON.stringify({ stored, ok: codes.filter((x) => x === 201).length, refused: codes.filter((x) => x === 429).length }));
    const fresh = await makeLink(db, "DRIVER", D3.id);
    const burst2 = (await Promise.all(Array.from({ length: 12 }, () => c.post(c.site(fresh, "/tipper-loads/photos"), null, { dataUrl: JPEG })))).map((r) => r.status);
    t.ok(burst2.includes(429) && burst2.every((x) => x === 201 || x === 429), "TL-001: a burst of 12 at once from a fresh link is held to a few in progress (some 429)", burst2.join(","));
    // Loads: 39 already today, 5 sent at once with their own photos -> exactly one more.
    const loadLink = await makeLink(db, "DRIVER", D3.id);
    const lp = [];
    for (let i = 0; i < 5; i++) lp.push(await photo(loadLink));
    for (let i = 0; i < 39; i++) await db.tipperLoad.create({ data: { vehicleId: T1.id, vehicleLabel: T1.name, projectId: P.id, use: "OURS", contents: "Mixed C&D", status: "LOGGED", loadedBy: D3.name, loadedByResourceId: D3.id, linkId: loadLink.id } });
    const lr = (await Promise.all(lp.map((pid) => send(loadLink, { ...base, use: "OURS", photoIds: [pid] })))).map((r) => r.status);
    t.ok((await db.tipperLoad.count({ where: { linkId: loadLink.id } })) === 40 && lr.filter((x) => x === 201).length === 1, "TL-001: 5 loads sent at once with 39 already today -> exactly one more (cap 40)", lr.join(","));
    // Receipts: 58 already today on a driver link, 60 at once -> at most 60 in all.
    const recLink = await makeLink(db, "DRIVER", D3.id);
    for (let i = 0; i < 58; i++) await db.receiptPhoto.create({ data: { fileName: `rc-rcap-${tag}-${i}.jpg`, siteLinkId: recLink.id, takenBy: D3.name } });
    const rb = (await Promise.all(Array.from({ length: 60 }, () => c.post(c.site(recLink, "/receipts/photos"), null, { dataUrl: JPEG })))).map((r) => r.status);
    const recStored = await db.receiptPhoto.count({ where: { siteLinkId: recLink.id } });
    t.ok(recStored <= 60 && rb.every((x) => x === 201 || x === 429), "TL-001: 60 parallel receipt-photo uploads store at most the receipts cap of 60", JSON.stringify({ recStored, ok: rb.filter((x) => x === 201).length }));
    // TL-002: the same photo on another load is flagged on the office row (never refused - both loads went in).
    const withHash = await db.tipperLoadPhoto.count({ where: { loadId: load1.id, sha256: { not: null } } });
    const flagged = (await c.json(`/api/bins/tipper-loads?projectId=${P.id}`, "MANAGER")).body?.loads?.find?.((r) => r.id === load1.id);
    t.ok(withHash === 1 && flagged?.samePhotoAs?.length >= 1 && flagged.samePhotoAs.every((s) => s.loadId !== load1.id && s.tipper && s.loadedAt), "TL-002: the photo's sha256 is kept, and the office row says \"Same photo as the load of ...\"", JSON.stringify(flagged?.samePhotoAs ?? null).slice(0, 160));
    // TL-003 ("Block it"): the Building Agent login reads, but every tipper-load write is 403 and changes nothing.
    if (c.users.OPS_AI) {
      t.status(await c.get("/api/bins/tipper-loads", "OPS_AI"), 200, "TL-003: the Building Agent login still reads the tipper loads");
      const beforeAgent = JSON.stringify(await db.tipperLoad.findUnique({ where: { id: load1.id } }));
      for (const body of [{ action: "correct", use: "OURS", reason: "RC agent" }, { action: "cancel", reason: "RC agent" }, { action: "tip-confirm", receiptId: tipR.id }, { action: "tip-reject", receiptId: tipR.id }]) {
        t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "OPS_AI", body), 403, `TL-003: the Building Agent login is refused ${body.action} on a load`);
      }
      t.status(await c.patch(`/api/bins/tippers/${T2.id}`, "OPS_AI", { tipper: true }), 403, "TL-003: ...and the tipper on / off switch");
      t.ok(JSON.stringify(await db.tipperLoad.findUnique({ where: { id: load1.id } })) === beforeAgent && !(await db.tipperVehicle.findUnique({ where: { vehicleId: T2.id } }))?.tipper, "TL-003: nothing changed");
    } else t.block("no Operations AI (Building Agent) login on the copy - TL-003 not run");
    // TL-004: no amount in a cancel reason.
    t.status(await c.patch(`/api/bins/tipper-loads/${load1.id}`, "MANAGER", { action: "cancel", reason: "RC charged $250 already" }), 400, "TL-004: a cancel reason with an amount is refused");
    t.ok((await db.tipperLoad.findUnique({ where: { id: load1.id } })).status === "LOGGED", "...the load is still logged");
    const tlSrc = readFileSync(path.join(c.p.appDir, "src", "lib", "bins", "tipperStore.ts"), "utf8");
    t.ok(/if \(becameClient\) void alertClientTipper\(out\.id\)/.test(tlSrc) && tlSrc.indexOf("if (becameClient)") > tlSrc.indexOf("const out = await prisma.$transaction"), "TL-005: the correction alert is sent after the transaction");

    // (11) Nothing is deleted: no DELETE handler, no delete in the source, the counts never went down.
    for (const pth of [`/api/bins/tipper-loads/${load1.id}`, "/api/bins/tipper-loads", `/api/bins/tippers/${T1.id}`, c.site(L.drv, "/tipper-loads")]) t.status(await c.del(pth, "ADMIN"), [404, 405], `DELETE ${pth.replace(L.drv.secret, "<link>")}`);
    const src = [...filesUnder(path.join(c.p.appDir, "src", "lib", "bins")), ...filesUnder(path.join(c.p.appDir, "src", "app", "api", "bins")), ...routes];
    const deleting = src.filter((f) => /\b(tipperLoad|tipperLoadPhoto|tipperVehicle)\.(delete|deleteMany)\(/.test(readFileSync(f, "utf8")));
    t.ok(deleting.length === 0, "no tipper code deletes a row", deleting.map((f) => path.relative(c.p.appDir, f)).join(","));
    const after = await counts();
    t.ok(after.loads >= before.loads + 2 && after.photos >= before.photos, "loads and photos only ever grew", JSON.stringify({ before, after }));

    // (12) Nothing was called outside during this check.
    t.ok(netLines(c) === net0, "no outbound connection attempted during this check", `${netLines(c) - net0} new blocked attempt(s)`);
  },
};
