// Asset expiry dates for Managers (was d4check.mjs): six fields only, no files / notes / money.
export default {
  id: "asset-dates", title: "Asset dates: Managers get six fields only",
  async run(t, c) {
    const r = await c.text("/api/assets/dates", "MANAGER");
    if (!t.status(r.status, 200, "Manager reads asset dates")) return;
    const keys = new Set();
    for (const list of Object.values(JSON.parse(r.text).dates ?? {})) for (const d of list) Object.keys(d).forEach((k) => keys.add(k));
    t.ok([...keys].every((k) => ["kind", "label", "issuer", "reference", "expiryDate", "state"].includes(k)), "only the six fields", [...keys].join(","));
    t.ok(!/\$\s?\d|fileName|notes|amount/i.test(r.text), "no files, notes or money");
    for (const [who, key, want] of [["accounts", "ACCOUNTS", 403], ["director", "DIRECTOR", 403], ["no login", null, 401]])
      t.status(await c.get("/api/assets/dates", key), want, `asset dates as ${who}`);
    for (const p of ["/vehicles", "/plant"]) { const pr = await c.text(p, "MANAGER"); t.ok(pr.status === 200 && !/Application error/.test(pr.text), `page ${p}`, pr.status); }
  },
};
