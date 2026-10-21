"use client";

import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { fmtDay } from "@/lib/dates";
import { hireEstimate, offHireAlert, HIRE_STATUS_LABEL } from "@/lib/hireEstimate";
import type { ResourceDTO } from "@/lib/types";
import { HIRE_KIND_LABEL, SUPPLIER_HIRE_KINDS, SUBCONTRACT_KINDS, isSubcontract } from "@/lib/hireKinds";

// Hire overview (21 Oct 2026): one column per site, like the allocations
// board, with a tile per hired item showing where it is in its hire period,
// when it's due back and - for managers - what it's cost so far and what it
// will cost by the expected finish date (the assumed hire period). Dollar
// figures only for managers (the API strips rates for Viewers anyway).
// Each column keeps supplier hire and subcontractors (plant + operator,
// trucks) under separate headings; labour hire stays on its own tab.

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const short = (iso: string) => fmtDay(iso, { day: "numeric", month: "short" });
const sydneyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
const dayNo = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
const CATEGORY_LABEL = HIRE_KIND_LABEL;
// Left edge colour per category, the same idea as the board's job colour tags;
// subcontractors in rose/pink so they read as a different group at a glance.
const CATEGORY_EDGE: Record<string, string> = {
  PLANT: "border-l-amber-500",
  EQUIPMENT: "border-l-sky-500",
  TOOLS: "border-l-violet-500",
  WET_HIRE: "border-l-rose-500",
  VEHICLE: "border-l-pink-400",
};

type Row = {
  r: ResourceDTO;
  est: ReturnType<typeof hireEstimate>;
  alert: ReturnType<typeof offHireAlert>;
};

// What's missing before an item can be projected properly.
function gaps(r: ResourceDTO, canSeeMoney: boolean): string[] {
  const g: string[] = [];
  if (!r.agency) g.push("supplier");
  if (!r.onHireDate) g.push("start date");
  if (!r.offHireDate) g.push("finish date");
  if (canSeeMoney && (r.hireRate == null || !r.hireRateUnit)) g.push("rate");
  return g;
}

function Tile({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${tone || "text-gray-100"}`}>{value}</div>
    </div>
  );
}

// Hire period as a bar: filled up to today, red past the expected finish.
function PeriodBar({ r, today }: { r: ResourceDTO; today: string }) {
  if (!r.onHireDate || !r.offHireDate) return null;
  const start = dayNo(r.onHireDate);
  const end = dayNo(r.offHireDate);
  const now = dayNo(r.hireStatus === "RETURNED" ? r.offHireDate : today);
  const span = Math.max(end - start, 1);
  const pct = Math.min(Math.max(((now - start) / span) * 100, 0), 100);
  const over = now > end;
  return (
    <div className="mt-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-700/70">
        <div className={`h-full rounded-full ${over ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-brand-500"}`} style={{ width: `${over ? 100 : pct}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-gray-500">
        <span>{short(r.onHireDate)}</span>
        <span>{short(r.offHireDate)}</span>
      </div>
    </div>
  );
}

function DueBack({ row }: { row: Row }) {
  const { r, alert } = row;
  if (r.hireStatus === "RETURNED") return <span className="text-gray-500">returned</span>;
  if (!r.offHireDate) return <span className="text-gray-500">no finish date</span>;
  if (alert?.level === "OVERDUE")
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-red-400">
        <TriangleAlert size={11} /> overdue {-alert.daysLeft}d
      </span>
    );
  if (alert) return <span className="font-semibold text-amber-400">{alert.level === "TODAY" ? "due back today" : `due back in ${alert.daysLeft}d`}</span>;
  return <span className="text-gray-400">due {short(r.offHireDate)}</span>;
}

