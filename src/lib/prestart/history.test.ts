// A machine's checks & service history (12 Nov 2026): the DTO builders and the view limits. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNoMoney } from "../moneyGuard";
import { buildHistory, checkRow, checksCsv, noAmounts, pdfText, parseDays, parseWhat, serviceCsv, serviceRow, MAX_CHECKS, type RawCheck } from "./history";
import { badCode, ipGate, oneDownload, resetForTests, take, viewGate, VIEW_LIMITS } from "./viewLimit";

const NOW = new Date("2026-11-12T01:00:00Z"); // 12 Nov, 12pm Sydney
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const answers = (fail: string[] = []) => JSON.stringify([
  { key: "hoses", label: "Hoses & hydraulics", answer: fail.includes("hoses") ? "FAULT" : "OK" },
  { key: "tracks", label: "Tracks / tyres", answer: fail.includes("tracks") ? "FAULT" : "OK" },
  { key: "hitch", label: "Quick hitch", answer: "NA" },
]);
const check = (over: Partial<RawCheck> = {}): RawCheck => ({
  id: "c1", resourceId: "M1", kind: "PRE", createdAt: ago(1), personName: "Sam Operator", sessionId: "s1",
  hourMeter: 1000, hourMeterFlag: null, hourMeterWrongAt: null, answers: answers(), walkaround: "DONE", seenCount: 0, faults: [], ...over,
});
const base = (over: Record<string, unknown> = {}) => ({
  machineId: "M1", machineName: "Kubota KX040", status: "AVAILABLE", serviceDue: null,
  checks: [check()], companies: new Map<string, string | null>(), services: [], docs: [], faults: [], days: 90 as const, now: NOW, ...over,
});

test("no money - even when a service record holds amounts in its money fields and in its words", () => {
  const moneyService = {
    resourceId: "M1", date: "2026-10-01", odometer: 3100,
    work: "Full service 250hr - parts $450.00, labour 3 hrs @ 120 = 360.00, total 1,250.00 inc GST. Replaced filters",
    mechanic: "$5 Mechanics Pty Ltd",
    // What a spread row would carry - the builder must never read these.
    amountExGst: 1136.36, gst: 113.64, total: 1250, invoiceNo: "INV-7781", notes: "Paid $1,250 by card",
  };
  const h = buildHistory(base({
    services: [moneyService],
    faults: [{ resourceId: "M1", itemLabel: "Hoses", description: "Hose split - quote $380 to fix", priority: "URGENT", status: "OPEN", reportedAt: ago(2) }],
    checks: [check({ faults: [{ itemLabel: "Hoses", description: "Leak, about 50 dollars of oil lost", priority: "HIGH", status: "OPEN" }], answers: answers(["hoses"]) })],
  }));
  const json = JSON.stringify(h);
  assert.ok(assertNoMoney(json), json);
  for (const bad of ["$", "450", "360", "1,250", "1250", "1136", "113.64", "INV-7781", "Paid", "380", "amountExGst", "invoiceNo", "\"total\"", "notes"]) assert.ok(!json.includes(bad), `"${bad}" leaked: ${json}`);
  assert.equal(h.service.records.length, 1);
  assert.deepEqual(Object.keys(h.service.records[0]).sort(), ["date", "provider", "reading", "work"]);
  assert.match(h.service.records[0].work ?? "", /Full service 250hr/);
  assert.match(h.service.records[0].work ?? "", /Replaced filters/);
  assert.equal(h.service.records[0].provider, "Mechanics Pty Ltd");
  assert.equal(h.service.records[0].reading, 3100);
  assert.ok(assertNoMoney(checksCsv(h)) && assertNoMoney(serviceCsv(h)));
  assert.ok(!serviceCsv(h).includes("1,250") && !serviceCsv(h).includes("INV-7781"));
});

test("noAmounts: words stay, amounts go (with or without a $)", () => {
  assert.equal(noAmounts("Replaced hydraulic hose"), "Replaced hydraulic hose");
  assert.equal(noAmounts("250 hour service"), "250 hour service");
  assert.equal(noAmounts(null), null);
  assert.equal(noAmounts("$450"), null);
  for (const s of ["Oil change 89.95", "Total: 1,250", "labour @ 95/hr", "Parts ＄300", "AUD 400 for tyres", "five hundred dollars", "Service 1,250.00 inc GST", "Cost 600"]) {
    const out = noAmounts(s) ?? "";
    assert.ok(!/\d/.test(out), `${s} -> ${out}`);
    assert.ok(assertNoMoney(out) && !/dollar/i.test(out), `${s} -> ${out}`);
  }
  assert.equal(noAmounts("Oil change 89.95"), "Oil change");
  assert.equal(noAmounts("Next at 1,250 hrs"), "Next at 1,250 hrs", "an hours reading stays");
  assert.equal(noAmounts("Odometer 12,400 km"), "Odometer 12,400 km");
  assert.equal(noAmounts("Next at 1,250 hrs, cost 1,250"), "Next at 1,250 hrs");
});

