// Vehicle & plant pre-start checks (stage 1, 8 Nov 2026) - the plain rules. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKLISTS, PLANT_PRE, TRUCK_POST, TRUCK_PRE, TRUCK_WALKAROUND, answerLabel, checklistFor, walkaroundSlotsFor } from "./checklists";
import {
  LIMITS, alertDecision, alertFor, alertMessage, canMove, capNotice, capsFull, cleanText, firstName, marksDown, offerBackToAvailable, photoCapFull, photoPrecheck, photoRefusal, photoWaived,
  sortFaults, validateSubmission, validateWalkaround, walkaroundCutoff, walkaroundExpired, walkaroundRequired, worstPriority,
} from "./rules";
import { assertNoMoney } from "../moneyGuard";
import { faultsWorker, isCoordinatorPage, isYardPage } from "../roles";

const allOk = (list = TRUCK_PRE) => Object.fromEntries(list.items.map((i) => [i.key, "OK"]));
const err = (r: ReturnType<typeof validateSubmission>) => (r.ok ? "" : r.error);

test("the checklist is chosen by resource type; plant waits for stage 2", () => {
  assert.equal(checklistFor("VEHICLE", "PRE")?.id, "truck-pre.v1");
  assert.equal(checklistFor("VEHICLE", "POST")?.id, "truck-post.v1");
  assert.equal(checklistFor("EQUIPMENT", "PRE"), null);
  assert.equal(checklistFor("EQUIPMENT", "PRE", { plant: true })?.id, "plant-pre.v1");
  assert.equal(checklistFor("ATTACHMENT", "POST", { plant: true })?.id, "plant-post.v1");
  assert.equal(checklistFor("PERSONNEL", "PRE", { plant: true }), null);
  assert.equal(checklistFor("HIRE", "PRE"), null);
  assert.equal(TRUCK_PRE.items.length, 12);
  assert.equal(TRUCK_POST.items.length, 4);
  assert.equal(PLANT_PRE.items.length, 13);
  for (const c of Object.values(CHECKLISTS)) assert.equal(new Set(c.items.map((i) => i.key)).size, c.items.length, `${c.id}: keys unique`);
});

test("question items read No / Yes - report it", () => {
  const q = TRUCK_POST.items.find((i) => i.key === "new-damage")!;
  assert.equal(answerLabel(q, "OK"), "No");
  assert.match(answerLabel(q, "FAULT"), /^Yes/);
  assert.equal(answerLabel(TRUCK_PRE.items[0], "OK"), "OK");
  assert.equal(answerLabel(TRUCK_PRE.items[0], "FAULT"), "Fault");
  assert.equal(answerLabel(TRUCK_PRE.items[0], "NA"), "N/A");
});

test("every item must be answered with OK / FAULT / NA", () => {
  assert.ok(validateSubmission(TRUCK_PRE, { answers: allOk() }, []).ok);
  const missing = allOk(); delete missing.tyres;
  assert.match(err(validateSubmission(TRUCK_PRE, { answers: missing }, [])), /Tyres/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers: { ...allOk(), tyres: "MAYBE" } }, [])), /Tyres/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers: { ...allOk(), extra: "OK" } }, [])), /changed/);
  assert.equal(validateSubmission(TRUCK_PRE, {}, []).ok, false);
  assert.equal(validateSubmission(TRUCK_PRE, { answers: [] }, []).ok, false);
  const na = validateSubmission(TRUCK_PRE, { answers: { ...allOk(), tipper: "NA" } }, []);
  assert.ok(na.ok && na.value.answers.find((a) => a.key === "tipper")?.answer === "NA");
});

