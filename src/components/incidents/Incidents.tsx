"use client";

// Incident reports (Ilies approved 25 Nov 2026) - the owner's /incidents and the directors' /directors/incidents share
// these. The owner and DIRECTOR logins only (the API checks: guardIncidents). List (newest first, with the follow-up
// status), and one report laid out to print on A4, with its follow-up notes (append-only: Investigation note / Action
// taken / Closed / Reopened). The report itself is never changed. Health details stay here - never an AI, never a push.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Printer } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { isOwner } from "@/lib/owner";
import { PRINT_CSS } from "@/lib/siteDocs/browser";
import { EVENT_KINDS, EVENT_LABEL, SAFEWORK_PROMPT } from "@/lib/siteDocs/rules";
import type { IncidentDetailDTO, IncidentRowDTO } from "@/lib/siteDocs/incidents";

const TONE: Record<string, string> = { OPEN: "bg-red-500/15 text-red-300", INVESTIGATING: "bg-amber-500/15 text-amber-300", CLOSED: "bg-emerald-500/15 text-emerald-300" };
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
const th = "border border-gray-400 bg-gray-100 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-700 w-44";
const td = "border border-gray-400 px-2 py-1.5 align-top text-sm text-gray-900 whitespace-pre-wrap";

export function useIncidentAccess() {
  const { user, loading } = useAuth();
  return { loading, ok: !!user && (user.role === "DIRECTOR" || isOwner(user.email)) };
}
const NO = <p className="p-6 text-sm text-gray-500">Incident reports are for the owner and the directors only.</p>;

