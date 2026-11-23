// Bins (Ilies, 23 Nov 2026): what a phone may send (photo required), the status moves, which bin a delivery is, the
// over-fleet warning (information only), the tip docket suggestions and that a link reply carries no money. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIN_CONTENTS, BIN_SIZES, BIN_USES, LIMITS, OTHER, binAlertsOn, canMove, clientBinAlert, clientBinCounts, chooseBin, contentsLabel, daysOut, defaultLabel, binLabel, linkSafe, overFleet,
  parseCorrection, parseDelivery, parsePickup, tipCandidates, type BinLinkOptionsDTO, type TipReceipt,
} from "./rules";
import { COORDINATOR_PAGES, isCoordinatorPage } from "../roles";
import { assertNoMoney } from "../moneyGuard";

const id = (n: number) => `cm${String(n).padStart(23, "0")}`;
const deliver = (x: Record<string, unknown> = {}) => ({ photoIds: [id(1)], projectId: id(2), use: "CLIENT", size: "M15", contents: "Mixed C&D", ...x });

test("a delivery needs a photo, the job, client's / ours, a size and what's going in it", () => {
  assert.deepEqual(parseDelivery(deliver({ photoIds: [] })), { error: "Take a photo of the bin first." });
  assert.ok("error" in parseDelivery(deliver({ photoIds: undefined })));
  assert.ok("error" in parseDelivery(deliver({ photoIds: [id(1), id(3), id(4)] })), `at most ${LIMITS.photosPerMove} photos`);
  assert.ok("error" in parseDelivery(deliver({ projectId: "" })));
  assert.ok("error" in parseDelivery(deliver({ projectId: "../../etc" })));
  assert.ok("error" in parseDelivery(deliver({ use: "CUSTOMER" })), "there is no other-customer option");
  assert.ok("error" in parseDelivery(deliver({ size: "M20" })));
  assert.ok("error" in parseDelivery(deliver({ contents: "Gold" })));
  const ok = parseDelivery(deliver({ binId: id(7), contentsNote: "  mostly  plasterboard " }));
  assert.ok(!("error" in ok));
  if (!("error" in ok)) {
    assert.equal(ok.use, "CLIENT");
    assert.equal(ok.binId, id(7));
    assert.equal(ok.contentsNote, "mostly plasterboard", "the note is tidied");
  }
  const noBin = parseDelivery(deliver({ binId: "nope" }));
  assert.ok(!("error" in noBin) && noBin.binId === null, "a bad bin id is just no bin (the store decides)");
});

test("Other needs a note; no amount in the note", () => {
  assert.deepEqual(parseDelivery(deliver({ contents: OTHER })), { error: "Say what's going in it." });
  assert.ok(!("error" in parseDelivery(deliver({ contents: OTHER, contentsNote: "timber" }))));
  assert.ok("error" in parseDelivery(deliver({ contentsNote: "$450 a lift" })), "a dollar figure is refused");
  assert.equal(contentsLabel(OTHER, "timber"), "Other - timber");
  assert.equal(contentsLabel("VENM / ENM", null), "VENM / ENM");
});

test("a pick-up needs the bin and a photo", () => {
  assert.deepEqual(parsePickup({ photoIds: [id(1)] }), { error: "Which bin are you picking up?" });
  assert.deepEqual(parsePickup({ movementId: id(5), photoIds: [] }), { error: "Take a photo of the bin first." });
  assert.deepEqual(parsePickup({ movementId: id(5), photoIds: [id(1), id(1)] }), { movementId: id(5), photoIds: [id(1)] });
});

test("status moves: on site -> picked up; the office cancels or puts a wrong pick-up back; cancelled stays cancelled", () => {
  assert.ok(canMove("ON_SITE", "PICKED_UP"));
  assert.ok(canMove("ON_SITE", "CANCELLED"));
  assert.ok(canMove("PICKED_UP", "ON_SITE"));
  assert.ok(canMove("PICKED_UP", "CANCELLED"));
  assert.ok(!canMove("PICKED_UP", "PICKED_UP"), "no double pick-up");
  assert.ok(!canMove("ON_SITE", "ON_SITE"), "no double delivery of the same entry");
  assert.ok(!canMove("CANCELLED", "ON_SITE"));
  assert.ok(!canMove("CANCELLED", "PICKED_UP"));
  assert.ok(!canMove("NOPE", "PICKED_UP"));
});

