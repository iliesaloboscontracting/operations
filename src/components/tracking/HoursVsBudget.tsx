"use client";

import type { HoursVsBudgetDTO } from "@/lib/dailyLog/types";
import type { BudgetStatus } from "@/lib/dailyLog/checks";

// Labour hours vs the approved budget, per activity code (Task K): hours
// logged by the supervisors' daily logs against the budget's labour hours,
// beside the latest weekly % complete. Watch above 15 points over, Act above
// 30 (draft thresholds). Hours only - never dollars. Used on Day Review's job
// card and the Tracking / Directors job page.

const TONE: Record<BudgetStatus, string> = {
  ACT: "bg-red-500/15 text-red-400", WATCH: "bg-amber-500/15 text-amber-400", ON_TRACK: "bg-emerald-500/15 text-emerald-400",
  AHEAD: "bg-sky-500/15 text-sky-400", NOT_ENOUGH: "bg-gray-500/15 text-gray-400",
};
const LABEL: Record<BudgetStatus, string> = { ACT: "Act", WATCH: "Watch", ON_TRACK: "On track", AHEAD: "Ahead", NOT_ENOUGH: "Not enough yet" };

export const hoursVsBudgetEmpty = (b: HoursVsBudgetDTO) =>
  b.state === "NO_LOGS" ? "No daily logs on this job yet." :
  b.state === "NO_BUDGET" ? "No approved budget in Estimating for this job yet - nothing to compare against." :
  b.state === "ESTIMATING_DOWN" ? "Estimating isn't answering right now - the budget can't be read." : null;

export default function HoursVsBudget({ data, compact }: { data: HoursVsBudgetDTO; compact?: boolean }) {
  if (data.state !== "OK") return <p className="text-[11px] text-gray-500">{hoursVsBudgetEmpty(data)}</p>;
  return (
    <div>
      {!compact && <div className="mb-1 text-[11px] text-gray-500">Approved budget {data.budgetName} ({data.budgetRef}) · {data.logs} daily log{data.logs === 1 ? "" : "s"} · thresholds are drafts</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
            <th className="py-1 pr-2 font-medium">Code</th><th className="py-1 pr-2 text-right font-medium">Hours used</th>
            <th className="py-1 pr-2 text-right font-medium">% of budget hrs</th><th className="py-1 pr-2 text-right font-medium">% complete</th><th className="py-1 font-medium">Status</th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.code} className="border-t border-edge/60">
                <td className="py-1.5 pr-2 text-gray-200"><span className="font-semibold">{r.code}</span> <span className="text-gray-500">{r.name}</span></td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-300">{r.loggedHours} / {r.budgetHours} h</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-300">{r.usedPct}%</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-300">{r.pctComplete != null ? `${r.pctComplete}%` : "-"}</td>
                <td className="py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${TONE[r.status]}`}>{LABEL[r.status]}{r.gapPoints != null && r.status !== "ON_TRACK" ? ` (${r.gapPoints > 0 ? "+" : ""}${r.gapPoints})` : ""}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