function ItemTile({ row, today, canSeeMoney }: { row: Row; today: string; canSeeMoney: boolean }) {
  const { r, est, alert } = row;
  const missing = gaps(r, canSeeMoney);
  const ring = alert?.level === "OVERDUE" ? "ring-1 ring-red-500/60" : alert ? "ring-1 ring-amber-500/50" : "";
  return (
    <div className={`rounded-lg border border-edge border-l-4 ${CATEGORY_EDGE[r.category ?? ""] ?? "border-l-gray-500"} bg-panel2 px-3 py-2 text-xs ${ring} ${r.hireStatus === "RETURNED" ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium leading-tight text-gray-100">{r.name}</div>
        <span className="shrink-0 rounded-full bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">{CATEGORY_LABEL[r.category ?? ""] ?? r.category}</span>
      </div>
      <div className="mt-0.5 truncate text-gray-500">
        {r.agency ?? "No supplier"}
        {r.hireRef && ` · ${r.hireRef}`}
        {r.hireStatus && ` · ${HIRE_STATUS_LABEL[r.hireStatus] ?? r.hireStatus}`}
      </div>
      <PeriodBar r={r} today={today} />
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <DueBack row={row} />
        {canSeeMoney && (
          <span className="text-right text-gray-300" title="Estimate: rate × working days on hire + delivery / pick-up">
            {est?.costToDate != null ? (
              <>
                {money(est.costToDate)}
                {est.costTotal != null && <span className="text-gray-500"> → {money(est.costTotal)}</span>}
              </>
            ) : null}
          </span>
        )}
      </div>
      {missing.length > 0 && <div className="mt-1 text-[10px] text-amber-400/90">Missing: {missing.join(", ")}</div>}
    </div>
  );
}

export default function HireOverview({ canSeeMoney, onOpenTab }: { canSeeMoney: boolean; onOpenTab: (tab: string) => void }) {
  const [items, setItems] = useState<ResourceDTO[] | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string; client: string | null; status: string }[]>([]);
  const [showReturned, setShowReturned] = useState(false);
  const today = sydneyToday();

  useEffect(() => {
    fetch("/api/resources?type=HIRE")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ResourceDTO[]) => setItems(list.filter((x) => x.type === "HIRE" && x.category !== "LABOUR" && x.active !== false)))
      .catch(() => setItems([]));
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const groups = useMemo(() => {
    if (!items) return [];
    const rows: Row[] = items
      .filter((r) => showReturned || r.hireStatus !== "RETURNED")
      .map((r) => ({ r, est: hireEstimate(r, today), alert: offHireAlert(r, today) }));
    const byProject = new Map<string, Row[]>();
    for (const row of rows) {
      const k = row.r.hireProjectId ?? "";
      byProject.set(k, [...(byProject.get(k) ?? []), row]);
    }
    const rank = (rs: Row[]) => Math.min(...rs.map((x) => (x.alert?.level === "OVERDUE" ? 0 : x.alert ? 1 : 2)));
    return [...byProject.entries()]
      .map(([pid, rs]) => {
        const live = rs.filter((x) => x.r.hireStatus !== "RETURNED");
        return {
          pid,
          project: projects.find((p) => p.id === pid) ?? null,
          rows: rs.sort((a, b) => (a.r.offHireDate ?? "9999").localeCompare(b.r.offHireDate ?? "9999")),
          out: live.length,
          soFar: rs.reduce((n, x) => n + (x.est?.costToDate ?? 0), 0),
          projected: rs.reduce((n, x) => n + (x.est?.costTotal ?? x.est?.costToDate ?? 0), 0),
          unprojected: live.filter((x) => x.est?.costTotal == null).length,
          alerts: rs.filter((x) => x.alert).length,
        };
      })
      // Sites needing attention first, then the biggest projected spend; unlinked last.
      .sort((a, b) => (a.pid === "" ? 1 : 0) - (b.pid === "" ? 1 : 0) || rank(a.rows) - rank(b.rows) || b.projected - a.projected);
  }, [items, projects, showReturned, today]);

  if (!items) return <div className="py-10 text-center text-sm text-gray-500">Loading...</div>;

  const live = groups.flatMap((g) => g.rows).filter((x) => x.r.hireStatus !== "RETURNED");
  const due = live.filter((x) => x.alert);
  const soFar = live.reduce((n, x) => n + (x.est?.costToDate ?? 0), 0);
  const projected = live.reduce((n, x) => n + (x.est?.costTotal ?? x.est?.costToDate ?? 0), 0);
  const incomplete = live.filter((x) => gaps(x.r, canSeeMoney).length > 0).length;
  const sites = new Set(live.map((x) => x.r.hireProjectId).filter(Boolean)).size;

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 gap-3 ${canSeeMoney ? "md:grid-cols-6" : "md:grid-cols-4"}`}>
        <Tile label="Items on hire" value={live.length} />
        <Tile label="Sites" value={sites} />
        <Tile label="Due back ≤3 days / overdue" value={due.length} tone={due.length ? "text-amber-400" : ""} />
        <Tile label="Missing details" value={incomplete} tone={incomplete ? "text-amber-400" : ""} />
        {canSeeMoney && <Tile label="Est. cost so far" value={money(soFar)} />}
        {canSeeMoney && <Tile label="Projected to finish" value={money(projected)} />}
      </div>

      {groups.length === 0 && (
        <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-gray-500">
          Nothing on hire. Add hired plant, equipment or tools from the tabs above.
        </p>
      )}

      {/* One column per site, scrolling sideways like the allocations board. */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {groups.map((g) => (
          <section
            key={g.pid || "none"}
            className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border shadow-soft ${g.alerts ? "border-amber-500/50" : "border-edge"}`}
          >
            <header className="border-b border-edge bg-panel px-3 py-2.5">
              <h3 className="truncate text-sm font-semibold text-gray-100" title={g.project?.name}>
                {g.pid ? g.project?.name ?? "Unknown project" : "Not linked to a project"}
              </h3>
              <div className="truncate text-[11px] text-gray-500">{g.project?.client ?? (g.pid ? "" : "Set a project on these items")}</div>
              <div className="mt-1.5 flex items-baseline justify-between gap-2 text-xs">
                <span className="text-gray-300">
                  <span className="text-base font-bold text-gray-100">{g.out}</span> on hire
                  {g.alerts > 0 && <span className="ml-1.5 font-semibold text-amber-400">· {g.alerts} due</span>}
                </span>
                {canSeeMoney && (
                  <span className="text-right">
                    <span className="font-semibold text-gray-100">{money(g.projected)}</span>
                    <span className="block text-[10px] text-gray-500">projected · {money(g.soFar)} so far</span>
                  </span>
                )}
              </div>
              {canSeeMoney && g.unprojected > 0 && (
                <div className="mt-1 text-[10px] text-amber-400/90">
                  {g.unprojected} item{g.unprojected === 1 ? "" : "s"} counted to today only - add a rate and finish date to project
                </div>
              )}
            </header>
            <div className="flex-1 space-y-3 bg-panel/60 p-2">
              {(["SUPPLIER", "SUBCONTRACT"] as const).map((kind) => {
                const rs = g.rows.filter((x) => isSubcontract(x.r.category) === (kind === "SUBCONTRACT"));
                if (rs.length === 0) return null;
                const total = rs.reduce((n, x) => n + (x.est?.costTotal ?? x.est?.costToDate ?? 0), 0);
                return (
                  <div key={kind} className="space-y-2">
                    <div className={`flex items-baseline justify-between border-b pb-0.5 text-[10px] font-semibold uppercase tracking-widest ${kind === "SUBCONTRACT" ? "border-rose-500/40 text-rose-300" : "border-edge text-gray-400"}`}>
                      <span>{kind === "SUBCONTRACT" ? "Subcontractors" : "Supplier hire"}</span>
                      {canSeeMoney && <span className="normal-case tracking-normal">{money(total)}</span>}
                    </div>
                    {rs.map((row) => (
                      <ItemTile key={row.r.id} row={row} today={today} canSeeMoney={canSeeMoney} />
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <button className="hover:text-gray-300" onClick={() => setShowReturned((v) => !v)}>
          {showReturned ? "Hide returned items" : "Show returned items"}
        </button>
        <span>·</span>
        <span>
          To add or change an item - supplier hire:{" "}
          {SUPPLIER_HIRE_KINDS.map((t, i) => (
            <button key={t} className="text-brand-300 hover:underline" onClick={() => onOpenTab(t)}>
              {i ? ", " : ""}
              {CATEGORY_LABEL[t]}
            </button>
          ))}
          {" "}· subcontractors:{" "}
          {SUBCONTRACT_KINDS.filter((t) => t !== "LABOUR").map((t, i) => (
            <button key={t} className="text-rose-300 hover:underline" onClick={() => onOpenTab(t)}>
              {i ? ", " : ""}
              {CATEGORY_LABEL[t]}
            </button>
          ))}
        </span>
        {canSeeMoney && (
          <span>· Projected = rate × working days from start to expected finish + delivery / pick-up. Estimates, not invoices.</span>
        )}
      </div>
    </div>
  );
}
