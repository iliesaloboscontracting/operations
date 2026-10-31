// "Claimed" on the Directors screen (30 Oct 2026): F14-F17 and the confidence line. Made-up numbers only - never
// business figures. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { claimedByMonth, claimsByJob, claimsConfidence, claimsJobRows, draftSales, jobClaimPosition, mirrorFrom, type ClaimInvoice } from "./claims";
import { THRESHOLDS, kpi } from "./dictionary";

const inv = (number: string, date: string, lines: [number, string | null, string | null][], type = "SALE", status = "AUTHORISED"): ClaimInvoice => ({
  number, contact: "Test Builder", date, type, status, totalExGst: lines.reduce((n, l) => n + l[0], 0), matchMethod: null,
  lines: lines.map(([amountExGst, projectId, matchMethod]) => ({ amountExGst, projectId, matchMethod })),
});
const TODAY = "2026-10-30";
const INVOICES = [
  inv("INV-1", "2026-09-10", [[1000, "jobA", "TRACKING"], [500, "jobB", "REFERENCE"]]),
  inv("INV-2", "2026-10-02", [[300, null, "NONE"]]), // not tied yet
  inv("INV-3", "2026-10-05", [[200, null, "PERSON"]]), // a person said "not a job"
  inv("CN-1", "2026-10-06", [[100, "jobA", "TRACKING"]], "SALE_CREDIT"), // a credit note comes off
  inv("INV-4", "2026-10-07", [[999, "jobA", "TRACKING"]], "SALE", "DRAFT"), // drafts never count
  inv("INV-5", "2026-10-08", [[888, "jobB", "TRACKING"]], "SALE", "VOIDED"), // voided never counts
  inv("BILL-1", "2026-10-09", [[777, "jobA", "TRACKING"]], "BILL"), // bills aren't sales
  inv("INV-6", "2026-11-02", [[50, "jobA", "TRACKING"]]), // after today - not yet
];

test("F14: per job, sales less credit notes; drafts, voided, bills and future-dated left out", () => {
  const c = claimsByJob(INVOICES, TODAY);
  assert.deepEqual(c.byJob.get("jobA"), { claimed: 900, invoices: 2, lastDate: "2026-10-06" });
  assert.deepEqual(c.byJob.get("jobB"), { claimed: 500, invoices: 1, lastDate: "2026-09-10" });
  assert.deepEqual(c.totals, { total: 1900, tied: 1400, notTied: 300, notAJob: 200 });
  assert.equal(c.notTiedInvoices, 1);
});

test("F14: per job + not tied + not a job always adds up to the company total", () => {
  const c = claimsByJob(INVOICES, TODAY);
  const perJob = [...c.byJob.values()].reduce((n, j) => n + j.claimed, 0);
  assert.equal(Math.round((perJob + c.totals.notTied + c.totals.notAJob) * 100), Math.round(c.totals.total * 100));
});

test("F15: by invoice month, three bands, last 15 months, this month so far; before the Xero start is marked", () => {
  const rows = claimedByMonth(INVOICES, TODAY, "2026-09-10");
  assert.equal(rows.length, THRESHOLDS.claimsMonths);
  assert.equal(rows[rows.length - 1].month, "2026-10");
  assert.equal(rows[0].month, "2025-08");
  assert.deepEqual(rows.find((r) => r.month === "2026-09"), { month: "2026-09", tied: 1500, notTied: 0, notAJob: 0, partial: false, beforeMirror: false });
  assert.deepEqual(rows.find((r) => r.month === "2026-10"), { month: "2026-10", tied: -100, notTied: 300, notAJob: 200, partial: true, beforeMirror: false });
  assert.equal(rows.find((r) => r.month === "2026-08")?.beforeMirror, true);
  assert.equal(claimedByMonth(INVOICES, TODAY, null)[0].beforeMirror, true, "nothing read yet: every month is before the start");
});

test("F16 / F17: claimed less cost, left to claim against the contract value, over it in words - never negative", () => {
  const base = { from: "2026-07-01", companyConfidence: "HIGH" as const, firstCostDate: "2026-08-01" };
  const a = jobClaimPosition({ ...base, claimed: 600, totalCost: 450, contractValue: 1000 });
  assert.equal(a.lessCost, 150);
  assert.equal(a.leftToClaim, 400);
  assert.equal(a.over, false);
  assert.equal(a.overText, null);
  assert.equal(a.confidence, "HIGH");
  const over = jobClaimPosition({ ...base, claimed: 1200, totalCost: 900, contractValue: 1000 });
  assert.equal(over.leftToClaim, null, "no negative 'left to claim'");
  assert.equal(over.overBy, 200);
  assert.equal(over.overText, "Claimed more than the contract value (variations aren't in Operations)");
  const behind = jobClaimPosition({ ...base, claimed: 100, totalCost: 400, contractValue: null });
  assert.equal(behind.lessCost, -300, "claims behind cost is just a timing difference");
  assert.equal(behind.leftToClaim, null);
  assert.equal(behind.noContract, true);
});

