"use client";

import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { IdleHireDTO, ProjectCostDTO } from "@/lib/types";
import { money } from "@/lib/resource";
import { fmtDay } from "@/lib/dates";
import { ShiftBadge } from "@/components/ShiftBadge";
import { apiFetch } from "@/lib/apiFetch";
import { ChevronDown, ChevronRight, FileText, Handshake, Link2, Truck, TriangleAlert, Users, Wrench } from "lucide-react";

const CODE_COLS: { key: keyof ProjectCostDTO["byCode"]; label: string; icon: typeof Wrench }[] = [
  { key: "plant", label: "Plant", icon: Wrench },
  { key: "attach", label: "Attachments", icon: Link2 },
  { key: "trucks", label: "Trucks", icon: Truck },
  { key: "hire", label: "Hire", icon: Handshake },
];

const ROW_COLS = "grid-cols-[1.25fr_repeat(4,0.62fr)_0.72fr_0.72fr_0.85fr]";

function Amount({ n, muted }: { n: number; muted?: boolean }) {
  if (!n) return <span className="text-gray-600">—</span>;
  return <span className={muted ? "text-gray-400" : "text-gray-100"}>{money(n)}</span>;
}

// A one-line "$X under/over budget" hint under the Total figure - only shown
// once a real contract value is on file, never guessed at.
function BudgetHint({ p }: { p: ProjectCostDTO }) {
  if (p.contractValue == null) return null;
  const variance = p.totalCost - p.contractValue;
  if (variance <= 0) {
    return <div className="text-[10px] text-green-500">{money(-variance)} under budget</div>;
  }
  return <div className="text-[10px] text-red-400">{money(variance)} over budget</div>;
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
      title="Project Tracking"
      subtitle="What each project has cost so far: plant, attachments, trucks and hire allocated to its jobs, labour-hire invoices entered directly, and own-crew wages backfilled from daily allocation records."
    >
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-3 rounded-xl border border-edge bg-panel p-3.5 shadow-soft">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600">
              <Wrench size={18} />
            </div>
            <div>
              <div className="text-xl font-semibold leading-tight text-gray-100">{money(grandTotal)}</div>
              <div className="text-xs text-gray-500">Total cost to date, ex GST, across every project</div>
            </div>
          </div>

          {idleHire && idleHire.items.length > 0 && (
            <div className="mb-5 overflow-hidden rounded-xl border border-amber-800/50 bg-amber-950/20 shadow-soft">
              <button
                onClick={() => setIdleHireOpen((v) => !v)}
                className="flex w-full items-center gap-3 p-3.5 text-left"
              >
                {idleHireOpen ? (
                  <ChevronDown size={14} className="shrink-0 text-amber-500" />
                ) : (
                  <ChevronRight size={14} className="shrink-0 text-amber-500" />
                )}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                  <TriangleAlert size={18} />
                </div>
                <div>
                  <div className="text-xl font-semibold leading-tight text-gray-100">
                    {idleHire.totalIdleCost > 0 ? money(idleHire.totalIdleCost) : "Idle hire"}
                    {idleHire.totalIdleCost > 0 && <span className="ml-1.5 text-xs font-normal text-gray-500">estimated</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {idleHire.items.length} hired item{idleHire.items.length === 1 ? "" : "s"} sitting idle or overdue for off-hire - not attributed to any project
                  </div>
                </div>
              </button>

              {idleHireOpen && (
                <div className="border-t border-amber-800/40 px-3 py-2">
                  <div className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr_0.6fr_0.8fr] gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    <div>Item</div>
                    <div>On hire since</div>
                    <div>Finish</div>
                    <div>On hire</div>
                    <div>Idle</div>
                    <div className="text-right">Est. cost</div>
                  </div>
                  {idleHire.items.map((i) => (
                    <div
                      key={i.id}
                      className="grid grid-cols-[1.4fr_0.8fr_0.6fr_0.6fr_0.6fr_0.8fr] items-center gap-2 border-t border-amber-800/30 py-1.5 text-xs first:border-t-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-gray-200">{i.name}</div>
                        {i.agency && <div className="truncate text-[10px] text-gray-500">{i.agency}</div>}
                      </div>
                      <div className="text-gray-400">{i.hireStart}</div>
                      <div className={i.overdue ? "font-medium text-red-400" : "text-gray-400"}>
                        {i.hireEnd ?? "—"}
                        {i.overdue && " ⚠"}
                      </div>
                      <div className="text-gray-400">{i.onHireDays}d</div>
                      <div className="text-gray-400">{i.idleDays}d</div>
                      <div className="text-right font-medium text-gray-200">
                        {i.idleCost != null ? money(i.idleCost) : <span className="text-amber-400">TBC</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge py-10 text-center text-sm text-gray-500">
              No projects yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-edge shadow-soft">
              <div className={`grid ${ROW_COLS} gap-2 border-b border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500`}>
                <div>Project</div>
                {CODE_COLS.map((c) => (
                  <div key={c.key} className="flex items-center gap-1">
                    <c.icon size={12} />
                    {c.label}
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <FileText size={12} />
                  Labour hire
                </div>
                <div className="flex items-center gap-1">
                  <Users size={12} />
                  Labour
                </div>
                <div className="text-right">Total</div>
              </div>
              {projects.map((p) => {
                const isOpen = open.has(p.id);
                const hasDetail =
                  p.jobs.length > 0 || p.invoiced.length > 0 || p.labour.length > 0 ||
                  p.hireLabourEstimate.length > 0 || p.uncostedCount > 0 || p.unconfirmedCount > 0 ||
                  p.contractValue != null || !!p.contractValueNotes;
                return (
                  <div key={p.id} className="border-b border-edge/70 last:border-b-0">
                    <button
                      onClick={() => toggle(p.id)}
                      disabled={!hasDetail}
                      className={`grid w-full ${ROW_COLS} items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-panel2/50 disabled:cursor-default disabled:hover:bg-transparent`}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {hasDetail ? (
                          isOpen ? (
                            <ChevronDown size={14} className="shrink-0 text-gray-500" />
                          ) : (
                            <ChevronRight size={14} className="shrink-0 text-gray-500" />
                          )
                        ) : (
                          <span className="w-[14px] shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-gray-100">{p.name}</div>
                          <div className="truncate text-[11px] text-gray-500">
                            {p.client ?? "No client set"}
                            {p.jobNo && ` · ${p.jobNo}`}
                          </div>
                        </div>
                      </div>
                      {CODE_COLS.map((c) => (
                        <div key={c.key} className="text-sm">
                          <Amount n={p.byCode[c.key]} muted />
                        </div>
                      ))}
                      <div className="text-sm">
                        <Amount n={p.invoicedTotal} muted />
                      </div>
                      <div className="text-sm">
                        <Amount n={p.labourTotal} muted />
                        {p.labour.some((l) => l.cost == null) && (
                          <span className="ml-1 text-[9px] font-semibold uppercase text-amber-400">+TBC</span>
                        )}
                      </div>
                      <div className="text-right text-sm font-semibold">
                        <Amount n={p.totalCost} />
                        <BudgetHint p={p} />
                      </div>
                    </button>

                    {isOpen && hasDetail && (
                      <div className="border-t border-edge/70 bg-panel2/40 px-3 py-2">
                        {(p.contractValue != null || p.contractValueNotes) && (
                          <div className="mb-3 rounded-lg border border-edge/70 bg-panel px-3 py-2 text-xs">
                            {p.contractValue != null ? (
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                <span className="text-gray-400">
                                  Contract value <span className="font-medium text-gray-200">{money(p.contractValue)}</span>
                                </span>
                                <span className="text-gray-400">
                                  Cost to date <span className="font-medium text-gray-200">{money(p.totalCost)}</span>
                                </span>
                                <span className={p.totalCost > p.contractValue ? "text-red-400" : "text-green-500"}>
                                  {p.totalCost > p.contractValue
                                    ? `${money(p.totalCost - p.contractValue)} over budget`
                                    : `${money(p.contractValue - p.totalCost)} remaining`}
                                </span>
                              </div>
                            ) : (
                              <div className="text-gray-500">No single contract value - {p.contractValueNotes}</div>
                            )}
                            {p.contractValue != null && p.contractValueNotes && (
                              <div className="mt-1 text-[11px] text-gray-500">{p.contractValueNotes}</div>
                            )}
                          </div>
                        )}

                        {(p.uncostedCount > 0 || p.unconfirmedCount > 0) && (
                          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                            {p.uncostedCount > 0 && (
                              <span className="text-red-400">{p.uncostedCount} allocation{p.uncostedCount === 1 ? "" : "s"} not costed (rate or hours missing)</span>
                            )}
                            {p.unconfirmedCount > 0 && (
                              <span className="text-amber-400">{p.unconfirmedCount} on an unconfirmed rate</span>
                            )}
                          </div>
                        )}

                        {(p.hireLabourEstimateTotal > 0 || p.invoicedTotal > 0) && (
                          <div className="mb-3 rounded-lg border border-edge/70 bg-panel px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span className="text-gray-400">
                                Estimated from allocations <span className="font-medium text-gray-200">{money(p.hireLabourEstimateTotal)}</span>
                              </span>
                              <span className="text-gray-400">
                                Invoiced <span className="font-medium text-gray-200">{money(p.invoicedTotal)}</span>
                              </span>
                              <span className={p.hireLabourEstimateTotal === p.invoicedTotal ? "text-gray-500" : "text-amber-400"}>
                                {money(Math.abs(p.hireLabourEstimateTotal - p.invoicedTotal))} difference - for review, not added into the total
                              </span>
                            </div>
                          </div>
                        )}

                        {p.jobs.length > 0 && (
                          <>
                            <div className="grid grid-cols-[1fr_repeat(4,0.8fr)_0.9fr] gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              <div>Job</div>
                              {CODE_COLS.map((c) => (
                                <div key={c.key}>{c.label}</div>
                              ))}
                              <div className="text-right">Total</div>
                            </div>
                            {p.jobs.map((j) => (
                              <div
                                key={j.id}
                                className="grid grid-cols-[1fr_repeat(4,0.8fr)_0.9fr] items-center gap-2 border-t border-edge/50 py-1.5 text-xs first:border-t-0"
                              >
                                <div className="flex min-w-0 items-center gap-1.5 text-gray-300">
                                  <span className="shrink-0 text-gray-500">
                                    {fmtDay(j.date, { day: "numeric", month: "short" })}
                                  </span>
                                  <ShiftBadge shift={j.shift} />
                                  <span className="truncate">{j.title}</span>
                                </div>
                                {CODE_COLS.map((c) => (
                                  <div key={c.key}>
                                    <Amount n={j.byCode[c.key]} muted />
                                  </div>
                                ))}
                                <div className="text-right font-medium text-gray-200">{money(j.cost)}</div>
                              </div>
                            ))}
                          </>
                        )}

                        {p.invoiced.length > 0 && (
                          <div className={p.jobs.length > 0 ? "mt-3 border-t border-edge/70 pt-2" : ""}>
                            <div className="grid grid-cols-[1fr_1fr_0.6fr_0.8fr] gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              <div>Invoice</div>
                              <div>Vendor</div>
                              <div>Shift</div>
                              <div className="text-right">Amount ex GST</div>
                            </div>
                            {p.invoiced.map((i) => (
                              <div
                                key={i.id}
                                className="grid grid-cols-[1fr_1fr_0.6fr_0.8fr] items-center gap-2 border-t border-edge/50 py-1.5 text-xs first:border-t-0"
                              >
                                <div className="flex min-w-0 items-center gap-1.5 text-gray-300">
                                  <span className="shrink-0 text-gray-500">
                                    {fmtDay(i.weekEnding, { day: "numeric", month: "short" })}
                                  </span>
                                  <span className="truncate">{i.invoiceNo ?? "—"}</span>
                                </div>
                                <div className="truncate text-gray-400">{i.vendor}</div>
                                <div>{i.shift ? <ShiftBadge shift={i.shift} /> : <span className="text-gray-600">—</span>}</div>
                                <div className="text-right font-medium text-gray-200">{money(i.amountExGst)}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {p.labour.length > 0 && (
                          <div className={p.jobs.length > 0 || p.invoiced.length > 0 ? "mt-3 border-t border-edge/70 pt-2" : ""}>
                            <div className="grid grid-cols-[1.4fr_0.6fr_0.6fr_0.8fr] gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              <div>Crew (own labour)</div>
                              <div>Shifts</div>
                              <div>Hours</div>
                              <div className="text-right">Cost</div>
                            </div>
                            {byPerson(p.labour).map(([name, row]) => (
                              <div
                                key={name}
                                className="grid grid-cols-[1.4fr_0.6fr_0.6fr_0.8fr] items-center gap-2 border-t border-edge/50 py-1.5 text-xs first:border-t-0"
                              >
                                <div className="truncate text-gray-300">{name}</div>
                                <div className="text-gray-400">{row.shifts}</div>
                                <div className="text-gray-400">{row.hours ? row.hours.toFixed(1) : "—"}</div>
                                <div className="text-right font-medium text-gray-200">
                                  {row.cost > 0 ? money(row.cost) : <span className="text-amber-400">TBC</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {p.hireLabourEstimate.length > 0 && (
                          <div className="mt-3 border-t border-edge/70 pt-2">
                            <div className="grid grid-cols-[1.4fr_0.6fr_0.6fr_0.8fr] gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                              <div>Hired labour (estimate)</div>
                              <div>Shifts</div>
                              <div>Hours</div>
                              <div className="text-right">Cost</div>
                            </div>
                            {byPerson(p.hireLabourEstimate).map(([name, row]) => (
                              <div
                                key={name}
                                className="grid grid-cols-[1.4fr_0.6fr_0.6fr_0.8fr] items-center gap-2 border-t border-edge/50 py-1.5 text-xs first:border-t-0"
                              >
                                <div className="truncate text-gray-300">{name}</div>
                                <div className="text-gray-400">{row.shifts}</div>
                                <div className="text-gray-400">{row.hours ? row.hours.toFixed(1) : "—"}</div>
                                <div className="text-right font-medium text-gray-200">
                                  {row.cost > 0 ? money(row.cost) : <span className="text-amber-400">TBC</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
