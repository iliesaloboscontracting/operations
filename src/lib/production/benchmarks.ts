// Production benchmarks (LCI phase 5b, design docs/lci/PHASE4-5-DESIGN.md §3.1-3.5) - the plain maths.
// Sites don't measure quantities, so production is worked out from what IS recorded, and every figure
// says how:
//  - hours codes: labour hours logged on the code ÷ (the approved budget's quantity × the latest % complete);
//  - docket codes (DEM-10 / CIV-02): the docket quantity (t, m³ or bins) ÷ the hours logged on the code.
// Delay hours on the same logs are shown alongside, never subtracted. Below the evidence bar a figure is
// "early" and can't be offered. Hours only - never dollars; Estimating's rates aren't involved.
import { createHash } from "crypto";
import { assertNoMoney } from "../moneyGuard";
import { BY_CODE } from "../activityCodes";

export const EVIDENCE_BAR = { minPct: 50, minLogs: 5, maxHandShare: 0.2 }; // draft, design decision 8

export type EvidenceLog = {
  id: string; jobId: string; date: string; crewOk: boolean; delayHours: number; // jobId = the board job (that day)
  labour: { code: string; hours: number }[];
  dockets: { code: string; quantity: number; unit: string; docketNo: string | null }[];
};
export type EvidencePackage = { packageId: string; code: string | null; qty: number; unit: string; labourHrs: number };
export type JobEvidence = {
  projectId: string; projectName: string; jobRef: string; // the job number (what Estimating knows), else the name
  finished: boolean;
  logs: EvidenceLog[]; // the latest version of each day's log
  packages: EvidencePackage[] | null; // null = no approved budget
  pct: Map<string, number>; // latest weekly % by "pkg:<id>" / "code:<code>"
  // Read tip dockets (Receipts): jobId = the board job / day it was sent for; day = its Sydney date (docket's, else when sent).
  receiptDockets: { code: string; quantity: number; unit: string; docketNo: string | null; jobId: string | null; day: string }[];
};

export type Figure = {
  code: string; name: string; unit: string; method: "HOURS_PER_UNIT" | "DOCKETS";
  hours: number; quantity: number | null; // quantity done (hours codes) or tipped (docket codes)
  hrsPerUnit: number | null; perHour: number | null; budgetHrsPerUnit: number | null;
  pctComplete: number | null; logs: string[]; handLogs: number; delayHours: number; from: string | null; to: string | null;
  passes: boolean; missing: string[]; // what keeps it below the bar, in plain words
};
export type JobFigure = Figure & { projectId: string; projectName: string; jobRef: string };

const r = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");