test("F16 confidence: low when the job's costs start more than 31 days before the Xero sales; else the company's", () => {
  const j = { claimed: 10, totalCost: 10, contractValue: 100, from: "2026-07-01" };
  assert.equal(THRESHOLDS.claimCostGapDays, 31);
  assert.equal(jobClaimPosition({ ...j, firstCostDate: "2026-05-30", companyConfidence: "HIGH" }).confidence, "LOW", "32 days before");
  assert.equal(jobClaimPosition({ ...j, firstCostDate: "2026-05-31", companyConfidence: "HIGH" }).confidence, "HIGH", "31 days before is fine");
  assert.equal(jobClaimPosition({ ...j, firstCostDate: "2026-08-01", companyConfidence: "MEDIUM" }).confidence, "MEDIUM");
  assert.equal(jobClaimPosition({ ...j, from: null, firstCostDate: null, companyConfidence: "HIGH" }).confidence, "LOW", "no Xero sales read");
});

test("company confidence: live + 90% tied (F9's own threshold) -> HIGH; less tied -> MEDIUM; manual or stale -> LOW", () => {
  assert.equal(THRESHOLDS.revenueTiedHighAt, 0.9);
  assert.equal(claimsConfidence({ live: true, stale: false, tied: 90, notTied: 10 }).level, "HIGH");
  assert.equal(claimsConfidence({ live: true, stale: false, tied: 89, notTied: 11 }).level, "MEDIUM");
  assert.equal(claimsConfidence({ live: false, stale: false, tied: 100, notTied: 0 }).level, "LOW");
  assert.equal(claimsConfidence({ live: true, stale: true, tied: 100, notTied: 0 }).level, "LOW");
  assert.equal(claimsConfidence({ live: true, stale: false, tied: 0, notTied: 0 }).tiedShare, null);
});

test("job table: active jobs plus any with a board day in the last 60 days; never an overhead bucket", () => {
  const p = (id: string, status: string, lastDate: string | null, health = "ON_TRACK") => ({ id, status, lastDate, health });
  const rows = claimsJobRows([p("a", "ACTIVE", null), p("b", "COMPLETED", "2026-09-15"), p("c", "COMPLETED", "2026-08-01"), p("d", "ACTIVE", "2026-10-29", "OVERHEAD"), p("e", "INACTIVE", "2026-08-31")], TODAY);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "e"]);
});

test("the Xero start and draft count", () => {
  assert.equal(mirrorFrom(INVOICES), "2026-09-10");
  assert.equal(mirrorFrom([]), null);
  assert.equal(draftSales(INVOICES), 1);
});

test("CLM-006: awaiting approval (SUBMITTED) is never claimed - it joins the draft count", () => {
  const submitted = inv("INV-S", "2026-10-09", [[700, "jobA", "TRACKING"]], "SALE", "SUBMITTED");
  const c = claimsByJob([...INVOICES, submitted], TODAY);
  assert.deepEqual(c.byJob.get("jobA"), { claimed: 900, invoices: 2, lastDate: "2026-10-06" }, "jobA unchanged");
  assert.equal(draftSales([...INVOICES, submitted]), 2);
});

test("dictionary: F14-F17 defined, never called margin or profit; F13 still blocked", () => {
  for (const id of ["F14", "F15", "F16", "F17"]) {
    const k = kpi(id);
    assert.ok(k, id);
    assert.ok(!/margin|profit/i.test(`${k!.name} ${k!.meaning} ${k!.formula}`), `${id} wording`);
  }
  assert.equal(kpi("F13")?.status, "BLOCKED");
  assert.match(kpi("F14")!.notes ?? "", /Retention as invoiced/);
  assert.match(kpi("F15")!.formula, /invoice date/);
  assert.match(kpi("F17")!.notes ?? "", /variations aren't in Operations/);
});

test("CLM-004: 'may belong to this job' uses accounts' needsReview rule and today's date", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./claimsView.ts", import.meta.url), "utf8");
  assert.match(src, /const maybe = x\.invoices\.filter\(\(i\) => needsReview\(i\) && i\.date <= today && suggestionOf\(i\.matchNote \?\? null\) === project\.id\)\.length;/);
  const { needsReview } = await import("../xero/summary");
  assert.equal(needsReview({ type: "SALE", status: "DRAFT", matchMethod: "SITE_TEXT" }), false, "a draft never needs a person");
  assert.equal(needsReview({ type: "SALE", status: "AUTHORISED", matchMethod: "SITE_TEXT" }), true);
});

