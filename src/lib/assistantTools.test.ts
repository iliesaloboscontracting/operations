// What the Assistant's tools hand the model (lib/assistantTools.ts). PP-006 (3 Nov 2026): the projects list never
// carries the notes or contract value notes - free text that can hold rates and prices.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsForModel, projectsForModel, resourcesForModel, runTool, trackingForModel } from "./assistantTools";

test("get_projects: notes and contract value notes are dropped, everything else kept", () => {
  const reply = [
    { id: "p1", name: "Smith St", client: "CD", status: "ACTIVE", contractValue: 120000,
      notes: "Supplier rate agreed $1,234.50 per day", contractValueNotes: "Quote 26_117 $118,000 + variation", counts: { crew: 3 } },
    { id: "p2", name: "Shellharbour", status: "ACTIVE", regional: true, notes: null },
  ];
  const out = projectsForModel(reply) as Record<string, unknown>[];
  assert.equal(out.length, 2);
  for (const p of out) {
    assert.ok(!("notes" in p) && !("contractValueNotes" in p));
  }
  assert.deepEqual(out[0], { id: "p1", name: "Smith St", client: "CD", status: "ACTIVE", contractValue: 120000, counts: { crew: 3 } });
  assert.deepEqual(out[1], { id: "p2", name: "Shellharbour", status: "ACTIVE", regional: true });
  const text = JSON.stringify(out);
  assert.ok(!/\$\s?\d/.test(text) && !text.includes("Supplier rate"));
  // The route's own reply is not changed (the page still needs the notes).
  assert.equal(reply[0].notes, "Supplier rate agreed $1,234.50 per day");
});

