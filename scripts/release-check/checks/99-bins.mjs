// Bins (Ilies, 23 Nov 2026: "when a client asks us for a bin we deliver, take a photo of it delivered and same when its
// picked up ... which job and whether it was a clients bin (were charging them) or it our bin for our jobs").
// - The access matrix: the link screens answer a SUPERVISOR and a DRIVER link only (HANDOVER, OFFICE, POSTER, a switched-
//   off link and a made-up one get 404); a DRIVER link still reaches receipts + bins and nothing else. The office data
//   answers Managers, Admins and the coordinator; VIEWER / TIMESHEETS / ACCOUNTS / DIRECTOR / YARD / no login refused.
// - No dollar figure in any link reply or office reply (the seeded tip docket has a price - it never shows).
// - Photos are required (none, or another link's photo, refused); no double delivery of a bin while it's out (also two
//   phones at once); no double pick-up (also two at once).
// - Office corrections, cancels, the tip docket decision and register changes are Manager+ only (the coordinator is
//   refused every write) and are kept in RecordChange with the reason; nothing is ever deleted (no DELETE handler, no
//   delete in the source, row counts never go down); the tip docket's own figures are never changed.
// WRITES (tagged "RC ... <tag>", on the test copy only): three people, two projects, one job today, links of every kind,
// bins in the register, bin deliveries / pick-ups with 1x1 photos, one tip docket receipt.
import { readFileSync, readdirSync } from "node:fs";
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
const MONEYISH = /priceExGst|priceIncGst|ratePerTonne|"price"|amount|412\.5/;

