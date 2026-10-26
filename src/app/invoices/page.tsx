"use client";

// Invoices inbox (24 Oct 2026). Accounts upload supplier invoices - PDFs,
// photos, or their invoice register spreadsheet. Clear matches go straight
// onto the job (Project Tracking); anything unclear waits here for a person.
// Rules: lib/invoiceInbox.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { resizePhoto } from "@/lib/imageResize";
import { money } from "@/lib/resource";
import { fmtDay } from "@/lib/dates";
import { CheckCircle2, ChevronDown, ChevronRight, FileText, Loader2, RotateCcw, Upload, XCircle } from "lucide-react";
import MyQueries, { useMyQueries } from "@/components/queries/MyQueries";
import XeroExports from "@/components/xero/XeroExports";
import QuestionsBanner from "@/components/queries/QuestionsBanner";

type Draft = {
  id: string; uploadId: string; rowNo: number | null; supplier: string | null; entityBilled: string | null; invoiceNo: string | null;
  invoiceDate: string | null; periodFrom: string | null; periodTo: string | null; description: string | null; siteText: string | null;
  hireRef: string | null; amountExGst: number | null; gst: number | null; category: string | null; projectId: string | null;
  hireResourceId: string | null; confidence: string | null; matchReason: string | null;
  status: "ADDED" | "NEEDS_REVIEW" | "NO_JOB" | "DUPLICATE" | "SKIPPED"; problem: string | null; autoAdded: boolean; decidedBy: string | null;
};
type UploadRow = {
  id: string; originalName: string; kind: string; status: "READING" | "DONE" | "FAILED"; error: string | null;
  uploadedBy: string | null; createdAt: string; counts: Record<string, number>;
  clearedAt: string | null; clearedBy: string | null;
};
type Inbox = {
  uploads: UploadRow[]; drafts: Draft[];
  projects: { id: string; name: string; status: string }[];
  hireItems: { id: string; name: string; agency: string | null; hireRef: string | null; hireProjectId: string }[];
};

const TYPES = [
  { value: "PLANT_HIRE", label: "Plant hire" },
  { value: "LABOUR_HIRE", label: "Labour hire" },
  { value: "TIP_FEES", label: "Tip fees" },
  { value: "MATERIALS", label: "Materials" },
];
const typeLabel = (c: string | null) => TYPES.find((t) => t.value === c)?.label ?? "Not sure";
const day = (iso: string | null) => (iso ? fmtDay(iso, { day: "numeric", month: "short", year: "2-digit" }) : "—");
const input = "w-full rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That file couldn't be opened."));
    r.readAsDataURL(file);
  });
}

