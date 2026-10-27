// Accounts stage 7, tax estimates (was s7check.mjs): accounts only, labelled an estimate, Tracking unchanged.
import { readdirSync } from "node:fs";
import path from "node:path";

export default {
  id: "accounts-tax", title: "Tax estimates: accounts only, labelled estimate, Tracking unchanged",
  async run(t, c) {
    const before = (await c.text("/api/tracking", "MANAGER")).text;
    const dir = path.join(c.p.appDir, "src", "app", "api", "accounts", "tax");
    let apis = [];
    try {
      apis = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith("route.ts") && !f.includes("["))
        .map((f) => "/api/accounts/tax" + ("/" + f.replace(/\\/g, "/")).replace(/\/?route\.ts$/, ""));
    } catch { return t.skip("no /api/accounts/tax in this candidate"); }
    for (const a of apis) {
      const sa = (await c.get(a, "ACCOUNTS")).status, sm = (await c.get(a, "MANAGER")).status, sd = (await c.get(a, "DIRECTOR")).status, sn = (await c.get(a, null)).status;
      t.ok(sa === 200 && sm === 403 && sd === 403 && sn === 401, `${a}: accounts 200, manager 403, director 403, none 401`, `${sa}/${sm}/${sd}/${sn}`);
    }
    t.ok(/estimate/i.test((await c.text("/api/accounts/tax", "ACCOUNTS")).text), "labelled as an estimate");
    const pg = await c.text("/accounts/tax", "ACCOUNTS");
    t.ok(pg.status === 200 && !/Application error/.test(pg.text), "page /accounts/tax", pg.status);
    t.status(await c.get("/api/directors/overview", "ADMIN"), 200, "Directors overview as an Admin with director access");
    t.ok(before === (await c.text("/api/tracking", "MANAGER")).text, "Tracking byte-for-byte unchanged");
  },
};
