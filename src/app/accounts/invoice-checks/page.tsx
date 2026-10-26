"use client";

// Accounts -> Invoice checks (stage 4, docs/accounts/STAGE4-DESIGN.md): ABN workers' invoices against their
// supervisor-approved hours; supplier hire invoices against the hire register; invoice lines against the
// agreed rates in Estimating. Flags for Victoria to approve / query - nothing here changes a job cost.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";

type Tab = "abn" | "hire" | "rates";
type Review = { status: "OK" | "QUERY"; note: string | null; by: string } | null;
const money = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" }));
const btn = "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const field = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200";
const FLAG_TONE: Record<string, string> = { OVER: "text-red-300", NOT_APPROVED: "text-red-300", UNDER: "text-amber-300", NOT_INVOICED: "text-gray-500", OK: "text-emerald-400" };

function ReviewBadge({ r }: { r: Review }) {
  if (!r) return null;
  return <span className={r.status === "OK" ? "text-emerald-300" : "text-amber-300"}>{r.status === "OK" ? "Checked" : "Queried"} by {r.by}{r.note ? `: ${r.note}` : ""}</span>;
}

export default function InvoiceChecksPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("abn");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [loaded, setLoaded] = useState<{ tab: Tab; body: any } | null>(null);
  const data = loaded?.tab === tab ? loaded.body : null; // never draw one tab with another tab's data
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attach, setAttach] = useState<{ draftId: string; resourceId: string }>({ draftId: "", resourceId: "" });
  const load = useCallback(() => {
    apiFetch(`/api/accounts/invoice-checks?tab=${tab}`).then(async (r) => (r.ok ? (setError(null), setLoaded({ tab, body: await r.json() })) : setError(await serverErrorMessage(r, "Couldn't load."))));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>, done: string) {
    setBusy(true); setError(null); setFlash(null);
    const r = await apiFetch("/api/accounts/invoice-checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save."));
    setFlash(done); load();
  }
  const ask = (q: string) => prompt(q)?.trim() || null;
  const flagButtons = (subjectKind: "HIRE" | "RATE", subjectId: string, flag: string) => (
    <span className="ml-2 inline-flex gap-1">
      <button className={quiet} disabled={busy} onClick={() => post({ action: "FLAG", subjectKind, subjectId, flag, status: "OK", note: ask("Note (optional)") }, "Marked checked.")}>OK</button>
      <button className={quiet} disabled={busy} onClick={() => { const note = ask("What needs checking?"); if (note) post({ action: "FLAG", subjectKind, subjectId, flag, status: "QUERY", note }, "Queried."); }}>Query</button>
    </span>
  );

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Invoice checks"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;

  return (
    <PageShell title="Invoice checks" subtitle="ABN workers' invoices against their approved hours, hire invoices against the hire register, and invoice lines against the agreed rates. Flags to check - nothing here changes a job's cost.">
      <div className="mb-3 flex gap-1">
        {([["abn", "ABN invoices"], ["hire", "Hire"], ["rates", "Agreed rates"]] as const).map(([k, label]) => <button key={k} className={tab === k ? btn : quiet} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">{error ? "" : "Loading..."}</p> : tab === "abn" ? (
        <>
          {data.checks.length === 0 && <p className="mb-3 text-sm text-gray-500">No ABN invoices to check. They arrive from the invoices inbox when the supplier is someone marked ABN on the Labour register, or attach one below.</p>}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {data.checks.map((c: any) => (
            <section key={c.id} className="mb-4 rounded-xl border border-edge bg-panel p-3 text-xs">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold text-gray-100">{c.personName} <span className="font-normal text-gray-400">· {c.invoice.supplier}{c.invoice.invoiceNo ? ` · No. ${c.invoice.invoiceNo}` : ""} · {c.invoice.periodFrom} to {c.invoice.periodTo}{c.invoice.guessedPeriod ? " (period not on the invoice - the week before its date)" : ""}</span></div>
                <div className={c.status === "APPROVED" ? "text-emerald-300" : c.status === "QUERY" ? "text-amber-300" : "text-gray-400"}>{c.status === "TO_CHECK" ? "To check" : c.status === "APPROVED" ? `Approved by ${c.decidedBy}` : `Queried by ${c.decidedBy}: ${c.note}`}</div>
              </div>
              <div className="mb-2 text-gray-400">Invoice: {money(c.invoice.amountExGst)} ex GST · GST {money(c.invoice.gst)} · {money(c.invoice.totalIncGst)}{c.invoice.supplierAbn ? ` · ABN ${c.invoice.supplierAbn}` : ""} · {c.invoice.file}</div>
              {c.flags.map((f: string) => <div key={f} className="text-amber-300">{f}</div>)}
              <table className="mt-2 w-full max-w-xl">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500"><th className="py-1">Day</th><th className="text-right">Invoiced</th><th className="text-right">Approved</th><th className="text-right">Signed</th><th className="text-right">Diff</th><th></th></tr></thead>
                <tbody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {c.hours.rows.map((r: any) => (
                    <tr key={r.date} className="tabular-nums"><td className="py-0.5 text-gray-300">{r.date}</td><td className="text-right text-gray-200">{r.invoiced ?? "-"}</td><td className="text-right text-gray-200">{r.approved}</td><td className="text-right text-gray-500">{r.signed}</td><td className="text-right text-gray-300">{r.diff ?? ""}</td><td className={`pl-2 ${FLAG_TONE[r.flag]}`}>{r.flag === "OK" ? "" : r.flag.replace("_", " ").toLowerCase()}</td></tr>
                  ))}
                  <tr className="border-t border-edge font-semibold tabular-nums"><td className="py-0.5 text-gray-200">Total</td><td className="text-right">{c.hours.invoicedTotal ?? "-"}</td><td className="text-right">{c.hours.approvedTotal}</td><td className="text-right text-gray-500">{c.hours.signedTotal}</td><td className="text-right">{c.hours.diff ?? ""}</td><td></td></tr>
                </tbody>
              </table>
              <div className="mt-1 text-gray-500">{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {c.weeks.map((w: any) => `Week of ${w.weekStart}: ${w.locked ? "locked by the Manager" : "not locked"}${w.review ? `, payroll ${w.review.toLowerCase()}` : ""}`).join(" · ")}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-gray-400">GST registered:</span>
                <select className={field} value={c.gstRegistered == null ? "" : String(c.gstRegistered)} onChange={(e) => post({ action: "GST", resourceId: c.resourceId, gstRegistered: e.target.value === "" ? null : e.target.value === "true" }, "GST registration saved.")}>
                  <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No</option>
                </select>
                <button className={btn} disabled={busy || c.status === "APPROVED"} onClick={() => post({ action: "ABN", id: c.id, status: "APPROVED", note: ask("Note (optional)") }, "Approved.")}>Approve</button>
                <button className={quiet} disabled={busy} onClick={() => { const note = ask("What needs checking?"); if (note) post({ action: "ABN", id: c.id, status: "QUERY", note }, "Queried."); }}>Query</button>
                <button className={quiet} disabled={busy} onClick={() => { const note = ask("Why detach it? (wrong person / not an ABN invoice) - it goes back to the inbox"); if (note) post({ action: "ABN", id: c.id, status: "DETACH", note }, "Detached - it's back in the inbox."); }}>Detach</button>
                <Link className="text-sky-400" href={`/accounts/abn-template?person=${c.resourceId}&from=${c.invoice.periodFrom}&to=${c.invoice.periodTo}`} target="_blank">Hours sheet for {c.personName}</Link>
              </div>
            </section>
          ))}
          <section className="rounded-xl border border-edge bg-panel p-3 text-xs">
            <div className="mb-1 text-sm font-semibold text-gray-100">Attach an inbox invoice to a person</div>
            <p className="mb-2 text-gray-500">For an ABN worker&apos;s invoice the inbox didn&apos;t recognise. It&apos;s taken off the job flow (own crew are costed from hours) and checked here.</p>
            <div className="flex flex-wrap gap-2">
              <select className={field} value={attach.draftId} onChange={(e) => setAttach({ ...attach, draftId: e.target.value })}>
                <option value="">Invoice…</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {data.candidates.map((d: any) => <option key={d.id} value={d.id}>{d.supplier ?? "?"}{d.invoiceNo ? ` · ${d.invoiceNo}` : ""} · {d.invoiceDate ?? ""} · {money(d.amountExGst)}</option>)}
              </select>
              <select className={field} value={attach.resourceId} onChange={(e) => setAttach({ ...attach, resourceId: e.target.value })}>
                <option value="">Person…</option>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {data.people.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.engagement === "ABN" ? " (ABN)" : ""}</option>)}
              </select>
              <button className={btn} disabled={busy || !attach.draftId || !attach.resourceId} onClick={() => post({ action: "ATTACH", ...attach }, "Attached.").then(() => setAttach({ draftId: "", resourceId: "" }))}>Attach</button>
            </div>
          </section>
        </>
      ) : tab === "hire" ? (
        <>
          <p className="mb-2 text-xs text-gray-500">Supplier invoices linked to a hire-register item: days billed outside the hire period, more days than the register shows, the same days billed twice. {data.openFlags} to check.</p>
          {data.items.length === 0 && <p className="text-sm text-gray-500">No invoices are linked to hire items yet.</p>}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {data.items.map((it: any) => (
            <section key={it.itemId} className="mb-3 rounded-xl border border-edge bg-panel p-3 text-xs">
              <div className="text-sm font-semibold text-gray-100">{it.name} <span className="font-normal text-gray-400">· {it.supplier ?? "?"}{it.hireRef ? ` · ${it.hireRef}` : ""} · {it.project ?? ""} · on hire {it.onHireDate ?? "?"} to {it.offHireDate ?? "still on hire"}</span></div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {it.invoices.map((inv: any) => (
                <div key={inv.id} className="mt-1 border-t border-edge/60 pt-1">
                  <div className="text-gray-300">{inv.invoiceNo ?? "(no number)"} · {inv.periodFrom ?? "?"} to {inv.periodTo ?? "?"} · {money(inv.amountExGst)} ex GST</div>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {inv.flags.map((f: any) => (
                    <div key={f.kind} className="mt-0.5"><span className={f.review?.status === "OK" ? "text-gray-500" : "text-amber-300"}>{f.text}</span> <ReviewBadge r={f.review} />{f.review?.status !== "OK" && flagButtons("HIRE", inv.id, f.kind)}</div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-500">
            {data.sheet.ok ? `Agreed rates from ${data.sheet.from === "FIXTURE" ? "the TEST rate sheet" : "Estimating"} (${data.sheet.rates} rates). ` : `${data.sheet.reason} `}
            Invoice lines priced more than 2% above the agreed rate. {data.ok} line(s) at or under the agreed rate.
          </p>
          {data.sheet.ok && data.over.length === 0 && <p className="mb-3 text-sm text-gray-500">No lines over the agreed rate.</p>}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {data.over.map((o: any) => (
            <div key={o.subjectId} className="mb-2 rounded-lg border border-edge bg-panel p-2 text-xs">
              <div className="text-gray-200">{o.supplier} · {o.invoiceNo ?? "(no number)"} · {o.invoiceDate ?? ""} · {o.line.description}</div>
              <div className={o.review?.status === "OK" ? "text-gray-500" : "text-red-300"}>
                {money(o.line.unitPriceExGst)} / {o.line.unit ?? "unit"} vs agreed {money(o.rate.rateExGst)} ({o.rate.label}{o.how === "SUGGESTED" ? ", matched by name" : ""}) · {money(o.check.diffPerUnit)} over{o.check.diffTotal != null ? `, ${money(o.check.diffTotal)} on this line` : ""}{o.check.outsideValidity ? " · rate not valid on the invoice date" : ""}
                <ReviewBadge r={o.review} />{o.review?.status !== "OK" && flagButtons("RATE", o.subjectId, "OVER_RATE")}
              </div>
            </div>
          ))}
          {data.toMatch.length > 0 && (
            <section className="mt-3 rounded-xl border border-edge bg-panel p-3 text-xs">
              <div className="mb-1 text-sm font-semibold text-gray-100">Lines to match to a rate · {data.toMatch.length}</div>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {data.toMatch.map((m: any) => (
                <div key={m.subjectId} className="mt-1 flex flex-wrap items-center gap-2 border-t border-edge/60 pt-1">
                  <span className="text-gray-300">{m.supplier} · {m.line.description} · {money(m.line.unitPriceExGst)} / {m.line.unit ?? "unit"}</span>
                  <span className="text-gray-500">{m.reason}</span>
                  <select className={field} defaultValue="" onChange={(e) => e.target.value && post({ action: "LINK_RATE", draftId: m.draftId, lineNo: m.lineNo, rateId: e.target.value }, "Rate remembered for this supplier's line.")}>
                    <option value="">Pick the agreed rate…</option>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {m.candidates.map((c: any) => <option key={c.id} value={c.id}>{c.label} · {money(c.rateExGst)}</option>)}
                  </select>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}
