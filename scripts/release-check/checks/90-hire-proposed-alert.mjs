// Hire page "Coming off hire": once a new finish date is proposed it says so (16 Nov 2026, Ilies: "why when i proposed a
// new date in the hire tab did it not clear the notification"). Checks: the alert row carries the open proposal (number +
// date), the page shows "waiting for approval" instead of a second "Propose new date", no money on the alert.
// WRITES on the test copy: one hire item finishing in 2 days, one HIRE_OFF_HIRE_DATE proposal (withdrawn at the end).
import { readFileSync } from "node:fs";
import path from "node:path";
import { noMoney } from "../lib/context.mjs";

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export default {
  id: "hire-proposed-alert", title: "Hire: a proposed new finish date shows on the Coming off hire alert",
  writes: true, timeoutMs: 120_000,
  applies: (c) => c.hasPath("src/app/api/hire-alerts/route.ts") || "needs /api/hire-alerts",
  async run(t, c) {
    const db = c.db, tag = Date.now().toString(36);
    const first = await c.json("/api/hire-alerts", "MANAGER");
    if (first.status !== 200) return t.block(`/api/hire-alerts -> ${first.status}`);
    const today = first.body?.today;
    const item = await db.resource.create({ data: {
      name: `RC tipper ${tag}`, type: "HIRE", category: "PLANT", ownership: "HIRED", agency: "RC Hire Co", active: true,
      onHireDate: addDays(today, -5), offHireDate: addDays(today, 2), hireStatus: "BOOKED",
    } });
    const row = async () => ((await c.json("/api/hire-alerts", "MANAGER")).body?.alerts ?? []).find((a) => a.id === item.id);
    const r0 = await row();
    t.ok(!!r0 && r0.proposed === null, "the item is on the alert with nothing proposed yet", JSON.stringify(r0?.proposed));

    const want = addDays(today, 5);
    const pr = await c.post("/api/changes", "MANAGER", { kind: "HIRE_OFF_HIRE_DATE", recordId: item.id, offHireDate: want, reason: "Release check", sources: [{ type: "Other", label: "Release check" }] });
    t.ok(pr.status === 200 || pr.status === 201, "a Manager proposes a new finish date", pr.status);
    const prop = await db.changeProposal.findFirst({ where: { recordId: item.id, status: "PROPOSED" } });
    const r1 = await row();
    t.ok(r1?.proposed?.number === prop?.number && r1?.proposed?.offHireDate === want, "the alert now carries the open proposal and its date", JSON.stringify(r1?.proposed));
    t.ok(r1?.offHireDate === addDays(today, 2), "the finish date itself is unchanged until it's approved");
    t.ok(noMoney(JSON.stringify(r1 ?? {})), "no money on the alert row");
    const co = ((await c.json("/api/hire-alerts", "COORDINATOR")).body?.alerts ?? []).find((a) => a.id === item.id);
    t.ok(!!co?.proposed, "the coordinator sees it's waiting too");

    if (prop) await c.post(`/api/changes/${prop.id}`, "MANAGER", { action: "WITHDRAW", reason: "Release check tidy-up" });
    const r2 = await row();
    t.ok(r2?.proposed === null, "once withdrawn the alert offers Propose new date again", JSON.stringify(r2?.proposed));

    let page = "";
    try { page = readFileSync(path.join(c.p.appDir, "src", "app", "hire", "page.tsx"), "utf8"); } catch { /* missing */ }
    t.ok(page.includes("waiting for approval") && /a\.proposed \?/.test(page), "the page shows waiting for approval instead of a second Propose button");
    await db.resource.update({ where: { id: item.id }, data: { active: false } });
  },
};
