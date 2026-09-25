"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import Link from "next/link";
import { StartAlertDTO } from "@/lib/types";
import { fmtDay, } from "@/lib/dates";
import { localISODate } from "@/lib/resource";
import { apiFetch } from "@/lib/apiFetch";

const LEVEL: Record<StartAlertDTO["level"], { box: string; dot: string; label: string }> = {
  critical: { box: "border-red-500/60 bg-red-950/40", dot: "bg-red-500", label: "text-red-300" },
  warn: { box: "border-amber-500/50 bg-amber-950/30", dot: "bg-amber-400", label: "text-amber-300" },
  ok: { box: "border-emerald-600/40 bg-emerald-950/20", dot: "bg-emerald-500", label: "text-emerald-300" },
};

function when(a: StartAlertDTO) {
  if (a.daysAway === 0) return "starts today";
  if (a.daysAway === 1) return "starts tomorrow";
  return `starts ${fmtDay(a.startDate, { weekday: "short", day: "numeric", month: "short" })} (in ${a.daysAway} days)`;
}

// Projects starting within the next 7 days, with a readiness check on the start day.
// compact = one-line summary strip that expands on click (used on the Command Centre).
// onSelect, when given, is called instead of navigating to the Command Centre - so a
// page that can show the flagged job in place (the Calendar's details panel, or the
// Command Centre itself) can take the click straight to the problem.
export default function UpcomingAlerts({
  compact = false,
  onSelect,
}: {
  compact?: boolean;
  onSelect?: (alert: StartAlertDTO) => void;
}) {
  const [alerts, setAlerts] = useState<StartAlertDTO[]>([]);
  const [open, setOpen] = useState(!compact);

  const refresh = useCallback(() => {
    apiFetch(`/api/alerts?date=${localISODate()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setAlerts)
      .catch(() => setAlerts([]));
  }, []);

  useEffect(refresh, [refresh]);
  useAutoRefresh(refresh);

  if (alerts.length === 0) return null;

  const needAttention = alerts.filter((a) => a.level !== "ok").length;

  return (
    <div className="mb-3 rounded-lg border border-edge bg-panel">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
      >
        <span className="font-semibold text-gray-100">
          {alerts.length} project{alerts.length > 1 ? "s" : ""} starting within a week
          {needAttention > 0 && (
            <span className="ml-2 rounded bg-amber-600/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
              {needAttention} need{needAttention > 1 ? "" : "s"} attention
            </span>
          )}
        </span>
        <span className="text-gray-500">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="grid gap-2 border-t border-edge p-2 md:grid-cols-2 xl:grid-cols-3">
          {alerts.map((a) => {
            const l = LEVEL[a.level];
            const body = (
              <>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${l.dot}`} />
                  <span className="truncate text-sm font-semibold text-gray-100">{a.name}</span>
                  {a.jobNo && <span className="text-[11px] text-gray-500">{a.jobNo}</span>}
                </div>
                <div className={`mt-0.5 text-xs ${l.label}`}>{when(a)}</div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {a.crew} crew · {a.plant} plant/vehicles
                  {a.shifts.length > 0 && ` · ${a.shifts.map((s) => (s === "NIGHT" ? "night" : "day")).join(" + ")}`}
                </div>
                {a.issues.length > 0 ? (
                  <ul className="mt-1 text-[11px] text-red-300">
                    {a.issues.map((i) => (
                      <li key={i}>⚠ {i}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1 text-[11px] text-emerald-400">✓ Staffed and ready</div>
                )}
              </>
            );
            const className = `block w-full rounded-md border p-2 text-left hover:brightness-125 ${l.box}`;
            return onSelect ? (
              <button key={a.projectId} onClick={() => onSelect(a)} className={className}>
                {body}
              </button>
            ) : (
              <Link key={a.projectId} href={`/command?date=${a.startDate}`} className={className}>
                {body}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
