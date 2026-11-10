// Keep forever (Ilies, 10 Nov 2026): the change history's plain parts and the filters that leave hidden / cancelled /
// retired / superseded records out of every list and total. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BLOB_NOTE, WITHHELD, diffFields, isHistoryModel, isNeverRecorded, valueText } from "./diff";
import { canReadHistory, resourceFieldVisible, visibleChanges } from "./access";
import { LIVE_JOB, isCancelledJob, CANCEL_REASONS } from "../jobs";
import { allocationSnapshot, cancelledJobSnapshot } from "../boardGuard/snapshot";

test("diffFields: only the fields that actually changed, as text", () => {
  const before = { id: "r1", name: "Excavator 5t", dailyRateExGst: 900, active: true, onHireDate: null, updatedAt: new Date("2026-11-01T00:00:00Z") };
  const after = { id: "r1", name: "Excavator 5t", dailyRateExGst: 950, active: false, onHireDate: "2026-11-10", updatedAt: new Date("2026-11-10T00:00:00Z") };
  assert.deepEqual(diffFields(before, after), [
    { field: "dailyRateExGst", before: "900", after: "950" },
    { field: "active", before: "true", after: "false" },
    { field: "onHireDate", before: null, after: "2026-11-10" },
  ]);
  // Limited to the fields the edit may touch: an unrelated column that differs isn't reported.
  assert.deepEqual(diffFields(before, after, ["name", "active"]), [{ field: "active", before: "true", after: "false" }]);
  // Nothing changed -> nothing written.
  assert.deepEqual(diffFields(before, { ...before }), []);
  // A field missing from the row after is not a change.
  assert.deepEqual(diffFields({ a: 1 }, {}, ["a"]), []);
  // Null -> a value and a value -> null both count; 0 vs null is a change, "" stays "".
  assert.deepEqual(diffFields({ x: null }, { x: 0 }), [{ field: "x", before: null, after: "0" }]);
  assert.deepEqual(diffFields({ x: "" }, { x: "" }), []);
});

test("valueText: dates as ISO, numbers and booleans as written, long text trimmed", () => {
  assert.equal(valueText(new Date("2026-11-10T01:02:03Z")), "2026-11-10T01:02:03.000Z");
  assert.equal(valueText(12.5), "12.5");
  assert.equal(valueText(false), "false");
  assert.equal(valueText(undefined), null);
  assert.equal(valueText({ a: 1 }), '{"a":1}');
  assert.ok((valueText("x".repeat(5000)) ?? "").length <= 2001);
});

test("never recorded: passwords, sessions, tokens, secrets, push keys - and TFN / bank details are withheld", () => {
  for (const f of ["passwordHash", "password", "sessionVersion", "tokenHash", "secret", "clientSecret", "p256dh", "auth", "apiKey", "id", "createdAt", "updatedAt"]) {
    assert.ok(isNeverRecorded(f), f);
  }
  for (const f of ["name", "ordinaryRate", "notes", "contractValue", "author", "authority"]) assert.ok(!isNeverRecorded(f), f);
  const out = diffFields({ passwordHash: "a", sessionVersion: 1, name: "A" }, { passwordHash: "b", sessionVersion: 2, name: "B" });
  assert.deepEqual(out.map((c) => c.field), ["name"]);
  const tfn = diffFields({ notes: null }, { notes: "Bank BSB 062-000 account 12345678" });
  assert.equal(tfn[0].after, WITHHELD, "a bank detail in free text is never copied into the history");
  // A blob (a timesheet's approved snapshot) is noted as changed, never copied.
  assert.deepEqual(diffFields({ snapshot: null }, { snapshot: '{"lines":[]}' }), [{ field: "snapshot", before: null, after: BLOB_NOTE }]);
});

test("models: User is never one; the business records are", () => {
  assert.ok(!isHistoryModel("User"));
  for (const m of ["Resource", "Project", "Job", "Tool", "InvoicedCost", "AccountsItem", "DayClose", "TimesheetWeek"]) assert.ok(isHistoryModel(m), m);
});

