"use client";

// Xero exports (G2, 25 Oct 2026): accounts uploads the sales-invoice export,
// the bills export or the Profit and Loss report from Xero; invoices that
// can't be tied to a job wait here for accounts or a director to pick one
// (remembered for later uploads). Shown on Invoices -> Xero exports for the
// accounts login and on Directors -> Accounts data. Manual exports: every
// figure built from them is "as at" the export date.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Upload } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { jobLabel, searchJobs } from "@/lib/jobSearch";
import { fmtDay } from "@/lib/dates";
import { NO_SITE, siteOf } from "@/lib/xero/siteGroup";
import { localISODate as todayLocal, money } from "@/lib/resource";

type Kind = "INVOICES" | "BILLS" | "PNL";
const KINDS: { k: Kind; label: string; hint: string }[] = [
  { k: "INVOICES", label: "Sales invoices", hint: "Xero → Business → Invoices → Export (all, including paid), .csv" },
  { k: "PNL", label: "Profit and Loss", hint: "Xero → Accounting → Reports → Profit and Loss, by month, Export → Excel" },
  { k: "BILLS", label: "Bills (optional)", hint: "Xero → Business → Bills to pay → Export, .csv - only checked against Operations, never added to job costs" },
];
const KIND_LABEL: Record<string, string> = { INVOICES: "Sales invoices", BILLS: "Bills", PNL: "Profit and Loss", SYNC: "Xero sync" };

type Imp = { id: string; kind: string; status: string; error: string | null; originalName: string | null; asAt: string | null; periodFrom: string | null; periodTo: string | null; rows: number; uploadedBy: string | null; createdAt: string };
type Line = { id: string; description: string | null; amountExGst: number; tracking1: string | null; tracking2: string | null; projectId: string | null; matchMethod: string | null };
type Inv = { id: string; key: string; type: string; number: string; reference: string | null; contact: string; date: string; totalExGst: number; matchMethod: string; suggest: string | null; lines: Line[] };
type Project = { id: string; name: string; jobNo: string | null; client: string | null; address: string | null; status: string; archived: boolean };

const day = (d: string | null) => (d ? fmtDay(d, { day: "numeric", month: "short", year: "numeric" }) : "—");
const select = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-2 text-sm text-gray-200 focus:border-brand-500 focus:outline-none";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That file couldn't be opened."));
    r.readAsDataURL(file);
  });
}

