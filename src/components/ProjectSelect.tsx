"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import {
  CHOICE_LABEL, canReactivateProject, completedPickQuestion, groupProjects, projectOptionLabel, resolveCompletedChoice,
  type CompletedChoice, type PickerProject, type PickQuestion,
} from "@/lib/projectPicker";

// The one project dropdown for office forms (2 Nov 2026, lib/projectPicker.ts): Active, then Inactive, then
// Completed projects in labelled groups, the status in each label. Picking a Completed project asks whether the job
// is active again - "Active again" sends PATCH /api/projects/:id { status: "ACTIVE" } (Manager+; the route checks),
// "Still completed" keeps the pick, "Cancel" leaves the dropdown as it was. Only picks the id - saving is up to the
// form using it. Never used on a site link (those pickers stay active-only).
export default function ProjectSelect<T extends PickerProject>({
  projects, value, onChange, noneLabel, optionLabel, onReactivated, className, ariaLabel,
}: {
  projects: readonly T[];
  value: string;
  onChange: (id: string) => void;
  noneLabel?: string; // the first, "no project" choice (value "") - left out when not given
  optionLabel?: (p: T) => string; // the label before the status words (default: the name)
  onReactivated?: (id: string) => void; // after a successful "Active again", so the page can refresh its list
  className?: string;
  ariaLabel?: string;
}) {
  const { user } = useAuth();
  const canReactivate = canReactivateProject(user?.role);
  // Reactivated here, so the label says Active before the page has reloaded its list.
  const [nowActive, setNowActive] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<{ project: T; q: PickQuestion } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const list = projects.map((p) => (nowActive.has(p.id) ? { ...p, status: "ACTIVE" } : p));
  const groups = groupProjects(list);
  const labelFor = (p: T) => projectOptionLabel(p, optionLabel ? optionLabel(p) : p.name);
  // A value that's no longer in the list (e.g. an archived project) still shows, rather than the form silently
  // reading as "no project".
  const missing = !!value && list.length > 0 && !list.some((p) => p.id === value);

  function pick(id: string) {
    setNote(null);
    const p = list.find((x) => x.id === id) ?? null;
    const q = completedPickQuestion(p, canReactivate, value);
    if (!q || !p) return onChange(id);
    setError(null);
    setAsking({ project: p as T, q });
  }

  async function choose(choice: CompletedChoice) {
    if (!asking) return;
    const { project } = asking;
    const out = resolveCompletedChoice(choice, project.id, value, canReactivate);
    if (out.reactivate) {
      setBusy(true);
      setError(null);
      const res = await apiFetch(`/api/projects/${project.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ACTIVE" }),
      }).catch(() => null);
      setBusy(false);
      if (!res?.ok) {
        setError(res ? await serverErrorMessage(res, "Couldn't set it back to Active.") : "Couldn't reach Operations - check your connection.");
        return; // the question stays open: Still completed or Cancel are still there
      }
      setNowActive((s) => new Set([...s, project.id]));
      setNote(`${project.name} was reactivated - it's Active again.`);
      onReactivated?.(project.id);
    }
    setAsking(null);
    if (out.value !== value) onChange(out.value);
  }

  return (
    <>
      <select value={value} onChange={(e) => pick(e.target.value)} className={className} aria-label={ariaLabel}>
        {noneLabel !== undefined && <option value="">{noneLabel}</option>}
        {missing && <option value={value}>(project no longer listed)</option>}
        {/* Only active projects (e.g. the OFFICE link's list): a plain list, no group heading. */}
        {groups.length === 1 && groups[0].status === "ACTIVE"
          ? groups[0].projects.map((p) => <option key={p.id} value={p.id}>{labelFor(p)}</option>)
          : groups.map((g) => (
            <optgroup key={g.status} label={`— ${g.label} —`}>
              {g.projects.map((p) => <option key={p.id} value={p.id}>{labelFor(p)}</option>)}
            </optgroup>
          ))}
      </select>
      {note && <span className="text-[11px] normal-case tracking-normal text-emerald-400" role="status">{note}</span>}
      {asking && <CompletedQuestion q={asking.q} busy={busy} error={error} onChoose={choose} />}
    </>
  );
}

function CompletedQuestion({ q, busy, error, onChoose }: { q: PickQuestion; busy: boolean; error: string | null; onChoose: (c: CompletedChoice) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  const choose = useRef(onChoose);
  choose.current = onChoose;
  useEffect(() => {
    first.current?.focus();
    // Escape here is Cancel - and must not also close the form underneath (FormModal listens on window).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      choose.current("CANCEL");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const tone: Record<CompletedChoice, string> = {
    REACTIVATE: "bg-brand-600 text-white hover:bg-brand-500",
    KEEP: "border border-edge text-gray-200 hover:bg-panel2",
    CANCEL: "text-gray-400 hover:bg-panel2 hover:text-gray-200",
  };
  // On document.body: the form it sits in is animated (a transform), which would pin a fixed overlay to the form.
  return createPortal(
    // Clicks stay inside: the form underneath closes on an outside click.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 normal-case tracking-normal"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="completed-project-q"
        className="w-full max-w-sm rounded-2xl border border-edge bg-panel p-5 text-sm shadow-soft-lg">
        <p id="completed-project-q" className="text-base font-semibold text-gray-100">{q.question}</p>
        {!q.choices.includes("REACTIVATE") && (
          <p className="mt-2 text-xs text-gray-400">Only a Manager or Admin can set a project back to Active.</p>
        )}
        {error && <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {q.choices.map((c, n) => (
            <button key={c} ref={n === 0 ? first : undefined} type="button" disabled={busy}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChoose(c); }}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50 ${tone[c]}`}>
              {c === "REACTIVATE" && busy ? "Setting it to Active..." : CHOICE_LABEL[c]}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
