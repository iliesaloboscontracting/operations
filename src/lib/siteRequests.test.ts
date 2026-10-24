// Requests for Phase 2 (24 Oct 2026): links only ever see operational,
// money-free office work (condition a); alerts go by kind, site requests
// exactly as before (condition b); ANSWERED counts as open and waiting on
// Ilies (condition c). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SiteRequest, SiteRequestEvent } from "@prisma/client";
import { linkVisible, siteView, todoView, LINK_WHERE } from "./siteRequests";
import { NEEDS_ILIES, OFFICE_KINDS, ON_TODO, OPEN_STATUSES, STATUS_FOR_OFFICE, STATUS_FOR_SITE, SYSTEM_TYPES, alertRouteFor, isOverdue, typeOf } from "./requestTypes";

const req = (r: Partial<SiteRequest> & { events?: SiteRequestEvent[] } = {}): SiteRequest & { events: SiteRequestEvent[] } => ({
  id: "r1", number: 7, kind: "LABOUR", priority: "HIGH", neededBy: new Date("2026-10-27T07:00:00Z"), projectId: "p1", siteLabel: "Myers",
  summary: "2 labourers", details: "{}", note: null, photoFile: null, requestedBy: "Tom", requestedById: "res-tom", siteLinkId: "l1",
  status: "TODO", seenAt: null, officeNote: null, question: null, answer: null, declineReason: null, assigneeId: "res-alex", assigneeName: "Alexander R",
  outcome: null, doneAt: null, hireResourceId: null, remindAt: null, remindNote: null, remindedAt: null, aiSuggestion: null, aiSuggestedAt: null,
  origin: "SITE", findingId: null, audience: "OPERATIONAL", assigneeUserId: null, answerFile: null,
  createdAt: new Date("2026-10-24T01:00:00Z"), updatedAt: new Date("2026-10-24T01:00:00Z"), events: [], ...r,
});

// ---------- condition (a): link-facing views ----------

test("links: every link query filters to OPERATIONAL", () => {
  assert.deepEqual(LINK_WHERE, { audience: "OPERATIONAL" });
});

test("links never show COMMERCIAL or DIRECTOR items, whatever their origin", () => {
  for (const audience of ["COMMERCIAL", "DIRECTOR"])
    for (const origin of ["SITE", "FINDING", "DIRECTOR", "SYSTEM"])
      assert.equal(linkVisible(req({ audience, origin })), false, `${audience}/${origin}`);
  assert.equal(linkVisible(req()), true);
});

test("an operational action or query with a dollar figure stays off the link", () => {
  assert.equal(linkVisible(req({ kind: "ACTION", origin: "FINDING", summary: "Chase Mega Hire invoice (~$5,760)" })), false);
  assert.equal(linkVisible(req({ kind: "QUERY", origin: "DIRECTOR", officeNote: "budget $499,000" })), false);
  assert.equal(linkVisible(req({ kind: "QUERY", origin: "FINDING", details: JSON.stringify({ question: "Rate is $360/day?" }) })), false);
  assert.equal(linkVisible(req({ kind: "QUERY", origin: "FINDING", summary: "Is the generator still on site?" })), true);
});

test("a supervisor's own request stays visible; office text with a dollar figure is swapped for a pointer", () => {
  const r = req({
    status: "DONE", outcome: "Booked Hire Express - $420/day", officeNote: "Max $300", note: "need it by 7am - about $50 of fuel",
    events: [{ id: "e1", requestId: "r1", action: "UPDATE", by: "Alexander R", note: "Quoted $1,200", at: new Date("2026-10-24T02:00:00Z") }],
  });
  assert.equal(linkVisible(r), true);
  const s = siteView(r);
  assert.equal(s.outcome, "Details are with the office");
  assert.equal(s.update?.note, "Details are with the office");
  assert.equal(s.note, "need it by 7am - about $50 of fuel"); // the supervisor's own words, as before
  const t = todoView(r);
  assert.equal(t.officeNote, "Details are with the office");
  assert.equal(t.outcome, "Details are with the office");
});

test("money-free office text is shown exactly as before", () => {
  const r = req({ status: "DONE", outcome: "Booked Hire Express #4471", officeNote: "Ask for the 5t", events: [{ id: "e1", requestId: "r1", action: "UPDATE", by: "Alexander R", note: "On the way", at: new Date("2026-10-24T02:00:00Z") }] });
  assert.equal(siteView(r).outcome, "Booked Hire Express #4471");
  assert.equal(todoView(r).officeNote, "Ask for the 5t");
  assert.equal(siteView(r).update?.note, "On the way");
});

// ---------- condition (b): alerts by kind ----------

test("site and system requests alert every Admin, exactly as before", () => {
  for (const kind of ["LABOUR", "TRUCK", "SAFETY", "OFF_HIRE", "HIRE_MISMATCH", "HIRE_EXTEND"]) {
    assert.equal(alertRouteFor(req({ kind, status: "SENT" }), "NEW"), "ADMINS");
    assert.equal(alertRouteFor(req({ kind, status: "CANT_DO" }), "UPDATE"), "ADMINS");
  }
});

test("actions and queries never go to all Admins", () => {
  for (const kind of OFFICE_KINDS) {
    assert.equal(alertRouteFor(req({ kind, assigneeUserId: "u-accounts", assigneeId: null }), "NEW"), "ASSIGNEE_USER");
    assert.equal(alertRouteFor(req({ kind, assigneeUserId: null, assigneeId: "res-nick" }), "NEW"), "ASSIGNEE_LINKS");
    assert.equal(alertRouteFor(req({ kind, assigneeUserId: null, assigneeId: "res-nick", audience: "COMMERCIAL" }), "NEW"), "NONE"); // no commercial push to a link
    assert.equal(alertRouteFor(req({ kind, assigneeUserId: null, assigneeId: null }), "NEW"), "NONE");
    assert.equal(alertRouteFor(req({ kind, status: "ANSWERED" }), "UPDATE"), "OWNER");
    assert.equal(alertRouteFor(req({ kind, status: "CANT_DO" }), "UPDATE"), "OWNER");
    assert.equal(alertRouteFor(req({ kind, status: "DONE" }), "UPDATE"), "NONE");
    // a follow-up question goes back to the person asked, nobody else
    assert.equal(alertRouteFor(req({ kind, status: "NEEDS_INFO", assigneeUserId: "u-accounts", assigneeId: null }), "UPDATE"), "ASSIGNEE_USER");
    assert.equal(alertRouteFor(req({ kind, status: "NEEDS_INFO", assigneeUserId: null, assigneeId: "res-tom" }), "UPDATE"), "ASSIGNEE_LINKS");
  }
});

// ---------- condition (c): ANSWERED everywhere statuses are listed ----------

test("ANSWERED is open, waits on Ilies, has labels, and stays off the assignee's to-do", () => {
  assert.ok(OPEN_STATUSES.includes("ANSWERED"));
  assert.ok(NEEDS_ILIES.includes("ANSWERED"));
  assert.ok(!ON_TODO.includes("ANSWERED"));
  assert.equal(STATUS_FOR_OFFICE.ANSWERED, "Answered - to close");
  assert.equal(STATUS_FOR_SITE.ANSWERED, "Answered");
  assert.equal(isOverdue({ neededBy: "2026-10-01T00:00:00Z", status: "ANSWERED" }), true); // an answered query past its date still shows overdue
});

test("ACTION and QUERY are system kinds - never on the site form", () => {
  for (const kind of ["ACTION", "QUERY"]) {
    assert.ok(SYSTEM_TYPES.some((t) => t.kind === kind));
    assert.ok(typeOf(kind));
  }
});
