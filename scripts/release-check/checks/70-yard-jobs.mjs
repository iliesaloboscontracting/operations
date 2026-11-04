// Yard jobs (Stage A, Ilies, 4 Nov 2026): a supervisor sends tools / materials / deliveries straight to the yard from
// their link ("Send to: Yard / Office"); an Admin can send any open site request to the yard, pull one back or
// decline it; the yard's shared phone link (OFFICE, no person) and /yard list the jobs, the yard marks one "Ready for
// collection" with a photo (required) and an optional "missing" note, and the supervisor (or the yard, or an Admin)
// marks it collected. Managers view /api/yard but never act; VIEWER / TIMESHEETS / ACCOUNTS / DIRECTOR / COORDINATOR
// and no login are refused. No dollar figure in any yard or link reply - a note with one becomes a pointer.
// WRITES synthetic site requests (with tiny photos) and a synthetic shared OFFICE ("Yard") link to the copy.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default {
  id: "yard-jobs", title: "Yard jobs: straight to the yard, Admin send / pull back, ready with a photo, collected, no dollar figures",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/yard/rules.ts") || "needs the yard jobs feature (lib/yard/rules.ts)",
  async run(t, c) {
    const L = c.links;
    if (!L.sup || !L.office) return t.block(L.missing.join("; "));
    const project = await c.db.project.findFirst({ where: { status: "ACTIVE" }, select: { id: true, name: true } });
    if (!project) return t.block("no active project on the copy - a request needs a site");
    const yard = await makeLink(c.db, "OFFICE", null, { label: "Yard" }); // the yard's shared phone link - synthetic, copy only
    const seen = []; // every link / yard reply - scanned for "$" + digit at the end
    const read = async (pth, who = null) => { const r = await c.get(pth, who); const text = await r.text().catch(() => ""); seen.push([pth, text]); let body = null; try { body = JSON.parse(text); } catch { /* */ } return { status: r.status, body }; };
    const send = async (method, pth, who, body) => { const r = await c.req(method, pth, who, body); const text = await r.text().catch(() => ""); seen.push([`${method} ${pth}`, text]); let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, body: j }; };
    const status = async (id) => (await c.db.siteRequest.findUnique({ where: { id }, select: { status: true } }))?.status;
    const neededBy = new Date(Date.now() + 26 * 3600_000).toISOString();
    const tag = `RC yard ${Date.now().toString(36)}`;
    // The supervisor's own replies show their own words exactly as before (lib/siteRequests.ts) - so they are not in
    // `seen`; their yard parts are checked for money on their own below.
    const own = async (method, pth, body) => { const r = await c.req(method, pth, null, body); return { status: r.status, body: await r.json().catch(() => null) }; };
    const ask = (kind, details, extra = {}) => own("POST", c.site(L.sup, "/requests"), { kind, priority: "HIGH", neededBy, projectId: project.id, details, ...extra });

    // (1) The supervisor's link: Yard for tools / materials / deliveries only, and only when asked.
    const j1 = await ask("TOOLS", { item: `${tag} grinder`, qty: "2" }, { sendTo: "YARD", note: "the ones at Bunnings are about $150", photo: PNG });
    t.ok(j1.status === 201 && j1.body?.request?.status === "YARD", "a TOOLS request sent to the yard goes straight on the yard's list (status YARD)", `${j1.status} ${j1.body?.request?.status}`);
    const id1 = j1.body?.request?.id;
    if (!id1) return;
    const j2 = await ask("MATERIALS", { item: `${tag} rubble bags`, qty: "2 boxes" }, { sendTo: "OFFICE" });
    t.ok(j2.status === 201 && j2.body?.request?.status === "SENT", "MATERIALS sent to the office: a normal request (SENT)", `${j2.status} ${j2.body?.request?.status}`);
    const id2 = j2.body?.request?.id;
    const j3 = await ask("LABOUR", { count: "2" }, { sendTo: "YARD" });
    t.ok(j3.status === 201 && j3.body?.request?.status === "SENT", "LABOUR can't be sent to the yard - sendTo ignored", `${j3.status} ${j3.body?.request?.status}`);
    const j4 = await ask("DELIVERY", { item: `${tag} jackhammer` });
    t.ok(j4.status === 201 && j4.body?.request?.status === "SENT", "no choice sent (an older phone): the office, as before", `${j4.status} ${j4.body?.request?.status}`);
    const ev1 = await c.db.siteRequestEvent.findMany({ where: { requestId: id1 }, select: { action: true } });
    t.ok(ev1.some((e) => e.action === "SENT") && ev1.some((e) => e.action === "SENT_TO_YARD"), "history: SENT then SENT_TO_YARD");

    // (2) The yard's list - on the shared yard link only.
    const list = await read(c.site(yard, "/yard"));
    const row = list.body?.jobs?.find((j) => j.id === id1);
    t.ok(list.status === 200 && !!row && list.body?.canAct === true, "the yard link lists it", list.status);
    t.ok(!list.body?.jobs?.some((j) => j.id === id2), "a request with the office isn't on the yard's list");
    t.ok(row?.note === "Details are with the office", "the supervisor's note with a $ figure becomes a pointer on the yard's list", row?.note);
    for (const [name, link] of [["supervisor", L.sup], ["personal OFFICE", L.office]]) {
      t.status(await c.get(c.site(link, "/yard"), null), 404, `a ${name} link has no yard list`);
      t.status(await c.patch(c.site(link, `/yard/${id1}`), null, { action: "ON_IT", who: "RC" }), 404, `a ${name} link can't act on the yard's list`);
    }
    t.status(await c.get(c.site(yard, `/yard/${id1}/photo?which=request`), null), 200, "the yard link sees the supervisor's photo");
    t.status(await c.get(c.site(L.office, `/requests/${id1}/photo`), null), 404, "a personal OFFICE link can't open it");

    // (3) Ready for collection: name and photo required, YARD only.
    t.status(await send("PATCH", c.site(yard, `/yard/${id1}`), null, { action: "COLLECTED", who: "RC Sam" }), 409, "collected before it's ready -> refused");
    t.status(await send("PATCH", c.site(yard, `/yard/${id1}`), null, { action: "READY", photo: PNG }), 400, "no name typed on the shared phone -> refused");
    t.status(await send("PATCH", c.site(yard, `/yard/${id1}`), null, { action: "READY", who: "RC Sam" }), 400, "ready with no photo -> refused");
    t.status(await send("PATCH", c.site(yard, `/yard/${id1}`), null, { action: "ON_IT", who: "RC Sam" }), 200, "On it");
    t.ok((await status(id1)) === "YARD", "On it keeps it with the yard");
    const rd = await send("PATCH", c.site(yard, `/yard/${id1}`), null, { action: "READY", who: "RC Sam", photo: PNG, note: "only 1 here - buy another, about $159" });
    t.ok(rd.status === 200 && rd.body?.job?.status === "READY" && rd.body?.job?.hasReadyPhoto && rd.body?.job?.readyBy === "Yard - RC Sam", "Ready for collection with a photo, stored 'Yard - <name>'", `${rd.status} ${JSON.stringify(rd.body?.job ?? rd.body)}`);
    t.ok(rd.body?.job?.readyNote === "Details are with the office", "the missing note with a $ figure becomes a pointer on the link");
    t.ok((await c.db.siteRequest.findUnique({ where: { id: id1 }, select: { readyNote: true } }))?.readyNote?.includes("buy another"), "the office keeps the yard's words");
    t.status(await send("PATCH", c.site(yard, `/yard/${id1}`), null, { action: "READY", who: "RC Sam", photo: PNG }), 409, "ready twice -> refused");
    t.status(await c.get(c.site(yard, `/yard/${id1}/photo?which=ready`), null), 200, "the yard link sees the ready photo");

    // (4) Who sees the ready photo: the requester's link, Managers+ in-app; never another link.
    t.status(await c.get(c.site(L.sup, `/requests/${id1}/photo?which=ready`), null), 200, "the supervisor's own link sees the ready photo");
    t.status(await c.get(c.site(L.office, `/requests/${id1}/photo?which=ready`), null), 404, "a personal OFFICE link can't");
    t.status(await c.get(`/api/requests/${id1}/photo?which=ready`, "MANAGER"), 200, "a Manager sees it on Requests");
    t.status(await c.get(`/api/yard/${id1}/photo?which=ready`, "MANAGER"), 200, "a Manager sees it on /yard");
    for (const [who, want] of [["VIEWER", 403], ["TIMESHEETS", 403], ["ACCOUNTS", 403], ["DIRECTOR", 403], ["COORDINATOR", 403], [null, 401]])
      t.status(await c.get(`/api/yard/${id1}/photo?which=ready`, who), want, `the /yard photo as ${who ?? "no login"}`);

    // (5) The supervisor's link: ready, the yard's photo and note, then Collected.
    const mine = (await own("GET", c.site(L.sup, "/requests"))).body?.requests?.find((r) => r.id === id1);
    t.ok(mine?.status === "READY" && mine?.yard?.hasReadyPhoto && mine?.yard?.readyNote === "Details are with the office", "the supervisor sees 'Ready for collection', the photo and the note (money swapped)", JSON.stringify(mine?.yard));
    t.ok(noMoney(JSON.stringify(mine?.yard ?? {})), "no dollar figure in what the yard sent back to the supervisor");
    const info = (await read(c.site(L.sup))).body;
    t.ok((info?.readyToCollect ?? 0) >= 1, "the supervisor's home shows it ready to collect", info?.readyToCollect);
    const col = await own("PATCH", c.site(L.sup, `/requests/${id1}`), { action: "COLLECTED" });
    t.ok(col.status === 200 && col.body?.request?.status === "DONE" && col.body?.request?.yard?.collectedAt, "the supervisor marks it Collected -> DONE", `${col.status} ${col.body?.request?.status}`);
    t.ok((await c.db.siteRequest.findUnique({ where: { id: id1 }, select: { outcome: true, doneAt: true } }))?.outcome === "Collected", "outcome 'Collected', doneAt set");
    t.status(await own("PATCH", c.site(L.sup, `/requests/${id1}`), { action: "COLLECTED" }), 409, "collected twice -> refused");
    const after = (await read(c.site(yard, "/yard"))).body?.jobs?.find((j) => j.id === id1);
    t.ok(after?.status === "DONE" && after?.collectedBy, "it stays on the yard's list as collected (last 7 days)");

    // (6) Admins: send any open site request to the yard, pull back, decline; Managers can't.
    if (id2) {
      const count = async () => (await c.json("/api/requests?count=1", "ADMIN")).body?.decide ?? null;
      const before = await count();
      t.status(await c.patch(`/api/requests/${id2}`, "MANAGER", { action: "SEND_TO_YARD" }), 403, "a Manager can't send to the yard");
      const s1 = await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "SEND_TO_YARD", note: "take the boxes from the shelf" });
      t.ok(s1.status === 200 && (await status(id2)) === "YARD", "an Admin sends it to the yard", s1.status);
      const afterCount = await count();
      t.ok(before !== null && afterCount === before - 1, "a yard job isn't waiting on Ilies (the badge drops by one)", `${before} -> ${afterCount}`);
      t.ok((await read(c.site(yard, "/yard"))).body?.jobs?.some((j) => j.id === id2 && j.officeNote === "take the boxes from the shelf"), "it's on the yard's list with the Admin's note");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "SEND_TO_YARD" }), 400, "sending twice -> refused");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "APPROVE", assigneeId: L.office.resourceId }), 400, "approving while with the yard -> refused (pull back first)");
      t.status(await c.patch(`/api/requests/${id2}`, "MANAGER", { action: "PULL_BACK" }), 403, "a Manager can't pull back");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "PULL_BACK", note: "ordering it instead" }), 200, "an Admin pulls it back");
      t.ok((await status(id2)) === "SEEN", "pulled back -> SEEN (to decide)");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "PULL_BACK" }), 400, "pull back when it isn't with the yard -> refused");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "SEND_TO_YARD" }), 200, "sent again");
      t.status(await send("PATCH", c.site(yard, `/yard/${id2}`), null, { action: "CANT_DO", who: "RC Sam" }), 400, "can't do with no reason -> refused");
      t.status(await send("PATCH", c.site(yard, `/yard/${id2}`), null, { action: "CANT_DO", who: "RC Sam", reason: "none left in the yard" }), 200, "the yard: can't do, with a reason");
      t.ok((await status(id2)) === "CANT_DO", "can't do -> back to the Admins (CANT_DO)");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "SEND_TO_YARD" }), 200, "a can't-do one can go back to the yard");
      t.status(await c.patch(`/api/yard/${id2}`, "ADMIN", { action: "READY", photo: PNG }), 200, "an Admin marks it ready on /yard");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "DONE", outcome: "x" }), 400, "DONE while with the yard -> refused (use Collected)");
      t.status(await c.patch(`/api/requests/${id2}`, "ADMIN", { action: "COLLECTED" }), 200, "an Admin marks it collected on Requests");
      t.ok((await status(id2)) === "DONE", "-> DONE");
      const office = (await c.json("/api/requests", "ADMIN")).body?.requests?.find((r) => r.id === id2);
      const acts = new Set((office?.events ?? []).map((e) => e.action));
      t.ok(["SENT_TO_YARD", "PULLED_BACK", "CANT_DO", "YARD_READY", "COLLECTED"].every((a) => acts.has(a)), "the Requests history has every yard step", [...acts].join(","));
      t.ok(office?.yardAt && office?.readyAt && office?.hasReadyPhoto === true, "the Requests page shows the yard's status, who / when and the photo");
    }
    // Declining a yard job; and office kinds never go to the yard.
    const j5 = await ask("DELIVERY", { item: `${tag} bulka bags` }, { sendTo: "YARD" });
    if (j5.body?.request?.id) {
      t.status(await c.patch(`/api/requests/${j5.body.request.id}`, "ADMIN", { action: "DECLINE", reason: "use the ones on site" }), 200, "an Admin declines a yard job");
      t.ok((await status(j5.body.request.id)) === "DECLINED", "-> DECLINED, off the yard's list");
    }
    const q = await c.db.siteRequest.create({ data: { number: 900000 + Math.floor(Math.random() * 99999), kind: "QUERY", priority: "LOW", neededBy: new Date(), siteLabel: "RC", summary: "RC query", details: "{}", requestedBy: "RC", origin: "DIRECTOR", audience: "OPERATIONAL" } });
    t.status(await c.patch(`/api/requests/${q.id}`, "ADMIN", { action: "SEND_TO_YARD" }), [400, 403], "a query (office kind) never goes to the yard");

    // (7) /api/yard: Managers view (can't act), Admins act; every other login refused.
    const mgr = await read("/api/yard", "MANAGER");
    t.ok(mgr.status === 200 && mgr.body?.canAct === false && Array.isArray(mgr.body?.jobs), "a Manager views /api/yard (canAct false)", mgr.status);
    t.ok((await c.json("/api/yard", "ADMIN")).body?.canAct === true, "an Admin may act");
    t.status(await c.patch(`/api/yard/${id1}`, "MANAGER", { action: "ON_IT" }), 403, "a Manager can't act on /api/yard");
    for (const [who, want] of [["VIEWER", 403], ["TIMESHEETS", 403], ["ACCOUNTS", 403], ["DIRECTOR", 403], ["COORDINATOR", 403], [null, 401]]) {
      t.status(await c.get("/api/yard", who), want, `/api/yard as ${who ?? "no login"}`);
      t.status(await c.patch(`/api/yard/${id1}`, who, { action: "ON_IT" }), want, `PATCH /api/yard as ${who ?? "no login"}`);
    }
    // TODO(lead, after merging yard-role): the YARD login - GET /api/yard -> 200 canAct true; PATCH /api/yard/:id READY
    // (photo required) and COLLECTED -> 200; /api/yard/:id/photo -> 200; /api/push GET -> 200; /api/requests (and
    // PATCH /api/requests/:id SEND_TO_YARD / PULL_BACK) -> 403; /yard page 200 and its home. Add "YARD" to
    // lib/setup.mjs TEST_ROLES and to the 403 loops above where it must be refused.

    // (8) Pages, phone alerts on the yard link, and no dollar figure anywhere a link or the yard reads.
    for (const [pg, who] of [["/yard", "MANAGER"], ["/yard", "ADMIN"], ["/requests", "ADMIN"]]) {
      const r = await c.text(pg, who);
      t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${pg} as ${who}`, r.status);
    }
    const yp = await c.text(c.sitePage(yard), null);
    t.ok(yp.status === 200 && !/Application error/.test(yp.text), "the yard link's page", yp.status);
    t.ok((await read(c.site(yard))).body?.yardJobs !== undefined, "the yard link's home counts its jobs");
    t.status(await c.get(c.site(yard, "/push"), null), 200, "the yard link can turn on phone alerts");
    t.status(await c.get(c.site(L.office, "/push"), null), 404, "a personal OFFICE link still can't");
    for (const pth of [c.site(yard, "/yard"), c.site(yard), c.site(L.sup), "/api/yard"]) await read(pth, pth === "/api/yard" ? "MANAGER" : null);
    const leaks = seen.filter(([, text]) => !noMoney(text)).map(([p]) => c.scrub(p));
    t.ok(leaks.length === 0, `no "$" + digit in any of the ${seen.length} yard / link replies`, leaks.join(", "));
  },
};
