// Accounts stage 6 (was s6check.mjs): the purchase chain behind the money wall - asked on an OFFICE link, priced by
// accounts, approved by a DIRECTOR; the amount never reaches the link or a Manager. Assets screen access.
// WRITES one synthetic purchase request.
export default {
  id: "purchases-s6", title: "Purchases & assets: money wall across link, Manager, accounts, Director",
  writes: true,
  async run(t, c) {
    const L = c.links;
    if (!L.office || !L.sup) return t.block(L.missing.join("; "));
    const AMOUNT = 4321.98, WHAT = `Release check - 2 jackhammers ${Date.now() % 100000}`;
    t.status(await c.post(c.site(L.office, "/purchases"), null, { what: "Release check $500" }), 400, "a $ figure in the link request is refused");
    t.status(await c.post(c.site(L.office, "/purchases"), null, { what: WHAT, why: "release check", qty: "2" }), [200, 201], "request sent from the office link");
    t.status(await c.get(c.site(L.sup, "/purchases"), null), 404, "a supervisor link can't use purchases");
    const list = (await c.json("/api/accounts/purchases", "ACCOUNTS")).body;
    const all = Object.values(list ?? {}).flat().filter((r) => r && typeof r === "object");
    const row = all.find((r) => r.what === WHAT);
    if (!t.ok(!!row, "accounts see the request")) return;
    t.status(await c.post(`/api/accounts/purchases/${row.id}`, "ACCOUNTS", { action: "CHECK", amountExGst: AMOUNT, accountsNote: "rc note", version: row.version }), 200, "accounts check it with the amount");
    t.status(await c.post(`/api/accounts/purchases/${row.id}`, "MANAGER", { action: "CHECK", amountExGst: 1 }), 403, "a Manager can't check");
    const linkView = (await c.text(c.site(L.office, "/purchases"), null)).text;
    t.ok(linkView.includes(WHAT) && !linkView.includes(String(AMOUNT)) && !/rc note|amountExGst/.test(linkView), "the link shows the request without the amount or accounts' note");
    const mgrView = (await c.text("/api/purchases", "MANAGER")).text;
    t.ok(!mgrView.includes(String(AMOUNT)) && !/amountExGst|accountsNote/.test(mgrView), "a Manager never sees the amount");
    const dirList = (await c.json("/api/directors/purchases", "DIRECTOR")).body;
    t.ok(JSON.stringify(dirList).includes(String(AMOUNT)), "the director sees the amount to approve");
    const drow = Object.values(dirList ?? {}).flat().find((r) => r?.id === row.id) ?? {};
    t.status(await c.post(`/api/directors/purchases/${row.id}`, "DIRECTOR", { action: "APPROVE", note: "ok up to $5000", version: drow.version }), 400, "a director note with $ is refused");
    t.status(await c.post(`/api/directors/purchases/${row.id}`, "DIRECTOR", { action: "APPROVE", note: "Go ahead", version: drow.version }), 200, "the director approves");
    t.status(await c.post(`/api/directors/purchases/${row.id}`, "MANAGER", { action: "APPROVE" }), 403, "a Manager can't approve");
    const after = (await c.text(c.site(L.office, "/purchases"), null)).text;
    t.ok(/APPROVED|Approved/.test(after) && !after.includes(String(AMOUNT)), "the link shows it approved, still no amount");
    t.status(await c.get("/api/accounts/assets", "ACCOUNTS"), 200, "assets as accounts");
    t.status(await c.get("/api/accounts/assets", "MANAGER"), 403, "assets as manager");
    for (const p of ["/accounts/assets", "/accounts/purchases"]) { const r = await c.text(p, "ACCOUNTS"); t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${p}`, r.status); }
    t.status(await c.get("/directors/purchases", "DIRECTOR"), 200, "page /directors/purchases as director");
  },
};
