// Yard Stage B - the stock take (Ilies, 4 Nov 2026: "Stage B: start on the stock take"). The yard is counted against
// the register: start one (one open at a time), tick tools found / not here with a condition, a tool the register has
// in a toolbox found here (an extra, "Move to yard" through moveTool), then finish - every tool not found is confirmed
// missing or left as it is first; nothing is marked Missing without that. Finished / cancelled ones are history,
// read-only. Tools access: the yard, the coordinator and Managers count; Viewers look; TIMESHEETS / ACCOUNTS /
// DIRECTOR / no login are refused. No dollar figure in the yard's or the coordinator's replies.
// The shelf-photo reading needs the outbound Claude call, which the copy doesn't have (no ANTHROPIC key, and the
// no-outbound guard watches): the scan is exercised up to that point - it answers 503 and changes nothing. Its
// matching is covered by the unit tests (lib/stockTake/stockTake.test.ts, planScan + compareToolbox).
// WRITES test tools (deleted again), a plate photo, a finished and a cancelled stock take to the copy.
import { noMoney } from "../lib/context.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default {
  id: "stock-take", title: "Yard stock take: one open, tick / extras, Missing only after confirming, history read-only, Tools access, no $",
  writes: true, timeoutMs: 300_000,
  applies: (c) => c.hasPath("src/lib/stockTake/rules.ts") || "needs the yard stock take (lib/stockTake/rules.ts)",
  async run(t, c) {
    const U = c.users;
    for (const k of ["YARD", "COORDINATOR", "MANAGER", "VIEWER"]) if (!U[k]) return t.block(`no ${k} test login (lib/setup.mjs TEST_ROLES)`);
    const seen = []; // the yard's and the coordinator's replies - scanned for "$" + digit at the end
    const send = async (method, pth, who, body) => {
      const r = await c.req(method, pth, who, body); const text = await r.text().catch(() => "");
      if (who === "YARD" || who === "COORDINATOR") seen.push([`${who} ${method} ${pth}`, text]);
      let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, body: j };
    };
    const get = (pth, who) => send("GET", pth, who);
    const line = (id, who, body) => send("POST", `/api/stock-takes/${id}/lines`, who, body);
    const stamp = Date.now().toString(36);

    // (0) The copy shouldn't have one open; if it does, a Manager cancels it so this check starts clean.
    const already = await c.db.stockTake.findFirst({ where: { status: "OPEN" }, select: { id: true } });
    if (already) { t.note("the copy had an open stock take - cancelled first"); await send("POST", `/api/stock-takes/${already.id}`, "MANAGER", { action: "CANCEL" }); }

    // (1) Test tools in the yard (A found - needs repair, B not here - confirmed missing, C never checked - left), and D in a
    // toolbox (found here - an extra, moved to the yard). A carries a Manager's note with an amount.
    const mk = async (name) => { const r = await send("POST", "/api/tools", "MANAGER", { name, serialNumber: `RC-ST-${name}-${stamp}`, condition: "Good", ownership: "OWNED", heldBy: "Yard" }); return r.body?.id; };
    const A = await mk("A"), B = await mk("B"), C = await mk("C");
    if (!t.ok(A && B && C, "three test tools in the yard")) return;
    t.status(await send("PATCH", `/api/tools/${A}`, "MANAGER", { notes: "Repair quote $450 from Hilti" }), 200, "a Manager's note with an amount on A");
    const box = await c.db.toolbox.findFirst({ where: { active: true }, select: { id: true, name: true } });
    const D = box ? await mk("D") : null;
    if (D) t.status(await send("PATCH", `/api/tools/${D}`, "MANAGER", { toolboxId: box.id, moveReason: "rc stock take setup" }), 200, "D lives in a toolbox");
    else t.note("no active toolbox on the copy - the extra / move-to-yard path isn't exercised");
    const yardBefore = await c.db.tool.findMany({ where: { toolboxId: null, condition: { not: "Swapped out" }, id: { notIn: [A, B, C] } }, select: { id: true, condition: true } });

    // (2) Who may: refused logins, and Viewers look only.
    for (const who of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) if (U[who]) {
      t.status(await c.get("/api/stock-takes", who), 403, `${who} can't see stock takes`);
      t.status(await c.post("/api/stock-takes", who, { location: "YARD" }), 403, `${who} can't start one`);
    }
    t.status(await c.get("/api/stock-takes", null), 401, "no login is refused");
    t.status(await c.post("/api/stock-takes", "VIEWER", { location: "YARD" }), 403, "a Viewer can't start one");

    // (3) Start (the yard computer); one open at a time.
    const st = await send("POST", "/api/stock-takes", "YARD", { location: "YARD", note: "RC month-end count" });
    if (!t.status(st, 201, "the yard starts a stock take")) return;
    const id = st.body.id;
    t.status(await send("POST", "/api/stock-takes", "COORDINATOR", { location: "YARD" }), 409, "a second open stock take of the yard is refused");
    t.status(await send("POST", "/api/stock-takes", "MANAGER", { location: "TOOLBOX" }), 400, "only the yard can be counted for now");
    const detail = async (who = "YARD") => (await get(`/api/stock-takes/${id}`, who)).body;
    let d = await detail();
    const expectedCount = await c.db.tool.count({ where: { toolboxId: null, condition: { not: "Swapped out" } } });
    t.ok(d && d.lines.filter((l) => l.expected).length === expectedCount, "one line per yard tool on the register (Missing ones included, swapped-out ones not)", `${d?.lines?.length} vs ${expectedCount}`);
    const L = (toolId) => d.lines.find((l) => l.toolId === toolId);
    t.ok(L(A) && L(B) && L(C) && (!D || !L(D)), "the test tools are on it; D (in a toolbox) isn't");
    t.status(await get("/api/stock-takes", "VIEWER"), 200, "a Viewer sees the list");
    t.status(await get(`/api/stock-takes/${id}`, "VIEWER"), 200, "a Viewer sees the stock take");
    t.status(await line(id, "VIEWER", { action: "FOUND", lineId: L(A).id }), 403, "a Viewer can't tick");
    for (const who of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) if (U[who]) t.status(await c.get(`/api/stock-takes/${id}`, who), 403, `${who} can't open it`);

    // (4) Counting: the yard, the coordinator and a Manager all tick.
    t.status(await line(id, "YARD", { action: "FOUND", lineId: L(A).id, conditionSeen: "Needs repair" }), 200, "the yard: A found, needs repair");
    t.status(await line(id, "YARD", { action: "FOUND", lineId: L(A).id, conditionSeen: "Missing" }), 400, "'Missing' isn't a condition you tick");
    t.status(await line(id, "COORDINATOR", { action: "NOT_FOUND", lineId: L(B).id }), 200, "the coordinator: B not here");
    t.status(await line(id, "MANAGER", { action: "FOUND", lineId: L(C).id }), 200, "a Manager: C found");
    t.status(await line(id, "MANAGER", { action: "UNTICK", lineId: L(C).id }), 200, "and undone - C back to be checked");
    if (D) {
      const ex = await line(id, "YARD", { action: "ADD_EXTRA", toolId: D });
      t.status(ex, 200, "the yard: D found here (the register has it in a toolbox)");
      t.status(await line(id, "YARD", { action: "ADD_EXTRA", toolId: D }), 409, "the same tool can't be added twice");
      if (ex.body?.id) {
        t.status(await line(id, "YARD", { action: "MOVE_TO_YARD", lineId: ex.body.id }), 200, "Move to yard (only when tapped)");
        const dt = await c.db.tool.findUnique({ where: { id: D }, select: { toolboxId: true, heldBy: true } });
        const mv = await c.db.toolMovement.findFirst({ where: { toolId: D, reason: "Found in the yard on a stock take" } });
        t.ok(dt?.toolboxId === null && dt?.heldBy === "Yard" && !!mv, "D is in the yard on the register, held by Yard, and the move is logged (moveTool)");
        t.status(await line(id, "YARD", { action: "DROP", lineId: ex.body.id }), 409, "a moved extra can't be dropped");
      }
    }
    // Shelf photo: up to the Claude call, which the copy can't make.
    t.status(await send("POST", `/api/stock-takes/${id}/scan`, "YARD", { photoIds: [] }), 400, "scan: 1-4 photos");
    const ph = await send("POST", "/api/tools/photos", "YARD", { kind: "CHECK", dataUrl: PNG });
    t.status(ph, 201, "scan: a shelf photo is stored (kind CHECK, the tools photo route)");
    if (ph.body?.id) {
      const before = JSON.stringify((await detail()).lines.map((l) => [l.id, l.result]));
      t.status(await send("POST", `/api/stock-takes/${id}/scan`, "YARD", { photoIds: [ph.body.id] }), 503, "scan: reading needs the Claude key - not on the copy (no outbound call), refused cleanly");
      t.ok(JSON.stringify((await detail()).lines.map((l) => [l.id, l.result])) === before && (await c.db.stockTake.findUnique({ where: { id }, select: { scans: true } }))?.scans === 0,
        "scan: nothing ticked and no reading counted when the photo couldn't be read");
    }

    // (5) Finish: refused until every tool not found has a decision; then only the confirmed one is Missing.
    d = await detail();
    const candidates = d.lines.filter((l) => l.expected && (l.result === "UNCHECKED" || l.result === "NOT_FOUND")).map((l) => l.id);
    const fin0 = await send("POST", `/api/stock-takes/${id}`, "YARD", { action: "FINISH", missing: [], leave: [] });
    t.ok(fin0.status === 409 && Array.isArray(fin0.body?.undecided) && fin0.body.undecided.includes(L(B).id) && fin0.body.undecided.includes(L(C).id), "finish without confirming is refused (409, undecided listed)", String(fin0.status));
    t.status(await send("POST", `/api/stock-takes/${id}`, "YARD", { action: "FINISH", missing: [L(A).id], leave: candidates }), 409, "a found tool can't be confirmed missing");
    t.ok((await c.db.tool.findUnique({ where: { id: B }, select: { condition: true } }))?.condition === "Good", "B is not Missing before it's confirmed");
    const fin = await send("POST", `/api/stock-takes/${id}`, "YARD", { action: "FINISH", missing: [L(B).id], leave: candidates.filter((x) => x !== L(B).id) });
    t.status(fin, 200, "the yard finishes, B confirmed missing, everything else not found left as it is");
    const cond = async (x) => (await c.db.tool.findUnique({ where: { id: x }, select: { condition: true } }))?.condition;
    t.ok((await cond(A)) === "Needs repair", "A: condition Needs repair (the tool update)");
    t.ok((await cond(B)) === "Missing", "B: Missing (confirmed)");
    t.ok((await cond(C)) === "Good", "C: left as it was");
    const yardAfter = await c.db.tool.findMany({ where: { id: { in: yardBefore.map((x) => x.id) } }, select: { id: true, condition: true } });
    t.ok(yardAfter.every((x) => yardBefore.find((y) => y.id === x.id)?.condition === x.condition), "every other yard tool on the copy is unchanged (all left as they were)");
    const rows = await c.db.stockTakeLine.findMany({ where: { stockTakeId: id, toolId: { in: [A, B, C] } }, select: { toolId: true, appliedAt: true, decision: true, appliedChange: true } });
    const R = (x) => rows.find((r) => r.toolId === x);
    t.ok(R(A)?.appliedAt && R(B)?.appliedAt && R(B)?.decision === "MISSING" && !R(C)?.appliedAt && R(C)?.decision === "LEAVE", "each line records its decision and when it was applied");
    const s = await c.db.stockTake.findUnique({ where: { id }, select: { status: true, openKey: true, finishedBy: true } });
    t.ok(s?.status === "FINISHED" && s.openKey === null && !!s.finishedBy, "finished, the yard free for the next one");

    // (6) History: read-only.
    t.status(await line(id, "YARD", { action: "FOUND", lineId: L(C).id }), 409, "a finished stock take can't be ticked");
    t.status(await send("POST", `/api/stock-takes/${id}`, "YARD", { action: "FINISH", missing: [], leave: [] }), 409, "or finished again");
    t.status(await send("POST", `/api/stock-takes/${id}`, "MANAGER", { action: "CANCEL" }), 409, "or cancelled");
    const list = await get("/api/stock-takes", "COORDINATOR");
    const h = list.body?.history?.find((x) => x.id === id);
    t.ok(list.body?.open === null && h && h.summary.confirmedMissing === 1 && h.summary.found >= 1, "the coordinator sees it in the history with its counts");

    // (7) Cancel: nothing on the register changes; the yard is free again.
    const st2 = await send("POST", "/api/stock-takes", "MANAGER", { location: "YARD" });
    t.status(st2, 201, "a Manager starts another");
    if (st2.body?.id) {
      const l2 = (await get(`/api/stock-takes/${st2.body.id}`, "MANAGER")).body?.lines?.find((l) => l.toolId === B);
      if (l2) t.status(await line(st2.body.id, "COORDINATOR", { action: "FOUND", lineId: l2.id }), 200, "B (Missing) is on it - found again");
      t.status(await send("POST", `/api/stock-takes/${st2.body.id}`, "COORDINATOR", { action: "CANCEL" }), 200, "the coordinator cancels it");
      t.ok((await cond(B)) === "Missing" && (await c.db.stockTake.findUnique({ where: { id: st2.body.id }, select: { status: true, openKey: true } }))?.status === "CANCELLED", "cancelled: B stays Missing, nothing applied");
      const st3 = await send("POST", "/api/stock-takes", "YARD", { location: "YARD" });
      t.status(st3, 201, "after a cancel the yard can start again");
      if (st3.body?.id) t.status(await send("POST", `/api/stock-takes/${st3.body.id}`, "YARD", { action: "CANCEL" }), 200, "(and cancels - clean-up)");
    }

    // (8) Tools deleted later: the history still reads (tag and name kept on the line).
    for (const x of [A, B, C, D].filter(Boolean)) await send("DELETE", `/api/tools/${x}`, "MANAGER");
    const after = (await get(`/api/stock-takes/${id}`, "YARD")).body;
    const gone = after?.lines?.filter((l) => l.tag && l.toolId === null) ?? [];
    t.ok(gone.length >= 3 && gone.every((l) => l.name), "deleted tools still show by tag and name in the history");

    // (9) No dollar figure in anything the yard or the coordinator received.
    const leaks = seen.filter(([, text]) => !noMoney(text)).map(([p]) => p);
    t.ok(leaks.length === 0, `no "$" + digit in any of their ${seen.length} replies`, leaks.join(", "));
  },
};
