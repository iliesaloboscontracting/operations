// Accounts stage 5, compliance (was s5check.mjs): access, an expired ticket shows on the board as label + date only,
// a reminder exists, a TFN is refused, nothing leaks to links or /api/resources. WRITES one synthetic ticket.
export default {
  id: "compliance-s5", title: "Compliance: access, board flag only, TFN refused, no leak",
  writes: true,
  async run(t, c) {
    for (const p of ["/api/compliance/workers", "/api/compliance/documents"]) {
      t.status(await c.get(p, "ACCOUNTS"), 200, `${p} as accounts`);
      t.status(await c.get(p, "MANAGER"), 403, `${p} as manager`);
      t.status(await c.get(p, null), 401, `${p} no login`);
    }
    t.status(await c.get("/api/compliance/flags", "MANAGER"), 200, "board flags as Manager");
    t.status(await c.get("/api/compliance/flags", null), 401, "board flags no login");
    for (const p of ["/accounts/compliance", "/accounts"]) { const r = await c.text(p, "ACCOUNTS"); t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${p}`, r.status); }
    const workers = (await c.json("/api/compliance/workers", "ACCOUNTS")).body;
    const w = (workers?.workers ?? workers?.people ?? (Array.isArray(workers) ? workers : []))[0];
    if (!w) return t.block("no workers on the snapshot");
    const num = `RC-WC-${Date.now() % 100000}`;
    t.status(await c.post("/api/compliance/tickets", "ACCOUNTS", { resourceId: w.id, kind: "WHITE_CARD", number: num, issueDate: "2020-01-01", expiryDate: "2026-01-01" }), [200, 201], "a ticket with a past expiry is saved");
    const flags = (await c.text("/api/compliance/flags", "MANAGER")).text;
    t.ok(flags.includes(w.id) && !flags.includes(num), "the board flag shows for that worker, without the ticket number");
    const todo = (await c.text("/api/accounts/pending", "ACCOUNTS")).text + (await c.text("/api/accounts/items", "ACCOUNTS")).text;
    t.ok(/RC-WC-|White card|Ticket/i.test(todo), "a reminder exists on the accounts calendar / to-do");
    const tfn = await c.put(`/api/compliance/workers/${w.id}`, "ACCOUNTS", { address: "1 Test St", notes: "TFN 123 456 789" });
    t.status(tfn, 400, "a TFN in onboarding notes is refused");
    if (c.links.sup) t.ok(!new RegExp(`${num}|ticket|onboarding`, "i").test((await c.text(c.site(c.links.sup), null)).text), "nothing about tickets on the supervisor link");
    t.ok(!new RegExp(`${num}|dateOfBirth|onboarding`, "i").test((await c.text("/api/resources", "MANAGER")).text), "no ticket numbers / onboarding in /api/resources");
  },
};
