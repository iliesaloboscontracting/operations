"use client";

// One job's costs (Tracking redesign, 24 Oct 2026) - shared by Tracking
// (/tracking/[id]) and, read-only, the Directors screen (/directors/jobs/[id],
// 25 Oct 2026: directors have no Operations access, so no edit buttons and no
// links into Operations there). Originally Project Tracking - one job. Contract value, spent,
// still to come, forecast and margin up top; cost building up over time
// against the contract value; what it's spent on, tap a type for the records
// behind it; supplier invoices (Add invoice). Research: reports/Job cost
// tracking page design.md.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Area, Bar, BarChart, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageShell from "@/components/PageShell";
import InvoiceModal from "@/components/InvoiceModal";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { addDays, fmtDay, startOfWeek } from "@/lib/dates";
import { todaySydney } from "@/lib/today";
import { money } from "@/lib/resource";
import type { CostCatKey, InvoicedCostDTO, ProjectCostDTO } from "@/lib/types";
import { CAT_LABELS, categoryRows, short, sumDays, weeklyBars } from "@/lib/trackingView";
import { BLUE, BLUE_LIGHT, Card, CategoryBars, Legend, SpendBar, StatusPill, Tile, moneyTip, tooltipStyle } from "@/components/tracking/parts";
import { ArrowLeft, Plus } from "lucide-react";
import HoursVsBudget from "@/components/tracking/HoursVsBudget";
import type { HoursVsBudgetDTO } from "@/lib/dailyLog/types";

const INVOICE_CAT: Record<string, CostCatKey> = { LABOUR_HIRE: "labourHire", PLANT_HIRE: "hire", TIP_FEES: "tipFees", MATERIALS: "materials" };
const day = (iso: string) => fmtDay(iso, { day: "numeric", month: "short" });