export default function XeroExports() {
  const [imports, setImports] = useState<Imp[] | null>(null);
  const [review, setReview] = useState<{ asAt: string | null; invoices: Inv[]; projects: Project[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.all([apiFetch("/api/xero/imports"), apiFetch("/api/xero/review")])
      .then(async ([a, b]) => {
        if (!a.ok || !b.ok) throw new Error(await serverErrorMessage(a.ok ? b : a, "Couldn't load the Xero exports."));
        setImports((await a.json()).imports);
        setReview(await b.json());
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!imports || !review) return <p className="text-sm text-gray-500">Loading...</p>;
  return (
    <div className="max-w-5xl space-y-5">
      <UploadForm onDone={load} />
      <Review data={review} onDone={load} />
      <Recent imports={imports} />
    </div>
  );
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<Kind>("INVOICES");
  const [asAt, setAsAt] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function send(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/xero/imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl: await readAsDataUrl(f), originalName: f.name, kind, asAt }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Upload failed."));
      const r = (await res.json()) as { status: string; rows: number; error: string | null };
      setMsg(r.status === "DONE" ? { ok: true, text: `Read ${r.rows} ${kind === "PNL" ? "lines" : "invoices"} from ${f.name}.` } : { ok: false, text: r.error ?? "The file couldn't be read." });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div className="rounded-2xl border border-edge bg-panel p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-100">Upload a Xero export</h2>
      <p className="mb-3 text-[12px] text-gray-500">Once a month is enough. The newest upload of each kind replaces the last one on the Directors screen; earlier files are kept.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="text-[12px] text-gray-400">
          What it is
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={`${select} mt-1`}>
            {KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-gray-400">
          Exported on
          <input type="date" value={asAt} max={todayLocal()} onChange={(e) => setAsAt(e.target.value)} className={`${select} mt-1`} />
        </label>
        <button disabled={busy} onClick={() => file.current?.click()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-40">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Choose file
        </button>
        <input ref={file} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => send(e.target.files?.[0])} />
      </div>
      <p className="mt-2 text-[11px] text-gray-500">{KINDS.find((k) => k.k === kind)?.hint}</p>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}

// Search text for an invoice (Victoria, 28 Oct 2026: type "Randwick" and see only the Randwick invoices): number,
// customer, reference and line descriptions. Every typed word must appear, any order, any case.
const invText = (i: Inv) => [i.number, i.contact, i.reference, ...i.lines.map((l) => l.description)].filter(Boolean).join(" ").toLowerCase();
const matchesAll = (text: string, q: string) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));

async function saveMatch(key: string, projectId: string | null) {
  const res = await apiFetch("/api/xero/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, projectId }) });
  if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save."));
}

const signed = (i: Inv) => (i.type.endsWith("CREDIT") ? -i.totalExGst : i.totalExGst);

// "Not tied to a job" (Ilies, 28 Oct 2026: "one search bar, brings up all thats relevant to that search for this
// function"). ONE search bar finds both the invoices (grouped by assumed site) and the jobs (as buttons). Tick the
// invoices - ticks stay through a new search, so search the invoices, tick, then search the job - and tap the job to
// tie them all. Each invoice still saves through the same /api/xero/review call, one after another.
function Review({ data, onDone }: { data: { asAt: string | null; invoices: Inv[]; projects: Project[] }; onDone: () => void }) {
  const live = data.projects.filter((p) => !p.archived);
  const name = new Map(data.projects.map((p) => [p.id, p.name]));
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const searching = !!q.trim();
  const shown = searching ? data.invoices.filter((i) => matchesAll(invText(i), q)) : data.invoices;
  const jobs = searching ? searchJobs(live, q, 8) : [];
  const chosen = data.invoices.filter((i) => ticked.has(i.key));
  const toggle = (keys: string[], on: boolean) => setTicked((s) => { const n = new Set(s); for (const k of keys) { if (on) n.add(k); else n.delete(k); } return n; });
  const allShownTicked = shown.length > 0 && shown.every((i) => ticked.has(i.key));
  // Grouped by assumed site, groups A-Z (the no-site group last).
  const groups = [...shown.reduce((m, i) => m.set(siteOf(i.reference), [...(m.get(siteOf(i.reference)) ?? []), i]), new Map<string, Inv[]>())]
    .sort(([a], [b]) => (a === NO_SITE ? 1 : b === NO_SITE ? -1 : a.localeCompare(b)));
  async function saveMany(list: Inv[], projectId: string | null) {
    const what = projectId ? `Tie ${list.length} invoice${list.length === 1 ? "" : "s"} to ${name.get(projectId) ?? "this job"}?` : `Mark ${list.length} invoice${list.length === 1 ? "" : "s"} as not a job?`;
    if (!confirm(what)) return;
    setBusy(true);
    setMsg(null);
    const failed: string[] = [];
    for (const i of list) {
      try { await saveMatch(i.key, projectId); } catch (e) { failed.push(`${i.number}: ${(e as Error).message}`); }
    }
    const done = list.length - failed.length;
    const result = projectId ? `tied to ${name.get(projectId) ?? "the job"}` : "marked not a job";
    setMsg(failed.length ? { ok: false, text: `${done} ${result}. Not saved - ${failed.join("; ")}` } : { ok: true, text: `${done} invoice${done === 1 ? "" : "s"} ${result}.` });
    setTicked(new Set());
    setBusy(false);
    onDone();
  }
  return (
    <div className="rounded-2xl border border-edge bg-panel p-4">
      <h2 className="text-sm font-semibold text-gray-100">Not tied to a job</h2>
      <p className="mb-3 text-[12px] text-gray-500">
        {data.asAt ? `Sales invoices in the upload as at ${day(data.asAt)} that couldn't be matched to a job. Your choice is remembered for later uploads.` : "Upload a sales-invoice export to see this list."}
      </p>
      {data.asAt && !data.invoices.length && <p className="text-sm text-emerald-400">Every sales invoice is tied to a job.</p>}
      {data.invoices.length > 0 && (
        <div className="mb-3 space-y-3">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices and jobs"
            placeholder="Search - site, customer, invoice number or job (e.g. Randwick)" className={select} />
          {searching && (
            <div>
              <p className="mb-1.5 text-[12px] text-gray-400">
                Jobs{jobs.length ? (chosen.length ? ` - tap one to tie the ${chosen.length} ticked invoice${chosen.length === 1 ? "" : "s"}` : " - tick invoices below, then tap a job") : ""}
              </p>
              {jobs.length ? (
                <div className="flex flex-wrap gap-2">
                  {jobs.map((j) => (
                    <button key={j.id} type="button" disabled={busy || !chosen.length} onClick={() => saveMany(chosen, j.id)}
                      className="rounded-full border border-brand-500/60 bg-panel2 px-3 py-1.5 text-sm text-gray-100 hover:bg-brand-600 hover:text-white disabled:cursor-default disabled:opacity-60 disabled:hover:bg-panel2 disabled:hover:text-gray-100">
                      {jobLabel(j)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-gray-500">No job matches &quot;{q}&quot; - type part of the job&apos;s name, number, client or address.</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-gray-400">
            <span>{groups.length} site group{groups.length === 1 ? "" : "s"} · {searching ? `${shown.length} of ${data.invoices.length} invoices` : `${data.invoices.length} invoices`}</span>
            {shown.length > 0 && (
              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={allShownTicked} onChange={() => toggle(shown.map((i) => i.key), !allShownTicked)} />
                Tick all shown
              </label>
            )}
          </div>
          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-panel2 px-3 py-2">
              <span className="text-sm text-gray-200">{chosen.length} ticked</span>
              <span className="text-[12px] text-gray-500">{searching && jobs.length ? "- tap a job above to tie them" : "- search the job's name, then tap it to tie them"}</span>
              <button disabled={busy} onClick={() => saveMany(chosen, null)} className="ml-auto rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel disabled:opacity-40">Not a job</button>
              <button disabled={busy} onClick={() => setTicked(new Set())} className="px-2 py-1.5 text-[12px] text-gray-400 hover:text-gray-200">Clear</button>
              {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
            </div>
          )}
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
        </div>
      )}
      {data.invoices.length > 0 && !shown.length && <p className="text-sm text-gray-500">No invoice matches &quot;{q}&quot;.</p>}
      <div className="space-y-3">
        {groups.map(([site, list]) => (
          <SiteGroup key={site} site={site} list={list} allTicked={list.every((i) => ticked.has(i.key))} onTickAll={(on) => toggle(list.map((i) => i.key), on)}>
            {list.map((i) => <ReviewRow key={i.id} i={i} name={name} busy={busy} ticked={ticked.has(i.key)} onTick={() => toggle([i.key], !ticked.has(i.key))} onSave={(projectId) => saveMany([i], projectId)} />)}
          </SiteGroup>
        ))}
      </div>
    </div>
  );
}

// One assumed site: its invoices and their total, with one tick box for the whole group.
function SiteGroup({ site, list, allTicked, onTickAll, children }: { site: string; list: Inv[]; allTicked: boolean; onTickAll: (on: boolean) => void; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const total = list.reduce((s, i) => s + signed(i), 0);
  return (
    <section className="rounded-xl border border-edge">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-panel2 px-3 py-2">
        <input type="checkbox" checked={allTicked} onChange={() => onTickAll(!allTicked)} aria-label={`Tick all ${site} invoices`} />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 items-baseline gap-2 text-left">
          <span className="text-gray-400">{open ? "▾" : "▸"}</span>
          <span className="text-sm font-semibold text-gray-100">{site}</span>
          <span className="text-[12px] text-gray-400">· {list.length} invoice{list.length === 1 ? "" : "s"} · {money(total)} ex GST</span>
        </button>
      </div>
      {open && <ul className="divide-y divide-edge px-3">{children}</ul>}
    </section>
  );
}

// One invoice: its tick box and "Not a job". A job suggested from the site name can be accepted with one tap.
function ReviewRow({ i, name, busy, ticked, onTick, onSave }: { i: Inv; name: Map<string, string>; busy: boolean; ticked: boolean; onTick: () => void; onSave: (projectId: string | null) => void }) {
  const credit = i.type.endsWith("CREDIT");
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label className="flex min-w-0 items-baseline gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={ticked} onChange={onTick} aria-label={`Tick ${i.number}`} className="translate-y-0.5" />
          <span>
            {credit ? "Credit note " : ""}{i.number} · {i.contact}
            <span className="text-gray-500"> · {day(i.date)}{i.reference ? ` · ref "${i.reference}"` : ""}</span>
          </span>
        </label>
        <div className="flex items-baseline gap-3">
          <span className="text-sm font-medium text-gray-100">{credit ? "-" : ""}{money(i.totalExGst)} <span className="text-[11px] font-normal text-gray-500">ex GST</span></span>
          <button disabled={busy} onClick={() => onSave(null)} className="rounded-lg border border-edge px-2.5 py-1 text-[12px] text-gray-300 hover:bg-panel2 disabled:opacity-40">Not a job</button>
        </div>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12px] text-gray-500">
        {i.lines.slice(0, 4).map((l) => (
          <li key={l.id}>{l.description || "No description"}{l.tracking1 ? ` · ${l.tracking1}` : ""} · {money(l.amountExGst)}{l.projectId ? ` · ${name.get(l.projectId) ?? "a job"}` : ""}</li>
        ))}
        {i.lines.length > 4 && <li>and {i.lines.length - 4} more lines</li>}
      </ul>
      {i.matchMethod === "MIXED" && <p className="mt-1 text-[12px] text-amber-300">Lines point to different jobs (or some don&apos;t match) - choose the job for the whole invoice, or leave it.</p>}
      {i.suggest && (
        <p className="mt-1 text-[12px] text-sky-300">
          Suggested from the site name: {name.get(i.suggest) ?? "a job"} -{" "}
          <button disabled={busy} onClick={() => onSave(i.suggest)} className="underline hover:text-sky-200 disabled:opacity-40">tie it to this job</button>
        </p>
      )}
    </li>
  );
}

function Recent({ imports }: { imports: Imp[] }) {
  return (
    <div className="rounded-2xl border border-edge bg-panel p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-100">Uploads</h2>
      {!imports.length ? <p className="text-sm text-gray-500">Nothing uploaded yet.</p> : (
        <ul className="divide-y divide-edge text-sm">
          {imports.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
              <span className="min-w-0 text-gray-300">
                {KIND_LABEL[m.kind] ?? m.kind} · <span className="text-gray-500">{m.originalName ?? "—"} · as at {day(m.asAt)} · {m.uploadedBy ?? "—"}</span>
              </span>
              <span className={`text-[12px] ${m.status === "DONE" ? "text-emerald-400" : m.status === "FAILED" ? "text-red-400" : "text-gray-400"}`}>
                {m.status === "DONE" ? `${m.rows} ${m.kind === "PNL" ? "lines" : "invoices"}${m.periodFrom ? ` · ${m.periodFrom} to ${m.periodTo}` : ""}` : m.status === "FAILED" ? `Not read: ${m.error}` : "Reading…"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
