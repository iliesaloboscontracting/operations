// Directors -> "Waiting on you" (10 Nov 2026): grouping and counting, the "why it matters" sentences, how long, who a
// contract value waits on, the proposer / approver rule for contract values (a director proposes; the same person -
// Nick's other login too - can't approve; the other director can; the owner never), and the Monday alert's decision
// and words (once a week, N > 0, active only, no money). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canProposeKind, cannotApprove, type ChangeUser } from "../changes/rules";
import { SAME_PERSON } from "../samePerson";
import {
  GROUPS, WHY, countWaiting, directorPeople, groupItems, mondayDecision, mondayWindow, notSetUp, reminderKey, reminderOff,
  reminderPush, waitingOnText, waitingText, whoCanApprove, whyItMatters, askIliesText, askKey, askCounts, sydneyWeekStart, ASK_STATE, type Login, type WaitingItem,
} from "./rules";

const OWNER = "iliesa@loboscontracting.com.au";
const [NICK_ADMIN_ID, NICK_DIRECTOR_ID] = SAME_PERSON[0];
const login = (x: Partial<Login & { email: string }>): Login & { email: string } => ({ id: "u", name: "Someone", email: "s@x", role: "MANAGER", directorAccess: false, active: true, ...x });
const nickDir = login({ id: NICK_DIRECTOR_ID, name: "Nick Giannopoulos", email: "nick.director@x", role: "DIRECTOR", directorAccess: true });
const nickAdmin = login({ id: NICK_ADMIN_ID, name: "Nick Giannopoulos", email: "nick@x", role: "ADMIN", directorAccess: true });
const yoel = login({ id: "yo", name: "Yoel Silvestre", email: "yoel@x", role: "DIRECTOR", directorAccess: true });
const ilies = login({ id: "il", name: "Iliesa Tubakibau Weldon", email: OWNER, role: "ADMIN", directorAccess: true });

const item = (x: Partial<WaitingItem>): WaitingItem => ({ id: "i", group: "FIGURES", kind: "NO_CONTRACT_VALUE", what: "Job", why: "w", since: null, counts: true, action: { type: "NONE", text: "" }, ...x });

test("groups come in the agreed order, oldest first, and only items someone can act on count", () => {
  assert.deepEqual(GROUPS.map((g) => g.id), ["QUESTIONS", "APPROVALS", "FIGURES", "DECISIONS"]);
  const items = [
    item({ id: "f-new", since: "2026-11-09T00:00:00Z" }),
    item({ id: "f-old", since: "2026-10-01T00:00:00Z" }),
    item({ id: "f-wait", since: "2026-09-01T00:00:00Z", counts: false }), // proposed, waiting on the other director
    item({ id: "q", group: "QUESTIONS", kind: "QUESTION", since: "2026-11-01T00:00:00Z" }),
    item({ id: "d", group: "DECISIONS", kind: "NOT_SET_UP", counts: false }), // already sent to Ilies
  ];
  const g = groupItems(items);
  assert.deepEqual(g.map((x) => x.id), ["QUESTIONS", "APPROVALS", "FIGURES", "DECISIONS"]);
  assert.deepEqual(g[2].items.map((i) => i.id), ["f-old", "f-new", "f-wait"], "counting ones first, oldest first");
  assert.deepEqual(g.map((x) => x.count), [1, 0, 2, 0]);
  assert.equal(countWaiting(items), 3);
  assert.equal(countWaiting([]), 0);
});

test("why it matters: one plain sentence each; a question's own why is used when it has one", () => {
  assert.equal(whyItMatters("NO_CONTRACT_VALUE"), "Tracking can't warn at 80% / 100% of the job's value.");
  assert.equal(whyItMatters("QUESTION"), WHY.QUESTION);
  assert.equal(whyItMatters("QUESTION", { questionWhy: "  For the tender register " }), "For the tender register.");
  assert.equal(whyItMatters("QUESTION", { questionWhy: "Needed for BAS?" }), "Needed for BAS?");
  assert.match(whyItMatters("NOT_SET_UP", { kpiName: "Variations" }), /can't show variations until it's set up\.$/);
  for (const k of ["CHANGE", "BUDGET", "NO_BUDGET", "NO_CONTRACT_VALUE"] as const) {
    const s = whyItMatters(k);
    assert.match(s, /^[A-Z].*\.$/, k);
    assert.ok(!/\$\s?\d/.test(s), `${k}: no amount`);
  }
});

