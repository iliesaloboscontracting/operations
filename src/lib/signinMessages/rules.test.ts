// Message at sign-in (Ilies, 23 Nov 2026: "yes build it, deploy once passes") - the plain rules, and the source checks
// that keep the routes, the sign-in and the screens to what was agreed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MESSAGE_LIMITS, addDays, hireKey, isKnownDevice, mayMark, messagesFor, officeView, parseArchive, parseMessage, personKeyOf, rateRefusal,
  statusOf, textRefusal, toCrew, type MessageRow,
} from "./rules";
import { makeMessageToken, makeTravelPass, readMessageToken, readTravelPass, readTravelPassIssued } from "../signin";

const TODAY = "2026-11-23";
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const msg = (o: Partial<MessageRow> & { id: string }): MessageRow => ({
  text: "Well done on your pre-starts", audience: "ALL", showUntil: addDays(TODAY, 14), createdAt: new Date("2026-11-22T21:00:00Z"), archivedAt: null, ...o,
});

test("text: plain, 2-300 characters, spaces tidied; no dollar amounts; no TFN or bank details", () => {
  const ok = parseMessage({ text: "  Please   do your\n pre-start  ", audience: "ALL" }, TODAY);
  assert.ok(ok.ok && ok.value.text === "Please do your pre-start" && ok.value.showUntil === "2026-12-07", "tidied; default 14 days");
  assert.equal(parseMessage({ text: "x", audience: "ALL" }, TODAY).ok, false);
  assert.equal(parseMessage({ text: "a".repeat(MESSAGE_LIMITS.textMax), audience: "ALL" }, TODAY).ok, true);
  assert.equal(parseMessage({ text: "a".repeat(MESSAGE_LIMITS.textMax + 1), audience: "ALL" }, TODAY).ok, false);
  for (const t of ["Bonus of $50 this week", "Bonus $ 50", "you're owed ＄20", "50 dollars extra", "AUD 300"]) {
    const r = parseMessage({ text: t, audience: "ALL" }, TODAY);
    assert.ok(!r.ok && /dollar/i.test(r.error), t);
  }
  for (const t of ["Your TFN 123 456 782 is wrong", "BSB 062-000 acct 12345678", "send your bank account number"]) {
    const r = parseMessage({ text: t, audience: "ALL" }, TODAY);
    assert.ok(!r.ok && /bank or tax/i.test(r.error), t);
  }
  assert.equal(textRefusal("See you at 6am at 24 Grand Pde - level 3"), null, "times, addresses and numbers are fine");
});

test("who it's for: everyone, or 1-100 picked people; show-until today .. 90 days", () => {
  assert.equal(parseMessage({ text: "Hi there", audience: "SOME" }, TODAY).ok, false);
  assert.equal(parseMessage({ text: "Hi there", audience: "PEOPLE", resourceIds: [] }, TODAY).ok, false);
  assert.equal(parseMessage({ text: "Hi there", audience: "PEOPLE", resourceIds: ["a", 5] }, TODAY).ok, false, "a bad id refuses the lot");
  assert.equal(parseMessage({ text: "Hi there", audience: "ALL", resourceIds: ["a"] }, TODAY).ok, false, "everyone has nobody picked");
  const many = Array.from({ length: MESSAGE_LIMITS.maxRecipients + 1 }, (_, i) => `r${i}`);
  assert.equal(parseMessage({ text: "Hi there", audience: "PEOPLE", resourceIds: many }, TODAY).ok, false);
  const p = parseMessage({ text: "Hi there", audience: "PEOPLE", resourceIds: ["a", "a", "b"], showUntil: TODAY }, TODAY);
  assert.ok(p.ok && p.value.resourceIds.join() === "a,b" && p.value.showUntil === TODAY);
  assert.equal(parseMessage({ text: "Hi there", audience: "ALL", showUntil: addDays(TODAY, -1) }, TODAY).ok, false);
  assert.equal(parseMessage({ text: "Hi there", audience: "ALL", showUntil: addDays(TODAY, 91) }, TODAY).ok, false);
  assert.equal(parseMessage({ text: "Hi there", audience: "ALL", showUntil: "2026-02-30" }, TODAY).ok, false);
  assert.equal(parseMessage({ text: "Hi there", audience: "ALL", showUntil: addDays(TODAY, 90) }, TODAY).ok, true);
});