// Ilies's fleet (corrected 23 Nov 2026): 2 x 15 m³, 2 x 11 m³, 1 x 9 m³, 1 x 8 m³, hook bin count unknown.
const FLEET = [
  { id: id(15), size: "M15" }, { id: id(16), size: "M15" }, { id: id(11), size: "M11" }, { id: id(12), size: "M11" },
  { id: id(9), size: "M9" }, { id: id(8), size: "M8" },
];

test("which bin: the one picked (if free), the only free one, ask when two are free, size only when none is", () => {
  assert.deepEqual(chooseBin({ size: "M15", binId: id(16) }, FLEET), { binId: id(16) });
  assert.ok("error" in chooseBin({ size: "M15", binId: id(9) }, FLEET), "a 9 m³ bin isn't a 15");
  assert.ok("error" in chooseBin({ size: "M15", binId: null }, FLEET), "two 15s free -> which one?");
  assert.deepEqual(chooseBin({ size: "M9", binId: null }, FLEET), { binId: id(9) }, "the only 9 is picked for you");
  assert.deepEqual(chooseBin({ size: "M15", binId: null }, FLEET.filter((b) => b.id !== id(15))), { binId: id(16) });
  assert.deepEqual(chooseBin({ size: "HOOK", binId: null }, FLEET), { binId: null }, "no hook bin registered - size only");
  assert.deepEqual(chooseBin({ size: "M8", binId: null }, []), { binId: null }, "every 8 m³ out - still allowed (warning)");
});

test("over-fleet: a warning when more of a size are out than owned - never a block", () => {
  assert.deepEqual(overFleet([{ size: "M15" }, { size: "M15" }, { size: "M11" }], FLEET), []);
  const w = overFleet([{ size: "M15" }, { size: "M15" }, { size: "M15" }, { size: "M9" }, { size: "HOOK" }], FLEET);
  assert.deepEqual(w.map((x) => [x.size, x.out, x.owned]), [["M15", 3, 2], ["HOOK", 1, 0]]);
  assert.match(w[0].text, /3 × 15 m³ out, but the register has 2/);
});

test("register names: tidy, at most 40, no amounts; the next default name skips ones taken", () => {
  assert.equal(binLabel("  15 m³   (1) "), "15 m³ (1)");
  assert.ok(typeof binLabel("") !== "string");
  assert.ok(typeof binLabel("x".repeat(41)) !== "string");
  assert.ok(typeof binLabel("Bin $500") !== "string");
  assert.equal(defaultLabel("M15", []), "15 m³ (1)");
  assert.equal(defaultLabel("M15", ["15 m³ (1)", "15 m³ (2)"]), "15 m³ (3)");
  assert.equal(defaultLabel("HOOK", ["Hook bin (2)"]), "Hook bin (3)");
});

test("a correction needs a reason and something to change", () => {
  assert.deepEqual(parseCorrection({ use: "OURS" }), { error: "Say why it's being corrected." });
  assert.deepEqual(parseCorrection({ reason: "driver tapped the wrong one" }), { error: "Nothing to change." });
  assert.deepEqual(parseCorrection({ reason: "wrong job", use: "OURS", binId: null }), { fields: { use: "OURS", binId: null }, reason: "wrong job" });
  assert.ok("error" in parseCorrection({ reason: "x", use: "OURS" }), "a real reason");
  assert.ok("error" in parseCorrection({ reason: "price was $300", use: "OURS" }), "no amount in the reason");
});

// ---------- tip docket suggestions ----------

const H = 3_600_000;
const PICK = new Date("2026-11-20T03:00:00Z"); // 2pm Sydney, Fri 20 Nov
const move = { id: id(50), projectId: id(2), pickedUpAt: PICK, pickedUpLinkId: id(60), pickedUpByResourceId: id(61), tipRejectedIds: null as string | null };
const rc = (n: number, x: Partial<TipReceipt> = {}): TipReceipt => ({ id: id(100 + n), kind: "TIP", status: "READ", projectId: id(2), siteLinkId: id(70), sentByResourceId: id(71), sentAt: new Date(PICK.getTime() + 2 * H), docketAt: null, ...x });

