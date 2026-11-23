// Pre-starts today + the truck pre-start can't be skipped (Ilies, 23 Nov 2026: "yes do 1 and 2") - the plain rules.
// `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PRESTART_NOT_DONE, TRUCK_TIMED_OUT, cardCounts, isHookBin, machineCardStatus, noStickerCount, noStickerText, prestartSkippable,
  requiredTimeoutMessage, signInPreStatus, truckCardStatus, truckPrestartRequired,
} from "./rules";
import { assertNoMoney } from "../moneyGuard";
import { faultsWorker } from "../roles";

const first = { fromQr: true, signedOut: false, ownPreDone: false, truckPreToday: 0 };

test("required: the first truck QR sign-in of the day on a truck with no pre-start yet", () => {
  assert.equal(truckPrestartRequired(first), true);
});
test("optional: a later sign-in the same day, once the truck has a pre-start (any driver's)", () => {
  assert.equal(truckPrestartRequired({ ...first, truckPreToday: 1 }), false);
  assert.equal(truckPrestartRequired({ ...first, truckPreToday: 3 }), false);
});
test("not required once its own pre-start is in, after sign-out, or for a sign-in that isn't the truck QR", () => {
  assert.equal(truckPrestartRequired({ ...first, ownPreDone: true, truckPreToday: 1 }), false);
  assert.equal(truckPrestartRequired({ ...first, signedOut: true }), false, "after sign-out: nothing to resume (PS-006)");
  assert.equal(truckPrestartRequired({ ...first, fromQr: false }), false, "an office-added truck sign-in has no phone");
});
test("never trapped: a required pre-start can't be skipped - until a photo limit refuses a photo", () => {
  assert.equal(prestartSkippable({ required: true, capped: false }), false);
  assert.equal(prestartSkippable({ required: true, capped: true }), true);
  assert.equal(prestartSkippable({ required: false, capped: false }), true, "optional later checks keep Do it later");
});

test("the office's word for a truck sign-in", () => {
  assert.equal(signInPreStatus({ pre: { faultCount: 0 }, fromQr: true, truckPreByEnd: true }), "Done");
  assert.equal(signInPreStatus({ pre: { faultCount: 2 }, fromQr: true, truckPreByEnd: true }), "Done - 2 faults");
  assert.equal(signInPreStatus({ pre: { faultCount: 1 }, fromQr: true, truckPreByEnd: true }), "Done - 1 fault");
  assert.equal(signInPreStatus({ pre: null, fromQr: true, truckPreByEnd: false }), PRESTART_NOT_DONE, "red until it's sent");
  assert.equal(signInPreStatus({ pre: null, fromQr: true, truckPreByEnd: true }), "No pre-start", "the truck was checked by someone else - optional, as before");
  assert.equal(signInPreStatus({ pre: null, fromQr: false, truckPreByEnd: false }), "No pre-start", "office-added: never 'not done'");
  assert.equal(PRESTART_NOT_DONE, "Pre-start not done");
});

