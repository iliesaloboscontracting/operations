"use client";

import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { ProjectCostDTO } from "@/lib/types";
import { money } from "@/lib/resource";
import { fmtDay } from "@/lib/dates";
import { ShiftBadge } from "@/components/ShiftBadge";
import { apiFetch } from "@/lib/apiFetch";
import { ChevronDown, ChevronRight, Handshake, Link2, Truck, Wrench } from "lucide-react";

const CODE_COLS: { key: keyof ProjectCostDTO["byCode"]; label: string; icon: typeof Wrench }[] = [
  { key: "plant", label: "Plant", icon: Wrench },
  { key: "attach", label: "Attachments", icon: Link2 },
  { key: "trucks", label: "Trucks", icon: Truck },
  { key: "hire", label: "Hire", icon: Handshake },
];

function Amount({ n, muted }: { n: number; muted?: boolean }) {
  if (!n) return <span className="text-gray-600">—</span>;
  return <span className={muted ? "text-gray-400" : "text-gray-100"}>{money(n)}</span>;
}

export default function TrackingPage() {
  const [projects, setProjects] = useState<ProjectCostDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    apiFetch("/api/tracking")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProjects)
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
      subtitle="What each project has cost so far, by cost code - plant, attachments, trucks and hire allocated to its jobs. Crew never carries a daily rate, so labour isn't in this total."
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

          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-edge py-10 text-center text-sm text-gray-500">
              No projects yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-edge shadow-soft">
              <div className="grid grid-cols-[1.6fr_repeat(4,0.8fr)_0.9fr] gap-2 border-b border-edge bg-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <div>Project</div>
                {CODE_COLS.map((c) => (
                  <div key={c.key} className="flex items-center gap-1">
                    <c.icon size={12} />
                    {c.label}
                  </div>
                ))}
                <div className="text-right">Total</div>
              </div>
              {projects.map((p) => {
                const isOpen = open.has(p.id);
                return (
                  <div key={p.id} className="border-b border-edge/70 last:border-b-0">
                    <button
                      onClick={() => toggle(p.id)}
                      disabled={p.jobs.length === 0}
                      className="grid w-full grid-cols-[1.6fr_repeat(4,0.8fr)_0.9fr] items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-panel2/50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        {p.jobs.length > 0 ? (
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
                      <div className="text-right text-sm font-semibold">
                        <Amount n={p.totalCost} />
                      </div>
                    </button>

                    {isOpen && p.jobs.length > 0 && (
                      <div className="border-t border-edge/70 bg-panel2/40 px-3 py-2">
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
