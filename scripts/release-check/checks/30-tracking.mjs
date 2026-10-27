// Every project's cost adds up (was trackcheck.mjs): daily = categories = locked + estimated + invoiced = total.
// Prints counts only - never a project's figures.
export default {
  id: "tracking-integrity", title: "Tracking: every project's cost adds up",
  async run(t, c) {
    const r = await c.json("/api/tracking", "MANAGER");
    if (!t.status(r.status, 200, "GET /api/tracking")) return;
    const projects = r.body.projects ?? [];
    if (!projects.length) return t.block("no projects on the snapshot");
    const bad = [];
    const near = (a, b) => Math.abs(a - b) < 0.05;
    for (const p of projects) {
      const dsum = p.daily.reduce((n, d) => n + d.locked + d.estimated + d.invoiced, 0);
      const csum = p.daily.reduce((n, d) => n + Object.values(d.cat).reduce((a, b) => a + b, 0), 0);
      const split = p.lockedCost + p.estimatedTotal + p.invoicedTotal;
      const inv = p.daily.reduce((n, d) => n + d.invoiced, 0);
      if (!(near(dsum, p.totalCost) && near(csum, p.totalCost) && near(split, p.totalCost) && near(p.invoicedTotal, inv))) bad.push(p.id);
      if (!(Number.isFinite(p.forecastCost) && p.forecastCost + 0.05 >= p.totalCost)) bad.push(`${p.id} (forecast < spent)`);
    }
    t.ok(bad.length === 0, `all ${projects.length} projects add up; forecast >= spent`, `mismatch: ${bad.join(", ")}`);
    t.ok(Array.isArray(r.body.attention), "attention list present");
  },
};
