// Yard jobs (Ilies, 4 Nov 2026): the status moves, who may act, the grouping and the
// no-money rule on every yard / link DTO. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SiteRequest, SiteRequestEvent } from "@prisma/client";
import {
  BLOCKED_WHILE_WITH_YARD, YARD_KINDS, adminBlockedByYard, dayLabel, groupYardJobs, isYardLink, mayActOnYard, mayChooseYard,
  onItIsRepeat, onYardList, pullBackError, sendToYardError, sendsToYard, sharedWho, sydneyDay, yardActionError,
} from "./rules";
import { siteView, yardView } from "../siteRequests";
import { NEEDS_ILIES, OFFICE_KINDS, ON_TODO, OPEN_STATUSES, STATUS_FOR_OFFICE, STATUS_FOR_SITE, isOverdue } from "../requestTypes";

const req = (r: Partial<SiteRequest> & { events?: SiteRequestEvent[] } = {}): SiteRequest & { events: SiteRequestEvent[] } => ({
  id: "r1", number: 123, kind: "TOOLS", priority: "HIGH", neededBy: new Date("2026-11-05T20:00:00Z"), projectId: "p1", siteLabel: "Myers",
  summary: "2 x 9in grinder", details: JSON.stringify({ item: "9in grinder", qty: "2" }), note: null, photoFile: null, requestedBy: "Tom", requestedById: "res-tom", siteLinkId: "l1",
  status: "YARD", seenAt: null, officeNote: null, question: null, answer: null, declineReason: null, assigneeId: null, assigneeName: null,
  outcome: null, doneAt: null, hireResourceId: null, remindAt: null, remindNote: null, remindedAt: null, aiSuggestion: null, aiSuggestedAt: null,
  origin: "SITE", findingId: null, audience: "OPERATIONAL", assigneeUserId: null, answerFile: null,
  yardAt: new Date("2026-11-04T01:00:00Z"), yardBy: "Tom", readyAt: null, readyBy: null, readyNote: null, readyPhotoFile: null, readySiteLinkId: null,
  createdAt: new Date("2026-11-04T01:00:00Z"), updatedAt: new Date("2026-11-04T01:00:00Z"), events: [], ...r,
});
const ev = (action: string, by: string, at = "2026-11-04T03:00:00Z"): SiteRequestEvent => ({ id: action, requestId: "r1", action, by, note: null, at: new Date(at) });

// ---------- the supervisor's choice ----------

test("only tools, materials and deliveries can go straight to the yard, and only when asked", () => {
  assert.deepEqual(YARD_KINDS, ["TOOLS", "MATERIALS", "DELIVERY"]);
  for (const k of YARD_KINDS) {
    assert.equal(mayChooseYard(k), true);
    assert.equal(sendsToYard(k, "YARD"), true);
    assert.equal(sendsToYard(k, "OFFICE"), false);
    assert.equal(sendsToYard(k, undefined), false); // an older phone without the choice: the office, as before
  }
  for (const k of ["LABOUR", "TRUCK", "HIRE", "SAFETY", "OTHER", "QUERY", "ACTION"]) assert.equal(sendsToYard(k, "YARD"), false, k);
});

// ---------- status moves ----------

test("an Admin sends any open site request to the yard - never an office kind, a closed one or one already there", () => {
  for (const s of ["SENT", "SEEN", "NEEDS_INFO", "TODO", "ACTIONING", "MINE", "CANT_DO"]) assert.equal(sendToYardError({ kind: "LABOUR", status: s }), null, s);
  for (const s of ["YARD", "READY", "DONE", "DECLINED", "CANCELLED", "ANSWERED"]) assert.ok(sendToYardError({ kind: "TOOLS", status: s }), s);
  for (const k of OFFICE_KINDS) assert.ok(sendToYardError({ kind: k, status: "SEEN" }), k);
});

