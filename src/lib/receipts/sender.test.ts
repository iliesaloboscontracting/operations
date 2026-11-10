// Who was on the truck (Ilies, 10 Nov 2026): a tip docket or fuel receipt naming one of our trucks is To check
// when people were signed in on that truck at the time and the link's owner wasn't one of them. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSender, hasClockTime, onTruckAt, senderMoments, type TruckSignIn } from "./checks";
import { senderCheck, type SenderFacts } from "./senderStore";
import { vehicleForRego } from "./tipStore";

const H = 3_600_000;
// Tue 3 Nov 2026, Sydney is UTC+11: 7:24am = 20:24Z the day before.
const at = (sydney: string) => new Date(new Date(`2026-11-03T${sydney}:00Z`).getTime() - 11 * H);
const sentAt = at("09:10");
const TRUCK = "truck-xo20tl", OTHER_TRUCK = "truck-dd50lv";
const TRUCKS = [{ id: TRUCK, rego: "XO20TL" }, { id: OTHER_TRUCK, rego: "DD50LV" }];
const turori = { id: "res-turori", name: "Turori Tester" };
const arvin = { id: "res-arvin", name: "Arvin Tester" };
const signIn = (who: { id: string; name: string }, inAt: Date, outAt: Date | null = null, vehicleId = TRUCK) =>
  ({ resourceId: who.id, workerName: who.name, signInAt: inAt, signOutAt: outAt, vehicleId });

// A stand-in database: truck sign-ins (filtered like the query) and the trucks' names.
function db(rows: ReturnType<typeof signIn>[]) {
  return {
    siteAttendance: {
      findMany: async (a: { where: { vehicleId: string; signInAt: { lte: Date; gte: Date } } }) =>
        rows.filter((r) => r.vehicleId === a.where.vehicleId && r.signInAt <= a.where.signInAt.lte && r.signInAt >= a.where.signInAt.gte),
    },
    resource: { findUnique: async (a: { where: { id: string } }) => ({ [TRUCK]: { name: "Hook Truck - XO20TL", identifier: "XO20TL" }, [OTHER_TRUCK]: { name: "Tipper - DD50LV", identifier: null } })[a.where.id] ?? null },
  } as never;
}
const tip = (who: { id: string; name: string }, rego: string, x: Partial<SenderFacts> = {}): SenderFacts =>
  ({ kind: "TIP", sentByResourceId: who.id, sentBy: who.name, sentAt, docketAt: null, vehicleId: vehicleForRego(rego, TRUCKS), ...x });

test("the link's owner signed in on the truck -> no flag", async () => {
  assert.equal(await senderCheck(tip(turori, "XO20TL"), db([signIn(turori, at("06:30"))])), null);
});

