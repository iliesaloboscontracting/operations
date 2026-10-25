// Budget approvals on the Directors screen (Task H, 25 Oct 2026). Estimating
// submits a frozen budget.v1 revision; the directors approve or reject it
// here. These are the plain rules - who may decide, what a decision needs,
// and how Estimating's answers are turned into messages - kept free of
// fetch / Prisma so `npm test` can check them. The network side is
// estimating.ts.
//
// Ilies: "nick and yoel" approve budgets. So anyone with director access
// decides (the DIRECTOR role, the director tick, and the owner), except the
// person who submitted that revision - Estimating refuses that too.

export const DECISIONS = ["APPROVED", "REJECTED"] as const;
export type Decision = (typeof DECISIONS)[number];

// The 19 cost categories, as Estimating names them (public/app.js CATS).
export const BUDGET_CATEGORIES: Record<string, string> = {
  "01": "Labour", "02": "Plant & attachments", "03": "Trucks / haulage", "04": "Demolition waste & disposal",
  "05": "Civil materials", "06": "Imported fill / quarry products", "07": "Pipes / pits / drainage",
  "08": "Pavements / asphalt / concrete", "09": "Subcontractors", "10": "Temporary works / shoring",
  "11": "Dewatering", "12": "Survey / testing / QA", "13": "Traffic / environmental controls",
  "14": "Engineering", "15": "Project preliminaries", "16": "Risk / contingency", "17": "Overheads",
  "18": "Profit", "19": "Tender total",
};

// How the site reports progress for a package's activity code (activity codes v0.2).
export const SITE_REPORT: Record<string, string> = {
  hours: "Hours", dockets: "Dockets", visits: "Visits", count: "Count",
};

// ---------- budget.v1 / budget-list.v1, the parts this app reads ----------

export interface BudgetListItem {
  estimate_id: string;
  revision: number;
  status: string; // SUBMITTED | APPROVED | REJECTED | SUPERSEDED
  status_version: number;
  quoteNo: string;
  jobNo: string;
  estimate_name: string;
  client: string;
  submitted_by: string;
  submitted_at: { date: string; instant: string };
  decided: { status: string; at: string; date: string; by: string; reason?: string } | null;
  calculated_total: number;
  submitted_price: number;
}

export interface BudgetPackage {
  package_id: string;
  code: string | null;
  code_name: string | null;
  local_code: string;
  name: string;
  cls: string;
  priced: boolean;
  qty: number;
  unit: string;
  qty_source: string;
  site_report: string | null;
  production_per_day: number;
  production_basis: string;
  duration_days: number;
  start_day: number;
  hours_per_day: number;
  hours: { labour_hrs: number; plant_hrs: number; truck_hrs: number; by_category: Record<string, number> } | null;
  waste_t: Record<string, number>;
  cost_by_category: Record<string, number>;
  direct_cost: number;
}

export interface BudgetV1 {
  schema_version: string;
  activity_codes_version: string;
  estimate_id: string;
  estimate_name: string;
  client: string;
  location: string;
  quoteNo: string;
  quote_source: string;
  jobNo: string;
  revision: number;
  supersedes_revision: number | null;
  maturity: string;
  estimator: string;
  submitted_by: string;
  submitted_at: { date: string; instant: string };
  assumptions: { hours_per_day: number; days_per_week: number; prelim_weeks: number; gst_pct: number; currency: string; prices_ex_gst: boolean };
  programme: { duration_days: number; weeks: number };
  packages: BudgetPackage[];
  prelims: { desc: string; category: string; type: string; qty: number; unit: string; weeks: number | null; cost: number }[];
  risk: { contingency: number; provisional_sums: number; items: { risk: string; treatment: string; cost_impact: number; probability_pct: number; allowance: number }[] };
  overheads: { pct: number; amount: number };
  profit: { pct: number; amount: number };
  totals: { direct_cost: number; by_category: Record<string, number>; calculated_total: number; gst: number; total_inc_gst: number };
  price_adjustment: { build_up_total: number; submitted_price: number; adjustment: number; reason: string; set_by: string };
  content_hash: string;
}