test("a fault needs words (3+), a priority and at least one photo", () => {
  const answers = { ...allOk(), tyres: "FAULT" };
  const good = { itemKey: "tyres", description: "Front left flat", priority: "HIGH", mediaIds: ["m1"] };
  const r = validateSubmission(TRUCK_PRE, { answers, faults: [good] }, []);
  assert.ok(r.ok && r.value.faults[0].itemLabel === "Tyres and wheel nuts" && r.value.faults[0].priority === "HIGH");
  assert.match(err(validateSubmission(TRUCK_PRE, { answers }, [])), /Tell us/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers, faults: [{ ...good, description: "no" }] }, [])), /Say what's wrong/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers, faults: [{ ...good, priority: "BAD" }] }, [])), /how bad/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers, faults: [{ ...good, mediaIds: [] }] }, [])), /photo/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers, faults: [{ ...good, mediaIds: undefined }] }, [])), /photo/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers, faults: [{ ...good, mediaIds: ["../x"] }] }, [])), /photo/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers, faults: [{ ...good, mediaIds: ["1", "2", "3", "4", "5", "6", "7"] }] }, [])), /At most/);
  // A fault on an item answered OK, a second fault on the same item, a photo used twice.
  assert.match(err(validateSubmission(TRUCK_PRE, { answers: allOk(), faults: [good] }, [])), /isn't marked/);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers, faults: [good, { ...good, mediaIds: ["m2"] }] }, [])), /One fault/);
  const two = { ...answers, lights: "FAULT" };
  assert.match(err(validateSubmission(TRUCK_PRE, { answers: two, faults: [good, { ...good, itemKey: "lights" }] }, [])), /one fault only/);
  for (const p of ["LOW", "HIGH", "URGENT", "DO_NOT_USE"]) assert.ok(validateSubmission(TRUCK_PRE, { answers, faults: [{ ...good, priority: p }] }, []).ok, p);
});

test("the words are capped and lose any dollar amount", () => {
  const long = cleanText("x".repeat(900), LIMITS.description);
  assert.equal(long.length, 500);
  const m = cleanText("Quote was $450 to fix the mirror", 500);
  assert.ok(assertNoMoney(m) && /mirror/.test(m), m);
  assert.equal(cleanText(42, 500), "");
  const r = validateSubmission(TRUCK_PRE, { answers: { ...allOk(), mirrors: "FAULT" }, faults: [{ itemKey: "mirrors", description: "Cracked $1,200 windscreen", priority: "LOW", mediaIds: ["a"] }] }, []);
  assert.ok(r.ok && assertNoMoney(r.value.faults[0].description));
  assert.equal(firstName("  Juan  Carlos Perez "), "Juan");
});

test("'Still there' only for the machine's open faults, and it covers the Fault answer on its item", () => {
  const open = [{ id: "f1", itemKey: "tyres" }, { id: "f2", itemKey: null }];
  const r = validateSubmission(TRUCK_PRE, { answers: { ...allOk(), tyres: "FAULT" }, stillThere: ["f1"] }, open);
  assert.ok(r.ok && r.value.stillThere[0] === "f1" && r.value.faults.length === 0);
  assert.match(err(validateSubmission(TRUCK_PRE, { answers: allOk(), stillThere: ["zz"] }, open)), /fixed or changed/);
  assert.ok(validateSubmission(TRUCK_PRE, { answers: allOk(), stillThere: ["f2", "f2"] }, open).ok);
  // A sighting on another item doesn't cover this one.
  assert.match(err(validateSubmission(TRUCK_PRE, { answers: { ...allOk(), lights: "FAULT" }, stillThere: ["f1"] }, open)), /Tell us/);
  assert.equal(validateSubmission(TRUCK_PRE, { answers: allOk(), stillThere: "f1" }, open).ok, false);
});

test("Do not use and Urgent push; Low and High don't", () => {
  assert.deepEqual(alertFor("DO_NOT_USE"), { urgency: "high", sticky: true });
  assert.deepEqual(alertFor("URGENT"), { urgency: "high", sticky: true });
  assert.equal(alertFor("HIGH"), null);
  assert.equal(alertFor("LOW"), null);
});

test("Do not use marks it DOWN unless it already is", () => {
  assert.equal(marksDown("DO_NOT_USE", "AVAILABLE"), true);
  assert.equal(marksDown("DO_NOT_USE", "ON_SITE"), true);
  assert.equal(marksDown("DO_NOT_USE", "DOWN"), false);
  assert.equal(marksDown("URGENT", "AVAILABLE"), false);
});