test("who reads what: pay fields Admin only, day / hire rates Manager+, the record's own wall first", () => {
  const rows = [{ field: "name" }, { field: "ordinaryRate" }, { field: "engagement" }, { field: "dailyRateExGst" }, { field: "hireRate" }];
  assert.deepEqual(visibleChanges("Resource", "ADMIN", rows).map((r) => r.field), ["name", "ordinaryRate", "engagement", "dailyRateExGst", "hireRate"]);
  assert.deepEqual(visibleChanges("Resource", "MANAGER", rows).map((r) => r.field), ["name", "dailyRateExGst", "hireRate"]);
  assert.deepEqual(visibleChanges("Resource", "VIEWER", rows).map((r) => r.field), ["name"]);
  for (const r of ["COORDINATOR", "YARD", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "BOGUS", null]) {
    assert.deepEqual(visibleChanges("Resource", r, rows), [], String(r));
  }
  assert.ok(resourceFieldVisible("ordinaryRate", "ADMIN") && !resourceFieldVisible("ordinaryRate", "MANAGER"));
  const p = [{ field: "name" }, { field: "contractValue" }, { field: "notes" }];
  assert.deepEqual(visibleChanges("Project", "VIEWER", p).map((r) => r.field), ["name"]);
  assert.equal(visibleChanges("Project", "MANAGER", p).length, 3);
  assert.ok(canReadHistory("AccountsItem", "ACCOUNTS") && canReadHistory("AccountsItem", "ADMIN") && !canReadHistory("AccountsItem", "MANAGER"));
  assert.ok(canReadHistory("InvoiceDraft", "ACCOUNTS") && !canReadHistory("InvoicedCost", "ACCOUNTS"));
  assert.ok(canReadHistory("Job", "MANAGER") && !canReadHistory("Job", "VIEWER"));
});

test("cancelled jobs: LIVE_JOB is the filter, isCancelledJob reads either sign, reasons are picked", () => {
  assert.deepEqual(LIVE_JOB, { cancelledAt: null });
  assert.ok(isCancelledJob({ cancelledAt: new Date() }) && isCancelledJob({ status: "CANCELLED" }));
  assert.ok(!isCancelledJob({ cancelledAt: null, status: "STOOD_DOWN" }));
  assert.ok(CANCEL_REASONS.length >= 3);
});

test("board snapshots keep everything the removed row had - names and times, no money", () => {
  const row = {
    id: "a1", jobId: "j1", resourceId: "r1", role: "Operator", createdAt: new Date("2026-11-09T21:00:00Z"),
    resource: { name: "Joe Bloggs", type: "PERSONNEL" },
    job: { id: "j1", title: "Myers", date: new Date("2026-11-10T00:00:00Z"), shift: "NIGHT", startTime: "7pm", endTime: "5am", projectId: "p1" },
  };
  const s = allocationSnapshot(row);
  assert.deepEqual(s, {
    assignmentId: "a1", jobId: "j1", resourceId: "r1", role: "Operator", createdAt: "2026-11-09T21:00:00.000Z", resourceName: "Joe Bloggs", resourceType: "PERSONNEL",
    jobTitle: "Myers", jobDate: "2026-11-10", shift: "NIGHT", startTime: "7pm", endTime: "5am", projectId: "p1",
  });
  assert.ok(!/\$|rate|cost/i.test(JSON.stringify(s)), "no money in a snapshot");
  const j = cancelledJobSnapshot({ id: "j1", projectId: "p1", title: "Myers", client: null, siteCode: null, siteAddress: null, date: new Date("2026-11-10T00:00:00Z"), shift: "DAY", startTime: null, endTime: null, status: "ACTIVE", dayBrief: "Strip out L2", colorTag: "blue", notRunning: false, sortOrder: 5, dateCheckNote: null });
  assert.equal(j.dayBrief, "Strip out L2");
  assert.equal(j.date, "2026-11-10");
});

