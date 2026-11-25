"use client";

// Site documents (Ilies approved 25 Nov 2026) - the office side of what the supervisors do on their links. Per project:
// plans & drawings (upload, open, archive - never deleted), the SWMS (each upload is a new version; old ones kept as
// superseded) with its sign-on register and "on site today and not signed the current SWMS", and the pre-start
// meetings and toolbox talks sent from site (each opens as a printable A4 record with the signatures). The topic of the
// week is its own screen. Managers, Admins (the owner) and the coordinator. Incident reports are NOT here - the owner
// and the directors see those. No prices anywhere.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, FileText, Image as ImageIcon, Megaphone } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import UploadForm from "@/components/siteDocs/UploadForm";
import type { officeProject, officeProjects, recordList } from "@/lib/siteDocs/office";

type Projects = Awaited<ReturnType<typeof officeProjects>>;
type Records = Awaited<ReturnType<typeof recordList>>;
type Project = NonNullable<Awaited<ReturnType<typeof officeProject>>>;
const select = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200";
const inputCls = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200";
const btn = "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function SiteDocumentsPage() {
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const [projects, setProjects] = useState<Projects | null>(null);
  const [latest, setLatest] = useState<Records>([]);
  const [pid, setPid] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("projectId"); if (q) setPid(q); }, []);
  useEffect(() => {
    apiFetch("/api/site-documents").then(async (r) => (r.ok ? (async () => { const d = await r.json(); setProjects(d.projects); setLatest(d.records); })() : setError(await serverErrorMessage(r, "Couldn't load site documents."))));
  }, []);

  if (loading) return <PageShell title="Site documents"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit && !coordinatorOnly) return <PageShell title="Site documents"><p className="text-sm text-gray-500">Managers, Admins and the project coordinator only.</p></PageShell>;
  return (
    <PageShell title="Site documents" subtitle="Plans, SWMS and their sign-on register, pre-starts and toolbox talks from the supervisors' links."
      actions={<Link href="/site-documents/topic" className={btn}><Megaphone size={14} /> Topic of the week</Link>}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={select} value={pid} onChange={(e) => { setPid(e.target.value); const u = new URL(window.location.href); if (e.target.value) u.searchParams.set("projectId", e.target.value); else u.searchParams.delete("projectId"); window.history.replaceState(null, "", u); }} aria-label="Project">
          <option value="">Pick a project…</option>
          {projects?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.jobNo ? ` (${p.jobNo})` : ""}{p.status !== "ACTIVE" ? " - stood down" : ""}{p.plans + p.swmsVersions + p.records ? ` · ${p.plans} plans, ${p.swmsVersions} SWMS, ${p.records} records` : ""}</option>)}
        </select>
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {pid ? <ProjectPanel key={pid} projectId={pid} /> : <RecordTable rows={latest} title="Latest pre-starts and toolbox talks" />}
    </PageShell>
  );
}

