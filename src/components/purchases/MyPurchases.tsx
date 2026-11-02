"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { RequesterView } from "@/lib/purchases/rules";
import { QuoteFields, QuoteList, emptyQuote, fromQuote, isBlank, quoteBody, type QuoteDTO, type QuoteDraft } from "./Quotes";

// Purchase and hire requests for the person asking (stage 6): Alex on his OFFICE link (`base` = /api/site/<link>/purchases)
// or anyone in-app (`base` = /api/purchases). Ask to buy or hire something with a description and one or more
// suppliers' quotes (prices allowed - Ilies, 2 Nov 2026), see where each one is up to, answer the directors' question,
// add another supplier or correct the details while it's with the approvers, cancel. In-app, Managers, Admins and the
// coordinator also see everyone else's requests, read-only. Accounts' own amount never reaches this screen.
type Row = RequesterView & {
  projectName: string | null; kind: string; kindLabel: string; quotes: QuoteDTO[]; chosenQuoteId: string | null; canEdit: boolean;
};
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

function AskForm({ base, projects, onDone, onCancel }: { base: string; projects: Project[]; onDone: (ref: string, warning?: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ kind: "PURCHASE", what: "", why: "", qty: "", linkUrl: "", neededBy: "", projectId: "" });
  const [quotes, setQuotes] = useState<QuoteDraft[]>([emptyQuote()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // 7 MB option A (Ilies, 2 Nov 2026): one save can carry one quote file at most. PQ-012 (approved 2 Nov 2026): the
    // request goes first with EVERY typed quote (supplier, price, details, link - no files), so the directors see all
    // the suppliers at once; then each file is attached to its own quote with EDIT_QUOTE, sending the version - any
    // approval made on the version before a file arrived is refused (409) and has to look again.
    const typed = quotes.filter((q) => !isBlank(q));
    const res = await post(base, { ...f, quotes: typed.map((q) => quoteBody({ ...q, file: null })) }).catch(() => null);
    if (!res) { setBusy(false); return setError("Couldn't send - check your signal."); }
    if (!res.ok) { setBusy(false); return setError(await serverErrorMessage(res, "Couldn't send it.")); }
    const d = (await res.json()) as { id: string; ref: string; version: number; quoteIds: string[]; warning?: string };
    const problems: string[] = d.warning ? [d.warning] : [];
    let version = d.version;
    for (const [i, q] of typed.entries()) {
      if (!q.file) continue;
      const r = await post(`${base}/${d.id}`, { action: "EDIT_QUOTE", quoteId: d.quoteIds[i], quote: { file: q.file }, version }).catch(() => null);
      if (!r?.ok) problems.push(`${q.supplier || "A quote"}: ${r ? await serverErrorMessage(r, "its file couldn't be sent") : "couldn't send - check your signal"}`);
      else { version += 1; const w = ((await r.json().catch(() => ({}))) as { warning?: string }).warning; if (w) problems.push(w); }
    }
    setBusy(false);
    onDone(d.ref, problems.length ? `${problems.join(" ")} Attach it again with "Change" on that supplier.` : undefined);
  }
  const hire = f.kind === "HIRE";
  return (
    <form onSubmit={send} className="space-y-3 rounded-xl border border-edge bg-panel p-4">
      <div className="flex gap-2">
        {(["PURCHASE", "HIRE"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setF((x) => ({ ...x, kind: k }))}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${f.kind === k ? "bg-brand-600 text-white" : "border border-edge text-gray-300"}`}>
            {k === "PURCHASE" ? "Buy something" : "Hire something"}
          </button>
        ))}
      </div>
      <input className={input} placeholder={hire ? "What do you need to hire?" : "What do you need?"} value={f.what} onChange={set("what")} required />
      <div>
        <textarea className={input} rows={4} maxLength={2000} placeholder={`Describe it - what it's for, specs, and prices if you have them${hire ? " (how long, delivery and pick-up)" : ""}`} value={f.why} onChange={set("why")} />
        <p className="mt-0.5 text-right text-[11px] text-gray-500">{f.why.length}/2000</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="How many" value={f.qty} onChange={set("qty")} />
        <label className="text-xs text-gray-400">Needed by<input type="date" className={input} value={f.neededBy} onChange={set("neededBy")} /></label>
      </div>
      <input className={input} placeholder="A link to it (optional)" value={f.linkUrl} onChange={set("linkUrl")} inputMode="url" />
      <select className={input} value={f.projectId} onChange={set("projectId")}>
        <option value="">Not for a particular job</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{[p.jobNo, p.name].filter(Boolean).join(" ")}</option>)}
      </select>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-200">Suppliers and prices</p>
        {quotes.map((q, i) => <QuoteFields key={i} n={i + 1} q={q} input={input} onChange={(nq) => setQuotes((qs) => qs.map((x, j) => (j === i ? nq : x)))} />)}
        {quotes.length < 10 && <button type="button" onClick={() => setQuotes((qs) => [...qs, emptyQuote()])} className={`${small} flex items-center gap-1.5`}><Plus size={14} /> Add another supplier</button>}
      </div>
      <p className="text-xs text-gray-500">Ilies or a director approves it and picks the supplier, then accounts order it.</p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button disabled={busy} className={primary}>{busy ? <Loader2 size={18} className="animate-spin" /> : null} Send to the directors</button>
      <button type="button" onClick={onCancel} className="w-full text-sm text-gray-400">Cancel</button>
    </form>
  );
}

function Card({ r, base, onChanged }: { r: Row; base: string; onChanged: () => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Own requests, still with the approvers: the description, another supplier, or a correction to one quote.
  const [editing, setEditing] = useState<null | "desc" | "add" | string>(null);
  const [why, setWhy] = useState(r.why ?? "");
  const [draft, setDraft] = useState<QuoteDraft>(emptyQuote());
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await post(`${base}/${r.id}`, { ...body, version: r.version }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't save.") : "Couldn't save - check your signal.");
    // Saved, but the disk refused a quote file (PQ-001) - say so; the rest is in.
    const warning = ((await res.json().catch(() => ({}))) as { warning?: string }).warning;
    setAnswer("");
    setEditing(null);
    onChanged();
    if (warning) setError(warning);
  }
  const canCancel = r.canEdit && (r.status === "REQUESTED" || r.status === "NEEDS_INFO");
  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">{r.ref}</span>
        <span className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-400">{r.kindLabel}</span>
        <span className="font-medium text-gray-100">{r.what}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[r.status] ?? "bg-sky-900/60 text-sky-100"}`}>{r.statusText}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500">{[!r.canEdit && `Asked by ${r.requestedBy}`, r.qty && `${r.qty} off`, r.projectName, r.neededBy && `needed by ${dmy(r.neededBy)}`].filter(Boolean).join(" · ")}</p>
      {editing === "desc" ? (
        <div className="mt-2 space-y-2">
          <textarea className={input} rows={4} maxLength={2000} value={why} onChange={(e) => setWhy(e.target.value)} />
          <div className="flex gap-2"><button disabled={busy} onClick={() => act({ action: "EDIT", why })} className={small}>Save</button><button onClick={() => setEditing(null)} className={small}>Cancel</button></div>
        </div>
      ) : r.why && <p className="mt-1 whitespace-pre-line text-sm text-gray-400">{r.why}</p>}
      <QuoteList quotes={r.quotes} chosenQuoteId={r.chosenQuoteId} fileBase={`${base}/quotes`} legacySupplier={r.supplier} />
      {r.canEdit && r.quotes.length > 0 && editing !== "add" && !(editing && editing !== "desc") && (
        <div className="mt-1 flex flex-wrap gap-1">{r.quotes.map((q) => <button key={q.id} onClick={() => { setDraft(fromQuote(q)); setEditing(q.id); }} className="text-xs text-brand-300 hover:underline">Change {q.supplier}</button>)}</div>
      )}
      {editing && editing !== "desc" && (
        <div className="mt-2 space-y-2">
          <QuoteFields q={draft} onChange={setDraft} input={input} />
          <div className="flex gap-2">
            <button disabled={busy || !draft.supplier.trim()} onClick={() => act(editing === "add" ? { action: "ADD_QUOTE", quote: quoteBody(draft) } : { action: "EDIT_QUOTE", quoteId: editing, quote: quoteBody(draft) })} className={small}>Save</button>
            <button onClick={() => setEditing(null)} className={small}>Cancel</button>
          </div>
        </div>
      )}
      {r.infoQuestion && <p className="mt-2 rounded-lg bg-amber-950/40 px-2 py-1.5 text-sm text-amber-100">The directors asked: {r.infoQuestion}</p>}
      {r.infoAnswer && <p className="mt-1 text-sm text-gray-300">{r.canEdit ? "You answered" : "Answer"}: {r.infoAnswer}</p>}
      {r.decisionNote && <p className="mt-1 text-sm text-gray-300">Director&apos;s note: {r.decisionNote}</p>}
      {r.canEdit && r.status === "NEEDS_INFO" && (
        <div className="mt-2 space-y-2">
          <textarea className={input} rows={2} placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <button disabled={busy || !answer.trim()} onClick={() => act({ action: "ANSWER", answer })} className={primary}>Send answer</button>
        </div>
      )}
      {r.canEdit && !editing && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => { setDraft(emptyQuote()); setEditing("add"); }} className={`${small} flex items-center gap-1.5`}><Plus size={14} /> Add another supplier</button>
          <button disabled={busy} onClick={() => { setWhy(r.why ?? ""); setEditing("desc"); }} className={small}>Edit description</button>
          {canCancel && <button disabled={busy} onClick={() => confirm("Cancel this request?") && act({ action: "CANCEL" })} className={small}>Cancel request</button>}
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export default function MyPurchases({ base }: { base: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [others, setOthers] = useState<Row[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [asking, setAsking] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null);
    if (!res?.ok) return setError("Couldn't load - check your signal.");
    setError(null);
    const d = (await res.json()) as { requests: Row[]; others?: Row[]; projects: Project[] };
    setRows(d.requests);
    setOthers(d.others ?? null);
    setProjects(d.projects);
  }, [base]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      {flash && <p className="rounded-xl bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200">{flash}</p>}
      {asking ? (
        <AskForm base={base} projects={projects} onCancel={() => setAsking(false)} onDone={(ref, warning) => { setAsking(false); setFlash(`Sent to the directors as ${ref}.${warning ? ` ${warning}` : ""}`); load(); }} />
      ) : (
        <button onClick={() => { setFlash(null); setAsking(true); }} className={primary}><Plus size={18} /> Ask to buy or hire something</button>
      )}
      <h2 className="pt-2 text-sm font-semibold text-gray-300">My requests</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-500">Nothing asked for yet.</p> : rows.map((r) => <Card key={r.id} r={r} base={base} onChanged={load} />)}
      {others && (
        <>
          <h2 className="pt-4 text-sm font-semibold text-gray-300">Everyone else&apos;s requests <span className="font-normal text-gray-500">- read only</span></h2>
          {others.length === 0 ? <p className="text-sm text-gray-500">None in the last 90 days.</p> : others.map((r) => <Card key={r.id} r={r} base={base} onChanged={load} />)}
        </>
      )}
    </div>
  );
}