export default function JobView({ id, mode }: { id: string; mode: "ops" | "director" }) {
  const director = mode === "director";
  const isAdmin = useAuth().isAdmin && !director; // per-person wages: Operations Admins only
  const back = director ? { href: "/directors", label: "Directors overview" } : { href: "/tracking", label: "All jobs" };
  const [p, setP] = useState<ProjectCostDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<{ invoice: InvoicedCostDTO | null } | null>(null);
  const today = todaySydney();

  const load = useCallback(() =>
    director
      ? apiFetch(`/api/directors/jobs/${id}`).then((r) => (r.ok ? r.json() : { project: null })).then((d) => { setP(d.project ?? null); setMissing(!d.project); })
      : apiFetch("/api/tracking").then((r) => (r.ok ? r.json() : { projects: [] })).then((d) => {
          const found = (d.projects as ProjectCostDTO[]).find((x) => x.id === id) ?? null;
          setP(found); setMissing(!found);
        }), [id, director]);
  useEffect(() => { load(); }, [load]);
  // Daily log hours vs the approved budget (Task K) - shown only once the job has logs.
  const [hvb, setHvb] = useState<HoursVsBudgetDTO | null>(null);
  useEffect(() => {
    apiFetch(director ? `/api/directors/jobs/${id}/hours-vs-budget` : `/api/tracking/${id}/hours-vs-budget`)
      .then((r) => (r.ok ? r.json() : null)).then(setHvb).catch(() => setHvb(null));
  }, [id, director]);

  if (missing) return <PageShell title="Project Tracking"><p className="text-sm text-gray-500">That job isn't in Tracking. <Link href={back.href} className="text-brand-400 hover:underline">Back to {back.label.toLowerCase()}</Link></p></PageShell>;
  if (!p) return <PageShell title="Project Tracking"><p className="py-10 text-center text-sm text-gray-500">Loading...</p></PageShell>;

  const confirmed = p.lockedCost + p.invoicedTotal;
  const margin = p.contractValue != null ? p.contractValue - p.forecastCost : null;
  const usedPct = p.contractValue ? Math.round((p.totalCost / p.contractValue) * 100) : null;

  // Cost building up week by week, then a dashed step to the forecast.
  const firstWeek = p.firstDate ? startOfWeek(p.firstDate) : startOfWeek(today);
  const series: { label: string; confirmedCum: number | null; totalCum: number | null; forecast: number | null }[] = [];
  let cConf = 0, cTot = 0;
  for (let w = firstWeek; w <= today; w = addDays(w, 7)) {
    const s = sumDays(p.daily, { from: w, to: addDays(w, 6) });
    cConf += s.locked + s.invoiced; cTot += s.total;
    series.push({ label: day(w), confirmedCum: cConf, totalCum: cTot, forecast: null });
  }
  if (series.length) series[series.length - 1].forecast = cTot;
  if (p.stillToCome > 0) series.push({ label: "Forecast", confirmedCum: null, totalCum: null, forecast: p.forecastCost });

  const weeks = weeklyBars(p.daily, today, 12).map((w) => ({ ...w, label: day(w.week) }));
  const cats = categoryRows(sumDays(p.daily, null).cat);

  return (
    <PageShell title={<span>{p.name}</span>} subtitle={[p.client, p.jobNo && `Job ${p.jobNo}`].filter(Boolean).join(" · ") || undefined}
      actions={<div className="flex items-center gap-3"><StatusPill health={p.health} reason={p.healthReason} />{!director && <Link href={`/projects/${p.id}`} className="text-xs text-brand-400 hover:underline">Project file</Link>}</div>}>
      <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200"><ArrowLeft size={12} /> {back.label}</Link>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Contract value" value={p.contractValue != null ? short(p.contractValue) : "Not set"}
          sub={p.contractValue != null ? (p.contractValueNotes ?? "ex GST") : director ? "Not entered in Operations yet" : <Link href={`/projects/${p.id}`} className="text-brand-400 hover:underline">Add it on the project</Link>} />
        <Tile label="Spent so far" value={short(p.totalCost)}
          sub={`${usedPct != null ? `${usedPct}% of contract · ` : ""}${short(confirmed)} firm, ${short(p.estimatedTotal)} estimate`} />
        <Tile label="Still to come" value={short(p.stillToCome)}
          sub={[p.unbilledLabourHire > 0 && `${short(p.unbilledLabourHire)} labour hire not billed`, p.bookedDays > 0 && `${p.bookedDays} day${p.bookedDays === 1 ? "" : "s"} booked`, p.hireToCome > 0 && `${short(p.hireToCome)} hire to finish`].filter(Boolean).join(" · ") || "Nothing booked or outstanding"} />
        <Tile label="Forecast · margin" value={short(p.forecastCost)}
          sub={margin != null ? `${margin >= 0 ? "" : "-"}${short(Math.abs(margin))} ${margin >= 0 ? "left" : "over"} (${Math.round((margin / (p.contractValue as number)) * 100)}%) · rough indicator` : "No contract value to compare"}
          subTone={margin != null ? (margin < 0 ? "bad" : undefined) : undefined} />
      </div>

      <Card className="mb-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-gray-100">Against the contract value</div>
          <Legend />
        </div>
        <SpendBar confirmed={confirmed} estimated={p.estimatedTotal} toCome={p.stillToCome} contract={p.contractValue} height={16} />
        {(p.uncostedCount > 0 || p.unconfirmedCount > 0 || p.hireNoFinish > 0 || p.bookedUncosted > 0 || p.tipUnpriced > 0 || p.tipUninvoiced > 0 || p.tipInvoicesNoDocket > 0) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-amber-400">
            {p.uncostedCount > 0 && <span>+ {p.uncostedCount} allocation{p.uncostedCount === 1 ? "" : "s"} not costed (rate or hours missing)</span>}
            {p.unconfirmedCount > 0 && <span>{p.unconfirmedCount} on an unconfirmed rate</span>}
            {p.hireNoFinish > 0 && <span>{p.hireNoFinish} hired item{p.hireNoFinish === 1 ? "" : "s"} with no finish date - still to come excludes them</span>}
            {p.bookedUncosted > 0 && <span>{p.bookedUncosted} booked allocation{p.bookedUncosted === 1 ? "" : "s"} not costed</span>}
            {/* Tip dockets (Receipts R3) */}
            {p.tipUnpriced > 0 && <span>+ {p.tipUnpriced} tip docket{p.tipUnpriced === 1 ? "" : "s"} not priced - {director ? "a tip rate is needed" : <Link href="/receipts" className="underline">add a tip rate</Link>}</span>}
            {p.tipUninvoiced > 0 && <span>{p.tipUninvoiced} tip docket{p.tipUninvoiced === 1 ? "" : "s"} still not invoiced after 35 days</span>}
            {p.tipInvoicesNoDocket > 0 && <span>{p.tipInvoicesNoDocket} tip invoice{p.tipInvoicesNoDocket === 1 ? "" : "s"} with no docket from site</span>}
          </div>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-1 text-sm font-semibold text-gray-100">Cost building up</div>
          <div className="mb-2 text-[11px] text-gray-500">Week by week · solid line all cost, shaded part firm · dashed to the forecast · grey line the contract value</div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={{ stroke: "#383835" }} interval="preserveStartEnd" />
                <YAxis domain={[0, "auto"]} tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={false} tickFormatter={(v) => short(v)} width={52} />
                <Tooltip contentStyle={tooltipStyle} formatter={moneyTip({ confirmedCum: "Firm (locked + invoiced)", totalCum: "All cost", forecast: "Forecast" })} />
                {p.contractValue != null && <ReferenceLine y={p.contractValue} ifOverflow="extendDomain" stroke="#898781" strokeWidth={1.5} label={{ value: `Contract ${short(p.contractValue)}`, position: "insideTopLeft", fill: "#898781", fontSize: 11 }} />}
                <Area dataKey="confirmedCum" stroke="none" fill={BLUE} fillOpacity={0.22} isAnimationActive={false} />
                <Line dataKey="totalCum" stroke={BLUE} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="forecast" stroke={BLUE} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, fill: BLUE }} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="mb-1 text-sm font-semibold text-gray-100">Spend by week</div>
          <div className="mb-2 text-[11px] text-gray-500">Last 12 weeks · this week so far on the right</div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeks} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={{ stroke: "#383835" }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={false} tickFormatter={(v) => short(v)} width={52} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={tooltipStyle} formatter={moneyTip({ confirmed: "Locked or invoiced", estimated: "Estimate" })} labelFormatter={(l) => `Week of ${l}`} />
                <Bar dataKey="confirmed" stackId="a" fill={BLUE} maxBarSize={24} />
                <Bar dataKey="estimated" stackId="a" fill={BLUE_LIGHT} maxBarSize={24} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mb-4">
        <div className="mb-1 text-sm font-semibold text-gray-100">What it's spent on</div>
        <div className="mb-2 text-[11px] text-gray-500">Job to date · tap a type to see the records behind it</div>
        {cats.length ? <CategoryBars rows={cats} picked={picked} onPick={(k) => setPicked(picked === k ? null : k)} /> : <p className="text-sm text-gray-500">Nothing spent yet.</p>}
        {picked && <Behind p={p} cat={picked as CostCatKey} isAdmin={isAdmin} onEdit={director ? undefined : (i) => setInvoiceFor({ invoice: i })} />}
      </Card>

      <Card className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-100">Supplier invoices <span className="font-normal text-gray-500">· {p.invoiced.length}</span></div>
          {!director && (
            <button onClick={() => setInvoiceFor({ invoice: null })} className="inline-flex items-center gap-1 rounded-lg border border-edge px-2 py-1 text-[11px] font-medium text-gray-300 hover:bg-panel2">
              <Plus size={12} /> Add invoice
            </button>
          )}
        </div>
        <InvoiceList rows={[...p.invoiced].sort((a, b) => b.weekEnding.localeCompare(a.weekEnding))} onEdit={director ? undefined : (i) => setInvoiceFor({ invoice: i })} />
        {(p.hireLabourEstimateTotal > 0 || p.labourHireInvoicedTotal > 0) && (
          <p className="mt-2 text-[11px] text-gray-500">
            Labour hire: {short(p.labourHireInvoicedTotal)} invoiced vs {short(p.hireLabourEstimateTotal)} estimated from the board - a check only, the invoices are what count.
          </p>
        )}
      </Card>

      {hvb && hvb.state !== "NO_LOGS" && (
        <Card className="mb-4">
          <div className="mb-1 text-sm font-semibold text-gray-100">Labour hours vs budget</div>
          <div className="mb-2 text-[11px] text-gray-500">From the supervisors&apos; daily logs, per activity code, against the approved budget and the weekly % complete · hours only</div>
          <HoursVsBudget data={hvb} />
        </Card>
      )}

      {invoiceFor && !director && (
        <InvoiceModal projectId={p.id} projectName={p.name} hireItems={p.hireItems} invoice={invoiceFor.invoice} canDelete={isAdmin}
          onClose={() => setInvoiceFor(null)} onSaved={() => load()} />
      )}
    </PageShell>
  );
}

