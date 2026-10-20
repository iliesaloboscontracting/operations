"use client";

import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { IdleHireDTO, ProjectCostDTO } from "@/lib/types";
import { money } from "@/lib/resource";
import { fmtDay } from "@/lib/dates";
import { ShiftBadge } from "@/components/ShiftBadge";
import { apiFetch } from "@/lib/apiFetch";
import {
  CostBreakdown,
  CostBreakdownBar,
  CostBreakdownDonut,
  CostCategoryLegend,
  COST_CATEGORIES,
} from "@/components/CostBreakdownChart";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  Lock,
  Receipt,
  TriangleAlert,
  Unlock,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

// Human label for an InvoicedCost's category - covers whatever's actually in
// use plus a sensible fallback, so a new category never just shows as a raw
// enum-ish string.
const INVOICED_CATEGORY_LABEL: Record<string, string> = {
  LABOUR_HIRE: "Labour hire",
  PLANT_HIRE: "Plant hire",
  TIP_FEES: "Tip fees",
  MATERIALS: "Materials",
};
function invoicedCategoryLabel(category: string) {
  return INVOICED_CATEGORY_LABEL[category] ?? category.replace(/_/g, " ").toLowerCase();
}

// Same fixed colors as the chart's categorical palette - an unrecognised
// future category folds into Materials' bucket/color until it earns its own
// slot (see CostBreakdownChart.tsx), so this stays in sync with that fallback.
const CATEGORY_COLOR: Record<string, string> = {
  LABOUR_HIRE: "#ec4899",
  PLANT_HIRE: "#f59e0b",
  TIP_FEES: "#06b6d4",
  MATERIALS: "#8b5cf6",
};
function categoryColor(category: string) {
  return CATEGORY_COLOR[category] ?? "#8b5cf6";
}

// Maps a project's cost into the chart's fixed 8-category breakdown. Must
// always sum to exactly p.totalCost - an unrecognised invoiced category
// folds into "materials" rather than being silently dropped, so the bar
// never shows less money than the real total.
function buildBreakdown(p: ProjectCostDTO): CostBreakdown {
  const invoicedByCat: Record<string, number> = {};
  for (const i of p.invoiced) {
    invoicedByCat[i.category] = (invoicedByCat[i.category] ?? 0) + i.amountExGst;
  }
  const known = new Set(["LABOUR_HIRE", "PLANT_HIRE", "TIP_FEES", "MATERIALS"]);
  let otherInvoiced = 0;
  for (const [cat, amt] of Object.entries(invoicedByCat)) {
    if (!known.has(cat)) otherInvoiced += amt;
  }
  return {
    plant: p.byCode.plant,
    attach: p.byCode.attach,
    trucks: p.byCode.trucks,
    hire: p.byCode.hire + (invoicedByCat["PLANT_HIRE"] ?? 0),
    labourHire: invoicedByCat["LABOUR_HIRE"] ?? 0,
    tipFees: invoicedByCat["TIP_FEES"] ?? 0,
    materials: (invoicedByCat["MATERIALS"] ?? 0) + otherInvoiced,
    ownCrew: p.labourTotal,
  };
}

function sumBreakdowns(breakdowns: CostBreakdown[]): CostBreakdown {
  const total: CostBreakdown = { plant: 0, attach: 0, trucks: 0, hire: 0, labourHire: 0, tipFees: 0, materials: 0, ownCrew: 0 };
  for (const b of breakdowns) {
    for (const c of COST_CATEGORIES) total[c.key] += b[c.key];
  }
  return total;
}

function Amount({ n, muted }: { n: number; muted?: boolean }) {
  if (!n) return <span className="text-gray-400">—</span>;
  return <span className={muted ? "text-gray-500" : "text-gray-100"}>{money(n)}</span>;
}