test("pull back only from the yard; while with the yard approve / mine / ask / done wait", () => {
  assert.equal(pullBackError({ status: "YARD" }), null);
  assert.equal(pullBackError({ status: "READY" }), null);
  for (const s of ["SEEN", "DONE", "CANT_DO"]) assert.ok(pullBackError({ status: s }), s);
  for (const a of BLOCKED_WHILE_WITH_YARD) {
    assert.ok(adminBlockedByYard(a, "YARD"));
    assert.ok(adminBlockedByYard(a, "READY"));
    assert.equal(adminBlockedByYard(a, "SEEN"), null);
  }
  for (const a of ["DECLINE", "REMIND", "COLLECTED", "PULL_BACK"]) assert.equal(adminBlockedByYard(a, "YARD"), null, a);
});

test("the yard: ready / on it / can't do only from YARD; collected only from READY", () => {
  for (const a of ["ON_IT", "READY", "CANT_DO"]) {
    assert.equal(yardActionError(a, "YARD"), null, a);
    for (const s of ["READY", "SEEN", "DONE", "CANCELLED"]) assert.ok(yardActionError(a, s), `${a} from ${s}`);
  }
  assert.equal(yardActionError("COLLECTED", "READY"), null);
  for (const s of ["YARD", "SEEN", "DONE", "DECLINED"]) assert.ok(yardActionError("COLLECTED", s), s);
  assert.equal(yardActionError("DELETE", "YARD"), "Unknown action.");
});

test("YARD and READY are open, have labels, aren't waiting on Ilies and aren't on Alex's to-do", () => {
  for (const s of ["YARD", "READY"]) {
    assert.ok(OPEN_STATUSES.includes(s));
    assert.ok(!NEEDS_ILIES.includes(s));
    assert.ok(!ON_TODO.includes(s));
    assert.ok(STATUS_FOR_SITE[s] && STATUS_FOR_OFFICE[s]);
  }
  assert.equal(STATUS_FOR_SITE.YARD, "With the yard");
  assert.equal(STATUS_FOR_SITE.READY, "Ready for collection");
  assert.equal(isOverdue({ neededBy: "2026-10-01T00:00:00Z", status: "READY" }), true);
});

// ---------- who may act ----------

test("who may act: the yard's shared link, the YARD login and Admins - never Managers, the coordinator or another link", () => {
  assert.equal(mayActOnYard({ via: "LINK", kind: "OFFICE", shared: true }), true);
  assert.equal(mayActOnYard({ via: "LINK", kind: "OFFICE", shared: false }), false); // Alex's own office link
  for (const kind of ["SUPERVISOR", "HANDOVER", "DRIVER", "POSTER"]) assert.equal(mayActOnYard({ via: "LINK", kind, shared: false }), false, kind);
  assert.equal(mayActOnYard({ via: "LOGIN", role: "ADMIN" }), true);
  assert.equal(mayActOnYard({ via: "LOGIN", role: "YARD" }), true);
  for (const role of ["MANAGER", "VIEWER", "COORDINATOR", "TIMESHEETS", "ACCOUNTS", "DIRECTOR", "SOMETHING_NEW"]) assert.equal(mayActOnYard({ via: "LOGIN", role }), false, role);
  assert.equal(isYardLink({ kind: "OFFICE", shared: true }), true);
  assert.equal(isYardLink({ kind: "SUPERVISOR", shared: true }), false);
});

test("a shared-link name is required and stored 'Yard - Sam'", () => {
  assert.equal(sharedWho("Yard", "  Sam  "), "Yard - Sam");
  assert.equal(sharedWho("Yard", ""), null);
  assert.equal(sharedWho("Yard", "S"), null);
  assert.equal(sharedWho("Yard", 5), null);
  assert.equal(sharedWho("Yard", "x".repeat(80))!.length, "Yard - ".length + 40);
});

