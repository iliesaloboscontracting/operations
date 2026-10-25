"use client";

// Directors -> Budgets to approve (Task H, 25 Oct 2026). Estimating submits
// a frozen budget for a tender it is pricing (budget.v1); a director other
// than the submitter approves or rejects it here. Waiting ones first. Money
// is shown - this is commercial and directors only.
import { useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import type { BudgetListItem } from "@/lib/budgets/rules";
import { BudgetStatusPill, adjustmentText, aud } from "@/components/directors/BudgetParts";

type Row = BudgetListItem & { cannotDecide: string | null };

export default function BudgetsPage() {
  const { isDirector, loading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOld, setShowOld] = useState(false);

  useEffect(() => {
    if (loading || !isDirector) return;
    apiFetch("/api/directors/budgets")
      .then(async (r) => (r.ok ? setRows(((await r.json()) as { budgets: Row[] }).budgets) : setError(await serverErrorMessage(r, "Couldn't load the budgets."))))
      .catch(() => setError("Couldn't load the budgets."));
  }, [loading, isDirector]);

  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="Budgets to approve">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }

  const waiting = rows?.filter((r) => r.status === "SUBMITTED") ?? [];
  const decided = rows?.filter((r) => r.status === "APPROVED" || r.status === "REJECTED") ?? [];
  const old = rows?.filter((r) => r.status === "SUPERSEDED") ?? [];

  return (
    <PageShell
      title="Budgets to approve"
      subtitle={rows ? (waiting.length ? `${waiting.length} waiting for a director · from Estimating · ex GST` : "Nothing waiting · from Estimating · ex GST") : undefined}
    >
      {error ? (
        <p className="py-10 text-center text-sm text-red-400">{error}</p>
      ) : !rows ? (
        <p className="py-10 text-center text-sm text-gray-500">Loading...</p>
      ) : !rows.length ? (
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">
          No budgets have been submitted from Estimating yet. When an estimator submits one for approval it shows here.
        </div>
      ) : (
        <div className="max-w-4xl space-y-6">
          <Group title="Waiting for approval" rows={waiting} empty="Nothing waiting." />
          <Group title="Decided" rows={decided} empty="None decided yet." />
          {old.length > 0 && (
            <div>
              <button onClick={() => setShowOld((v) => !v)} className="text-sm text-gray-400 hover:text-gray-200">
                {showOld ? "Hide" : "Show"} {old.length} replaced revision{old.length === 1 ? "" : "s"}
              </button>
              {showOld && <div className="mt-2"><Group rows={old} /></div>}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Group({ title, rows, empty }: { title?: string; rows: Row[]; empty?: string }) {
  return (
    <section>
      {title && <h2 className="mb-2 text-sm font-semibold text-gray-300">{title}</h2>}
      {!rows.length ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-panel">
          {rows.map((r) => (
            <Link key={`${r.estimate_id}-${r.revision}`} href={`/directors/budgets/${r.estimate_id}/${r.revision}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-panel2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gray-100">
                  {r.quoteNo} · {r.estimate_name || "Untitled estimate"} <span className="text-gray-500">rev {r.revision}</span>
                </div>
                <div className="truncate text-[12px] text-gray-500">
                  {r.client || "No client"} · submitted by {r.submitted_by} on {fmtDay(r.submitted_at.date, { day: "numeric", month: "short" })}
                  {r.decided && ` · ${r.decided.status.toLowerCase()} by ${r.decided.by} on ${fmtDay(r.decided.date, { day: "numeric", month: "short" })}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-gray-100">{aud(r.submitted_price)}</div>
                <div className="text-[11px] text-gray-500">{adjustmentText(r.calculated_total, r.submitted_price)}</div>
              </div>
              <div className="flex w-full justify-end gap-2 sm:w-auto">
                <BudgetStatusPill status={r.status} />
                {r.status === "SUBMITTED" && r.cannotDecide && <span className="text-[11px] text-gray-500" title={r.cannotDecide}>Another director decides</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
