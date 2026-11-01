// CO-001: role ranks fail closed. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK, UNKNOWN_RANK, rankAtLeast, rankOf } from "./roleRank";
import { toPublicResource } from "./serializeResource";

test("known roles keep their order", () => {
  assert.ok(rankAtLeast("ADMIN", "MANAGER") && rankAtLeast("MANAGER", "MANAGER") && rankAtLeast("VIEWER", "VIEWER"));
  assert.ok(!rankAtLeast("VIEWER", "MANAGER") && !rankAtLeast("MANAGER", "ADMIN"));
  for (const r of ["TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) assert.ok(!rankAtLeast(r, "VIEWER"), `${r} is below VIEWER`);
});

test("an unknown role (a rollback, a typo, anything) is refused by every level", () => {
  for (const r of ["COORDINATOR", "BOGUS", "admin", "", null, undefined, "toString", "__proto__", "constructor"]) {
    assert.equal(rankOf(r as string), UNKNOWN_RANK, String(r));
    for (const min of Object.keys(RANK)) assert.ok(!rankAtLeast(r as string, min), `${String(r)} vs ${min}`);
  }
});

test("money is stripped for an unknown role, as for the lowest", () => {
  const r = toPublicResource({ name: "Excavator", dailyRateExGst: 900, rate: 1, ordinaryRate: 50 } as Record<string, unknown>, "COORDINATOR" as never);
  assert.deepEqual(r, { name: "Excavator" });
});
