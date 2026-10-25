"use client";

// One budget from Estimating, for a director to approve or reject (Task H,
// 25 Oct 2026). Reads the frozen budget.v1 revision: the price (build-up vs
// submitted, with the adjustment reason), totals by cost category, packages
// by activity code (with how the site will report each - site_report),
// hours per category and the assumptions it was priced on - hours per day
// above all. Approve / Reject goes to Estimating through the Operations
// server; the person who submitted it can't decide it.
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/tracking/parts";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { BUDGET_CATEGORIES, SITE_REPORT, hoursByCategory, type BudgetStatus, type BudgetV1 } from "@/lib/budgets/rules";
import { BudgetStatusPill, adjustmentText, aud, hrs } from "@/components/directors/BudgetParts";

interface Detail {
  budget: BudgetV1;
  status: BudgetStatus;
  integrity: "ok" | "MISMATCH";
  cannotDecide: string | null;
  log: { decision: string; reason: string | null; by: string; outcome: string; message: string | null; at: string }[];
}

const day = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function BudgetPage({ params }: { params: Promise<{ id: string; rev: string }> }) {
  const { id, rev } = use(params);
  const { isDirector, loading } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch(`/api/directors/budgets/${encodeURIComponent(id)}/${encodeURIComponent(rev)}`)
      .then(async (r) => (r.ok ? setD(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load the budget."))))
      .catch(() => setError("Couldn't load the budget."));
  }, [id, rev]);
  useEffect(() => {
    if (!loading && isDirector) load();
  }, [loading, isDirector, load]);

  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="Budget">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }
  if (error || !d) {
    return (
      <PageShell title="Budget">
        <Back />
        <p className={`py-10 text-center text-sm ${error ? "text-red-400" : "text-gray-500"}`}>{error ?? "Loading..."}</p>
      </PageShell>
    );
  }

  const b = d.budget;
  return (
    <PageShell
      title={`${b.quoteNo} · ${b.estimate_name || "Untitled estimate"}`}
      subtitle={`Revision ${b.revision}${b.supersedes_revision ? ` (replaces ${b.supersedes_revision})` : ""} · ${b.client || "No client"}${b.location ? ` · ${b.location}` : ""} · ex GST`}
    >
      <Back />
      <div className="max-w-5xl space-y-4">
        {d.integrity !== "ok" && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            <ShieldAlert size={18} className="mt-0.5 shrink-0" />
            This budget file has changed since it was submitted (its fingerprint doesn&apos;t match). Don&apos;t approve it - ask the estimator to submit it again.
          </div>
        )}
        <Header b={b} status={d.status} />
        <Decide d={d} id={id} rev={rev} onDone={load} />
        <Price b={b} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Categories b={b} />
          <Assumptions b={b} />
        </div>
        <Packages b={b} />
        <Hours b={b} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Prelims b={b} />
          <Risk b={b} />
        </div>
        <History status={d.status} log={d.log} />
      </div>
    </PageShell>
  );
}

function Back() {
  return (
    <Link href="/directors/budgets" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200">
      <ArrowLeft size={14} /> All budgets
    </Link>
  );
}

function H({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-gray-100">{children}</h2>
      {note && <span className="text-[11px] text-gray-500">{note}</span>}
    </div>
  );
}

