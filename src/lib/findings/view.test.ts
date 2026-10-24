// How stored findings show on the Directors page (24 Oct 2026). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupForDisplay, kpiOfRule, sortFindings, type FindingDTO } from "./view";

const f = (x: Partial<FindingDTO>): FindingDTO => ({
  id: "x", ruleCode: "DATA_UNCOSTED", kpi: "DQ", severity: "INFO", audience: "COMMERCIAL", status: "OPEN", title: "t", href: null,
  subjectName: "Myers", projectId: null, provisional: false, firstSeenAt: "2026-10-24T00:00:00.000Z", lastSeenAt: "2026-10-24T00:00:00.000Z",
  signalClearedAt: null, ownerName: null, ...x,
});

test("worst first; still-firing before cleared; longest-standing first", () => {
  const s = sortFindings([
    f({ id: "info", severity: "INFO" }),
    f({ id: "med-cleared", severity: "MEDIUM", signalClearedAt: "2026-10-24T01:00:00.000Z" }),
    f({ id: "med-new", severity: "MEDIUM", firstSeenAt: "2026-10-25T00:00:00.000Z" }),
    f({ id: "med-old", severity: "MEDIUM", firstSeenAt: "2026-10-20T00:00:00.000Z" }),
    f({ id: "crit", severity: "CRITICAL" }),
  ]);
  assert.deepEqual(s.map((x) => x.id), ["crit", "med-old", "med-new", "med-cleared", "info"]);
});

test("INFO bundled per rule, biggest group first; the rest one by one", () => {
  const g = groupForDisplay([
    f({ id: "a", ruleCode: "DATA_UNCOSTED" }), f({ id: "b", ruleCode: "DATA_UNCOSTED" }), f({ id: "c", ruleCode: "DATE_NO_START" }),
    f({ id: "h", ruleCode: "HIRE_OVERDUE", severity: "HIGH" }),
  ]);
  assert.deepEqual(g.singles.map((x) => x.id), ["h"]);
  assert.deepEqual(g.infoGroups.map((x) => [x.rule, x.items.length]), [["DATA_UNCOSTED", 2], ["DATE_NO_START", 1]]);
  assert.equal(g.infoGroups[0].label, "jobs with allocations that can't be costed");
});

test("each rule's ? opens its KPI entry", () => {
  assert.equal(kpiOfRule("COST_VS_CONTRACT"), "F3");
  assert.equal(kpiOfRule("HIRE_OVERDUE"), "PL3");
  assert.equal(kpiOfRule("HIRE_UNINVOICED"), "F6");
  assert.equal(kpiOfRule("START_NOT_READY"), "O3");
  assert.equal(kpiOfRule("DATE_START_MISMATCH"), "DQ");
});
