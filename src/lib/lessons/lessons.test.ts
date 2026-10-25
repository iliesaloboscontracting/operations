// Lessons (LCI phase 5a): only the owner publishes; who reads which; which
// findings can become a lesson; what a lesson needs; and that the prefilled
// draft adds no figure that isn't on the finding's own record. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canPublishLessons, canReadLesson, draftFrom, outcomeOf, parseLesson, type FindingForDraft } from "./rules";

const OWNER = "iliesa@loboscontracting.com.au";
const u = (x: Record<string, unknown>) => ({ id: "u", name: "x", email: "x@y", role: "MANAGER", directorAccess: false, ...x });

test("only the owner publishes lessons (Ilies: 'thats me') - not a director, not an Admin, not a ticked Admin", () => {
  assert.equal(canPublishLessons(u({ email: OWNER, role: "ADMIN" })), true);
  for (const role of ["DIRECTOR", "ADMIN", "MANAGER", "VIEWER", "ACCOUNTS"]) assert.equal(canPublishLessons(u({ role, directorAccess: true })), false, role);
});

test("reading: the owner reads every lesson; a DIRECTOR login reads the Directors-screen ones, not operational ones", () => {
  const owner = u({ email: OWNER, role: "ADMIN" }), dir = u({ role: "DIRECTOR" });
  const costLesson = { ruleCode: "COST_VS_CONTRACT", audience: "COMMERCIAL" }, hireLesson = { ruleCode: "HIRE_OVERDUE", audience: "OPERATIONAL" };
  assert.ok(canReadLesson(owner, costLesson) && canReadLesson(owner, hireLesson));
  assert.ok(canReadLesson(dir, costLesson));
  assert.ok(!canReadLesson(dir, hireLesson));
  assert.ok(!canReadLesson(u({ role: "ACCOUNTS" }), costLesson));
});

test("which findings: verified (EFFECTIVE), verified as not working, or came back - nothing else", () => {
  assert.equal(outcomeOf({ status: "VERIFIED", outcomeResult: "EFFECTIVE" }), "EFFECTIVE");
  assert.equal(outcomeOf({ status: "VERIFIED", outcomeResult: null }), "EFFECTIVE");
  assert.equal(outcomeOf({ status: "OPEN", outcomeResult: "NOT_EFFECTIVE" }), "NOT_EFFECTIVE");
  assert.equal(outcomeOf({ status: "OPEN", outcomeResult: "RECURRED" }), "RECURRED");
  for (const status of ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]) assert.equal(outcomeOf({ status, outcomeResult: null }), null, status);
});

test("a lesson needs a title, the situation, what was done and the lesson; tags tidied", () => {
  const ok = parseLesson({ title: "Call hire off on the day", situation: "Excavator stayed on hire a week after the job", action: "Called Mega Hire", lesson: "Call the hire company the day the job finishes.", tags: "Hire, mega hire, hire" });
  assert.ok(!("error" in ok));
  assert.deepEqual((ok as { tags: string[] }).tags, ["hire", "mega hire"]);
  assert.ok("error" in parseLesson({ title: "x", situation: "long enough here", action: "done", lesson: "a real lesson here" }));
  assert.ok("error" in parseLesson({ title: "A title", situation: "long enough here", action: "done", lesson: "" }));
});

test("the draft comes only from the finding's record: no figure that isn't on it, and the lesson line is left blank", () => {
  const f: FindingForDraft = {
    title: "Swiss Hotel: cost at 104% of contract value", ruleCode: "COST_VS_CONTRACT", subjectName: "Swiss Hotel",
    firstSeenAt: new Date("2026-10-20T01:00:00Z"), seenCount: 7, resolution: "Variation of 18 approved by the client", resolvedBy: "Iliesa",
    outcome: null, status: "VERIFIED", outcomeResult: "EFFECTIVE",
    events: [{ action: "COMMENT", by: "Nick", note: "Asked the builder for VO 18" }, { action: "OPENED", by: "System", note: "opened 104" }],
  };
  const d = draftFrom(f);
  assert.equal(d.lesson, "");
  assert.equal(d.result, "EFFECTIVE");
  const record = [f.title, f.resolution, ...f.events.map((e) => e.note), "20 Oct 2026", String(f.seenCount)].join(" ");
  const numbers = (s: string): string[] => s.match(/\d+(\.\d+)?/g) ?? [];
  for (const n of numbers([d.title, d.situation, d.action].join(" "))) assert.ok(numbers(record).includes(n), `draft number ${n} isn't on the record`);
  assert.match(d.action, /Variation of 18 approved by the client \(Iliesa\)/);
  assert.match(d.action, /Asked the builder for VO 18 \(Nick\)/);
  assert.ok(!/opened 104/.test(d.action), "system events aren't copied into 'what was done'");
});
