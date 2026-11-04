// The YARD login (Ilies, 4 Nov 2026): the dedicated computer downstairs in the yard - its own page (/yard, the yard
// jobs) and the Tools pages, working tools exactly as the coordinator does. It ranks below VIEWER, so every guard()
// keeps refusing it; only guardOrYard() and guardTools() let it in. No money, nothing else of Operations, never
// director access, and only the owner gives, takes away or creates it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NO_DIRECTOR_ACCESS_ROLES, OWNER_ONLY_ROLES, RANK, ROLES, YARD_PAGES, coordinatorOr, homeFor, isCoordinatorPage, isYardPage,
  ownerOnlyRoleName, rankAtLeast, toolsWorkerOr, touchesOwnerOnlyRole, yardHref, yardOr,
} from "./roles";
import { rankOf } from "./roleRank";
import { audiencesFor, canActOnFindings } from "./findings/actions";
import { safeHome } from "./safeNext";
import { STRIPPED_ROLES } from "./coordinatorView";
import { withoutAmounts } from "./coordinatorHire";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
// The body of one exported handler, up to the next export (good enough for these small route files).
const handler = (code: string, name: string) => {
  const i = code.indexOf(`export const ${name} `);
  if (i < 0) return "";
  const j = code.indexOf("export const ", i + 1);
  return code.slice(i, j < 0 ? undefined : j);
};

test("YARD ranks below VIEWER - guard(VIEWER / MANAGER / ADMIN) all refuse it", () => {
  assert.ok(ROLES.includes("YARD"));
  assert.equal(RANK.YARD, 0);
  assert.equal(rankOf("YARD"), 0, "a known role, not an unknown one");
  for (const min of ["VIEWER", "MANAGER", "ADMIN"] as const) assert.equal(rankAtLeast("YARD", min), false, min);
  assert.equal(coordinatorOr("YARD", "VIEWER"), false, "the coordinator's own routes don't admit the yard");
  assert.equal(rankAtLeast("yard", "VIEWER"), false, "case matters - an unknown role ranks nowhere");
});

test("guardOrYard(min) = min and up, plus the yard - nobody else below min", () => {
  assert.equal(yardOr("YARD", "MANAGER"), true);
  assert.equal(yardOr("YARD", "ADMIN"), true);
  assert.equal(yardOr("MANAGER", "MANAGER"), true);
  assert.equal(yardOr("ADMIN", "MANAGER"), true);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "COORDINATOR", "", "yard"]) assert.equal(yardOr(r, "MANAGER"), false, r);
  assert.equal(yardOr("VIEWER", "VIEWER"), true);
  assert.equal(yardOr("COORDINATOR", "VIEWER"), false);
});

test("guardTools(min) = min and up, plus the coordinator and the yard - nobody else below min", () => {
  for (const r of ["YARD", "COORDINATOR", "MANAGER", "ADMIN"]) assert.equal(toolsWorkerOr(r, "MANAGER"), true, r);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "", "yard", "coordinator"]) assert.equal(toolsWorkerOr(r, "MANAGER"), false, r);
  for (const r of ["YARD", "COORDINATOR", "VIEWER"]) assert.equal(toolsWorkerOr(r, "VIEWER"), true, r);
  for (const r of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) assert.equal(toolsWorkerOr(r, "VIEWER"), false, r);
});

test("lib/auth.ts: guardOrYard and guardTools use those rules; guard() itself is unchanged", () => {
  const auth = src("./auth.ts");
  const fn = (name: string) => { const s = auth.indexOf(`export async function ${name}(`); return auth.slice(s, auth.indexOf("\n}", s)); };
  assert.match(fn("guardOrYard"), /min: Role\): Promise<NextResponse \| null>[\s\S]*status: 401[\s\S]*!yardOr\(user\.role, min\)[\s\S]*status: 403/);
  assert.match(fn("guardTools"), /min: Role\): Promise<NextResponse \| null>[\s\S]*status: 401[\s\S]*!toolsWorkerOr\(user\.role, min\)[\s\S]*status: 403/);
  assert.match(fn("guard"), /if \(!rankAtLeast\(user\.role, min\)\)/);
  assert.doesNotMatch(fn("guard"), /YARD|COORDINATOR/, "guard() never names a one-page role");
  assert.doesNotMatch(fn("guardTimesheetViewer"), /YARD|toolsWorkerOr|yardOr/, "timesheets don't admit the yard");
});

