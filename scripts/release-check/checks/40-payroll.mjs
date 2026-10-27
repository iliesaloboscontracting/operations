// Accounts stage 2, payroll (was payrollcheck.mjs): access, CSVs hold hours only, GPS and engagement stay hidden from
// Managers, supervisor hours on their own link only.
import { noMoney } from "../lib/context.mjs";

export default {
  id: "payroll", title: "Payroll: access, hours-only exports, GPS hidden, supervisor hours",
  async run(t, c) {
    const week = c.lastWeek;
    for (const [who, key, want] of [["accounts", "ACCOUNTS", 200], ["manager", "MANAGER", 403], ["no login", null, 401]]) {
      t.status(await c.get(`/api/accounts/payroll?week=${week}`, key), want, `payroll API as ${who}`);
      t.status(await c.get(`/api/accounts/payroll/export?week=${week}&file=payrun`, key), want, `pay-run export as ${who}`);
    }
    const page = await c.text("/accounts/payroll", "ACCOUNTS");
    t.ok(page.status === 200 && !/Application error/.test(page.text), "page /accounts/payroll as accounts", page.status);
    for (const f of ["payrun", "summary"]) {
      const txt = (await c.text(`/api/accounts/payroll/export?week=${week}&file=${f}`, "ACCOUNTS")).text;
      const [head, ...rows] = txt.split("\n");
      t.ok(!/\$\s?\d|\bBSB\b|\bTFN\b|\bABA\b|rate/i.test(rows.join("\n")) && !/rate\b/i.test(head.replace("Earnings Rate", "")), `${f} CSV has no money / bank / TFN`);
      t.note(`${f} CSV: ${Math.max(rows.filter(Boolean).length, 0)} rows`);
    }
    for (const a of [`/api/attendance?date=${c.today}`, `/api/timesheets?week=${week}`, `/api/day-review?date=${c.today}`, "/api/resources"])
      t.ok(!/gpsLat|gpsLng|gpsAccuracy/.test((await c.text(a, "MANAGER")).text), `no GPS in ${a.split("?")[0]} (Manager)`);
    t.ok(!/"engagement"/.test((await c.text("/api/resources", "MANAGER")).text), "no engagement (pay field) in /api/resources for a Manager");
    const L = c.links;
    if (!L.sup || !L.office) return t.block(L.missing.join("; "));
    const h = await c.json(c.site(L.sup, `/hours?date=${c.today}`), null);
    t.ok(h.status === 200 && Array.isArray(h.body?.jobs), "supervisor hours screen on their link", h.status);
    t.ok(noMoney(JSON.stringify(h.body)) && !/gps/i.test(JSON.stringify(h.body)), "supervisor hours: no money, no GPS");
    t.status(await c.get(c.site(L.office, `/hours?date=${c.today}`), null), 403, "an office link can't approve hours");
    t.status(await c.get("/timesheets", "MANAGER"), 200, "page /timesheets as Manager");
  },
};
