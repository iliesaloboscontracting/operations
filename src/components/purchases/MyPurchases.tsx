"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { RequesterView } from "@/lib/purchases/rules";

// Purchase requests for the person asking (stage 6): Alex on his OFFICE link (`base` = /api/site/<link>/purchases)
// or anyone in-app (`base` = /api/purchases). Ask to buy something, see where each one is up to in words, answer
// accounts' question, cancel. There is no amount anywhere on this screen - accounts add the price.
type Row = RequesterView & { projectName: string | null };
type Project = { id: string; name: string; jobNo: string | null };

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";
const small = "rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 hover:bg-panel2 disabled:opacity-50";
const dmy = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const TONE: Record<string, string> = {
  NEEDS_INFO: "bg-amber-900/70 text-amber-100", APPROVED: "bg-emerald-900/60 text-emerald-100", ORDERED: "bg-emerald-900/60 text-emerald-100",
  DECLINED: "bg-red-900/60 text-red-100", CLOSED: "bg-gray-700 text-gray-300", CANCELLED: "bg-gray-700 text-gray-300",
};
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function AskForm({ base, projects, onDone, onCancel }: { base: string; projects: Project[]; onDone: (ref: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ what: "", why: "", qty: "", supplier: "", linkUrl: "", neededBy: "", projectId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post(base, f).catch(() => null);
    setBusy(false);
    if (!res) return setError("Couldn't send - check your signal.");
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't send it."));
    onDone((await res.json()).ref);
  }
  return (
    <form onSubmit={send} className="space-y-3 rounded-xl border border-edge bg-panel p-4">
      <p className="font-semibold text-gray-100">Ask to buy something</p>
      <input className={input} placeholder="What do you need?" value={f.what} onChange={set("what")} required />
      <textarea className={input} rows={2} placeholder="What's it for? (helps accounts and the directors)" value={f.why} onChange={set("why")} />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="How many" value={f.qty} onChange={set("qty")} />
        <label className="text-xs text-gray-400">Needed by<input type="date" className={input} value={f.neededBy} onChange={set("neededBy")} /></label>
      </div>
      <input className={input} placeholder="Supplier, if you know one" value={f.supplier} onChange={set("supplier")} />
      <input className={input} placeholder="A link to it (optional)" value={f.linkUrl} onChange={set("linkUrl")} inputMode="url" />
      <select className={input} value={f.projectId} onChange={set("projectId")}>
        <option value="">Not for a particular job</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{[p.jobNo, p.name].filter(Boolean).join(" ")}</option>)}
      </select>
      <p className="text-xs text-gray-500">Leave the price out - accounts check it and add the amount.</p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button disabled={busy} className={primary}>{busy ? <Loader2 size={18} className="animate-spin" /> : null} Send to accounts</button>
      <button type="button" onClick={onCancel} className="w-full text-sm text-gray-400">Cancel</button>
    </form>
  );
}

function Card({ r, base, onChanged }: { r: Row; base: string; onChanged: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await post(`${base}/${r.id}`, { ...body, version: r.version }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't save.") : "Couldn't save - check your signal.");
    setAnswer("");
    onChanged();
  }
  const canCancel = r.status === "REQUESTED" || r.status === "NEEDS_INFO";
  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">{r.ref}</span>
        <span className="font-medium text-gray-100">{r.what}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.status] ?? "bg-sky-900/60 text-sky-100"}`}>{r.statusText}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">{[r.qty && `${r.qty} off`, r.supplier, r.projectName, r.neededBy && `needed by ${dmy(r.neededBy)}`].filter(Boolean).join(" · ")}</p>
      {r.why && <p className="mt-1 text-sm text-gray-400">{r.why}</p>}
      {r.infoQuestion && <p className="mt-2 rounded-lg bg-amber-950/40 px-2 py-1.5 text-sm text-amber-100">Accounts asked: {r.infoQuestion}</p>}
      {r.infoAnswer && <p className="mt-1 text-sm text-gray-300">You answered: {r.infoAnswer}</p>}
      {r.decisionNote && <p className="mt-1 text-sm text-gray-300">Director&apos;s note: {r.decisionNote}</p>}
      {r.status === "NEEDS_INFO" && (
        <div className="mt-2 space-y-2">
          <textarea className={input} rows={2} placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <button disabled={busy || !answer.trim()} onClick={() => act({ action: "ANSWER", answer })} className={primary}>Send answer</button>
        </div>
      )}
      {canCancel && <button disabled={busy} onClick={() => confirm("Cancel this request?") && act({ action: "CANCEL" })} className={`${small} mt-2`}>Cancel request</button>}
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export default function MyPurchases({ base }: { base: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [asking, setAsking] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null);
    if (!res?.ok) return setError("Couldn't load - check your signal.");
    setError(null);
    const d = (await res.json()) as { requests: Row[]; projects: Project[] };
    setRows(d.requests);
    setProjects(d.projects);
  }, [base]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {flash && <p className="rounded-xl bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200">{flash}</p>}
      {asking ? (
        <AskForm base={base} projects={projects} onCancel={() => setAsking(false)} onDone={(ref) => { setAsking(false); setFlash(`Sent to accounts as ${ref}.`); load(); }} />
      ) : (
        <button onClick={() => { setFlash(null); setAsking(true); }} className={primary}><Plus size={18} /> Ask to buy something</button>
      )}
      <h2 className="pt-2 text-sm font-semibold text-gray-300">My purchase requests</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-500">Nothing asked for yet.</p> : rows.map((r) => <Card key={r.id} r={r} base={base} onChanged={load} />)}
    </div>
  );
}