test("archive reason optional, checked like the text; 30 a day per login", () => {
  assert.deepEqual(parseArchive({}), { ok: true, reason: null });
  assert.equal(parseArchive({ reason: "owes $20" }).ok, false);
  assert.equal(rateRefusal(MESSAGE_LIMITS.perDay - 1), null);
  assert.ok(rateRefusal(MESSAGE_LIMITS.perDay));
});

test("hire worker match: company key (built-in spellings folded) + name key (case, spaces, punctuation)", () => {
  const k = hireKey("Sam O'Brien", "Advanced Labour Hire Pty Ltd");
  assert.equal(hireKey("  sam   obrien ", "advanced"), k);
  assert.equal(hireKey("SAM O'BRIEN", "Advanced Group"), k, "a built-in spelling of the same company");
  assert.notEqual(hireKey("Sam O'Brien", "Other Crew Co"), k, "another company is another person");
  assert.notEqual(hireKey("Sam Brien", "Advanced"), k, "nothing else is guessed about a name");
  assert.equal(personKeyOf({ resourceId: "r1" }), "r1");
  assert.ok(personKeyOf({ hire: { name: "Sam", company: "Advanced" } }).startsWith("hire:"));
});

test("who sees which: own + everyone; never another person's; not archived, finished or already seen", () => {
  const messages = [
    msg({ id: "all" }),
    msg({ id: "mine", audience: "PEOPLE" }),
    msg({ id: "theirs", audience: "PEOPLE" }),
    msg({ id: "archived", archivedAt: new Date() }),
    msg({ id: "finished", showUntil: addDays(TODAY, -1) }),
    msg({ id: "lastday", showUntil: TODAY }),
    msg({ id: "seen" }),
  ];
  const recipients = new Map([["mine", new Set(["r1"])], ["theirs", new Set(["r2"])]]);
  const ids = (who: Parameters<typeof personKeyOf>[0], seen = new Set(["seen"])) => messagesFor({ messages, recipients, seen, who, today: TODAY, knownDevice: true }).map((m) => m.id).sort().join();
  assert.equal(ids({ resourceId: "r1" }), "all,lastday,mine");
  assert.equal(ids({ resourceId: "r2" }), "all,lastday,theirs");
  assert.equal(ids({ resourceId: "r3" }), "all,lastday");
  assert.equal(ids({ hire: { name: "Sam", company: "Advanced" } }), "all,lastday", "a hire worker: everyone messages only");
  assert.equal(ids({ resourceId: "r1" }, new Set(["seen", "mine", "all"])), "lastday", "seen once - it doesn't show again");
  assert.equal(statusOf(msg({ id: "x", showUntil: TODAY }), TODAY), "LIVE");
  assert.equal(statusOf(msg({ id: "x", showUntil: TODAY }), addDays(TODAY, 1)), "EXPIRED");
  assert.equal(statusOf(msg({ id: "x", archivedAt: new Date() }), TODAY), "ARCHIVED");
  const lots = Array.from({ length: 9 }, (_, i) => msg({ id: `m${i}`, createdAt: new Date(Date.UTC(2026, 10, 20, i)) }));
  const shown = messagesFor({ messages: lots, recipients: new Map(), seen: new Set(), who: { resourceId: "r1" }, today: TODAY, knownDevice: true });
  assert.equal(shown.length, MESSAGE_LIMITS.showMax);
  assert.equal(shown[0].id, "m8", "newest first");
  // "Got it": only on a live message that is theirs to see.
  assert.equal(mayMark(msg({ id: "a" }), undefined, { hire: { name: "Sam", company: "A" } }, TODAY, false), true);
  assert.equal(mayMark(msg({ id: "p", audience: "PEOPLE" }), new Set(["r2"]), { resourceId: "r1" }, TODAY, true), false);
  assert.equal(mayMark(msg({ id: "p", audience: "PEOPLE" }), new Set(["r1"]), { resourceId: "r1" }, TODAY, true), true);
  assert.equal(mayMark(msg({ id: "p", audience: "PEOPLE" }), undefined, { hire: { name: "r1", company: "x" } }, TODAY, true), false);
  assert.equal(mayMark(msg({ id: "x", archivedAt: new Date() }), undefined, { resourceId: "r1" }, TODAY, true), false);
});

