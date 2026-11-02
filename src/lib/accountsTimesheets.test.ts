import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountsTimesheetCsv, AMOUNT_REMOVED, TIMESHEETS_EXPLAINER, TIMESHEETS_NOTICE } from "./accountsTimesheets";
import { fileIsSafe } from "./payroll/rules";
import { rankAtLeast } from "./roleRank";
import { POINT_BREAK_MINUTES, STILL_ON_HOURS } from "./signin";
import type { TimesheetLine } from "./timesheets";
import { HOME_OFFER_HOURS, TRAVEL_CAP_HOURS } from "./travel/rules";

// Timesheets on the Accounts screen (2 Nov 2026): view + export for the ACCOUNTS login, every write refused.
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const handlers = (code: string) => [...code.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
// The body of one exported handler, up to the next export (good enough for these small route files).
const handler = (code: string, name: string) => {
  const i = code.indexOf(`export const ${name} `);
  if (i < 0) return "";
  const j = code.indexOf("export const ", i + 1);
  return code.slice(i, j < 0 ? undefined : j);
};

test("ACCOUNTS reads and exports through guardAccounts - GET only, nothing written", () => {
  for (const rel of ["../app/api/accounts/timesheets/route.ts", "../app/api/accounts/timesheets/export/route.ts"]) {
    const code = src(rel);
    assert.deepEqual(handlers(code), ["GET"], `${rel}: GET only`);
    assert.match(handler(code, "GET"), /await guardAccounts\(\)[\s\S]*"denied" in g\) return g\.denied/, `${rel}: guardAccounts first`);
    assert.doesNotMatch(code, /prisma\.|\.(create|update|upsert|delete)(Many)?\(/, `${rel}: no database writes`);
  }
  // The "Got it" route writes the notice row only - never a timesheet, sign-in or approval.
  const notice = src("../app/api/accounts/timesheets/explainer/route.ts");
  assert.deepEqual(handlers(notice), ["POST"]);
  assert.match(notice, /guardAccounts\(\)/);
  assert.doesNotMatch(notice, /timesheetWeek|siteAttendance|hoursApproval|payWeekReview/);
  assert.match(src("./accountsTimesheets.ts"), /prisma\.noticeSeen\.upsert\([\s\S]*update: \{\} \}\)/, "Got it never changes an existing row");
});

