"use client";

// One variation / day docket (Ilies approved 25 Nov 2026), laid out like his paper docket - project details, the ticks,
// the variation works, the equipment / tool / materials / waste rows, photos, both signatures and the Lobos footer -
// on white "paper" that prints to A4 (Print / Save as PDF; the office emails it to the client themselves - nothing is
// sent from here). Beside it, the office's own status (To price -> Priced -> Sent to client) and its history; changing
// it never touches the signed docket. Managers, Admins and the coordinator (the API checks). No prices anywhere.
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { LOBOS, STATUSES, STATUS_LABEL, TICKS, hoursText, totalHours, unitLabel, type OfficeDetailDTO, type Status } from "@/lib/variations/rules";
import { STATUS_TONE } from "@/components/variations/statusTone";

const PRINT = `
@page { size: A4; margin: 10mm; }
@media print {
  body * { visibility: hidden !important; }
  #variation-docket, #variation-docket * { visibility: visible !important; }
  #variation-docket { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: 0 !important; }
  #variation-docket .vd-block { break-inside: avoid; }
  #variation-docket img.vd-photo { max-height: 60mm; }
}`;
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const sydDay = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const th = "border border-gray-400 bg-gray-100 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-700";
const td = "border border-gray-400 px-2 py-1.5 align-top text-sm text-gray-900";

