// Yard Stage B - the stock take (Ilies, 4 Nov 2026: "Stage B: start on the stock take"). The yard is counted against
// the register: start one (one open at a time), tick tools found / not here with a condition, a tool the register has
// in a toolbox found here (an extra, "Move to yard" through moveTool), then finish - every tool not found is confirmed
// missing or left as it is first; nothing is marked Missing without that. Finished / cancelled ones are history,
// read-only. Tools access: the yard, the coordinator and Managers count; Viewers look; TIMESHEETS / ACCOUNTS /
// DIRECTOR / no login are refused. No dollar figure in the yard's or the coordinator's replies.
// ST-004 (Ilies approved 4 Nov 2026) adds the security review's negatives: amounts in the note, another stock take's
// lines, a non-CHECK photo, every write route refused to the logins that only look or never see Tools, and the
// ST-001 (two Finish presses at once), ST-002 (a reading is counted before the call), ST-003 (a tool swapped out since
// the start) and ST-005 (drop keeps the line, finish decisions capped, no login ids) checks that need no Claude call.
// The shelf-photo reading needs the outbound Claude call, which the copy doesn't have (no ANTHROPIC key, and the
// no-outbound guard watches): the scan is exercised up to that point - it answers 503 and ticks nothing. Its matching
// and the races around it are covered by the unit tests (lib/stockTake/*.test.ts).
// WRITES test tools (deleted again), photos, finished and cancelled stock takes to the copy.
import { noMoney } from "../lib/context.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export default {
  id: "stock-take", title: "Yard stock take: one open, tick / extras, Missing only after confirming, history read-only, Tools access, no $",
  writes: true, timeoutMs: 360_000,
  applies: (c) => c.hasPath("src/lib/stockTake/rules.ts") || "needs the yard stock take (lib/stockTake/rules.ts)",
  async run(t, c) {
    const U = c.users;
    for (const k of ["YARD", "COORDINATOR", "MANAGER", "VIEWER"]) if (!U[k]) return t.block(`no ${k} test login (lib/setup.mjs TEST_ROLES)`);
    const seen = []; // the yard's and the coordinator's replies - scanned for "$" + digit at the end
    const send = async (method, pth, who, body) => {
      const r = await c.req(method, pth, who, body); const text = await r.text().catch(() => "");
      if (who === "YARD" || who === "COORDINATOR") seen.push([`${who} ${method} ${pth}`, text]);
      let j = null; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, body: j, text };
    };
    const get = (pth, who) => send("GET", pth, who);
    const line = (id, who, body) => send("POST", `/api/stock-takes/${id}/lines`, who, body);
    const act = (id, who, body) => send("POST", `/api/stock-takes/${id}`, who, body);
    const cond = async (x) => (await c.db.tool.findUnique({ where: { id: x }, select: { condition: true } }))?.condition;
    const stamp = Date.now().toString(36);
    const LOOKERS = ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"].filter((k) => U[k]);

    // (0) The copy shouldn't have one open; if it does, a Manager cancels it so this check starts clean.
    const already = await c.db.stockTake.findFirst({ where: { status: { in: ["OPEN", "FINISHING"] } }, select: { id: true, status: true } });
    if (already) { t.note(`the copy had a stock take ${already.status} - cancelled first`); await act(already.id, "MANAGER", { action: "CANCEL" }); }

    // (1) Test tools in the yard: A found - needs repair, B not here - confirmed missing, C never checked - left, E not
    // here then swapped out with Hilti (ST-003); D and F in a toolbox (extras: D moved to the yard, F dropped and added back).
    const mk = async (name) => { const r = await send("POST", "/api/tools", "MANAGER", { name, serialNumber: `RC-ST-${name}-${stamp}`, condition: "Good", ownership: "OWNED", heldBy: "Yard" }); return r.body?.id; };
    const A = await mk("A"), B = await mk("B"), C = await mk("C"), E = await mk("E");
    if (!t.ok(A && B && C && E, "four test tools in the yard")) return;
    t.status(await send("PATCH", `/api/tools/${A}`, "MANAGER", { notes: "Repair quote $450 from Hilti" }), 200, "a Manager's note with an amount on A");
    const box = await c.db.toolbox.findFirst({ where: { active: true }, select: { id: true, name: true } });
    const D = box ? await mk("D") : null, F = box ? await mk("F") : null;
    for (const x of [D, F].filter(Boolean)) t.status(await send("PATCH", `/api/tools/${x}`, "MANAGER", { toolboxId: box.id, moveReason: "rc stock take setup" }), 200, "a test tool lives in a toolbox");
    if (!box) t.note("no active toolbox on the copy - the extra / move-to-yard / drop paths aren't exercised");

    // (2) Who may: refused logins, and Viewers look only.
    for (const who of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) if (U[who]) {
      t.status(await c.get("/api/stock-takes", who), 403, `${who} can't see stock takes`);
      t.status(await c.post("/api/stock-takes", who, { location: "YARD" }), 403, `${who} can't start one`);
    }
    t.status(await c.get("/api/stock-takes", null), 401, "no login is refused");
    t.status(await c.post("/api/stock-takes", "VIEWER", { location: "YARD" }), 403, "a Viewer can't start one");

    // (3) An earlier stock take (a Manager starts and cancels it) - its lines are used below as "another stock take's".
    const st0 = await send("POST", "/api/stock-takes", "MANAGER", { location: "YARD" });
    t.status(st0, 201, "a Manager starts a stock take");
    const otherLine = st0.body?.id ? (await get(`/api/stock-takes/${st0.body.id}`, "MANAGER")).body?.lines?.[0]?.id : null;
    if (st0.body?.id) t.status(await act(st0.body.id, "COORDINATOR", { action: "CANCEL" }), 200, "the coordinator cancels it");

    // (4) Start (the yard computer); one open at a time. A Manager's note with an amount never reaches the yard.
    const st = await send("POST", "/api/stock-takes", "YARD", { location: "YARD" });
    if (!t.status(st, 201, "the yard starts a stock take")) return;
    const id = st.body.id;
    t.status(await send("POST", "/api/stock-takes", "COORDINATOR", { location: "YARD" }), 409, "a second open stock take of the yard is refused");
    t.status(await send("POST", "/api/stock-takes", "MANAGER", { location: "TOOLBOX" }), 400, "only the yard can be counted for now");
    t.status(await act(id, "YARD", { action: "NOTE", note: "Count cost $20 extra" }), 400, "the yard can't write an amount into the note");
    t.status(await act(id, "MANAGER", { action: "NOTE", note: "Count after $450 repair" }), 200, "a Manager's note with an amount");
    for (const who of ["YARD", "COORDINATOR"]) {
      const lst = await get("/api/stock-takes", who), one = await get(`/api/stock-takes/${id}`, who);
      // The amount, in any form it could leak as ("$450", "$ 450", "450 repair") - not any "450": a record id or a
      // ".450Z" time can carry those digits by chance on a live copy (failed once that way, 4 Nov 2026). The
      // surrounding text is shown on a failure.
      const leak = /\$\s?450|450\s*repair/;
      const ctx = (s) => [...s.matchAll(/.{0,40}450.{0,40}/g)].map((m) => m[0]).slice(0, 5).join(" | ");
      t.ok(lst.status === 200 && one.status === 200 && !leak.test(lst.text) && !leak.test(one.text), `${who}: the list and the stock take carry neither "$450" nor "450 repair"`, ctx(lst.text + one.text));
      t.ok(/amount not recorded|Count after/.test(one.text), `${who}: the note is there with its amount taken out`);
      t.ok(!/startedById|finishedById/.test(lst.text + one.text), `${who}: no login ids in the replies (ST-005)`);
    }
    t.status(await act(id, "YARD", { action: "NOTE", note: "Count after the repair" }), 409, "the yard can't overwrite a note holding an amount it can't see");
    t.ok((await c.db.stockTake.findUnique({ where: { id }, select: { note: true } }))?.note === "Count after $450 repair", "the Manager's note is untouched");

    const detail = async (who = "YARD") => (await get(`/api/stock-takes/${id}`, who)).body;
    let d = await detail();
    const expectedCount = await c.db.tool.count({ where: { toolboxId: null, condition: { not: "Swapped out" }, retiredAt: null } }); // retired tools are never counted (keep forever)
    t.ok(d && d.lines.filter((l) => l.expected).length === expectedCount, "one line per yard tool on the register (Missing ones included, swapped-out ones not)", `${d?.lines?.length} vs ${expectedCount}`);
    const L = (toolId) => d.lines.find((l) => l.toolId === toolId);
    t.ok(L(A) && L(B) && L(C) && L(E) && (!D || !L(D)), "the test tools are on it; the toolbox ones aren't");
    const yardBefore = await c.db.tool.findMany({ where: { id: { in: d.lines.map((l) => l.toolId).filter((x) => x && ![A, B, C, E].includes(x)) } }, select: { id: true, condition: true } });
    t.status(await get("/api/stock-takes", "VIEWER"), 200, "a Viewer sees the list");
    t.status(await get(`/api/stock-takes/${id}`, "VIEWER"), 200, "a Viewer sees the stock take");
    for (const who of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) if (U[who]) t.status(await c.get(`/api/stock-takes/${id}`, who), 403, `${who} can't open it`);

    // (5) Every write refused to the logins that only look (Viewer) or never see Tools; 401 without a login.
    const writes = [
      ["lines", `/api/stock-takes/${id}/lines`, { action: "FOUND", lineId: L(A).id }],
      ["scan", `/api/stock-takes/${id}/scan`, { photoIds: ["x"] }],
      ["FINISH", `/api/stock-takes/${id}`, { action: "FINISH", missing: [], leave: [] }],
      ["CANCEL", `/api/stock-takes/${id}`, { action: "CANCEL" }],
      ["NOTE", `/api/stock-takes/${id}`, { action: "NOTE", note: "x" }],
    ];
    for (const [what, pth, body] of writes) {
      for (const who of LOOKERS) t.status(await c.post(pth, who, body), 403, `${who}: ${what} refused`);
      t.status(await c.post(pth, null, body), 401, `no login: ${what} refused`);
    }

    // (6) Counting: the yard, the coordinator and a Manager all tick.
    t.status(await line(id, "YARD", { action: "FOUND", lineId: L(A).id, conditionSeen: "Needs repair" }), 200, "the yard: A found, needs repair");
    t.status(await line(id, "YARD", { action: "FOUND", lineId: L(A).id, conditionSeen: "Missing" }), 400, "'Missing' isn't a condition you tick");
    t.status(await line(id, "COORDINATOR", { action: "NOT_FOUND", lineId: L(B).id }), 200, "the coordinator: B not here");
    t.status(await line(id, "MANAGER", { action: "FOUND", lineId: L(C).id }), 200, "a Manager: C found");
    t.status(await line(id, "MANAGER", { action: "UNTICK", lineId: L(C).id }), 200, "and undone - C back to be checked");
    t.status(await line(id, "YARD", { action: "NOT_FOUND", lineId: L(E).id }), 200, "the yard: E not here");
    // Another stock take's lines can't be touched from this one.
    if (otherLine) {
      for (const a of ["FOUND", "DROP", "MOVE_TO_YARD"]) t.status(await line(id, "YARD", { action: a, lineId: otherLine }), 404, `${a} with another stock take's line -> 404`);
      t.status(await act(id, "YARD", { action: "FINISH", missing: [otherLine], leave: [] }), 409, "FINISH with another stock take's line -> 409");
    } else t.note("no line on the earlier stock take (empty yard on the copy) - the other-stock-take checks aren't exercised");
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
    if (F) {
      const fx = await line(id, "COORDINATOR", { action: "ADD_EXTRA", toolId: F });
      if (t.status(fx, 200, "the coordinator: F found here") && fx.body?.id) {
        t.status(await line(id, "COORDINATOR", { action: "DROP", lineId: fx.body.id }), 200, "and dropped (a mistake)");
        const kept = await c.db.stockTakeLine.findUnique({ where: { id: fx.body.id }, select: { result: true } });
        t.ok(kept?.result === "DROPPED", "ST-005: the dropped line is kept (DROPPED), not deleted");
        t.ok((await detail()).summary.extras === (D ? 1 : 0), "ST-005: a dropped line isn't counted");
        t.status(await line(id, "COORDINATOR", { action: "FOUND", lineId: fx.body.id }), 409, "a dropped line can't be ticked");
        const back = await line(id, "COORDINATOR", { action: "ADD_EXTRA", toolId: F });
        t.ok(back.status === 200 && back.body?.id === fx.body.id, "adding it back revives the same line", String(back.status));
        t.status(await line(id, "COORDINATOR", { action: "DROP", lineId: fx.body.id }), 200, "(dropped again - F stays in its toolbox)");
      }
    }

    // (7) Shelf photo: up to the Claude call, which the copy can't make.
    t.status(await send("POST", `/api/stock-takes/${id}/scan`, "YARD", { photoIds: [] }), 400, "scan: 1-4 photos");
    const plate = await send("POST", "/api/tools/photos", "YARD", { kind: "PLATE", dataUrl: PNG });
    if (plate.body?.id) t.status(await send("POST", `/api/stock-takes/${id}/scan`, "YARD", { photoIds: [plate.body.id] }), 400, "scan: a photo that isn't a shelf (CHECK) photo -> 400");
    t.ok((await c.db.stockTake.findUnique({ where: { id }, select: { scans: true } }))?.scans === 0, "refused scans aren't counted");
    const ph = await send("POST", "/api/tools/photos", "YARD", { kind: "CHECK", dataUrl: PNG });
    t.status(ph, 201, "scan: a shelf photo is stored (kind CHECK, the tools photo route)");
    if (ph.body?.id) {
      const before = JSON.stringify((await detail()).lines.map((l) => [l.id, l.result]));
      const rows0 = await c.db.stockTakeScan.count({ where: { stockTakeId: id } });
      t.status(await send("POST", `/api/stock-takes/${id}/scan`, "YARD", { photoIds: [ph.body.id] }), 503, "scan: reading needs the Claude key - not on the copy (no outbound call), refused cleanly");
      t.ok(JSON.stringify((await detail()).lines.map((l) => [l.id, l.result])) === before, "scan: nothing ticked when the photo couldn't be read");
      t.ok((await c.db.stockTake.findUnique({ where: { id }, select: { scans: true } }))?.scans === 1 && (await c.db.stockTakeScan.count({ where: { stockTakeId: id } })) === rows0 + 1,
        "ST-002: the reading was reserved before the call and isn't given back when it fails");
    }

    // (8) Finish: refused until every tool not found has a decision; then only the confirmed ones change.
    d = await detail();
    const candidates = d.lines.filter((l) => l.expected && (l.result === "UNCHECKED" || l.result === "NOT_FOUND")).map((l) => l.id);
    const fin0 = await act(id, "YARD", { action: "FINISH", missing: [], leave: [] });
    t.ok(fin0.status === 409 && Array.isArray(fin0.body?.undecided) && fin0.body.undecided.includes(L(B).id) && fin0.body.undecided.includes(L(C).id), "finish without confirming is refused (409, undecided listed)", String(fin0.status));
    t.status(await act(id, "YARD", { action: "FINISH", missing: [L(A).id], leave: candidates }), 409, "a found tool can't be confirmed missing");
    const tooMany = Array.from({ length: d.lines.length + 1 }, (_, i) => `rc-${i}`);
    t.status(await act(id, "YARD", { action: "FINISH", missing: tooMany, leave: [] }), 400, "ST-005: more decisions than lines -> 400");
    t.ok((await cond(B)) === "Good", "B is not Missing before it's confirmed");
    t.ok((await c.db.stockTake.findUnique({ where: { id }, select: { status: true } }))?.status === "OPEN", "refused finishes claimed nothing");
    // ST-003: E is swapped out with Hilti after the count started.
    t.status(await send("PATCH", `/api/tools/${E}`, "MANAGER", { condition: "Swapped out" }), 200, "E is swapped out with Hilti meanwhile");
    // ST-001: two Finish presses at once - one goes ahead, the other is refused; each tool changes once.
    const body = { action: "FINISH", missing: [L(B).id, L(E).id], leave: candidates.filter((x) => x !== L(B).id && x !== L(E).id) };
    const [f1, f2] = await Promise.all([act(id, "YARD", body), act(id, "COORDINATOR", body)]);
    t.ok([f1.status, f2.status].sort().join() === "200,409", "ST-001: two Finish presses at once -> one 200, one 409", `${f1.status} ${f2.status}`);
    const winner = f1.status === 200 ? f1 : f2;
    t.ok((winner.body?.changes ?? []).length === 2, "the finish changed exactly A and B", JSON.stringify(winner.body?.changes?.length));
    t.ok((await cond(A)) === "Needs repair", "A: condition Needs repair (the tool update)");
    t.ok((await cond(B)) === "Missing", "B: Missing (confirmed)");
    t.ok((await cond(C)) === "Good", "C: left as it was");
    t.ok((await cond(E)) === "Swapped out", "ST-003: E stays Swapped out - not marked Missing");
    const yardAfter = await c.db.tool.findMany({ where: { id: { in: yardBefore.map((x) => x.id) } }, select: { id: true, condition: true } });
    t.ok(yardAfter.every((x) => yardBefore.find((y) => y.id === x.id)?.condition === x.condition), "every other yard tool on the copy is unchanged (all left as they were)");
    const rows = await c.db.stockTakeLine.findMany({ where: { stockTakeId: id, toolId: { in: [A, B, C, E] } }, select: { toolId: true, appliedAt: true, decision: true, appliedChange: true } });
    const R = (x) => rows.find((r) => r.toolId === x);
    t.ok(R(A)?.appliedAt && R(B)?.appliedAt && R(B)?.decision === "MISSING" && !R(C)?.appliedAt && R(C)?.decision === "LEAVE", "each line records its decision and when it was applied");
    t.ok(!R(E)?.appliedAt && R(E)?.decision === "MISSING" && /Swapped out since the start/.test(R(E)?.appliedChange ?? ""), "ST-003: E's line says why nothing changed");
    const s = await c.db.stockTake.findUnique({ where: { id }, select: { status: true, openKey: true, finishedBy: true } });
    t.ok(s?.status === "FINISHED" && s.openKey === null && !!s.finishedBy, "finished, the yard free for the next one");

    // (9) History: read-only.
    t.status(await line(id, "YARD", { action: "FOUND", lineId: L(C).id }), 409, "a finished stock take can't be ticked");
    t.status(await act(id, "YARD", { action: "FINISH", missing: [], leave: [] }), 409, "or finished again");
    t.status(await act(id, "MANAGER", { action: "CANCEL" }), 409, "or cancelled");
    t.status(await act(id, "YARD", { action: "NOTE", note: "late" }), 409, "or noted");
    if (ph.body?.id) t.status(await send("POST", `/api/stock-takes/${id}/scan`, "YARD", { photoIds: [ph.body.id] }), 409, "or scanned");
    const list = await get("/api/stock-takes", "COORDINATOR");
    const h = list.body?.history?.find((x) => x.id === id);
    // ST-006 (Ilies approved 4 Nov 2026): confirmed missing = really marked Missing - B; E (swapped out since) doesn't count.
    t.ok(list.body?.open === null && h && h.summary.confirmedMissing === 1 && h.summary.found >= 1, "the coordinator sees it in the history with its counts (1 confirmed missing - E was swapped out, not marked)", JSON.stringify(h?.summary));

    // (10) Cancel: nothing on the register changes; the yard is free again.
    const st2 = await send("POST", "/api/stock-takes", "MANAGER", { location: "YARD" });
    t.status(st2, 201, "a Manager starts another");
    if (st2.body?.id) {
      const l2 = (await get(`/api/stock-takes/${st2.body.id}`, "MANAGER")).body?.lines?.find((l) => l.toolId === B);
      if (l2) t.status(await line(st2.body.id, "COORDINATOR", { action: "FOUND", lineId: l2.id }), 200, "B (Missing) is on it - found again");
      t.status(await act(st2.body.id, "COORDINATOR", { action: "CANCEL" }), 200, "the coordinator cancels it");
      t.ok((await cond(B)) === "Missing" && (await c.db.stockTake.findUnique({ where: { id: st2.body.id }, select: { status: true } }))?.status === "CANCELLED", "cancelled: B stays Missing, nothing applied");
      const st3 = await send("POST", "/api/stock-takes", "YARD", { location: "YARD" });
      t.status(st3, 201, "after a cancel the yard can start again");
      if (st3.body?.id) t.status(await act(st3.body.id, "YARD", { action: "CANCEL" }), 200, "(and cancels - clean-up)");
    }

    // (11) Tools taken off later: the history still reads (tag and name kept on the line). Keep forever (Ilies, 10 Nov
    // 2026): the Delete route RETIRES a tool - it's kept (retiredAt), so the line keeps its tool too.
    const testTools = [A, B, C, D, E, F].filter(Boolean);
    for (const x of testTools) await send("DELETE", `/api/tools/${x}`, "MANAGER");
    const after = (await get(`/api/stock-takes/${id}`, "YARD")).body;
    const kept = after?.lines?.filter((l) => l.tag && testTools.includes(l.toolId)) ?? [];
    const retired = await c.db.tool.count({ where: { id: { in: testTools }, retiredAt: { not: null } } });
    t.ok(kept.length >= 4 && kept.every((l) => l.name) && retired === testTools.length, "retired tools still show by tag and name in the history - and are kept, retired", `${kept.length} lines, ${retired} retired`);

    // (12) No dollar figure in anything the yard or the coordinator received.
    const leaks = seen.filter(([, text]) => !noMoney(text)).map(([p]) => p);
    t.ok(leaks.length === 0, `no "$" + digit in any of their ${seen.length} replies`, leaks.join(", "));
  },
};