// The filters live in Prisma queries, so the places that count are checked in their source: every reader that lists
// or sums these records leaves the hidden ones out.
const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
test("filters: superseded ledger rows, hidden invoice lines and cancelled jobs never reach Tracking", () => {
  const t = src("src/lib/trackingData.ts");
  assert.match(t, /allocationCost\.findMany\(\{ where: \{ date: \{ in: \[\.\.\.closedDates\] \}, supersededAt: null \} \}\)/);
  assert.match(t, /invoicedCosts: \{ where: \{ removedAt: null \}/);
  assert.equal((t.match(/cancelledAt: null/g) ?? []).length, 2, "both job queries (past and booked ahead)");
  assert.doesNotMatch(src("src/lib/dayClose.ts"), /allocationCost\.deleteMany/, "the ledger is superseded, never deleted");
  assert.doesNotMatch(src("src/app/api/day-close/route.ts"), /allocationCost\.deleteMany/);
});

test("filters: every job list, count and cost leaves a cancelled job out", () => {
  const files = [
    "src/app/api/jobs/route.ts", "src/app/api/calendar/route.ts", "src/app/api/day-review/route.ts", "src/app/api/jobs/completed/route.ts",
    "src/app/api/jobs/copy/route.ts", "src/app/api/projects/route.ts", "src/lib/attendanceView.ts", "src/lib/dailyLog/reminders.ts",
    "src/lib/dailyLog/store.ts", "src/lib/dateExceptions.ts", "src/lib/dayClose.ts", "src/lib/insights/load.ts", "src/lib/payroll/store.ts",
    "src/lib/projectFileServer.ts", "src/lib/receipts/indicatorStore.ts", "src/lib/receipts/office.ts", "src/lib/receipts/store.ts",
    "src/lib/signin.ts", "src/lib/signInActuals.ts", "src/lib/signinAlerts.ts", "src/lib/signOutReminders.ts", "src/lib/siteRequests.ts",
    "src/lib/trackingData.ts", "src/lib/travel/store.ts", "src/lib/alerts.ts", "src/lib/inventory/store.ts", "src/lib/boardGuard/store.ts",
    "src/lib/confirmReminders.ts",
  ];
  for (const f of files) assert.match(src(f), /cancelledAt: null|LIVE_JOB/, f);
  assert.doesNotMatch(src("src/app/api/jobs/[id]/route.ts"), /prisma\.job\.delete\(/, "a job is cancelled, never deleted");
});

test("filters: removed invoice lines, drafts, contacts, aliases, service records, reports and retired tools stay out", () => {
  const checks: [string, RegExp][] = [
    ["src/lib/hireChecks/store.ts", /removedAt: null/],
    ["src/lib/receipts/tipStore.ts", /TIP_FEES", removedAt: null \}/],
    ["src/lib/invoiceInbox.ts", /invoicedCost\.findMany\(\{ where: \{ removedAt: null \}/],
    ["src/lib/invoicedCosts.ts", /removedAt: null/],
    ["src/app/api/invoice-inbox/route.ts", /removedAt: null/],
    ["src/lib/accounts/store.ts", /removedAt: null, upload/],
    ["src/lib/abnInvoices/store.ts", /removedAt: null/],
    ["src/lib/rateSheet/store.ts", /removedAt: null/],
    ["src/app/api/projects/[id]/route.ts", /contacts: \{ where: \{ removedAt: null \}/],
    ["src/app/api/projects/[id]/aliases/route.ts", /removedAt: null/],
    ["src/lib/xero/imports.ts", /siteAlias\.findMany\(\{ where: \{ removedAt: null \}/],
    ["src/app/api/resources/[id]/service/route.ts", /removedAt: null/],
    ["src/lib/assets/store.ts", /serviceRecords: \{ where: \{ removedAt: null \}/],
    ["src/app/api/bugs/route.ts", /removedAt: null/],
    ["src/app/api/day-review/route.ts", /jobActuals: \{ where: \{ removedAt: null \}/],
    ["src/app/api/tools/route.ts", /retiredAt: null/],
    ["src/app/api/toolboxes/route.ts", /retiredAt: null/],
    ["src/lib/stockTake/store.ts", /toolboxId: null, retiredAt: null/],
    ["src/lib/toolboxCheckRun.ts", /retiredAt: null/],
  ];
  for (const [f, re] of checks) assert.match(src(f), re, f);
  // The former delete paths are gone.
  const gone: [string, RegExp][] = [
    ["src/lib/invoicedCosts.ts", /invoicedCost\.delete\(/],
    ["src/lib/invoiceInbox.ts", /invoicedCost\.deleteMany\(/],
    ["src/app/api/invoice-inbox/uploads/[id]/route.ts", /invoiceDraft\.deleteMany\(/],
    ["src/app/api/service/[id]/route.ts", /serviceRecord\.delete\(/],
    ["src/app/api/projects/[id]/contacts/[contactId]/route.ts", /projectContact\.delete\(/],
    ["src/app/api/projects/[id]/aliases/route.ts", /siteAlias\.deleteMany\(/],
    ["src/app/api/day-review/actual/route.ts", /jobActual\.delete\(/],
    ["src/app/api/bugs/[id]/route.ts", /bugReport\.delete\(/],
    ["src/app/api/tools/[id]/route.ts", /tool\.delete\(/],
    ["src/app/api/projects/[id]/route.ts", /project\.delete\(/],
  ];
  for (const [f, re] of gone) assert.doesNotMatch(src(f), re, f);
});