export interface BudgetStatus {
  status: string;
  version: number;
  history: { status: string; at: string; date: string; by: string; reason?: string }[];
}

// ---------- who decides ----------

export interface Decider { name: string; directorAccess: boolean }

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

// Why this person can't decide this revision, or null when they can.
export function cannotDecide(u: Decider, b: { status: string; submitted_by: string }): string | null {
  if (!u.directorAccess) return "Only directors approve budgets.";
  if (b.status !== "SUBMITTED") return `This revision is ${b.status.toLowerCase()} - only a submitted budget can be decided.`;
  if (same(u.name, b.submitted_by)) return "You submitted this budget, so another director has to approve or reject it.";
  return null;
}

export interface DecisionBody { decision: Decision; reason: string; version?: number }

// Checks the request body before anything is sent to Estimating.
export function parseDecision(body: unknown): DecisionBody | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const decision = String(b.decision ?? "").toUpperCase();
  if (!DECISIONS.includes(decision as Decision)) return { error: "Choose approve or reject." };
  const reason = String(b.reason ?? "").trim().slice(0, 1000);
  if (decision === "REJECTED" && reason.length < 3) return { error: "Say why the budget is rejected." };
  const version = b.version === undefined || b.version === null ? undefined : Number(b.version);
  if (version !== undefined && !Number.isInteger(version)) return { error: "Bad version - reload the budget." };
  return { decision: decision as Decision, reason, version };
}

// The shared secret Estimating checks (BUDGET_APPROVAL_SECRET). Estimating
// refuses anything under 16 characters, so treat that as "not set" here and
// say so plainly instead of sending a call that can only fail.
export function approvalSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.BUDGET_APPROVAL_SECRET ?? "";
  return s.length >= 16 ? s : null;
}

export const SECRET_NOT_SET =
  "Budget approvals aren't switched on yet: the approval key hasn't been set on the server. Nothing was recorded.";
export const ESTIMATING_DOWN = "Estimating isn't running on the server right now. Nothing was recorded.";

// Estimating's answer to a decision -> what the director sees, and the log outcome.
export function decisionOutcome(status: number, body: { error?: string; code?: string } | null): {
  outcome: "RECORDED" | "REFUSED" | "FAILED";
  httpStatus: number;
  message: string | null;
} {
  if (status === 200) return { outcome: "RECORDED", httpStatus: 200, message: null };
  // 403 from Estimating means the key didn't match - a server set-up problem, not the director's.
  if (status === 403) return { outcome: "FAILED", httpStatus: 502, message: "Estimating didn't accept the approval key - the two servers' keys don't match. Nothing was recorded." };
  if (status === 400 || status === 404 || status === 409 || status === 422)
    return { outcome: "REFUSED", httpStatus: status, message: body?.error || "Estimating refused the decision." };
  return { outcome: "FAILED", httpStatus: 502, message: "Estimating couldn't record the decision. Nothing was recorded." };
}

// Path pieces as Estimating accepts them.
export const validEstimateId = (id: string) => /^[A-Za-z0-9_-]{1,40}$/.test(id);
export function parseRevision(rev: string): number | null {
  const m = /^r?(\d{1,4})$/.exec(rev);
  return m ? Number(m[1]) : null;
}

// Hours per cost category across the priced packages (labour 01, plant 02, trucks 03...).
export function hoursByCategory(packages: BudgetPackage[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of packages) {
    if (!p.priced || !p.hours) continue;
    for (const [c, h] of Object.entries(p.hours.by_category)) out[c] = Math.round(((out[c] ?? 0) + h) * 100) / 100;
  }
  return out;
}

// Pending first (oldest waiting first), then the rest newest first.
export function sortForDirectors(rows: BudgetListItem[]): BudgetListItem[] {
  const waiting = rows.filter((r) => r.status === "SUBMITTED").sort((a, b) => a.submitted_at.instant.localeCompare(b.submitted_at.instant));
  const rest = rows.filter((r) => r.status !== "SUBMITTED").sort((a, b) => b.submitted_at.instant.localeCompare(a.submitted_at.instant));
  return [...waiting, ...rest];
}
