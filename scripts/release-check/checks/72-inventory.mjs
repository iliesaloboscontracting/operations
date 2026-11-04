// Yard Stage C - the consumables inventory (Ilies, 4 Nov 2026: "Stage C: start on the consumables inventory"). Items
// with a unit, a minimum and a location; stock in / out / counts with who and when, never below zero; a yard job marked
// ready can take stock with it (OUT tied to the request, in the same step - a 409 on the move leaves the stock as it
// was); the below-minimum list, its one alert mark, and the purchase form it prefills (Managers / Admins / the
// coordinator only). Tools access: the yard, the coordinator and Managers write; Viewers look; TIMESHEETS / ACCOUNTS /
// DIRECTOR / no login are refused; never on a site link. Retired, never deleted. No dollar figure in any reply.
// WRITES synthetic inventory items and movements, three yard jobs and a synthetic shared Yard link to the copy.
import { noMoney } from "../lib/context.mjs";
import { makeLink } from "../lib/setup.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default {
  id: "inventory", title: "Consumables: items, in / out / count, never below zero, ready-with-stock, below minimum, prefill, roles, no $",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/inventory/rules.ts") || "needs the consumables inventory (lib/inventory/rules.ts)",
  async run(t, c) {
    const U = c.users, L = c.links;
    for (const k of ["YARD", "COORDINATOR", "MANAGER", "ADMIN", "VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) if (!U[k]) return t.block(`no ${k} test login (lib/setup.mjs TEST_ROLES)`);
    if (!L.sup) return t.block(L.missing.join("; "));
    const project = await c.db.project.findFirst({ where: { status: "ACTIVE" }, select: { id: true, name: true } });
    if (!project) return t.block("no active project on the copy - a yard job needs a site");
    const seen = []; // every reply - scanned for "$" + digit at the end
    const send = async (method, pth, who, body) => {
      const r = await c.req(method, pth, who, body); const text = await r.text().catch(() => "");
      seen.push([`${who ?? "no login"} ${method} ${pth}`, text]);
      let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, body: j };
    };
    const get = (pth, who) => send("GET", pth, who);
    const tag = `RC ${Date.now().toString(36)}`;
    const onHand = async (id) => (await c.db.inventoryItem.findUnique({ where: { id }, select: { onHand: true } }))?.onHand;
    const move = (id, who, body) => send("POST", `/api/inventory/${id}/movements`, who, body);

    // (1) Add items - the yard, the coordinator and a Manager may; a dollar figure or a duplicate name is refused.
    const a = await send("POST", "/api/inventory", "YARD", { name: `${tag} P2 masks`, category: "PPE", unit: "box", minLevel: 5, location: "RC shelf B2", openingQty: 3 });
    t.ok(a.status === 201 && a.body?.item?.onHand === 3 && a.body?.item?.status === "BELOW", "the yard adds an item with a first count (3 box, minimum 5 -> Below minimum)", `${a.status} ${JSON.stringify(a.body)}`);
    const A = a.body?.item?.id;
    if (!A) return;
    t.status(await send("POST", "/api/inventory", "COORDINATOR", { name: `${tag} Rubble bags`, category: "CONSUMABLES", unit: "bag" }), 201, "the coordinator adds an item (no minimum - not set)");
    const b = await send("POST", "/api/inventory", "MANAGER", { name: `${tag} Duct tape`, category: "CONSUMABLES", unit: "roll", minLevel: 2, openingQty: 10 });
    t.status(b, 201, "a Manager adds an item");
    const B = b.body?.item?.id;
    t.status(await send("POST", "/api/inventory", "MANAGER", { name: `${tag} p2 MASKS`, unit: "box" }), 400, "the same name again (any case) -> 400");
    t.status(await send("POST", "/api/inventory", "MANAGER", { name: `${tag} Gloves $4 a pair`, unit: "pair" }), 400, "a dollar figure in the name -> 400");
    t.status(await send("POST", "/api/inventory", "VIEWER", { name: `${tag} Viewer item`, unit: "each" }), 403, "a Viewer can't add");
    const firstCount = await c.db.stockMovement.findFirst({ where: { itemId: A }, select: { kind: true, balanceAfter: true, reason: true } });
    t.ok(firstCount?.kind === "COUNT" && firstCount.balanceAfter === 3 && firstCount.reason === "First count", "the first count is a COUNT movement");
    t.ok((await c.db.inventoryItem.findUnique({ where: { id: A }, select: { belowMinAlertedAt: true } }))?.belowMinAlertedAt, "below minimum from the start -> the alert mark is set (once)");

    // (2) In / out / count, with balances, who and when; never below zero.
    const i1 = await move(A, "YARD", { kind: "IN", qty: 4, reason: "delivery" });
    t.ok(i1.status === 201 && i1.body?.item?.onHand === 7 && i1.body?.item?.status === "OK", "stock in 4 -> 7 (back above the minimum)", `${i1.status} ${i1.body?.item?.onHand}`);
    t.ok(!(await c.db.inventoryItem.findUnique({ where: { id: A }, select: { belowMinAlertedAt: true } }))?.belowMinAlertedAt, "back at or above the minimum -> the alert mark is cleared");
    const o1 = await move(A, "COORDINATOR", { kind: "OUT", qty: 3, projectId: project.id, reason: "for the crew" });
    t.ok(o1.status === 201 && o1.body?.item?.onHand === 4 && o1.body?.item?.status === "BELOW", "stock out 3 to a site -> 4 (below again)", `${o1.status} ${o1.body?.item?.onHand}`);
    const mark1 = (await c.db.inventoryItem.findUnique({ where: { id: A }, select: { belowMinAlertedAt: true } }))?.belowMinAlertedAt;
    t.ok(!!mark1, "dropped below again -> alerted again (mark set)");
    t.status(await move(A, "MANAGER", { kind: "OUT", qty: 1 }), 201, "another stock out while already below");
    t.ok(+(await c.db.inventoryItem.findUnique({ where: { id: A }, select: { belowMinAlertedAt: true } }))?.belowMinAlertedAt === +mark1, "still below -> no second alert (the mark is unchanged)");
    const big = await move(A, "MANAGER", { kind: "OUT", qty: 100 });
    t.ok(big.status === 400 && /Count it first - the shelf says 3 box/.test(big.body?.error ?? ""), "taking more than the shelf has -> 400 'Count it first - the shelf says 3 box'", `${big.status} ${big.body?.error}`);
    t.ok((await onHand(A)) === 3, "the shelf is unchanged");
    const cnt = await move(A, "MANAGER", { kind: "COUNT", countedQty: 6, reason: "monthly count" });
    t.ok(cnt.status === 201 && cnt.body?.item?.onHand === 6, "a count of 6 sets it to 6", `${cnt.status} ${cnt.body?.item?.onHand}`);
    t.status(await move(A, "MANAGER", { kind: "IN", qty: 1, reason: "paid $40" }), 400, "a dollar figure in the note -> 400");
    t.status(await move(A, "MANAGER", { kind: "IN", qty: -2 }), 400, "a negative quantity -> 400");
    const h = await get(`/api/inventory/${A}`, "VIEWER");
    const moves = h.body?.movements ?? [];
    t.ok(h.status === 200 && JSON.stringify(moves.map((m) => [m.kind, m.change, m.balanceAfter]).reverse()) === JSON.stringify([["COUNT", 3, 3], ["IN", 4, 7], ["OUT", -3, 4], ["OUT", -1, 3], ["COUNT", 3, 6]]),
      "the history: first count 3, +4 = 7, -3 = 4, -1 = 3, counted 6 (+3)", JSON.stringify(moves.map((m) => [m.kind, m.change, m.balanceAfter])));
    t.ok(moves.every((m) => m.by && m.at) && moves.some((m) => m.kind === "OUT" && m.siteLabel === project.name), "every step has who and when; the stock out names its site");

    // (3) Roles: Viewers read only; TIMESHEETS / ACCOUNTS / DIRECTOR / no login refused everywhere.
    const v = await get("/api/inventory", "VIEWER");
    t.ok(v.status === 200 && v.body?.canWrite === false && v.body?.canRequestPurchase === false, "a Viewer reads the list (no writes, no purchase button)", v.status);
    t.status(await move(A, "VIEWER", { kind: "IN", qty: 1 }), 403, "a Viewer can't move stock");
    t.status(await send("PATCH", `/api/inventory/${A}`, "VIEWER", { location: "x" }), 403, "a Viewer can't edit");
    for (const [who, want] of [["TIMESHEETS", 403], ["ACCOUNTS", 403], ["DIRECTOR", 403], [null, 401]]) {
      t.status(await get("/api/inventory", who), want, `the list as ${who ?? "no login"}`);
      t.status(await get(`/api/inventory/${A}`, who), want, `an item's history as ${who ?? "no login"}`);
      t.status(await send("POST", "/api/inventory", who, { name: `${tag} x`, unit: "each" }), want, `adding as ${who ?? "no login"}`);
      t.status(await move(A, who, { kind: "IN", qty: 1 }), want, `stock in as ${who ?? "no login"}`);
      t.status(await get(`/api/inventory/${A}/purchase-prefill`, who), want, `the purchase prefill as ${who ?? "no login"}`);
    }
    for (const who of ["YARD", "COORDINATOR", "MANAGER", "ADMIN"]) {
      const r = await get("/api/inventory", who);
      t.ok(r.status === 200 && r.body?.canWrite === true, `${who} reads and may write`, r.status);
    }
    t.ok((await get("/api/inventory", "YARD")).body?.canRequestPurchase === false, "the yard computer sees no purchase button (not its scope)");
    t.ok((await get("/api/inventory", "COORDINATOR")).body?.canRequestPurchase === true, "the coordinator does");

    // (4) Below minimum: the list, the counter, and the purchase form it prefills.
    const list = await get("/api/inventory", "MANAGER");
    const rowB = list.body?.items?.find((i) => i.id === B);
    t.ok(rowB?.status === "OK", "Duct tape (10 roll, minimum 2) is OK");
    t.status(await move(B, "YARD", { kind: "OUT", qty: 9 }), 201, "stock out 9 tape -> 1 roll");
    const after = await get("/api/inventory", "MANAGER");
    t.ok(after.body?.items?.find((i) => i.id === B)?.status === "BELOW" && after.body?.belowMin >= 1, "Duct tape is now on the below-minimum list", JSON.stringify(after.body?.items?.find((i) => i.id === B)));
    const cntOnly = await get("/api/inventory?count=1", "YARD");
    t.ok(cntOnly.status === 200 && cntOnly.body?.belowMin === after.body?.belowMin, "the /yard counter agrees", JSON.stringify(cntOnly.body));
    const pf = await get(`/api/inventory/${B}/purchase-prefill`, "MANAGER");
    t.ok(pf.status === 200 && pf.body?.prefill?.kind === "PURCHASE" && pf.body?.prefill?.what === `${tag} Duct tape` && pf.body?.prefill?.qty === "3 roll" && pf.body?.prefill?.why === `Stock below minimum - ${tag} Duct tape`,
      "the purchase prefill: PURCHASE, the item, 3 roll (back to twice the minimum), 'Stock below minimum - ...'", JSON.stringify(pf.body));
    t.status(await get(`/api/inventory/${B}/purchase-prefill`, "COORDINATOR"), 200, "the coordinator gets it too");
    t.status(await get(`/api/inventory/${B}/purchase-prefill`, "YARD"), 403, "the yard computer doesn't (it can't raise purchases)");
    t.status(await get(`/api/inventory/${B}/purchase-prefill`, "VIEWER"), 403, "nor a Viewer");
    const noMin = list.body?.items?.find((i) => i.name === `${tag} Rubble bags`);
    if (noMin) t.status(await get(`/api/inventory/${noMin.id}/purchase-prefill`, "MANAGER"), 400, "an item with no minimum has nothing to suggest -> 400");
    t.ok((await c.text("/purchases?stockItem=" + B, "MANAGER")).status === 200, "the purchases page opens with ?stockItem");
    t.ok((await c.db.purchaseRequest.count({ where: { what: `${tag} Duct tape` } })) === 0, "nothing was raised by itself - the person sends the form");

    // (5) A yard job marked ready takes stock with it - in the same step; a 409 or a short shelf changes nothing.
    const neededBy = new Date(Date.now() + 26 * 3600_000).toISOString();
    const ask = async (item) => (await (await c.post(c.site(L.sup, "/requests"), null, { kind: "MATERIALS", priority: "HIGH", neededBy, projectId: project.id, details: { item }, sendTo: "YARD" })).json().catch(() => ({}))).request?.id;
    const j1 = await ask(`${tag} masks for site`);
    if (t.ok(!!j1, "a yard job from the supervisor's link")) {
      const before = await onHand(A);
      const r1 = await send("PATCH", `/api/yard/${j1}`, "YARD", { action: "READY", photo: PNG, stock: [{ itemId: A, qty: 2 }] });
      t.ok(r1.status === 200 && r1.body?.job?.status === "READY", "the yard marks it ready, taking 2 box from stock", `${r1.status} ${JSON.stringify(r1.body)}`);
      t.ok((await onHand(A)) === before - 2, `the shelf drops by 2 (${before} -> ${await onHand(A)})`);
      const out = await c.db.stockMovement.findFirst({ where: { itemId: A, siteRequestId: j1 } });
      t.ok(out?.kind === "OUT" && out.change === -2 && out.siteLabel === project.name && out.projectId === project.id, "an OUT tied to the request and its site", JSON.stringify(out));
      const ev = await c.db.siteRequestEvent.findFirst({ where: { requestId: j1, action: "YARD_READY" }, select: { note: true } });
      t.ok(/Took from stock: 2 box/.test(ev?.note ?? ""), "the request's history says what was taken", ev?.note);
    }
    const j2 = await ask(`${tag} cancelled job`);
    if (t.ok(!!j2, "a second yard job")) {
      t.status(await c.patch(c.site(L.sup, `/requests/${j2}`), null, { action: "CANCEL" }), 200, "the supervisor cancels it");
      const before = await onHand(A);
      t.status(await send("PATCH", `/api/yard/${j2}`, "YARD", { action: "READY", photo: PNG, stock: [{ itemId: A, qty: 1 }] }), 409, "ready with stock on a cancelled job -> 409");
      t.ok((await onHand(A)) === before && (await c.db.stockMovement.count({ where: { siteRequestId: j2 } })) === 0, "the stock is unchanged, no movement");
    }
    const j3 = await ask(`${tag} too much`);
    if (t.ok(!!j3, "a third yard job")) {
      const before = await onHand(A);
      const r3 = await send("PATCH", `/api/yard/${j3}`, "YARD", { action: "READY", photo: PNG, stock: [{ itemId: A, qty: 500 }] });
      t.ok(r3.status === 400 && /Count it first/.test(r3.body?.error ?? ""), "more than the shelf has -> 400 'Count it first'", `${r3.status} ${r3.body?.error}`);
      const st = (await c.db.siteRequest.findUnique({ where: { id: j3 }, select: { status: true } }))?.status;
      t.ok(st === "YARD" && (await onHand(A)) === before, "the job stays with the yard and the stock is unchanged", st);
      t.status(await send("PATCH", `/api/yard/${j3}`, "YARD", { action: "ON_IT", stock: [{ itemId: A, qty: 1 }] }), 400, "stock only goes with READY");
      // The shared yard phone link never takes stock.
      const yard = await makeLink(c.db, "OFFICE", null, { label: "Yard" });
      t.status(await send("PATCH", c.site(yard, `/yard/${j3}`), null, { action: "READY", who: "RC Sam", photo: PNG, stock: [{ itemId: A, qty: 1 }] }), 400, "the shared yard link can't take stock");
      t.ok((await onHand(A)) === before, "still unchanged");
      t.status(await c.get(c.site(yard, "/inventory"), null), 404, "no inventory on any site link");
    }

    // (6) Retire, never delete.
    t.status(await send("PATCH", `/api/inventory/${B}`, "MANAGER", { active: false }), 200, "a Manager retires Duct tape");
    const act = await get("/api/inventory", "MANAGER");
    t.ok(!act.body?.items?.some((i) => i.id === B), "it leaves the list");
    const all = await get("/api/inventory?all=1", "MANAGER");
    t.ok(all.body?.items?.some((i) => i.id === B && i.active === false), "it's still there with ?all=1, retired");
    t.ok((await c.db.inventoryItem.count({ where: { id: B } })) === 1 && (await c.db.stockMovement.count({ where: { itemId: B } })) >= 2, "the item and its history are kept");
    t.status(await move(B, "MANAGER", { kind: "IN", qty: 1 }), 409, "no stock moves on a retired item");
    t.ok(!(await c.db.inventoryItem.findUnique({ where: { id: B }, select: { belowMinAlertedAt: true } }))?.belowMinAlertedAt, "retiring clears its below-minimum mark");
    t.status(await send("DELETE", `/api/inventory/${B}`, "ADMIN"), 405, "there's no delete");
    t.status(await send("PATCH", `/api/inventory/${B}`, "MANAGER", { onHand: 99 }), 400, "the quantity isn't edited directly");

    // (8) Security fixes (Ilies approved ST-006, CI-001b, CI-002..008, 4 Nov 2026).
    // CI-001b: "Stock out to a site" sites - id and name only; the yard computer gets only sites on the board a week
    // either side of today; Managers every active project; a Viewer none. A site it wasn't offered is refused.
    const dayIso = (n) => { const d = new Date(`${c.today}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + n); return d; };
    const pIn = await c.db.project.create({ data: { name: `${tag} in-window site`, status: "ACTIVE" } });
    const pOut = await c.db.project.create({ data: { name: `${tag} long-ago site`, status: "ACTIVE" } });
    await c.db.job.create({ data: { projectId: pIn.id, title: pIn.name, date: dayIso(3), shift: "DAY", status: "ACTIVE" } });
    await c.db.job.create({ data: { projectId: pOut.id, title: pOut.name, date: dayIso(-30), shift: "DAY", status: "ACTIVE" } });
    const ys = (await get("/api/inventory", "YARD")).body?.sites ?? [];
    t.ok(ys.length > 0 && ys.every((s) => JSON.stringify(Object.keys(s).sort()) === '["id","name"]'), "CI-001b: the yard's sites carry id and name only", JSON.stringify(ys[0]));
    t.ok(ys.some((s) => s.id === pIn.id) && !ys.some((s) => s.id === pOut.id), "CI-001b: the yard gets the site on the board this week, not the one from a month ago");
    const ms = (await get("/api/inventory", "MANAGER")).body?.sites ?? [];
    t.ok(ms.some((s) => s.id === pOut.id) && ms.some((s) => s.id === pIn.id), "CI-001b: a Manager gets every active project");
    t.ok(((await get("/api/inventory", "VIEWER")).body?.sites ?? []).length === 0, "CI-001b: a Viewer (can't move stock) gets no sites");
    t.status(await move(A, "YARD", { kind: "OUT", qty: 1, projectId: pOut.id }), 400, "CI-001b: the yard can't stock out to a site it wasn't offered");
    t.status(await move(A, "YARD", { kind: "OUT", qty: 1, projectId: pIn.id }), 201, "CI-001b: ... and can to one it was");

    // (7) Pages, and no dollar figure anywhere.
    for (const [pg, who] of [["/yard/inventory", "YARD"], ["/yard/inventory", "COORDINATOR"], ["/yard/inventory", "MANAGER"], ["/yard", "YARD"]]) {
      const r = await c.text(pg, who);
      t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${pg} as ${who}`, r.status);
    }
    const leaks = seen.filter(([, text]) => !noMoney(text)).map(([p]) => c.scrub(p));
    t.ok(leaks.length === 0, `no "$" + digit in any of the ${seen.length} replies`, leaks.join(", "));
  },
};
