// Accounts -> Accounts data (was xacheck.mjs): accounts read the Xero status but can't connect or disconnect; no
// token or secret in replies; Managers / Directors refused. The copy has no Xero keys, so nothing calls out.
export default {
  id: "accounts-xero", title: "Accounts data (Xero): accounts read-only, connect/disconnect owner-only",
  async run(t, c) {
    const s = await c.text("/api/accounts/xero", "ACCOUNTS");
    t.status(s.status, 200, "accounts read the Xero status");
    t.ok(/"canConnect":false/.test(s.text) && !/token|secret/i.test(s.text.replace(/"canConnect"/g, "")), "accounts can't connect; no token or secret in the reply");
    for (const [w, key, want] of [["manager", "MANAGER", 403], ["director", "DIRECTOR", 403], ["no login", null, 401]])
      t.status(await c.get("/api/accounts/xero", key), want, `Xero status as ${w}`);
    const sync = await c.post("/api/accounts/xero/sync", "ACCOUNTS");
    t.ok(sync.status !== 401 && sync.status !== 403, "accounts may press Refresh (copy has no keys - not connected)", sync.status);
    t.status(await c.post("/api/accounts/xero/sync", "MANAGER"), 403, "a Manager can't refresh");
    t.status(await c.get("/api/xero/review", "ACCOUNTS"), 200, "accounts read the 'not tied to a job' list");
    const pg = await c.text("/accounts/xero", "ACCOUNTS");
    t.ok(pg.status === 200 && !/Application error/.test(pg.text), "page /accounts/xero", pg.status);
    t.status(await c.post("/api/directors/xero/disconnect", "ACCOUNTS"), [403, 404, 405], "accounts can't disconnect");
    t.status(await c.post("/api/directors/xero/disconnect", "ADMIN"), [403, 404, 405], "a non-owner Admin can't disconnect");
  },
};
