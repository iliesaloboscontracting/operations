import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notSignedInWindow, noWayToSignIn } from "./signinAlerts";

// Fixes 3 and 5a (Ilies, 2 Nov 2026).
const ways = (o: Partial<{ linkHolders: string[]; handoverJobs: string[]; posterProjects: string[] }> = {}) => ({
  linkHolders: new Set(o.linkHolders ?? []), handoverJobs: new Set(o.handoverJobs ?? []), posterProjects: new Set(o.posterProjects ?? []),
});
const job = { id: "j1", projectId: "hills", crewIds: ["anasa", "ratu"] };

test("fix 3: Hills Hospital - crew on the board, no supervisor link, no hand-over, no poster = no way to sign in", () => {
  assert.equal(noWayToSignIn(job, ways()), true);
  assert.equal(noWayToSignIn(job, ways({ linkHolders: ["ratu"] })), false, "someone on it has a supervisor link");
  assert.equal(noWayToSignIn(job, ways({ linkHolders: ["roslyn"] })), true, "a link held by someone NOT on the job doesn't count");
  assert.equal(noWayToSignIn(job, ways({ handoverJobs: ["j1"] })), false, "a hand-over link for the job");
  assert.equal(noWayToSignIn(job, ways({ posterProjects: ["hills"] })), false, "a site poster at the project");
  assert.equal(noWayToSignIn({ ...job, crewIds: [] }, ways()), false, "nobody on it - nothing to warn about");
});

test("fix 5a: 'not signed in' goes out from an hour after the start until 4 hours after", () => {
  const start = new Date("2026-11-03T20:00:00Z");
  const at = (min: number) => new Date(start.getTime() + min * 60_000);
  assert.equal(notSignedInWindow(start, at(59)), false);
  assert.equal(notSignedInWindow(start, at(60)), true);
  assert.equal(notSignedInWindow(start, at(240)), true);
  assert.equal(notSignedInWindow(start, at(241)), false);
  assert.equal(notSignedInWindow(null, at(90)), false, "no start time on the board - no alert");
});

test("every alert is once-only and has a kill switch", () => {
  const src = readFileSync(new URL("./signinAlerts.ts", import.meta.url), "utf8");
  for (const k of ["SIGNOUT_MORNING_ALERT", "SIGNIN_WAY_CHECK", "NOT_SIGNED_IN_ALERT"]) assert.match(src, new RegExp(`off\\("${k}"\\)`), k);
  for (const kind of ["NO_SIGNOUT_7AM", "NO_SIGNIN_WAY", "NOT_SIGNED_IN_1H"]) assert.match(src, new RegExp(`claim\\([^)]*"${kind}"`), kind);
  assert.doesNotMatch(src, /siteAttendance\.(create|update|upsert|delete)/, "alerts never change a sign-in");
});
