import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardPlaceholder, bookingCancellable, completedPageRows, isProjectStatus, listOf, PROJECT_STATUS_LABEL, statusLabel,
} from "./projectLists";
import { pickProject, projectStatusError } from "./pickProject";

test("listOf: one list per project - archived wins, then Completed, Active is Current, anything else Stand down", () => {
  assert.equal(listOf({ status: "ACTIVE" }), "CURRENT");
  assert.equal(listOf({ status: "INACTIVE" }), "STAND_DOWN");
  assert.equal(listOf({ status: "ON_HOLD" }), "STAND_DOWN", "an older value is never hidden");
  assert.equal(listOf({ status: "COMPLETED" }), "COMPLETED");
  for (const s of ["ACTIVE", "INACTIVE", "COMPLETED"]) assert.equal(listOf({ status: s, archived: true }), "ARCHIVED", s);
  assert.equal(listOf({ status: "COMPLETED", archived: false }), "COMPLETED");
});

test("labels: INACTIVE is shown as Stand down; the stored values are unchanged", () => {
  assert.equal(PROJECT_STATUS_LABEL.INACTIVE, "Stand down");
  assert.equal(statusLabel("INACTIVE"), "Stand down");
  assert.equal(statusLabel("ON_HOLD"), "Stand down");
  assert.equal(statusLabel("ACTIVE"), "Active");
  assert.equal(statusLabel("COMPLETED"), "Completed");
});

test("boardPlaceholder: Active from its start date on; Stand down always, with Starts <date> while the start is ahead", () => {
  const day = "2026-11-18";
  assert.deepEqual(boardPlaceholder({ status: "ACTIVE", startDate: null }, day), { startsOn: null });
  assert.deepEqual(boardPlaceholder({ status: "ACTIVE", startDate: "2026-11-18" }, day), { startsOn: null });
  assert.equal(boardPlaceholder({ status: "ACTIVE", startDate: "2026-12-08" }, day), null, "the 18 Oct 2026 rule for Active stays");
  // Mammoth (26_164): stood down, starts 8 Dec - on the board's Stand down list every day, saying when it starts.
  assert.deepEqual(boardPlaceholder({ status: "INACTIVE", startDate: "2026-12-08" }, day), { startsOn: "2026-12-08" });
  assert.deepEqual(boardPlaceholder({ status: "INACTIVE", startDate: "2026-12-08" }, "2026-12-08"), { startsOn: null });
  assert.deepEqual(boardPlaceholder({ status: "INACTIVE", startDate: "2026-10-01" }, day), { startsOn: null });
  assert.deepEqual(boardPlaceholder({ status: "INACTIVE", startDate: null }, day), { startsOn: null });
  assert.equal(boardPlaceholder({ status: "COMPLETED", startDate: null }, day), null);
  assert.equal(boardPlaceholder({ status: "INACTIVE", archived: true, startDate: null }, day), null);
});

const P = (id: string, status: string, archived = false, lastJobDate: string | null = null) => ({ id, status, archived, lastJobDate });
const J = (id: string, projectId: string | null, projectStatus: string | null, date: string) => ({ id, projectId, projectStatus, date });

test("completedPageRows: one row per completed project, its completed days counted, no project twice", () => {
  const projects = [P("c1", "COMPLETED", false, "2026-11-01"), P("c1", "COMPLETED", false, "2026-11-01"), P("a1", "ACTIVE"), P("c2", "COMPLETED"), P("arch", "COMPLETED", true)];
  const jobs = [
    J("j1", "c1", "COMPLETED", "2026-10-30"), J("j2", "c1", "COMPLETED", "2026-10-31"), J("j3", "c1", "COMPLETED", "2026-10-31"),
    J("j4", "a1", "ACTIVE", "2026-11-02"), J("j5", null, null, "2026-11-03"), J("j6", "arch", "COMPLETED", "2026-09-01"),
    J("j6", "arch", "COMPLETED", "2026-09-01"), J("j7", "c2", "COMPLETED", "2026-11-05"),
  ];
  const out = completedPageRows(projects, jobs);
  assert.deepEqual(out.projects.map((r) => r.project.id), ["c1", "c2"], "each completed project once; archived / active ones never");
  const c1 = out.projects.find((r) => r.project.id === "c1")!;
  assert.equal(c1.completedDays, 2, "two different days (two jobs on 31 Oct = one day)");
  assert.equal(c1.lastDay, "2026-11-01", "the later of the board's last day and its last completed day");
  assert.equal(out.projects.find((r) => r.project.id === "c2")!.lastDay, "2026-11-05");
  assert.deepEqual(out.jobs.map((j) => j.id), ["j4", "j5"], "loose days: a project that isn't Completed, or no project");
  const ids = out.projects.map((r) => r.project.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("status on save: only ACTIVE | INACTIVE | COMPLETED; blank means not sent", () => {
  for (const s of ["ACTIVE", "INACTIVE", "COMPLETED"]) {
    assert.ok(isProjectStatus(s));
    assert.equal(projectStatusError(pickProject({ status: s })), null, s);
  }
  for (const s of ["STAND_DOWN", "ON_HOLD", "active", "CANCELLED", 3]) {
    assert.match(projectStatusError(pickProject({ status: s }))!, /Active, Stand down or Completed/, String(s));
  }
  assert.equal("status" in pickProject({ status: "" }), false);
  assert.equal(projectStatusError(pickProject({ name: "X" })), null);
});

test("bookings: only a day with nobody signed in and no daily log can be cancelled", () => {
  assert.ok(bookingCancellable({ id: "a", date: "2026-11-20", shift: "DAY", signIns: 0, dailyLogs: 0 }));
  assert.ok(!bookingCancellable({ id: "b", date: "2026-11-20", shift: "DAY", signIns: 2, dailyLogs: 0 }));
  assert.ok(!bookingCancellable({ id: "c", date: "2026-11-20", shift: "DAY", signIns: 0, dailyLogs: 1 }));
});