test("back to Available: only if this fault set it DOWN, it's still DOWN and no other open Do-not-use fault", () => {
  const at = new Date("2026-11-08T01:00:00.123Z");
  const f = { id: "a", markedDown: true, markedDownAt: at };
  const DOWN = { status: "DOWN", updatedAt: at };
  assert.equal(offerBackToAvailable(f, DOWN, [{ id: "a", priority: "DO_NOT_USE", status: "OPEN" }]), true);
  assert.equal(offerBackToAvailable({ ...f, markedDown: false }, DOWN, []), false);
  assert.equal(offerBackToAvailable(f, { status: "AVAILABLE", updatedAt: at }, []), false);
  assert.equal(offerBackToAvailable(f, null, []), false);
  assert.equal(offerBackToAvailable(f, DOWN, [{ id: "b", priority: "DO_NOT_USE", status: "IN_HAND" }]), false);
  assert.equal(offerBackToAvailable(f, DOWN, [{ id: "b", priority: "DO_NOT_USE", status: "FIXED" }]), true);
  assert.equal(offerBackToAvailable(f, DOWN, [{ id: "b", priority: "URGENT", status: "OPEN" }]), true);
});

test("PS-008: a later change to the machine (an unrelated Down, any edit) stops back to Available", () => {
  const at = new Date("2026-11-08T01:00:00.123Z");
  const f = { id: "a", markedDown: true, markedDownAt: at };
  assert.equal(offerBackToAvailable(f, { status: "DOWN", updatedAt: new Date(at.getTime() + 1) }, []), false);
  assert.equal(offerBackToAvailable(f, { status: "DOWN", updatedAt: at.toISOString() }, []), true); // the DTO's string form
  assert.equal(offerBackToAvailable({ ...f, markedDownAt: null }, { status: "DOWN", updatedAt: at }, []), false); // made before PS-008
});

test("PS-001 / PS-012: photo caps - sign-in 30, per machine a day 15 walk-around / 65 fault, all 400, same photo twice, phone 60", () => {
  const ok = { role: "FAULT" as const, signIn: 1, roleMachineDay: 1, allDay: 1, deviceDay: 1, sameOnSignIn: 1 };
  const walk = { ...ok, role: "WALKAROUND" as const };
  assert.equal(photoRefusal(ok), null);
  assert.equal(photoRefusal({ ...ok, signIn: 30, roleMachineDay: 65, allDay: 400, deviceDay: 60 }), null);
  assert.equal(photoRefusal({ ...walk, roleMachineDay: 15 }), null);
  assert.equal(photoRefusal({ ...ok, signIn: 31 })?.status, 429);
  assert.equal(photoRefusal({ ...ok, signIn: 31 })?.capFull, undefined); // the sign-in's own cap isn't "the day is full"
  assert.deepEqual([photoRefusal({ ...ok, roleMachineDay: 66 })?.cap, photoRefusal({ ...ok, roleMachineDay: 66 })?.status], ["FAULT", 429]);
  assert.match(photoRefusal({ ...ok, roleMachineDay: 66 })?.error ?? "", /Urgent/);
  assert.equal(photoRefusal({ ...walk, roleMachineDay: 16 })?.cap, "WALKAROUND");
  assert.equal(photoRefusal({ ...walk, roleMachineDay: 16 })?.capFull, true);
  assert.equal(photoRefusal({ ...ok, allDay: 401 })?.cap, "ALL");
  assert.equal(photoRefusal({ ...walk, allDay: 401 })?.cap, "ALL");
  assert.equal(photoRefusal({ ...ok, deviceDay: 61 })?.status, 429);
  assert.equal(photoRefusal({ ...ok, sameOnSignIn: 2 })?.status, 409);
  assert.equal(LIMITS.walkaroundPerMachineDay, 15);
  assert.equal(LIMITS.faultPhotosPerMachineDay, 65);
  assert.equal(LIMITS.photosAllDay, 400);
});

