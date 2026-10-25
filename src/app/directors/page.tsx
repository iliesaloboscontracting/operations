"use client";

// Directors overview (Director Insights Phase 1, 24 Oct 2026). What needs a
// director first, then how the business is tracking: cost against contract
// values, workload, crew capacity, the cost trend, plant and hire, people,
// and how far the numbers can be trusted. Every figure says what it is
// (locked / estimate / booked) and its "?" opens the KPI dictionary. Plan:
// director-insights-plan/. Director access only - the API checks it too.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { CAT_LABELS, change, short } from "@/lib/trackingView";
import type { CostCatKey } from "@/lib/types";
import type { DirectorOverviewDTO } from "@/lib/insights/load";
import { Card, HEALTH, moneyTip, tooltipStyle } from "@/components/tracking/parts";
import { ConfidenceBadge, DLink, Figure, Help, PriorityPill, Section, pct } from "@/components/directors/parts";
import { groupForDisplay } from "@/lib/findings/view";
import FindingPanel from "@/components/directors/FindingPanel";
import HealthBand from "@/components/directors/HealthBand";

const day = (iso: string) => fmtDay(iso, { day: "numeric", month: "short" });
const weekday = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric" });
// A stored timestamp as a Sydney calendar day ("25 Oct").
const sydDay = (ts: string) => new Date(ts).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });

// The cost trend shows the four biggest categories over the 12 weeks and
// folds the rest into "Other" - more series than that stop being readable.
const SERIES_COLOURS = ["#3987e5", "#e0a33c", "#4fb38a", "#a07ad8", "#7d848f"];

export default function DirectorsPage() {
  const { isDirector, loading: authLoading } = useAuth();
  const [o, setO] = useState<DirectorOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    apiFetch("/api/directors/overview")
      .then(async (r) => (r.ok ? setO(await r.json()) : setError(r.status === 403 ? "denied" : "Couldn't load the overview.")))
      .catch(() => setError("Couldn't load the overview."));
  }, []);
  useEffect(() => {
    if (authLoading || !isDirector) return;
    load();
  }, [authLoading, isDirector, load]);

  if (authLoading) return null;
  if (!isDirector || error === "denied") {
    return (
      <PageShell title="Directors">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }

  const asAt = o ? new Date(o.asAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <PageShell
      title="Directors"
      subtitle={asAt ? `As at ${asAt} · live from Operations · ex GST` : undefined}
      actions={<Link href="/directors/kpis" className="shrink-0 rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2">How the numbers work</Link>}
    >
      {error ? (
        <p className="py-10 text-center text-sm text-red-400">{error}</p>
      ) : !o ? (
        <p className="py-10 text-center text-sm text-gray-500">Loading...</p>
      ) : (
        <Overview o={o} showAll={showAll} setShowAll={setShowAll} onRefresh={load} />
      )}
    </PageShell>
  );
}