export function IncidentList({ base }: { base: string }) {
  const { loading, ok } = useIncidentAccess();
  const [rows, setRows] = useState<IncidentRowDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ok) return;
    apiFetch("/api/directors/incidents").then(async (r) => (r.ok ? setRows((await r.json()).rows) : setError(await serverErrorMessage(r, "Couldn't load the reports."))));
  }, [ok]);
  if (loading) return <p className="p-6 text-sm text-gray-500">Loading...</p>;
  if (!ok) return NO;
  return (
    <div className="h-full overflow-y-auto px-6 py-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-100">Incident reports</h1>
      <p className="mb-4 mt-0.5 text-sm text-gray-500">Sent from the supervisors&apos; links. Only the owner and the directors see them.</p>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!rows ? <p className="text-sm text-gray-500">Loading...</p> : rows.length === 0 ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-gray-500">No incident reports.</div> : (
        <ul className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-panel">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`${base}/${r.id}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 hover:bg-panel2/60">
                <span className="w-24 shrink-0 font-mono text-sm font-semibold text-gray-100">{r.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-100">{r.typeLabel} · {r.project}{r.jobNo ? <span className="ml-1.5 text-xs font-normal text-gray-500">{r.jobNo}</span> : null}</span>
                  <span className="block text-xs text-gray-400">{when(r.occurredAt)} · {r.treatmentLabel} · {r.supervisor}{r.notifiable ? ` · SafeWork: ${r.safework}` : ""}</span>
                </span>
                {r.notifiable && <AlertTriangle size={16} className="shrink-0 text-red-400" aria-label="May be notifiable" />}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[r.status] ?? ""}`}>{r.statusLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IncidentDetail({ id, back }: { id: string; back: string }) {
  const { loading, ok } = useIncidentAccess();
  const [d, setD] = useState<IncidentDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch(`/api/directors/incidents/${id}`).then(async (r) => (r.ok ? (setError(null), setD((await r.json()).incident)) : setError(await serverErrorMessage(r, "Couldn't load the report."))));
  }, [id]);
  useEffect(() => { if (ok) load(); }, [ok, load]);
  if (loading) return <p className="p-6 text-sm text-gray-500">Loading...</p>;
  if (!ok) return NO;
  if (error && !d) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!d) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  const api = `/api/directors/incidents/${d.id}`;
  return (
    <div className="mx-auto h-full max-w-6xl overflow-y-auto p-4">
      <style>{PRINT_CSS}</style>
      <div className="mb-3 flex items-center justify-between">
        <Link href={back} className="text-xs text-brand-400 hover:underline">← Incident reports</Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"><Printer size={14} /> Print / Save as PDF</button>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <article id="print-sheet" className="w-full max-w-[210mm] flex-1 rounded-md border border-gray-300 bg-white p-6 text-gray-900 shadow-soft">
          <header className="keep mb-4 flex items-start justify-between gap-4 border-b-2 border-gray-800 pb-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Lobos" className="h-12 w-auto" />
              <div><div className="text-lg font-bold uppercase tracking-wide">Incident report</div><div className="text-xs text-gray-600">Lobos Contracting Pty Ltd - confidential</div></div>
            </div>
            <div className="text-right"><div className="font-mono text-xl font-bold">{d.number}</div><div className="text-xs">{d.statusLabel}</div></div>
          </header>
          {d.notifiable && (
            <div className="keep mb-4 border-2 border-red-700 p-2 text-sm">
              <div className="font-bold text-red-700">May be notifiable to SafeWork NSW</div>
              <div className="text-xs text-gray-700">The supervisor was shown: &quot;{SAFEWORK_PROMPT}&quot;</div>
              <div className="mt-1">Has SafeWork been called? <span className="font-semibold">{d.safework}</span>{d.serious ? " · ticked serious injury or illness" : ""}</div>
            </div>
          )}
          <table className="keep mb-4 w-full border-collapse"><tbody>
            <tr><th className={th}>Project</th><td className={td}>{d.project}{d.jobNo ? ` / ${d.jobNo}` : ""}</td></tr>
            <tr><th className={th}>When</th><td className={td}>{when(d.occurredAt)}</td></tr>
            <tr><th className={th}>Where on site</th><td className={td}>{d.location}</td></tr>
            <tr><th className={th}>Type</th><td className={td}>{d.typeLabel}</td></tr>
            <tr><th className={th}>Treatment</th><td className={td}>{d.treatmentLabel}</td></tr>
            <tr><th className={th}>Body part</th><td className={td}>{d.bodyPart}</td></tr>
            <tr><th className={th}>People involved</th><td className={td}>{d.people.map((p) => `${p.name}${p.company ? ` (${p.company})` : p.staff ? " (Lobos)" : ""}`).join(", ") || "-"}{d.others ? `\nOthers: ${d.others}` : ""}</td></tr>
            <tr><th className={th}>What happened</th><td className={td}>{d.whatHappened}</td></tr>
            <tr><th className={th}>Done straight away</th><td className={td}>{d.immediateAction}</td></tr>
            <tr><th className={th}>Witnesses</th><td className={td}>{d.witnesses ?? "-"}</td></tr>
          </tbody></table>
          {d.photoIds.length > 0 && (
            <div className="keep mb-4 grid grid-cols-3 gap-2">
              {d.photoIds.map((m) => (
                <a key={m} href={`${api}/photo/${m}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`${api}/photo/${m}`} alt="Incident photo" className="h-40 w-full rounded border border-gray-300 object-cover" />
                </a>
              ))}
            </div>
          )}
          <div className="keep border border-gray-400 p-2 text-sm">
            <div className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Supervisor</div>
            <div>{d.supervisor}{d.linkKind === "HANDOVER" ? " (hand-over link)" : ""} · sent {when(d.sentAt)}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {d.hasSignature && <img src={`${api}/signature`} alt="Supervisor's signature" className="mt-1 h-16 w-auto border-b border-gray-400 object-contain" />}
          </div>
          {d.events.length > 0 && (
            <section className="keep mt-4">
              <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Follow-up</h2>
              <ul className="space-y-1 text-sm">{d.events.map((e, i) => <li key={i}><span className="font-semibold">{e.label}</span> ({e.status}) · {e.by} · {when(e.at)}<div className="whitespace-pre-wrap text-gray-700">{e.note}</div></li>)}</ul>
            </section>
          )}
        </article>
        <aside className="w-full shrink-0 lg:w-80"><FollowUp d={d} onChanged={load} /></aside>
      </div>
    </div>
  );
}

function FollowUp({ d, onChanged }: { d: IncidentDetailDTO; onChanged: () => void }) {
  const kinds = EVENT_KINDS.filter((k) => (d.status === "CLOSED" ? k === "REOPENED" : k !== "REOPENED"));
  const [kind, setKind] = useState<string>(kinds[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setKind(kinds[0]); }, [d.status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add() {
    setBusy(true); setError(null);
    const r = await apiFetch(`/api/directors/incidents/${d.id}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, note, from: d.status }) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't add it."));
    setNote(""); onChanged();
  }
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-2 flex items-center justify-between"><span className="font-semibold text-gray-100">Follow-up</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[d.status] ?? ""}`}>{d.statusLabel}</span></div>
      <select className="w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What">
        {kinds.map((k) => <option key={k} value={k}>{EVENT_LABEL[k]}</option>)}
      </select>
      <textarea className="mt-2 min-h-[90px] w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200" maxLength={1000} placeholder="The note (kept - never changed)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      <button className="mt-2 w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || note.trim().length < 3} onClick={add}>{busy ? "Saving…" : "Add"}</button>
      <p className="mt-2 text-xs text-gray-500">The report itself can&apos;t be changed. Notes are added, never edited.</p>
    </div>
  );
}
