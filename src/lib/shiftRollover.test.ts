import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideSignIn, parseShiftAnswer, withinAsk, type PriorShift } from "./shiftRollover";
import { SAME_SHIFT_ASK_HOURS } from "./signin";
import { assertNoMoney } from "./moneyGuard";

// Shift rollover (19 Nov 2026, Ilies): just off a night shift (6 h), a new sign-in asks "Back on the same shift" or
// "This is a new shift" - never silently; tonight's night shift only from noon (lib/signin.ts).
const at = (sydney: string) => new Date(sydney + "+11:00"); // AEDT
const calwell = { id: "p-cal", name: "Calwell", regional: true };
const job = (id: string, date: string, shift = "NIGHT", project: { id: string; name: string; regional?: boolean } | null = calwell) =>
  ({ id, date: new Date(date + "T00:00:00.000Z"), shift, title: "x", project });
const sun15 = job("sun15", "2026-11-15");
const mon16 = job("mon16", "2026-11-16");
const prior = (signOut: string, j = sun15): PriorShift => ({ attendanceId: "a1", signOutAt: at(signOut), job: j });

test("the 6-hour window: asked within it, not after; never for a sign-out in the future", () => {
  assert.equal(SAME_SHIFT_ASK_HOURS, 6);
  assert.equal(withinAsk(at("2026-11-16T04:51:00"), at("2026-11-16T10:51:00")), true, "exactly 6 h");
  assert.equal(withinAsk(at("2026-11-16T04:51:00"), at("2026-11-16T10:52:00")), false, "6 h 1 min");
  assert.equal(withinAsk(at("2026-11-16T05:00:00"), at("2026-11-16T04:59:00")), false);
  // Off a night shift 5h59 ago -> asked; 6h01 ago -> a normal sign-in on tonight's job (after noon).
  assert.equal(decideSignIn({ chosen: mon16, prior: prior("2026-11-16T09:00:00"), answer: null, now: at("2026-11-16T14:59:00") }).kind, "ASK");
  assert.deepEqual(decideSignIn({ chosen: mon16, prior: prior("2026-11-16T09:00:00"), answer: null, now: at("2026-11-16T15:01:00") }), { kind: "GO", jobId: "mon16", answer: null });
});

test("no recent night shift: tonight's job before noon is refused, a day job goes straight in", () => {
  const r = decideSignIn({ chosen: mon16, prior: null, answer: null, now: at("2026-11-16T04:51:00") });
  assert.equal(r.kind, "REFUSE");
  assert.match((r as { error: string }).error, /12 noon/);
  assert.deepEqual(decideSignIn({ chosen: job("d16", "2026-11-16", "DAY"), prior: null, answer: null, now: at("2026-11-16T06:00:00") }), { kind: "GO", jobId: "d16", answer: null });
  // A DAY shift signed out of isn't asked about.
  assert.equal(decideSignIn({ chosen: job("d16", "2026-11-16", "DAY"), prior: prior("2026-11-16T05:00:00", job("d15", "2026-11-15", "DAY")), answer: null, now: at("2026-11-16T06:00:00") }).kind, "GO");
});

test("Calwell, Mon 16 Nov 4:51am: out of Sunday night, picking Monday night - asked; only 'same shift' can go", () => {
  const now = at("2026-11-16T04:51:00");
  const r = decideSignIn({ chosen: mon16, prior: prior("2026-11-16T04:51:00"), answer: null, now, tipRunOn: true });
  assert.equal(r.kind, "ASK");
  const a = (r as Extract<typeof r, { kind: "ASK" }>).ask;
  assert.equal(a.sameOffered, true);
  assert.equal(a.newOffered, false, "tonight's shift takes no sign-ins before noon");
  assert.equal(a.countsTo, "Sun 15");
  assert.equal(a.shift, "Calwell – Night shift Sun 15 → Mon 16 – hours count to Sun 15");
  assert.equal(a.signedOut, "4:51 am");
  assert.equal(a.tipRun, true, "a regional shift points to Start tip run");
  assert.ok(assertNoMoney(JSON.stringify(a)));
  assert.deepEqual(decideSignIn({ chosen: mon16, prior: prior("2026-11-16T04:51:00"), answer: "SAME", now }), { kind: "GO", jobId: "sun15", answer: "SAME" });
  assert.equal(decideSignIn({ chosen: mon16, prior: prior("2026-11-16T04:51:00"), answer: "NEW", now }).kind, "ASK", "'new shift' isn't on offer here");
});

