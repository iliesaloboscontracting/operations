"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardList, FileText, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import PageShell from "@/components/PageShell";
import FormModal from "@/components/FormModal";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { PROJECT_FORM_FIELDS } from "@/lib/projectFormFields";
import { fmtDay } from "@/lib/dates";
import { isOfficeStaff } from "@/lib/resource";
import {
  COMPLETION_TBC,
  parseSources,
  PROJECT_FILE_FIELDS,
  ProjectFileField,
  VISIBLE_TO,
  VISIBLE_TO_LABEL,
  VisibleTo,
} from "@/lib/projectFile";
import type { ProjectContactDTO, ProjectFileDTO, ResourceDTO } from "@/lib/types";
import { DATE_CONFIDENCE, DATE_CONFIDENCE_LABEL } from "@/lib/dateRules";

// The Project File (Operations Analyst brief 11, Phase 1): everything about a
// site in one place, in four tabs. Blank always reads "Not known yet" - nothing
// here fills in a default, and nothing marks a project READY. Viewer logins
// (crew) see it read-only, with only crew-visible contacts and no internal
// notes or contract figures (the API strips those).

type Tab = "overview" | "site" | "contacts" | "scope";
const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["site", "Site"],
  ["contacts", "Contacts"],
  ["scope", "Scope"],
];

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const btnPrimary =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-500 active:scale-[0.98] disabled:opacity-50";
const btnQuiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-panel2";

const SCOPE_FIELD: ProjectFileField = { key: "scopeOfWorks", label: "Scope of works", tab: "scope", multiline: true };

function Unknown() {
  return <span className="italic text-gray-500">Not known yet</span>;
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-3 border-t border-edge py-2 first:border-t-0 first:pt-0 text-sm">
      <div className="text-gray-500">{label}</div>
      <div className="min-w-0 whitespace-pre-line text-gray-200">{children}</div>
    </div>
  );
}