test("someone else signed in on the truck -> To check, naming them, the truck and the time", async () => {
  const hit = await senderCheck(tip(turori, "XO 20 TL"), db([signIn(arvin, at("07:24"))]));
  assert.ok(hit);
  assert.match(hit.reason, /^Sent on Turori Tester's link - Arvin Tester was signed in on XO20TL at 9:10\s?am \(when it was sent\)$/);
  assert.deepEqual(hit.onTruck, ["Arvin Tester"]);
  assert.ok(!/\$/.test(hit.reason), "no money in the note");
});

test("nobody signed in on the truck -> no flag (drivers don't always scan the truck QR)", async () => {
  assert.equal(await senderCheck(tip(turori, "XO20TL"), db([])), null);
  assert.equal(await senderCheck(tip(turori, "XO20TL"), db([signIn(arvin, at("07:24"), null, OTHER_TRUCK)])), null, "only on another truck");
  assert.equal(await senderCheck(tip(turori, "XO20TL"), db([signIn(arvin, at("06:00"), at("08:00"))])), null, "signed out before it was sent");
  assert.equal(await senderCheck(tip(turori, "XO20TL"), db([signIn(arvin, at("09:30"))])), null, "signed in after it was sent");
});

test("the owner and someone else both on the truck -> no flag", async () => {
  assert.equal(await senderCheck(tip(turori, "XO20TL"), db([signIn(arvin, at("06:00")), signIn(turori, at("06:05"))])), null);
});

test("an unknown rego (or none) -> no flag", async () => {
  const rows = [signIn(arvin, at("07:24"))];
  assert.equal(vehicleForRego("ABC123", TRUCKS), null);
  assert.equal(await senderCheck(tip(turori, "ABC123"), db(rows)), null);
  assert.equal(await senderCheck(tip(turori, ""), db(rows)), null);
});

test("FUEL: the picked truck (vehicleId) is checked the same way", async () => {
  const fuel = (who: { id: string; name: string }): SenderFacts => ({ kind: "FUEL", sentByResourceId: who.id, sentBy: who.name, sentAt, docketAt: null, vehicleId: OTHER_TRUCK });
  const rows = [signIn(arvin, at("05:50"), null, OTHER_TRUCK)];
  const hit = await senderCheck(fuel(turori), db(rows));
  assert.match(hit?.reason ?? "", /Turori Tester's link - Arvin Tester was signed in on DD50LV/);
  assert.equal(await senderCheck(fuel(arvin), db(rows)), null, "the driver on the truck sending his own fuel");
  assert.equal(await senderCheck({ ...fuel(turori), kind: "PURCHASE" }, db(rows)), null, "a purchase is never checked");
});

test("the docket's own time counts when it's the same day; the owner on the truck at either time clears it", async () => {
  // Arvin drove 6-8am (the docket at 7:24); Turori took the truck at 8:30 and sent it at 9:10 on his link.
  const rows = [signIn(arvin, at("06:00"), at("08:00")), signIn(turori, at("08:30"))];
  assert.equal(await senderCheck(tip(turori, "XO20TL", { docketAt: at("07:24") }), db(rows)), null, "Turori was on it when he sent it");
  // Turori never on it: the docket time names Arvin.
  const hit = await senderCheck(tip(turori, "XO20TL", { docketAt: at("07:24") }), db([signIn(arvin, at("06:00"), at("08:00"))]));
  assert.match(hit?.reason ?? "", /Arvin Tester was signed in on XO20TL at 7:24\s?am \(the docket's time\)/);
  // A docket from yesterday isn't checked at its own time (only when it was sent).
  assert.deepEqual(senderMoments(sentAt, new Date(at("07:24").getTime() - 24 * H)).map((m) => m.what), ["sent"]);
  assert.deepEqual(senderMoments(sentAt, at("07:24")).map((m) => m.what), ["docket", "sent"]);
  assert.ok(hasClockTime("2026-11-03T07:24") && !hasClockTime("2026-11-03"), "a date alone is no time to check");
});

test("a sign-in left open counts for 16 hours only; several people are all named", () => {
  const s: TruckSignIn = { resourceId: "x", workerName: "X", signInAt: at("05:00"), signOutAt: null };
  assert.ok(onTruckAt(s, at("20:59")));
  assert.ok(!onTruckAt(s, new Date(at("05:00").getTime() + 17 * H)));
  const two = decideSender({
    ownerId: turori.id, ownerName: turori.name, truck: "XO20TL", moments: [{ at: sentAt, what: "sent" }],
    signIns: [signIn(arvin, at("07:00")), { ...signIn({ id: "res-b", name: "Bob Tester" }, at("07:10")) }], time: () => "9:10am",
  });
  assert.equal(two?.reason, "Sent on Turori Tester's link - Arvin Tester and Bob Tester were signed in on XO20TL at 9:10am (when it was sent)");
  assert.equal(decideSender({ ownerId: null, ownerName: "Yard", truck: "XO20TL", moments: [{ at: sentAt, what: "sent" }], signIns: [signIn(arvin, at("07:00"))], time: () => "" }), null, "a link with no owner isn't compared");
});