export default {
  id: "bins", title: "Bins: SUPERVISOR / DRIVER links only (DRIVER = receipts + bins), photos required, no double delivery / pick-up, no money anywhere, Manager+ corrections logged, nothing deleted, coordinator view-only",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/bins/rules.ts") || "needs lib/bins/rules.ts",
  async run(t, c) {
    const db = c.db;
    if (!db) return t.block("no test database handle");
    const net0 = netLines(c);
    const tag = Date.now().toString(36);
    const counts = async () => ({ bins: await db.bin.count(), moves: await db.binMovement.count(), photos: await db.binPhoto.count() });

    // Seed.
    const mk = (name, extra = {}) => db.resource.create({ data: { name: `${name} ${tag}`, type: "PERSONNEL", category: "Labourer", role: "General labour", status: "AVAILABLE", ...extra } });
    const S = await mk("RC Bins super S", { category: "Site Manager", role: "Supervisor" }), D = await mk("RC Bins driver D"), O = await mk("RC Bins office O");
    const P = await db.project.create({ data: { name: `RC Bins job ${tag}`, status: "ACTIVE" } });
    const Q = await db.project.create({ data: { name: `RC Bins done ${tag}`, status: "COMPLETED" } });
    const J = await db.job.create({ data: { projectId: P.id, title: P.name, date: new Date(`${c.today}T00:00:00.000Z`), shift: "DAY", status: "ACTIVE", startTime: "7am", endTime: "3:30pm" } });
    await db.assignment.create({ data: { jobId: J.id, resourceId: S.id, role: "Supervisor" } });
    const tomorrow = new Date(Date.now() + 36 * 3_600_000);
    const L = {
      sup: await makeLink(db, "SUPERVISOR", S.id),
      drv: await makeLink(db, "DRIVER", D.id),
      handover: await makeLink(db, "HANDOVER", S.id, { jobId: J.id, expiresAt: tomorrow }),
      office: await makeLink(db, "OFFICE", O.id),
      poster: await makeLink(db, "POSTER", null, { projectId: P.id }),
      off: await makeLink(db, "SUPERVISOR", S.id, { revokedAt: new Date() }),
    };
    const fake = { secret: "x".repeat(32) };
    const photo = async (link) => (await (await c.post(c.site(link, "/bins/photos"), null, { dataUrl: JPEG })).json().catch(() => ({}))).id;
    const linkJson = async (link) => { const r = await c.get(c.site(link, "/bins"), null); return { status: r.status, text: await r.text().catch(() => "") }; };
    const before = await counts();

    // (1) Link access. Only SUPERVISOR and DRIVER links; the hand-over link is live (its home answers) but gets no bins.
    t.status(await c.get(c.site(L.handover), null), 200, "the hand-over link itself is live (crew sign-in)");
    for (const [name, link, want] of [["supervisor", L.sup, 200], ["driver", L.drv, 200], ["hand-over", L.handover, 404], ["office", L.office, 404], ["poster", L.poster, 404], ["switched-off", L.off, 404], ["made-up", fake, 404]]) {
      t.status(await c.get(c.site(link, "/bins"), null), want, `GET bins on a ${name} link`);
      t.status(await c.post(c.site(link, "/bins/photos"), null, { dataUrl: JPEG }), want === 200 ? 201 : 404, `bin photo upload on a ${name} link`);
      if (want !== 200) t.status(await c.post(c.site(link, "/bins"), null, { action: "deliver" }), 404, `POST bins on a ${name} link`);
    }
    // A DRIVER link: receipts + bins and nothing else.
    const dh = (await c.json(c.site(L.drv), null)).body;
    t.ok(dh?.kind === "DRIVER", "the driver link's home says DRIVER");
    t.status(await c.get(c.site(L.drv, "/receipts"), null), 200, "driver link: receipts");
    t.status(await c.get(c.site(L.drv, "/bins"), null), 200, "driver link: bins");
    for (const p of ["requests", "hire", "signin", "log", "todo", "yard", "hours", "purchases", "progress"]) t.status(await c.get(c.site(L.drv, `/${p}`), null), [404, 405], `driver link refused on ${p}`);
    // Office questions answer any link with an empty list unless resolveLink accepts it (it never accepts DRIVER).
    const dq = await c.json(c.site(L.drv, "/queries"), null);
    t.ok(dq.status === 404 || (Array.isArray(dq.body?.queries) && dq.body.queries.length === 0), "driver link: no office questions (an empty list)", JSON.stringify(dq.body).slice(0, 120));
    const src = readFileSync(path.join(c.p.appDir, "src", "lib", "siteLinks.ts"), "utf8");
    const rl = src.slice(src.indexOf("export async function resolveLink"), src.indexOf("export type ReceiptLink"));
    t.ok(rl.length > 0 && !rl.includes('"DRIVER"'), "resolveLink still never accepts DRIVER");
    const binRoutes = filesUnder(path.join(c.p.appDir, "src", "app", "api", "site", "[token]", "bins"));
    t.ok(binRoutes.length === 2 && binRoutes.every((f) => { const s = readFileSync(f, "utf8"); return s.includes("resolveBinLink") && !/resolveLink\(/.test(s); }), "the link bins routes use resolveBinLink only", binRoutes.map((f) => path.basename(path.dirname(f))).join(","));

    // (2) Office access. GET: Managers, Admins, the coordinator. Everyone else refused.
    for (const who of ["MANAGER", "ADMIN", "COORDINATOR"]) t.status(await c.get("/api/bins", who), 200, `${who} reads the Bins data`);
    for (const who of REFUSED) {
      t.status(await c.get("/api/bins", who), [401, 403], `${label(who)} reading the Bins data`);
      t.status(await c.get("/api/bins?summary=1", who), [401, 403], `${label(who)} reading the Bins out card`);
    }
    for (const who of ["MANAGER", "COORDINATOR"]) t.status(await c.get("/bins", who), 200, `the Bins page loads for ${who}`);

    // (3) Register: Manager+ only; never the coordinator or the rest.
    for (const who of NO_WRITE) t.status(await c.post("/api/bins/register", who, { size: "M15", label: `RC refused ${tag}` }), [401, 403], `${label(who)} adding a bin`);
    t.ok(!(await db.bin.findFirst({ where: { label: `RC refused ${tag}` } })), "and no bin was added");
    const add = async (who, body) => { const r = await c.post("/api/bins/register", who, body); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const A15 = await add("MANAGER", { size: "M15", label: `RC 15 A ${tag}` });
    const B15 = await add("MANAGER", { size: "M15", label: `RC 15 B ${tag}` });
    const N9 = await add("ADMIN", { size: "M9", label: `RC 9 ${tag}` });
    t.ok(A15.status === 201 && B15.status === 201 && N9.status === 201, "a Manager and an Admin add bins", JSON.stringify([A15.status, B15.status, N9.status]));
    t.status((await add("MANAGER", { size: "M15", label: `RC 15 A ${tag}` })).status, 409, "the same name twice");
    t.status((await add("MANAGER", { size: "M20" })).status, 400, "a size that isn't on the list");
    t.status((await add("MANAGER", { size: "M8", label: "RC $500 bin" })).status, 400, "an amount in a bin's name");
    const def = await add("MANAGER", { size: "HOOK" });
    t.ok(def.status === 201 && /^Hook bin \(\d+\)$/.test(def.body.label ?? ""), "a blank name becomes e.g. \"Hook bin (1)\"", def.body.label);
    t.ok((await db.recordChange.count({ where: { model: "Bin", recordId: A15.body.id } })) >= 2, "adding a bin is in its history");
    const binA = A15.body.id, binB = B15.body.id, bin9 = N9.body.id;

    // (4) Photos are required, and must be this link's own.
    const base = { action: "deliver", projectId: P.id, use: "CLIENT", size: "M15", binId: binA, contents: "Mixed C&D" };
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base, photoIds: [] }), 400, "a delivery with no photo");
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base }), 400, "a delivery with no photoIds at all");
    const drvPhoto = await photo(L.drv);
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base, photoIds: [drvPhoto] }), 400, "a delivery with another link's photo");
    t.status(await c.post(c.site(L.sup, "/bins/photos"), null, { dataUrl: "data:text/plain;base64,aGVsbG8=" }), 400, "a photo that isn't an image");
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base, binId: undefined, photoIds: [await photo(L.sup)] }), 409, "two 15s free and none picked -> which one?");
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base, projectId: Q.id, photoIds: [await photo(L.sup)] }), 400, "a completed job isn't on the link's list");
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base, contents: "OTHER", photoIds: [await photo(L.sup)] }), 400, "Other with no note");

    // (5) Deliver; no double delivery of a bin while it's out.
    const d1 = await c.post(c.site(L.sup, "/bins"), null, { ...base, photoIds: [await photo(L.sup)] });
    t.status(d1, 201, "the supervisor records bin A delivered (client's bin)");
    const d1b = await d1.json().catch(() => ({}));
    t.ok(noMoney(JSON.stringify(d1b)) && !MONEYISH.test(JSON.stringify(d1b)), "no money in the delivery reply");
    const mA = await db.binMovement.findFirst({ where: { binId: binA, status: "ON_SITE" }, include: { photos: true } });
    t.ok(mA && mA.use === "CLIENT" && mA.onSiteKey === binA && mA.photos.length === 1 && mA.photos[0].stage === "DELIVERED" && mA.deliveredByResourceId === S.id, "saved on site with its photo, who and which bin");
    t.status(await c.post(c.site(L.drv, "/bins"), null, { ...base, photoIds: [await photo(L.drv)] }), 409, "bin A again while it's on site");
    t.ok((await db.binMovement.count({ where: { binId: binA, status: "ON_SITE" } })) === 1, "still one entry on site for bin A");
    // Two phones at once with bin B: exactly one wins.
    const [pa, pb] = [await photo(L.sup), await photo(L.drv)];
    const race = await Promise.all([
      c.post(c.site(L.sup, "/bins"), null, { ...base, binId: binB, photoIds: [pa] }),
      c.post(c.site(L.drv, "/bins"), null, { ...base, binId: binB, use: "OURS", photoIds: [pb] }),
    ]);
    t.ok(race.map((r) => r.status).sort().join(",") === "201,409", "two phones delivering bin B at once: one 201, one 409", race.map((r) => r.status).join(","));
    t.ok((await db.binMovement.count({ where: { binId: binB, status: "ON_SITE" } })) === 1, "bin B is on site once");
    // The only free 9 is picked automatically; a second 9 goes in size-only with a warning (never blocked).
    t.status(await c.post(c.site(L.drv, "/bins"), null, { ...base, size: "M9", binId: undefined, use: "OURS", contents: "OTHER", contentsNote: "timber", photoIds: [await photo(L.drv)] }), 201, "a 9 m³ delivered (the only free one)");
    t.ok(!!(await db.binMovement.findFirst({ where: { binId: bin9, status: "ON_SITE" } })), "it was bin 9");
    const over = await c.post(c.site(L.drv, "/bins"), null, { ...base, size: "M9", binId: undefined, use: "OURS", photoIds: [await photo(L.drv)] });
    t.status(over, 201, "a second 9 m³ (none free) still goes in - never a block");
    t.ok(!!(await over.json().catch(() => ({}))).warning, "...with a warning for the office to check the register");
    const office1 = (await c.json("/api/bins", "MANAGER")).body;
    t.ok(office1?.warnings?.some((w) => w.size === "M9" && w.out === 2 && w.owned === 1), "the Bins page warns: 2 x 9 m³ out, 1 in the register", JSON.stringify(office1?.warnings));

    // Link replies: the bins on site, words only.
    const ls = await linkJson(L.drv);
    t.ok(ls.status === 200 && ls.text.includes(`RC 15 A ${tag}`), "the driver's link lists the bins on site");
    for (const link of [L.sup, L.drv]) { const r = await linkJson(link); t.ok(noMoney(r.text) && !MONEYISH.test(r.text), "no money in a link's bins reply", r.text.slice(0, 120)); }

    // (6) Pick-up: a photo required; no double pick-up (also two at once).
    t.status(await c.post(c.site(L.drv, "/bins"), null, { action: "pickup", movementId: mA.id, photoIds: [] }), 400, "a pick-up with no photo");
    const p1 = await c.post(c.site(L.drv, "/bins"), null, { action: "pickup", movementId: mA.id, photoIds: [await photo(L.drv)] });
    t.status(p1, 201, "the driver picks bin A up");
    t.ok(noMoney(await p1.text().catch(() => "")), "no money in the pick-up reply");
    t.status(await c.post(c.site(L.sup, "/bins"), null, { action: "pickup", movementId: mA.id, photoIds: [await photo(L.sup)] }), 409, "bin A picked up again");
    const mB = await db.binMovement.findFirst({ where: { binId: binB, status: "ON_SITE" } });
    const [qa, qb] = [await photo(L.sup), await photo(L.drv)];
    const race2 = await Promise.all([
      c.post(c.site(L.sup, "/bins"), null, { action: "pickup", movementId: mB.id, photoIds: [qa] }),
      c.post(c.site(L.drv, "/bins"), null, { action: "pickup", movementId: mB.id, photoIds: [qb] }),
    ]);
    t.ok(race2.map((r) => r.status).sort().join(",") === "201,409", "two phones picking up bin B at once: one 201, one 409", race2.map((r) => r.status).join(","));
    const mA2 = await db.binMovement.findUnique({ where: { id: mA.id }, include: { photos: true } });
    t.ok(mA2.status === "PICKED_UP" && mA2.onSiteKey === null && mA2.pickedUpByResourceId === D.id && mA2.photos.some((p) => p.stage === "PICKED_UP") && mA2.use === "CLIENT", "picked up by the driver, its photo kept, the delivery details carried over");
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base, photoIds: [await photo(L.sup)] }), 201, "bin A can go out again once it's back");

    // (7) The tip docket: suggested, confirmed by a Manager+ only, its own figures never changed, no price on the page.
    const tipR = await db.receipt.create({ data: {
      kind: "TIP", siteLinkId: L.drv.id, sentBy: D.name, sentByResourceId: D.id, sentAt: new Date(Date.now() + 3_600_000), jobId: J.id, projectId: P.id,
      asbestos: false, status: "READ", docketNo: `RC-${tag}`, tipSite: "RC Tip", wasteType: "Mixed C&D", tonnes: 3.3, priceExGst: 412.5 } });
    const office2 = await c.text("/api/bins", "MANAGER");
    const hist = JSON.parse(office2.text || "{}").history?.find?.((r) => r.id === mA.id);
    t.ok(hist?.suggestions?.some((s) => s.receiptId === tipR.id && s.sameDriver), "the picked-up bin suggests the driver's tip docket (same job, same driver)", JSON.stringify(hist?.suggestions ?? null).slice(0, 160));
    t.ok(!hist?.tip, "...not matched until a person confirms");
    for (const [who, r] of [["MANAGER", office2], ["COORDINATOR", await c.text("/api/bins", "COORDINATOR")], ["MANAGER (card)", await c.text("/api/bins?summary=1", "MANAGER")]]) {
      t.ok(r.status === 200 && noMoney(r.text) && !MONEYISH.test(r.text), `no money in the Bins data (${who})`, (r.text.match(MONEYISH) ?? [""])[0]);
    }
    for (const who of NO_WRITE) t.status(await c.patch(`/api/bins/${mA.id}`, who, { action: "tip-confirm", receiptId: tipR.id }), [401, 403], `${label(who)} confirming a tip docket`);
    t.status(await c.patch(`/api/bins/${mA.id}`, "MANAGER", { action: "tip-confirm", receiptId: tipR.id }), 200, "a Manager confirms the tip docket");
    const mA3 = await db.binMovement.findUnique({ where: { id: mA.id } });
    t.ok(mA3.tipReceiptId === tipR.id, "the bin has its tip docket");
    const tipAfter = await db.receipt.findUnique({ where: { id: tipR.id } });
    t.ok(tipAfter.priceExGst === 412.5 && tipAfter.tonnes === 3.3 && tipAfter.status === "READ" && tipAfter.invoicedCostId === tipR.invoicedCostId, "the docket's own figures and status are unchanged (tip costs untouched)");
    const otherPicked = await db.binMovement.findFirst({ where: { binId: binB, status: "PICKED_UP" } });
    t.status(await c.patch(`/api/bins/${otherPicked.id}`, "MANAGER", { action: "tip-confirm", receiptId: tipR.id }), 409, "the same docket on a second bin");
    // BN-003: the job of an entry with a matched docket can't change - take the docket off first.
    t.status(await c.patch(`/api/bins/${mA.id}`, "MANAGER", { action: "correct", projectId: Q.id, reason: "RC wrong job" }), 409, "correcting the job of an entry with a matched tip docket (BN-003)");
    t.ok((await db.binMovement.findUnique({ where: { id: mA.id } })).projectId === P.id, "...the job is unchanged");
    t.status(await c.patch(`/api/bins/${mA.id}`, "ADMIN", { action: "tip-reject", receiptId: tipR.id }), 200, "an Admin says it's not this bin's after all");
    t.ok((await db.binMovement.findUnique({ where: { id: mA.id } })).tipReceiptId === null, "...the match is taken off");
    t.ok((await db.recordChange.count({ where: { model: "BinMovement", recordId: mA.id, field: "tipReceiptId" } })) === 2, "both tip decisions are in the history");

    // (8) Corrections: Manager+ with a reason, kept in the history; the coordinator is refused.
    const onSite = await db.binMovement.findFirst({ where: { binId: binA, status: "ON_SITE" } });
    for (const who of NO_WRITE) t.status(await c.patch(`/api/bins/${onSite.id}`, who, { action: "correct", use: "OURS", reason: "RC refused" }), [401, 403], `${label(who)} correcting an entry`);
    t.status(await c.patch(`/api/bins/${onSite.id}`, "MANAGER", { action: "correct", use: "OURS" }), 400, "a correction with no reason");
    t.status(await c.patch(`/api/bins/${onSite.id}`, "MANAGER", { action: "correct", use: "OURS", reason: "RC was our bin" }), 200, "a Manager corrects client's -> ours");
    const rcUse = await db.recordChange.findFirst({ where: { model: "BinMovement", recordId: onSite.id, field: "use" } });
    t.ok(rcUse?.before === "CLIENT" && rcUse?.after === "OURS" && rcUse?.reason === "RC was our bin" && rcUse?.changedById === c.users.MANAGER.id, "the correction is logged (before, after, reason, who)");
    t.status(await c.post(c.site(L.sup, "/bins"), null, { ...base, binId: binB, photoIds: [await photo(L.sup)] }), 201, "bin B goes out again");
    t.status(await c.patch(`/api/bins/${onSite.id}`, "MANAGER", { action: "correct", binId: binB, reason: "RC wrong bin" }), 409, "moving an entry onto a bin that's on site on another entry");
    t.status(await c.patch(`/api/bins/${onSite.id}`, "MANAGER", { action: "correct", binId: bin9, reason: "RC wrong bin" }), 400, "moving a 15 m³ entry onto a 9 m³ bin");
    t.status(await c.patch(`/api/bins/${onSite.id}`, "MANAGER", { action: "cancel" }), 400, "a cancel with no reason");
    t.status(await c.patch(`/api/bins/${onSite.id}`, "MANAGER", { action: "cancel", reason: "RC entered twice" }), 200, "a Manager cancels a wrong entry");
    const cx = await db.binMovement.findUnique({ where: { id: onSite.id } });
    t.ok(cx?.status === "CANCELLED" && cx.onSiteKey === null && cx.cancelReason === "RC entered twice", "it's kept, marked cancelled, with the reason");
    t.ok(!!(await db.recordChange.findFirst({ where: { model: "BinMovement", recordId: onSite.id, field: "status", after: "CANCELLED" } })), "the cancel is in its history");
    t.status(await c.patch(`/api/bins/${onSite.id}`, "MANAGER", { action: "correct", use: "CLIENT", reason: "RC again" }), 409, "a cancelled entry can't be changed");
    t.status(await c.patch(`/api/bins/${mA.id}`, "MANAGER", { action: "unpick", reason: "RC wrong bin picked up" }), 200, "a Manager puts a wrong pick-up back on site");
    t.ok((await db.binMovement.findUnique({ where: { id: mA.id } })).status === "ON_SITE", "...it's on site again");

    // (9) Register changes: Manager+, a reason to retire, never while on site; kept in the history.
    for (const who of NO_WRITE) t.status(await c.patch(`/api/bins/register/${bin9}`, who, { action: "rename", label: `RC 9 x ${tag}` }), [401, 403], `${label(who)} renaming a bin`);
    t.status(await c.patch(`/api/bins/register/${bin9}`, "MANAGER", { action: "retire", reason: "RC sold" }), 409, "retiring a bin that's on site");
    // BN-003: never onto an archived project.
    const R = await db.project.create({ data: { name: `RC Bins archived ${tag}`, status: "COMPLETED", archived: true } });
    const live9 = await db.binMovement.findFirst({ where: { binId: bin9, status: "ON_SITE" } });
    t.status(await c.patch(`/api/bins/${live9.id}`, "MANAGER", { action: "correct", projectId: R.id, reason: "RC archived job" }), 400, "correcting an entry onto an archived project (BN-003)");
    t.ok((await db.binMovement.findUnique({ where: { id: live9.id } })).projectId === P.id, "...the job is unchanged");
    // BN-004: a picked-up entry whose bin was then retired can't be put back on site.
    t.status(await c.post(c.site(L.drv, "/bins"), null, { action: "pickup", movementId: live9.id, photoIds: [await photo(L.drv)] }), 201, "the 9 m³ is picked up");
    t.status(await c.patch(`/api/bins/register/${bin9}`, "MANAGER", { action: "retire", reason: "RC cracked" }), 200, "and the 9 m³ bin is retired");
    t.status(await c.patch(`/api/bins/${live9.id}`, "MANAGER", { action: "unpick", reason: "RC wrong bin" }), 409, "putting back on site an entry whose bin is retired (BN-004)");
    t.ok((await db.binMovement.findUnique({ where: { id: live9.id } })).status === "PICKED_UP", "...it stays picked up");
    t.status(await c.patch(`/api/bins/register/${bin9}`, "MANAGER", { action: "restore" }), 200, "the 9 m³ is brought back");
    const hook = def.body.id;
    t.status(await c.patch(`/api/bins/register/${hook}`, "MANAGER", { action: "retire" }), 400, "retiring with no reason");
    t.status(await c.patch(`/api/bins/register/${hook}`, "MANAGER", { action: "rename", label: `RC Hook ${tag}` }), 200, "a Manager renames the hook bin");
    t.status(await c.patch(`/api/bins/register/${hook}`, "ADMIN", { action: "retire", reason: "RC damaged" }), 200, "an Admin retires it (it's in the yard)");
    t.ok(!!(await db.bin.findUnique({ where: { id: hook } }))?.retiredAt, "it's retired, not deleted");
    t.ok((await db.recordChange.count({ where: { model: "Bin", recordId: hook } })) >= 4, "rename and retire are in its history");
    t.status(await c.patch(`/api/bins/register/${hook}`, "MANAGER", { action: "restore" }), 200, "and brought back");

    // (9b) Client's bins are charged per bin (Ilies, 23 Nov 2026): the by-job view counts bins delivered (on site now /
    // picked up), in the date range, and carries no days figure; the Bins out card has no days either.
    const clientWant = await db.binMovement.count({ where: { projectId: P.id, use: "CLIENT", status: { not: "CANCELLED" } } });
    const cj = (await c.json(`/api/bins?from=${c.today}&to=${c.today}`, "COORDINATOR")).body;
    const row = cj?.clientByJob?.find?.((x) => x.projectId === P.id);
    t.ok(row && row.delivered === clientWant && row.onSite + row.pickedUp === row.delivered, "client's bins by job: the count of client's bins delivered today, split on site / picked up", JSON.stringify(row ?? null));
    t.ok(clientWant >= 2, "there were client's bins to count", `${clientWant}`);
    t.ok(!(await c.json("/api/bins?from=2001-01-01&to=2001-01-02", "MANAGER")).body?.clientByJob?.some?.((x) => x.projectId === P.id), "a date range with no deliveries counts none for the job");
    t.ok(!/binDays|bin-days/i.test(JSON.stringify(cj?.clientByJob ?? [])) && !Object.keys(row ?? {}).some((k) => /day/i.test(k)), "no days figure in the client's bins by job view");
    const card = (await c.json("/api/bins?summary=1", "MANAGER")).body;
    t.ok(card && !("longest" in card) && !(card.jobs ?? []).some((j) => "days" in j), "the Bins out card counts bins - no days figure");
    // The alert to Alex: client's bins only, words only, kill switch BIN_ALERTS (unit tests prove the payload); the test
    // server has no push keys, so nothing leaves it (the no-outbound guard below).
    const storeSrc = readFileSync(path.join(c.p.appDir, "src", "lib", "bins", "store.ts"), "utf8");
    t.ok(/if \(input\.use === "CLIENT"\) void alertClientBin\(/.test(storeSrc) && /binAlertsOn\(\)/.test(storeSrc) && /role: "COORDINATOR", active: true/.test(storeSrc) && /pushToUsers\(/.test(storeSrc), "a client's bin delivery alerts the active coordinator login(s) only, behind BIN_ALERTS");

    // (10) Nothing is deleted: no DELETE handler, no delete in the source, the counts never went down.
    for (const pth of [`/api/bins/${mA.id}`, `/api/bins/register/${binA}`, "/api/bins", c.site(L.sup, "/bins")]) t.status(await c.del(pth, "ADMIN"), [404, 405], `DELETE ${pth.replace(L.sup.secret, "<link>")}`);
    const srcFiles = [...filesUnder(path.join(c.p.appDir, "src", "lib", "bins")), ...filesUnder(path.join(c.p.appDir, "src", "app", "api", "bins")), ...binRoutes];
    const deleting = srcFiles.filter((f) => /\b(binMovement|bin|binPhoto)\.(delete|deleteMany)\(/.test(readFileSync(f, "utf8")));
    t.ok(srcFiles.length > 0 && deleting.length === 0, "no bin code deletes a row", deleting.map((f) => path.relative(c.p.appDir, f)).join(","));
    const after = await counts();
    t.ok(after.bins >= before.bins + 4 && after.moves >= before.moves && after.photos >= before.photos, "bins, entries and photos only ever grew", JSON.stringify({ before, after }));
    t.ok((await db.binMovement.count({ where: { projectId: P.id } })) >= 5, "every entry for the test job is still there (cancelled one included)");

    // (11) Nothing was called outside during this check.
    const net1 = netLines(c);
    t.ok(net1 === net0, "no outbound connection attempted during this check", `${net1 - net0} new blocked attempt(s)`);
  },
};