test("the Tools routes admit the yard at exactly the coordinator's level; toolbox admin stays Manager+", () => {
  const routes: [string, string, "VIEWER" | "MANAGER"][] = [
    ["../app/api/tools/route.ts", "GET", "VIEWER"], ["../app/api/tools/route.ts", "POST", "MANAGER"],
    ["../app/api/tools/[id]/route.ts", "GET", "VIEWER"], ["../app/api/tools/[id]/route.ts", "PATCH", "MANAGER"], ["../app/api/tools/[id]/route.ts", "DELETE", "MANAGER"],
    ["../app/api/tools/[id]/issues/route.ts", "POST", "MANAGER"], ["../app/api/tools/read/route.ts", "POST", "MANAGER"],
    ["../app/api/tools/photos/route.ts", "POST", "MANAGER"], ["../app/api/tools/photos/[id]/route.ts", "GET", "VIEWER"],
    ["../app/api/toolboxes/route.ts", "GET", "VIEWER"], ["../app/api/toolboxes/[id]/check/route.ts", "POST", "MANAGER"],
    ["../app/api/tool-issues/route.ts", "GET", "VIEWER"], ["../app/api/tool-issues/[id]/route.ts", "PATCH", "MANAGER"],
  ];
  for (const [rel, h, min] of routes) assert.match(handler(src(rel), h), new RegExp(`await guardTools\\("${min}"\\)`), `${rel} ${h}`);
  // Creating, renaming, re-supervising and retiring a toolbox: never the coordinator or the yard.
  assert.match(handler(src("../app/api/toolboxes/route.ts"), "POST"), /await guard\("MANAGER"\)/);
  assert.match(handler(src("../app/api/toolboxes/[id]/route.ts"), "PATCH"), /await guard\("MANAGER"\)/);
  assert.doesNotMatch(src("../app/api/toolboxes/[id]/route.ts"), /guardTools|guardOrYard|guardOrCoordinator/);
  // Site links and submissions (/tools/site) are not the yard's.
  for (const rel of ["../app/api/site-links/route.ts", "../app/api/site-submissions/route.ts"]) assert.doesNotMatch(src(rel), /guardTools|guardOrYard/, rel);
});

