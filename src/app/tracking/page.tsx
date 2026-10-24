"use client";

// Project Tracking - all jobs (redesign, 24 Oct 2026). Exceptions first:
// headline numbers, what needs attention and why, then every job against its
// contract value, then spend by week and by type. Built from the research in
// reports/Job cost tracking page design.md. Tap a job for its own page.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageShell from "@/components/PageShell";
import { apiFetch } from "@/lib/apiFetch";
import { fmtDay, addDays } from "@/lib/dates";
import { todaySydney } from "@/lib/today";
import type { AttentionItemDTO, IdleHireDTO, ProjectCostDTO } from "@/lib/types";
import { PERIODS, type PeriodKey, categoryRows, change, periodRange, previousRange, short, sumDays, sumProjects, weeklyBars } from "@/lib/trackingView";
import { BLUE, BLUE_LIGHT, Card, CategoryBars, HEALTH, Legend, SpendBar, Sparkline, StatusPill, Tile, moneyTip, tooltipStyle } from "@/components/tracking/parts";
import { ChevronDown, ChevronRight } from "lucide-react";

const LEVEL = {
  act: { label: "Act", cls: "bg-red-500/15 text-red-400" },
  watch: { label: "Watch", cls: "bg-amber-500/15 text-amber-400" },
  data: { label: "Data", cls: "bg-panel2 text-gray-400" },
};