export default function VariationDocketPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = use(paramsP);
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const [d, setD] = useState<OfficeDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch(`/api/variations/${id}`).then(async (r) => (r.ok ? (setError(null), setD((await r.json()).docket)) : setError(await serverErrorMessage(r, "Couldn't load the docket."))));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!loading && !canEdit && !coordinatorOnly) return <p className="p-6 text-sm text-gray-500">Managers, Admins and the project coordinator only.</p>;
  if (error && !d) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!d) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  const base = `/api/variations/${d.id}`;
  return (
    <div className="mx-auto max-w-5xl p-4">
      <style>{PRINT}</style>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link href="/variations" className="text-xs text-brand-400 hover:underline">← Variations</Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"><Printer size={14} /> Print / Save as PDF</button>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <article id="variation-docket" className="w-full max-w-[210mm] flex-1 rounded-md border border-gray-300 bg-white p-6 text-gray-900 shadow-soft">
          <header className="vd-block mb-4 flex items-start justify-between gap-4 border-b-2 border-gray-800 pb-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Lobos" className="h-12 w-auto" />
              <div>
                <div className="text-lg font-bold uppercase tracking-wide">Variation / Day Docket</div>
                <div className="text-xs text-gray-600">{LOBOS.name}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-gray-600">Docket #</div>
              <div className="font-mono text-xl font-bold">{d.number}</div>
              {d.replaces && <div className="text-xs font-semibold text-red-700">Replaces {d.replaces}</div>}
              {d.replacedBy && <div className="text-xs font-semibold text-red-700">Replaced by {d.replacedBy}</div>}
            </div>
          </header>

          <section className="vd-block mb-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Project details</h2>
            <table className="w-full border-collapse">
              <tbody>
                <tr><th className={`${th} w-36`}>Date</th><td className={td}>{day(d.day)}</td><th className={`${th} w-28`}>Docket #</th><td className={td}>{d.number}</td></tr>
                <tr><th className={th}>Project name / #</th><td className={td} colSpan={3}>{d.project}{d.jobNo ? ` / ${d.jobNo}` : ""}</td></tr>
                <tr><th className={th}>Address</th><td className={td} colSpan={3}>{d.address || ""}</td></tr>
                <tr><th className={th}>Client</th><td className={td} colSpan={3}>{d.client || ""}</td></tr>
              </tbody>
            </table>
          </section>

          <section className="vd-block mb-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Please tick below</h2>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
              {TICKS.map((t) => (
                <span key={t.key} className="flex items-center gap-2">
                  <span className="flex h-4 w-4 items-center justify-center border border-gray-700 text-[11px] font-bold leading-none">{d.ticks.includes(t.key) ? "✓" : ""}</span>
                  {t.label}{t.key === "OTHER" && d.otherText ? `: ${d.otherText}` : ""}
                </span>
              ))}
            </div>
          </section>

          <section className="vd-block mb-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Variation works</h2>
            <table className="w-full border-collapse">
              <thead><tr><th className={`${th} w-14`}>Task #</th><th className={th}>Description of work (scope, no. of men, hrs etc)</th><th className={`${th} w-16`}>Start</th><th className={`${th} w-16`}>Finish</th><th className={`${th} w-20`}>Total hrs</th></tr></thead>
              <tbody>
                {d.taskRows.length === 0 ? <tr><td className={td} colSpan={5}>&nbsp;</td></tr> : d.taskRows.map((t) => (
                  <tr key={t.n}>
                    <td className={td}>{t.n}</td>
                    <td className={`${td} whitespace-pre-wrap`}>{t.description}{t.men ? `\n${t.men} men` : ""}</td>
                    <td className={td}>{t.start ?? ""}</td>
                    <td className={td}>{t.finish ?? ""}</td>
                    <td className={td}>{hoursText(t.hours)}{t.edited && <span className="block text-[10px] text-gray-500">entered (times give {hoursText(t.hoursCalc)})</span>}</td>
                  </tr>
                ))}
                {d.taskRows.length > 0 && <tr><td className={`${td} text-right font-semibold`} colSpan={4}>Total</td><td className={`${td} font-semibold`}>{hoursText(totalHours(d.taskRows))}</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="vd-block mb-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Equipment / tool / materials used / waste removal</h2>
            <table className="w-full border-collapse">
              <thead><tr><th className={`${th} w-32`}>Quantity / total m³</th><th className={th}>Type</th><th className={th}>Comments</th></tr></thead>
              <tbody>
                {d.itemRows.length === 0 ? <tr><td className={td} colSpan={3}>&nbsp;</td></tr> : d.itemRows.map((x) => (
                  <tr key={x.n}><td className={td}>{x.quantity != null ? `${x.quantity} ${unitLabel(x.unit)}` : ""}</td><td className={td}>{x.type}</td><td className={td}>{x.comment ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          {(d.note || d.photoIds.length > 0) && (
            <section className="vd-block mb-4">
              {d.note && <p className="mb-2 whitespace-pre-wrap text-sm"><span className="font-semibold">Note: </span>{d.note}</p>}
              {d.photoIds.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {d.photoIds.map((m) => (
                    <a key={m} href={`${base}/photo/${m}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${base}/photo/${m}`} alt="Docket photo" className="vd-photo h-40 w-full rounded border border-gray-300 object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="vd-block mb-4 grid grid-cols-2 gap-4">
            <SignOff title="Customer sign-off" name={d.customerName} position={d.customerPosition} date={sydDay(d.signedAt)} img={d.signatures.customer ? `${base}/signature/customer` : null} />
            <SignOff title="Lobos sign-off" name={d.lobosName} position={d.lobosPosition} date={sydDay(d.signedAt)} img={d.signatures.lobos ? `${base}/signature/lobos` : null} />
          </section>

          <footer className="vd-block border-t border-gray-400 pt-2 text-center text-[11px] text-gray-600">
            {LOBOS.name} · ABN {LOBOS.abn} · {LOBOS.address}
          </footer>
        </article>

        <aside className="w-full shrink-0 space-y-3 lg:w-72">
          <StatusPanel d={d} onChanged={load} />
          <div className="rounded-xl border border-edge bg-panel p-4 text-xs text-gray-400">
            <p>Sent {when(d.signedAt)} from {d.linkKind === "HANDOVER" ? "a hand-over link" : "the supervisor's link"} by {d.lobosName}.</p>
            <p className="mt-1">A signed docket can&apos;t be changed. A correction comes in as a new docket that says which one it replaces.</p>
            {d.replacesId && <p className="mt-1"><Link className="text-brand-300 hover:underline" href={`/variations/${d.replacesId}`}>Open {d.replaces}</Link></p>}
            {d.replacedById && <p className="mt-1"><Link className="text-brand-300 hover:underline" href={`/variations/${d.replacedById}`}>Open {d.replacedBy}</Link></p>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SignOff({ title, name, position, date, img }: { title: string; name: string; position: string | null; date: string; img: string | null }) {
  return (
    <div className="border border-gray-400 p-2">
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">{title}</div>
      <dl className="grid grid-cols-[5rem_1fr] gap-y-1 text-sm">
        <dt className="text-gray-600">Name</dt><dd>{name}</dd>
        <dt className="text-gray-600">Signature</dt>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <dd>{img ? <img src={img} alt={`${title} signature`} className="h-20 w-auto max-w-full border-b border-gray-400 object-contain" /> : <span className="text-gray-400">-</span>}</dd>
        <dt className="text-gray-600">Position</dt><dd>{position ?? ""}</dd>
        <dt className="text-gray-600">Date</dt><dd>{date}</dd>
      </dl>
    </div>
  );
}

function StatusPanel({ d, onChanged }: { d: OfficeDetailDTO; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idx = STATUSES.indexOf(d.status);
  async function set(to: Status) {
    setBusy(true); setError(null);
    const r = await apiFetch(`/api/variations/${d.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: to, from: d.status, note }) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't change it."));
    setNote("");
    onChanged();
  }
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-gray-100">Office status</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[d.status] ?? ""}`}>{d.statusLabel}</span>
      </div>
      {d.canSetStatus && (
        <>
          <div className="flex flex-col gap-2">
            {STATUSES.filter((s) => s !== d.status).map((s) => (
              <button key={s} disabled={busy} onClick={() => set(s)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${STATUSES.indexOf(s) > idx ? "bg-brand-600 text-white" : "border border-edge text-gray-300"}`}>
                {STATUSES.indexOf(s) > idx ? `Mark ${STATUS_LABEL[s]}` : `Back to ${STATUS_LABEL[s]}`}
              </button>
            ))}
          </div>
          <input className="mt-2 w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200" maxLength={300} placeholder="Note (needed to go back a step) - no amounts" value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      {d.history.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-edge/60 pt-2 text-xs text-gray-400">
          {d.history.slice().reverse().map((h, i) => (
            <li key={i}><span className="text-gray-200">{h.label}</span> (from {h.from}) · {h.by} · {when(h.at)}{h.note ? ` - ${h.note}` : ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