function Overview({ o, showAll, setShowAll, onRefresh }: { o: DirectorOverviewDTO; showAll: boolean; setShowAll: (fn: (v: boolean) => boolean) => void; onRefresh: () => void }) {
  const c = o.cost;
  const vsLast = change(c.monthSoFar.total, c.lastMonthSameDays);
  const firmPct = c.monthSoFar.total > 0 ? c.monthSoFar.firm / c.monthSoFar.total : null;

  return (
    <>
      {/* 0. Company health band (G1) */}
      <HealthBand tiles={o.health} />

      {/* 1. Needs attention: stored findings once the engine has run, else the computed list */}
      {o.findingsMeta.checkedAt
        ? <FindingsAttention o={o} showAll={showAll} setShowAll={setShowAll} onRefresh={onRefresh} />
        : <ComputedAttention o={o} showAll={showAll} setShowAll={setShowAll} />}

      {/* 2-4. Cost, workload, capacity */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title="Cost & contract value" kpi="F1" right={<ConfidenceBadge level={c.confidence} why="How much of this month's spend is locked or invoiced, and whether every line has a confirmed rate" />}>
          <div className="grid grid-cols-2 gap-3">
            <Figure
              label="Spent this month so far"
              value={short(c.monthSoFar.total)}
              sub={`${pct(firmPct)} locked or invoiced · ${vsLast ? `${vsLast.text} vs same days last month` : "nothing last month to compare"}`}
            />
            <Figure label="Still to come" kpi="F2" value={short(c.stillToCome)} sub="Booked, not spent yet (active jobs)" />
          </div>
          <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Active jobs vs contract value <Help id="F3" /></div>
          <DLink href="/tracking" className="mt-1 flex flex-wrap gap-1.5">
            {([["ACT", c.health.act], ["WATCH", c.health.watch], ["ON_TRACK", c.health.onTrack], ["CANT_ASSESS", c.health.cantAssess]] as const).map(([h, n]) => {
              const s = HEALTH[h];
              return (
                <span key={h} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.cls}`}>
                  <s.Icon size={12} aria-hidden /> {s.label} {n}
                </span>
              );
            })}
          </DLink>
          <p className="mt-2 text-[11px] text-gray-500">Cost against contract value - not margin. Revenue isn&apos;t connected yet. Labour hire only counts once the agency invoices, so recent weeks read low.</p>
        </Section>

        <Section title="Workload" kpi="O1">
          <div className="grid grid-cols-2 gap-3">
            <Figure
              label="Active projects"
              value={o.workload.active}
              sub={o.workload.activeTrend ? `${o.workload.activeTrend.diff >= 0 ? "+" : ""}${o.workload.activeTrend.diff} vs 4 weeks ago` : o.snapshotsSince ? `Weekly history from ${day(o.snapshotsSince)} - trend after 4 full weeks` : "No history yet - weekly snapshots start now"}
              href="/projects"
            />
            <Figure
              label="Starting ≤ 30 days"
              kpi="O2"
              value={o.workload.starting.length}
              sub={`${o.workload.startingConfirmed} confirmed · ${o.workload.startingTentative} tentative`}
            />
            <Figure label="Completing ≤ 30 days" kpi="O4" value={o.workload.completing.length} sub={o.workload.completing.slice(0, 2).map((p) => `${p.name} ${day(p.date)}`).join(", ") || "None due"} />
            <Figure label="Starts not ready" kpi="O3" value={o.workload.notReady} tone={o.workload.notReady ? "bad" : "good"} sub={o.workload.notReady ? "No supervisor on day one" : "All covered"} href="/calendar" />
          </div>
          <DLink href="/requests" className="mt-3 flex items-center justify-between rounded-lg border border-edge px-3 py-2 text-sm hover:bg-panel2">
            <span className="text-gray-300">Site requests</span>
            <span className={`whitespace-nowrap text-[12px] tabular-nums ${o.requests.overdue ? "text-red-400" : "text-gray-400"}`}>{o.requests.open} open · {o.requests.urgent} urgent · {o.requests.overdue} overdue</span>
          </DLink>
        </Section>

        <Section title="Crew capacity · next 2 weeks" kpi="P3">
          <CrewChart days={o.capacity.days} available={o.capacity.available} />
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Figure label="Short days" value={o.capacity.shortDays.length} tone={o.capacity.shortDays.length ? "bad" : undefined}
              sub={o.capacity.shortDays.length ? `First: ${weekday(o.capacity.shortDays[0].date)}, ${o.capacity.shortDays[0].short} short` : `Booked crew within ${o.capacity.available} available`} />
            <Figure label="No supervisor" kpi="P4" value={o.capacity.supervisorGaps} tone={o.capacity.supervisorGaps ? "bad" : undefined} sub="Jobs with crew, nobody in charge" />
          </div>
          <p className="mt-2 text-[11px] text-gray-500">Booked on the board only - days further out may not be filled yet.</p>
        </Section>
      </div>

      {/* 5. Cost trend */}
      <Section title="Spend by week, by type" kpi="F4" className="mb-4">
        <CostTrend trend={c.trend} />
      </Section>

      {/* 6-7. Plant & hire, people */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Plant & hire" kpi="PL1" right={<ConfidenceBadge level={o.plant.confidence} why="Plant use only counts days a machine is put on the board" />}>
          {o.plant.confidence === "LOW" && (
            <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              Owned plant was put on the board on only {o.plant.allocatedDays} machine-day{o.plant.allocatedDays === 1 ? "" : "s"} in the last 4 weeks, so plant on site probably isn&apos;t being booked day to day. Read &quot;use&quot; and &quot;idle&quot; as a data gap, not idle machines.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Owned plant use" value={pct(o.plant.fleetPct)} sub={`${o.plant.machines} machines · last 4 weeks`} />
            <Figure label="Idle (< 30%)" value={o.plant.confidence === "LOW" ? "—" : o.plant.idle} sub={o.plant.confidence === "LOW" ? "Can't tell yet" : "Draft threshold"} />
            <Figure label="Down" kpi="PL2" value={o.plant.down} tone={o.plant.down ? "bad" : undefined} href="/plant" />
            <Figure label="Hired plant out" kpi="F6" value={short(c.hiredPlant.total)} sub={`${c.hiredPlant.items} items · estimate`} href="/hire" />
          </div>
          {o.plant.confidence !== "LOW" && o.plant.idleItems.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {o.plant.idleItems.slice(0, 10).map((i) => (
                <span key={i.name} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-gray-300">{i.name} <span className="text-gray-500">· {pct(i.pct)}{i.down ? " · down" : ""}</span></span>
              ))}
            </div>
          )}
          {o.plant.overdueOffHire > 0 && <p className="mt-2 text-[11px] text-red-400">{o.plant.overdueOffHire} hired item{o.plant.overdueOffHire === 1 ? "" : "s"} past the off-hire date</p>}
        </Section>

        <Section title="People" kpi="P1">
          <HoursChart hours={o.people.hours} />
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Figure label="Active crew" kpi="P2" value={o.people.activeCrew} sub="Own people, not on leave" href="/labour" />
            <Figure label="Labour hire share" kpi="F5" value={pct(o.people.labourHireShare)} sub={`Of labour cost, ${fmtDay(o.people.labourHireMonth, { month: "long" })} (last full month - agencies invoice late)`} />
          </div>
        </Section>
      </div>

      {/* 8. Data confidence */}
      <Section title="How far to trust these numbers" kpi="DQ">
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {o.dataQuality.map((d) => (
            <DLink key={d.id} href={d.href} className="flex items-center justify-between gap-3 border-b border-edge/60 py-1.5 text-sm hover:bg-panel2">
              <span className="text-gray-300">{d.label}</span>
              <span className={`tabular-nums ${d.count ? "text-amber-300" : "text-emerald-400"}`}>{d.count}</span>
            </DLink>
          ))}
        </div>
        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Not available yet - no source connected</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {o.notYetAvailable.map((n) => <span key={n} className="rounded-full border border-dashed border-edge px-2 py-0.5 text-[11px] text-gray-400">{n}</span>)}
        </div>
      </Section>
    </>
  );
}

function CrewChart({ days, available }: { days: DirectorOverviewDTO["capacity"]["days"]; available: number }) {
  const data = days.map((d) => ({ label: weekday(d.date), own: d.own, hire: d.hire }));
  return (
    <>
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#898781" }} tickLine={false} axisLine={{ stroke: "#383835" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: "#898781" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={tooltipStyle} formatter={(v: unknown, k: unknown) => [String(v), k === "own" ? "Own crew booked" : "Labour hire booked"]} />
          <Bar dataKey="own" stackId="a" fill="#3987e5" maxBarSize={18} />
          <Bar dataKey="hire" stackId="a" fill="#9ec5f4" maxBarSize={18} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="mt-1 text-[10px] text-gray-500">People per day · solid = own crew ({available} available) · light = labour hire</div>
    </>
  );
}

function CostTrend({ trend }: { trend: DirectorOverviewDTO["cost"]["trend"] }) {
  const totals = new Map<CostCatKey, number>();
  for (const w of trend) for (const [k, v] of Object.entries(w.cat)) totals.set(k as CostCatKey, (totals.get(k as CostCatKey) ?? 0) + (v ?? 0));
  const top = CAT_LABELS.filter((c) => (totals.get(c.key) ?? 0) > 0).sort((a, b) => (totals.get(b.key) ?? 0) - (totals.get(a.key) ?? 0)).slice(0, 4);
  const topKeys = new Set(top.map((t) => t.key));
  const data = trend.map((w) => {
    const row: Record<string, number | string> = { label: day(w.week) + (w.partial ? " (so far)" : "") };
    let other = 0;
    for (const [k, v] of Object.entries(w.cat)) {
      if (topKeys.has(k as CostCatKey)) row[k] = v ?? 0;
      else other += v ?? 0;
    }
    row.other = other;
    return row;
  });
  const names: Record<string, string> = Object.fromEntries([...top.map((t) => [t.key, t.label]), ["other", "Other"]]);
  const keys = [...top.map((t) => t.key as string), "other"];
  return (
    <>
      <div className="mb-2 text-[11px] text-gray-500">$ ex GST per Monday-Sunday week, last 12 weeks · this week so far on the right · locked, estimated and invoiced together</div>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={{ stroke: "#383835" }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={false} tickFormatter={(v) => short(v)} width={52} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={tooltipStyle} formatter={moneyTip(names)} labelFormatter={(l) => `Week of ${l}`} />
            {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={SERIES_COLOURS[i]} maxBarSize={28} radius={i === keys.length - 1 ? [4, 4, 0, 0] : undefined} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
        {keys.map((k, i) => <span key={k}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: SERIES_COLOURS[i] }} />{names[k]}</span>)}
      </div>
    </>
  );
}

function HoursChart({ hours }: { hours: DirectorOverviewDTO["people"]["hours"] }) {
  const data = hours.map((h) => ({ label: day(h.week) + (h.incomplete ? "*" : ""), staff: h.staff, hire: h.hire }));
  return (
    <>
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#898781" }} tickLine={false} axisLine={{ stroke: "#383835" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: "#898781" }} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={tooltipStyle} formatter={(v: unknown, k: unknown) => [`${v} h`, k === "staff" ? "Staff" : "Hire workers"]} labelFormatter={(l) => `Week of ${l}`} />
          <Bar dataKey="staff" stackId="a" fill="#3987e5" maxBarSize={22} />
          <Bar dataKey="hire" stackId="a" fill="#9ec5f4" maxBarSize={22} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="mt-1 text-[10px] text-gray-500">Signed-in hours per week · solid = staff · light = hire workers · * before 26 Oct incomplete (sign-ins trial)</div>
    </>
  );
}

// Before the findings engine has run: the list worked out on the spot.
function ComputedAttention({ o, showAll, setShowAll }: { o: DirectorOverviewDTO; showAll: boolean; setShowAll: (fn: (v: boolean) => boolean) => void }) {
  const urgent = o.alerts.filter((a) => a.priority === "CRITICAL" || a.priority === "HIGH").length;
  const shown = showAll ? o.alerts : o.alerts.slice(0, 7);
  return (
    <Card className="mb-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-100">Needs attention</div>
        <div className="text-[11px] text-gray-500">{urgent} critical or high · {o.alerts.length} in all</div>
      </div>
      {o.alerts.length === 0 ? (
        <p className="text-sm text-emerald-400">All clear - nothing needs a director right now.</p>
      ) : (
        <div className="divide-y divide-edge">
          {shown.map((a, i) => (
            <div key={i} className="flex gap-3 py-2.5">
              <PriorityPill p={a.priority} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-200">
                  {a.href ? <DLink href={a.href} className="hover:underline">{a.title}</DLink> : a.title}
                </div>
                {a.links && a.links.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {a.links.slice(0, 12).map((l, j) => (
                      <DLink key={j} href={l.href} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-gray-300 hover:bg-panel2">
                        {l.label}{l.detail && <span className="text-gray-500"> · {l.detail}</span>}
                      </DLink>
                    ))}
                    {a.links.length > 12 && <span className="px-1 text-[11px] text-gray-500">+{a.links.length - 12} more</span>}
                  </div>
                )}
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">{a.hint} <Help id={a.kpi} /></div>
              </div>
            </div>
          ))}
        </div>
      )}
      {o.alerts.length > 7 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs text-brand-400 hover:underline">
          {showAll ? "Show fewer" : `Show all ${o.alerts.length}`}
        </button>
      )}
    </Card>
  );
}

// Stored findings (Phase 2): each problem once, with how long it's stood and
// whether its rule has stopped firing. Critical / high / medium one by one;
// information-only gaps bundled per kind. Overdue site requests come straight
// from Requests (they're work items, not findings).
function FindingsAttention({ o, showAll, setShowAll, onRefresh }: { o: DirectorOverviewDTO; showAll: boolean; setShowAll: (fn: (v: boolean) => boolean) => void; onRefresh: () => void }) {
  const { singles, infoGroups } = groupForDisplay(o.findings);
  const [openId, setOpenId] = useState<string | null>(null);
  const requests = o.alerts.filter((a) => a.kpi === "O6");
  const m = o.findingsMeta;
  const urgent = (m.bySeverity.CRITICAL ?? 0) + (m.bySeverity.HIGH ?? 0);
  const shownSingles = showAll ? singles : singles.slice(0, 7);
  const checked = m.checkedAt ? new Date(m.checkedAt).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <Card className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-100">Needs attention</div>
        <div className="text-[11px] text-gray-500">
          {urgent} critical or high · {m.open} open{m.signalCleared ? ` · ${m.signalCleared} cleared, to close` : ""} · {m.closedThisWeek} closed this week{checked ? ` · checked ${checked}` : ""}
        </div>
      </div>
      {singles.length === 0 && infoGroups.length === 0 && requests.length === 0 ? (
        <p className="text-sm text-emerald-400">All clear - nothing needs a director right now.</p>
      ) : (
        <div className="divide-y divide-edge">
          {requests.map((a, i) => (
            <div key={`r${i}`} className="flex gap-3 py-2.5">
              <PriorityPill p={a.priority} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-200">{a.href ? <DLink href={a.href} className="hover:underline">{a.title}</DLink> : a.title}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">{a.hint} <Help id={a.kpi} /></div>
              </div>
            </div>
          ))}
          {shownSingles.map((f) => (
            <div key={f.id} className="flex gap-3 py-2.5">
              <PriorityPill p={f.severity} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-200">{f.href ? <DLink href={f.href} className="hover:underline">{f.title}</DLink> : f.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                  <span>Open since {sydDay(f.firstSeenAt)}</span>
                  {f.signalClearedAt && <span className="text-emerald-400">No longer showing since {sydDay(f.signalClearedAt)} - to close</span>}
                  {f.status !== "OPEN" && <span>{f.status === "ACKNOWLEDGED" ? "Acknowledged" : "Being actioned"}{f.ownerName ? ` · ${f.ownerName}` : ""}</span>}
                  {f.provisional && <span>Data incomplete</span>}
                  <Help id={f.kpi} />
                  <button onClick={() => setOpenId(f.id)} className="text-brand-300 hover:underline">Details</button>
                </div>
              </div>
            </div>
          ))}
          {infoGroups.map((g) => (
            <div key={g.rule} className="flex gap-3 py-2.5">
              <PriorityPill p="INFO" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-200">{g.items.length} {g.label}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.items.slice(0, 12).map((f) => (
                    <button key={f.id} onClick={() => setOpenId(f.id)} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-gray-300 hover:bg-panel2">{f.subjectName}</button>
                  ))}
                  {g.items.length > 12 && <span className="px-1 text-[11px] text-gray-500">+{g.items.length - 12} more</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">Gaps to fill - they close themselves once fixed <Help id={g.kpi} /></div>
              </div>
            </div>
          ))}
        </div>
      )}
      {singles.length > 7 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs text-brand-400 hover:underline">
          {showAll ? "Show fewer" : `Show all ${singles.length}`}
        </button>
      )}
      {openId && <FindingPanel id={openId} onClose={() => setOpenId(null)} onChanged={onRefresh} />}
    </Card>
  );
}