export default function TrackingPage() {
  const [projects, setProjects] = useState<ProjectCostDTO[]>([]);
  const [attention, setAttention] = useState<AttentionItemDTO[]>([]);
  const [idle, setIdle] = useState<IdleHireDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [asAt, setAsAt] = useState<Date | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("todate");
  const [showAll, setShowAll] = useState(false);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const today = todaySydney();

  useEffect(() => {
    apiFetch("/api/tracking")
      .then((r) => (r.ok ? r.json() : { projects: [], attention: [], idleHire: null }))
      .then((d) => { setProjects(d.projects ?? []); setAttention(d.attention ?? []); setIdle(d.idleHire); setAsAt(new Date()); })
      .finally(() => setLoading(false));
  }, []);

  const range = periodRange(period, today);
  const prev = previousRange(range);
  const all = useMemo(() => sumProjects(projects, null), [projects]);
  const inPeriod = sumProjects(projects, range);
  const before = prev ? sumProjects(projects, prev) : null;
  const last7 = sumProjects(projects, { from: addDays(today, -6), to: today, label: "", partial: true });
  const prior7 = sumProjects(projects, { from: addDays(today, -13), to: addDays(today, -7), label: "", partial: false });
  const active = projects.filter((p) => p.status === "ACTIVE");
  const stillToCome = active.reduce((n, p) => n + p.stillToCome, 0);
  const needCount = attention.filter((a) => a.level !== "data").length;
  const dataCount = attention.filter((a) => a.level === "data").length;
  const firmPct = all.total > 0 ? Math.round(((all.locked + all.invoiced) / all.total) * 100) : 100;

  const rows = projects
    .map((p) => ({ p, spent: sumDays(p.daily, range).total, weeks: weeklyBars(p.daily, today, 8).map((w) => w.total) }))
    .filter(({ p, spent }) => showAll || p.status === "ACTIVE" || (period !== "todate" && spent > 0))
    .sort((a, b) => HEALTH[a.p.health].rank - HEALTH[b.p.health].rank || b.spent - a.spent);
  const hiddenCount = projects.length - rows.length;

  const weeks = weeklyBars(projects.flatMap((p) => p.daily), today, 12).map((w) => ({ ...w, label: fmtDay(w.week, { day: "numeric", month: "short" }) }));
  const cats = categoryRows(inPeriod.cat);
  const shownAttention = showAllAttention ? attention : attention.slice(0, 6);

  return (
    <PageShell
      title="Project Tracking"
      subtitle={asAt ? `As at ${asAt.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ${firmPct}% of cost locked or invoiced, the rest estimated · ex GST` : undefined}
    >
      {loading ? (
        <p className="py-10 text-center text-sm text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.key} role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${period === p.key ? "bg-brand-600 text-white" : "border border-edge text-gray-400 hover:text-gray-200"}`}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label={`Spent · ${range.label.toLowerCase()}`}
              value={short(inPeriod.total)}
              sub={before ? (() => { const c = change(inPeriod.total, before.total); return c ? `${c.text} vs the ${range.partial ? "same time before" : "one before"}` : "Nothing before to compare"; })() : `${short(inPeriod.estimated)} of it still estimated`}
            />
            <Tile
              label="Last 7 days"
              value={short(last7.total)}
              sub={(() => { const c = change(last7.total, prior7.total); return c ? `${c.text} vs the 7 days before` : "—"; })()}
              subTone={(() => { const c = change(last7.total, prior7.total); return c && c.pct >= 25 ? "bad" : undefined; })()}
            />
            <Tile label="Still to come" value={short(stillToCome)} sub="Labour hire not billed + booked days + hire still out" />
            <Tile label="Needs attention" value={needCount} sub={`${dataCount} data gap${dataCount === 1 ? "" : "s"} to fill`} subTone={needCount ? "bad" : "good"} />
          </div>

          <Card className="mb-4">
            <div className="mb-1 text-sm font-semibold text-gray-100">Needs attention</div>
            {attention.length === 0 ? (
              <p className="text-sm text-emerald-400">All clear - nothing needs looking at.</p>
            ) : (
              <div className="divide-y divide-edge">
                {shownAttention.map((a, i) => (
                  <div key={i} className="flex gap-3 py-2.5">
                    <span className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${LEVEL[a.level].cls}`}>{LEVEL[a.level].label}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      {a.jobs ? (
                        <>
                          <div className="text-gray-200">{a.text}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {a.jobs.map((j) => (
                              <Link key={j.id} href={`/tracking/${j.id}`} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-gray-300 hover:bg-panel2">
                                {j.name} <span className="text-gray-500">· {j.detail}</span>
                              </Link>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="text-gray-200">
                          {a.projectId ? <Link href={`/tracking/${a.projectId}`} className="font-medium text-gray-100 hover:underline">{a.projectName}</Link>
                            : <Link href="/hire" className="font-medium text-gray-100 hover:underline">{a.projectName}</Link>}
                          {" · "}{a.text}
                        </div>
                      )}
                      <div className="mt-0.5 text-[11px] text-gray-500">{a.hint}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {attention.length > 6 && (
              <button onClick={() => setShowAllAttention((v) => !v)} className="mt-1 text-xs text-brand-400 hover:underline">
                {showAllAttention ? "Show fewer" : `Show all ${attention.length}`}
              </button>
            )}
          </Card>

          <Card className="mb-4 p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge px-4 py-3">
              <div className="text-sm font-semibold text-gray-100">{showAll ? "All jobs" : "Active jobs"}</div>
              <Legend />
            </div>
            <div className="hidden grid-cols-[minmax(0,1.5fr)_6rem_minmax(0,1.6fr)_5rem_7rem] gap-3 px-4 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 md:grid">
              <span>Job</span><span className="text-right">Spent{period === "todate" ? "" : ` · ${range.label.toLowerCase()}`}</span><span>To date + still to come, vs contract</span><span>8 weeks</span><span>Status</span>
            </div>
            <div className="divide-y divide-edge">
              {rows.map(({ p, spent, weeks: w }) => {
                const confirmed = p.lockedCost + p.invoicedTotal;
                const pct = p.contractValue ? Math.round(((p.totalCost + p.stillToCome) / p.contractValue) * 100) : null;
                return (
                  <Link key={p.id} href={`/tracking/${p.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-panel2 md:grid-cols-[minmax(0,1.5fr)_6rem_minmax(0,1.6fr)_5rem_7rem]">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-100">{p.name}</div>
                      <div className="truncate text-[11px] text-gray-500">{[p.client, p.jobNo].filter(Boolean).join(" · ") || "No client set"}</div>
                    </div>
                    <div className="text-right text-sm font-semibold tabular-nums text-gray-100">{short(spent)}</div>
                    <div className="col-span-2 flex items-center gap-2 md:col-span-1">
                      {p.contractValue != null ? (
                        <>
                          <SpendBar confirmed={confirmed} estimated={p.estimatedTotal} toCome={p.stillToCome} contract={p.contractValue} />
                          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-gray-400">{pct}%</span>
                        </>
                      ) : (
                        // Nothing to measure against - no bar, rather than a full one that reads as "used up".
                        <span className="text-[11px] text-gray-500">{p.health === "OVERHEAD" ? "Overhead - no contract" : "No contract value - add it on the project"}</span>
                      )}
                    </div>
                    <div className="hidden md:block"><Sparkline values={w} /></div>
                    <div className="col-span-2 md:col-span-1"><StatusPill health={p.health} reason={p.healthReason} /></div>
                  </Link>
                );
              })}
            </div>
            <button onClick={() => setShowAll((v) => !v)} className="w-full border-t border-edge px-4 py-2 text-left text-xs text-brand-400 hover:bg-panel2">
              {showAll ? "Show active jobs only" : `Show all jobs (${hiddenCount} more)`}
            </button>
          </Card>

          <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-1 text-sm font-semibold text-gray-100">Spend by week, all jobs</div>
              <div className="mb-2 text-[11px] text-gray-500">Last 12 weeks · this week so far on the right</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeks} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={{ stroke: "#383835" }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={false} tickFormatter={(v) => short(v)} width={52} />
                    <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={tooltipStyle}
                      formatter={moneyTip({ confirmed: "Locked or invoiced", estimated: "Estimate" })} labelFormatter={(l) => `Week of ${l}`} />
                    <Bar dataKey="confirmed" stackId="a" fill={BLUE} maxBarSize={24} />
                    <Bar dataKey="estimated" stackId="a" fill={BLUE_LIGHT} maxBarSize={24} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <Legend showToCome={false} showContract={false} />
            </Card>
            <Card>
              <div className="mb-1 text-sm font-semibold text-gray-100">What it's spent on · {range.label.toLowerCase()}</div>
              <div className="mb-2 text-[11px] text-gray-500">All jobs, biggest first</div>
              {cats.length ? <CategoryBars rows={cats} /> : <p className="text-sm text-gray-500">Nothing spent in this period.</p>}
            </Card>
          </div>

          <HowWorkedOut idle={idle} />
        </>
      )}
    </PageShell>
  );
}

function HowWorkedOut({ idle }: { idle: IdleHireDTO | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1 text-left text-sm font-semibold text-gray-100">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} How these numbers are worked out
      </button>
      {open && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-400">
          <li><b className="text-gray-300">Locked</b> - days that have been closed in Day Review (and the older history). They don't change.</li>
          <li><b className="text-gray-300">Estimate</b> - days not closed yet, costed from the board and today's rates, plus hired plant still out (rate × working days, until an invoice replaces it).</li>
          <li><b className="text-gray-300">Invoiced</b> - supplier invoices: labour hire, plant hire, tip fees, materials.</li>
          <li><b className="text-gray-300">Still to come</b> - labour hire worked since the agency's last invoice, days already booked on the board, and hired plant to its expected finish.</li>
          <li><b className="text-gray-300">Forecast</b> = spent so far + still to come. It only knows what's booked - it isn't a cost-to-complete.</li>
          <li><b className="text-gray-300">Status</b> - Watch from 80% of the contract value (on the forecast), Act from 100%. Can't assess when there's no contract value.</li>
          <li>Own crew wages are pay rates × hours on the board. Labour hire on the board is only an estimate; the agency's invoices are what count.</li>
          {idle && idle.items.length > 0 && <li>Hired items not on any job are on the Hire page, not charged to a job.</li>}
        </ul>
      )}
    </Card>
  );
}
