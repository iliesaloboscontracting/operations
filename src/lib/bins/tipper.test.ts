// Tipper loads (Ilies, 27 Nov 2026): what a driver's phone may send (photo required), which vehicles are our tippers,
// the prefill from the truck sign-in, the tip docket suggestions (the bins' own rules), client's loads by job, the
// quiet alert to Alex and its kill switches, and that a link reply carries no money. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIPPER_LIMITS, TIPPER_USES, clientLoadCounts, clientTipperAlert, isTipper, loadAsPickUp, parseTipperCorrection, parseTipperFlag, parseTipperLoad, prefillTipper,
  takenDockets, tipperAlertsOn, tipperList, tipperLoadsOn, type TipperLinkOptionsDTO,
} from "./tipperRules";
import { BIN_CONTENTS, OTHER, linkSafe, tipCandidates, type TipReceipt } from "./rules";

const id = (n: number) => `cm${String(n).padStart(23, "0")}`;
const load = (x: Record<string, unknown> = {}) => ({ photoIds: [id(1)], vehicleId: id(9), projectId: id(2), use: "CLIENT", contents: "Mixed C&D", ...x });
const veh = (name: string, x: Partial<{ id: string; type: string; ownership: string; active: boolean }> = {}) => ({ id: x.id ?? name, name, type: "VEHICLE", ownership: "OWNED", active: true, ...x });

test("a load needs a photo, the tipper, the job, client's / ours and what's in it", () => {
  assert.deepEqual(parseTipperLoad(load({ photoIds: [] })), { error: "Take a photo of the load first." });
  assert.ok("error" in parseTipperLoad(load({ photoIds: undefined })));
  assert.ok("error" in parseTipperLoad(load({ photoIds: [id(1), id(3), id(4)] })), `at most ${TIPPER_LIMITS.photosPerLoad} photos`);
  assert.deepEqual(parseTipperLoad(load({ vehicleId: "" })), { error: "Which tipper?" });
  assert.ok("error" in parseTipperLoad(load({ projectId: "../x" })));
  assert.ok("error" in parseTipperLoad(load({ use: "CUSTOMER" })));
  assert.ok("error" in parseTipperLoad(load({ contents: "Gold" })));
  assert.ok("size" in load() === false, "no load size is asked for");
  const ok = parseTipperLoad(load({ contentsNote: "  mostly   brick ", size: "6t" }));
  assert.ok(!("error" in ok));
  if (!("error" in ok)) {
    assert.equal(ok.contentsNote, "mostly brick", "the note is tidied to one line");
    assert.ok(!("size" in ok), "a size sent anyway is ignored");
    assert.deepEqual(ok.photoIds, [id(1)]);
  }
  assert.deepEqual(parseTipperLoad(load({ photoIds: [id(1), id(1)] })).hasOwnProperty("error"), false, "the same photo twice is one photo");
});

test("Other needs a note; no amount in the note; the same waste list as bins", () => {
  assert.deepEqual(parseTipperLoad(load({ contents: OTHER })), { error: "Say what's in the load." });
  assert.ok(!("error" in parseTipperLoad(load({ contents: OTHER, contentsNote: "green waste" }))));
  assert.ok("error" in parseTipperLoad(load({ contentsNote: "$300 a load" })), "a dollar figure is refused");
  assert.ok("error" in parseTipperLoad(load({ contentsNote: "$ 300" })));
  assert.ok(!("error" in parseTipperLoad(load({ contentsNote: "line one\nline two" }))), "a new line becomes a space");
  assert.deepEqual(TIPPER_USES.map((u) => u.key), ["CLIENT", "OURS"]);
});