test("JobView: claims only in director mode (the director route only); 'headroom' only on the Directors' copy", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../components/tracking/JobView.tsx", import.meta.url), "utf8");
  assert.match(src, /\{director && claims && <JobClaimsCard c=\{claims\} \/>\}/, "the card renders only in director mode");
  assert.equal((src.match(/setClaims\(d\.claims/g) ?? []).length, 1, "claims are only read from the director route's reply");
  const opsLoad = src.slice(src.indexOf(': apiFetch("/api/tracking")'), src.indexOf("useEffect(() => { load(); }"));
  assert.doesNotMatch(opsLoad, /claims/, "the Operations load never touches claims");
  assert.match(src, /label=\{director \? "Forecast · headroom" : "Forecast · margin"\}/, "Operations' label unchanged (Ilies's call)");
  const card = src.slice(src.indexOf("function JobClaimsCard"));
  assert.doesNotMatch(card, /margin|profit/i);
  const route = readFileSync(new URL("../../app/api/directors/jobs/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /guardDirector\(\)/);
  const tracking = readFileSync(new URL("../../app/api/tracking/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(tracking, /claims|loadXeroClaims/, "Tracking's route never loads claims");
});

test("CLM-001 guard: a sales document whose lines don't add up (over 5 cents) is counted, and its jobs are flagged", async () => {
  const { linesOff } = await import("./claims");
  const docs = [
    inv("OK-1", "2026-10-01", [[600, "jobA", "TRACKING"], [400, "jobB", "TRACKING"]]), // adds up
    { ...inv("BAD-1", "2026-10-02", [[1000, "jobC", "TRACKING"]]), totalExGst: 950 }, // lines 1000, total 950
    { ...inv("NEAR-1", "2026-10-03", [[100.03, "jobD", "TRACKING"]]), totalExGst: 100 }, // within 5 cents
    { ...inv("BAD-D", "2026-10-04", [[10, "jobE", "TRACKING"]], "SALE", "DRAFT"), totalExGst: 99 }, // drafts aren't counted
  ];
  const off = linesOff(docs, TODAY);
  assert.equal(off.count, 1);
  assert.deepEqual([...off.jobs], ["jobC"]);
});

test("CLM-007: the FY cross-check allows LINES_OFF_TOLERANCE per counted document; one document 10 cents out is flagged", async () => {
  const { readFileSync } = await import("node:fs");
  const { claimsOverview } = await import("./claimsView");
  const { LINES_OFF_TOLERANCE } = await import("./claims");
  const check = readFileSync(new URL("../../../scripts/release-check/checks/22-directors-claimed.mjs", import.meta.url), "utf8");
  // the release check's rule, word for word, and its copy of the tolerance
  assert.match(check, /const LINES_OFF_TOLERANCE = 0\.05;/);
  assert.equal(LINES_OFF_TOLERANCE, 0.05);
  assert.match(check, /Math\.round\(Math\.abs\(fy\.lines - fy\.offGap - fy\.invoiced\) \* 100\) <= Math\.round\(Math\.max\(0\.05, LINES_OFF_TOLERANCE \* fy\.docs\) \* 100\)/);
  const fyWithin = (fy: { lines: number; offGap: number; invoiced: number; docs: number }) =>
    Math.round(Math.abs(fy.lines - fy.offGap - fy.invoiced) * 100) <= Math.round(Math.max(0.05, LINES_OFF_TOLERANCE * fy.docs) * 100);
  const x = (invoices: ClaimInvoice[]) => ({ info: { source: "UPLOAD", asAt: null, uploadedBy: "test", createdAt: "2026-10-30T00:00:00Z" }, invoices });
  const now = new Date("2026-10-30T01:00:00Z");
  // ten documents, each a cent out: none is "off", and the check passes (the old flat 5 cents would not)
  const ten = Array.from({ length: 10 }, (_, k) => ({ ...inv(`C-${k}`, "2026-10-01", [[100.01, "jobA", "TRACKING"]]), totalExGst: 100 }));
  const a = claimsOverview(x(ten), [], TODAY, now)!;
  assert.equal(a.fyCheck.docs, 10);
  assert.equal(a.linesOff, 0);
  assert.equal(a.fyCheck.offGap, 0);
  assert.ok(fyWithin(a.fyCheck), "ten cents across ten documents passes");
  assert.ok(Math.abs(a.fyCheck.lines - a.fyCheck.offGap - a.fyCheck.invoiced) >= 0.05, "...where a flat 5 cents would have failed");
  // one document ten cents out: flagged, and taken out of the check as offGap
  const one = [{ ...inv("D-1", "2026-10-01", [[100.1, "jobB", "TRACKING"]]), totalExGst: 100 }];
  const b = claimsOverview(x(one), [], TODAY, now)!;
  assert.equal(b.linesOff, 1);
  assert.equal(b.fyCheck.offGap, 0.1);
  assert.equal(b.fyCheck.docs, 1);
  assert.ok(fyWithin(b.fyCheck));
});