// The figures for one job: one per code it logged hours on (docket codes: one per docket unit).
export function jobFigures(j: JobEvidence): JobFigure[] {
  const codes = [...new Set(j.logs.flatMap((l) => l.labour.filter((h) => h.hours > 0).map((h) => h.code)))].filter((c) => BY_CODE[c]);
  const out: JobFigure[] = [];
  for (const code of codes) {
    const def = BY_CODE[code];
    const logs = j.logs.filter((l) => l.labour.some((h) => h.code === code && h.hours > 0));
    const hours = r(logs.reduce((n, l) => n + l.labour.filter((h) => h.code === code).reduce((m, h) => m + h.hours, 0), 0));
    const handLogs = logs.filter((l) => !l.crewOk).length;
    const delayHours = r(logs.reduce((n, l) => n + l.delayHours, 0), 1);
    const dates = logs.map((l) => l.date).sort();
    const pk = (j.packages ?? []).filter((p) => p.code === code && p.qty > 0);
    const units = [...new Set(pk.map((p) => p.unit))];
    const pctOf = (p: EvidencePackage) => j.pct.get(`pkg:${p.packageId}`) ?? j.pct.get(`code:${code}`);
    const allPct = pk.length > 0 && pk.every((p) => pctOf(p) != null);
    const qtyAll = pk.reduce((n, p) => n + p.qty, 0);
    const done = allPct ? pk.reduce((n, p) => n + p.qty * (pctOf(p)! / 100), 0) : null;
    const pctComplete = allPct && qtyAll > 0 ? Math.round(((done as number) / qtyAll) * 100) : null;
    const budgetHrsPerUnit = pk.length && units.length === 1 && qtyAll > 0 ? r(pk.reduce((n, p) => n + p.labourHrs, 0) / qtyAll, 4) : null;
    const base = { code, name: def.name, hours, pctComplete, logs: logs.map((l) => l.id), handLogs, delayHours, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, projectId: j.projectId, projectName: j.projectName, jobRef: j.jobRef };
    const commonMissing = (unitOk: boolean, unitWhy: string) => [
      ...(!j.finished && (pctComplete == null || pctComplete < EVIDENCE_BAR.minPct) ? [pctComplete == null ? "no % complete yet" : `only ${pctComplete}% complete (needs ${EVIDENCE_BAR.minPct}%)`] : []),
      ...(logs.length < EVIDENCE_BAR.minLogs ? [`${logs.length} log${logs.length === 1 ? "" : "s"} (needs ${EVIDENCE_BAR.minLogs})`] : []),
      ...(!unitOk ? [unitWhy] : []),
      ...(logs.length && handLogs / logs.length > EVIDENCE_BAR.maxHandShare ? [`${handLogs} of ${logs.length} logs had the crew entered by hand`] : []),
    ];

    if (def.siteReport === "dockets") {
      // Docket quantities by unit, only from days that logged hours on this code - tonnes from a day with
      // no hours logged would be divided by other days' hours and make the rate look faster than it is.
      // From those logs' own dockets, and read tip dockets sent for one of those board jobs (else dated
      // one of those days). The same docket number counted once.
      const loggedJobs = new Set(logs.map((l) => l.jobId)), loggedDays = new Set(logs.map((l) => l.date));
      const onLoggedDay = (d: { jobId: string | null; day: string }) => (d.jobId ? loggedJobs.has(d.jobId) || loggedDays.has(d.day) : loggedDays.has(d.day));
      const seen = new Set<string>();
      const lines = [...logs.flatMap((l) => l.dockets.filter((d) => d.code === code)), ...j.receiptDockets.filter((d) => d.code === code && onLoggedDay(d))]
        .filter((d) => { const k = norm(d.docketNo); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; });
      const byUnit = new Map<string, number>();
      for (const d of lines) byUnit.set(d.unit, (byUnit.get(d.unit) ?? 0) + d.quantity);
      if (!byUnit.size) byUnit.set(units[0] ?? def.units[0], 0);
      for (const [unit, qty] of byUnit) {
        const unitOk = def.units.includes(unit) && (!pk.length || units.length === 1 && units[0] === unit);
        const missing = [...commonMissing(unitOk, `docket unit ${unit} doesn't match the budget's ${units.join("/") || "unit"}`), ...(qty <= 0 ? ["no docket quantities yet"] : [])];
        out.push({
          ...base, unit, method: "DOCKETS", quantity: r(qty), hrsPerUnit: qty > 0 ? r(hours / qty, 4) : null, perHour: hours > 0 && qty > 0 ? r(qty / hours, 2) : null,
          budgetHrsPerUnit: units.length === 1 && units[0] === unit ? budgetHrsPerUnit : null, passes: missing.length === 0, missing,
        });
      }
      continue;
    }
    const unit = units.length === 1 ? units[0] : (units.join("/") || def.units[0]);
    const unitOk = units.length === 1 && def.units.includes(units[0]);
    const missing = [
      ...(!j.packages ? ["no approved budget"] : !pk.length ? ["not in the approved budget"] : []),
      ...commonMissing(unitOk || !pk.length, units.length > 1 ? `packages measured in different units (${units.join(", ")})` : `the budget's unit ${units[0]} isn't one of ${code}'s units`),
    ];
    out.push({
      ...base, unit, method: "HOURS_PER_UNIT", quantity: done != null ? r(done) : null,
      hrsPerUnit: done && done > 0 ? r(hours / done, 4) : null, perHour: done && hours > 0 ? r(done / hours, 2) : null,
      budgetHrsPerUnit, passes: missing.length === 0 && !!done, missing: !done && missing.length === 0 ? ["nothing done yet"] : missing,
    });
  }
  return out;
}

// ---------- across jobs ----------

export type CodeBenchmark = {
  code: string; name: string; unit: string; method: Figure["method"];
  // Combined over the jobs that clear the bar only.
  hrsPerUnit: number | null; perHour: number | null; budgetHrsPerUnit: number | null;
  jobs: string[]; logs: number; delayHours: number; from: string | null; to: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null; // null = not enough evidence yet
  evidenceHash: string | null;
  jobFigures: JobFigure[]; // every job's figure, passing or "early"
};

export function confidenceOf(jobs: number, logs: number): CodeBenchmark["confidence"] {
  if (jobs === 0) return null;
  if (jobs >= 3 && logs >= 15) return "HIGH";
  if (jobs >= 2 || logs >= 10) return "MEDIUM";
  return "LOW";
}