test("the card: truck statuses", () => {
  assert.deepEqual(truckCardStatus({ preDone: false, postDone: false, worstFault: null }), { status: "NOT_DONE", label: "Pre-start not done" });
  assert.deepEqual(truckCardStatus({ preDone: false, postDone: true, worstFault: "URGENT" }).status, "NOT_DONE", "no pre-start beats everything");
  assert.deepEqual(truckCardStatus({ preDone: true, postDone: false, worstFault: "DO_NOT_USE" }), { status: "FAULT", label: "Fault - Do not use" });
  assert.deepEqual(truckCardStatus({ preDone: true, postDone: true, worstFault: "LOW" }), { status: "FAULT", label: "Fault - Low" });
  assert.deepEqual(truckCardStatus({ preDone: true, postDone: true, worstFault: null }), { status: "POST_DONE", label: "Post-check done" });
  assert.deepEqual(truckCardStatus({ preDone: true, postDone: false, worstFault: null }), { status: "DONE", label: "Done" });
  assert.equal(truckCardStatus({ preDone: true, postDone: false, worstFault: "NONSENSE" }).status, "DONE", "an unknown priority isn't a fault label");
});
test("the card: machine statuses", () => {
  assert.deepEqual(machineCardStatus({ preDone: false, worstFault: null }), { status: "NOT_DONE", label: "No pre-start" });
  assert.deepEqual(machineCardStatus({ preDone: true, worstFault: "HIGH" }), { status: "FAULT", label: "Fault - High" });
  assert.deepEqual(machineCardStatus({ preDone: true, worstFault: null }), { status: "DONE", label: "Done" });
});
test("the card: counts - a fault still counts as done; a machine nobody needed today isn't counted", () => {
  assert.deepEqual(cardCounts([{ status: "NOT_DONE" }, { status: "FAULT" }, { status: "DONE" }, { status: "POST_DONE" }]), { total: 4, done: 3, notDone: 1, faults: 1 });
  assert.deepEqual(cardCounts([{ status: "NOT_DONE", needed: false }, { status: "DONE", needed: true }]), { total: 1, done: 1, notDone: 0, faults: 0 });
  assert.deepEqual(cardCounts([]), { total: 0, done: 0, notDone: 0, faults: 0 });
});
test("the card: machines with no QR sticker - owned, active plant only", () => {
  const m = (id: string, o: Partial<{ type: string; ownership: string | null; active: boolean }> = {}) => ({ id, type: "EQUIPMENT", ownership: "OWNED", active: true, ...o });
  const list = [m("a"), m("b"), m("c"), m("hired", { ownership: "HIRED" }), m("att", { type: "ATTACHMENT" }), m("old", { active: false })];
  assert.equal(noStickerCount(list, new Set(["a"])), 2);
  assert.equal(noStickerCount(list, new Set(["a", "b", "c"])), 0);
  assert.equal(noStickerCount(list, new Set(["hired"])), 3, "a sticker on something that can't have one doesn't count");
  assert.equal(noStickerText(9), "9 machines have no QR sticker yet");
  assert.equal(noStickerText(1), "1 machine has no QR sticker yet");
  assert.equal(noStickerText(0), null);
});
test("hook bins never count as machines without a sticker (Ilies, 23 Nov 2026)", () => {
  const m = (id: string, o: Partial<{ name: string; category: string | null; role: string | null }> = {}) =>
    ({ id, type: "EQUIPMENT", ownership: "OWNED", active: true, name: "15t Excavator", category: "Plant", role: "Plant", ...o });
  assert.equal(isHookBin({ name: "Hook Bin #1", category: "Bins", role: "Bin" }), true);
  assert.equal(isHookBin({ name: "Hook Bin #4", category: null, role: null }), true, "by name alone");
  assert.equal(isHookBin({ name: "Something", category: "bins ", role: null }), true, "by category alone");
  assert.equal(isHookBin({ name: "Something", category: null, role: "Bin" }), true, "by role alone");
  assert.equal(isHookBin({ name: "15t Excavator", category: "Plant", role: "Plant" }), false);
  assert.equal(isHookBin({ name: "Scissor lift", category: "Plant", role: "Plant" }), false);
  // The register on 23 Nov 2026: 11 machines (2 with stickers) and 5 hook bins -> 9.
  const list = [...Array.from({ length: 11 }, (_, i) => m(`p${i}`)), ...Array.from({ length: 5 }, (_, i) => m(`b${i}`, { name: `Hook Bin #${i + 1}`, category: "Bins", role: "Bin" }))];
  assert.equal(noStickerCount(list, new Set(["p0", "p1"])), 9);
  assert.equal(noStickerText(noStickerCount(list, new Set(["p0", "p1"]))), "9 machines have no QR sticker yet");
});

test("PT-005: a required screen's 401 says to scan the truck QR again; nothing else changes", () => {
  assert.equal(requiredTimeoutMessage(true, 401), "That's timed out - scan the truck QR again to carry on.");
  assert.equal(requiredTimeoutMessage(true, 401), TRUCK_TIMED_OUT);
  assert.equal(requiredTimeoutMessage(false, 401), null, "an optional screen keeps the server's words");
  for (const s of [400, 403, 404, 409, 429, 500]) assert.equal(requiredTimeoutMessage(true, s), null, String(s));
});

test("no money in the card's words", () => {
  assert.ok(assertNoMoney(JSON.stringify({ a: truckCardStatus({ preDone: true, postDone: true, worstFault: "URGENT" }), b: noStickerText(9), c: PRESTART_NOT_DONE })));
});

test("the Pre-starts nav link: only where the Checks tab already is, and it opens the Checks tab", () => {
  const nav = readFileSync(path.join(process.cwd(), "src", "components", "TopNav.tsx"), "utf8");
  assert.match(nav, /PRESTARTS_HREF = "\/faults\?tab=checks"/);
  // Operations screen: hidden unless canEdit (Manager / Admin) - it sits in the canEdit-only list.
  assert.match(nav, /i\.href !== PRESTARTS_HREF/);
  // The coordinator's and the yard's own screens have it; the Directors / Accounts screens don't.
  const block = (name: string) => nav.slice(nav.indexOf(`const ${name} = [`), nav.indexOf("];", nav.indexOf(`const ${name} = [`)));
  for (const s of ["COORDINATOR", "YARD"]) assert.ok(block(s).includes("PRESTARTS_HREF"), s);
  for (const s of ["DIRECTORS", "ACCOUNTS"]) assert.ok(!block(s).includes("PRESTARTS_HREF"), s);
  // ...and those are exactly the logins the Checks tab's routes let in.
  for (const r of ["ADMIN", "MANAGER", "COORDINATOR", "YARD"]) assert.equal(faultsWorker(r), true, r);
  for (const r of ["VIEWER", "TIMESHEETS", "ACCOUNTS", "DIRECTOR"]) assert.equal(faultsWorker(r), false, r);
});
