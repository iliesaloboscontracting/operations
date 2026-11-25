// The coordinator on /receipts - tip dockets only (Ilies approved 25 Nov 2026: "See and check, with $", "Tip dockets only").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROLES, COORDINATOR_PAGES, isCoordinatorPage, isYardPage } from "../roles";
import { filtersFor, indicatorsFor, mayReadTipDockets, tipsOnlyFor, tipsOnlyMayAct, tipsOnlyMayViewPhoto } from "./tipsAccess";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("who opens /receipts: Managers, Admins and the coordinator - nobody else, and only the coordinator is tips-only", () => {
  const may = ROLES.filter(mayReadTipDockets);
  assert.deepEqual([...may].sort(), ["ADMIN", "COORDINATOR", "MANAGER"]);
  assert.deepEqual(ROLES.filter(tipsOnlyFor), ["COORDINATOR"]);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "YARD", "SOMETHING_NEW", ""]) {
    assert.equal(mayReadTipDockets(r), false, r);
    assert.equal(tipsOnlyFor(r), false, r);
  }
  assert.ok((COORDINATOR_PAGES as readonly string[]).includes("/receipts") && isCoordinatorPage("/receipts?tab=x"));
  assert.equal(isYardPage("/receipts"), false, "never the yard");
});

test("the list filters: the coordinator's kind is TIP whatever is asked, and the truck filter goes; a Manager's are untouched", () => {
  for (const kind of [undefined, "FUEL", "ODOMETER", "PURCHASE", "TIP", "anything"]) {
    const f = filtersFor({ kind, vehicleId: "v1", jobId: "j1", day: "2026-11-20", person: "Bob", asbestos: "yes", check: "1" }, true);
    assert.equal(f.kind, "TIP", String(kind));
    assert.ok(!Object.keys(f).includes("vehicleId") && f.vehicleId === undefined, "no truck filter");
    assert.deepEqual({ jobId: f.jobId, day: f.day, person: f.person, asbestos: f.asbestos, check: f.check }, { jobId: "j1", day: "2026-11-20", person: "Bob", asbestos: "yes", check: "1" });
  }
  const m = { kind: "FUEL", vehicleId: "v1" };
  assert.deepEqual(filtersFor(m, false), m);
  assert.deepEqual(filtersFor({}, false), {});
});

test("actions on one record: the coordinator only on a TIP docket that isn't own money", () => {
  assert.equal(tipsOnlyMayAct({ isOdometer: false, kind: "TIP", ownMoney: false }), true);
  assert.equal(tipsOnlyMayAct({ isOdometer: false, kind: "TIP", ownMoney: null }), true);
  for (const r of [
    { isOdometer: true, kind: null, ownMoney: null },
    { isOdometer: true, kind: "TIP", ownMoney: false },
    { isOdometer: false, kind: "FUEL", ownMoney: false },
    { isOdometer: false, kind: "FUEL", ownMoney: true },
    { isOdometer: false, kind: "PURCHASE", ownMoney: true },
    { isOdometer: false, kind: "TIP", ownMoney: true },
    { isOdometer: false, kind: null, ownMoney: null },
  ]) assert.equal(tipsOnlyMayAct(r), false, JSON.stringify(r));
});

test("photos: the coordinator only sees one on a TIP docket that isn't own money", () => {
  assert.equal(tipsOnlyMayViewPhoto({ odometerReadingId: null, receipt: { kind: "TIP", ownMoney: false } }), true);
  for (const p of [
    { odometerReadingId: "o1", receipt: null },
    { odometerReadingId: "o1", receipt: { kind: "TIP", ownMoney: false } },
    { odometerReadingId: null, receipt: null }, // uploaded, not on a receipt yet
    { odometerReadingId: null, receipt: { kind: "FUEL", ownMoney: false } },
    { odometerReadingId: null, receipt: { kind: "FUEL", ownMoney: true } },
    { odometerReadingId: null, receipt: { kind: "PURCHASE", ownMoney: true } },
    { odometerReadingId: null, receipt: { kind: "TIP", ownMoney: true } },
  ]) assert.equal(tipsOnlyMayViewPhoto(p), false, JSON.stringify(p));
});

test("indicators: the coordinator gets the jobs only - never trucks, and a single truck is refused; a Manager unchanged", () => {
  assert.deepEqual(indicatorsFor(true, undefined), { allowed: true, jobs: true, trucks: false, vehicleId: null });
  assert.deepEqual(indicatorsFor(true, null), { allowed: true, jobs: true, trucks: false, vehicleId: null });
  assert.deepEqual(indicatorsFor(true, "v1"), { allowed: false });
  assert.deepEqual(indicatorsFor(false, undefined), { allowed: true, jobs: true, trucks: true, vehicleId: null });
  assert.deepEqual(indicatorsFor(false, "v1"), { allowed: true, jobs: false, trucks: true, vehicleId: "v1" });
});

test("the routes: receipts read / check and the tip rates' GET use guardTipsOrManager; starting a batch stays Manager+, rate changes Admin", () => {
  for (const rel of ["../../app/api/receipts/route.ts", "../../app/api/receipts/[id]/route.ts", "../../app/api/receipts/photos/[id]/route.ts",
    "../../app/api/receipts/batches/[id]/no-asbestos/route.ts"]) {
    const s = src(rel);
    assert.match(s, /guardTipsOrManager\(\)/, rel);
    assert.doesNotMatch(s, /guard\("MANAGER"\)/, rel);
  }
  assert.match(src("../../app/api/receipts/[id]/route.ts"), /tipsOnly: g\.tipsOnly/, "the action gets tipsOnly");
  assert.match(src("../../app/api/receipts/photos/[id]/route.ts"), /g\.tipsOnly && !tipsOnlyMayViewPhoto/);
  const list = src("../../app/api/receipts/route.ts");
  assert.match(list, /officeList\(filters, \{ tipsOnly \}\)/);
  assert.match(list, /batchProjects.*tipsOnly \? FORBIDDEN\(\)/);
  assert.match(list, /indicatorsFor\(tipsOnly/);
  for (const rel of ["../../app/api/receipts/batches/route.ts", "../../app/api/receipts/batches/[id]/route.ts"]) {
    assert.match(src(rel), /guard\("MANAGER"\)/, rel);
    assert.doesNotMatch(src(rel), /guardTipsOrManager|guardOrCoordinator/, rel);
  }
  const rates = src("../../app/api/tip-rates/route.ts");
  assert.match(rates, /GET = withErrorHandling\(async \(\) => \{\s*const g = await guardTipsOrManager\(\)/);
  assert.match(rates, /POST = withErrorHandling\(async \(req: NextRequest\) => \{\s*const denied = await guard\("ADMIN"\)/);
  assert.match(src("../../app/api/tip-rates/[id]/route.ts"), /guard\("ADMIN"\)/);
});

test("the stores filter in the query for the coordinator", () => {
  const store = src("./store.ts");
  assert.match(store, /const f = filtersFor\(fIn, tipsOnly\)/);
  assert.match(store, /tipsOnly \? \{ kind: "TIP", ownMoney: false \}/);
  assert.match(store, /const wantOdo = !tipsOnly &&/);
  assert.match(store, /countToCheck\(\{ tipsOnly \}\)/);
  const office = src("./office.ts");
  assert.match(office, /opts\.tipsOnly && isOdo\) return \{ error: "Not found", status: 404 \}/);
  assert.match(office, /opts\.tipsOnly && !tipsOnlyMayAct\(/);
});