test("PS-002: one alert per machine per 15 minutes, 6 a day; one message per check", () => {
  const now = new Date("2026-11-08T03:00:00Z");
  const ago = (m: number) => new Date(now.getTime() - m * 60_000);
  const u = (m: number) => ({ at: ago(m), doNotUse: false });
  assert.equal(alertDecision([], now), "SENT");
  assert.equal(alertDecision([u(14)], now), "HELD_RECENT");
  assert.equal(alertDecision([u(15)], now), "SENT");
  assert.equal(alertDecision([u(20), u(40), u(60), u(80), u(100), u(120)], now), "HELD_DAY");
  assert.equal(alertDecision([u(20), u(40), u(60), u(80), u(100)], now), "SENT");
  const f = (priority: string, markedDown = false) => ({ itemLabel: "Tyres", priority, description: "Flat", markedDown });
  assert.equal(alertMessage("Tipper", "Juan", [f("LOW"), f("HIGH")]), null);
  const one = alertMessage("Tipper", "Juan", [f("URGENT"), f("LOW")]);
  assert.ok(one && /Urgent - Tipper$/.test(one.title) && !/Low/.test(one.body));
  const two = alertMessage("Tipper", "Juan", [f("URGENT"), f("DO_NOT_USE", true)]);
  assert.ok(two && /Do not use - Tipper \(2 faults\)/.test(two.title) && /marked Down/.test(two.body) && two.body.split("\n").length === 3);
});

test("status moves: Open -> In hand -> Fixed, Open -> Fixed; Fixed is the end", () => {
  assert.ok(canMove("OPEN", "IN_HAND") && canMove("OPEN", "FIXED") && canMove("IN_HAND", "FIXED"));
  assert.ok(!canMove("FIXED", "OPEN") && !canMove("FIXED", "IN_HAND") && !canMove("IN_HAND", "OPEN") && !canMove("OPEN", "OPEN"));
});

test("worst priority and the office order", () => {
  assert.equal(worstPriority(["LOW", "URGENT", "HIGH"]), "URGENT");
  assert.equal(worstPriority(["LOW", "DO_NOT_USE"]), "DO_NOT_USE");
  assert.equal(worstPriority([]), null);
  const rows = sortFaults([
    { id: 1, status: "FIXED", priority: "DO_NOT_USE", reportedAt: "2026-11-08T01:00:00Z" },
    { id: 2, status: "OPEN", priority: "LOW", reportedAt: "2026-11-08T03:00:00Z" },
    { id: 3, status: "IN_HAND", priority: "URGENT", reportedAt: "2026-11-07T03:00:00Z" },
    { id: 4, status: "OPEN", priority: "LOW", reportedAt: "2026-11-08T05:00:00Z" },
  ]);
  assert.deepEqual(rows.map((r) => r.id), [3, 4, 2, 1]);
});

test("faults are worked by exactly ADMIN, MANAGER, COORDINATOR and YARD; their pages list /faults", () => {
  for (const r of ["ADMIN", "MANAGER", "COORDINATOR", "YARD"]) assert.equal(faultsWorker(r), true, r);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "", "OWNER", "admin"]) assert.equal(faultsWorker(r), false, r);
  assert.ok(isCoordinatorPage("/faults") && isYardPage("/faults"));
});

// ---------- stage 1b (10 Nov 2026) and PS-009 / 010 / 011 ----------

test("walk-around: required on the first pre-start of the day, optional after a DONE or LIMIT one", () => {
  assert.equal(walkaroundRequired([]), true);
  assert.equal(walkaroundRequired([{ walkaround: null }, { walkaround: "OPTIONAL" }]), true); // skipped / older ones don't count
  assert.equal(walkaroundRequired([{ walkaround: "DONE" }]), false);
  assert.equal(walkaroundRequired([{ walkaround: "LIMIT" }]), false);
  assert.equal(walkaroundSlotsFor("VEHICLE", "PRE").length, 5);
  assert.equal(walkaroundSlotsFor("VEHICLE", "POST").length, 0);
  assert.equal(walkaroundSlotsFor("EQUIPMENT", "PRE").length, 5); // stage 2 (10 Nov 2026): owned plant has its own walk-around
});

