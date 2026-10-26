"use client";

// Accounts -> Tax estimates (stage 7, docs/accounts/STAGE7-DESIGN.md): payroll tax per month and the financial
// year to date (Xero P&L wages x stage 3's payroll tax rate), and BAS GST per period (Xero invoices and bills).
// ESTIMATES - Xero and the accountant are the record. Due dates go onto the existing calendar.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

const money = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }));
const btn = "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const field = "rounded-lg border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200";
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function Calendar({ c, kind, periodKey, onAct, busy }: { c: Any; kind: "BAS" | "PAYROLL_TAX"; periodKey: string; onAct: (b: Record<string, unknown>, done: string) => void; busy: boolean }) {
  if (!c) return <button className={quiet} disabled={busy} onClick={() => onAct({ action: "CALENDAR", kind, periodKey }, "Added to the calendar.")}>Add to calendar</button>;
  return (
    <span className="text-gray-400">
      On the calendar{c.amount != null ? `, expected ${money(c.amount)}` : ""}{" "}
      <button className="text-sky-400 hover:underline" disabled={busy} onClick={() => onAct({ action: "USE_ESTIMATE", kind, periodKey, itemId: c.id }, "Expected amount set from the estimate.")}>use estimate</button>
    </span>
  );
}

export default function TaxPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [fy, setFy] = useState<number | null>(null);
  const [v, setV] = useState<Any>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const load = useCallback(() => {
    apiFetch(`/api/accounts/tax${fy ? `?fy=${fy}` : ""}`).then(async (r) => (r.ok ? (setError(null), setV(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load."))));
  }, [fy]);
  useEffect(() => { load(); }, [load]);
  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(null); setFlash(null);
    const r = await apiFetch("/api/accounts/tax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save."));
    setFlash(done); load();
  }

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Tax estimates"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  const src = (s: Any, what: string) => (s ? `${what}: Xero ${s.source === "API" ? "connection" : "upload"}, as at ${s.asAt ?? s.at.slice(0, 10)}` : `${what}: not in Operations yet`);

  return (
    <PageShell title="Tax estimates" subtitle="Payroll tax and BAS worked out from the Xero data Operations already reads. Estimates only - Xero and the accountant are the record.">
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {!v ? <p className="py-8 text-center text-sm text-gray-500">{error ? "" : "Loading..."}</p> : (
        <>
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{v.note}</div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <button className={quiet} onClick={() => setFy(v.fy - 1)}>← {v.fy - 1}-{String(v.fy % 100).padStart(2, "0")}</button>
            <span className="text-sm font-semibold text-gray-100">Financial year {v.fyLabel}</span>
            <button className={quiet} onClick={() => setFy(v.fy + 1)}>{v.fy + 1}-{String((v.fy + 2) % 100).padStart(2, "0")} →</button>
            <span className="text-gray-500">{[src(v.sources.invoices, "Sales"), src(v.sources.bills, "Bills"), src(v.sources.pnl, "P&L")].join(" · ")}</span>
          </div>

          <section className="mb-5 rounded-xl border border-edge bg-panel p-3 text-xs">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-gray-100">Payroll tax</span>
              <span className="text-gray-400">{v.rateSet ? `Year to date (estimate): ${money(v.payroll.ytdTax)}${v.payroll.reconciliation != null ? ` · annual reconciliation check: ${money(v.payroll.reconciliation)}` : ""}` : ""}</span>
            </div>
            {!v.rateSet && <p className="mb-2 text-amber-300">Not set - the payroll tax rate is entered by an Admin on <Link className="underline" href="/accounts/labour-cost">Labour cost</Link> (one rate for job costing and this estimate).</p>}
            {v.payroll.rows.length === 0 ? <p className="text-gray-500">No P&L wages for this year in Operations yet.</p> : (
              <table className="w-full max-w-4xl">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500"><th className="py-1">Month</th><th className="text-right">Wages</th><th className="text-right">Super</th><th className="text-right">Base</th><th className="text-right">Tax (est.)</th><th className="pl-3">Due</th><th className="text-right">Own crew on the board</th><th className="pl-3">Calendar</th></tr></thead>
                <tbody>
                  {v.payroll.rows.map((r: Any) => (
                    <tr key={r.month} className="tabular-nums">
                      <td className="py-0.5 text-gray-200">{monthName(r.month)}</td>
                      <td className="text-right text-gray-300">{money(r.wages)}</td><td className="text-right text-gray-300">{money(r.super)}</td><td className="text-right text-gray-200">{money(r.base)}</td>
                      <td className="text-right font-semibold text-gray-100">{r.tax == null ? <span className="font-normal text-gray-500">not set</span> : money(r.tax)}</td>
                      <td className="pl-3 text-gray-400">{r.due} <span className="text-gray-600">({r.dueWhat})</span></td>
                      <td className="text-right text-gray-500">{money(r.ownCrew)}</td>
                      <td className="pl-3"><Calendar c={r.calendar} kind="PAYROLL_TAX" periodKey={r.month} onAct={act} busy={busy} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-gray-500">Wages are from the Xero P&L accounts marked below (everyone on the payroll, incl. salaries and leave) - what the return is based on. &ldquo;Own crew on the board&rdquo; is stage 3&apos;s job-costing figure, for comparison only. Contractor payments treated as wages aren&apos;t included.</p>
            <button className="mt-1 text-sky-400 hover:underline" onClick={() => setShowAccounts(!showAccounts)}>{showAccounts ? "Hide" : "Check"} which P&L accounts count as wages ({v.accounts.filter((a: Any) => a.class !== "NONE").length} counted)</button>
            {showAccounts && (
              <div className="mt-2 grid gap-1 md:grid-cols-2">
                {v.accounts.map((a: Any) => (
                  <label key={a.account} className="flex items-center justify-between gap-2 rounded border border-edge/60 px-2 py-1">
                    <span className="text-gray-300">{a.account} <span className="text-gray-600">· {a.section}{a.saved ? "" : " · suggested"}</span></span>
                    <select className={field} value={a.class} disabled={busy} onChange={(e) => act({ action: "SETTING", key: "PAYROLL_ACCOUNTS", value: { [a.account]: e.target.value } }, "Saved.")}>
                      <option value="WAGES">Wages</option><option value="SUPER">Super</option><option value="NONE">Not wages</option>
                    </select>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="mb-5 rounded-xl border border-edge bg-panel p-3 text-xs">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-100">BAS - GST (accrual, by invoice date)</span>
              <span className="flex flex-wrap gap-2 text-gray-400">
                <label>Frequency <select className={field} value={v.settings.BAS_FREQUENCY} disabled={busy} onChange={(e) => act({ action: "SETTING", key: "BAS_FREQUENCY", value: e.target.value }, "Saved.")}><option value="QUARTERLY">Quarterly</option><option value="MONTHLY">Monthly</option></select></label>
                <label>Lodged by <select className={field} value={v.settings.LODGEMENT} disabled={busy} onChange={(e) => act({ action: "SETTING", key: "LODGEMENT", value: e.target.value }, "Saved.")}><option value="SELF">Lobos</option><option value="AGENT">The accountant (agent dates)</option></select></label>
              </span>
            </div>
            {v.bas.length === 0 ? <p className="text-gray-500">No periods yet this year.</p> : (
              <table className="w-full max-w-4xl">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500"><th className="py-1">Period</th><th className="text-right">GST collected</th><th className="text-right">GST paid</th><th className="text-right">Net (est.)</th><th className="pl-3">Due</th><th className="pl-3">Calendar</th></tr></thead>
                <tbody>
                  {v.bas.map((p: Any) => (
                    <tr key={p.key} className="tabular-nums align-top">
                      <td className="py-0.5 text-gray-200">{p.label}{p.open ? <span className="text-gray-500"> (so far)</span> : ""}{p.gst.noGst ? <div className="text-amber-300">{p.gst.noGst} invoice(s) with no GST amount in Xero&apos;s data</div> : null}</td>
                      <td className="text-right text-gray-300">{money(p.gst.collected)}</td><td className="text-right text-gray-300">{money(p.gst.paid)}</td>
                      <td className="text-right font-semibold text-gray-100">{p.gst.net < 0 ? `refund ${money(-p.gst.net)}` : money(p.gst.net)}</td>
                      <td className="pl-3 text-gray-400">{p.due}{v.settings.LODGEMENT === "AGENT" ? <span className="text-gray-600"> (check with the accountant)</span> : null}</td>
                      <td className="pl-3"><Calendar c={p.calendar} kind="BAS" periodKey={p.key} onAct={act} busy={busy} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-gray-500">GST on sales invoices less credit notes, minus GST on bills less supplier credits, by invoice date. Voided and draft invoices don&apos;t count. {v.paygNote}</p>
          </section>
          <p className="text-xs text-gray-500">Due dates are draft defaults for Victoria to confirm. The calendar is the <Link className="underline" href="/accounts/calendar">Due dates</Link> page - nothing is added twice.</p>
        </>
      )}
    </PageShell>
  );
}