test("only this machine - every list filtered by the machine, whatever came in", () => {
  const h = buildHistory(base({
    checks: [check(), check({ id: "other", resourceId: "M2", personName: "Someone Else" })],
    services: [{ resourceId: "M1", date: "2026-09-01", work: "Ours", mechanic: null, odometer: null }, { resourceId: "M2", date: "2026-09-02", work: "Theirs", mechanic: null, odometer: null }],
    docs: [{ resourceId: "M1", kind: "SERVICE_DUE", status: "ACTIVE", expiryDate: "2026-12-01" }, { resourceId: "M2", kind: "SERVICE_DUE", status: "ACTIVE", expiryDate: "2026-11-15" }],
    faults: [{ resourceId: "M2", itemLabel: "X", description: "Other machine's fault", priority: "DO_NOT_USE", status: "OPEN", reportedAt: ago(1) }],
  }));
  assert.deepEqual(h.checks.map((c) => c.id), ["c1"]);
  assert.deepEqual(h.service.records.map((r) => r.work), ["Ours"]);
  assert.equal(h.service.nextDue?.expiryDate, "2026-12-01");
  assert.equal(h.service.openFaults.length, 0);
  assert.equal(h.doNotUse, false, "another machine's Do-not-use fault doesn't mark this one");
  assert.ok(!JSON.stringify(h).includes("Someone Else") && !JSON.stringify(h).includes("Theirs"));
});

test("the 90-day window (and 7 / 30), newest first, at most MAX_CHECKS", () => {
  const checks = [check({ id: "d1", createdAt: ago(1) }), check({ id: "d8", createdAt: ago(8) }), check({ id: "d89", createdAt: ago(89) }), check({ id: "d91", createdAt: ago(91) })];
  assert.deepEqual(buildHistory(base({ checks })).checks.map((c) => c.id), ["d1", "d8", "d89"]);
  assert.deepEqual(buildHistory(base({ checks, days: 30 })).checks.map((c) => c.id), ["d1", "d8"]);
  assert.deepEqual(buildHistory(base({ checks, days: 7 })).checks.map((c) => c.id), ["d1"]);
  const many = Array.from({ length: MAX_CHECKS + 5 }, (_, i) => check({ id: `m${i}`, createdAt: new Date(NOW.getTime() - i * 60_000) }));
  const h = buildHistory(base({ checks: many }));
  assert.equal(h.checks.length, MAX_CHECKS);
  assert.equal(h.truncated, true);
  assert.equal(h.checks[0].id, "m0");
  assert.equal(parseDays("7"), 7); assert.equal(parseDays("30"), 30); assert.equal(parseDays("365"), 90); assert.equal(parseDays(null), 90);
  assert.equal(parseWhat("service"), "service"); assert.equal(parseWhat("anything"), "checks");
});

test("a check row: when, who, hours, the checklist result with item names, faults with priority and status", () => {
  const r = checkRow(check({
    kind: "POST", createdAt: new Date("2026-11-11T20:15:00Z"), hourMeterFlag: "LOWER", answers: answers(["hoses", "tracks"]),
    faults: [{ itemLabel: "Hoses & hydraulics", description: "Split hose", priority: "DO_NOT_USE", status: "IN_HAND" }], seenCount: 2,
  }), "Coates Hire");
  assert.equal(r.date, "2026-11-12"); // Sydney day
  assert.match(r.time, /7:15/);
  assert.equal(r.kindLabel, "End of shift");
  assert.equal(r.operator, "Sam Operator (Coates Hire)");
  assert.equal(r.hourMeterNote, "Lower than the last reading");
  assert.equal(r.allOk, false);
  assert.deepEqual(r.failed, ["Hoses & hydraulics", "Tracks / tyres"]);
  assert.equal(r.notApplicable, 1);
  assert.deepEqual(r.faults, [{ item: "Hoses & hydraulics", description: "Split hose", priority: "DO_NOT_USE", priorityLabel: "Do not use", status: "IN_HAND", statusLabel: "In hand" }]);
  assert.equal(r.stillThere, 2);
  assert.equal(checkRow(check({ hourMeterWrongAt: NOW }), null).hourMeterNote, "Marked wrong by the office");
  assert.equal(checkRow(check(), null).allOk, true);
  // No device id, session id or person id on a row.
  assert.deepEqual(Object.keys(r).sort(), ["allOk", "date", "failed", "faults", "hourMeter", "hourMeterNote", "id", "kind", "kindLabel", "notApplicable", "operator", "stillThere", "time", "walkaround"]);
});