// One row per person, aggregated across every date - the raw ledger can have
// dozens of daily rows per person on a long-running site, which isn't useful
// to page through one day at a time.
function byPerson(rows: { personName: string; hours: number | null; cost: number | null }[]) {
  const map = new Map<string, { hours: number; cost: number; shifts: number; hasTBC: boolean }>();
  for (const l of rows) {
    const row = map.get(l.personName) ?? { hours: 0, cost: 0, shifts: 0, hasTBC: false };
    row.hours += l.hours ?? 0;
    row.cost += l.cost ?? 0;
    row.shifts += 1;
    if (l.cost == null) row.hasTBC = true;
    map.set(l.personName, row);
  }
  return [...map.entries()].sort((a, b) => b[1].cost - a[1].cost);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "").toUpperCase() + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "").toUpperCase();
}

// ---------- Flat "editorial dashboard" building blocks ----------
// Deliberately flat (no blur/translucency) per Ilies's reference - plain
// white cards, thin border, soft shadow. Scoped to Tracking only.

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[#e5e7eb] bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

function HeroStat({
  icon: Icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: typeof Wallet;
  label: string;
  value: React.ReactNode;
  tone?: "good" | "bad";
  sub?: string;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
        <Icon size={15} className="text-gray-400" />
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tracking-tight ${tone === "bad" ? "text-red-600" : tone === "good" ? "text-emerald-600" : "text-gray-100"}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-gray-500">{sub}</div>}
    </Card>
  );
}

// A single labelled, percentage-ended pill bar - "Cost by category" row.
function PercentBar({ label, pct, amount, color }: { label: string; pct: number; amount: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="font-medium text-gray-100">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#f1f2f4]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1.5)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// "Budget & delivery alerts" style row - a project's budget-used% as a
// coloured bar with a plain-English line, not a pacing forecast (see
// BudgetHealthCard below for why).
function BudgetAlertRow({ p }: { p: ProjectCostDTO }) {
  if (p.contractValue == null) return null;
  const usedPct = (p.totalCost / p.contractValue) * 100;
  const over = usedPct > 100;
  const caution = !over && usedPct >= 85;
  const color = over ? "#dc2626" : caution ? "#d97706" : "#0d9488";
  const note = over
    ? `${money(p.totalCost - p.contractValue)} over the contract value`
    : `${usedPct.toFixed(0)}% of budget used`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="truncate font-medium text-gray-200">{p.name}</span>
        <span className="shrink-0 pl-2 text-xs font-semibold" style={{ color }}>
          {usedPct.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#f1f2f4]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(usedPct, 100)}%`, backgroundColor: color }} />
      </div>
      <div className="mt-1 text-[11px] text-gray-500">{note}</div>
    </div>
  );
}

// Contract value vs cost-to-date, shown inside a project's expanded detail.
// Deliberately does NOT show "percent complete", "should have spent by now"
// or "forecast margin" - those need a priced schedule / work-progress source
// Operations doesn't track yet (flagged separately, not guessed at here).
function BudgetHealthCard({ p }: { p: ProjectCostDTO }) {
  if (p.contractValue == null) {
    return (
      <div className="mb-3 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] px-3.5 py-2.5 text-xs text-gray-500">
        No single contract value - {p.contractValueNotes}
      </div>
    );
  }
  const over = p.totalCost > p.contractValue;
  const usedPct = (p.totalCost / p.contractValue) * 100;
  const scale = Math.max(p.totalCost, p.contractValue) || 1;
  const healthyZonePct = Math.min((p.contractValue * 0.85) / scale, 1) * 100;
  const cautionZonePct = Math.max(Math.min(p.contractValue / scale, 1) * 100 - healthyZonePct, 0);
  const overZonePct = Math.max(100 - healthyZonePct - cautionZonePct, 0);
  const spentOverlayPct = (p.totalCost / scale) * 100;

  return (
    <Card className="mb-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Contract value</div>
          <div className="mt-0.5 text-sm font-semibold text-gray-100">{money(p.contractValue)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Cost to date</div>
          <div className="mt-0.5 text-sm font-semibold text-gray-100">{money(p.totalCost)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{over ? "Over by" : "Remaining"}</div>
          <div className={`mt-0.5 text-sm font-semibold ${over ? "text-red-600" : "text-emerald-600"}`}>
            {over ? money(p.totalCost - p.contractValue) : money(p.contractValue - p.totalCost)}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Budget used</div>
          <div className={`mt-0.5 text-sm font-semibold ${usedPct > 100 ? "text-red-600" : "text-gray-100"}`}>{usedPct.toFixed(1)}%</div>
        </div>
      </div>

      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-[#f1f2f4]">
        <div className="flex h-full">
          <div className="h-full bg-[#a7f3d0]" style={{ width: `${healthyZonePct}%` }} />
          <div className="h-full bg-[#fde68a]" style={{ width: `${cautionZonePct}%` }} />
          <div className="h-full bg-[#fecaca]" style={{ width: `${overZonePct}%` }} />
        </div>
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-red-500/70" : "bg-teal-600/70"}`}
          style={{ width: `${spentOverlayPct}%` }}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Healthy to {money(p.contractValue * 0.85)}</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Caution to {money(p.contractValue)}</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Over budget</span>
      </div>

      <div className={`mt-2 text-xs font-medium ${over ? "text-red-600" : "text-emerald-600"}`}>
        {over
          ? `${money(p.totalCost - p.contractValue)} over the contract value, at ${usedPct.toFixed(1)}% of budget spent`
          : `${money(p.contractValue - p.totalCost)} remaining, ${usedPct.toFixed(1)}% of budget spent so far`}
      </div>

      {p.contractValueNotes && <div className="mt-1 text-[11px] text-gray-500">{p.contractValueNotes}</div>}
    </Card>
  );
}

// A section heading used throughout the expanded detail card.
function SectionHeading({ icon: Icon, children }: { icon: typeof Wrench; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      <Icon size={12} />
      {children}
    </div>
  );
}

const DATE_LABEL = new Date().toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function TrackingPage() {
  const [projects, setProjects] = useState<ProjectCostDTO[]>([]);
  const [idleHire, setIdleHire] = useState<IdleHireDTO | null>(null);
  const [idleHireOpen, setIdleHireOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch("/api/tracking")
      .then((r) => (r.ok ? r.json() : { projects: [], idleHire: null }))
      .then((data) => {
        setProjects(data.projects);
        setIdleHire(data.idleHire);
      })
      .finally(() => setLoading(false));
  }, []);

  const grandTotal = projects.reduce((n, p) => n + p.totalCost, 0);
  const activeCount = projects.filter((p) => p.status === "ACTIVE").length;
  const overBudget = projects.filter((p) => p.contractValue != null && p.totalCost > p.contractValue);
  const costedProjects = [...projects].filter((p) => p.totalCost > 0).sort((a, b) => b.totalCost - a.totalCost);

  const allBreakdowns = costedProjects.map(buildBreakdown);
  const categoryTotal = sumBreakdowns(allBreakdowns);
  const categoryGrand = COST_CATEGORIES.reduce((n, c) => n + categoryTotal[c.key], 0) || 1;
  const topCategories = COST_CATEGORIES.map((c) => ({ ...c, amount: categoryTotal[c.key] }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const budgetWatch = [...projects]
    .filter((p) => p.contractValue != null && p.totalCost > 0)
    .sort((a, b) => b.totalCost / (b.contractValue as number) - a.totalCost / (a.contractValue as number))
    .slice(0, 5);

  const recentInvoiced = projects
    .flatMap((p) => p.invoiced.map((i) => ({ ...i, projectName: p.name })))
    .sort((a, b) => (a.weekEnding < b.weekEnding ? 1 : -1))
    .slice(0, 7);

  function toggle(id: string) {
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <PageShell
      title={<span className="font-headline text-3xl font-semibold tracking-tight text-gray-100">Project Tracking</span>}
      subtitle={DATE_LABEL}
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : (
        <div className="-mx-6 -mt-1 min-h-full bg-[#f7f5f0] px-6 pb-8 pt-5 lg:-mx-8 lg:px-8">
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <HeroStat icon={Wallet} label="Total cost" value={money(grandTotal)} sub="Ex GST, every project" />
            <HeroStat icon={Building2} label="Active projects" value={activeCount} />
            <HeroStat
              icon={AlertTriangle}
              label="Over budget"
              value={overBudget.length}
              tone={overBudget.length > 0 ? "bad" : "good"}
              sub={overBudget.length > 0 ? overBudget.map((p) => p.name).slice(0, 2).join(", ") : "None currently"}
            />
            <HeroStat
              icon={Clock3}
              label="Idle hire"
              value={idleHire && idleHire.totalIdleCost > 0 ? money(idleHire.totalIdleCost) : idleHire?.items.length ?? 0}
              tone={idleHire && idleHire.items.length > 0 ? "bad" : undefined}
              sub={idleHire && idleHire.items.length > 0 ? `${idleHire.items.length} item${idleHire.items.length === 1 ? "" : "s"} sitting idle` : "Nothing idle"}
            />
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <div className="mb-3 text-sm font-semibold text-gray-200">Cost by category</div>
              <div className="space-y-3">
                {topCategories.map((c) => (
                  <PercentBar key={c.key} label={c.label} pct={(c.amount / categoryGrand) * 100} amount={c.amount} color={c.color} />
                ))}
              </div>
            </Card>

            <Card>
              <div className="mb-3 text-sm font-semibold text-gray-200">Budget watch</div>
              {budgetWatch.length === 0 ? (
                <div className="text-xs text-gray-500">No projects with a contract value on file yet.</div>
              ) : (
                <div className="space-y-3">
                  {budgetWatch.map((p) => (
                    <BudgetAlertRow key={p.id} p={p} />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="p-0">
              <div className="border-b border-[#eceef1] p-4 text-sm font-semibold text-gray-200">Top projects by cost</div>
              <div className="divide-y divide-[#eceef1]">
                {costedProjects.slice(0, 7).map((p) => {
                  const used = p.contractValue != null ? (p.totalCost / p.contractValue) * 100 : null;
                  const over = used != null && used > 100;
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-200">{p.name}</div>
                        <div className="truncate text-[11px] text-gray-500">{p.client ?? "No client set"}</div>
                      </div>
                      <div className="shrink-0 text-right font-medium text-gray-100">{money(p.totalCost)}</div>
                      {used != null && (
                        <div className={`shrink-0 text-right text-xs font-medium ${over ? "text-red-600" : "text-emerald-600"}`}>
                          {used.toFixed(0)}%
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-0">
              <div className="border-b border-[#eceef1] p-4 text-sm font-semibold text-gray-200">Recently invoiced</div>
              <div className="divide-y divide-[#eceef1]">
                {recentInvoiced.length === 0 ? (
                  <div className="p-4 text-xs text-gray-500">No invoiced costs entered yet.</div>
                ) : (
                  recentInvoiced.map((i) => (
                    <div key={i.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                        style={{ backgroundColor: categoryColor(i.category) }}
                      >
                        {initials(i.vendor)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-200">{i.vendor}</div>
                        <div className="truncate text-[11px] text-gray-500">
                          {i.projectName} · {invoicedCategoryLabel(i.category)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-medium text-gray-100">{money(i.amountExGst)}</div>
                        <div className="text-[10px] text-gray-500">{fmtDay(i.weekEnding, { day: "numeric", month: "short" })}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>

          {idleHire && idleHire.items.length > 0 && (
            <Card className="mb-5 overflow-hidden p-0">
              <button onClick={() => setIdleHireOpen((v) => !v)} className="flex w-full items-center gap-3 p-4 text-left">
                {idleHireOpen ? <ChevronDown size={14} className="shrink-0 text-amber-600" /> : <ChevronRight size={14} className="shrink-0 text-amber-600" />}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fef3c7] text-amber-600">
                  <TriangleAlert size={18} />
                </div>
                <div>
                  <div className="text-base font-semibold text-gray-100">
                    {idleHire.totalIdleCost > 0 ? money(idleHire.totalIdleCost) : "Idle hire"}
                    {idleHire.totalIdleCost > 0 && <span className="ml-1.5 text-xs font-normal text-gray-500">estimated</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {idleHire.items.length} hired item{idleHire.items.length === 1 ? "" : "s"} sitting idle or overdue for off-hire - not attributed to any project
                  </div>
                </div>
              </button>

              {idleHireOpen && (
                <div className="border-t border-[#eceef1] px-3 py-2">
                  <div className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr_0.6fr_0.8fr] gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    <div>Item</div>
                    <div>On hire since</div>
                    <div>Finish</div>
                    <div>On hire</div>
                    <div>Idle</div>
                    <div className="text-right">Est. cost</div>
                  </div>
                  {idleHire.items.map((i) => (
                    <div key={i.id} className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr_0.6fr_0.8fr] items-center gap-2 border-t border-[#eceef1] py-1.5 text-xs first:border-t-0">
                      <div className="min-w-0">
                        <div className="truncate text-gray-300">{i.name}</div>
                        {i.agency && <div className="truncate text-[10px] text-gray-500">{i.agency}</div>}
                      </div>
                      <div className="text-gray-500">{i.hireStart}</div>
                      <div className={i.overdue ? "font-medium text-red-600" : "text-gray-500"}>
                        {i.hireEnd ?? "—"}
                        {i.overdue && " ⚠"}
                      </div>
                      <div className="text-gray-500">{i.onHireDays}d</div>
                      <div className="text-gray-500">{i.idleDays}d</div>
                      <div className="text-right font-medium text-gray-200">
                        {i.idleCost != null ? money(i.idleCost) : <span className="text-amber-600">TBC</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d9d5cb] bg-white py-10 text-center text-sm text-gray-500">No projects yet.</div>
          ) : (
            <>
              <Card className="mb-3">
                <CostCategoryLegend />
              </Card>
              <Card className="overflow-hidden p-0">
                {projects.map((p) => {
                  const isOpen = open.has(p.id);
                  const hasDetail =
                    p.jobs.length > 0 || p.invoiced.length > 0 || p.labour.length > 0 || p.hireItems.length > 0 ||
                    p.hireLabourEstimate.length > 0 || p.uncostedCount > 0 || p.unconfirmedCount > 0 ||
                    p.contractValue != null || !!p.contractValueNotes;
                  const breakdown = buildBreakdown(p);
                  return (
                    <div key={p.id} className="border-b border-[#eceef1] last:border-b-0">
                      <button
                        onClick={() => toggle(p.id)}
                        disabled={!hasDetail}
                        className="flex w-full items-center gap-4 px-3.5 py-3 text-left transition-colors hover:bg-[#f9fafb] disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <div className="flex w-[220px] shrink-0 min-w-0 items-center gap-1.5">
                          {hasDetail ? (
                            isOpen ? <ChevronDown size={14} className="shrink-0 text-gray-400" /> : <ChevronRight size={14} className="shrink-0 text-gray-400" />
                          ) : (
                            <span className="w-[14px] shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-gray-100">{p.name}</div>
                            <div className="truncate text-[11px] text-gray-500">
                              {p.client ?? "No client set"}
                              {p.jobNo && ` · ${p.jobNo}`}
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1" />
                        <div className="shrink-0">
                          <CostBreakdownDonut breakdown={breakdown} size={32} />
                        </div>
                        <div className="w-[120px] shrink-0 text-right text-sm font-semibold">
                          <Amount n={p.totalCost} />
                          {p.contractValue != null && (
                            <div className={`text-[10px] ${p.totalCost > p.contractValue ? "text-red-600" : "text-emerald-600"}`}>
                              {p.totalCost > p.contractValue
                                ? `${money(p.totalCost - p.contractValue)} over budget`
                                : `${money(p.contractValue - p.totalCost)} under budget`}
                            </div>
                          )}
                        </div>
                      </button>

                      {isOpen && hasDetail && (
                        <div className="border-t border-[#eceef1] bg-[#f6f7f8]/60 px-3.5 py-3.5">
                          {(p.contractValue != null || p.contractValueNotes) && <BudgetHealthCard p={p} />}

                          <Card className="mb-3">
                            <SectionHeading icon={Wrench}>Cost breakdown</SectionHeading>
                            <CostBreakdownBar breakdown={breakdown} height={28} />
                          </Card>

                          {(p.recordedCost > 0 || p.estimatedCost > 0) && (
                            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                              <span>
                                <Lock size={10} className="mr-1 inline" />
                                {money(p.recordedCost)} recorded - locked in from closed days
                              </span>
                              <span>
                                <Unlock size={10} className="mr-1 inline" />
                                {money(p.estimatedCost)} estimated - still live, open days
                              </span>
                            </div>
                          )}

                          {(p.uncostedCount > 0 || p.unconfirmedCount > 0) && (
                            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                              {p.uncostedCount > 0 && (
                                <span className="text-red-600">{p.uncostedCount} allocation{p.uncostedCount === 1 ? "" : "s"} not costed (rate or hours missing)</span>
                              )}
                              {p.unconfirmedCount > 0 && <span className="text-amber-600">{p.unconfirmedCount} on an unconfirmed rate</span>}
                            </div>
                          )}

                          {(p.hireLabourEstimateTotal > 0 || p.labourHireInvoicedTotal > 0) && (
                            <Card className="mb-3 text-xs">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                <span className="text-gray-500">
                                  Labour hire estimated from allocations <span className="font-medium text-gray-200">{money(p.hireLabourEstimateTotal)}</span>
                                </span>
                                <span className="text-gray-500">
                                  Labour hire invoiced <span className="font-medium text-gray-200">{money(p.labourHireInvoicedTotal)}</span>
                                </span>
                                <span className={p.hireLabourEstimateTotal === p.labourHireInvoicedTotal ? "text-gray-500" : "text-amber-600"}>
                                  {money(Math.abs(p.hireLabourEstimateTotal - p.labourHireInvoicedTotal))} difference - for review, not added into the total
                                </span>
                              </div>
                            </Card>
                          )}

                          {p.hireItems.length > 0 && (
                            <Card className="mb-3">
                              <SectionHeading icon={Wrench}>Hire register (estimate)</SectionHeading>
                              <div className="space-y-1">
                                {p.hireItems.map((h) => (
                                  <div key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-[#eceef1] bg-[#f9fafb] px-2.5 py-1.5 text-xs transition-colors hover:bg-[#f1f2f4]">
                                    <span className="min-w-0 flex-1 truncate text-gray-300">
                                      {h.name}
                                      {h.supplier && <span className="text-gray-500"> · {h.supplier}</span>}
                                    </span>
                                    <span className="shrink-0 text-gray-500">
                                      {h.onHireDate ? fmtDay(h.onHireDate, { day: "numeric", month: "short" }) : "?"} – {h.offHireDate ? fmtDay(h.offHireDate, { day: "numeric", month: "short" }) : "no finish date"}
                                      {" · "}{h.daysToDate} day{h.daysToDate === 1 ? "" : "s"} so far
                                    </span>
                                    <span className="shrink-0 font-medium text-gray-200">{h.costToDate != null ? money(h.costToDate) : <span className="text-red-600">no rate</span>}</span>
                                    {h.costTotal != null && <span className="shrink-0 text-gray-500">of ~{money(h.costTotal)}</span>}
                                  </div>
                                ))}
                              </div>
                              <p className="mt-1.5 text-[11px] text-gray-500">Estimates: rate × working days on hire + delivery / pick-up. Not matched to supplier invoices yet.</p>
                            </Card>
                          )}

                          {p.jobs.length > 0 && (
                            <Card className="mb-3">
                              <SectionHeading icon={Wrench}>Jobs</SectionHeading>
                              <div className="space-y-1">
                                {p.jobs.map((j) => (
                                  <div key={j.id} className="flex items-center gap-2 rounded-lg border border-[#eceef1] bg-[#f9fafb] px-2.5 py-1.5 text-xs transition-colors hover:bg-[#f1f2f4]">
                                    <span className="shrink-0 text-gray-500">{fmtDay(j.date, { day: "numeric", month: "short" })}</span>
                                    <ShiftBadge shift={j.shift} />
                                    <span className="min-w-0 flex-1 truncate text-gray-300">{j.title}</span>
                                    <span className="shrink-0 font-medium text-gray-200">{money(j.cost)}</span>
                                  </div>
                                ))}
                              </div>
                            </Card>
                          )}

                          {p.invoiced.length > 0 && (
                            <Card className="mb-3">
                              <SectionHeading icon={FileText}>Invoiced</SectionHeading>
                              <div className="space-y-1">
                                {p.invoiced.map((i) => (
                                  <div key={i.id} className="flex items-center gap-2 rounded-lg border border-[#eceef1] bg-[#f9fafb] px-2.5 py-1.5 text-xs transition-colors hover:bg-[#f1f2f4]">
                                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: categoryColor(i.category) }} />
                                    <span className="shrink-0 text-gray-500">{fmtDay(i.weekEnding, { day: "numeric", month: "short" })}</span>
                                    <span className="min-w-0 flex-1 truncate text-gray-300">
                                      {i.vendor}
                                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-500">{invoicedCategoryLabel(i.category)}</span>
                                    </span>
                                    {i.shift && <ShiftBadge shift={i.shift} />}
                                    <span className="shrink-0 font-medium text-gray-200">{money(i.amountExGst)}</span>
                                  </div>
                                ))}
                              </div>
                            </Card>
                          )}

                          {p.labour.length > 0 && (
                            <Card className="mb-3">
                              <SectionHeading icon={Users}>Crew (own labour)</SectionHeading>
                              <div className="space-y-1">
                                {byPerson(p.labour).map(([name, row]) => (
                                  <div key={name} className="flex items-center gap-2 rounded-lg border border-[#eceef1] bg-[#f9fafb] px-2.5 py-1.5 text-xs transition-colors hover:bg-[#f1f2f4]">
                                    <span className="min-w-0 flex-1 truncate text-gray-300">{name}</span>
                                    <span className="shrink-0 text-gray-500">{row.shifts} shift{row.shifts === 1 ? "" : "s"}</span>
                                    <span className="shrink-0 text-gray-500">{row.hours ? row.hours.toFixed(1) : "—"}h</span>
                                    <span className="shrink-0 font-medium text-gray-200">
                                      {row.cost > 0 ? money(row.cost) : <span className="text-amber-600">TBC</span>}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </Card>
                          )}

                          {p.hireLabourEstimate.length > 0 && (
                            <Card>
                              <SectionHeading icon={Users}>Hired labour (estimate)</SectionHeading>
                              <div className="space-y-1">
                                {byPerson(p.hireLabourEstimate).map(([name, row]) => (
                                  <div key={name} className="flex items-center gap-2 rounded-lg border border-[#eceef1] bg-[#f9fafb] px-2.5 py-1.5 text-xs transition-colors hover:bg-[#f1f2f4]">
                                    <span className="min-w-0 flex-1 truncate text-gray-300">{name}</span>
                                    <span className="shrink-0 text-gray-500">{row.shifts} shift{row.shifts === 1 ? "" : "s"}</span>
                                    <span className="shrink-0 text-gray-500">{row.hours ? row.hours.toFixed(1) : "—"}h</span>
                                    <span className="shrink-0 font-medium text-gray-200">
                                      {row.cost > 0 ? money(row.cost) : <span className="text-amber-600">TBC</span>}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </Card>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </Card>
            </>
          )}
        </div>
      )}
    </PageShell>
  );
}
