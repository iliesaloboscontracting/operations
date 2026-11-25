"use client";

// One pre-start meeting or toolbox talk (Ilies approved 25 Nov 2026), on white "paper" that prints to A4: the project,
// the day, what was covered (or the topic and points), the notes, then a table of everyone who signed - name, company,
// "I understand", the signature, the time (late sign-ons marked) - and the supervisor. Read only: a sent record is never
// changed. Managers, Admins and the coordinator (the Building Agent login sees the names, "Signature hidden").
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { recordDetail } from "@/lib/siteDocs/office";
import { PRINT_CSS } from "@/lib/siteDocs/browser";

type Rec = NonNullable<Awaited<ReturnType<typeof recordDetail>>>;
const th = "border border-gray-400 bg-gray-100 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-700";
const td = "border border-gray-400 px-2 py-1.5 align-top text-sm text-gray-900";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function RecordPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = use(paramsP);
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const [r, setR] = useState<Rec | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch(`/api/site-documents/records/${id}`).then(async (x) => (x.ok ? setR((await x.json()).record) : setError(await serverErrorMessage(x, "Couldn't load it."))));
  }, [id]);
  if (!loading && !canEdit && !coordinatorOnly) return <p className="p-6 text-sm text-gray-500">Managers, Admins and the project coordinator only.</p>;
  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!r) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  const sig = (sid: string) => `/api/site-documents/records/${r.id}/signature/${sid}`;
  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto p-4">
      <style>{PRINT_CSS}</style>
      <div className="mb-3 flex items-center justify-between">
        <Link href={r.projectId ? `/site-documents?projectId=${r.projectId}` : "/site-documents"} className="text-xs text-brand-400 hover:underline">← Site documents</Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"><Printer size={14} /> Print / Save as PDF</button>
      </div>
      <article id="print-sheet" className="w-full max-w-[210mm] rounded-md border border-gray-300 bg-white p-6 text-gray-900 shadow-soft">
        <header className="keep mb-4 flex items-start justify-between gap-4 border-b-2 border-gray-800 pb-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Lobos" className="h-12 w-auto" />
            <div>
              <div className="text-lg font-bold uppercase tracking-wide">{r.kind === "TOOLBOX" ? "Toolbox talk" : "Pre-start meeting"}{r.label.match(/\d+$/) ? ` ${r.label.match(/\d+$/)![0]}` : ""}</div>
              <div className="text-xs text-gray-600">Lobos Contracting Pty Ltd</div>
            </div>
          </div>
          <div className="text-right text-sm"><div>{day(r.day)}</div><div className="text-xs text-gray-600">Sent {when(r.sentAt)}</div></div>
        </header>
        <table className="keep mb-4 w-full border-collapse"><tbody>
          <tr><th className={`${th} w-36`}>Project</th><td className={td}>{r.project}{r.jobNo ? ` / ${r.jobNo}` : ""}</td></tr>
          <tr><th className={th}>Supervisor</th><td className={td}>{r.supervisor}{r.linkKind === "HANDOVER" ? " (hand-over link)" : ""}</td></tr>
        </tbody></table>
        {r.kind === "PRESTART" ? (
          <section className="keep mb-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Covered</h2>
            <table className="w-full border-collapse"><tbody>
              {r.topics.map((t) => <tr key={t.key}><th className={`${th} w-64`}>✓ {t.label}</th><td className={`${td} whitespace-pre-wrap`}>{t.notes ?? ""}</td></tr>)}
            </tbody></table>
          </section>
        ) : r.toolbox && (
          <section className="keep mb-4 space-y-2 text-sm">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-700">Topic{r.toolbox.source === "OFFICE" ? " (topic of the week)" : ""}</h2>
            <p className="text-base font-semibold">{r.toolbox.title}</p>
            {r.toolbox.officePoints.length > 0 && <ul className="list-disc pl-5">{r.toolbox.officePoints.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            <p className="whitespace-pre-wrap"><span className="font-semibold">Points discussed: </span>{r.toolbox.points}</p>
            {r.toolbox.sitePoints && <p className="whitespace-pre-wrap"><span className="font-semibold">Site-specific: </span>{r.toolbox.sitePoints}</p>}
          </section>
        )}
        {r.notes && <p className="keep mb-4 whitespace-pre-wrap text-sm"><span className="font-semibold">Notes: </span>{r.notes}</p>}
        <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-700">Signed on</h2>
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Name</th><th className={th}>Company</th><th className={`${th} w-20`}>Understood</th><th className={`${th} w-48`}>Signature</th><th className={`${th} w-36`}>Signed</th></tr></thead>
          <tbody>
            {r.signatures.map((s) => (
              <tr key={s.id}>
                <td className={td}>{s.name}{s.role === "SUPERVISOR" ? " (supervisor)" : ""}{s.late ? <span className="block text-[10px] font-semibold text-red-700">Late sign-on</span> : null}</td>
                <td className={td}>{s.company ?? (s.role === "SUPERVISOR" ? "Lobos" : "")}</td>
                <td className={td}>{s.understood ? "✓" : ""}</td>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td className={td}>{r.signaturesHidden ? <span className="italic text-gray-500">Signature hidden</span> : <img src={sig(s.id)} alt={`${s.name} signature`} className="h-12 w-auto max-w-full object-contain" />}</td>
                <td className={td}>{when(s.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}