test("Down / Do not use, the dates and open faults, worst first", () => {
  const h = buildHistory(base({
    status: "DOWN",
    docs: [
      { resourceId: "M1", kind: "SERVICE_DUE", status: "ACTIVE", expiryDate: "2026-11-01" },
      { resourceId: "M1", kind: "ASSET_INSURANCE", status: "ACTIVE", expiryDate: "2027-03-01" },
      { resourceId: "M1", kind: "SERVICE_DUE", status: "ARCHIVED", expiryDate: "2025-01-01" },
    ],
    faults: [
      { resourceId: "M1", itemLabel: "Lights", description: "Beacon out", priority: "LOW", status: "OPEN", reportedAt: ago(3) },
      { resourceId: "M1", itemLabel: "Hoses", description: "Burst", priority: "DO_NOT_USE", status: "OPEN", reportedAt: ago(5) },
      { resourceId: "M1", itemLabel: "Seat", description: "Fixed already", priority: "HIGH", status: "FIXED", reportedAt: ago(4) },
    ],
  }));
  assert.equal(h.down, true);
  assert.equal(h.doNotUse, true);
  assert.equal(h.service.nextDue?.expiryDate, "2026-11-01");
  assert.equal(h.service.nextDue?.state, "EXPIRED");
  assert.ok(h.service.dates.some((d) => d.label === "Insurance" && d.expiryDate === "2027-03-01"));
  assert.ok(!h.service.dates.some((d) => d.label === "Rego"), "plant has no rego line unless one is recorded");
  assert.deepEqual(h.service.openFaults.map((f) => f.priority), ["DO_NOT_USE", "LOW"]);
  assert.equal(buildHistory(base({ faults: [{ resourceId: "M1", itemLabel: "Hoses", description: "Burst", priority: "DO_NOT_USE", status: "IN_HAND", reportedAt: ago(1) }] })).doNotUse, true);
});

test("CSV: formula cells escaped, the header and the machine", () => {
  const h = buildHistory(base({ checks: [check({ personName: "=HYPERLINK(\"http://x\",\"y\")" }), check({ id: "c2", personName: "+SUM(A1)", faults: [{ itemLabel: "@cmd", description: "-2 bad", priority: "LOW", status: "OPEN" }] })] }));
  const csv = checksCsv(h);
  assert.match(csv, /^Lobos Contracting – pre-start records/);
  assert.match(csv, /Kubota KX040/);
  for (const line of csv.split("\r\n")) for (const cell of line.split(",")) assert.ok(!/^[=+\-@]/.test(cell), `unescaped cell: ${cell}`);
  assert.match(csv, /"'=HYPERLINK/);
  assert.match(csv, /"'\+SUM/);
  assert.match(serviceRow({ resourceId: "M1", date: "2026-01-02", work: "=cmd()", mechanic: null, odometer: null }).work ?? "", /=cmd/);
  assert.match(serviceCsv(buildHistory(base({ services: [{ resourceId: "M1", date: "2026-01-02", work: "=cmd()", mechanic: null, odometer: null }] }))), /"'=cmd"/);
});

test("view limits: per QR, per address, bad codes, one download at a time", async () => {
  resetForTests();
  const t0 = 1_000_000;
  for (let i = 0; i < VIEW_LIMITS.viewsPerQr; i++) assert.equal(viewGate("L1", t0 + i), null);
  assert.equal(viewGate("L1", t0 + 100)?.status, 429, "the 61st look in 10 minutes");
  assert.equal(viewGate("L2", t0 + 100), null, "another QR is unaffected");
  assert.equal(viewGate("L1", t0 + VIEW_LIMITS.windowMs + 1000), null, "the window passes");
  for (let i = 0; i < VIEW_LIMITS.badPerIp; i++) { assert.equal(ipGate("1.2.3.4", t0 + i), null); badCode("1.2.3.4", t0 + i); }
  assert.equal(ipGate("1.2.3.4", t0 + 50)?.status, 429, "20 bad codes from one address -> 429");
  assert.equal(ipGate("5.6.7.8", t0 + 50), null);
  assert.equal(take("k", 2, 1000, 0), true); assert.equal(take("k", 2, 1000, 1), true); assert.equal(take("k", 2, 1000, 2), false);
  let release!: () => void;
  const first = oneDownload("L9", () => new Promise<string>((r) => { release = () => r("done"); }));
  const second = await oneDownload("L9", async () => "x");
  assert.deepEqual(second, { error: "A download is already being made - wait for it to finish.", status: 429 });
  release();
  assert.equal(await first, "done");
  assert.equal(await oneDownload("L9", async () => "again"), "again");
  resetForTests();
});

test("pdfText keeps Windows-1252 text and drops what the PDF's Helvetica can't print", () => {
  assert.equal(pdfText("Lobos Contracting – pre-start records"), "Lobos Contracting – pre-start records");
  assert.equal(pdfText("Hose \u{1F525} split → fix"), "Hose  split -> fix");
  assert.equal(pdfText("Café Müller"), "Café Müller");
});