// A set of Project File text fields, each with an optional source note,
// edited together and saved with one button. Read-only for Viewers.
function FieldSet({
  project,
  fields,
  canEdit,
  onSave,
}: {
  project: ProjectFileDTO;
  fields: ProjectFileField[];
  canEdit: boolean;
  onSave: (values: Record<string, string>, sources: Record<string, string>) => Promise<void>;
}) {
  const sources = useMemo(() => parseSources(project.fieldSources), [project.fieldSources]);
  const initialValues = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.key, ((project as any)[f.key] as string | null) ?? ""])),
    [fields, project]
  );
  const initialSources = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.key, sources[f.key] ?? ""])),
    [fields, sources]
  );
  const [values, setValues] = useState(initialValues);
  const [srcs, setSrcs] = useState(initialSources);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValues(initialValues);
    setSrcs(initialSources);
  }, [initialValues, initialSources]);

  const dirty = fields.some((f) => values[f.key] !== initialValues[f.key] || srcs[f.key] !== initialSources[f.key]);

  if (!canEdit) {
    return (
      <div>
        {fields.map((f) => (
          <Row key={f.key} label={f.label}>
            {initialValues[f.key] ? initialValues[f.key] : <Unknown />}
          </Row>
        ))}
      </div>
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(values, srcs);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            {f.label}
            {f.hint && <span className="ml-1.5 font-normal text-gray-500">— {f.hint}</span>}
          </label>
          {f.multiline ? (
            <textarea
              rows={f.key === "scopeOfWorks" ? 8 : 3}
              className={input}
              placeholder="Not known yet"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          ) : (
            <input
              className={input}
              placeholder="Not known yet"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          )}
          <input
            className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-gray-400 placeholder:text-gray-600 hover:border-edge focus:border-edge focus:outline-none"
            placeholder="Source (document and revision) — optional"
            value={srcs[f.key]}
            onChange={(e) => setSrcs((s) => ({ ...s, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="flex items-center gap-3">
        <button className={btnPrimary} disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && (
          <button
            className="text-xs text-gray-500 hover:text-gray-300"
            onClick={() => {
              setValues(initialValues);
              setSrcs(initialSources);
              setError(null);
            }}
          >
            Undo changes
          </button>
        )}
        {saved && !dirty && <span className="text-xs text-emerald-500">Saved</span>}
      </div>
    </div>
  );
}

const EMPTY_CONTACT = { name: "", company: "", role: "", phone: "", email: "", visibleTo: "INTERNAL", source: "" };

function ContactForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: typeof EMPTY_CONTACT;
  onSave: (v: typeof EMPTY_CONTACT) => Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY_CONTACT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return setError("A contact needs a name.");
    setSaving(true);
    setError(null);
    try {
      await onSave(v);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-edge bg-panel2/50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={input} placeholder="Name *" value={v.name} onChange={set("name")} />
        <input className={input} placeholder="Company" value={v.company} onChange={set("company")} />
        <input className={input} placeholder="Role (e.g. Site manager)" value={v.role} onChange={set("role")} />
        <input className={input} placeholder="Phone" value={v.phone} onChange={set("phone")} />
        <input className={input} placeholder="Email" value={v.email} onChange={set("email")} />
        <select className={input} value={v.visibleTo} onChange={set("visibleTo")} aria-label="Visible to">
          {VISIBLE_TO.map((o) => (
            <option key={o} value={o}>
              Visible to: {VISIBLE_TO_LABEL[o]}
            </option>
          ))}
        </select>
      </div>
      <input
        className={input}
        placeholder="Source (document and revision) — optional"
        value={v.source}
        onChange={set("source")}
      />
      {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={saving}>
          {saving ? "Saving…" : "Save contact"}
        </button>
        <button type="button" className={btnQuiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ContactsTab({
  project,
  canEdit,
  reload,
}: {
  project: ProjectFileDTO;
  canEdit: boolean;
  reload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);

  async function send(url: string, method: string, body?: unknown) {
    const res = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save that contact."));
    await reload();
  }

  const base = `/api/projects/${project.id}/contacts`;
  const toForm = (c: ProjectContactDTO) => ({
    name: c.name,
    company: c.company ?? "",
    role: c.role ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    visibleTo: c.visibleTo,
    source: c.source ?? "",
  });

  return (
    <div className="space-y-4">
      <Card title="Lobos staff">
        <p className="mb-2 text-xs text-gray-500">From the Personnel register — not retyped here.</p>
        <Row label="Current supervisor">
          <SupervisorText project={project} />
        </Row>
        <Row label="Office contact">
          {project.officeContact ? (
            <>
              {project.officeContact.name}
              {project.officeContact.phone && <span className="text-gray-400"> · {project.officeContact.phone}</span>}
            </>
          ) : (
            <Unknown />
          )}
        </Row>
      </Card>

      <Card
        title="Client, builder and consultants"
        action={
          canEdit && editing === null ? (
            <button className={btnQuiet} onClick={() => setEditing("new")}>
              <Plus size={13} /> Add contact
            </button>
          ) : undefined
        }
      >
        {editing === "new" && (
          <div className="mb-3">
            <ContactForm
              initial={EMPTY_CONTACT}
              onCancel={() => setEditing(null)}
              onSave={async (v) => {
                await send(base, "POST", v);
                setEditing(null);
              }}
            />
          </div>
        )}
        {project.contacts.length === 0 && editing !== "new" && (
          <p className="text-sm text-gray-500">
            {canEdit ? "No external contacts yet." : "No contacts have been shared with crew for this site yet."}
          </p>
        )}
        <ul className="divide-y divide-edge">
          {project.contacts.map((c) =>
            editing === c.id ? (
              <li key={c.id} className="py-3">
                <ContactForm
                  initial={toForm(c)}
                  onCancel={() => setEditing(null)}
                  onSave={async (v) => {
                    await send(`${base}/${c.id}`, "PATCH", v);
                    setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={c.id} className="flex items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-gray-100">
                    {c.name}
                    {(c.role || c.company) && (
                      <span className="font-normal text-gray-400">
                        {" "}— {[c.role, c.company].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-400">
                    {c.phone && <a href={`tel:${c.phone.replace(/\s+/g, "")}`}>{c.phone}</a>}
                    {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                    {!c.phone && !c.email && <span className="italic text-gray-500">No phone or email yet</span>}
                  </div>
                  {c.source && <div className="mt-0.5 text-[11px] text-gray-500">Source: {c.source}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {canEdit && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        c.visibleTo === "INTERNAL" ? "bg-gray-700 text-gray-300" : "bg-brand-900/70 text-brand-200"
                      }`}
                    >
                      {VISIBLE_TO_LABEL[c.visibleTo as VisibleTo]}
                    </span>
                  )}
                  {canEdit && editing === null && (
                    <>
                      <button className="text-gray-500 hover:text-gray-200" title="Edit" onClick={() => setEditing(c.id)}>
                        <Pencil size={14} />
                      </button>
                      <button
                        className="text-gray-500 hover:text-red-400"
                        title="Remove"
                        onClick={async () => {
                          if (confirm(`Remove ${c.name} from this project's contacts?`)) {
                            await send(`${base}/${c.id}`, "DELETE");
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          )}
        </ul>
      </Card>
    </div>
  );
}

function SupervisorText({ project }: { project: ProjectFileDTO }) {
  const s = project.currentSupervisor;
  if (!s) return <span className="italic text-gray-500">No supervisor allocated yet</span>;
  return (
    <>
      {s.people.map((p, i) => (
        <span key={p.id}>
          {i > 0 && ", "}
          {p.name}
          {p.role === "Lead" && <span className="text-gray-400"> (Lead)</span>}
          {p.phone && <span className="text-gray-400"> · {p.phone}</span>}
        </span>
      ))}
      <span className="block text-[11px] text-gray-500">
        From the allocation on {fmtDay(s.date, { weekday: "short", day: "numeric", month: "short" })}
        {s.shift === "NIGHT" ? " (night)" : ""}
      </span>
    </>
  );
}

export default function ProjectFilePage({ params }: { params: { id: string } }) {
  const { canEdit } = useAuth();
  const [project, setProject] = useState<ProjectFileDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editingDetails, setEditingDetails] = useState(false);
  const [officeStaff, setOfficeStaff] = useState<ResourceDTO[]>([]);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${params.id}`);
    if (!res.ok) {
      setLoadError(await serverErrorMessage(res, "Couldn't load this project."));
      return;
    }
    setProject(await res.json());
    setLoadError(null);
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canEdit) return;
    apiFetch("/api/resources?type=PERSONNEL")
      .then((r) => (r.ok ? r.json() : []))
      .then((rs: ResourceDTO[]) => setOfficeStaff(rs.filter(isOfficeStaff)));
  }, [canEdit]);

  // Saves Project File fields plus their source notes (merged into the
  // existing notes, so saving one tab never wipes another tab's sources).
  async function saveFields(values: Record<string, string>, srcs: Record<string, string>) {
    if (!project) return;
    const merged = { ...parseSources(project.fieldSources), ...srcs };
    const res = await apiFetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, fieldSources: merged }),
    });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Save failed"));
    await load();
  }

  async function saveDetails(values: Record<string, any>) {
    if (!project) return;
    const body = Object.fromEntries(PROJECT_FORM_FIELDS.map((f) => [f.key, values[f.key]]));
    const res = await apiFetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await serverErrorMessage(res, "Save failed"));
    await load();
  }

  async function toggleArchive() {
    if (!project) return;
    await apiFetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !project.archived }),
    });
    await load();
  }

  if (loadError) {
    return (
      <PageShell title="Project">
        <p className="text-sm text-red-400">{loadError}</p>
        <Link href="/projects" className="mt-3 inline-block text-sm text-brand-500 hover:text-brand-400">
          ← Back to Projects
        </Link>
      </PageShell>
    );
  }
  if (!project) return <PageShell title="Project">{null}</PageShell>;

  const fieldsFor = (t: ProjectFileField["tab"]) => PROJECT_FILE_FIELDS.filter((f) => f.tab === t);
  const subtitle = [project.client, project.jobNo, project.address].filter(Boolean).join(" · ") || undefined;
  const c = project.completeness;

  return (
    <PageShell
      title={project.name}
      subtitle={subtitle}
      actions={
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/projects" className={btnQuiet}>
            <ArrowLeft size={13} /> Projects
          </Link>
          <a
            href={`/api/projects/${project.id}/scope-pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnQuiet}
          >
            <FileText size={13} /> Scope PDF
          </a>
        </div>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-full bg-panel2 p-1 text-xs">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3.5 py-1 font-medium ${
                tab === t ? "bg-panel text-gray-100 shadow-sm" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {c && project.status === "ACTIVE" && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-gray-400"
            title={c.missing.length ? `Not filled in yet: ${c.missing.join(", ")}` : undefined}
          >
            <ClipboardList size={13} />
            Project file {c.filled}/{c.total} filled in
          </span>
        )}
        {project.archived && (
          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase text-gray-300">
            Archived
          </span>
        )}
      </div>

      <div className="max-w-3xl space-y-4">
        {tab === "overview" && (
          <>
            <Card
              title="Project details"
              action={
                canEdit ? (
                  <button className={btnQuiet} onClick={() => setEditingDetails(true)}>
                    <Pencil size={13} /> Edit details
                  </button>
                ) : undefined
              }
            >
              <Row label="Client">{project.client || <Unknown />}</Row>
              <Row label="Job number">{project.jobNo || <Unknown />}</Row>
              <Row label="Address">{project.address || <Unknown />}</Row>
              <Row label="Status">{project.status === "ACTIVE" ? "Active" : project.status === "INACTIVE" ? "Inactive" : "Completed"}</Row>
              <Row label="Start date">
                {project.startDate ? fmtDay(project.startDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : <Unknown />}
              </Row>
              <Row label="Shift hours">
                {project.dayStart || project.nightStart ? (
                  [
                    project.dayStart && `Day ${project.dayStart}${project.dayEnd ? `–${project.dayEnd}` : ""}`,
                    project.nightStart && `Night ${project.nightStart}${project.nightEnd ? `–${project.nightEnd}` : ""}`,
                  ]
                    .filter(Boolean)
                    .join("   ")
                ) : (
                  <Unknown />
                )}
              </Row>
              {canEdit && <Row label="Notes (internal)">{project.notes || <span className="text-gray-500">—</span>}</Row>}
            </Card>

            <Card title="Timing and people">
              <Row label="Current supervisor">
                <SupervisorText project={project} />
              </Row>
              <div className="border-t border-edge pt-3">
                <OverviewFields project={project} canEdit={canEdit} officeStaff={officeStaff} onSave={saveFields} />
              </div>
            </Card>

            {canEdit && (project.dateExceptions?.length ?? 0) > 0 && (
              <Card title="Date exceptions">
                <ul className="space-y-1 text-sm text-amber-600">
                  {project.dateExceptions!.map((d) => (
                    <li key={d}>• {d}</li>
                  ))}
                </ul>
              </Card>
            )}

            {c && c.missing.length > 0 && (
              <Card title="Not filled in yet">
                <p className="text-sm text-gray-400">{c.missing.join(" · ")}</p>
              </Card>
            )}
          </>
        )}

        {tab === "site" && (
          <Card title="Site">
            <FieldSet project={project} fields={fieldsFor("site")} canEdit={canEdit} onSave={saveFields} />
          </Card>
        )}

        {tab === "contacts" && <ContactsTab project={project} canEdit={canEdit} reload={load} />}

        {tab === "scope" && (
          <Card title="Scope">
            <p className="mb-3 text-xs text-gray-500">
              Goes into the scope PDF that travels with the crew allocation — never include a dollar figure.
            </p>
            <FieldSet project={project} fields={[SCOPE_FIELD, ...fieldsFor("scope")]} canEdit={canEdit} onSave={saveFields} />
          </Card>
        )}
      </div>

      {editingDetails && (
        <FormModal
          title="Edit project details"
          fields={PROJECT_FORM_FIELDS}
          initial={project as any}
          onSave={saveDetails}
          onClose={() => setEditingDetails(false)}
          onDelete={toggleArchive}
          deleteLabel={project.archived ? "Unarchive" : "Archive"}
        />
      )}
    </PageShell>
  );
}

// Overview's dates and office contact (brief 11, extended by brief 12).
// Start date = our demo crew's first day on site (D12-1). Each planned date carries how
// firm it is (Confirmed / Tentative) and where it came from; the board's own
// first and last days are shown beside them, never typed.
function OverviewFields({
  project,
  canEdit,
  officeStaff,
  onSave,
}: {
  project: ProjectFileDTO;
  canEdit: boolean;
  officeStaff: ResourceDTO[];
  onSave: (values: Record<string, string>, sources: Record<string, string>) => Promise<void>;
}) {
  const fromProject = (p: ProjectFileDTO) => {
    const s = parseSources(p.fieldSources);
    return {
      startDate: p.startDate ?? "",
      startDateConfidence: p.startDateConfidence ?? "",
      srcStart: s.startDate ?? "",
      expectedCompletion: p.expectedCompletion ?? "",
      completionConfidence: p.completionConfidence ?? "",
      completionReviewBy: p.completionReviewBy ?? "",
      srcCompletion: s.expectedCompletion ?? "",
      officeContactId: p.officeContactId ?? "",
      srcOffice: s.officeContactId ?? "",
    };
  };
  const init = fromProject(project);
  const [v, setV] = useState(init);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setV(fromProject(project));
  }, [project]);
  const dirty = (Object.keys(init) as (keyof typeof init)[]).some((k) => v[k] !== init[k]);
  const set = (k: keyof typeof init) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  const long = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const conf = (c: string | null | undefined) => (c ? ` · ${DATE_CONFIDENCE_LABEL[c] ?? c}` : "");
  const tbc = project.expectedCompletion === COMPLETION_TBC;
  const completionText = tbc
    ? `TBC${project.completionReviewBy ? ` · review by ${long(project.completionReviewBy)}` : ""}`
    : project.expectedCompletion
    ? `${long(project.expectedCompletion)}${conf(project.completionConfidence)}`
    : null;
  const startMismatch =
    !!project.startDate &&
    !!project.firstJobDate &&
    project.startDate !== project.firstJobDate &&
    !(project.predatesBoard && project.startDate < project.firstJobDate);

  // What the board says actually happened - shown to everyone, never edited.
  const boardRows = (
    <>
      <Row label="Our crew's first day (board)">
        {project.firstJobDate ? (
          <>
            {long(project.firstJobDate)}
            {project.predatesBoard && (
              <span className="ml-1 text-[11px] text-gray-500">(the board started then — the project began earlier)</span>
            )}
            {startMismatch && (
              <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                Doesn&apos;t match start date
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-500">No job on the board yet</span>
        )}
      </Row>
      <Row label={project.status === "COMPLETED" ? "Actual finish" : "Last day booked"}>
        {project.lastJobDate ? long(project.lastJobDate) : <span className="text-gray-500">—</span>}
      </Row>
    </>
  );

  if (!canEdit) {
    return (
      <>
        <Row label="Start date (our demo crew's first day on site)">
          {project.startDate ? `${long(project.startDate)}${conf(project.startDateConfidence)}` : <Unknown />}
        </Row>
        <Row label="Expected completion">{completionText ?? <Unknown />}</Row>
        {boardRows}
        <Row label="Lobos office contact">
          {project.officeContact ? (
            <>
              {project.officeContact.name}
              {project.officeContact.phone && <span className="text-gray-400"> · {project.officeContact.phone}</span>}
            </>
          ) : (
            <Unknown />
          )}
        </Row>
      </>
    );
  }

  const srcInput =
    "mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-gray-400 placeholder:text-gray-600 hover:border-edge focus:border-edge focus:outline-none";
  const confSelect = (k: "startDateConfidence" | "completionConfidence") => (
    <select className={`${input} w-32 shrink-0`} value={v[k]} onChange={set(k)} title="How firm is this date?">
      <option value="">Firmness?</option>
      {DATE_CONFIDENCE.map((c) => (
        <option key={c} value={c}>
          {DATE_CONFIDENCE_LABEL[c]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">Start date (our demo crew&apos;s first day on site)</label>
          <div className="flex items-center gap-2">
            <input type="date" className={input} value={v.startDate} onChange={set("startDate")} />
            {confSelect("startDateConfidence")}
          </div>
          {project.firstJobDate && !project.predatesBoard && v.startDate !== project.firstJobDate && (
            <button
              type="button"
              className="mt-1 text-left text-[11px] text-amber-600 hover:underline"
              onClick={() =>
                setV((x) => ({
                  ...x,
                  startDate: project.firstJobDate!,
                  startDateConfidence: "CONFIRMED",
                  srcStart: "Command Centre board (our crew's first day)",
                }))
              }
            >
              Our crew&apos;s first day on the board is {long(project.firstJobDate)} — use that
            </button>
          )}
          <input className={srcInput} placeholder="Source (document and revision) — optional" value={v.srcStart} onChange={set("srcStart")} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">Expected completion</label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className={input}
              disabled={v.expectedCompletion === COMPLETION_TBC}
              value={v.expectedCompletion === COMPLETION_TBC ? "" : v.expectedCompletion}
              onChange={set("expectedCompletion")}
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={v.expectedCompletion === COMPLETION_TBC}
                onChange={(e) => setV((x) => ({ ...x, expectedCompletion: e.target.checked ? COMPLETION_TBC : "" }))}
              />
              TBC
            </label>
            {v.expectedCompletion !== COMPLETION_TBC && confSelect("completionConfidence")}
          </div>
          {v.expectedCompletion === COMPLETION_TBC && (
            <div className="mt-2 flex items-center gap-2">
              <label className="shrink-0 text-[11px] text-gray-400">Review by</label>
              <input type="date" className={input} value={v.completionReviewBy} onChange={set("completionReviewBy")} />
            </div>
          )}
          <input className={srcInput} placeholder="Source (document and revision) — optional" value={v.srcCompletion} onChange={set("srcCompletion")} />
        </div>
      </div>
      <div className="rounded-md border border-edge px-3 py-2">{boardRows}</div>
      <div className="sm:w-1/2 sm:pr-2">
        <label className="mb-1 block text-xs font-medium text-gray-400">Lobos office contact</label>
        <select className={input} value={v.officeContactId} onChange={set("officeContactId")}>
          <option value="">Not known yet</option>
          {officeStaff.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {officeStaff.length === 0 && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-gray-500">
            <UserRound size={11} /> Add office staff in Labour with the role “Office” to pick them here.
          </p>
        )}
        <input className={srcInput} placeholder="Source (document and revision) — optional" value={v.srcOffice} onChange={set("srcOffice")} />
      </div>
      {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      <button
        className={btnPrimary}
        disabled={!dirty || saving}
        onClick={async () => {
          setSaving(true);
          setError(null);
          try {
            const isTbc = v.expectedCompletion === COMPLETION_TBC;
            await onSave(
              {
                startDate: v.startDate,
                startDateConfidence: v.startDate ? v.startDateConfidence : "",
                expectedCompletion: v.expectedCompletion,
                completionConfidence: isTbc || !v.expectedCompletion ? "" : v.completionConfidence,
                completionReviewBy: isTbc ? v.completionReviewBy : "",
                officeContactId: v.officeContactId,
              },
              { startDate: v.srcStart, expectedCompletion: v.srcCompletion, officeContactId: v.srcOffice }
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