test("our tippers: owned, active VEHICLEs named Tipper - unless the office set it; never the hook truck, a ute, a hire", () => {
  const fleet = [
    veh("Tipper - CN03RK"), veh("Tipper - DD50LV"), veh("7 Seater"), veh("Hook Truck - XO20TL"), veh("Hino Bin Carrier - YMT57B"),
    veh("Tipper - XO78CN", { active: false }), veh("Hired tipper", { ownership: "HIRED" }), veh("Tipper hire", { type: "HIRE" }), veh("Ford Courier - CE49ZU"),
  ];
  const list = tipperList(fleet, new Map());
  assert.deepEqual(list.filter((v) => v.tipper).map((v) => v.name), ["Tipper - CN03RK", "Tipper - DD50LV"]);
  assert.ok(!list.some((v) => v.name === "Tipper - XO78CN"), "an inactive vehicle isn't in the list at all");
  assert.ok(!list.some((v) => v.name === "Hired tipper" || v.name === "Tipper hire"), "hired vehicles aren't ours");
  // The office says the hook truck is one, and a named tipper isn't.
  const set = tipperList(fleet, new Map([["Hook Truck - XO20TL", true], ["Tipper - DD50LV", false]]));
  assert.deepEqual(set.filter((v) => v.tipper).map((v) => v.name), ["Hook Truck - XO20TL", "Tipper - CN03RK"]);
  assert.ok(set.find((v) => v.name === "Tipper - DD50LV")?.set, "the office's setting is marked");
  assert.ok(!isTipper(veh("Tipper - Z", { active: false }), true), "an inactive vehicle is never a tipper, even when set");
  assert.ok(!isTipper(veh("Tipper - Z", { ownership: "HIRED" }), true));
  assert.ok(isTipper(veh("TIPPER 2"), undefined), "the name match ignores case");
});

test("the tipper is prefilled from today's truck sign-in - the latest that is a tipper", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 27, h));
  const tippers = new Set(["T1", "T2"]);
  assert.equal(prefillTipper([], tippers), null);
  assert.equal(prefillTipper([{ vehicleId: "UTE", signInAt: t(1), status: "CONFIRMED", removedAt: null }], tippers), null, "a ute sign-in prefills nothing");
  assert.equal(prefillTipper([
    { vehicleId: "T1", signInAt: t(1), status: "CONFIRMED", removedAt: null },
    { vehicleId: "T2", signInAt: t(3), status: "CONFIRMED", removedAt: null },
    { vehicleId: "UTE", signInAt: t(4), status: "CONFIRMED", removedAt: null },
  ], tippers), "T2");
  assert.equal(prefillTipper([{ vehicleId: "T1", signInAt: t(1), status: "REJECTED", removedAt: null }], tippers), null, "a rejected sign-in doesn't count");
  assert.equal(prefillTipper([{ vehicleId: "T1", signInAt: t(1), status: "CONFIRMED", removedAt: t(2) }], tippers), null, "a removed sign-in doesn't count");
});

test("tip docket: the bins' suggestion rules - same job, same driver first, nearest next; one docket, one bin or load", () => {
  const loadedAt = new Date("2026-11-27T01:00:00Z");
  const l = { id: id(40), projectId: id(2), loadedAt, linkId: "LINK", loadedByResourceId: "D", tipRejectedIds: null, status: "LOGGED" };
  const r = (n: number, x: Partial<TipReceipt> = {}): TipReceipt => ({ id: id(n), kind: "TIP", status: "READ", projectId: id(2), siteLinkId: "OTHER", sentByResourceId: null, sentAt: new Date(loadedAt.getTime() + 2 * 3_600_000), docketAt: null, ...x });
  const pool = [
    r(1, { sentAt: new Date(loadedAt.getTime() + 30 * 60_000) }),
    r(2, { siteLinkId: "LINK", sentAt: new Date(loadedAt.getTime() + 5 * 3_600_000) }),
    r(3, { projectId: id(7) }),
    r(4, { kind: "FUEL" }),
    r(5, { status: "REJECTED" }),
    r(6, { sentAt: new Date(loadedAt.getTime() + 4 * 86_400_000) }),
  ];
  const got = tipCandidates(loadAsPickUp(l), pool, new Set());
  assert.deepEqual(got.map((x) => x.id), [id(2), id(1)], "same driver first, then nearest; other job / fuel / rejected / too late left out");
  assert.ok(got[0].sameDriver);
  assert.deepEqual(tipCandidates(loadAsPickUp({ ...l, tipRejectedIds: JSON.stringify([id(2)]) }), pool, new Set()).map((x) => x.id), [id(1)], "one a person said isn't this load's stays out");
  const taken = takenDockets([{ id: "B1", tipReceiptId: id(1) }, { id: "B2", tipReceiptId: null }], [{ id: l.id, tipReceiptId: id(9) }, { id: "L2", tipReceiptId: id(2) }], l.id);
  assert.deepEqual([...taken].sort(), [id(1), id(2)].sort(), "dockets on a bin or another load are taken; this load's own isn't");
  assert.deepEqual(tipCandidates(loadAsPickUp(l), pool, taken), [], "nothing taken is suggested");
  assert.deepEqual(tipCandidates(loadAsPickUp({ ...l, status: "CANCELLED" }), pool, new Set()), [], "a cancelled load gets no suggestions");
});

