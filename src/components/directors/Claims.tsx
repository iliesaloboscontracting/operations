"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { short } from "@/lib/trackingView";
import { fmtDay } from "@/lib/dates";
import { moneyTip, tooltipStyle } from "@/components/tracking/parts";
import { ConfidenceBadge, DLink, Figure, Help, Section, pct } from "@/components/directors/parts";
import type { ClaimsOverviewDTO } from "@/lib/insights/claimsView";

// "Claimed (Xero)" on the Directors overview (30 Oct 2026, stages 1-3): the company's claims from the Xero sales mirror
// - by month (F15), per job (F14), against cost to date (F16) and the contract value (F17) - with how far to trust it.
// Director access only: the overview payload is behind guardDirector, and Tracking never carries any of this.

const BANDS = [
  { key: "tied", label: "Tied to a job", colour: "#4fb38a" },
  { key: "notTied", label: "Not tied yet", colour: "#e0a33c" },
  { key: "notAJob", label: "Not a job (deposits, recharges)", colour: "#7d848f" },
] as const;
const month = (ym: string) => fmtDay(`${ym}-01`, { month: "short", year: "2-digit" });
const signed = (n: number) => (n < 0 ? `-${short(-n)}` : short(n));

export function ClaimsSection({ c }: { c: ClaimsOverviewDTO | null }) {
  if (!c) {
    return (
      <Section title="Claimed (Xero)" kpi="F14" className="mb-4">
        <p className="text-sm text-gray-400">No Xero sales have been read yet. Once the Xero connection reads (or accounts upload a sales export), what each job has been invoiced shows here.</p>
        <DLink href="/directors/accounts" className="mt-2 inline-block text-xs text-brand-400 hover:underline">Accounts data</DLink>
      </Section>
    );
  }
  const data = c.months.map((m) => ({ label: `${month(m.month)}${m.partial ? " (so far)" : ""}${m.beforeMirror ? " (not in Xero)" : ""}`, tied: m.tied, notTied: m.notTied, notAJob: m.notAJob }));
  const names: Record<string, string> = Object.fromEntries(BANDS.map((b) => [b.key, b.label]));
  return (
    <Section title="Claimed (Xero)" kpi="F14" className="mb-4" right={<ConfidenceBadge level={c.confidence} why={c.confidenceWhy} />}>
      <p className="mb-3 text-[11px] text-gray-500">
        Xero sales from {c.from ? fmtDay(c.from, { day: "numeric", month: "short", year: "numeric" }) : "-"} · {c.sourceLabel}, read {c.readAtLabel} · ex GST · retention as invoiced · month = invoice date · drafts and invoices awaiting approval never count
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Claimed since the Xero start" value={short(c.totals.total)} sub="Sales less credit notes" />
        <Figure label="Tied to a job" value={pct(c.tiedShare)} sub={`${short(c.totals.tied)} (not counting "not a job")`} />
        <Figure label="Not tied yet" value={short(c.totals.notTied)} tone={c.notTiedInvoices ? "bad" : undefined} sub={`${c.notTiedInvoices} invoice${c.notTiedInvoices === 1 ? "" : "s"} for accounts to tie`} href="/directors/accounts" />
        <Figure label="Not a job" value={short(c.totals.notAJob)} sub="Deposits, recharges - never in a job" />
      </div>

      <div className="mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Claimed by month <Help id="F15" /></div>
      <div className="mt-1 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#898781" }} tickLine={false} axisLine={{ stroke: "#383835" }} interval="preserveStartEnd" tickFormatter={(l: string) => l.split(" (")[0]} />
            <YAxis tick={{ fontSize: 11, fill: "#898781" }} tickLine={false} axisLine={false} tickFormatter={(v) => short(v)} width={52} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={tooltipStyle} formatter={moneyTip(names)} />
            {BANDS.map((b, i) => <Bar key={b.key} dataKey={b.key} stackId="a" fill={b.colour} maxBarSize={28} radius={i === BANDS.length - 1 ? [4, 4, 0, 0] : undefined} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
        {BANDS.map((b) => <span key={b.key}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: b.colour }} />{b.label}</span>)}
        <span>Months before the Xero start aren&apos;t in Xero - not &quot;nothing claimed&quot;</span>
      </div>

      <div className="mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">By job · active, or on the board in the last 60 days <Help id="F16" /></div>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-gray-500">
              <th className="py-1.5 pr-2 font-semibold">Job</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Contract value</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Claimed</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Claimed less cost to date</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Left to claim <Help id="F17" /></th>
              <th className="py-1.5 font-semibold">Trust</th>
            </tr>
          </thead>
          <tbody>
            {c.jobs.map((j) => (
              <tr key={j.id} className="border-b border-edge/50">
                <td className="py-1.5 pr-2"><DLink href={`/directors/jobs/${j.id}`} className="text-gray-200 hover:underline">{j.name}</DLink>{j.jobNo && <span className="ml-1 text-[11px] text-gray-500">{j.jobNo}</span>}<div className="text-[11px] text-gray-500">{j.invoices ? `${j.invoices} invoice${j.invoices === 1 ? "" : "s"}${j.lastClaim ? ` · last ${fmtDay(j.lastClaim, { day: "numeric", month: "short" })}` : ""}` : "Nothing claimed in Xero yet"}</div></td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-300">{j.contractValue != null ? short(j.contractValue) : <span className="text-gray-500">None</span>}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-100">{short(j.claimed)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-gray-300">{signed(j.lessCost)}</td>
                <td className="py-1.5 pr-2 text-right text-gray-300">{j.over ? <span className="text-[12px] text-amber-300">{j.overText}</span> : j.noContract ? <span className="text-gray-500">No contract value</span> : <span className="tabular-nums">{short(j.leftToClaim)}</span>}</td>
                <td className="py-1.5"><ConfidenceBadge level={j.confidence} why={j.why} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.otherJobs !== 0 && <p className="mt-2 text-[11px] text-gray-500">Claimed on other jobs (completed or older, not in the table): {signed(c.otherJobs)}</p>}
      <p className="mt-2 text-[11px] text-gray-500">
        Claimed is what&apos;s been invoiced in Xero; cost to date is Project Tracking&apos;s. Claimed less cost is a timing difference (claims run ahead of or behind the work), not a result. Left to claim is against the Operations contract value - variations aren&apos;t in Operations. {c.drafts > 0 ? `${c.drafts} invoice${c.drafts === 1 ? "" : "s"} still draft or awaiting approval in Xero - not counted.` : ""}
      </p>
    </Section>
  );
}