function RecordTable({ rows, title }: { rows: Records; title: string }) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <h2 className="mb-2 font-semibold text-gray-100">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-gray-500">None yet - they come in from the supervisors&apos; links.</p> : (
        <ul className="divide-y divide-edge/60">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/site-documents/records/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 py-2 hover:bg-panel2/50">
                <span className="w-28 shrink-0 text-sm font-semibold text-gray-100">{r.label}</span>
                <span className="min-w-0 flex-1 text-sm text-gray-300">{r.project}{r.title ? ` - ${r.title}` : ""}<span className="block text-xs text-gray-500">{day(r.day)} · {r.supervisor} · {r.crew} crew signed{r.late ? ` (${r.late} late)` : ""}</span></span>
                <span className="text-xs text-gray-500">{when(r.sentAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectPanel({ projectId }: { projectId: string }) {
  const [d, setD] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch(`/api/site-documents?projectId=${encodeURIComponent(projectId)}`).then(async (r) => (r.ok ? (setError(null), setD(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the project."))));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!d) return <p className="text-sm text-gray-500">Loading...</p>;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-xl border border-edge bg-panel p-4">
        <h2 className="mb-1 font-semibold text-gray-100">Plans & drawings</h2>
        <p className="mb-3 text-xs text-gray-500">PDF, JPEG or PNG, up to 7 MB each. Supervisors open them on their link (read only). Archive hides one - nothing is deleted.</p>
        <UploadForm projectId={projectId} kind="PLAN" onDone={load} />
        <FileList files={d.plans} onChanged={load} />
      </section>
      <section className="rounded-xl border border-edge bg-panel p-4">
        <h2 className="mb-1 font-semibold text-gray-100">SWMS</h2>
        <p className="mb-3 text-xs text-gray-500">A PDF. Each upload is a new version - everyone signs again on site; old versions are kept (superseded).</p>
        <UploadForm projectId={projectId} kind="SWMS" onDone={load} />
        <ul className="mt-3 divide-y divide-edge/60">
          {d.swms.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="w-10 font-mono font-semibold text-gray-100">v{f.version}</span>
              <a className="min-w-0 flex-1 text-brand-300 hover:underline" href={`/api/site-documents/files/${f.id}`} target="_blank" rel="noreferrer">{f.title}</a>
              <span className={`rounded-full px-2 py-0.5 text-xs ${f.current ? "bg-emerald-500/15 text-emerald-300" : f.archived ? "bg-gray-500/15 text-gray-400" : "bg-amber-500/15 text-amber-300"}`}>{f.current ? "Current" : f.archived ? "Archived" : "Superseded"}</span>
              <Link className="text-xs text-brand-300 hover:underline" href={`/site-documents/swms/${f.id}`}>{f.signed} signed · register / print</Link>
              {!f.archived && <ArchiveButton id={f.id} onDone={load} warning={f.current ? swmsArchiveWarning(f.version, d.swms) : undefined} />}
            </li>
          ))}
          {d.swms.length === 0 && <li className="py-2 text-sm text-gray-500">No SWMS yet.</li>}
        </ul>
        {d.currentSwmsId && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-sm font-semibold text-amber-200">On site today and not signed the current SWMS</div>
            {d.notSigned.length === 0 ? <p className="text-xs text-gray-400">Nobody - everyone signed in on this project today has signed it.</p>
              : <ul className="mt-1 text-sm text-gray-300">{d.notSigned.map((p, i) => <li key={i}>{p.name}{p.company ? ` (${p.company})` : ""} · in {when(p.signedIn)}</li>)}</ul>}
          </div>
        )}
      </section>
      <div className="xl:col-span-2"><RecordTable rows={d.records} title="Pre-starts and toolbox talks" /></div>
    </div>
  );
}

function FileList({ files, onChanged }: { files: Project["plans"]; onChanged: () => void }) {
  if (!files.length) return <p className="mt-3 text-sm text-gray-500">None yet.</p>;
  return (
    <ul className="mt-3 divide-y divide-edge/60">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
          {f.mime === "application/pdf" ? <FileText size={16} className="text-brand-300" /> : <ImageIcon size={16} className="text-brand-300" />}
          <a className={`min-w-0 flex-1 hover:underline ${f.archived ? "text-gray-500 line-through" : "text-brand-300"}`} href={`/api/site-documents/files/${f.id}`} target="_blank" rel="noreferrer">{f.title}</a>
          <span className="text-xs text-gray-500">{f.uploadedBy} · {when(f.at)}</span>
          {f.archived ? <span className="text-xs text-gray-500" title={f.archived.note}>Archived by {f.archived.by}</span> : <ArchiveButton id={f.id} onDone={onChanged} />}
        </li>
      ))}
    </ul>
  );
}

// SD-009 (Ilies, 26 Nov 2026: warn, keep signatures): archiving the CURRENT SWMS says which version becomes current again.
function swmsArchiveWarning(version: number | null, all: Project["swms"]) {
  const prev = all.filter((x) => !x.archived && (x.version ?? 0) < (version ?? 0)).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  return prev
    ? `This is the current SWMS (v${version}). Archiving it makes v${prev.version} current again on the supervisors' links - the signatures already on v${prev.version} stay valid, and anyone who only signed v${version} will need to sign v${prev.version}.`
    : `This is the current SWMS (v${version}) and there's no earlier one - archiving it leaves this project with no SWMS on the links.`;
}

function ArchiveButton({ id, onDone, warning }: { id: string; onDone: () => void; warning?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button disabled={busy} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-amber-300 disabled:opacity-50" onClick={async () => {
      if (warning && !window.confirm(warning)) return;
      const note = window.prompt("Why archive it? (It's hidden from the links, never deleted.)");
      if (!note) return;
      setBusy(true);
      const r = await apiFetch(`/api/site-documents/files/${id}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      setBusy(false);
      if (!r.ok) return window.alert(await serverErrorMessage(r, "Couldn't archive it."));
      onDone();
    }}><Archive size={13} /> Archive</button>
  );
}
