"use client";

import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { fmtDay } from "@/lib/dates";
import { hireEstimate, offHireAlert, HIRE_STATUS_LABEL } from "@/lib/hireEstimate";
import type { ResourceDTO } from "@/lib/types";

// Hire overview (21 Oct 2026): everything on hire across all sites, laid out
// project by project so each site's hired plant, equipment, tools and trucks
// - and when they're due back - is visible at a glance. Dollar figures only
// for managers (the API strips rates for Viewers anyway).

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const short = (iso: string) => fmtDay(iso, { day: "numeric", month: "short" });
const sydneyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
const CATEGORY_LABEL: Record<string, string> = { PLANT: "Plant", EQUIPMENT: "Equipment", TOOLS: "Tools", VEHICLE: "Vehicle" };

type Row = {
  r: ResourceDTO;
  est: ReturnType<typeof hireEstimate>;
  alert: ReturnType<typeof offHireAlert>;
};

function Tile({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${tone || "text-gray-100"}`}>{value}</div>
    </div>
  );
}

function DueBack({ row }: { row: Row }) {
  const { r, alert } = row;
  if (!r.offHireDate) return <span className="text-gray-500">no finish date</span>;
  if (alert?.level === "OVERDUE")
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-red-400">
        <TriangleAlert size={12} /> {short(r.offHireDate)} · overdue {-alert.daysLeft}d
      </span>
    );
  if (alert) return <span className="font-semibold text-amber-400">{short(r.offHireDate)} · {alert.level === "TODAY" ? "today" : `in ${alert.daysLeft}d`}</span>;
  return <span className="text-gray-300">{short(r.offHireDate)}</span>;
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
      .map(([pid, rs]) => ({
        pid,
        project: projects.find((p) => p.id === pid) ?? null,
        rows: rs.sort((a, b) => (a.r.offHireDate ?? "9999").localeCompare(b.r.offHireDate ?? "9999")),
        soFar: rs.reduce((n, x) => n + (x.est?.costToDate ?? 0), 0),
        toFinish: rs.reduce((n, x) => n + (x.est?.costTotal ?? x.est?.costToDate ?? 0), 0),
        alerts: rs.filter((x) => x.alert).length,
      }))
      // Sites needing attention first, then the biggest hire spend; unlinked last.
      .sort((a, b) => (a.pid === "" ? 1 : 0) - (b.pid === "" ? 1 : 0) || rank(a.rows) - rank(b.rows) || b.soFar - a.soFar);
  }, [items, projects, showReturned, today]);

  if (!items) return <div className="py-10 text-center text-sm text-gray-500">Loading...</div>;

  const out = items.filter((r) => r.hireStatus !== "RETURNED");
  const allRows = groups.flatMap((g) => g.rows).filter((x) => x.r.hireStatus !== "RETURNED");
  const due = allRows.filter((x) => x.alert);
  const soFar = allRows.reduce((n, x) => n + (x.est?.costToDate ?? 0), 0);
  const toFinish = allRows.reduce((n, x) => n + (x.est?.costTotal ?? x.est?.costToDate ?? 0), 0);
  const sites = new Set(out.map((r) => r.hireProjectId).filter(Boolean)).size;

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 gap-3 ${canSeeMoney ? "md:grid-cols-5" : "md:grid-cols-3"}`}>
        <Tile label="Items on hire" value={out.length} />
        <Tile label="Sites" value={sites} />
        <Tile label="Due back ≤3 days / overdue" value={due.length} tone={due.length ? "text-amber-400" : ""} />
        {canSeeMoney && <Tile label="Est. cost so far" value={money(soFar)} />}
        {canSeeMoney && <Tile label="Est. cost to finish" value={money(toFinish)} />}
      </div>

      {groups.length === 0 && (
        <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-gray-500">
          Nothing on hire. Add hired plant, equipment or tools from the tabs above.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((g) => (
          <section key={g.pid || "none"} className={`overflow-hidden rounded-xl border shadow-soft ${g.alerts ? "border-amber-500/50" : "border-edge"}`}>
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge bg-panel px-4 py-2.5">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-100">
                {g.pid ? g.project?.name ?? "Unknown project" : "Not linked to a project"}
                {g.project?.client && <span className="ml-1.5 text-xs font-normal text-gray-500">{g.project.client}</span>}
              </h3>
              <span className="text-xs text-gray-400">
                {g.rows.length} item{g.rows.length === 1 ? "" : "s"}
                {g.alerts > 0 && <span className="ml-1.5 font-semibold text-amber-400">· {g.alerts} due back soon</span>}
              </span>
              {canSeeMoney && (
                <span className="text-xs text-gray-300">
                  {money(g.soFar)} <span className="text-gray-500">so far · ~{money(g.toFinish)} to finish</span>
                </span>
              )}
            </header>
            <div className="divide-y divide-edge/50 bg-panel/60">
              {g.rows.map(({ r, est, alert }) => (
                <div key={r.id} className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-4 py-2 text-xs ${r.hireStatus === "RETURNED" ? "opacity-50" : ""}`}>
                  <div className="min-w-0">
                    <div className="truncate text-sm text-gray-100">
                      {r.name}
                      <span className="ml-1.5 rounded-full bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">{CATEGORY_LABEL[r.category ?? ""] ?? r.category}</span>
                    </div>
                    <div className="truncate text-gray-500">
                      {r.agency ?? "No supplier"}
                      {r.hireRef && ` · ${r.hireRef}`}
                      {r.hireStatus && ` · ${HIRE_STATUS_LABEL[r.hireStatus] ?? r.hireStatus}`}
                      {r.onHireDate && ` · from ${short(r.onHireDate)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <DueBack row={{ r, est, alert }} />
                    {canSeeMoney && (
                      <div className="text-gray-400">
                        {est?.costToDate != null ? (
                          <>
                            {money(est.costToDate)}
                            {est.costTotal != null && <span className="text-gray-500"> / ~{money(est.costTotal)}</span>}
                          </>
                        ) : (
                          <span className="text-gray-500">{est ? "no rate" : "no start date"}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
          To add or change an item, open its tab:{" "}
          {["PLANT", "EQUIPMENT", "TOOLS", "VEHICLE"].map((t, i) => (
            <button key={t} className="text-brand-300 hover:underline" onClick={() => onOpenTab(t)}>
              {i ? ", " : ""}
              {CATEGORY_LABEL[t]}
            </button>
          ))}
        </span>
        {canSeeMoney && <span>· Costs are estimates (rate × working days on hire + delivery / pick-up), not invoices.</span>}
      </div>
    </div>
  );
}
