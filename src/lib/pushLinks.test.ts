import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { linkMayGetPush, liveLinks, liveLinkWhere } from "./pushLinks";

// PS-023 (10 Nov 2026, Ilies approved "including the older reminders"): one rule for every push to a site link.
const now = new Date("2026-11-10T05:00:00Z");
const link = (o: Partial<Parameters<typeof linkMayGetPush>[0]> = {}) => ({ revokedAt: null, expiresAt: null, resourceId: "p1", resource: { active: true }, ...o });

test("a push only goes to a live link of an active person", () => {
  assert.equal(linkMayGetPush(link(), now), true);
  assert.equal(linkMayGetPush(link({ resource: { active: false } }), now), false, "archived supervisor, link never switched off");
  assert.equal(linkMayGetPush(link({ revokedAt: new Date("2026-11-01") }), now), false, "switched off");
  assert.equal(linkMayGetPush(link({ expiresAt: new Date("2026-11-10T04:59:00Z") }), now), false, "a hand-over whose day is over");
  assert.equal(linkMayGetPush(link({ expiresAt: new Date("2026-11-10T13:00:00Z") }), now), true, "a hand-over still running");
  assert.equal(linkMayGetPush(link({ expiresAt: new Date("2026-11-10T13:00:00Z"), resource: { active: false } }), now), false, "a hand-over to someone since archived");
  assert.equal(linkMayGetPush(link({ resourceId: null, resource: null }), now), true, "a shared link (the yard's) has no person to check");
});

test("the database filter says the same three things, and combines with a caller's own OR", () => {
  const w = liveLinkWhere(now) as { AND: unknown[] };
  assert.deepEqual(w.AND, [
    { revokedAt: null },
    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    { OR: [{ resourceId: null }, { resource: { active: true } }] },
  ]);
  const mine = { OR: [{ kind: "SUPERVISOR" }, { kind: "HANDOVER" }] };
  assert.deepEqual(liveLinks(mine, now), { AND: [liveLinkWhere(now), mine] }, "the caller's OR is kept whole, not overwritten");
});

test("every push to a site link goes through the rule, and the reminders pick links with it", () => {
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  assert.match(src("./push.ts"), /siteLinkPushDevice\.findMany\(\{ where: \{ siteLinkId: \{ in: linkIds \}, siteLink: liveLinkWhere\(now\) \} \}\)/);
  assert.match(src("./push.ts"), /export async function pushToSiteLinks[\s\S]*?await siteLinkDevices\(linkIds\)/);
  for (const f of ["./confirmReminders.ts", "./signOutReminders.ts", "./signinAlerts.ts"]) assert.match(src(f), /jobSiteLinks\(/, f);
  for (const f of ["./dailyLog/reminders.ts", "./dailyLog/store.ts", "./requestAlerts.ts", "./yard/alerts.ts"]) assert.match(src(f), /liveLinks\(/, f);
});
