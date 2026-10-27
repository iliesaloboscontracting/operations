// Production benchmarks (was prodcheck.mjs + dpcheck.mjs): Manager page and API, offer refused, Directors read the
// same list, the /estimating proxy is Admin only. Hours only - no $.
import { noMoney } from "../lib/context.mjs";

export default {
  id: "production", title: "Production benchmarks: Operations + Directors views, hours only",
  async run(t, c) {
    const page = await c.text("/production", "MANAGER");
    t.ok(page.status === 200 && !/Application error|Unhandled Runtime Error/.test(page.text), "page /production as Manager", page.status);
    const r = await c.text("/api/production", "MANAGER");
    if (!t.status(r.status, 200, "GET /api/production as Manager")) return;
    const d = JSON.parse(r.text);
    t.ok(d.canOffer === false, "a Manager can't offer a benchmark");
    t.ok(noMoney(r.text), "no $ in /api/production");
    t.note(`${d.benchmarks?.length ?? 0} benchmark codes; estimatingDown=${d.estimatingDown} (expected on the copy)`);
    t.status(await c.post("/api/production/offer", "MANAGER", { code: "DEM-10", unit: "t" }), 403, "Manager offer refused");
    t.status(await c.get("/api/production", null), [401, 403], "no session refused");
    t.ok((await c.get("/estimating/api/production-suggestions", "MANAGER")).status !== 200, "a Manager can't reach /estimating");
    const dd = await c.text("/api/directors/production", "DIRECTOR");
    t.status(dd.status, 200, "Directors production as DIRECTOR");
    t.ok(!/canOffer|\$\s?\d/.test(dd.text), "Directors view: no offer flag, no $");
    t.ok(JSON.stringify(d.benchmarks) === JSON.stringify(JSON.parse(dd.text || "{}").benchmarks), "Directors see the same benchmarks as Operations");
    for (const [who, key, want] of [["manager", "MANAGER", 403], ["accounts", "ACCOUNTS", 403], ["no login", null, 401]])
      t.status(await c.get("/api/directors/production", key), want, `Directors production as ${who}`);
    t.status(await c.get("/api/production", "DIRECTOR"), 403, "a Director is refused the Operations production API");
    const dp = await c.text("/directors/production", "DIRECTOR");
    t.ok(dp.status === 200 && !/Application error/.test(dp.text), "page /directors/production", dp.status);
  },
};
