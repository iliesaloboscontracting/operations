"use client";

// Accounts -> Labour cost (stage 3, docs/accounts/STAGE3-DESIGN.md): own-crew labour per job and per week -
// the same figures Tracking shows (hours x pay rate) - plus super, workers comp, payroll tax and any other
// on-cost line, using the rates an Admin entered with an effective date. A line with no rate is "not set".
// Accounts screen only; Tracking's numbers don't change.
import { Fragment, useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { Group } from "@/lib/oncosts/rules";

type View = { from: string; to: string; lines: { line: string; label: string }[]; notSet: string[]; total: Group | null; byJob: Group[]; byWeek: Group[]; people: Group[]; noEngagement: string[] };
type InForce = { percent: number; base: string; appliesTo: string; thresholdRule: string | null; thresholdAnnual: number | null; effectiveFrom: string } | null;
type Rates = {
  lines: { line: string; label: string; inForce: InForce; defaults: { base: string; appliesTo: string } | null }[];
  history: { id: string; line: string; label: string; percent: number; base: string; appliesTo: string; thresholdRule: string | null; thresholdAnnual: number | null; effectiveFrom: string; note: string | null; setBy: string; setAt: string; retiredAt: string | null; retiredBy: string | null; retiredReason: string | null }[];
};
const money = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }));
const BASE: Record<string, string> = { PAID: "of paid", PAID_PLUS_SUPER: "of paid + super" };
const WHO: Record<string, string> = { EMPLOYEE: "employees (not ABN)", ALL: "everyone" };
const btn = "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const field = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200";

