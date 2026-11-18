"use client";

// Directors -> Tenders (17 Nov 2026, Ilies: "yes build the tenders tab"): every tender from Lobos Estimating's register
// (tenders-board.v1) - received / submitted / won / lost, who's looking after each one, what's overdue, and "Log my
// quote" for a quote issued outside Estimating. Estimating is the one source of truth: assign and log-quote are done
// there, server to server; this page keeps nothing of its own. Prices are for directors (this page is director only).
import { useCallback, useEffect, useMemo, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { Card } from "@/components/tracking/parts";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { UPLOAD_FILE_MAX, UPLOAD_TOO_LARGE, dataUrlBytes } from "@/lib/uploadLimits";
import type { TenderRow, TendersBoardV1 } from "@/lib/tenders/board";

type Data =
  | { state: "OK"; board: TendersBoardV1 }
  | { state: "OFF" | "UNREACHABLE" | "BAD_FORMAT" }
  | { state: "REFUSED"; status: number; code?: string };

const aud = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }));
const day = (iso: string | null) => (iso ? fmtDay(iso, { day: "numeric", month: "short" }) : "—");
const STATUS: Record<string, string> = { received: "Received", estimating: "Estimating", submitted: "Submitted", won: "Won", lost: "Lost", withdrawn: "Withdrawn", declined: "Declined" };
const OPEN = new Set(["received", "estimating", "submitted"]);
const PERIODS = [{ days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 365, label: "12 months" }];
const FILTERS = ["Open", "Overdue", "Unassigned", "Structural", "Submitted", "Won", "Lost", "All"] as const;
type Filter = (typeof FILTERS)[number];
const https = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null); // only https links are ever shown

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });

export default function TendersPage() {
  const { isDirector, loading } = useAuth();
  const [period, setPeriod] = useState(90);
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    const to = isoDaysAgo(0), from = isoDaysAgo(period);
    apiFetch(`/api/directors/tenders?from=${from}&to=${to}`)
      .then(async (r) => (r.ok ? (setD(await r.json()), setError(null)) : setError(await serverErrorMessage(r, "Couldn't load the tenders."))))
      .catch(() => setError("Couldn't load the tenders."));
  }, [period]);
  useEffect(() => { if (!loading && isDirector) load(); }, [loading, isDirector, load]);

  if (loading) return null;
  if (!isDirector) {
    return <PageShell title="Tenders"><div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div></PageShell>;
  }
  const subtitle = d?.state === "OK" ? `From Estimating · as at ${new Date(d.board.generated_at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · ex GST` : undefined;

  return (
    <PageShell
      title="Tenders"
      subtitle={subtitle}
      actions={
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p.days} onClick={() => setPeriod(p.days)} className={`rounded-md border px-2.5 py-1 text-xs ${period === p.days ? "border-brand-500 bg-brand-600/20 text-brand-200" : "border-edge text-gray-400 hover:bg-panel2"}`}>{p.label}</button>
          ))}
        </div>
      }
    >
      {flash && <p className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</p>}
      {error ? <p className="py-10 text-center text-sm text-red-400">{error}</p>
        : !d ? <p className="py-10 text-center text-sm text-gray-500">Loading...</p>
        : d.state !== "OK" ? <NotReady d={d} />
        : <Body board={d.board} onChanged={(m) => { setFlash(m); load(); }} />}
    </PageShell>
  );
}

function NotReady({ d }: { d: Exclude<Data, { state: "OK" }> }) {
  const msg = d.state === "OFF" ? "The Tenders tab isn't switched on yet - the link to Estimating (BOARD_SECRET) is set up at deploy."
    : d.state === "UNREACHABLE" ? "Estimating isn't answering right now - try again shortly."
    : d.state === "BAD_FORMAT" ? "Estimating sent tender figures this screen doesn't understand, so nothing is shown."
    : d.state === "REFUSED" && d.code === "board-key" ? "Estimating refused the Tenders link (the BOARD_SECRET values don't match)."
    : d.state === "REFUSED" ? `Estimating refused (${d.status}).` : "Not available.";
  return <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-400">{msg}</div>;
}