test("get_tracking_summary: notes and rates are dropped, totals, contract value and health kept (PP-007)", () => {
  const reply = {
    projects: [{
      id: "p1", name: "Smith St", contractValue: 120000, contractValueNotes: "Quote $118,000", totalCost: 54321.5, forecastCost: 60000, health: "OK",
      invoiced: [{ id: "i1", vendor: "Coates", amountExGst: 2500, notes: "Agreed $410/day" }],
      labour: [{ id: "l1", personName: "Sam", hours: 8, rateTier: "ORD", rateUsed: 48.5, cost: 388, notes: "Rate $48.50 confirmed" }],
      hireLabourEstimate: [{ id: "h1", personName: "Joe", hours: 8, rateUsed: 62, cost: 496 }],
      hireItems: [{ id: "r1", name: "20t excavator", supplier: "Coates", dayRate: 1234.5, daysToDate: 4, costToDate: 4938 }],
    }],
    idleHire: { totalIdleCost: 820, items: [{ id: "r2", name: "Skid steer", idleDays: 2, rateUsed: 410, idleCost: 820 }] },
    attention: [{ level: "WATCH", text: "Smith St at 82% of contract value" }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = trackingForModel(reply) as { projects: any[]; idleHire: unknown; attention: unknown };
  const p = out.projects[0];
  assert.ok(!Object.hasOwn(p, "contractValueNotes"));
  assert.equal(p.contractValue, 120000);
  assert.equal(p.totalCost, 54321.5);
  assert.equal(p.health, "OK");
  assert.deepEqual(p.invoiced[0], { id: "i1", vendor: "Coates", amountExGst: 2500 });
  assert.deepEqual(p.labour[0], { id: "l1", personName: "Sam", hours: 8, rateTier: "ORD", cost: 388 });
  assert.deepEqual(p.hireLabourEstimate[0], { id: "h1", personName: "Joe", hours: 8, cost: 496 });
  assert.deepEqual(p.hireItems[0], { id: "r1", name: "20t excavator", supplier: "Coates", daysToDate: 4, costToDate: 4938 });
  assert.deepEqual(out.idleHire, { totalIdleCost: 820, items: [{ id: "r2", name: "Skid steer", idleDays: 2, idleCost: 820 }] });
  assert.deepEqual(out.attention, reply.attention);
  const text = JSON.stringify(out);
  for (const s of ["118,000", "410", "48.5", "1234.5", "rateUsed", "dayRate", "notes"]) assert.ok(!text.includes(s), s);
  // The route's own reply is not changed (the Tracking page still needs it).
  assert.equal(reply.projects[0].hireItems[0].dayRate, 1234.5);
});

test("get_tracking_summary: an unexpected reply fails closed", () => {
  assert.deepEqual(trackingForModel({ rows: [] }), { error: "Unexpected reply" });
  assert.deepEqual(trackingForModel(null), { error: "Unexpected reply" });
  assert.deepEqual(trackingForModel([]), { error: "Unexpected reply" });
});

// An Admin caller's register row: pay, day and hire rates, delivery / collection costs and notes all present.
const adminRow = () => ({
  id: "r1", name: "Sam Lee", type: "PERSONNEL", status: "ON_SITE", role: "Operator", agency: null, onHireDate: null,
  payRateBasis: "HOURLY", ordinaryRate: 48.5, nightRate: 60, travelRate: 52, regionalDayRate: 55, regionalNightRate: 66,
  saturdayRate: 70, sundayRate: 90, annualSalary: null, payRateConfirmed: true, payRateNotes: "Agreed $48.50", engagement: "ABN",
  dailyRateExGst: 1234.5, rate: "$410/day", hireRate: 410, hireRateUnit: "DAY", hireDeliveryCost: 150, hireCollectionCost: 175,
  notes: "Rate $410 per day confirmed by Coates",
});
const MONEY_KEYS = ["payRateBasis", "ordinaryRate", "nightRate", "travelRate", "regionalDayRate", "regionalNightRate", "saturdayRate",
  "sundayRate", "annualSalary", "payRateConfirmed", "payRateNotes", "engagement", "dailyRateExGst", "rate", "hireRate",
  "hireRateUnit", "hireDeliveryCost", "hireCollectionCost", "notes"];

test("get_resources: every rate, pay field and note is dropped, whoever asked (PP-008)", () => {
  const reply: Record<string, unknown>[] = [adminRow(), { id: "r2", name: "20t excavator", type: "HIRE", status: "AVAILABLE", agency: "Coates", onHireDate: "2026-11-01", hireRate: 900 }];
  const out = resourcesForModel(reply) as Record<string, unknown>[];
  for (const r of out) for (const k of MONEY_KEYS) assert.ok(!Object.hasOwn(r, k), k);
  assert.deepEqual(out[0], { id: "r1", name: "Sam Lee", type: "PERSONNEL", status: "ON_SITE", role: "Operator", agency: null, onHireDate: null });
  assert.deepEqual(out[1], { id: "r2", name: "20t excavator", type: "HIRE", status: "AVAILABLE", agency: "Coates", onHireDate: "2026-11-01" });
  const text = JSON.stringify(out);
  for (const s of ["48.5", "410", "1234.5", "150", "175", "$"]) assert.ok(!text.includes(s), s);
  // The route's own reply is not changed (the register page still needs it).
  assert.equal(reply[0].ordinaryRate, 48.5);
  assert.equal(reply[0].notes, "Rate $410 per day confirmed by Coates");
});

test("get_jobs: each assignment's resource loses its rates and notes, the job and crew stay (PP-008)", () => {
  const reply = [{
    id: "j1", title: "Smith St", shift: "DAY", startTime: "7am", dayBrief: "Strip out level 2",
    assignments: [{ id: "a1", role: "Operator", signedInAs: null, resource: adminRow() }],
  }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = jobsForModel(reply) as any[];
  assert.equal(out[0].title, "Smith St");
  assert.equal(out[0].dayBrief, "Strip out level 2");
  assert.equal(out[0].assignments[0].role, "Operator");
  const r = out[0].assignments[0].resource;
  for (const k of MONEY_KEYS) assert.ok(!Object.hasOwn(r, k), k);
  assert.equal(r.name, "Sam Lee");
  assert.ok(!JSON.stringify(out).includes("$"));
  assert.equal(reply[0].assignments[0].resource.dailyRateExGst, 1234.5);
});

test("get_jobs / get_resources: an unexpected reply fails closed (PP-008)", () => {
  for (const f of [jobsForModel, resourcesForModel]) {
    assert.deepEqual(f({ jobs: [] }), { error: "Unexpected reply" });
    assert.deepEqual(f(null), { error: "Unexpected reply" });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(!Object.hasOwn((jobsForModel([{ id: "j1", assignments: { resource: adminRow() } }]) as any[])[0], "assignments"));
});

test("get_resources / get_jobs: amounts typed into free text are taken out, the words, ids and dates stay (PP-009)", () => {
  const hire = {
    id: "cmh1abc", name: "20t excavator", type: "HIRE", agency: "Hire Express", onHireDate: "2026-11-01", offHireDate: "2026-11-14",
    hireSource: "Email: Hire Express 16 Oct, quoted $450/day", hireRef: "HX-2231 $1,200 deposit", hireStart: "22 Sept",
    hireEnd: "Fri, $90 pick-up", detail: "with operator $95/hr",
  };
  const r = (resourcesForModel([hire]) as Record<string, unknown>[])[0];
  for (const s of ["$", "450", "1,200", "90 pick", "95"]) assert.ok(!JSON.stringify(r).includes(s), s);
  assert.equal(r.id, "cmh1abc");
  assert.equal(r.onHireDate, "2026-11-01");
  assert.equal(r.offHireDate, "2026-11-14");
  assert.equal(r.hireStart, "22 Sept");
  assert.equal(r.agency, "Hire Express");
  assert.ok(String(r.hireSource).startsWith("Email: Hire Express 16 Oct"));

  const jobs = [{
    id: "j1", title: "Smith St", date: "2026-11-03", startTime: "7am", dayBrief: "Strip out level 2, $300 tip at Kemps Creek",
    dateCheckNote: "Weekend - client paying $2k extra", assignments: [{ id: "a1", role: "Operator", resource: hire }],
  }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (jobsForModel(jobs) as any[])[0];
  for (const s of ["$", "300", "2k", "450"]) assert.ok(!JSON.stringify(j).includes(s), s);
  assert.equal(j.date, "2026-11-03");
  assert.equal(j.startTime, "7am");
  assert.ok(j.dayBrief.startsWith("Strip out level 2"));
  assert.equal(j.assignments[0].resource.id, "cmh1abc");
  // The route's own reply is not changed.
  assert.equal(jobs[0].dayBrief, "Strip out level 2, $300 tip at Kemps Creek");
});

test("names and addresses keep words like Grand and Pound, and only lose a $-led amount (PP-013)", () => {
  const jobs = [{
    id: "j1", title: "One Grand Plaza", client: "Pound & Co", siteAddress: "12 Grand Pde Brighton", siteCode: "24117",
    dayBrief: "12 grand of steel to go", assignments: [{ id: "a1", signedInAs: "Joe (Grand Labour)",
      resource: { id: "r1", name: "Hino 500 ($90/day)", agency: "$5 Labour", identifier: "XY12AB", detail: "3 grand bond" } }],
  }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = (jobsForModel(jobs) as any[])[0];
  assert.equal(j.title, "One Grand Plaza");
  assert.equal(j.client, "Pound & Co");
  assert.equal(j.siteAddress, "12 Grand Pde Brighton");
  assert.equal(j.siteCode, "24117");
  assert.equal(j.assignments[0].signedInAs, "Joe (Grand Labour)");
  const r = j.assignments[0].resource;
  assert.equal(r.name, "Hino 500");
  assert.equal(r.agency, "Labour");
  assert.equal(r.identifier, "XY12AB");
  // Free text still loses every amount, "grand" included.
  assert.ok(!/12 grand/i.test(j.dayBrief) && !/3 grand/i.test(r.detail));
  assert.ok(!JSON.stringify(j).includes("$"));
  // A name that is only an amount becomes the tag, never an empty string.
  assert.equal((resourcesForModel([{ id: "r2", name: "$450" }]) as Record<string, unknown>[])[0].name, "(amount not recorded)");
});

test("list entries that aren't records still lose their amounts (PP-011)", () => {
  assert.deepEqual(resourcesForModel(["Hire at $450/day", 7, null]), ["Hire at (amount not recorded)", 7, null]);
  assert.deepEqual(jobsForModel(["Tip $300"]), ["Tip (amount not recorded)"]);
});

test("runTool: a built-in name is an unknown tool, and nothing is fetched (PP-014)", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("no fetch"); }) as typeof fetch;
  try {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      assert.deepEqual(await runTool(name, {}, "http://127.0.0.1:3000", null), { ok: false, data: { error: `Unknown tool: ${name}` } });
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = real;
  }
});

test("get_projects: anything that isn't a list passes through untouched", () => {
  const err = { error: "Forbidden" };
  assert.equal(projectsForModel(err), err);
  assert.equal(projectsForModel(null), null);
});