test("YD-005: On it again by the same person within 10 minutes is a repeat", () => {
  const now = new Date("2026-11-04T03:09:00Z");
  const e = { action: "YARD_ON_IT", by: "Yard - Sam", at: "2026-11-04T03:00:00Z" };
  assert.equal(onItIsRepeat(e, "Yard - Sam", now), true);
  assert.equal(onItIsRepeat(e, "Yard - Joe", now), false); // someone else
  assert.equal(onItIsRepeat(e, "Yard - Sam", new Date("2026-11-04T03:10:00Z")), false); // 10 minutes on
  assert.equal(onItIsRepeat({ ...e, action: "SENT_TO_YARD" }, "Yard - Sam", now), false); // not the latest step
  assert.equal(onItIsRepeat(null, "Yard - Sam", now), false);
});

test("YD-004: a name with a dollar figure is refused", () => {
  assert.equal(sharedWho("Yard", "Sam $5"), null);
  assert.equal(sharedWho("Yard", "$ 200 Sam"), null);
  assert.equal(sharedWho("Yard", "Sam #5"), "Yard - Sam #5");
});

test("YD-004: names already stored with a dollar figure never reach a link or the yard", () => {
  const r = req({
    status: "READY", readyAt: new Date("2026-11-04T04:00:00Z"), readyBy: "Yard - Sam $5", readyPhotoFile: "1-0123456789abcdef.jpg",
    yardBy: "Tom $10", requestedBy: "Tom $10",
  });
  assert.ok(!DOLLAR.test(JSON.stringify(yardView(r))));
  assert.ok(!DOLLAR.test(JSON.stringify(siteView(r).yard)));
  const done = req({ status: "DONE", outcome: "Collected", doneAt: new Date(), readyAt: new Date(), events: [ev("COLLECTED", "Yard - $9 Joe")] });
  assert.ok(!DOLLAR.test(JSON.stringify(siteView(done).yard)));
});

// ---------- the list ----------

test("the default list: open + ready, and collected in the last 7 days only", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const yardAt = "2026-11-01T00:00:00Z";
  assert.equal(onYardList({ status: "YARD", outcome: null, doneAt: null, yardAt }, now), true);
  assert.equal(onYardList({ status: "READY", outcome: null, doneAt: null, yardAt }, now), true);
  assert.equal(onYardList({ status: "DONE", outcome: "Collected", doneAt: "2026-11-05T00:00:00Z", yardAt }, now), true);
  assert.equal(onYardList({ status: "DONE", outcome: "Collected", doneAt: "2026-11-01T00:00:00Z", yardAt }, now), false);
  assert.equal(onYardList({ status: "DONE", outcome: "Booked Coates", doneAt: "2026-11-09T00:00:00Z", yardAt }, now), false);
  assert.equal(onYardList({ status: "YARD", outcome: null, doneAt: null, yardAt: null }, now), false);
  assert.equal(onYardList({ status: "SEEN", outcome: null, doneAt: null, yardAt }, now), false); // pulled back
});