test("after noon: both answers on offer; 'new shift' goes to the job picked and is recorded", () => {
  const now = at("2026-11-16T12:30:00");
  const r = decideSignIn({ chosen: mon16, prior: prior("2026-11-16T07:00:00"), answer: null, now });
  assert.equal(r.kind, "ASK");
  const a = (r as Extract<typeof r, { kind: "ASK" }>).ask;
  assert.ok(a.sameOffered && a.newOffered);
  assert.equal(a.newShift, "Calwell – Night shift Mon 16 → Tue 17 – hours count to Mon 16");
  assert.deepEqual(decideSignIn({ chosen: mon16, prior: prior("2026-11-16T07:00:00"), answer: "NEW", now }), { kind: "GO", jobId: "mon16", answer: "NEW" });
  // From 2pm last night's shift takes no new sign-ins - 'same shift' isn't offered (the office adds the time).
  const late = decideSignIn({ chosen: mon16, prior: prior("2026-11-16T10:00:00"), answer: null, now: at("2026-11-16T14:30:00") });
  assert.equal(late.kind, "ASK");
  const la = (late as Extract<typeof late, { kind: "ASK" }>).ask;
  assert.ok(!la.sameOffered && la.newOffered && /office/.test(la.sameNote!));
  assert.equal(decideSignIn({ chosen: mon16, prior: prior("2026-11-16T10:00:00"), answer: "SAME", now: at("2026-11-16T14:30:00") }).kind, "ASK");
});

test("Mt Hutton tip run: back on last night's job itself - only 'same shift', recorded as SAME", () => {
  const now = at("2026-11-16T08:30:00");
  const r = decideSignIn({ chosen: sun15, prior: prior("2026-11-16T05:30:00"), answer: null, now });
  const a = (r as Extract<typeof r, { kind: "ASK" }>).ask;
  assert.ok(r.kind === "ASK" && a.sameOffered && !a.newOffered);
  assert.deepEqual(decideSignIn({ chosen: sun15, prior: prior("2026-11-16T05:30:00"), answer: "SAME", now }), { kind: "GO", jobId: "sun15", answer: "SAME" });
});

test("'same shift' only at the same site and, on a supervisor's link, only on their own jobs", () => {
  const now = at("2026-11-16T13:00:00");
  const other = job("o16", "2026-11-16", "DAY", { id: "p-other", name: "Other site" });
  const r = decideSignIn({ chosen: other, prior: prior("2026-11-16T08:00:00"), answer: null, now });
  const a = (r as Extract<typeof r, { kind: "ASK" }>).ask;
  assert.ok(r.kind === "ASK" && !a.sameOffered && a.newOffered && /another site/.test(a.sameNote!), "never silent, even at another site");
  const notMine = decideSignIn({ chosen: mon16, prior: prior("2026-11-16T08:00:00"), answer: "SAME", now, allowed: ["mon16"] });
  assert.ok(notMine.kind === "ASK" && /isn't on this link/.test(notMine.ask.sameNote!));
  // Nothing on offer at all: refused with the reason.
  const none = decideSignIn({ chosen: mon16, prior: prior("2026-11-16T04:00:00"), answer: null, now: at("2026-11-16T09:00:00"), allowed: ["mon16"] });
  assert.equal(none.kind, "REFUSE");
  assert.equal(parseShiftAnswer("SAME"), "SAME");
  assert.equal(parseShiftAnswer("same"), null);
  assert.equal(parseShiftAnswer(undefined), null);
  // Not regional, or tip runs switched off: no pointer to Start tip run.
  const local = job("l15", "2026-11-15", "NIGHT", { id: "p-local", name: "Mt Hutton", regional: false });
  const lr = decideSignIn({ chosen: local, prior: prior("2026-11-16T05:00:00", local), answer: null, now: at("2026-11-16T08:00:00"), tipRunOn: true });
  assert.ok(lr.kind === "ASK" && lr.ask.tipRun === false);
  const off = decideSignIn({ chosen: mon16, prior: prior("2026-11-16T04:51:00"), answer: null, now: at("2026-11-16T05:00:00"), tipRunOn: false });
  assert.ok(off.kind === "ASK" && off.ask.tipRun === false);
});

test("every path that makes a sign-in on a job goes through the decision; signing out never does", () => {
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const phone = src("../app/api/site/in/sign/route.ts");
  assert.match(phone, /decideSignIn\(\{ chosen: job, prior: await recentNightShift\(who, now\)/);
  assert.match(phone, /if \(signInClosed\) return bad\(signInClosed\)/);
  assert.match(phone, /if \(ask\) return NextResponse\.json\(\{ error: askText\(ask\), ask \}, \{ status: 409 \}\)/);
  assert.match(phone, /shiftAnswer, \/\/ SAME \/ NEW/);
  assert.doesNotMatch(phone, /takesSignIns\(/, "the old check is replaced, not kept beside it");
  // OUT is handled after and never looks at signInClosed / ask.
  const out = phone.slice(phone.indexOf('if (body.action === "OUT")'));
  assert.doesNotMatch(out, /signInClosed|ask\b|decideSignIn/);
  const sup = src("../app/api/site/[token]/signin/route.ts");
  assert.match(sup, /decideSignIn\(\{ chosen: picked, prior: await recentNightShift\([\s\S]*allowed: jobIds/);
  assert.match(sup, /shiftAnswer: d\.answer/);
  for (const action of ["MANUAL_OUT", "MANUAL_OUT_MANY", "MANUAL_OUT_AT"]) {
    const i = sup.indexOf(`case "${action}"`);
    assert.doesNotMatch(sup.slice(i, sup.indexOf("case ", i + 8)), /decideSignIn|signInRefusal/, `${action} is never refused by the shift rules`);
  }
});
