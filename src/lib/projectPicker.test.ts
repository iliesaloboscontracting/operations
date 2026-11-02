import { test } from "node:test";
import assert from "node:assert/strict";
import { canReactivateProject, completedPickQuestion, groupProjects, pickerStatus, projectOptionLabel, resolveCompletedChoice } from "./projectPicker";

const P = (id: string, name: string, status?: string | null) => ({ id, name, status });
const LIST = [
  P("c1", "Bronte", "COMPLETED"), P("a2", "coogee", "ACTIVE"), P("i1", "Myers", "INACTIVE"),
  P("a1", "Alexandria", "ACTIVE"), P("c2", "Annandale", "COMPLETED"), P("i2", "Bondi", "INACTIVE"),
];

test("groups: Active, then Inactive, then Completed - by name inside each, case ignored", () => {
  const g = groupProjects(LIST);
  assert.deepEqual(g.map((x) => x.label), ["Active", "Inactive", "Completed"]);
  assert.deepEqual(g.map((x) => x.projects.map((p) => p.id)), [["a1", "a2"], ["i2", "i1"], ["c2", "c1"]]);
});

test("groups: empty groups are left out; nothing is dropped", () => {
  const g = groupProjects([P("c1", "Bronte", "COMPLETED"), P("a1", "Coogee", "ACTIVE")]);
  assert.deepEqual(g.map((x) => x.status), ["ACTIVE", "COMPLETED"]);
  assert.equal(groupProjects(LIST).reduce((n, x) => n + x.projects.length, 0), LIST.length);
  assert.deepEqual(groupProjects([]), []);
});

test("status: missing = Active (names-only lists); an unknown status reads as Inactive, never hidden", () => {
  assert.equal(pickerStatus(P("x", "X")), "ACTIVE");
  assert.equal(pickerStatus(P("x", "X", null)), "ACTIVE");
  assert.equal(pickerStatus(P("x", "X", "ON_HOLD")), "INACTIVE");
  assert.deepEqual(groupProjects([P("x", "X", "ON_HOLD")]).map((g) => g.status), ["INACTIVE"]);
});

test("labels carry the status for inactive and completed projects", () => {
  assert.equal(projectOptionLabel(P("c1", "Bronte", "COMPLETED")), "Bronte (completed)");
  assert.equal(projectOptionLabel(P("i1", "Myers", "INACTIVE")), "Myers (inactive)");
  assert.equal(projectOptionLabel(P("a1", "Coogee", "ACTIVE")), "Coogee");
  assert.equal(projectOptionLabel(P("c1", "Bronte", "COMPLETED"), "Bronte — Lendlease"), "Bronte — Lendlease (completed)");
});

test("only a Completed project asks; Active, Inactive, none and the same value don't", () => {
  assert.equal(completedPickQuestion(P("a1", "Coogee", "ACTIVE"), true), null);
  assert.equal(completedPickQuestion(P("i1", "Myers", "INACTIVE"), true), null);
  assert.equal(completedPickQuestion(null, true), null);
  assert.equal(completedPickQuestion(undefined, false), null);
  assert.equal(completedPickQuestion(P("c1", "Bronte", "COMPLETED"), true, "c1"), null, "re-picking the value it already has asks nothing");
  const q = completedPickQuestion(P("c1", "Bronte", "COMPLETED"), true, "");
  assert.equal(q?.question, "Bronte is marked Completed. Is this job active again, or still completed?");
});

test("the question offers 'Active again' only to a login that can change a project's status", () => {
  assert.deepEqual(completedPickQuestion(P("c1", "Bronte", "COMPLETED"), true)?.choices, ["REACTIVATE", "KEEP", "CANCEL"]);
  assert.deepEqual(completedPickQuestion(P("c1", "Bronte", "COMPLETED"), false)?.choices, ["KEEP", "CANCEL"]);
  for (const r of ["ADMIN", "MANAGER"]) assert.equal(canReactivateProject(r), true, r);
  for (const r of ["VIEWER", "COORDINATOR", "ACCOUNTS", "DIRECTOR", "TIMESHEETS", "", null, undefined, "admin"]) assert.equal(canReactivateProject(r), false, String(r));
});

test("choices: Active again keeps it and reactivates; Still completed keeps it; Cancel goes back", () => {
  assert.deepEqual(resolveCompletedChoice("REACTIVATE", "c1", "a1", true), { value: "c1", reactivate: true });
  assert.deepEqual(resolveCompletedChoice("KEEP", "c1", "a1", true), { value: "c1", reactivate: false });
  assert.deepEqual(resolveCompletedChoice("KEEP", "c1", "", false), { value: "c1", reactivate: false });
  assert.deepEqual(resolveCompletedChoice("CANCEL", "c1", "a1", true), { value: "a1", reactivate: false });
  assert.deepEqual(resolveCompletedChoice("CANCEL", "c1", "", false), { value: "", reactivate: false });
  // Someone who can't reactivate never sends the PATCH, even if the choice arrives anyway.
  assert.deepEqual(resolveCompletedChoice("REACTIVATE", "c1", "a1", false), { value: "a1", reactivate: false });
});