test("tip docket candidates: same job, about 2 days after the pick-up, same driver first, nearest next", () => {
  const list = [
    rc(1, { sentAt: new Date(PICK.getTime() + 30 * H) }), // other driver, a day later
    rc(2, { siteLinkId: id(60), sentAt: new Date(PICK.getTime() + 20 * H) }), // the driver's own link
    rc(3, { sentAt: new Date(PICK.getTime() + 1 * H) }), // nearest, other driver
    rc(4, { projectId: id(3) }), // another job
    rc(5, { status: "REJECTED" }), // set aside in Receipts
    rc(6, { kind: "FUEL" }),
    rc(7, { sentAt: new Date(PICK.getTime() + 60 * H) }), // too late (> 2 days)
    rc(8, { sentAt: new Date(PICK.getTime() - 12 * H) }), // well before the pick-up
    rc(9, { sentAt: new Date(PICK.getTime() + 70 * H), docketAt: new Date(PICK.getTime() + 5 * H) }), // sent late, docket dated in time
    rc(10, { sentByResourceId: id(61), sentAt: new Date(PICK.getTime() + 40 * H) }), // same person, another link
    rc(11, { sentAt: new Date(PICK.getTime() - 2 * H) }), // tapped pick-up after tipping - a little before is fine
  ];
  const got = tipCandidates(move, list, new Set(), 10);
  assert.deepEqual(got.map((r) => r.id), [id(102), id(110), id(103), id(111), id(109), id(101)]);
  assert.deepEqual(got.map((r) => r.sameDriver), [true, true, false, false, false, false]);
  assert.deepEqual(tipCandidates(move, list, new Set([id(102)]), 2).map((r) => r.id), [id(110), id(103)], "one already matched to another bin is left out; max respected");
  assert.ok(!tipCandidates({ ...move, tipRejectedIds: JSON.stringify([id(102)]) }, list, new Set()).some((r) => r.id === id(102)), "one a person said isn't this bin's is left out");
  assert.deepEqual(tipCandidates({ ...move, pickedUpAt: null }, list, new Set()), [], "not picked up -> nothing");
});

// ---------- days out ----------

test("days out are Sydney calendar days", () => {
  assert.equal(daysOut(new Date("2026-11-20T21:00:00Z"), new Date("2026-11-21T05:00:00Z")), 0, "8am and 4pm Sat 21 Nov Sydney: same day");
  assert.equal(daysOut(new Date("2026-11-20T12:00:00Z"), new Date("2026-11-20T14:00:00Z")), 1, "11pm Fri -> 1am Sat Sydney: a day");
  assert.equal(daysOut(new Date("2026-11-16T00:00:00Z"), new Date("2026-11-23T00:00:00Z")), 7);
});

// ---------- no money on a link ----------

test("a link's options carry no dollar figure, and the lists the phone shows are money-free", () => {
  const dto: BinLinkOptionsDTO = {
    projects: [{ id: id(2), label: "Bondi Rd", mine: true }],
    uses: BIN_USES.map((u) => ({ ...u })),
    sizes: BIN_SIZES.map((s) => ({ key: s.key, label: s.label, free: [] })),
    contents: BIN_CONTENTS.map((c) => ({ ...c })),
    onSite: [{ id: id(50), projectId: id(2), project: "Bondi Rd", bin: "15 m³ (1)", size: "15 m³", use: "Client's bin", contents: "Mixed C&D", delivered: "Fri 20 Nov", days: "3 days", status: "On site" }],
    today: [],
  };
  assert.ok(linkSafe(dto));
  assert.ok(!linkSafe({ ...dto, price: "$450" }), "the guard catches a dollar figure");
  const keys = JSON.stringify(dto);
  assert.ok(!/price|rate|amount|cost|charge/i.test(Object.keys(dto.onSite[0]).join(",")), "no money field on a row");
  assert.ok(!/\$\d/.test(keys));
  assert.deepEqual(BIN_SIZES.map((s) => s.key), ["M15", "M11", "M9", "M8", "HOOK"], "the size list is fixed in code");
  assert.deepEqual(BIN_USES.map((u) => u.key), ["CLIENT", "OURS"], "client's bin or our bin - no other customer");
  assert.equal(BIN_CONTENTS[BIN_CONTENTS.length - 1].key, OTHER);
});

