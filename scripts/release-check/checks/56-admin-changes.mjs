// Admin change kinds (controlled changes, 28-29 Oct 2026; docs/lci/ADMIN-CHANGE-KINDS-DESIGN.md) and their masking
// (security review SEC-001 / SEC-009 / SEC-010): Operations AI proposes a pay-rate change and sees what it proposed,
// never the current rate - no before, no fingerprint, no undo, a masked applied note, and UNDO is refused. Manager,
// DIRECTOR and ACCOUNTS logins don't see admin kinds and can't approve them; the owner sees the values and approves.
// WRITES one pay-rate change to a person on the copy.
const MASK = "Current value: Admins only";
const ADMIN_KINDS = ["TIP_RATE_ADD", "TIP_RATE_RETIRE", "INVOICED_COST_REMOVE", "RESOURCE_RATE", "RESOURCE_ENGAGEMENT", "WORKER_TICKET", "COMPLIANCE_DOC"];
const money = (n) => n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default {
  id: "admin-changes", title: "Admin change kinds: Operations AI can't read current pay; only the owner / an Admin approves",
  writes: true,
  applies: (c) => c.hasPath("src/lib/changes/adminRules.ts") || "needs the admin change kinds",
  async run(t, c) {
    const U = c.users;
    if (!U.OWNER || !U.OPS_AI) return t.block("the owner / Operations AI logins couldn't be set up on the copy");
    const open = (await c.db.changeProposal.findMany({ where: { status: "PROPOSED", kind: "RESOURCE_RATE" }, select: { recordId: true } })).map((x) => x.recordId);
    const person = await c.db.resource.findFirst({ where: { type: "PERSONNEL", active: true, ordinaryRate: { not: null }, id: { notIn: open } }, select: { id: true, ordinaryRate: true } });
    if (!person) return t.block("no active person with a pay rate on the copy");
    const cur = person.ordinaryRate, want = Math.round((cur + 1.37) * 100) / 100;
    const list = async (who) => { const r = await c.json("/api/changes", who); return r.status === 200 ? r.body?.changes ?? [] : []; };

    const pr = await c.post("/api/changes", "OPS_AI", { kind: "RESOURCE_RATE", recordId: person.id, ordinaryRate: want, reason: "Release check", sources: [{ type: "Other", label: "Release check" }] });
    t.status(pr, 201, "Operations AI proposes a pay-rate change");
    const id = (await pr.json().catch(() => ({}))).id;
    if (!t.ok(!!id, "the proposal was made")) return;

    const ai = (await list("OPS_AI")).find((x) => x.id === id);
    t.ok(ai?.before === MASK, "Operations AI's card: no current value", `before: ${ai?.before}`);
    t.ok(ai?.fingerprint === "", "Operations AI's card: no fingerprint");
    t.ok(ai?.canUndo === false, "Operations AI's card: no undo");
    t.ok(!!ai && !JSON.stringify(ai).includes(money(cur)), "the current rate appears nowhere in Operations AI's view");
    t.ok(!!ai && ai.after.includes(money(want)), "Operations AI still sees what it proposed");

    for (const who of ["MANAGER", "DIRECTOR", "ACCOUNTS"]) {
      t.ok(!(await list(who)).some((x) => ADMIN_KINDS.includes(x.kind)), `${who} sees no admin kinds`);
      t.status(await c.post(`/api/changes/${id}`, who, { action: "APPROVE", fingerprint: "0".repeat(64) }), [403, 404], `${who} can't approve it`);
    }
    t.status(await c.post(`/api/changes/${id}`, "OPS_AI", { action: "APPROVE", fingerprint: "0".repeat(64) }), 403, "Operations AI never approves");

    const own = (await list("OWNER")).find((x) => x.id === id);
    t.ok(!!own && own.before !== MASK && own.before.includes(money(cur)), "the owner sees the current value");
    t.ok(/^[0-9a-f]{64}$/.test(own?.fingerprint ?? ""), "the owner gets the fingerprint");
    t.ok(own?.proposedByAi === true && own?.hiddenFromProposer === true, "the owner's card: 'Proposed by Operations AI' and the don't-quote hint");
    const ap = await c.post(`/api/changes/${id}`, "OWNER", { action: "APPROVE", fingerprint: own?.fingerprint });
    t.status(ap, 200, "the owner approves Operations AI's proposal");
    const rate = (await c.db.resource.findUnique({ where: { id: person.id }, select: { ordinaryRate: true } }))?.ordinaryRate;
    t.ok(rate === want, "the rate went in", `rate ${rate}`);

    const aiAfter = (await list("OPS_AI")).find((x) => x.id === id);
    const ex = aiAfter?.events?.find((e) => e.action === "EXECUTED");
    t.ok(!!ex && !ex.note.includes(money(cur)) && !/sets it back to/.test(ex.note), "Operations AI's applied note is masked");
    t.ok(aiAfter?.canUndo === false, "still no undo for Operations AI");
    t.status(await c.post(`/api/changes/${id}`, "OPS_AI", { action: "UNDO" }), 403, "Operations AI can't propose the undo");
    t.ok((await list("OWNER")).find((x) => x.id === id)?.canUndo === true, "the owner can");
  },
};