function Header({ b, status }: { b: BudgetV1; status: BudgetStatus }) {
  const items: [string, React.ReactNode][] = [
    ["Status", <BudgetStatusPill key="s" status={status.status} />],
    ["Submitted", `${b.submitted_by} · ${day(b.submitted_at.date)}`],
    ["Estimator", b.estimator || "—"],
    ["Maturity", b.maturity],
    ["Quote", `${b.quoteNo}${b.quote_source === "not-from-register" ? " (not from the tender register)" : ""}`],
    ["Job number", b.jobNo || "Not set yet"],
    ["Programme", `${b.programme.duration_days} working days (${b.programme.weeks} weeks)`],
    ["Activity codes", b.activity_codes_version],
  ];
  return (
    <Card>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{k}</dt>
            <dd className="mt-0.5 truncate text-gray-200">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Price({ b }: { b: BudgetV1 }) {
  const p = b.price_adjustment;
  return (
    <Card>
      <H>Price</H>
      <div className="grid gap-4 sm:grid-cols-3">
        <Fig label="Submitted price" value={aud(p.submitted_price)} sub={`set by ${p.set_by || b.submitted_by}`} />
        <Fig label="Build-up (calculated)" value={aud(p.build_up_total)} sub={`direct ${aud(b.totals.direct_cost)} + overheads ${b.overheads.pct}% + profit ${b.profit.pct}%`} />
        <Fig label="Adjustment" value={Math.abs(p.adjustment) < 0.5 ? "None" : `${p.adjustment > 0 ? "+" : "-"}${aud(Math.abs(p.adjustment))}`} sub={adjustmentText(p.build_up_total, p.submitted_price)} />
      </div>
      {Math.abs(p.adjustment) >= 0.5 && (
        <p className="mt-3 rounded-lg bg-panel2 p-2 text-sm text-gray-300"><span className="text-gray-500">Reason for the adjustment:</span> {p.reason || "None given"}</p>
      )}
      <p className="mt-2 text-[11px] text-gray-500">GST {b.assumptions.gst_pct}% on the build-up: {aud(b.totals.gst)} · build-up inc GST {aud(b.totals.total_inc_gst)}</p>
    </Card>
  );
}

function Fig({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight text-gray-100">{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  );
}

function Categories({ b }: { b: BudgetV1 }) {
  const rows = Object.entries(b.totals.by_category).filter(([c, v]) => c !== "19" && Math.abs(v) >= 0.5).sort(([a], [c]) => a.localeCompare(c));
  const total = b.totals.calculated_total;
  return (
    <Card>
      <H note="Build-up, before any price adjustment">Totals by cost category</H>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-edge">
          {rows.map(([c, v]) => (
            <tr key={c}>
              <td className="py-1.5 text-gray-400">{c} {BUDGET_CATEGORIES[c] ?? ""}</td>
              <td className="py-1.5 text-right text-gray-500">{total > 0 ? `${Math.round((v / total) * 100)}%` : ""}</td>
              <td className="py-1.5 text-right font-medium text-gray-200">{aud(v)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-semibold text-gray-100" colSpan={2}>Build-up total</td>
            <td className="pt-2 text-right font-semibold text-gray-100">{aud(total)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function Assumptions({ b }: { b: BudgetV1 }) {
  const a = b.assumptions;
  const overrides = b.packages.filter((p) => p.priced && p.hours_per_day !== a.hours_per_day);
  return (
    <Card>
      <H>Assumptions it was priced on</H>
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">Shift length</div>
        <div className="text-2xl font-semibold text-gray-100">{a.hours_per_day} hours a day</div>
        <div className="text-[12px] text-gray-400">
          Every hour, day and production rate below assumes this.
          {overrides.length > 0 && ` ${overrides.length} package${overrides.length === 1 ? " uses" : "s use"} a different shift: ${overrides.map((p) => `${p.code ?? p.local_code} ${p.hours_per_day} h`).join(", ")}.`}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Pair k="Working days a week" v={a.days_per_week} />
        <Pair k="Preliminaries run for" v={`${a.prelim_weeks} weeks`} />
        <Pair k="GST" v={`${a.gst_pct}%`} />
        <Pair k="Prices" v={`${a.currency}, ${a.prices_ex_gst ? "ex GST" : "inc GST"}`} />
      </dl>
    </Card>
  );
}

function Pair({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-500">{k}</dt>
      <dd className="text-gray-200">{v}</dd>
    </div>
  );
}

function Packages({ b }: { b: BudgetV1 }) {
  const priced = b.packages.filter((p) => p.priced);
  const other = b.packages.filter((p) => !p.priced);
  return (
    <Card className="overflow-x-auto">
      <H note="Site reports = how the supervisor records progress for that code">Work packages by activity code</H>
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
            <th className="py-1.5 pr-2 font-semibold">Code</th>
            <th className="py-1.5 pr-2 font-semibold">Package</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Quantity</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Per day</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Days</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Labour</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Plant</th>
            <th className="py-1.5 pr-2 text-right font-semibold">Trucks</th>
            <th className="py-1.5 pr-2 font-semibold">Site reports</th>
            <th className="py-1.5 text-right font-semibold">Direct cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {priced.map((p) => (
            <tr key={p.package_id} className="align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap font-medium text-gray-200" title={p.code_name ?? undefined}>{p.code ?? "—"}</td>
              <td className="py-1.5 pr-2 text-gray-300">
                {p.local_code && <span className="text-gray-500">{p.local_code} </span>}{p.name || "Untitled"}
                {p.code_name && <div className="text-[11px] text-gray-500">{p.code_name}{p.cls !== "INCLUDED" ? ` · ${p.cls.toLowerCase()}` : ""}</div>}
              </td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-right text-gray-300">{p.qty.toLocaleString("en-AU")} {p.unit}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-right text-gray-300" title={p.production_basis || undefined}>{p.production_per_day ? `${p.production_per_day.toLocaleString("en-AU")} ${p.unit}` : "—"}</td>
              <td className="py-1.5 pr-2 text-right text-gray-300">{p.duration_days || "—"}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-right text-gray-300">{hrs(p.hours?.labour_hrs)}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-right text-gray-300">{hrs(p.hours?.plant_hrs)}</td>
              <td className="py-1.5 pr-2 whitespace-nowrap text-right text-gray-300">{hrs(p.hours?.truck_hrs)}</td>
              <td className="py-1.5 pr-2 text-gray-300">{p.site_report ? SITE_REPORT[p.site_report] ?? p.site_report : "—"}</td>
              <td className="py-1.5 whitespace-nowrap text-right font-medium text-gray-200">{aud(p.direct_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {other.length > 0 && (
        <p className="mt-2 text-[12px] text-gray-500">
          Not priced: {other.map((p) => `${p.name || p.local_code} (${p.cls.toLowerCase()})`).join(", ")}
        </p>
      )}
    </Card>
  );
}

function Hours({ b }: { b: BudgetV1 }) {
  const byCat = Object.entries(hoursByCategory(b.packages)).sort(([a], [c]) => a.localeCompare(c));
  const days = (h: number) => (b.assumptions.hours_per_day > 0 ? Math.round((h / b.assumptions.hours_per_day) * 10) / 10 : null);
  return (
    <Card>
      <H note={`Days at ${b.assumptions.hours_per_day} hours each`}>Hours per category</H>
      {!byCat.length ? (
        <p className="text-sm text-gray-500">No time-based lines in this budget.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {byCat.map(([c, h]) => (
            <Fig key={c} label={`${c} ${BUDGET_CATEGORIES[c] ?? ""}`} value={hrs(h)} sub={days(h) !== null ? `${days(h)} ${c === "01" ? "person" : "machine"} days` : undefined} />
          ))}
        </div>
      )}
    </Card>
  );
}

function Prelims({ b }: { b: BudgetV1 }) {
  return (
    <Card>
      <H>Preliminaries</H>
      {!b.prelims.length ? <p className="text-sm text-gray-500">None.</p> : (
        <ul className="divide-y divide-edge text-sm">
          {b.prelims.map((p, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5">
              <span className="text-gray-300">{p.desc || "—"}<span className="text-gray-500">{p.type === "time" && p.weeks != null ? ` · ${p.weeks} weeks` : ""}</span></span>
              <span className="whitespace-nowrap font-medium text-gray-200">{aud(p.cost)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Risk({ b }: { b: BudgetV1 }) {
  const r = b.risk;
  return (
    <Card>
      <H note={`Contingency ${aud(r.contingency)} · provisional sums ${aud(r.provisional_sums)}`}>Risk allowances</H>
      {!r.items.length ? <p className="text-sm text-gray-500">No risks listed.</p> : (
        <ul className="divide-y divide-edge text-sm">
          {r.items.map((x, i) => (
            <li key={i} className="flex justify-between gap-3 py-1.5">
              <span className="text-gray-300">{x.risk || "—"}<span className="text-gray-500"> · {x.treatment || "not treated"}{x.treatment === "Contingency" ? ` (${x.probability_pct}% of ${aud(x.cost_impact)})` : ""}</span></span>
              <span className="whitespace-nowrap font-medium text-gray-200">{aud(x.allowance)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Decide({ d, id, rev, onDone }: { d: Detail; id: string; rev: string; onDone: () => void }) {
  const [mode, setMode] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (d.status.status !== "SUBMITTED") return null;
  if (d.cannotDecide) {
    return <Card><p className="text-sm text-gray-400">{d.cannotDecide}</p></Card>;
  }

  async function send() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/directors/budgets/${encodeURIComponent(id)}/${encodeURIComponent(rev)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: mode, reason, version: d.status.version }),
      });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't record the decision."));
      setMode(null);
      setReason("");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-amber-500/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-300">This budget is waiting for a director. Approving records it in Estimating as the approved budget for this tender.</p>
        {!mode && (
          <div className="flex gap-2">
            <button onClick={() => setMode("APPROVED")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Approve</button>
            <button onClick={() => setMode("REJECTED")} className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/10">Reject</button>
          </div>
        )}
      </div>
      {mode && (
        <div className="mt-3 space-y-2">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "REJECTED" ? "Why is it rejected? (the estimator sees this)" : "Note (optional)"}
            className="w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={busy || (mode === "REJECTED" && reason.trim().length < 3)}
              onClick={send}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ${mode === "APPROVED" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"}`}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {mode === "APPROVED" ? `Approve ${aud(d.budget.price_adjustment.submitted_price)}` : "Reject budget"}
            </button>
            <button disabled={busy} onClick={() => { setMode(null); setError(null); }} className="rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </Card>
  );
}

function History({ status, log }: { status: BudgetStatus; log: Detail["log"] }) {
  const tried = log.filter((l) => l.outcome !== "RECORDED");
  return (
    <Card>
      <H>History</H>
      <ul className="space-y-1 text-sm">
        {[...status.history].reverse().map((h, i) => (
          <li key={i} className="text-gray-300">
            <span className="text-gray-500">{day(h.date)}</span> · {h.status.toLowerCase()} by {h.by}{h.reason ? ` - ${h.reason}` : ""}
          </li>
        ))}
      </ul>
      {tried.length > 0 && (
        <details className="mt-2 text-[12px] text-gray-500">
          <summary className="cursor-pointer">{tried.length} attempt{tried.length === 1 ? "" : "s"} that didn&apos;t go through</summary>
          <ul className="mt-1 space-y-0.5">
            {tried.map((l, i) => (
              <li key={i}>{new Date(l.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {l.by} tried to {l.decision === "APPROVED" ? "approve" : "reject"}: {l.message}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