test("no dollar figure reaches the yard on the Tools routes", () => {
  assert.ok(STRIPPED_ROLES.includes("YARD") && STRIPPED_ROLES.includes("COORDINATOR"));
  for (const rel of ["../app/api/tools/route.ts", "../app/api/tools/[id]/route.ts", "../app/api/toolboxes/route.ts", "../app/api/tool-issues/route.ts", "../app/api/tool-issues/[id]/route.ts"]) {
    const code = src(rel);
    for (const h of ["GET", "POST", "PATCH"]) {
      const body = handler(code, h);
      if (!body || /guard\("MANAGER"\)/.test(body)) continue;
      assert.doesNotMatch(body.replace(/NextResponse\.json\(\{ (error|ok)\b[^)]*\)/g, ""), /NextResponse\.json\(/, `${rel} ${h}: replies through viewJson`);
    }
  }
  assert.deepEqual(withoutAmounts({ notes: "Repair quote $450, ask Hilti", n: 3 }).n, 3);
  assert.doesNotMatch(String(withoutAmounts({ notes: "Repair quote $450, ask Hilti" }).notes), /\$\s*\d/);
});

test("the yard lands on /yard and opens only its pages", () => {
  assert.equal(homeFor("YARD"), "/yard");
  assert.equal(homeFor("COORDINATOR"), "/coordinator");
  assert.equal(homeFor("MANAGER"), "/command");
  assert.equal(safeHome("/yard"), "/yard", "the login page follows the yard's home");
  for (const p of YARD_PAGES) assert.ok(isYardPage(p), p);
  for (const p of ["/yard?x=1", "/yard/", "/yard/job123", "/tools/", "/tools/faults#x"]) assert.ok(isYardPage(p), p);
  for (const p of ["/command", "/projects", "/tracking", "/tracking/abc", "/tools/site", "/hire", "/purchases", "/timesheets", "/attendance",
    "/day-review", "/calendar", "/messages", "/documents", "/assistant", "/users", "/accounts", "/directors", "/coordinator", "/invoices",
    "/requests", "/labour", "/plant", "/vehicles", "/receipts", "/changes", "/estimating", "/yardx", "/daily-report/abc"])
    assert.equal(isYardPage(p), false, p);
  assert.equal(isCoordinatorPage("/yard"), false, "the coordinator doesn't get /yard from this");
  assert.equal(yardHref("/tools/faults", true), "/tools/faults");
  assert.equal(yardHref("/tools/site", true), null);
  assert.equal(yardHref("/tracking/abc", true), null);
  assert.equal(yardHref("/tracking/abc", false), "/tracking/abc");
});

test("the screen: AppFrame sends the yard home, the nav shows only its tabs, the Tools pages let it work", () => {
  const frame = src("../components/AppFrame.tsx");
  assert.match(frame, /yardOnly \? "\/yard"/);
  assert.match(frame, /!\(yardOnly && isYardPage\(path\)\)/);
  assert.match(src("../components/AuthProvider.tsx"), /yardOnly: user\?\.role === "YARD"/);
  const nav = src("../components/TopNav.tsx");
  assert.match(nav, /const YARD = \[\s*\{ href: "\/yard", label: "Yard jobs" \},\s*\{ href: "\/tools", label: "Tools" \},\s*\];/);
  assert.match(src("../components/tools/ToolsTabs.tsx"), /yardHref\(t\.href, yardOnly\)/);
  assert.match(src("../app/tools/page.tsx"), /canEdit: canEdit \|\| coordinatorOnly \|\| yardOnly/);
  assert.match(src("../app/tools/toolboxes/page.tsx"), /const canFill = canEdit \|\| coordinatorOnly \|\| yardOnly;/);
  assert.match(src("../app/tools/faults/page.tsx"), /const canEdit = manager \|\| coordinatorOnly \|\| yardOnly;/);
});

test("only the owner gives, takes away or creates YARD; never director access; no findings", () => {
  assert.ok(OWNER_ONLY_ROLES.includes("YARD"));
  for (const [from, to] of [["VIEWER", "YARD"], ["YARD", "VIEWER"], ["YARD", "MANAGER"], ["COORDINATOR", "YARD"], [null, "YARD"]] as const)
    assert.equal(touchesOwnerOnlyRole(from, to), true, `${from} -> ${to}`);
  assert.equal(touchesOwnerOnlyRole("YARD", "YARD"), false);
  assert.equal(ownerOnlyRoleName(null, "YARD"), "Yard");
  assert.equal(ownerOnlyRoleName("YARD", "VIEWER"), "Yard");
  assert.equal(ownerOnlyRoleName("VIEWER", "COORDINATOR"), "Coordinator");
  assert.ok(NO_DIRECTOR_ACCESS_ROLES.includes("YARD"));
  const u = { email: "yard@example.test", role: "YARD", directorAccess: true };
  assert.deepEqual(audiencesFor(u), []);
  assert.equal(canActOnFindings(u), false);
  const page = src("../app/users/page.tsx");
  assert.match(page, /value: "YARD", label: "Yard computer: yard jobs and tools only"/);
  assert.match(page, /isOwner\(me\?\.email\) \? \[\.\.\.ROLE_OPTIONS, COORDINATOR_OPTION, YARD_OPTION, DIRECTOR_OPTION\]/);
  assert.doesNotMatch(page.slice(page.indexOf("const ROLE_OPTIONS"), page.indexOf("];", page.indexOf("const ROLE_OPTIONS"))), /YARD/, "not on the list other Admins see");
});

test("CO-001-R1: the yard never has director access, whatever its tick says", async () => {
  const { hasDirectorAccess } = await import("./auth");
  assert.equal(hasDirectorAccess({ email: "yard@example.test", role: "YARD", directorAccess: true }), false);
});

test("phone / desktop alerts: the yard turns on its own, like accounts; other one-page logins stay refused", () => {
  const push = src("../app/api/push/route.ts");
  assert.match(push, /const PUSH_OWN_ROLES: readonly string\[\] = \["ACCOUNTS", "YARD"\];/);
  assert.match(push, /if \(user && PUSH_OWN_ROLES\.includes\(user\.role\)\) return null;\s*return guard\("ADMIN"\);/);
  for (const h of ["GET", "POST", "DELETE"]) assert.match(handler(push, h), /await guardPush\(\)[\s\S]*userId: user\.id/, `${h}: own devices only`);
  const test = src("../app/api/push/test/route.ts");
  assert.match(test, /const yard = user\?\.role === "YARD";[\s\S]*if \(!accounts && !yard\) \{\s*const denied = await guard\("ADMIN"\);/);
  assert.match(test, /pushToUsers\(\s*\[user!\.id\]/, "a test goes to the caller's own devices only");
});