test("client's loads by job: a count of client's loads - our loads and cancelled ones don't count", () => {
  const m = clientLoadCounts([
    { projectId: "A", use: "CLIENT", status: "LOGGED" }, { projectId: "A", use: "CLIENT", status: "LOGGED" },
    { projectId: "A", use: "OURS", status: "LOGGED" }, { projectId: "A", use: "CLIENT", status: "CANCELLED" },
    { projectId: "B", use: "CLIENT", status: "LOGGED", n: 3 }, { projectId: "C", use: "CLIENT", status: "LOGGED", n: 0 },
  ]);
  assert.equal(m.get("A"), 2);
  assert.equal(m.get("B"), 3, "a groupBy count is added as a number");
  assert.ok(!m.has("C"));
});

test("a client's load: one quiet alert, words only - the job and the tipper; our load sends nothing", () => {
  const a = clientTipperAlert({ use: "CLIENT", tipper: "Tipper - CN03RK", project: "12 Bondi Rd ($4,500 variation)", projectId: id(2) });
  assert.ok(a);
  assert.equal(a!.title, "Client's tipper load");
  assert.equal(a!.url, "/bins?tab=tipper");
  assert.equal(a!.tag, `tip-client-${id(2)}`.slice(0, 40), "one tag per job");
  assert.ok(a!.silent);
  assert.ok(a!.body.includes("Tipper - CN03RK") && a!.body.includes("Bondi Rd"));
  assert.ok(!/\$\s?\d/.test(JSON.stringify(a)), "the amount in the job name is taken out");
  assert.equal(clientTipperAlert({ use: "OURS", tipper: "T", project: "P", projectId: id(2) }), null);
});

test("kill switches: BIN_ALERTS=off or TIPPER_ALERTS=off stop the alert; TIPPER_LOADS=off turns the link side off", () => {
  assert.ok(tipperAlertsOn({}));
  assert.ok(!tipperAlertsOn({ BIN_ALERTS: "off" }));
  assert.ok(!tipperAlertsOn({ TIPPER_ALERTS: " OFF " }));
  assert.ok(tipperAlertsOn({ TIPPER_ALERTS: "on" }));
  assert.ok(tipperLoadsOn({}));
  assert.ok(!tipperLoadsOn({ TIPPER_LOADS: "off" }));
});

test("office corrections need a reason and something to change; the tipper switch is yes / no", () => {
  assert.deepEqual(parseTipperCorrection({ use: "OURS" }), { error: "Say why it's being corrected." });
  assert.deepEqual(parseTipperCorrection({ reason: "wrong job" }), { error: "Nothing to change." });
  assert.ok("error" in parseTipperCorrection({ reason: "it was $200", use: "OURS" }), "no amount in the reason");
  assert.ok("error" in parseTipperCorrection({ reason: "wrong", vehicleId: "x" }));
  assert.ok("error" in parseTipperCorrection({ reason: "wrong", contentsNote: "$5" }));
  const ok = parseTipperCorrection({ reason: "  wrong   truck ", vehicleId: id(9), contentsNote: "" });
  assert.deepEqual(ok, { fields: { vehicleId: id(9), contentsNote: null }, reason: "wrong truck" });
  assert.ok("error" in parseTipperFlag({}));
  assert.ok("error" in parseTipperFlag({ tipper: "yes" }));
  assert.ok("error" in parseTipperFlag({ tipper: null }), "there's no 'unset' - set it the other way to undo");
  assert.deepEqual(parseTipperFlag({ tipper: true, reason: " new truck " }), { tipper: true, reason: "new truck" });
});

test("a driver link's tipper options carry no dollar figure", () => {
  const dto: TipperLinkOptionsDTO = {
    tippers: [{ id: id(9), label: "Tipper - CN03RK" }], prefill: id(9),
    projects: [{ id: id(2), label: "Bondi Rd", mine: true }],
    uses: TIPPER_USES.map((u) => ({ ...u })), contents: BIN_CONTENTS.map((c) => ({ ...c })),
    today: [{ id: id(40), tipper: "Tipper - CN03RK", project: "Bondi Rd", use: "Client's load", contents: "Mixed C&D", at: "Fri 27 Nov, 9:14 am", status: "Logged" }],
  };
  assert.ok(linkSafe(dto));
  assert.ok(!linkSafe({ ...dto, price: "$450" }));
  assert.ok(!/price|rate|amount|cost|charge|tonne/i.test(Object.keys(dto.today[0]).join(",")), "no money field on a row");
});
