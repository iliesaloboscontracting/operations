// Talks to Lobos Estimating for budget approvals (Task H, 25 Oct 2026).
// Estimating runs on the same server, bound to 127.0.0.1 only
// (ESTIMATING_URL, as for the /estimating proxy). Reads are plain GETs; a
// decision is a PUT carrying the shared approval key from
// BUDGET_APPROVAL_SECRET - read here, on the server, and never sent to a
// browser or put in a response. Every decision attempt that gets as far as
// Estimating (or is stopped for the key or the submitter) is logged in
// BudgetDecision, append-only.
import { prisma } from "@/lib/prisma";
import type { AuthUser } from "@/lib/auth";
import { estimatingCall as call, type Answer } from "@/lib/estimatingClient";
import {
  ESTIMATING_DOWN, SECRET_NOT_SET, approvalSecret, cannotDecide, decisionOutcome,
  type BudgetListItem, type BudgetStatus, type BudgetV1, type DecisionBody,
} from "./rules";

export async function listBudgets(): Promise<Answer<BudgetListItem[]>> {
  const r = await call<{ schema_version: string; budgets: BudgetListItem[] }>("/api/budgets");
  if (r.status === 0) return { ok: false, status: 502, error: "Estimating isn't running on the server right now." };
  if (r.status !== 200 || !r.body || r.body.schema_version !== "budget-list.v1") return { ok: false, status: 502, error: "Estimating sent something this screen doesn't understand." };
  return { ok: true, data: r.body.budgets };
}

export interface BudgetDetail { budget: BudgetV1; status: BudgetStatus; integrity: "ok" | "MISMATCH" }

export async function getBudget(id: string, rev: number): Promise<Answer<BudgetDetail>> {
  const r = await call<BudgetDetail>(`/api/budgets/${encodeURIComponent(id)}/r${rev}`);
  if (r.status === 0) return { ok: false, status: 502, error: "Estimating isn't running on the server right now." };
  if (r.status === 404) return { ok: false, status: 404, error: "That budget revision isn't in Estimating." };
  if (r.status !== 200 || !r.body || r.body.budget?.schema_version !== "budget.v1") return { ok: false, status: 502, error: "Estimating sent something this screen doesn't understand." };
  return { ok: true, data: { budget: r.body.budget, status: r.body.status, integrity: r.body.integrity } };
}

// Record a director's decision in Estimating. Returns the new status, or an
// error with the status code to pass back to the browser.
export async function decideBudget(user: AuthUser, id: string, rev: number, d: DecisionBody): Promise<Answer<BudgetStatus>> {
  const current = await getBudget(id, rev);
  if (!current.ok) return current;
  const { budget, status } = current.data;
  const log = (outcome: string, httpStatus: number | null, message: string | null) =>
    prisma.budgetDecision.create({
      data: {
        estimateId: id, revision: rev, quoteNo: budget.quoteNo || null, decision: d.decision, reason: d.reason || null,
        by: user.name, byUserId: user.id, outcome, httpStatus, message, contentHash: budget.content_hash || null,
        secretConfigured: approvalSecret() !== null,
      },
    });

  const why = cannotDecide(user, { status: status.status, submitted_by: budget.submitted_by });
  if (why) {
    // Not a director never gets here (the route guard); the rest are worth keeping.
    await log("REFUSED", 409, why);
    return { ok: false, status: 409, error: why };
  }
  const secret = approvalSecret();
  if (!secret) {
    await log("FAILED", 503, SECRET_NOT_SET);
    return { ok: false, status: 503, error: SECRET_NOT_SET };
  }
  const r = await call<{ status: BudgetStatus }>(
    `/api/budgets/${encodeURIComponent(id)}/r${rev}/decision`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", "x-lobos-approval": secret },
      body: JSON.stringify({ decision: d.decision, by: user.name, reason: d.reason, version: d.version ?? status.version }),
    },
    user.name,
  );
  if (r.status === 0) {
    await log("FAILED", 502, ESTIMATING_DOWN);
    return { ok: false, status: 502, error: ESTIMATING_DOWN };
  }
  const o = decisionOutcome(r.status, r.body);
  await log(o.outcome, r.status, o.message);
  if (o.outcome !== "RECORDED" || !r.body?.status) return { ok: false, status: o.httpStatus, error: o.message ?? "Estimating couldn't record the decision." };
  return { ok: true, data: r.body.status };
}

// The decisions made from Operations for one revision, newest first.
export function decisionLog(id: string, rev: number) {
  return prisma.budgetDecision.findMany({
    where: { estimateId: id, revision: rev },
    orderBy: { at: "desc" },
    select: { decision: true, reason: true, by: true, outcome: true, message: true, at: true },
  });
}
