"use client";

// Toolbox talk - topic of the week (Ilies approved 25 Nov 2026): the office sets a title, points and an optional PDF
// for a week (Monday to Sunday) for every site. On the link the supervisor runs it (or their own topic) and adds
// site-specific points. Setting it again is a new row - the newest is the one used. Managers, Admins and the coordinator.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { UPLOAD_FILE_MAX, UPLOAD_TOO_LARGE } from "@/lib/uploadLimits";
import { readAsDataUrl } from "@/lib/siteDocs/browser";
import { LIMITS } from "@/lib/siteDocs/rules";
import type { topicList } from "@/lib/siteDocs/office";
import { siteDocumentsHref } from "@/lib/documentsTabs"; // back to the Documents page's Site documents (26 Nov 2026)

type Data = Awaited<ReturnType<typeof topicList>>;
const inputCls = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-2 text-sm text-gray-200";
const weekText = (w: string) => `Week of ${new Date(`${w}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" })}`;

export default function TopicPage() {
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState("");
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [keep, setKeep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/site-documents/topic").then(async (r) => {
      if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't load the topics."));
      const x = (await r.json()) as Data;
      setD(x);
      setWeek((w) => w || x.week);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  // Picking a week that has a topic fills the form with it.
  useEffect(() => {
    const t = d?.topics.find((x) => x.week === week);
    setTitle(t?.title ?? ""); setPoints(t?.points.join("\n") ?? ""); setKeep(t?.fileId ?? null); setFile(null);
  }, [week, d]);

  async function save() {
    if (file && file.size > UPLOAD_FILE_MAX) return setError(UPLOAD_TOO_LARGE);
    setBusy(true); setError(null); setSaved(null);
    const dataUrl = file ? await readAsDataUrl(file).catch(() => null) : null;
    const r = await apiFetch("/api/site-documents/topic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week, title, points: points.split("\n"), ...(dataUrl && file ? { dataUrl, fileName: file.name } : keep ? { keepFileId: keep } : {}) }) });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save it."));
    setSaved(`Saved for the ${weekText(week).toLowerCase()}.`);
    load();
  }

  if (loading) return <PageShell title="Topic of the week"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit && !coordinatorOnly) return <PageShell title="Topic of the week"><p className="text-sm text-gray-500">Managers, Admins and the project coordinator only.</p></PageShell>;
  return (
    <PageShell title="Toolbox talk - topic of the week" subtitle="For every site. Supervisors run it on their link (or their own topic) and add points for their site."
      actions={<Link href={siteDocumentsHref()} className="text-xs text-brand-400 hover:underline">← Documents - Site documents</Link>}>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="space-y-3 rounded-xl border border-edge bg-panel p-4">
          {d && (
            <select className={inputCls} value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week">
              {[d.week, d.nextWeek].map((w) => <option key={w} value={w}>{weekText(w)}{w === d.week ? " (this week)" : " (next week)"}</option>)}
            </select>
          )}
          <input className={inputCls} maxLength={LIMITS.title} placeholder="Title - e.g. Silica dust and wet cutting" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="block text-xs text-gray-400">Points - one a line (up to {LIMITS.points})
            <textarea className={`${inputCls} mt-1 min-h-[160px]`} value={points} onChange={(e) => setPoints(e.target.value)} /></label>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
            <span>PDF (optional):</span>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {keep && !file && <span>keeps the PDF already set · <button className="text-amber-300 underline" onClick={() => setKeep(null)}>drop it</button></span>}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {saved && <p className="text-sm text-emerald-300">✓ {saved}</p>}
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || title.trim().length < 3 || !week} onClick={save}>{busy ? "Saving…" : "Save the topic"}</button>
        </section>
        <aside className="rounded-xl border border-edge bg-panel p-4">
          <h2 className="mb-2 font-semibold text-gray-100">Recent topics</h2>
          {!d ? <p className="text-sm text-gray-500">Loading...</p> : d.topics.length === 0 ? <p className="text-sm text-gray-500">None set yet.</p> : (
            <ul className="space-y-2 text-sm">
              {d.topics.map((t) => (
                <li key={t.id} className="border-b border-edge/50 pb-2">
                  <div className="text-xs text-gray-500">{weekText(t.week)}</div>
                  <div className="font-semibold text-gray-100">{t.title}</div>
                  {t.fileId && <a className="text-xs text-brand-300 hover:underline" href={`/api/site-documents/files/${t.fileId}`} target="_blank" rel="noreferrer">PDF</a>}
                  <div className="text-xs text-gray-500">{t.by}</div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