test("how long: today, days, then weeks", () => {
  const now = new Date("2026-11-10T03:00:00Z");
  assert.equal(waitingText(null, now), "");
  assert.equal(waitingText("2026-11-10T01:00:00Z", now), "since today");
  assert.equal(waitingText("2026-11-09T01:00:00Z", now), "1 day");
  assert.equal(waitingText("2026-11-01T01:00:00Z", now), "9 days");
  assert.equal(waitingText("2026-10-24T00:00:00Z", now), "2 weeks");
});

test("decisions not made yet: the dictionary's BLOCKED items, each with what's needed; once a Sydney week (PS-039 claim key)", () => {
  const n = notSetUp();
  assert.ok(n.length >= 2 && n.every((x) => x.key && x.name && x.needed));
  assert.ok(n.some((x) => /variation/i.test(x.name)) && n.some((x) => /incident/i.test(x.name)));
  assert.match(askIliesText("Variations", "No variation register yet"), /please set up "Variations".*What's needed: No variation register yet\./);
  // Sydney Monday 9 Nov 2026 00:30 AEDT is still Sunday 8 Nov in UTC - the week is Sydney's.
  assert.equal(sydneyWeekStart(new Date("2026-11-08T13:30:00Z")), "2026-11-09");
  assert.equal(sydneyWeekStart(new Date("2026-11-08T12:30:00Z")), "2026-11-02", "Sunday 11:30pm Sydney: last week");
  assert.equal(sydneyWeekStart(new Date("2026-11-15T12:59:00Z")), "2026-11-09", "Sunday 11:59pm Sydney: same week");
  // One claim key per login, item and week: a second tap the same week hits the same unique row; next week a new one.
  const tue = new Date("2026-11-10T00:00:00Z"), sun = new Date("2026-11-15T10:00:00Z"), nextMon = new Date("2026-11-15T21:00:00Z");
  assert.equal(askKey("u1", "F11", tue), askKey("u1", "F11", sun));
  assert.notEqual(askKey("u1", "F11", tue), askKey("u1", "F11", nextMon));
  assert.notEqual(askKey("u1", "F11", tue), askKey("u1", "S2", tue));
  assert.notEqual(askKey("u1", "F11", tue), askKey("u2", "F11", tue));
  // A failed send is not "sent"; one in flight or done is.
  assert.ok(!askCounts(ASK_STATE.FAILED) && askCounts(ASK_STATE.SENDING) && askCounts(ASK_STATE.SENT));
});

test("contract values: a director proposes; the same person (Nick's other login, by id) can't approve; the other director can; the owner never", () => {
  // A director login may propose a contract value (the commercial kind) - nothing else.
  assert.ok(canProposeKind(nickDir, "PROJECT_CONTRACT_VALUE"));
  assert.ok(canProposeKind(yoel, "PROJECT_CONTRACT_VALUE"));
  assert.ok(!canProposeKind(yoel, "PROJECT_JOB_NO") && !canProposeKind(yoel, "HIRE_OFF_HIRE_DATE") && !canProposeKind(yoel, "RESOURCE_RATE"));
  const p = { kind: "PROJECT_CONTRACT_VALUE" as const, requestedBy: nickDir.name, requestedByUserId: nickDir.id, sourcePerson: null };
  assert.match(cannotApprove(nickDir, p)!, /You proposed/, "never your own");
  // Nick's other login - even as a DIRECTOR login under another name - is the same person (SAME_PERSON, by id).
  const nickOther: ChangeUser = { ...nickAdmin, role: "DIRECTOR", name: "N. Giannopoulos" };
  assert.match(cannotApprove(nickOther, p)!, /You proposed/, "Nick's other login can't approve it");
  assert.match(cannotApprove(nickAdmin, p)!, /approved by a director login/, "an ADMIN login never approves a contract value");
  assert.equal(cannotApprove(yoel, p), null, "the other director can");
  assert.match(cannotApprove(ilies, { ...p, requestedBy: yoel.name, requestedByUserId: yoel.id })!, /approved by a director login/, "never the owner");
  // Who it waits on: one name per person, active logins only.
  assert.deepEqual(whoCanApprove([nickDir, nickAdmin, yoel, ilies], p), ["Yoel Silvestre"]);
  assert.deepEqual(whoCanApprove([nickDir, nickAdmin, { ...yoel, active: false }, ilies], p), []);
  assert.deepEqual(whoCanApprove([nickDir, yoel, ilies], { ...p, requestedBy: ilies.name, requestedByUserId: ilies.id }), ["Nick Giannopoulos", "Yoel Silvestre"]);
  assert.equal(waitingOnText(["Yoel Silvestre"]), "Proposed - waiting on Yoel Silvestre to approve.");
  assert.match(waitingOnText([]), /nobody else can approve it yet.*Ask Ilies/);
});

test("the Monday alert: Monday 8:00-11:59 Sydney only; once a week; N > 0; active; phone alerts on; kill switch", () => {
  // Mon 16 Nov 2026 8:00 AEDT = Sun 15 Nov 21:00 UTC.
  assert.equal(mondayWindow(new Date("2026-11-15T21:00:00Z")), "2026-11-16");
  assert.equal(mondayWindow(new Date("2026-11-16T00:59:00Z")), "2026-11-16", "11:59am");
  assert.equal(mondayWindow(new Date("2026-11-15T20:59:00Z")), null, "7:59am");
  assert.equal(mondayWindow(new Date("2026-11-16T01:00:00Z")), null, "noon");
  assert.equal(mondayWindow(new Date("2026-11-16T21:00:00Z")), null, "Tuesday 8am");
  assert.equal(reminderKey("u1", "2026-11-16"), "u1:2026-11-16");
  const ok = { off: false, week: "2026-11-16", active: true, alreadySent: false, hasDevice: true, n: 3 };
  assert.deepEqual(mondayDecision(ok), { send: true });
  assert.equal(mondayDecision({ ...ok, alreadySent: true }).send, false);
  assert.equal(mondayDecision({ ...ok, n: 0 }).send, false);
  assert.equal(mondayDecision({ ...ok, active: false }).send, false);
  assert.equal(mondayDecision({ ...ok, hasDevice: false }).send, false);
  assert.equal(mondayDecision({ ...ok, week: null }).send, false);
  assert.equal(mondayDecision({ ...ok, off: true }).send, false);
  assert.ok(reminderOff("off") && reminderOff(" OFF ") && !reminderOff("") && !reminderOff(undefined));
  const m = reminderPush(3);
  assert.equal(m.body, "3 things waiting on you - open the Directors screen");
  assert.equal(reminderPush(1).body, "1 thing waiting on you - open the Directors screen");
  assert.ok(!/\$|\d[\d,]*\.\d{2}/.test(JSON.stringify(m)), "no money in the push");
  assert.equal(m.url, "/directors/waiting");
});

test("who gets the Monday alert: one per person (Nick's two logins are one, his DIRECTOR login counts), never the owner, active only", () => {
  const people = directorPeople([nickAdmin, nickDir, yoel, ilies, login({ id: "gone", name: "Old Director", role: "DIRECTOR", directorAccess: true, active: false })]);
  assert.equal(people.length, 2);
  const nick = people.find((p) => p.primary.name === "Nick Giannopoulos")!;
  assert.equal(nick.primary.id, NICK_DIRECTOR_ID, "his DIRECTOR login is the one counted");
  assert.deepEqual([...nick.ids].sort(), [NICK_ADMIN_ID, NICK_DIRECTOR_ID].sort(), "both his logins' phones");
  assert.ok(!people.some((p) => p.ids.includes(ilies.id)), "never the owner");
  assert.ok(!people.some((p) => p.ids.includes("gone")), "never a switched-off login");
  // An Admin without the director tick isn't a director.
  assert.equal(directorPeople([login({ id: "a", role: "ADMIN", directorAccess: false })]).length, 0);
});