test("the coordinator has the Bins page (view only - every write is guard('MANAGER'))", () => {
  assert.ok((COORDINATOR_PAGES as readonly string[]).includes("/bins") && isCoordinatorPage("/bins?use=CLIENT"));
});

// ---------- client's bins are charged per bin (Ilies, 23 Nov 2026: "price per bin not days bins onsite") ----------

test("client's bins by job: a count of bins delivered, split on site / picked up - our bins and cancelled ones don't count", () => {
  const c = clientBinCounts([
    { projectId: "a", use: "CLIENT", status: "ON_SITE" },
    { projectId: "a", use: "CLIENT", status: "PICKED_UP" },
    { projectId: "a", use: "CLIENT", status: "PICKED_UP" },
    { projectId: "a", use: "CLIENT", status: "CANCELLED" },
    { projectId: "a", use: "OURS", status: "ON_SITE" },
    { projectId: "b", use: "OURS", status: "PICKED_UP" },
    { projectId: "c", use: "CLIENT", status: "PICKED_UP" },
  ]);
  assert.deepEqual(Object.fromEntries(c), { a: { delivered: 3, onSite: 1, pickedUp: 2 }, c: { delivered: 1, onSite: 0, pickedUp: 1 } });
  assert.ok(![...c.values()].some((x) => Object.keys(x).some((k) => /day/i.test(k))), "no days figure");
  // BN-009: the database's grouped counts give the same answer.
  const g = clientBinCounts([
    { projectId: "a", use: "CLIENT", status: "ON_SITE", n: 1 }, { projectId: "a", use: "CLIENT", status: "PICKED_UP", n: 2 },
    { projectId: "a", use: "CLIENT", status: "CANCELLED", n: 4 }, { projectId: "c", use: "CLIENT", status: "PICKED_UP", n: 1 },
    { projectId: "d", use: "CLIENT", status: "ON_SITE", n: 0 },
  ]);
  assert.deepEqual(Object.fromEntries(g), Object.fromEntries(c));
  assert.equal(clientBinCounts([{ projectId: "x", use: "CLIENT", status: "PICKED_UP", n: 12000 }]).get("x")?.delivered, 12000, "never capped");
});

// ---------- the phone alert to Alex ----------

test("a client's bin delivered: one quiet alert, words only - the job and the size, no amount", () => {
  const a = clientBinAlert({ use: "CLIENT", size: "M15", project: "Bondi Rd strip-out", projectId: id(2) });
  assert.ok(a);
  assert.equal(a!.title, "Client's bin delivered");
  assert.equal(a!.body, "Bondi Rd strip-out, 15 m³");
  assert.equal(a!.url, "/bins");
  assert.equal(a!.silent, true, "quiet");
  assert.equal(a!.tag, `bin-client-${id(2)}`.slice(0, 40), "BN-008: one tag per job - repeat deliveries replace one notification");
  assert.equal(clientBinAlert({ use: "CLIENT", size: "M8", project: "Bondi Rd strip-out", projectId: id(2) })!.tag, a!.tag, "the same job, the same tag");
  assert.notEqual(clientBinAlert({ use: "CLIENT", size: "M8", project: "Coogee", projectId: id(3) })!.tag, a!.tag, "another job, another tag");
  assert.ok(assertNoMoney(JSON.stringify(a)), "passes the money guard");
  const priced = clientBinAlert({ use: "CLIENT", size: "HOOK", project: "$450 Coogee job", projectId: id(3) });
  assert.ok(priced && assertNoMoney(JSON.stringify(priced)) && !priced.body.includes("$"), "a dollar figure in the job name is taken out");
  assert.equal(priced!.body, "Coogee job, Hook bin");
});

test("our bin sends nothing; the kill switch BIN_ALERTS=off stops the alert", () => {
  assert.equal(clientBinAlert({ use: "OURS", size: "M15", project: "Bondi Rd", projectId: id(2) }), null);
  assert.equal(clientBinAlert({ use: "", size: "M15", project: "Bondi Rd", projectId: id(2) }), null);
  assert.equal(binAlertsOn({}), true);
  assert.equal(binAlertsOn({ BIN_ALERTS: "on" }), true);
  assert.equal(binAlertsOn({ BIN_ALERTS: "off" }), false);
  assert.equal(binAlertsOn({ BIN_ALERTS: " OFF " }), false);
});