test("grouped by needed-by day in Sydney time, then site; most urgent first", () => {
  const now = new Date("2026-11-04T02:00:00Z"); // Wed 4 Nov, 1pm Sydney
  const rows = [
    { id: "a", status: "YARD", neededBy: "2026-11-04T20:00:00Z", site: "Myers", priority: "LOW" }, // Thu 7am Sydney
    { id: "b", status: "YARD", neededBy: "2026-11-04T21:00:00Z", site: "Myers", priority: "URGENT" }, // Thu 8am
    { id: "c", status: "READY", neededBy: "2026-11-04T05:00:00Z", site: "Bondi", priority: "HIGH" }, // Wed 4pm (today)
    { id: "d", status: "YARD", neededBy: "2026-11-02T22:00:00Z", site: "Zetland", priority: "HIGH" }, // Tue 9am - overdue
    { id: "e", status: "YARD", neededBy: "2026-11-04T23:00:00Z", site: "Alexandria", priority: "HIGH" }, // Thu
    { id: "f", status: "DONE", neededBy: "2026-11-03T22:00:00Z", site: "Myers", priority: "HIGH", collectedAt: "2026-11-04T00:00:00Z" },
  ];
  const g = groupYardJobs(rows, now);
  assert.deepEqual(g.groups.map((x) => x.day), ["2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.equal(g.groups[0].overdue, true);
  assert.match(g.groups[0].label, /overdue/);
  assert.match(g.groups[1].label, /^Today/);
  assert.match(g.groups[2].label, /^Tomorrow/);
  assert.deepEqual(g.groups[2].sites.map((s) => s.site), ["Alexandria", "Myers"]);
  assert.deepEqual(g.groups[2].sites[1].jobs.map((j) => j.id), ["b", "a"]);
  assert.deepEqual(g.collected.map((j) => j.id), ["f"]);
  assert.equal(g.open, 5);
  assert.equal(g.ready, 1);
  assert.equal(sydneyDay("2026-11-04T14:30:00Z"), "2026-11-05"); // 1:30am Thursday in Sydney
  assert.equal(dayLabel("2026-11-10", "2026-11-04"), "Tue 10 Nov");
});

// ---------- money guard ----------

const DOLLAR = /\$\s?\d/;

test("the yard's DTO never carries a dollar figure - the supervisor's words and the office note included", () => {
  const r = req({
    summary: "2 x grinder ~$300", details: JSON.stringify({ item: "grinder, about $150 each", qty: "2" }), note: "Bunnings has them for $149",
    officeNote: "Max $400", status: "READY", readyAt: new Date("2026-11-04T04:00:00Z"), readyBy: "Yard - Sam",
    readyNote: "Only 1 here - buy another, $159 at Sydney Tools", readyPhotoFile: "1-0123456789abcdef.jpg",
  });
  const y = yardView(r);
  assert.ok(!DOLLAR.test(JSON.stringify(y)), JSON.stringify(y));
  assert.equal(y.note, "Details are with the office");
  assert.equal(y.readyNote, "Details are with the office");
  assert.equal(y.hasReadyPhoto, true);
  // No pay, rate or cost field in it at all.
  for (const k of Object.keys(y)) assert.ok(!/rate|cost|price|amount|pay/i.test(k), k);
});

test("the supervisor's link: ready photo and missing note, money swapped for a pointer", () => {
  const ready = req({ status: "READY", readyAt: new Date("2026-11-04T04:00:00Z"), readyBy: "Yard - Sam", readyNote: "need to buy 1 more ($159)", readyPhotoFile: "1-0123456789abcdef.jpg" });
  const s = siteView(ready);
  assert.equal(s.yard?.readyNote, "Details are with the office");
  assert.equal(s.yard?.hasReadyPhoto, true);
  assert.ok(!DOLLAR.test(JSON.stringify(s.yard)));
  const clean = siteView(req({ status: "READY", readyAt: new Date("2026-11-04T04:00:00Z"), readyNote: "only 1 of the 2", readyPhotoFile: "1-0123456789abcdef.jpg" }));
  assert.equal(clean.yard?.readyNote, "only 1 of the 2");
});

test("the supervisor's link: with the yard (no ready info yet), collected, and nothing for a request that never went", () => {
  const withYard = siteView(req({ status: "YARD", events: [ev("YARD_ON_IT", "Yard - Sam")] }));
  assert.equal(withYard.yard?.readyAt, null);
  assert.equal(withYard.yard?.hasReadyPhoto, false);
  assert.equal(withYard.yard?.onItBy, "Yard - Sam");
  const collected = siteView(req({
    status: "DONE", outcome: "Collected", doneAt: new Date("2026-11-04T06:00:00Z"), readyAt: new Date("2026-11-04T04:00:00Z"), readyPhotoFile: "1-0123456789abcdef.jpg",
    events: [ev("YARD_READY", "Yard - Sam"), ev("COLLECTED", "Tom", "2026-11-04T06:00:00Z")],
  }));
  assert.equal(collected.yard?.collectedBy, "Tom");
  assert.equal(collected.yard?.collectedAt, "2026-11-04T06:00:00.000Z");
  assert.equal(siteView(req({ status: "SEEN", yardAt: null })).yard, null);
  // Pulled back: no yard block on the link (the office has it again).
  assert.equal(siteView(req({ status: "SEEN" })).yard, null);
});