test("walk-around: all five needed when required; LIMIT when the day's photo limit is full; optional otherwise", () => {
  const all = Object.fromEntries(TRUCK_WALKAROUND.map((s, i) => [s.key, `m${i}`]));
  const four = { ...all }; delete (four as Record<string, string>).CAB;
  const v = (raw: unknown, required: boolean, capFull = false) => validateWalkaround(raw, TRUCK_WALKAROUND, { required, capFull });
  assert.deepEqual(v(all, true), { ok: true, photos: all, status: "DONE" });
  const missing = v(four, true);
  assert.ok(!missing.ok && /Inside the cab/.test(missing.error));
  assert.ok(!v(undefined, true).ok);
  assert.equal((v(four, true, true) as { status: string }).status, "LIMIT");
  assert.equal((v(undefined, false) as { status: string }).status, "OPTIONAL");
  assert.equal((v(four, false) as { status: string }).status, "OPTIONAL");
  assert.ok(!v({ ...all, ROOF: "x" }, true).ok, "an unknown slot is refused");
  assert.ok(!v({ ...all, BACK: "m0" }, true).ok, "one photo in two slots is refused");
  assert.ok(!v({ FRONT: "../x" }, false).ok);
  assert.deepEqual(validateWalkaround(undefined, [], { required: true, capFull: false }), { ok: true, photos: {}, status: null });
  assert.ok(!validateWalkaround({ FRONT: "m1" }, [], { required: false, capFull: false }).ok, "no slots on a post-check");
});

test("retention: walk-around photos over 12 months go; newer ones and fault photos stay", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  assert.equal(walkaroundCutoff(now).toISOString(), "2025-11-10T00:00:00.000Z");
  assert.equal(walkaroundExpired({ role: "WALKAROUND", createdAt: new Date("2025-11-09T23:59:59Z") }, now), true);
  assert.equal(walkaroundExpired({ role: "WALKAROUND", createdAt: new Date("2025-11-10T00:00:01Z") }, now), false);
  assert.equal(walkaroundExpired({ role: "FAULT", createdAt: new Date("2020-01-01T00:00:00Z") }, now), false);
});

test("PS-009: the read-only pre-check refuses once a cap is already reached", () => {
  const z = { role: "FAULT" as const, signIn: 0, roleMachineDay: 0, allDay: 0, deviceDay: 0, sameOnSignIn: 0 };
  assert.equal(photoPrecheck(z), null);
  assert.equal(photoPrecheck({ ...z, signIn: 29 }), null);
  assert.equal(photoPrecheck({ ...z, signIn: 30 })?.status, 429);
  assert.equal(photoPrecheck({ ...z, roleMachineDay: 65 })?.cap, "FAULT");
  assert.equal(photoPrecheck({ ...z, roleMachineDay: 64 }), null);
  assert.equal(photoPrecheck({ ...z, role: "WALKAROUND", roleMachineDay: 15 })?.cap, "WALKAROUND");
  assert.equal(photoPrecheck({ ...z, role: "WALKAROUND", roleMachineDay: 14 }), null);
  assert.equal(photoPrecheck({ ...z, allDay: 400 })?.capFull, true);
  assert.equal(photoPrecheck({ ...z, sameOnSignIn: 1 })?.status, 409);
});

test("PS-010: Urgent / Do-not-use may go without a photo only when the day's photo limit is full", () => {
  assert.equal(photoCapFull("FAULT", { roleMachineDay: 64, allDay: 399 }), false);
  assert.equal(photoCapFull("FAULT", { roleMachineDay: 65, allDay: 0 }), true);
  assert.equal(photoCapFull("FAULT", { roleMachineDay: 0, allDay: 400 }), true);
  for (const p of ["URGENT", "DO_NOT_USE"]) { assert.equal(photoWaived(p, true), true); assert.equal(photoWaived(p, false), false); }
  for (const p of ["LOW", "HIGH"]) assert.equal(photoWaived(p, true), false);
  const answers = { ...allOk(), tyres: "FAULT" };
  const f = (priority: string) => ({ answers, faults: [{ itemKey: "tyres", description: "Flat tyre", priority, mediaIds: [] }] });
  assert.ok(validateSubmission(TRUCK_PRE, f("URGENT"), [], { capFull: true }).ok);
  assert.ok(validateSubmission(TRUCK_PRE, f("DO_NOT_USE"), [], { capFull: true }).ok);
  assert.ok(!validateSubmission(TRUCK_PRE, f("URGENT"), []).ok, "not when the limit isn't full");
  assert.ok(!validateSubmission(TRUCK_PRE, f("HIGH"), [], { capFull: true }).ok, "never for Low / High");
});

