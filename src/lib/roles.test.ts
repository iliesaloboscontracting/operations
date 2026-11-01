// The login roles (lib/roles.ts) - above all the COORDINATOR login (2 Nov 2026): it ranks below VIEWER, so every
// guard() keeps refusing it, and only the routes that name it (guardOrCoordinator) let it in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { COORDINATOR_PAGES, NO_DIRECTOR_ACCESS_ROLES, RANK, ROLES, coordinatorHref, coordinatorOr, homeFor, isCoordinatorPage, rankAtLeast } from "./roles";
import { audiencesFor, canActOnFindings } from "./findings/actions";

test("COORDINATOR ranks below VIEWER - guard(VIEWER / MANAGER / ADMIN) all refuse it", () => {
  assert.ok(ROLES.includes("COORDINATOR"));
  assert.equal(RANK.COORDINATOR, 0);
  for (const min of ["VIEWER", "MANAGER", "ADMIN"] as const) assert.equal(rankAtLeast("COORDINATOR", min), false, min);
  // The other one-page roles are unchanged.
  for (const r of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) assert.equal(rankAtLeast(r, "VIEWER"), false, r);
  assert.equal(rankAtLeast("nonsense", "VIEWER"), false, "an unknown role ranks nowhere");
});

test("guardOrCoordinator(min) = min and up, plus the coordinator - nobody else below min", () => {
  assert.equal(coordinatorOr("COORDINATOR", "MANAGER"), true);
  assert.equal(coordinatorOr("COORDINATOR", "VIEWER"), true);
  assert.equal(coordinatorOr("MANAGER", "MANAGER"), true);
  assert.equal(coordinatorOr("ADMIN", "MANAGER"), true);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "", "coordinator"]) assert.equal(coordinatorOr(r, "MANAGER"), false, r);
  for (const r of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) assert.equal(coordinatorOr(r, "VIEWER"), false, r);
  assert.equal(coordinatorOr("VIEWER", "VIEWER"), true);
});

test("the coordinator lands on /coordinator; the other homes are unchanged", () => {
  assert.equal(homeFor("COORDINATOR"), "/coordinator");
  assert.equal(homeFor("TIMESHEETS"), "/timesheets");
  assert.equal(homeFor("ACCOUNTS"), "/accounts");
  assert.equal(homeFor("DIRECTOR"), "/directors");
  assert.equal(homeFor("MANAGER"), "/command");
});

test("his pages, and only those", () => {
  for (const p of COORDINATOR_PAGES) assert.ok(isCoordinatorPage(p), p);
  for (const p of ["/day-review?x=1", "/tools/", "/daily-report/abc123", "/hire#x"]) assert.ok(isCoordinatorPage(p), p);
  for (const p of ["/command", "/projects", "/tracking", "/tracking/abc", "/tools/site", "/assistant", "/users", "/accounts", "/directors",
    "/invoices", "/requests", "/labour", "/plant", "/vehicles", "/receipts", "/changes", "/estimating", "/daily-report", "/daily-report/a/b", "/hire/x"])
    assert.equal(isCoordinatorPage(p), false, p);
});

test("coordinatorHref: links to his pages stay, others become plain text (null); everyone else unchanged", () => {
  assert.equal(coordinatorHref("/hire", true), "/hire");
  assert.equal(coordinatorHref("/tracking/abc", true), null);
  assert.equal(coordinatorHref("/tools/site", true), null);
  assert.equal(coordinatorHref("/tracking/abc", false), "/tracking/abc");
});

test("no director access and no findings for the coordinator, even with the tick set", () => {
  assert.ok(NO_DIRECTOR_ACCESS_ROLES.includes("COORDINATOR"));
  const u = { email: "alex@example.test", role: "COORDINATOR", directorAccess: true };
  assert.deepEqual(audiencesFor(u), []);
  assert.equal(canActOnFindings(u), false);
});