// The fingerprint of the evidence: the same data can't be offered twice (design §3.4).
export function evidenceHash(code: string, unit: string, figs: JobFigure[]): string {
  const sample = figs.map((f) => ({ p: f.projectId, logs: [...f.logs].sort(), h: f.hours, q: f.quantity })).sort((a, b) => a.p.localeCompare(b.p));
  return createHash("sha256").update(JSON.stringify({ code, unit, sample })).digest("hex");
}

export function combine(all: JobFigure[]): CodeBenchmark[] {
  const groups = new Map<string, JobFigure[]>();
  for (const f of all) groups.set(`${f.code}|${f.unit}`, [...(groups.get(`${f.code}|${f.unit}`) ?? []), f]);
  const out: CodeBenchmark[] = [];
  for (const figs of groups.values()) {
    const ok = figs.filter((f) => f.passes);
    const h = ok.reduce((n, f) => n + f.hours, 0), q = ok.reduce((n, f) => n + (f.quantity ?? 0), 0);
    const budgeted = ok.filter((f) => f.budgetHrsPerUnit != null);
    // Budget h/unit weighted by each job's quantity.
    const bq = budgeted.reduce((n, f) => n + (f.quantity ?? 0), 0);
    const budgetHrsPerUnit = budgeted.length === ok.length && bq > 0 ? r(budgeted.reduce((n, f) => n + f.budgetHrsPerUnit! * (f.quantity ?? 0), 0) / bq, 4) : null;
    const logs = ok.reduce((n, f) => n + f.logs.length, 0);
    const dates = ok.flatMap((f) => [f.from, f.to]).filter((d): d is string => !!d).sort();
    out.push({
      code: figs[0].code, name: figs[0].name, unit: figs[0].unit, method: figs[0].method,
      hrsPerUnit: q > 0 ? r(h / q, 4) : null, perHour: q > 0 && h > 0 ? r(q / h, 2) : null, budgetHrsPerUnit,
      // job numbers in order: the same evidence, the same offer
      jobs: ok.map((f) => f.jobRef).sort(), logs, delayHours: r(ok.reduce((n, f) => n + f.delayHours, 0), 1),
      from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
      confidence: confidenceOf(ok.length, logs), evidenceHash: ok.length ? evidenceHash(figs[0].code, figs[0].unit, ok) : null,
      jobFigures: figs.sort((a, b) => Number(b.passes) - Number(a.passes) || a.projectName.localeCompare(b.projectName)),
    });
  }
  return out.sort((a, b) => Number(!!b.confidence) - Number(!!a.confidence) || a.code.localeCompare(b.code) || a.unit.localeCompare(b.unit));
}

// ---------- the offer to Estimating (production-suggestion.v1) ----------

export const SUGGESTION_KEYS = ["schema_version", "suggestion_id", "code", "unit", "labour_hrs_per_unit", "budget_hrs_per_unit", "sample", "delays_hrs", "confidence", "evidence_hash"] as const;
// Estimating refuses these words anywhere in the payload (its lib/production.js): the contract is hours only.
const MONEY_WORDS = /\$|\b(aud|price|cost|rate_?\$|dollars?|amount|value|margin|profit|overhead|invoice)\b/i;

export function buildSuggestion(b: CodeBenchmark, suggestionId: string) {
  if (!b.confidence || !b.evidenceHash || b.hrsPerUnit == null || !b.from || !b.to) return null; // below the bar: never offered
  return {
    schema_version: "production-suggestion.v1", suggestion_id: suggestionId, code: b.code, unit: b.unit,
    labour_hrs_per_unit: b.hrsPerUnit, budget_hrs_per_unit: b.budgetHrsPerUnit,
    sample: { jobs: b.jobs, logs: b.logs, from: b.from, to: b.to }, delays_hrs: b.delayHours,
    confidence: b.confidence, evidence_hash: b.evidenceHash,
  };
}
export type Suggestion = NonNullable<ReturnType<typeof buildSuggestion>>;

// No money, ever: our own money guard, Estimating's money words (keys and values), and exactly the agreed keys.
export function suggestionIsSafe(s: Suggestion): boolean {
  // Checked as it will actually be sent: a field that is undefined drops out of the JSON and fails the key check.
  const text = JSON.stringify(s);
  const sent = JSON.parse(text) as Suggestion;
  const words = (v: unknown): boolean => (typeof v === "string" ? !MONEY_WORDS.test(v) : v && typeof v === "object" ? Object.entries(v).every(([k, x]) => !MONEY_WORDS.test(k) && words(x)) : true);
  return assertNoMoney(text) && words(sent) && Object.keys(sent).join() === SUGGESTION_KEYS.join() && Object.keys(sent.sample ?? {}).join() === "jobs,logs,from,to";
}