test("PS-011: Do not use ignores the daily cap and Urgent alerts; only a recent Do-not-use alert holds it", () => {
  const now = new Date("2026-11-10T03:00:00Z");
  const s = (m: number, doNotUse = false) => ({ at: new Date(now.getTime() - m * 60_000), doNotUse });
  const six = [s(20), s(40), s(60), s(80), s(100), s(120)];
  assert.equal(alertDecision(six, now), "HELD_DAY");
  assert.equal(alertDecision(six, now, true), "SENT");
  assert.equal(alertDecision([s(5)], now, true), "SENT", "a recent Urgent-only alert doesn't hold a Do-not-use one");
  assert.equal(alertDecision([s(5, true)], now, true), "HELD_RECENT");
  assert.equal(alertDecision([s(16, true)], now, true), "SENT");
  assert.equal(alertDecision([s(5, true)], now, false), "HELD_RECENT", "an Urgent one is still held by any recent alert");
});

// ---------- PS-012 (10 Nov 2026): the caps split by kind, and the once-a-day notice ----------

test("PS-012: fault photos filling their allowance never let the walk-around through; walk-around full does", () => {
  // The walk-around's own allowance and the ceiling decide LIMIT - never the fault photos.
  assert.equal(photoCapFull("WALKAROUND", { roleMachineDay: 0, allDay: 100 }), false); // even with 65 fault photos today
  assert.equal(photoCapFull("WALKAROUND", { roleMachineDay: 15, allDay: 100 }), true);
  assert.equal(photoCapFull("WALKAROUND", { roleMachineDay: 0, allDay: 400 }), true);
  // ...and a fault's photo is waived only when the FAULT allowance or the ceiling is full.
  assert.equal(photoCapFull("FAULT", { roleMachineDay: 0, allDay: 100 }), false); // even with the walk-around full
  const all = Object.fromEntries(TRUCK_WALKAROUND.map((s, i) => [s.key, `m${i}`]));
  const four = { ...all } as Record<string, string>; delete four.CAB;
  assert.ok(!validateWalkaround(four, TRUCK_WALKAROUND, { required: true, capFull: photoCapFull("WALKAROUND", { roleMachineDay: 3, allDay: 70 }) }).ok);
  assert.equal((validateWalkaround(four, TRUCK_WALKAROUND, { required: true, capFull: photoCapFull("WALKAROUND", { roleMachineDay: 15, allDay: 70 }) }) as { status: string }).status, "LIMIT");
});

test("PS-012: which caps are full, and the notice to the Admins (no money)", () => {
  assert.deepEqual(capsFull({ walkaroundMachineDay: 14, faultMachineDay: 64, allDay: 399 }), []);
  assert.deepEqual(capsFull({ walkaroundMachineDay: 15, faultMachineDay: 0, allDay: 0 }), ["WALKAROUND"]);
  assert.deepEqual(capsFull({ walkaroundMachineDay: 0, faultMachineDay: 65, allDay: 0 }), ["FAULT"]);
  assert.deepEqual(capsFull({ walkaroundMachineDay: 15, faultMachineDay: 65, allDay: 400 }), ["WALKAROUND", "FAULT", "ALL"]);
  const w = capNotice("WALKAROUND", "Hook Truck - XO20TL");
  assert.equal(w.title, "Photo limit reached on Hook Truck - XO20TL today");
  assert.match(w.body, /pre-starts may go through without photos\. Check Faults → Checks\./);
  assert.match(capNotice("FAULT", "Tipper").body, /Urgent \/ Do-not-use/);
  assert.match(capNotice("ALL", "x").title, /all trucks/);
  for (const c of ["WALKAROUND", "FAULT", "ALL"] as const) { const m = capNotice(c, "T"); assert.ok(assertNoMoney(m.title + m.body)); }
});