function Body({ board, onChanged }: { board: TendersBoardV1; onChanged: (msg: string) => void }) {
  const [filter, setFilter] = useState<Filter>("Open");
  const [logFor, setLogFor] = useState<TenderRow | "new" | null>(null);
  const people = board.routing.people;
  const nameOf = (key: string | null) => (key ? people.find((p) => p.key === key)?.name ?? key : "Unassigned");
  const c = board.counts;
  const rows = useMemo(() => board.tenders.filter((t) => {
    switch (filter) {
      case "Open": return OPEN.has(t.status);
      case "Overdue": return t.overdue;
      case "Unassigned": return OPEN.has(t.status) && !t.assignee;
      case "Structural": return t.structuralFlag;
      case "Submitted": return t.status === "submitted";
      case "Won": return t.status === "won";
      case "Lost": return t.status === "lost";
      default: return true;
    }
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.dueSoon) - Number(a.dueSoon) || (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9")), [board.tenders, filter]);

  return (
    <div className="max-w-6xl space-y-4">
      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Fig label="Received" value={String(c.received ?? 0)} sub={`${c.unassigned ?? 0} not assigned yet`} />
          <Fig label="Being priced" value={String((c.received ?? 0) - (c.submitted ?? 0) - (c.won ?? 0) - (c.lost ?? 0) - (c.declined ?? 0) - (c.withdrawn ?? 0))} sub={`${board.tenders.filter((t) => t.overdue).length} overdue`} warn={board.tenders.some((t) => t.overdue)} />
          <Fig label="Submitted" value={String(c.submitted ?? 0)} sub={aud(board.values_ex_gst.submitted)} />
          <Fig label="Won" value={String(c.won ?? 0)} sub={aud(board.values_ex_gst.won)} />
          <Fig label="Lost / not quoted" value={`${c.lost ?? 0} / ${c.notQuoted ?? 0}`} sub={`open pipeline ${aud(board.values_ex_gst.openPipeline)}`} />
        </div>
        {!board.routing.configured && <p className="mt-3 text-[12px] text-amber-300">Who-looks-after-what (tender routing) isn&apos;t set up in Estimating yet - everything shows as unassigned.</p>}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-gray-100">By person</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-gray-500"><tr><th className="py-1">Person</th><th>Received</th><th>Open</th><th>Overdue</th><th>Submitted</th><th>Won</th><th>Lost</th><th>Hit rate</th><th>Days to submit</th></tr></thead>
            <tbody className="divide-y divide-edge">
              {Object.entries(board.byPerson).map(([k, p]) => (
                <tr key={k} className="text-gray-300">
                  <td className="py-1.5"><span className="text-gray-100">{nameOf(k === "unassigned" ? null : k)}</span>{people.find((x) => x.key === k) && <div className="text-[11px] text-gray-500">{people.find((x) => x.key === k)!.scope}</div>}</td>
                  <td>{p.received}</td><td>{p.open}</td><td className={p.overdue ? "font-semibold text-red-400" : ""}>{p.overdue}</td><td>{p.submitted}</td><td>{p.won}</td><td>{p.lost}</td>
                  <td>{p.hitRate == null ? "—" : `${Math.round(p.hitRate * 100)}%`}</td><td>{p.medianDaysToSubmit ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">Hit rate = won ÷ (won + lost) in the period.</p>
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 text-xs ${filter === f ? "bg-brand-600 text-white" : "bg-panel2 text-gray-300 hover:bg-panel"}`}>{f}</button>)}
          </div>
          <button onClick={() => setLogFor("new")} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500">Log my quote</button>
        </div>
        {!rows.length ? <p className="py-6 text-center text-sm text-gray-500">Nothing here.</p> : (
          <ul className="divide-y divide-edge">
            {rows.map((t) => <TenderLine key={t.id} t={t} people={people} configured={board.routing.configured} nameOf={nameOf} onLog={() => setLogFor(t)} onChanged={onChanged} />)}
          </ul>
        )}
      </Card>
      {logFor && <LogQuote tender={logFor === "new" ? null : logFor} onClose={() => setLogFor(null)} onDone={(m) => { setLogFor(null); onChanged(m); }} />}
    </div>
  );
}

function TenderLine({ t, people, configured, nameOf, onLog, onChanged }: {
  t: TenderRow; people: TendersBoardV1["routing"]["people"]; configured: boolean; nameOf: (k: string | null) => string; onLog: () => void; onChanged: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function assign(key: string) {
    const reason = window.prompt(`Why ${key ? nameOf(key) : "unassign"}? (a few words)`, key ? `Suits ${nameOf(key)}` : "");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setErr(null);
    const r = await apiFetch(`/api/directors/tenders/${t.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: t.version, assignee: key, reason }) });
    setBusy(false);
    if (r.ok) onChanged(`${t.quoteNo ?? t.name}: ${key ? `assigned to ${nameOf(key)}` : "unassigned"}.`); else setErr(await serverErrorMessage(r, "Couldn't assign it."));
  }
  const folder = https(t.folderUrl), portal = https(t.portalUrl);
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-gray-100">
            <span className="font-semibold">{t.quoteNo ?? "—"}</span> · {t.name || "Untitled"}
            {t.structuralFlag && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300" title={t.structuralNote ?? undefined}>Structural</span>}
          </div>
          <div className="text-[12px] text-gray-500">
            {[t.client, t.builders.length ? `builders: ${t.builders.join(", ")}` : null, t.siteAddress].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-0.5 text-[12px] text-gray-400">
            {STATUS[t.status] ?? t.status} · received {day(t.receivedDate)} ·{" "}
            <span className={t.overdue ? "font-semibold text-red-400" : t.dueSoon ? "text-amber-300" : ""}>{t.overdue ? "OVERDUE · " : ""}due {day(t.dueDate)}</span>
            {t.submittedValue != null && <> · submitted {aud(t.submittedValue)}</>}
            {t.valueEstimate != null && t.submittedValue == null && <> · rough value {aud(t.valueEstimate)}</>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px]">
            {folder && <a href={folder} target="_blank" rel="noopener noreferrer" className="text-brand-300 underline">Folder</a>}
            {portal && <a href={portal} target="_blank" rel="noopener noreferrer" className="text-brand-300 underline">Portal</a>}
            {t.quoteFile && <a href={`/api/directors/tenders/${t.id}/quote-files/${t.quoteFile.id}`} className="text-brand-300 underline">Quote{t.quoteFile.revision ? ` rev ${t.quoteFile.revision}` : ""}</a>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <select disabled={busy || !configured} value={t.assignee ?? ""} onChange={(e) => assign(e.target.value)} title={t.assignReason ?? undefined}
            className="rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200">
            <option value="">Unassigned</option>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          {OPEN.has(t.status) && <button onClick={onLog} className="text-xs text-brand-300 underline">Log my quote</button>}
        </div>
      </div>
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </li>
  );
}

function LogQuote({ tender, onClose, onDone }: { tender: TenderRow | null; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ quoteNo: tender?.quoteNo ?? "", builder: tender?.builders.length === 1 ? tender.builders[0] : "", valueExGst: "", revision: "", submittedDate: new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }) });
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const x = e.target.files?.[0];
    if (!x) return;
    if (x.size > UPLOAD_FILE_MAX) { setErr(UPLOAD_TOO_LARGE); return; }
    const rd = new FileReader();
    rd.onload = () => { setFile({ name: x.name, dataUrl: String(rd.result) }); setErr(null); if (!f.quoteNo) { const m = /\b(\d{2}_\d{3,4})\b/.exec(x.name); if (m) setF((v) => ({ ...v, quoteNo: m[1] })); } };
    rd.readAsDataURL(x);
  }
  async function save() {
    if (!file) { setErr("Attach the quote (PDF or Word)."); return; }
    if (dataUrlBytes(file.dataUrl) > UPLOAD_FILE_MAX) { setErr(UPLOAD_TOO_LARGE); return; }
    setBusy(true); setErr(null);
    const r = await apiFetch("/api/directors/tenders/log-quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenderId: tender?.id ?? null, version: tender?.version, fileName: file.name, dataUrl: file.dataUrl, ...f }),
    });
    setBusy(false);
    if (r.ok) { const b = await r.json().catch(() => ({})); onDone(b.created ? `Quote ${f.quoteNo} logged as a new tender.` : `Quote logged on ${tender?.quoteNo ?? f.quoteNo}.`); }
    else setErr(await serverErrorMessage(r, "Couldn't log the quote."));
  }
  const input = "w-full rounded-md border border-edge bg-panel2 px-2.5 py-2 text-sm text-gray-100";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl border border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-100">Log my quote{tender ? ` · ${tender.quoteNo ?? tender.name}` : ""}</h3>
        <p className="text-xs text-gray-500">For a quote you sent outside Estimating. It goes on the tender in Estimating and marks it submitted.{tender ? "" : " With no tender picked, it's matched by quote number, or added as a new tender."}</p>
        <label className="block text-sm text-gray-300">Quote file (PDF or Word, 7 MB)<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={pick} className="mt-1 block w-full text-sm text-gray-300" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm text-gray-300">Quote no.<input className={input} value={f.quoteNo} onChange={(e) => setF({ ...f, quoteNo: e.target.value })} placeholder="26_543" /></label>
          <label className="text-sm text-gray-300">Revision<input className={input} value={f.revision} onChange={(e) => setF({ ...f, revision: e.target.value })} placeholder="R1" /></label>
          <label className="col-span-2 text-sm text-gray-300">Builder<input className={input} value={f.builder} onChange={(e) => setF({ ...f, builder: e.target.value })} list="tender-builders" />
            {tender && <datalist id="tender-builders">{tender.builders.map((b) => <option key={b} value={b} />)}</datalist>}</label>
          <label className="text-sm text-gray-300">Value ex GST<input className={input} inputMode="decimal" value={f.valueExGst} onChange={(e) => setF({ ...f, valueExGst: e.target.value })} placeholder="0" /></label>
          <label className="text-sm text-gray-300">Sent on<input type="date" className={input} value={f.submittedDate} onChange={(e) => setF({ ...f, submittedDate: e.target.value })} /></label>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-edge px-3 py-1.5 text-sm text-gray-300">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Log quote"}</button>
        </div>
      </div>
    </div>
  );
}

function Fig({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-xl font-semibold ${warn ? "text-red-400" : "text-gray-100"}`}>{value}</div>
      {sub && <div className="text-[12px] text-gray-500">{sub}</div>}
    </div>
  );
}
