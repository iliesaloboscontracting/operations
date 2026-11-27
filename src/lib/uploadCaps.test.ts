// TL-001 / TL-003 / TL-004 (Ilies approved 27 Nov 2026): the in-progress cap per link, the Building Agent refused on every
// bins / tipper-load write, no amounts in an office reason. `npm test` (no database is touched).
import { test } from "node:test";
import assert from "node:assert/strict";
import { IN_FLIGHT_PER_LINK, beginUpload, uploadsInFlight } from "./uploadCaps";
import { AGENT_NO_WRITE, BinError, NO_AMOUNT_REASON, refuseAgent } from "./bins/store";
import { BUILDING_AGENT_EMAIL } from "./session";

test("at most 3 uploads in progress per link; a slot comes back once, other links are separate", () => {
  assert.equal(IN_FLIGHT_PER_LINK, 3);
  const key = `t:${Date.now()}`;
  const slots = [beginUpload(key), beginUpload(key), beginUpload(key)];
  assert.ok(slots.every(Boolean));
  assert.equal(beginUpload(key), null, "a fourth at once is refused");
  assert.ok(beginUpload(`${key}:other`), "another link isn't held up");
  slots[0]!();
  slots[0]!();
  assert.equal(uploadsInFlight(key), 2, "giving a slot back twice only counts once");
  const again = beginUpload(key);
  assert.ok(again, "a freed slot can be used");
  again!(); slots[1]!(); slots[2]!();
  assert.equal(uploadsInFlight(key), 0);
});

test("the Building Agent login is refused every bins / tipper-load write; everyone else passes", () => {
  assert.throws(() => refuseAgent({ id: "a", name: "Building Agent", email: BUILDING_AGENT_EMAIL }), (e: unknown) => e instanceof BinError && e.status === 403 && e.message === AGENT_NO_WRITE);
  assert.throws(() => refuseAgent({ email: ` ${BUILDING_AGENT_EMAIL.toUpperCase()} ` }), BinError, "case and spaces don't get round it");
  assert.doesNotThrow(() => refuseAgent({ email: "iliesa@loboscontracting.com.au" }));
  assert.doesNotThrow(() => refuseAgent(null));
  assert.equal(NO_AMOUNT_REASON, "Leave amounts out of the reason.");
});
