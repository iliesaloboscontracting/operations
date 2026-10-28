// Accounts stage 6 (was s6check.mjs): the purchase chain behind the money wall - asked on an OFFICE link, approved by
// a DIRECTOR (since 28 Oct 2026 straight to the approvers - accounts no longer check first), then ordered by accounts
// with an optional price; the amount never reaches the link or a Manager. Assets screen access.
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
    const dirList = (await c.json("/api/directors/purchases", "DIRECTOR")).body;
    const drow = Object.values(dirList ?? {}).flat().find((r) => r?.what === WHAT);
    if (!t.ok(!!drow, "the request goes straight to the directors")) return;
    const id = drow.id;
    const before = (await c.json("/api/accounts/purchases", "ACCOUNTS")).body;
    t.ok(!(before?.toOrder ?? []).some((r) => r.id === id), "accounts don't see it to order before it's approved");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "ACCOUNTS", { action: "CHECK", amountExGst: AMOUNT }), 400, "accounts can't check it any more");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "ACCOUNTS", { action: "APPROVE" }), 400, "accounts can't approve");
    t.status(await c.post(`/api/directors/purchases/${id}`, "MANAGER", { action: "APPROVE" }), 403, "a Manager can't approve");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", note: "ok up to $5000", version: drow.version }), 400, "a director note with $ is refused");
    t.status(await c.post(`/api/directors/purchases/${id}`, "DIRECTOR", { action: "APPROVE", note: "Go ahead", version: drow.version }), 200, "the director approves");
    const list = (await c.json("/api/accounts/purchases", "ACCOUNTS")).body;
    const row = (list?.toOrder ?? []).find((r) => r.id === id);
    if (!t.ok(!!row, "accounts see it approved, to order")) return;
    t.status(await c.post(`/api/accounts/purchases/${id}`, "MANAGER", { action: "ORDERED" }), 403, "a Manager can't mark it ordered");
    t.status(await c.post(`/api/accounts/purchases/${id}`, "ACCOUNTS", { action: "ORDERED", amountExGst: AMOUNT, note: "rc note", version: row.version }), 200, "accounts order it with the price");
    const linkView = (await c.text(c.site(L.office, "/purchases"), null)).text;
    t.ok(linkView.includes(WHAT) && !linkView.includes(String(AMOUNT)) && !/amountExGst/.test(linkView), "the link shows the request without the amount");
    t.ok(/ORDERED|Ordered/.test(linkView), "the link shows it ordered");
    const mgrView = (await c.text("/api/purchases", "MANAGER")).text;
    t.ok(!mgrView.includes(String(AMOUNT)) && !/amountExGst|accountsNote/.test(mgrView), "a Manager never sees the amount");
    const dirAfter = (await c.json("/api/directors/purchases", "DIRECTOR")).body;
    t.ok(JSON.stringify(dirAfter).includes(String(AMOUNT)), "the director sees the price accounts added");
    t.status(await c.get("/api/accounts/assets", "ACCOUNTS"), 200, "assets as accounts");
    t.status(await c.get("/api/accounts/assets", "MANAGER"), 403, "assets as manager");
    for (const p of ["/accounts/assets", "/accounts/purchases"]) { const r = await c.text(p, "ACCOUNTS"); t.ok(r.status === 200 && !/Application error/.test(r.text), `page ${p}`, r.status); }
    t.status(await c.get("/directors/purchases", "DIRECTOR"), 200, "page /directors/purchases as director");
  },
};