test("SM-001 B: a person's messages show after a QR sign-in only on a phone already known to be theirs", () => {
  const messages = [msg({ id: "all" }), msg({ id: "mine", audience: "PEOPLE" }), msg({ id: "theirs", audience: "PEOPLE" })];
  const recipients = new Map([["mine", new Set(["r1"])], ["theirs", new Set(["r2"])]]);
  const ids = (knownDevice: boolean) => messagesFor({ messages, recipients, seen: new Set(), who: { resourceId: "r1" }, today: TODAY, knownDevice }).map((m) => m.id).sort().join();
  assert.equal(ids(true), "all,mine", "a known device: their own + everyone");
  assert.equal(ids(false), "all", "an unknown device: everyone only");
  // "Got it" on their own message from an unknown phone: refused (the route answers 404, as for a missing message).
  assert.equal(mayMark(msg({ id: "mine", audience: "PEOPLE" }), new Set(["r1"]), { resourceId: "r1" }, TODAY, false), false);
  assert.equal(mayMark(msg({ id: "all" }), undefined, { resourceId: "r1" }, TODAY, false), true, "an everyone message is still fine");

  const at = new Date("2026-11-23T20:00:00Z");
  const base = { resourceId: "r1", deviceId: "dev1", earlierSameDevice: 0, pass: null, signInAt: at };
  assert.equal(isKnownDevice(base), false, "first time on this phone");
  assert.equal(isKnownDevice({ ...base, earlierSameDevice: 1 }), true, "a confirmed sign-in of theirs on this phone on an earlier day");
  assert.equal(isKnownDevice({ ...base, earlierSameDevice: 1, deviceId: null }), false, "no device id: never known");
  assert.equal(isKnownDevice({ ...base, earlierSameDevice: 1, resourceId: null }), false, "a hire worker: never");
  assert.equal(isKnownDevice({ ...base, pass: { resourceId: "r1", issuedAt: at.getTime() - 86_400_000 } }), true, "their travel pass, made before this sign-in");
  assert.equal(isKnownDevice({ ...base, pass: { resourceId: "r2", issuedAt: at.getTime() - 86_400_000 } }), false, "someone else's pass");
  assert.equal(isKnownDevice({ ...base, pass: { resourceId: "r1", issuedAt: at.getTime() + 1_000 } }), false, "a pass this very sign-in made proves nothing yet");

  // The pass reader: tied to the phone, made-at time recovered.
  process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";
  const pass = makeTravelPass("r1", "dev1", 5_000);
  assert.deepEqual(readTravelPassIssued(pass, "dev1", 6_000), { resourceId: "r1", issuedAt: 5_000 });
  assert.equal(readTravelPassIssued(pass, "dev2", 6_000), null, "another phone can't use it");
  assert.equal(readTravelPass(pass, "dev1", 6_000), "r1", "the travel page's reader is unchanged");
});

