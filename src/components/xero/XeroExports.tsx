"use client";

// Xero exports (G2, 25 Oct 2026): accounts uploads the sales-invoice export,
// the bills export or the Profit and Loss report from Xero; invoices that
// can't be tied to a job wait here for accounts or a director to pick one
// (remembered for later uploads). Shown on Invoices -> Xero exports for the
// accounts login and on Directors -> Accounts data. Manual exports: every
// figure built from them is "as at" the export date.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import JobPicker from "@/components/JobPicker";
import { fmtDay } from "@/lib/dates";
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

function Review({ data, onDone }: { data: { asAt: string | null; invoices: Inv[]; projects: Project[] }; onDone: () => void }) {
  const live = data.projects.filter((p) => !p.archived);
  const name = new Map(data.projects.map((p) => [p.id, p.name]));
  return (
    <div className="rounded-2xl border border-edge bg-panel p-4">
      <h2 className="text-sm font-semibold text-gray-100">Not tied to a job</h2>
      <p className="mb-3 text-[12px] text-gray-500">
        {data.asAt ? `Sales invoices in the upload as at ${day(data.asAt)} that couldn't be matched to a job. Your choice is remembered for later uploads.` : "Upload a sales-invoice export to see this list."}
      </p>
      {data.asAt && !data.invoices.length && <p className="text-sm text-emerald-400">Every sales invoice is tied to a job.</p>}
      <ul className="divide-y divide-edge">
        {data.invoices.map((i) => <ReviewRow key={i.id} i={i} projects={live} name={name} onDone={onDone} />)}
      </ul>
    </div>
  );
}

function ReviewRow({ i, projects, name, onDone }: { i: Inv; projects: Project[]; name: Map<string, string>; onDone: () => void }) {
  const [pick, setPick] = useState(i.suggest ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(projectId: string | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/xero/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: i.key, projectId }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save."));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const credit = i.type.endsWith("CREDIT");
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 text-sm text-gray-200">
          {credit ? "Credit note " : ""}{i.number} · {i.contact}
          <span className="text-gray-500"> · {day(i.date)}{i.reference ? ` · ref "${i.reference}"` : ""}</span>
        </div>
        <div className="text-sm font-medium text-gray-100">{credit ? "-" : ""}{money(i.totalExGst)} <span className="text-[11px] font-normal text-gray-500">ex GST</span></div>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12px] text-gray-500">
        {i.lines.slice(0, 4).map((l) => (
          <li key={l.id}>{l.description || "No description"}{l.tracking1 ? ` · ${l.tracking1}` : ""} · {money(l.amountExGst)}{l.projectId ? ` · ${name.get(l.projectId) ?? "a job"}` : ""}</li>
        ))}
        {i.lines.length > 4 && <li>and {i.lines.length - 4} more lines</li>}
      </ul>
      {i.matchMethod === "MIXED" && <p className="mt-1 text-[12px] text-amber-300">Lines point to different jobs (or some don&apos;t match) - choose the job for the whole invoice, or leave it.</p>}
      {i.suggest && <p className="mt-1 text-[12px] text-sky-300">Suggested from the site name: {name.get(i.suggest) ?? "a job"} - check before saving.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <JobPicker jobs={projects} value={pick} onChange={setPick} label={`Job for ${i.number}`} className="w-full max-w-sm" />
        <button disabled={busy || !pick} onClick={() => save(pick)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Save</button>
        <button disabled={busy} onClick={() => save(null)} className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2 disabled:opacity-40">Not a job</button>
      </div>
      {err && <p className="mt-1 text-sm text-red-400">{err}</p>}
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