export default function InvoicesPage() {
  const { canEdit, accountsOnly, isDirector, loading: authLoading } = useAuth();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [sending, setSending] = useState<{ name: string; error?: string }[]>([]);
  const [showOther, setShowOther] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Queries (Phase 2): questions Ilies has asked this login, answered here.
  const myQueries = useMyQueries();
  const [tab, setTab] = useState<"invoices" | "queries" | "xero">("invoices");
  // /invoices?tab=queries (the "Questions for you" banner) opens the Queries tab.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "queries") setTab("queries");
  }, []);
  // Xero exports (G2): the accounts login and director access - never Managers.
  const showXero = accountsOnly || isDirector;
  const showTabs = accountsOnly || showXero || (myQueries.rows?.length ?? 0) > 0;
  const tabs: ["invoices" | "queries" | "xero", string][] = [
    ["invoices", "Invoices"],
    ...(accountsOnly || (myQueries.rows?.length ?? 0) > 0 ? [["queries", `Queries${myQueries.waiting ? ` (${myQueries.waiting})` : ""}`] as ["queries", string]] : []),
    ...(showXero ? [["xero", "Xero exports"] as ["xero", string]] : []),
  ];

  // Uploads cleared from the tab (26 Oct 2026) are kept; "Show cleared" lists them again.
  const [showCleared, setShowCleared] = useState(false);
  const load = useCallback(
    () => apiFetch(`/api/invoice-inbox${showCleared ? "?cleared=1" : ""}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setInbox(d)),
    [showCleared],
  );
  async function setCleared(u: UploadRow, clear: boolean) {
    const open = (u.counts.NEEDS_REVIEW ?? 0) + (u.counts.NO_JOB ?? 0);
    if (clear && !confirm(`Clear "${u.originalName}" from the Invoices tab?${open ? ` Its ${open} undecided line${open === 1 ? "" : "s"} go on hold.` : ""} Nothing is deleted, and nothing already on a job changes.`)) return;
    const res = await apiFetch(`/api/invoice-inbox/uploads/${u.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: clear ? "CLEAR" : "UNCLEAR" }) });
    if (!res.ok) alert(await serverErrorMessage(res, "Couldn't do that."));
    load();
  }
  useEffect(() => { load(); }, [load]);
  // While anything is being read, check back every few seconds.
  const reading = inbox?.uploads.some((u) => u.status === "READING");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [reading, load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setSending(list.map((f) => ({ name: f.name })));
    for (const [i, f] of list.entries()) {
      try {
        // Photos are shrunk like tool photos (still sharp enough to read print).
        const dataUrl = f.type.startsWith("image/") ? await resizePhoto(f, 2200, 0.88) : await readAsDataUrl(f);
        const res = await apiFetch("/api/invoice-inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl, name: f.name }) });
        if (!res.ok) throw new Error(await serverErrorMessage(res, "Upload failed"));
        setSending((s) => s.filter((x) => x.name !== f.name));
      } catch (e) {
        setSending((s) => s.map((x, k) => (k === i ? { ...x, error: (e as Error).message } : x)));
      }
    }
    if (fileInput.current) fileInput.current.value = "";
    load();
  }

  const projectName = useMemo(() => new Map(inbox?.projects.map((p) => [p.id, p.name]) ?? []), [inbox]);
  const needs = inbox?.drafts.filter((d) => d.status === "NEEDS_REVIEW" || d.status === "NO_JOB") ?? [];
  const added = inbox?.drafts.filter((d) => d.status === "ADDED") ?? [];
  const other = inbox?.drafts.filter((d) => d.status === "DUPLICATE" || d.status === "SKIPPED") ?? [];

  if (!authLoading && !canEdit && !accountsOnly) {
    return <PageShell title="Invoices"><p className="text-sm text-gray-400">The invoices inbox is for accounts and managers.</p></PageShell>;
  }

  return (
    <PageShell title="Invoices" subtitle="Upload supplier invoices (PDF or photo) or your invoice register spreadsheet. Clear matches go straight onto the job; anything unclear waits here.">
      {/* Information requests (Task I): questions waiting on this login. */}
      {tab !== "queries" && <QuestionsBanner onOpen={() => setTab("queries")} />}
      {showTabs && (
        <div className="mb-4 flex gap-1.5" role="tablist" aria-label="Invoices, queries or Xero exports">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${tab === k ? "bg-brand-600 text-white" : "border border-edge text-gray-400 hover:text-gray-200"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "queries" ? (
        <div className="max-w-2xl"><MyQueries rows={myQueries.rows} onChange={myQueries.load} /></div>
      ) : tab === "xero" && showXero ? (
        <XeroExports />
      ) : (<>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}
        className="mb-5 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-edge bg-panel px-4 py-8 text-center"
      >
        <Upload className="text-gray-400" size={26} aria-hidden />
        <div className="text-sm text-gray-200">Drop files here, or</div>
        <button onClick={() => fileInput.current?.click()} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500">
          Choose files
        </button>
        <div className="text-xs text-gray-500">PDF, JPEG / PNG photo, or .xlsx / .csv - several at once is fine</div>
        <input ref={fileInput} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.csv" className="hidden" onChange={(e) => upload(e.target.files)} />
        {sending.map((s) => (
          <div key={s.name} className={`text-xs ${s.error ? "text-red-400" : "text-gray-400"}`}>
            {s.error ? <XCircle size={12} className="mr-1 inline" /> : <Loader2 size={12} className="mr-1 inline animate-spin" />}
            {s.name}{s.error ? ` - ${s.error}` : " - sending"}
          </div>
        ))}
      </div>

      {!inbox ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-amber-500/15 px-3 py-1 font-medium text-amber-400">{needs.length} need you</span>
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-medium text-emerald-400">{added.length} added to jobs (last 60 days)</span>
            <span className="rounded-full bg-panel px-3 py-1 text-gray-400">{other.length} already in or not counted</span>
            {reading && <span className="rounded-full bg-panel px-3 py-1 text-gray-400"><Loader2 size={12} className="mr-1 inline animate-spin" />Reading uploads...</span>}
          </div>

          <h2 className="mb-2 text-sm font-semibold text-gray-100">Needs you</h2>
          {needs.length === 0 ? (
            <p className="mb-6 rounded-xl border border-edge bg-panel p-4 text-sm text-gray-500">Nothing waiting - every invoice read so far is sorted.</p>
          ) : (
            <div className="mb-6 space-y-3">
              {needs.map((d) => <ReviewCard key={d.id} d={d} inbox={inbox} onDone={load} />)}
            </div>
          )}

          <h2 className="mb-2 text-sm font-semibold text-gray-100">Added to jobs</h2>
          {added.length === 0 ? (
            <p className="mb-6 text-sm text-gray-500">None yet.</p>
          ) : (
            <div className="mb-6 overflow-x-auto rounded-xl border border-edge bg-panel">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-gray-500">
                  <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Job</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Ex GST</th><th className="px-3 py-2">How</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-edge/60">
                  {added.map((d) => (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-400">{day(d.invoiceDate)}</td>
                      <td className="px-3 py-2 text-gray-200">{d.supplier}{d.invoiceNo && <span className="text-gray-500"> #{d.invoiceNo}</span>}</td>
                      <td className="px-3 py-2 text-gray-200">{d.projectId ? projectName.get(d.projectId) : "—"}</td>
                      <td className="px-3 py-2 text-gray-400">{typeLabel(d.category)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-100">{d.amountExGst != null ? money(d.amountExGst) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{d.autoAdded ? "Matched automatically" : `By ${d.decidedBy ?? "a person"}`}</td>
                      <td className="px-3 py-2 text-right"><UndoButton id={d.id} onDone={load} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button onClick={() => setShowOther((v) => !v)} className="mb-2 flex items-center gap-1 text-sm font-semibold text-gray-100">
            {showOther ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Already in, or not counted ({other.length})
          </button>
          {showOther && (
            <div className="mb-6 divide-y divide-edge/60 rounded-xl border border-edge bg-panel text-sm">
              {other.map((d) => (
                <div key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="text-gray-400">{day(d.invoiceDate)}</span>
                  <span className="text-gray-200">{d.supplier}{d.invoiceNo && <span className="text-gray-500"> #{d.invoiceNo}</span>}</span>
                  <span className="tabular-nums text-gray-300">{d.amountExGst != null ? money(d.amountExGst) : ""}</span>
                  <span className="flex-1 text-xs text-gray-500">{d.status === "DUPLICATE" ? "Already entered" : d.problem}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mb-2 mt-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-100">Uploads</h2>
            <button onClick={() => setShowCleared((s) => !s)} className="text-xs text-gray-400 underline hover:text-gray-200">
              {showCleared ? "Hide cleared" : "Show cleared"}
            </button>
          </div>
          <div className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel text-sm">
            {inbox.uploads.length === 0 && <p className="p-4 text-gray-500">Nothing uploaded yet.</p>}
            {inbox.uploads.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <FileText size={14} className="text-gray-500" aria-hidden />
                <a href={`/api/invoice-inbox/uploads/${u.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-gray-200 hover:underline">{u.originalName}</a>
                <span className="text-xs text-gray-500">{new Date(u.createdAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{u.uploadedBy ? ` · ${u.uploadedBy}` : ""}</span>
                {u.status === "READING" && <span className="text-xs text-gray-400"><Loader2 size={12} className="mr-1 inline animate-spin" />Reading</span>}
                {u.status === "DONE" && (
                  <span className="text-xs text-gray-400">
                    {[["ADDED", "added"], ["NEEDS_REVIEW", "need you"], ["NO_JOB", "no job"], ["DUPLICATE", "already in"], ["SKIPPED", "not counted"]]
                      .filter(([k]) => u.counts[k]).map(([k, l]) => `${u.counts[k]} ${l}`).join(" · ") || u.error || "Nothing found"}
                  </span>
                )}
                {u.status === "FAILED" && (
                  <span className="text-xs text-red-400">
                    {u.error ?? "Couldn't read it"} <RetryButton id={u.id} onDone={load} />
                  </span>
                )}
                {u.status !== "READING" && (u.clearedAt ? (
                  <span className="text-xs text-gray-500">
                    Cleared {new Date(u.clearedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}{u.clearedBy ? ` by ${u.clearedBy}` : ""} ·{" "}
                    <button onClick={() => setCleared(u, false)} className="underline hover:text-gray-300">Put back</button>
                  </span>
                ) : (
                  <button onClick={() => setCleared(u, true)} className="rounded-md border border-edge px-2 py-0.5 text-xs text-gray-400 hover:bg-panel2 hover:text-gray-200">
                    Clear from inbox
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      </>)}
    </PageShell>
  );
}

function ReviewCard({ d, inbox, onDone }: { d: Draft; inbox: Inbox; onDone: () => void }) {
  const [f, setF] = useState({
    projectId: d.projectId ?? "", category: d.category && d.category !== "OTHER" ? d.category : "", supplier: d.supplier ?? "",
    invoiceNo: d.invoiceNo ?? "", invoiceDate: d.invoiceDate ?? "", amountExGst: d.amountExGst ?? "", gst: d.gst ?? "",
    hireResourceId: d.hireResourceId ?? "", periodFrom: d.periodFrom ?? "", periodTo: d.periodTo ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const items = inbox.hireItems.filter((h) => h.hireProjectId === f.projectId);

  async function act(body: object) {
    setBusy(true); setError(null);
    const res = await apiFetch(`/api/invoice-inbox/drafts/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save"));
    onDone();
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-panel p-3.5">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium text-gray-100">{d.supplier ?? "Unknown supplier"}{d.invoiceNo && <span className="text-gray-500"> #{d.invoiceNo}</span>}</span>
        <span className="text-sm tabular-nums text-gray-200">{d.amountExGst != null ? money(d.amountExGst) : ""}</span>
        <span className="text-xs text-gray-500">{day(d.invoiceDate)}{d.siteText ? ` · site: ${d.siteText}` : ""}</span>
        <a href={`/api/invoice-inbox/uploads/${d.uploadId}`} target="_blank" rel="noreferrer" className="ml-auto text-xs text-brand-400 hover:underline">
          View file{d.rowNo ? ` (row ${d.rowNo})` : ""}
        </a>
      </div>
      {d.problem && <div className="mb-2 text-xs text-amber-400">{d.problem}</div>}
      {d.description && <div className="mb-2 line-clamp-2 text-xs text-gray-400">{d.description}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="col-span-2 text-[11px] text-gray-500">Job
          <select value={f.projectId} onChange={set("projectId")} className={input}>
            <option value="">Choose the job...</option>
            {inbox.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status !== "ACTIVE" ? ` (${p.status.toLowerCase()})` : ""}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">Cost type
          <select value={f.category} onChange={set("category")} className={input}>
            <option value="">Choose...</option>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-gray-500">Invoice date<input type="date" value={f.invoiceDate} onChange={set("invoiceDate")} className={input} /></label>
        <label className="text-[11px] text-gray-500">Supplier<input value={f.supplier} onChange={set("supplier")} className={input} /></label>
        <label className="text-[11px] text-gray-500">Invoice no.<input value={f.invoiceNo} onChange={set("invoiceNo")} className={input} /></label>
        <label className="text-[11px] text-gray-500">Amount ex GST<input type="number" step="0.01" value={f.amountExGst} onChange={set("amountExGst")} className={input} /></label>
        <label className="text-[11px] text-gray-500">GST<input type="number" step="0.01" value={f.gst} onChange={set("gst")} placeholder="blank = 10%" className={input} /></label>
        {f.category === "PLANT_HIRE" && items.length > 0 && (
          <>
            <label className="col-span-2 text-[11px] text-gray-500">Bills this hire item (stops its estimate)
              <select value={f.hireResourceId} onChange={set("hireResourceId")} className={input}>
                <option value="">None - separate hire</option>
                {items.map((h) => <option key={h.id} value={h.id}>{h.name}{h.agency ? ` · ${h.agency}` : ""}{h.hireRef ? ` · ${h.hireRef}` : ""}</option>)}
              </select>
            </label>
            <label className="text-[11px] text-gray-500">Period from<input type="date" value={f.periodFrom} onChange={set("periodFrom")} className={input} /></label>
            <label className="text-[11px] text-gray-500">Period to<input type="date" value={f.periodTo} onChange={set("periodTo")} className={input} /></label>
          </>
        )}
      </div>
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => act({ action: "ADD", fields: f })} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
          <CheckCircle2 size={14} aria-hidden /> Add to job
        </button>
        <button disabled={busy} onClick={() => act({ action: "SKIP", reason: d.status === "NO_JOB" ? "Not one of our jobs in Operations." : "Not a job cost." })} className="rounded-lg px-3 py-1.5 text-sm text-gray-400 hover:bg-panel2 hover:text-gray-200 disabled:opacity-50">
          {d.status === "NO_JOB" ? "Not one of our jobs" : "Not a job cost"}
        </button>
      </div>
    </div>
  );
}

function UndoButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      title="Take it off the job and decide again"
      onClick={async () => {
        if (!confirm("Take this invoice off the job?")) return;
        setBusy(true);
        await apiFetch(`/api/invoice-inbox/drafts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "UNDO" }) });
        setBusy(false);
        onDone();
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-panel2 hover:text-gray-200"
    >
      <RotateCcw size={12} aria-hidden /> Undo
    </button>
  );
}

function RetryButton({ id, onDone }: { id: string; onDone: () => void }) {
  return (
    <button
      onClick={async () => {
        await apiFetch(`/api/invoice-inbox/uploads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "RETRY" }) });
        onDone();
      }}
      className="ml-1 underline hover:text-red-300"
    >
      Try again
    </button>
  );
}
