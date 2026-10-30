// Reimbursement tile on links (was rbcheck.mjs): no tip dockets in the claim list, the fuel picker offers trucks and
// plant, no money on the link, the "I paid this myself" tick and no-$ note rules, office links refused.
export default {
  id: "reimbursements", title: "Reimbursement tile: link rules, no money, no tip dockets as claims",
  async run(t, c) {
    const L = c.links;
    if (!L.sup || !L.office) return t.block(L.missing.join("; "));
    const rl = (await c.json("/api/accounts/reimbursements", "ACCOUNTS")).body ?? {};
    const cands = rl.receipts ?? rl.ownReceipts ?? [];
    t.ok(!JSON.stringify(cands).includes('"TIP"'), `no tip dockets in the claim list (${cands.length} candidates)`);
    const r = await c.text(c.site(L.sup, "/reimbursements"), null);
    t.status(r.status, 200, "supervisor reimbursement screen loads");
    const j = JSON.parse(r.text || "{}");
    const groups = new Set((j.assets ?? []).map((a) => a.group));
    t.ok(groups.has("TRUCK") && groups.has("PLANT"), "the fuel picker offers trucks and plant (groups TRUCK + PLANT)", [...groups].join(","));
    t.ok(!/\$\s?\d|amount|total/i.test(r.text.replace(/"Leave the amount[^"]*"/g, "")), "no money on the link");
    const post = (body) => c.post(c.site(L.sup, "/reimbursements"), null, body);
    t.status(await post({ purpose: "TOOLS", note: "gloves", photoIds: [] }), 400, "no tick, no photo -> refused");
    t.status(await post({ purpose: "OTHER", note: "cost $40", photoIds: ["x"], paidMyself: true }), 400, "a $ figure in the note is refused");
    // SEC-006: a Lobos truck renamed "$5 ..." on the copy - the screen still opens (200) with no "$"; the name is put back.
    const truck = await c.db.resource.findFirst({ where: { type: "VEHICLE", ownership: "OWNED", active: true, NOT: { category: "Other" } }, select: { id: true, name: true } });
    if (truck) {
      await c.db.resource.update({ where: { id: truck.id }, data: { name: "$5 Release Truck" } });
      try {
        const odd = await c.text(c.site(L.sup, "/reimbursements"), null);
        t.status(odd.status, 200, "a truck named with a dollar sign: the reimbursement screen still opens");
        t.ok(!odd.text.includes("$") && odd.text.includes("5 Release Truck"), "...with the dollar sign taken out of the label");
      } finally {
        await c.db.resource.update({ where: { id: truck.id }, data: { name: truck.name } });
      }
    } else t.note("no Lobos truck on the copy - the renamed-truck step didn't run");
    t.status(await c.get(c.site(L.office, "/reimbursements"), null), 404, "an office link is refused");
    t.status(await c.get("/api/receipts", "MANAGER"), 200, "the Operations receipts list still loads");
  },
};