test("SM-001 B, source: the QR path asks whether the phone is known; the link path always shows their own", () => {
  const qr = src("../../app/api/site/in/office-notes/route.ts");
  assert.ok(/crewMessages\(who\.who, \{ knownDevice: who\.knownDevice \}\)/.test(qr), "QR list: restricted by the sign-in's device");
  assert.ok(/knownDevice: who\.knownDevice, attendanceId/.test(qr), "QR Got it: restricted the same way");
  const link = src("../../app/api/site/[token]/office-notes/route.ts");
  assert.ok(/crewMessages\(\{ resourceId: link\.person\.id \}, \{ knownDevice: true \}\)/.test(link) && /knownDevice: true, siteLinkId/.test(link), "the person's own link: their own messages too");
  const store = src("./store.ts");
  assert.ok(/status: "CONFIRMED", removedAt: null, date: \{ lt: a\.date \}/.test(store), "known = a confirmed, not removed sign-in on an earlier day");
  assert.ok(/readTravelPassIssued\(opts\.pass, deviceId\)/.test(store), "the pass is checked against the sign-in's own device id");
  assert.ok(/isKnownDevice\(/.test(store) && /"resourceId" in who && knownDevice \? who\.resourceId : null/.test(store), "an unknown device never reads their recipient rows");
  assert.ok(/Messages to a person show on their own phone or link only\./.test(src("../../components/attendance/SigninMessagesPanel.tsx")), "the office is told");
});

test("the phone gets the words and the day only - never who else, never the writer's login", () => {
  const c = toCrew({ ...msg({ id: "a" }), createdBy: "Release Office", archivedBy: null } as MessageRow);
  assert.deepEqual(Object.keys(c ?? {}).sort(), ["id", "sent", "text"]);
  assert.equal(c?.sent, "23 Nov");
  assert.equal(toCrew(msg({ id: "b", text: "sneaky $5" })), null, "the money guard is the backstop");
});

test("the office view: each person seen / not seen yet; everyone messages list who has seen them", () => {
  const base = { createdBy: "Alex", archivedBy: null, archiveReason: null };
  const seenRow = (messageId: string, personKey: string, o = {}) => ({ messageId, personKey, resourceId: personKey.startsWith("hire:") ? null : personKey, hireName: null, hireCompany: null, where: "QR", seenAt: new Date("2026-11-23T00:00:00Z"), ...o });
  const names = new Map([["r1", "Ann"], ["r2", "Bob"]]);
  const p = officeView({ ...msg({ id: "p", audience: "PEOPLE" }), ...base }, [{ messageId: "p", resourceId: "r1", name: "Ann" }, { messageId: "p", resourceId: "r2", name: "Bob" }], [seenRow("p", "r1")], names, TODAY);
  assert.deepEqual(p.recipients.map((r) => [r.name, !!r.seenAt, r.where]), [["Ann", true, "QR"], ["Bob", false, null]]);
  const a = officeView({ ...msg({ id: "a" }), ...base }, [], [seenRow("a", "r2", { where: "LINK" }), seenRow("a", "hire:x|sam", { hireName: "Sam", hireCompany: "Advanced" }), seenRow("other", "r1")], names, TODAY);
  assert.equal(a.seenCount, 2);
  assert.deepEqual(a.recipients.map((r) => r.name).sort(), ["Bob", "Sam (Advanced)"]);
  assert.equal(officeView({ ...msg({ id: "z", archivedAt: new Date("2026-11-23T01:00:00Z") }), ...base, archivedBy: "Ilies", archiveReason: "sent twice" }, [], [], names, TODAY).archived?.reason, "sent twice");
});

test("message token: tied to one sign-in, 3 hours, never another kind of token", () => {
  process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";
  const now = Date.now();
  const t = makeMessageToken("att1", now);
  assert.equal(readMessageToken(t, now), "att1");
  assert.equal(readMessageToken(t, now + 3 * 3_600_000 + 1), null);
  assert.equal(readMessageToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now), null);
  assert.equal(readMessageToken(null, now), null);
});

test("source: the sign-in never waits on messages; the routes keep to the agreed people and screens", () => {
  const sign = src("../../app/api/site/in/sign/route.ts");
  assert.ok(/\.\.\.messageTokenFor\(signedIn\.id\)/.test(sign) && !/signinMessages/.test(sign), "the IN reply only carries a token - no message lookup in the sign-in");
  for (const f of ["../../app/api/attendance/messages/route.ts", "../../app/api/attendance/messages/[id]/archive/route.ts"]) {
    const s = src(f);
    assert.ok((s.match(/guardOrCoordinator\("MANAGER"\)/g) ?? []).length >= 1 && !/guard\("VIEWER"\)/.test(s), f);
  }
  const qr = src("../../app/api/site/in/office-notes/route.ts");
  assert.ok(/x-message-token/.test(qr) && !/searchParams/.test(qr), "the QR token never travels in the address");
  assert.ok(/resolveReceiptLink/.test(src("../../app/api/site/[token]/office-notes/route.ts")), "the link route: SUPERVISOR / DRIVER only");
  const card = src("../../components/site/CrewMessages.tsx");
  assert.ok(!/dangerouslySetInnerHTML/.test(card) && !/dangerouslySetInnerHTML/.test(src("../../components/attendance/SigninMessagesPanel.tsx")));
  const page = src("../../app/site/in/[code]/page.tsx");
  const doneAt = page.indexOf(") : done ? (");
  assert.ok(doneAt > 0 && page.indexOf("<CrewMessages", doneAt) > doneAt && page.indexOf("<CrewMessages") > page.indexOf("<PrestartCheck"), "shown only on the final screen, after the odometer and pre-start");
  const store = src("./store.ts");
  assert.ok(!/\.(delete|deleteMany)\(/.test(store), "nothing deleted");
  assert.ok(!/signinMessage\.update\(/.test(store) && /archivedAt: null/.test(store), "the text is never rewritten - only archived");
});
