"use client";

// Directors -> Lessons (LCI phase 5a, 25 Oct 2026): what was learned from
// problems that were fixed and verified (or didn't stay fixed). Everyone with
// director access reads the published ones; only Ilies writes, publishes and
// retires them ("thats me"). A lesson starts from a verified finding, prefilled
// from its own record; published text is never edited - retire and replace.
// Design: docs/lci/PHASE4-5-DESIGN.md §2.
import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import { Card } from "@/components/tracking/parts";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { RESULT_WORDS, type LessonResult } from "@/lib/lessons/rules";
import type { CandidateDTO, LessonDTO } from "@/lib/lessons/store";

type Data = { lessons: LessonDTO[]; candidates: CandidateDTO[]; canPublish: boolean };
type Form = { findingId: string; title: string; situation: string; action: string; lesson: string; tags: string; supersedesId?: string; editId?: string; result?: string | null };

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney" });
const TONE: Record<string, string> = { EFFECTIVE: "text-emerald-300", NOT_EFFECTIVE: "text-amber-300", RECURRED: "text-red-300" };

export default function LessonsPage() {
  const { isDirector, loading } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(() => {
    apiFetch("/api/lessons").then(async (r) => (r.ok ? setD(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load the lessons."))));
  }, []);
  useEffect(() => { if (!loading && isDirector) load(); }, [loading, isDirector, load]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (d?.lessons ?? []).filter((l) => (showRetired || l.status !== "RETIRED") && (!t || [l.title, l.lesson, l.situation, l.action, ...l.tags].join(" ").toLowerCase().includes(t)));
  }, [d, q, showRetired]);

  async function startFrom(c: CandidateDTO, supersedesId?: string) {
    const r = await apiFetch(`/api/lessons?draftFor=${c.id}`);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't prepare the draft."));
    const { draft } = await r.json();
    setForm({ findingId: c.id, title: draft.title, situation: draft.situation, action: draft.action, lesson: "", tags: draft.tags.join(", "), result: draft.result, supersedesId });
  }

  if (loading) return null;
  if (!isDirector) return <PageShell title="Lessons"><p className="text-sm text-gray-500">Only directors can see this page.</p></PageShell>;

  return (
    <PageShell title="Lessons" subtitle="What we learned from problems that were fixed and checked - so the next one goes quicker. Published by Ilies.">
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!d ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p> : (
        <>
          {d.canPublish && d.candidates.length > 0 && (
            <Card className="mb-4">
              <div className="mb-1 text-sm font-semibold text-gray-100">Ready to become a lesson · {d.candidates.length}</div>
              <p className="mb-2 text-[11px] text-gray-500">Problems that were verified fixed, didn&apos;t stay fixed, or came back - with no lesson yet.</p>
              <div className="divide-y divide-edge/60">
                {d.candidates.slice(0, 15).map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="min-w-0 flex-1 text-gray-200">{c.title} <span className={`text-[11px] ${TONE[c.result]}`}>· {RESULT_WORDS[c.result as LessonResult]}</span> <span className="text-[11px] text-gray-500">· {day(c.when)}</span></span>
                    <button onClick={() => startFrom(c)} className="rounded-lg border border-edge px-3 py-1 text-xs text-gray-200 hover:bg-panel2">Make a lesson</button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {form && <LessonForm form={form} setForm={setForm} onDone={(m) => { setFlash(m); setForm(null); load(); }} />}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input className={`${input} max-w-sm`} placeholder="Search lessons, e.g. hire, labour hire, a client" value={q} onChange={(e) => setQ(e.target.value)} />
            {d.lessons.some((l) => l.status === "RETIRED") && <button onClick={() => setShowRetired((v) => !v)} className="text-xs text-gray-400 underline">{showRetired ? "Hide" : "Show"} retired</button>}
          </div>
          {shown.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">{d.lessons.length ? "No lessons match." : "No lessons yet."}</p> : (
            <div className="space-y-3">
              {shown.map((l) => <LessonCard key={l.id} l={l} canPublish={d.canPublish} onDone={(m) => { setFlash(m); load(); }}
                onEdit={() => setForm({ findingId: l.findingId, title: l.title, situation: l.situation, action: l.action, lesson: l.lesson, tags: l.tags.join(", "), editId: l.id, result: l.result })}
                onReplace={() => setForm({ findingId: l.findingId, title: l.title, situation: l.situation, action: l.action, lesson: l.lesson, tags: l.tags.join(", "), supersedesId: l.id, result: l.result })} />)}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}

function LessonCard({ l, canPublish, onDone, onEdit, onReplace }: { l: LessonDTO; canPublish: boolean; onDone: (m: string) => void; onEdit: () => void; onReplace: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setErr(null);
    const r = await apiFetch(`/api/lessons/${l.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: action, ...extra }) });
    setBusy(false);
    if (!r.ok) return setErr(await serverErrorMessage(r, "Couldn't do that."));
    onDone(action === "PUBLISH" ? `Published "${l.title}".` : action === "RETIRE" ? `Retired "${l.title}".` : "Saved.");
  }
  return (
    <Card className={l.status === "RETIRED" ? "opacity-60" : ""}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-100">{l.title}</div>
        <span className={`text-[11px] ${l.status === "PUBLISHED" ? TONE[l.result] : "text-gray-400"}`}>
          {l.status === "DRAFT" ? "Draft - only you see it" : l.status === "RETIRED" ? `Retired${l.retiredReason ? `: ${l.retiredReason}` : ""}` : RESULT_WORDS[l.result as LessonResult]}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-sky-200">{l.lesson}</p>
      <details className="mt-1.5 text-xs text-gray-400">
        <summary className="cursor-pointer text-gray-500">What happened and what was done</summary>
        <p className="mt-1 whitespace-pre-line"><span className="text-gray-500">Situation:</span> {l.situation}</p>
        <p className="mt-1 whitespace-pre-line"><span className="text-gray-500">Done:</span> {l.action}</p>
      </details>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
        {l.tags.map((t) => <span key={t} className="rounded-full bg-panel2 px-2 py-0.5">{t}</span>)}
        <span>{l.publishedAt ? `Published ${day(l.publishedAt)}${l.reviewedBy ? ` by ${l.reviewedBy}` : ""}` : `Drafted ${day(l.createdAt)}`}</span>
      </div>
      {canPublish && (
        <div className="mt-2 flex flex-wrap gap-2">
          {l.status === "DRAFT" && <button disabled={busy} onClick={() => act("PUBLISH")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Publish</button>}
          {l.status === "DRAFT" && <button disabled={busy} onClick={onEdit} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300">Edit</button>}
          {l.status === "PUBLISHED" && <button disabled={busy} onClick={onReplace} className="rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300">Write a corrected one</button>}
          {l.status === "PUBLISHED" && <button disabled={busy} onClick={() => { const r = prompt("Why is this lesson being retired?"); if (r && r.trim()) act("RETIRE", { reason: r }); }} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300">Retire</button>}
        </div>
      )}
      {err && <p className="mt-1 text-sm text-red-400">{err}</p>}
    </Card>
  );
}

function LessonForm({ form, setForm, onDone }: { form: Form; setForm: (f: Form | null) => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  async function save(publish: boolean) {
    setBusy(true); setErr(null);
    const body = { findingId: form.findingId, title: form.title, situation: form.situation, action: form.action, lesson: form.lesson, tags: form.tags, ...(form.supersedesId ? { supersedesId: form.supersedesId } : {}) };
    const r = form.editId
      ? await apiFetch(`/api/lessons/${form.editId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: publish ? "PUBLISH" : "EDIT", ...body }) })
      : await apiFetch("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, publish }) });
    setBusy(false);
    if (!r.ok) return setErr(await serverErrorMessage(r, "Couldn't save it."));
    onDone(publish ? `Published "${form.title}"${form.supersedesId ? " - the old one is retired" : ""}.` : "Draft saved - only you see it.");
  }
  return (
    <Card className="mb-4">
      <div className="mb-1 text-sm font-semibold text-gray-100">{form.supersedesId ? "A corrected lesson" : form.editId ? "Edit the draft" : "Make a lesson"}</div>
      <p className="mb-2 text-[11px] text-gray-500">Prefilled from the finding&apos;s own record - check it, and write the lesson in a sentence or two.{form.result ? ` Outcome: ${RESULT_WORDS[form.result as LessonResult]}.` : ""}</p>
      <div className="space-y-2 text-sm">
        <input className={input} value={form.title} onChange={set("title")} placeholder="Title" />
        <textarea className={input} rows={2} value={form.situation} onChange={set("situation")} placeholder="The situation" />
        <textarea className={input} rows={3} value={form.action} onChange={set("action")} placeholder="What was done" />
        <textarea className={input} rows={2} value={form.lesson} onChange={set("lesson")} placeholder="The lesson - e.g. Call the hire company the day the job finishes; email alone gets missed." autoFocus />
        <input className={input} value={form.tags} onChange={set("tags")} placeholder="Tags, comma separated - e.g. hire, mega hire, swiss hotel" />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => save(true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Publish</button>
          {!form.supersedesId && <button disabled={busy} onClick={() => save(false)} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-200 disabled:opacity-40">Save draft</button>}
          <button onClick={() => setForm(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-400">Cancel</button>
        </div>
      </div>
    </Card>
  );
}
