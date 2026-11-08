// Vehicle & plant pre-start checks (stage 1, 8 Nov 2026) - the plain rules. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKLISTS, PLANT_PRE, TRUCK_POST, TRUCK_PRE, answerLabel, checklistFor } from "./checklists";
import { LIMITS, alertFor, canMove, cleanText, firstName, marksDown, offerBackToAvailable, sortFaults, validateSubmission, worstPriority } from "./rules";
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
  const f = { id: "a", markedDown: true };
  assert.equal(offerBackToAvailable(f, "DOWN", [{ id: "a", priority: "DO_NOT_USE", status: "OPEN" }]), true);
  assert.equal(offerBackToAvailable({ ...f, markedDown: false }, "DOWN", []), false);
  assert.equal(offerBackToAvailable(f, "AVAILABLE", []), false);
  assert.equal(offerBackToAvailable(f, "DOWN", [{ id: "b", priority: "DO_NOT_USE", status: "IN_HAND" }]), false);
  assert.equal(offerBackToAvailable(f, "DOWN", [{ id: "b", priority: "DO_NOT_USE", status: "FIXED" }]), true);
  assert.equal(offerBackToAvailable(f, "DOWN", [{ id: "b", priority: "URGENT", status: "OPEN" }]), true);
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