function Table({ title, rows, lines, onPick, picked }: { title: string; rows: Group[]; lines: View["lines"]; onPick?: (k: string) => void; picked?: string | null }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
      <table className="w-full min-w-[820px] text-xs">
        <thead><tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-gray-500">
          <th className="px-2 py-1.5">{title}</th><th className="px-2 py-1.5 text-right">People</th><th className="px-2 py-1.5 text-right">Paid (hours x rate)</th>
          {lines.map((l) => <th key={l.line} className="px-2 py-1.5 text-right">{l.label}</th>)}
          <th className="px-2 py-1.5 text-right">On-costs</th><th className="px-2 py-1.5 text-right">Company cost</th><th className="px-2 py-1.5"></th>
        </tr></thead>
        <tbody className="divide-y divide-edge/60">
          {rows.map((g) => (
            <tr key={g.key} className={`${onPick ? "cursor-pointer hover:bg-panel2" : ""} ${picked === g.key ? "bg-panel2" : ""}`} onClick={() => onPick?.(g.key)}>
              <td className="px-2 py-1.5 text-gray-100">{g.label}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">{g.people}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-200">{money(g.paid)}</td>
              {lines.map((l) => <td key={l.line} className="px-2 py-1.5 text-right tabular-nums text-gray-300">{g.lines[l.line] != null ? money(g.lines[l.line]) : <span className="text-gray-600">{g.paid === 0 && g.uncosted ? "-" : "not set"}</span>}</td>)}
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-200">{money(g.onCosts)}</td>
              <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-gray-100">{money(g.companyCost)}</td>
              <td className="px-2 py-1.5 text-amber-300">{[g.incomplete && "incomplete", g.uncosted && `${g.uncosted} uncosted`].filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LabourCostPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [view, setView] = useState<View | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"job" | "week">("job");
  const [form, setForm] = useState({ line: "SUPER", label: "", percent: "", base: "PAID", appliesTo: "EMPLOYEE", thresholdRule: "FLAT", thresholdAnnual: "", effectiveFrom: "", note: "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}), ...(job ? { project: job } : {}) });
    setView(null);
    apiFetch(`/api/accounts/labour-cost?${q}`).then(async (r) => (r.ok ? (setError(null), setView(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load."))));
    apiFetch("/api/accounts/oncost-rates").then(async (r) => r.ok && setRates(await r.json()));
  }, [range, job]);
  useEffect(() => { load(); }, [load]);

  function pickLine(line: string) {
    const d = rates?.lines.find((l) => l.line === line)?.defaults;
    setForm({ ...form, line, base: d?.base ?? form.base, appliesTo: d?.appliesTo ?? form.appliesTo });
  }
  async function saveRate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await apiFetch("/api/accounts/oncost-rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save."));
    setEditing(false); load();
  }
  async function retire(id: string) {
    const reason = prompt("Why is this rate being retired? (It stays in the history.)");
    if (!reason) return;
    const r = await apiFetch(`/api/accounts/oncost-rates/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't retire."));
    load();
  }

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Labour cost"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  const jobName = view?.byJob.find((g) => g.key === job)?.label;

  return (
    <PageShell title="Labour cost" subtitle="Own-crew labour per job and week - the same hours x pay rate Tracking shows - plus the on-costs (super, workers comp, payroll tax). Accounts only; Tracking's numbers don't change.">
      {error && <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}

      <section className="mb-4 rounded-xl border border-edge bg-panel p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-100">On-cost rates</span>
          {isAdmin && <button className={quiet} onClick={() => setEditing(!editing)}>{editing ? "Close" : "Enter a rate"}</button>}
        </div>
        <div className="grid gap-2 text-xs md:grid-cols-3">
          {rates?.lines.map((l) => (
            <div key={l.line} className="rounded-lg border border-edge/70 px-2.5 py-2">
              <div className="font-semibold text-gray-200">{l.label}</div>
              {l.inForce ? (
                <div className="text-gray-300">{l.inForce.percent}% {BASE[l.inForce.base]}, {WHO[l.inForce.appliesTo]}{l.inForce.thresholdRule === "ABOVE_THRESHOLD" ? `, above ${money(l.inForce.thresholdAnnual)} a year` : l.line === "PAYROLL_TAX" ? ", flat" : ""}<div className="text-gray-500">from {l.inForce.effectiveFrom}</div></div>
              ) : <div className="text-amber-300">Not set - to be entered by an Admin</div>}
            </div>
          ))}
        </div>
        {editing && (
          <form onSubmit={saveRate} className="mt-3 flex flex-wrap items-end gap-2 text-xs">
            <select className={field} value={form.line.startsWith("OTHER") ? "OTHER" : form.line} onChange={(e) => pickLine(e.target.value)}>
              <option value="SUPER">Super</option><option value="WORKERS_COMP">Workers comp</option><option value="PAYROLL_TAX">Payroll tax</option><option value="OTHER">Other on-cost…</option>
            </select>
            {form.line === "OTHER" && <input className={field} required placeholder="Name of the on-cost" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />}
            <input className={`${field} w-24`} required inputMode="decimal" placeholder="%" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
            <select className={field} value={form.base} disabled={form.line === "SUPER"} onChange={(e) => setForm({ ...form, base: e.target.value })}><option value="PAID">of paid</option><option value="PAID_PLUS_SUPER">of paid + super</option></select>
            <select className={field} value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}><option value="EMPLOYEE">employees (not ABN)</option><option value="ALL">everyone</option></select>
            {form.line === "PAYROLL_TAX" && (
              <>
                <select className={field} value={form.thresholdRule} onChange={(e) => setForm({ ...form, thresholdRule: e.target.value })}><option value="FLAT">flat on all wages</option><option value="ABOVE_THRESHOLD">only above the annual threshold</option></select>
                {form.thresholdRule === "ABOVE_THRESHOLD" && <input className={`${field} w-32`} required inputMode="decimal" placeholder="Annual threshold" value={form.thresholdAnnual} onChange={(e) => setForm({ ...form, thresholdAnnual: e.target.value })} />}
              </>
            )}
            <label className="text-gray-400">From <input className={field} required type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
            <input className={`${field} w-56`} placeholder="Note (e.g. source)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <button className={btn} disabled={busy}>Save rate</button>
          </form>
        )}
        {!!rates?.history.length && (
          <details className="mt-2 text-xs text-gray-400">
            <summary className="cursor-pointer">History ({rates.history.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {rates.history.map((h) => (
                <li key={h.id} className={h.retiredAt ? "text-gray-600 line-through" : ""}>
                  {h.label}: {h.percent}% {BASE[h.base]}, {WHO[h.appliesTo]} from {h.effectiveFrom} - {h.setBy}{h.note ? ` (${h.note})` : ""}
                  {h.retiredAt ? <span className="no-underline"> · retired by {h.retiredBy}: {h.retiredReason}</span> : isAdmin && <button className="ml-2 text-sky-400" onClick={() => retire(h.id)}>Retire</button>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <label className="text-gray-400">From <input className={field} type="date" value={range.from || view?.from || ""} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="text-gray-400">To <input className={field} type="date" value={range.to || view?.to || ""} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
        <div className="ml-2 flex gap-1">
          {(["job", "week"] as const).map((t) => <button key={t} className={tab === t ? btn : quiet} onClick={() => setTab(t)}>{t === "job" ? "By job" : "By week"}</button>)}
        </div>
      </div>

      {!view ? <p className="py-8 text-center text-sm text-gray-500">{error ? "" : "Loading..."}</p> : (
        <>
          {view.notSet.length > 0 && <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Not set yet: {view.notSet.join(", ")}. Company cost is incomplete until an Admin enters them.</p>}
          {view.noEngagement.length > 0 && <p className="mb-2 text-xs text-gray-500">Engagement (Employee / ABN) isn&apos;t set for {view.noEngagement.length} {view.noEngagement.length === 1 ? "person" : "people"} - counted as employees (with super): {view.noEngagement.join(", ")}.</p>}
          {view.total && (
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              <div><div className="text-xs text-gray-500">Paid (hours x rate)</div><div className="font-semibold text-gray-100">{money(view.total.paid)}</div></div>
              <div><div className="text-xs text-gray-500">On-costs</div><div className="font-semibold text-gray-100">{money(view.total.onCosts)}</div></div>
              <div><div className="text-xs text-gray-500">Company cost</div><div className="font-semibold text-gray-100">{money(view.total.companyCost)}</div></div>
              {view.total.uncosted > 0 && <div><div className="text-xs text-gray-500">Uncosted lines</div><div className="font-semibold text-amber-300">{view.total.uncosted}</div></div>}
            </div>
          )}
          {tab === "job" ? (
            <Fragment>
              <Table title="Job" rows={view.byJob} lines={view.lines} onPick={(k) => setJob(job === k ? null : k)} picked={job} />
              {job && (
                <section className="mt-3">
                  <div className="mb-1 text-sm font-semibold text-gray-100">{jobName} - people</div>
                  <Table title="Person" rows={view.people} lines={view.lines} />
                </section>
              )}
            </Fragment>
          ) : <Table title="Week" rows={view.byWeek} lines={view.lines} />}
          <p className="mt-3 text-xs text-gray-500">Labour hire isn&apos;t included (the agency invoice has its own on-costs), nor salaried staff (excluded on Tracking too). Uncosted lines (no pay rate or hours) are counted, not added as $0.</p>
        </>
      )}
    </PageShell>
  );
}