test("every timesheet write still refuses ACCOUNTS (and TIMESHEETS)", () => {
  // The one-page roles rank below VIEWER, so guard("MANAGER") / guard("ADMIN") refuse them (lib/roleRank.ts, CO-001).
  for (const role of ["ACCOUNTS", "TIMESHEETS", "COORDINATOR"]) {
    assert.equal(rankAtLeast(role, "MANAGER"), false, `${role} is refused by guard("MANAGER")`);
    assert.equal(rankAtLeast(role, "ADMIN"), false, `${role} is refused by guard("ADMIN")`);
  }
  assert.equal(rankAtLeast("MANAGER", "MANAGER"), true);
  const auth = src("./auth.ts");
  assert.match(auth, /export async function guard\(min[\s\S]*?rankAtLeast\(user\.role, min\)/, "guard() checks the rank");
  // Approve / reopen the week; the Managers' export.
  const ts = src("../app/api/timesheets/route.ts");
  assert.deepEqual(handlers(ts).sort(), ["GET", "POST"]);
  assert.match(handler(ts, "POST"), /await guard\("MANAGER"\)/);
  assert.match(handler(ts, "POST"), /role !== "ADMIN"[\s\S]*reopen/, "reopen is Admin only");
  assert.match(handler(src("../app/api/timesheets/export/route.ts"), "GET"), /await guard\("MANAGER"\)/);
  // The Operations timesheet viewer guard does not let ACCOUNTS in (its own copy is under /api/accounts).
  const start = auth.indexOf("export async function guardTimesheetViewer");
  const viewer = auth.slice(start, auth.indexOf("\n}", start));
  assert.doesNotMatch(viewer, /ACCOUNTS/);
  // Changing, adding, signing out or removing a sign-in.
  const att = src("../app/api/attendance/[id]/route.ts");
  assert.match(handler(att, "PATCH"), /await guard\("MANAGER"\)/);
  assert.match(handler(att, "DELETE"), /await guard\("ADMIN"\)/);
  for (const rel of ["../app/api/attendance/route.ts", "../app/api/attendance/poster/route.ts", "../app/api/attendance/sign-out/route.ts"])
    assert.match(handler(src(rel), "POST"), /await guard\("MANAGER"\)/, rel);
});

const line = (o: Partial<TimesheetLine> = {}): TimesheetLine => ({
  attendanceId: "a1", date: "2026-10-26", resourceId: "r1", name: "Sam Worker", role: "Labourer", site: "12 Grand Pde job",
  in: "7:00 am", out: "3:30 pm", breakMinutes: 30, hours: 8, status: "CONFIRMED", allocated: true, changedByOffice: null, ...o,
});

test("the export is hours only - fileIsSafe passes and no $ gets through", () => {
  const csv = accountsTimesheetCsv("2026-10-26", [
    line(),
    line({ attendanceId: "a2", date: "2026-10-27", changedByOffice: "sign-out 3:30 pm -> 4:00 pm (paid $50 cash for parking)", site: "$5 Bins yard" }),
  ], { approvedBy: "Alex", approvedAt: new Date("2026-11-02T00:00:00Z") });
  assert.ok(csv, "a file is made");
  assert.ok(fileIsSafe(csv!), "payroll file check passes");
  assert.doesNotMatch(csv!, /\$/, "no dollar sign at all");
  assert.ok(csv!.includes(AMOUNT_REMOVED));
  assert.ok(csv!.includes("12 Grand Pde job"), "ordinary words that look like money stay");
  // Same columns as the Managers' export (timesheetCsv).
  assert.ok(csv!.includes("Employee,Role,Date,Day,Site / place,Sign in,Sign out,Unpaid break (min),Hours,Travel (h),Status,Notes"));
  assert.ok(csv!.includes("APPROVED by Alex"));
  assert.ok(csv!.includes("WEEK TOTAL"));
});

test("an export that still looks like bank / tax details is refused, not sent", () => {
  assert.equal(accountsTimesheetCsv("2026-10-26", [line({ changedByOffice: "TFN given at sign-in" })], null), null);
  assert.ok(accountsTimesheetCsv("2026-10-26", [line()], null)!.includes("DRAFT - not approved yet"));
});

test("the explainer says the rules the code uses, and no money", () => {
  const text = JSON.stringify(TIMESHEETS_EXPLAINER);
  assert.equal(TIMESHEETS_NOTICE, "ACCOUNTS_TIMESHEETS_V2", "bumped with the once-a-day break rule");
  assert.ok(text.includes(`${POINT_BREAK_MINUTES} minutes at the office, yard and trucks`), "the sign-in point break is the code's constant");
  assert.match(text, /One unpaid break per person per day, and only when their day's total is over 5 hours - and the break never takes the day below 5 hours/);
  assert.match(text, /rounded once/);
  assert.match(text, /applies from Monday 26 October 2026/);
  assert.match(text, /overlap - counted once/);
  assert.ok(text.includes(`last ${STILL_ON_HOURS} hours`), "on-site-now window is the code's constant");
  assert.match(text, /nearest quarter hour/);

  assert.ok(text.includes(`longer than ${TRAVEL_CAP_HOURS} hours`), "travel cap from the code");
  assert.ok(text.includes(`offered for ${HOME_OFFER_HOURS} hours`), "home-leg window from the code");
  assert.doesNotMatch(text, /\$/);
  for (const s of TIMESHEETS_EXPLAINER.sections) assert.ok(s.bullets.length >= 1 && s.bullets.length <= 5, s.heading);
});