function InvoiceList({ rows, onEdit }: { rows: InvoicedCostDTO[]; onEdit?: (i: InvoicedCostDTO) => void }) {
  if (!rows.length) return <p className="text-sm text-gray-500">No supplier invoices on this job yet.</p>;
  return (
    <div className="divide-y divide-edge">
      {rows.map((i) => (
        <button key={i.id} onClick={onEdit ? () => onEdit(i) : undefined} disabled={!onEdit} title={i.notes ?? undefined} className={`flex w-full items-center gap-3 py-1.5 text-left text-sm ${onEdit ? "hover:bg-panel2" : "cursor-default"}`}>
          <span className="w-14 shrink-0 text-[11px] text-gray-500">{day(i.weekEnding)}</span>
          <span className="min-w-0 flex-1 truncate text-gray-200">{i.vendor}{i.invoiceNo && <span className="text-gray-500"> #{i.invoiceNo}</span>}</span>
          <span className="hidden shrink-0 text-[11px] text-gray-500 sm:inline">{CAT_LABELS.find((c) => c.key === INVOICE_CAT[i.category])?.label ?? "Other"}</span>
          <span className="w-24 shrink-0 text-right font-medium tabular-nums text-gray-100">{money(i.amountExGst)}</span>
        </button>
      ))}
    </div>
  );
}

// The records behind one cost type.
function Behind({ p, cat, isAdmin, onEdit }: { p: ProjectCostDTO; cat: CostCatKey; isAdmin: boolean; onEdit?: (i: InvoicedCostDTO) => void }) {
  const label = CAT_LABELS.find((c) => c.key === cat)?.label ?? cat;
  const invoices = p.invoiced.filter((i) => (INVOICE_CAT[i.category] ?? "materials") === cat).sort((a, b) => b.weekEnding.localeCompare(a.weekEnding));
  const byCodeKey = cat === "plant" || cat === "attach" || cat === "trucks" || cat === "hire" ? cat : null;
  const days = byCodeKey ? p.jobs.filter((j) => j.byCode[byCodeKey] > 0).sort((a, b) => b.date.localeCompare(a.date)) : [];
  return (
    <div className="mt-3 rounded-xl border border-edge bg-panel2/40 p-3">
      <div className="mb-2 text-xs font-semibold text-gray-300">Behind "{label}"</div>
      {cat === "ownCrew" && (isAdmin ? <People rows={p.labour} /> : <p className="text-xs text-gray-500">Wages per person are Admin-only. The total is pay rates × hours from the board.</p>)}
      {cat === "hire" && p.hireItems.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Hire register (estimate until invoiced)</div>
          {p.hireItems.map((h) => (
            <div key={h.id} className="flex flex-wrap items-baseline gap-x-2 py-1 text-sm">
              <span className="min-w-0 flex-1 truncate text-gray-200">{h.name}{h.supplier && <span className="text-gray-500"> · {h.supplier}</span>}</span>
              <span className="text-[11px] text-gray-500">{h.onHireDate ? day(h.onHireDate) : "?"} – {h.offHireDate ? day(h.offHireDate) : "no finish date"} · {h.daysToDate} days{h.daysInvoiced ? `, ${h.daysInvoiced} invoiced` : ""}</span>
              <span className="w-24 text-right tabular-nums text-gray-100">{h.costToDate != null ? money(h.costToDate) : <span className="text-amber-400">no rate</span>}</span>
            </div>
          ))}
        </div>
      )}
      {cat === "tipFees" && p.tipDockets.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Tip dockets from site (estimate until the tip invoice arrives)</div>
          {p.tipDockets.slice(0, 60).map((t) => (
            <div key={t.id} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-sm">
              <span className="w-14 text-[11px] text-gray-500">{day(t.day)}</span>
              <span className="min-w-0 flex-1 truncate text-gray-200">{t.tipSite ?? "Tip"}{t.docketNo && <span className="text-gray-500"> #{t.docketNo}</span>}{t.asbestos && <span className="text-red-300"> · asbestos</span>}</span>
              <span className="text-[11px] text-gray-500">{[t.wasteType, t.tonnes != null && `${t.tonnes} t`].filter(Boolean).join(" · ")}</span>
              <span className="w-28 text-right tabular-nums text-gray-100">
                {t.billed ? <span className="text-gray-500">on an invoice</span> : t.amount != null ? <>{money(t.amount)}{t.basis === "RATE" && <span className="text-[10px] text-gray-500"> rate</span>}</> : <span className="text-amber-400">no tip rate</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {invoices.length > 0 && (<><div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Invoices</div><InvoiceList rows={invoices} onEdit={onEdit} /></>)}
      {days.length > 0 && (
        <div>
          <div className="mb-1 mt-2 text-[11px] uppercase tracking-wide text-gray-500">Days on the board</div>
          {days.slice(0, 40).map((j) => (
            <div key={j.id} className="flex items-baseline gap-3 py-0.5 text-sm">
              <span className="w-14 text-[11px] text-gray-500">{day(j.date)}</span>
              <span className="min-w-0 flex-1 truncate text-gray-300">{j.title}</span>
              <span className="w-24 text-right tabular-nums text-gray-100">{money(byCodeKey ? j.byCode[byCodeKey] : 0)}</span>
            </div>
          ))}
        </div>
      )}
      {cat !== "ownCrew" && !invoices.length && !days.length && !(cat === "hire" && p.hireItems.length) && !(cat === "tipFees" && p.tipDockets.length) && <p className="text-xs text-gray-500">No records.</p>}
    </div>
  );
}

function People({ rows }: { rows: ProjectCostDTO["labour"] }) {
  const map = new Map<string, { hours: number; cost: number; shifts: number }>();
  for (const l of rows) {
    const r = map.get(l.personName) ?? { hours: 0, cost: 0, shifts: 0 };
    r.hours += l.hours ?? 0; r.cost += l.cost ?? 0; r.shifts += 1;
    map.set(l.personName, r);
  }
  const list = [...map.entries()].sort((a, b) => b[1].cost - a[1].cost);
  return (
    <div className="divide-y divide-edge">
      {list.map(([name, r]) => (
        <div key={name} className="flex items-baseline gap-3 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate text-gray-200">{name}</span>
          <span className="text-[11px] text-gray-500">{r.shifts} shift{r.shifts === 1 ? "" : "s"} · {r.hours.toFixed(1)}h</span>
          <span className="w-24 text-right tabular-nums text-gray-100">{r.cost > 0 ? money(r.cost) : <span className="text-amber-400">TBC</span>}</span>
        </div>
      ))}
    </div>
  );
}
