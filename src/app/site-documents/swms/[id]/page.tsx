"use client";

// A SWMS version's sign-on sheet (Ilies approved 25 Nov 2026), printable A4: the SWMS title and version, the project,
// then a table of everyone who signed it on site - name, company, signature, date and time - and, for the current
// version, who is on site today and hasn't signed. Read only. Managers, Admins and the coordinator (the Building Agent
// login sees the names, "Signature hidden").
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { PRINT_CSS } from "@/lib/siteDocs/browser";
import type { swmsRegister } from "@/lib/siteDocs/office";

type Reg = NonNullable<Awaited<ReturnType<typeof swmsRegister>>> & { signaturesHidden: boolean };
const th = "border border-gray-400 bg-gray-100 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-700";
const td = "border border-gray-400 px-2 py-1.5 align-top text-sm text-gray-900";
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function SwmsSheetPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  const { id } = use(paramsP);
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const [r, setR] = useState<Reg | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch(`/api/site-documents/swms/${id}`).then(async (x) => (x.ok ? setR(await x.json()) : setError(await serverErrorMessage(x, "Couldn't load it."))));
  }, [id]);
  if (!loading && !canEdit && !coordinatorOnly) return <p className="p-6 text-sm text-gray-500">Managers, Admins and the project coordinator only.</p>;
  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!r) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto p-4">
      <style>{PRINT_CSS}</style>
      <div className="mb-3 flex items-center justify-between">
        <Link href={r.project ? `/site-documents?projectId=${r.project.id}` : "/site-documents"} className="text-xs text-brand-400 hover:underline">← Site documents</Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"><Printer size={14} /> Print / Save as PDF</button>
      </div>
      <article id="print-sheet" className="w-full max-w-[210mm] rounded-md border border-gray-300 bg-white p-6 text-gray-900 shadow-soft">
        <header className="keep mb-4 flex items-start justify-between gap-4 border-b-2 border-gray-800 pb-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Lobos" className="h-12 w-auto" />
            <div>
              <div className="text-lg font-bold uppercase tracking-wide">SWMS sign-on sheet</div>
              <div className="text-xs text-gray-600">Lobos Contracting Pty Ltd</div>
            </div>
          </div>
          <div className="text-right"><div className="text-[11px] uppercase tracking-wide text-gray-600">Version</div><div className="font-mono text-xl font-bold">v{r.file.version}</div>
            <div className="text-xs font-semibold">{r.file.current ? "Current" : r.file.archived ? "Archived" : "Superseded"}</div></div>
        </header>
        <table className="keep mb-4 w-full border-collapse"><tbody>
          <tr><th className={`${th} w-36`}>SWMS</th><td className={td}>{r.file.title}</td></tr>
          <tr><th className={th}>Project</th><td className={td}>{r.project?.name}{r.project?.jobNo ? ` / ${r.project.jobNo}` : ""}</td></tr>
          <tr><th className={th}>Address</th><td className={td}>{r.project?.address ?? ""}</td></tr>
          <tr><th className={th}>Issued</th><td className={td}>{when(r.file.uploadedAt)} by {r.file.uploadedBy}</td></tr>
        </tbody></table>
        <p className="keep mb-2 text-xs text-gray-700">Each person below ticked &quot;I&apos;ve read and understand this SWMS&quot; and signed on the supervisor&apos;s phone.</p>
        <table className="w-full border-collapse">
          <thead><tr><th className={`${th} w-8`}>#</th><th className={th}>Name</th><th className={th}>Company</th><th className={`${th} w-48`}>Signature</th><th className={`${th} w-36`}>Date and time</th></tr></thead>
          <tbody>
            {r.signatures.length === 0 && <tr><td className={td} colSpan={5}>Nobody has signed this version yet.</td></tr>}
            {r.signatures.map((s, i) => (
              <tr key={s.id}>
                <td className={td}>{i + 1}</td>
                <td className={td}>{s.name}{s.role === "SUPERVISOR" ? " (supervisor)" : ""}{s.afterSignOut ? <span className="block text-[10px] font-semibold text-red-700">Signed after they signed out</span> : null}</td>
                <td className={td}>{s.company ?? (s.role === "SUPERVISOR" ? "Lobos" : "")}</td>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td className={td}>{r.signaturesHidden ? <span className="italic text-gray-500">Signature hidden</span> : <img src={`/api/site-documents/swms/signature/${s.id}`} alt={`${s.name} signature`} className="h-12 w-auto max-w-full object-contain" />}</td>
                <td className={td}>{when(s.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.file.current && r.notSigned.length > 0 && (
          <section className="keep mt-4">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-red-700">On site today and not signed</h2>
            <ul className="text-sm">{r.notSigned.map((p, i) => <li key={i}>{p.name}{p.company ? ` (${p.company})` : ""} - signed in {when(p.signedIn)}</li>)}</ul>
          </section>
        )}
      </article>
    </div>
  );
}
