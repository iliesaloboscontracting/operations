// Accounts stage 3 (was s3check.mjs): access, on-cost rates Admin-only, a double claim refused, Tracking unchanged,
// nothing about claims on a link. WRITES to the test copy (one synthetic claim).
export default {
  id: "accounts-s3", title: "Reimbursements & labour cost: access, no double claim, Tracking unchanged",
  writes: true,
  async run(t, c) {
    const before = (await c.text("/api/tracking", "MANAGER")).text;
    for (const p of ["/api/accounts/labour-cost", "/api/accounts/oncost-rates", "/api/accounts/reimbursements"]) {
      t.status(await c.get(p, "ACCOUNTS"), 200, `${p} as accounts`);
      t.status(await c.get(p, "MANAGER"), 403, `${p} as manager`);
      t.status(await c.get(p, null), 401, `${p} no login`);
    }
    for (const p of ["/accounts/labour-cost", "/accounts/reimbursements", "/accounts"]) {
      const r = await c.text(p, "ACCOUNTS"); t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${p} as accounts`, r.status);
    }
    t.status(await c.post("/api/accounts/oncost-rates", "ACCOUNTS", { name: "Super", pct: 1, base: "PAID", appliesTo: "EMPLOYEES", from: "2026-07-01" }), 403, "accounts can't enter on-cost rates (Admin only)");
    const people = (await c.json("/api/accounts/reimbursements", "ACCOUNTS")).body;
    const pid = people?.people?.[0]?.id;
    if (!pid) return t.block("no people in the reimbursements list on the snapshot");
    const claim = { resourceId: pid, description: "Release check - gloves", supplier: "Release check hardware", refNo: "RC-TEST-0042", amountIncGst: 12.5, spentOn: c.lastWeek };
    const c1 = await c.post("/api/accounts/reimbursements", "ACCOUNTS", claim);
    t.status(c1, [200, 201], "a manual claim is saved");
    t.status(await c.post("/api/accounts/reimbursements", "ACCOUNTS", { ...claim, refNo: "rc test 0042" }), 409, "same number + amount + date refused as a double claim");
    t.status(await c.post("/api/accounts/reimbursements", "MANAGER", claim), 403, "a Manager can't claim");
    t.ok(before === (await c.text("/api/tracking", "MANAGER")).text, "Tracking byte-for-byte unchanged");
    if (c.links.sup) t.ok(!/reimburs|on-?cost|RC-TEST-0042/i.test((await c.text(c.site(c.links.sup), null)).text), "nothing about claims on the supervisor link");
  },
};
