"use client";

// Site documents on the coordinator's dashboard (Ilies, 25 Nov 2026: "allow him to upload documents aswell from his
// dashboard which the crew get on their apps"): pick the project, then upload a plan / drawing or a new SWMS version
// - it shows on the supervisors' links for that project straight away - or set the toolbox talk topic of the week.
// A short summary first: people on site today who haven't signed their project's current SWMS, projects with no SWMS.
// Managers / Admins see the same card if they open /coordinator (it came off the board on 26 Nov 2026). Never incidents.
// "Open" and "See the project" go to the Site documents part of the Documents page (Ilies, 26 Nov 2026: "Yes, one
// place: Documents"; "Keep it on Alex's screen").
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen, Megaphone } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { siteDocumentsHref } from "@/lib/documentsTabs";
import UploadForm from "./UploadForm";
import type { officeProjects, officeSummary } from "@/lib/siteDocs/office";

type Summary = Awaited<ReturnType<typeof officeSummary>>;
type Projects = Awaited<ReturnType<typeof officeProjects>>;

export default function SiteDocsCard() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [projects, setProjects] = useState<Projects>([]);
  const [pid, setPid] = useState("");
  const [kind, setKind] = useState<"PLAN" | "SWMS">("PLAN");
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/site-documents?summary=1").then(async (r) => (r.ok ? setSum(await r.json()) : null)).catch(() => null);
  }, []);
  useEffect(() => {
    load();
    apiFetch("/api/site-documents").then(async (r) => (r.ok ? setProjects((await r.json()).projects) : null)).catch(() => null);
  }, [load]);
  const today = new Set(sum?.projects.map((p) => p.id) ?? []);
  const sorted = [...projects].sort((a, b) => Number(today.has(b.id)) - Number(today.has(a.id)) || a.name.localeCompare(b.name));
  return (
    <div className="w-full rounded-xl border border-edge bg-panel p-4 shadow-soft">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold text-gray-100"><FolderOpen size={16} className="text-brand-400" /> Site documents</span>
        <Link href={siteDocumentsHref()} className="text-xs text-brand-300 hover:underline">Open</Link>
      </div>
      {sum && (
        <p className={`mb-2 text-xs ${sum.notSigned || sum.noSwms ? "text-amber-300" : "text-gray-400"}`}>
          {sum.projectsToday === 0 ? "No jobs on today." : `SWMS not signed by people on site today: ${sum.notSigned}${sum.noSwms ? ` · ${sum.noSwms} project${sum.noSwms === 1 ? "" : "s"} on today with no SWMS` : ""}`}
        </p>
      )}
      <p className="mb-2 text-xs text-gray-400">Upload a plan or a new SWMS version - the supervisors get it on their link for that project.</p>
      <select className="mb-2 w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200" value={pid} onChange={(e) => { setPid(e.target.value); setDone(null); }} aria-label="Project">
        <option value="">Pick the project…</option>
        {sorted.map((p) => {
          const s = sum?.projects.find((x) => x.id === p.id);
          return <option key={p.id} value={p.id}>{p.name}{p.jobNo ? ` (${p.jobNo})` : ""}{s ? (s.hasSwms ? (s.notSigned ? ` - on today, ${s.notSigned} not signed` : " - on today") : " - on today, no SWMS") : ""}</option>;
        })}
      </select>
      {pid && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2">
            {(["PLAN", "SWMS"] as const).map((k) => (
              <button key={k} type="button" onClick={() => { setKind(k); setDone(null); }} aria-pressed={kind === k}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${kind === k ? "border-brand-500 bg-brand-600/25 text-white" : "border-edge bg-panel2 text-gray-300"}`}>
                {k === "PLAN" ? "Plan / drawing" : "New SWMS version"}
              </button>
            ))}
          </div>
          <UploadForm key={`${pid}-${kind}`} projectId={pid} kind={kind} onDone={() => { setDone(kind === "SWMS" ? "SWMS uploaded - the crew sign the new version on site." : "Plan uploaded - it's on the supervisors' links."); load(); }} />
          {done && <p className="mt-2 text-xs text-emerald-300">✓ {done} <Link className="text-brand-300 underline" href={siteDocumentsHref(pid)}>See the project</Link></p>}
        </>
      )}
      <Link href="/site-documents/topic" className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-300 hover:underline"><Megaphone size={13} /> Toolbox talk - topic of the week</Link>
    </div>
  );
}