// Date exceptions with codes (24 Oct 2026): the coded list says exactly what
// the Projects page has always shown, one code per rule. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateExceptionList, dateExceptions, type ProjectBoardDates } from "./dateExceptions";
import { COMPLETION_TBC } from "./projectFile";

const TODAY = "2026-10-24";
const board = (b: Partial<ProjectBoardDates>): ProjectBoardDates =>
  ({ firstJobDate: null, lastJobDate: null, nextJobDate: null, upcomingNoTimes: 0, predatesBoard: false, ...b });

const cases: { name: string; p: Parameters<typeof dateExceptions>[0]; b: ProjectBoardDates; codes: string[] }[] = [
  { name: "inactive with jobs", p: { status: "ON_HOLD", startDate: null, expectedCompletion: null }, b: board({ nextJobDate: "2026-10-27" }), codes: ["DATE_INACTIVE_HAS_JOBS"] },
  { name: "completed with jobs", p: { status: "COMPLETED", startDate: null, expectedCompletion: null }, b: board({ nextJobDate: "2026-10-27" }), codes: ["DATE_COMPLETED_HAS_JOBS"] },
  { name: "no start + no times", p: { status: "ACTIVE", startDate: null, expectedCompletion: null }, b: board({ firstJobDate: "2026-10-01", upcomingNoTimes: 2 }), codes: ["DATE_NO_START", "DATE_JOBS_NO_TIMES"] },
  { name: "start mismatch + jobs after completion", p: { status: "ACTIVE", startDate: "2026-10-05", expectedCompletion: "2026-10-20" }, b: board({ firstJobDate: "2026-10-06", lastJobDate: "2026-10-22" }), codes: ["DATE_START_MISMATCH", "DATE_JOBS_AFTER_COMPLETION"] },
  { name: "completion passed", p: { status: "ACTIVE", startDate: "2026-10-01", expectedCompletion: "2026-10-10" }, b: board({ firstJobDate: "2026-10-01", lastJobDate: "2026-10-09" }), codes: ["DATE_COMPLETION_PASSED"] },
  { name: "TBC review due", p: { status: "ACTIVE", startDate: "2026-10-01", expectedCompletion: COMPLETION_TBC, completionReviewBy: "2026-10-20" }, b: board({ firstJobDate: "2026-10-01" }), codes: ["DATE_TBC_REVIEW_DUE"] },
  { name: "archived: nothing", p: { status: "ACTIVE", archived: true, startDate: null, expectedCompletion: null }, b: board({}), codes: [] },
];

for (const c of cases) {
  test(`date exceptions: ${c.name}`, () => {
    const list = dateExceptionList(c.p, c.b, TODAY);
    assert.deepEqual(list.map((e) => e.code), c.codes);
    assert.deepEqual(list.map((e) => e.text), dateExceptions(c.p, c.b, TODAY)); // same words as before
  });
}
