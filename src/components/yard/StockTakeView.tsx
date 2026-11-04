"use client";

// One yard stock take (Yard Stage B, Ilies 4 Nov 2026): progress, search, tick off each tool (found / not here /
// condition), "Scan a shelf" with photos, a tool found here that the register has elsewhere, and Finish - where every
// tool not found is confirmed as missing (or left as it is) before anything is marked Missing. Read-only when the
// stock take is finished or cancelled, or for a login that only looks. No dollar figures (the API strips them for
// the coordinator and the yard). Rules: lib/stockTake/rules.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, ScanLine, Search, X } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { CONDITIONS_SEEN, MAX_SCAN_PHOTOS, isMissingCandidate, type Summary } from "@/lib/stockTake/rules";
import type { ToolDTO } from "@/lib/types";

export type StockLine = {
  id: string; toolId: string | null; tag: string; name: string; serialNumber: string | null; conditionAtStart: string | null;
  expected: boolean; registerPlace: string | null; result: string; conditionSeen: string | null; via: string | null;
  checkedBy: string | null; checkedAt: string | null; movedAt: string | null; decision: string | null; appliedAt: string | null; appliedChange: string | null;
  now: { condition: string; place: string; inYard: boolean } | null;
};
export type StockTakeDetail = {
  id: string; location: string; status: string; note: string | null; startedAt: string; startedBy: string | null;
  finishedAt: string | null; finishedBy: string | null; lines: StockLine[]; summary: Summary; scansLeft: number;
};

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const post = (url: string, body: unknown) => apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

const FILTERS = [
  { key: "todo", label: "To check" }, { key: "found", label: "Found" }, { key: "notfound", label: "Not here" }, { key: "extra", label: "Extras" }, { key: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];
const inFilter = (l: StockLine, f: Filter) =>
  f === "all" ? true : f === "todo" ? l.expected && l.result === "UNCHECKED" : f === "found" ? l.result === "FOUND" : f === "notfound" ? l.result === "NOT_FOUND" : l.result === "EXTRA";

function Badge({ l }: { l: StockLine }) {
  const s = l.result === "FOUND" ? ["Found", "bg-emerald-500/15 text-emerald-400"] : l.result === "NOT_FOUND" ? ["Not here", "bg-red-500/15 text-red-300"]
    : l.result === "EXTRA" ? ["Found here", "bg-sky-500/15 text-sky-300"] : ["To check", "bg-gray-700 text-gray-300"];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s[1]}`}>{s[0]}{l.via === "PHOTO" ? " · photo" : ""}</span>;
}

export default function StockTakeView({ id, canWork, onClosed }: { id: string; canWork: boolean; onClosed: () => void }) {
  const [st, setSt] = useState<StockTakeDetail | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("todo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/stock-takes/${id}`);
    if (r.ok) setSt(await r.json());
    else setError(await serverErrorMessage(r, "Couldn't load the stock take."));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const open = st?.status === "OPEN";
  const work = canWork && open;
  useEffect(() => { if (st && !open) setFilter("all"); }, [st, open]);

  async function act(lineId: string, body: Record<string, unknown>) {
    setBusy(lineId);
    setError(null);
    const r = await post(`/api/stock-takes/${id}/lines`, { lineId, ...body });
    if (!r.ok) setError(await serverErrorMessage(r, "Couldn't save that."));
    await load();
    setBusy(null);
  }

  const lines = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (st?.lines ?? []).filter((l) => inFilter(l, filter) && (!n || `${l.tag} ${l.name} ${l.serialNumber ?? ""}`.toLowerCase().includes(n)));
  }, [st, q, filter]);

  if (!st) return <p className="text-sm text-gray-500">{error ?? "Loading…"}</p>;
  const s = st.summary;
  const pct = s.expected ? Math.round((s.checked / s.expected) * 100) : 100;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-gray-100">
              Stock take of the yard {open ? "" : st.status === "FINISHED" ? "· finished" : "· cancelled"}
            </div>
            <div className="text-xs text-gray-500">
              Started {when(st.startedAt)}{st.startedBy ? ` by ${st.startedBy}` : ""}
              {st.finishedAt && ` · ${st.status === "FINISHED" ? "finished" : "cancelled"} ${when(st.finishedAt)}${st.finishedBy ? ` by ${st.finishedBy}` : ""}`}
            </div>
            {st.note && <div className="mt-1 text-xs text-gray-400">{st.note}</div>}
          </div>
          {work && (
            <div className="flex flex-wrap gap-2">
              <button className={`${quiet} flex items-center gap-1.5 border-brand-500 text-brand-300`} onClick={() => setScanning(true)} disabled={st.scansLeft <= 0}>
                <ScanLine size={14} /> Scan a shelf
              </button>
              <button className={quiet} onClick={() => setAdding(true)}>Found a tool from elsewhere</button>
              <button className={btn} onClick={() => setFinishing(true)}>Finish…</button>
            </div>
          )}
        </div>
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>{s.checked} of {s.expected} checked</span>
            <span>{s.found} found · {s.notFound} not here · {s.unchecked} to check · {s.extras} from elsewhere · {s.needsRepair} need repair</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-panel2"><div className="h-full bg-brand-600" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
          <input className={`${input} pl-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tag, name or serial" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === f.key ? "bg-brand-600 text-white" : "border border-edge bg-panel text-gray-400 hover:text-gray-200"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-panel">
        {lines.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-500">{filter === "todo" && open ? "Nothing left to check." : "Nothing here."}</li>}
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
            <span className="w-20 shrink-0 font-mono text-xs text-gray-400">{l.tag}</span>
            <span className="min-w-0 flex-1">
              <span className="text-gray-200">{l.name}</span>
              <span className="ml-2 font-mono text-[11px] text-gray-500">{l.serialNumber ?? ""}</span>
              <span className="block text-[11px] text-gray-500">
                {l.result === "EXTRA" ? `Register says: ${l.registerPlace ?? "elsewhere"}${l.movedAt ? " - moved to the yard" : ""}` : `Register: ${l.now?.condition ?? l.conditionAtStart ?? ""}`}
                {l.now && !l.now.inYard && l.result !== "EXTRA" ? ` · now in ${l.now.place}` : ""}
                {l.checkedBy && l.result !== "UNCHECKED" ? ` · ${l.checkedBy}` : ""}
                {!open && l.decision ? ` · ${l.decision === "MISSING" ? "confirmed missing" : "left as it was"}` : ""}
                {!open && l.appliedChange ? ` · ${l.appliedChange}` : ""}
                {!l.toolId ? " · no longer on the register" : ""}
              </span>
            </span>
            <Badge l={l} />
            {(l.result === "FOUND" || l.result === "EXTRA") && (
              work ? (
                <select className="rounded border border-edge bg-panel2 px-2 py-1 text-xs text-gray-300" value={l.conditionSeen ?? ""} disabled={busy === l.id}
                  onChange={(e) => act(l.id, { action: "CONDITION", conditionSeen: e.target.value || null })}>
                  <option value="">Condition as on register</option>
                  {CONDITIONS_SEEN.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : l.conditionSeen ? <span className="text-xs text-amber-400">{l.conditionSeen}</span> : null
            )}
            {work && (
              <span className="flex shrink-0 gap-1.5">
                {busy === l.id && <Loader2 size={14} className="animate-spin self-center text-gray-500" />}
                {l.result === "EXTRA" ? (
                  <>
                    {!l.movedAt && <button className={btn} disabled={busy === l.id} onClick={() => act(l.id, { action: "MOVE_TO_YARD" })}>Move to yard</button>}
                    {!l.movedAt && <button className={quiet} disabled={busy === l.id} onClick={() => act(l.id, { action: "DROP" })}>Drop</button>}
                  </>
                ) : (
                  <>
                    {l.result !== "FOUND" && <button className={`${btn} flex items-center gap-1`} disabled={busy === l.id} onClick={() => act(l.id, { action: "FOUND" })}><Check size={13} /> Found</button>}
                    {l.result !== "NOT_FOUND" && <button className={quiet} disabled={busy === l.id} onClick={() => act(l.id, { action: "NOT_FOUND" })}>Not here</button>}
                    {l.result !== "UNCHECKED" && <button className={quiet} disabled={busy === l.id} onClick={() => act(l.id, { action: "UNTICK" })}>Undo</button>}
                  </>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      {open && canWork && (
        <div className="flex justify-end">
          <button className="text-xs text-gray-500 hover:text-red-300" onClick={async () => {
            if (!window.confirm("Cancel this stock take? Nothing on the register changes (a tool already moved to the yard stays moved).")) return;
            const r = await post(`/api/stock-takes/${id}`, { action: "CANCEL" });
            if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't cancel it."));
            onClosed();
          }}>Cancel this stock take</button>
        </div>
      )}

      {scanning && <ScanShelf id={id} scansLeft={st.scansLeft} onClose={() => setScanning(false)} onChanged={load} />}
      {adding && <AddFound id={id} onLines={st.lines} onClose={() => setAdding(false)} onChanged={load} />}
      {finishing && <Finish st={st} onClose={() => setFinishing(false)} onDone={() => { setFinishing(false); onClosed(); }} />}
    </div>
  );
}

type ScanResult = {
  ticked: { lineId: string; tag: string }[]; alreadyFound: number;
  extras: { lineId: string; tag: string; name: string; registerPlace: string | null }[];
  probably: { lineId: string; tag: string; name: string }[];
  unknown: { description: string; brand: string; model: string; lobTag: string; serialNumber: string; possibly: string[] }[];
  notes: string; scansLeft: number;
};

function ScanShelf({ id, scansLeft, onClose, onChanged }: { id: string; scansLeft: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const r = await post(`/api/stock-takes/${id}/scan`, { photoIds: photos.filter(Boolean) });
    if (r.ok) { setResult(await r.json()); await onChanged(); } else setError(await serverErrorMessage(r, "Couldn't read the photos."));
    setBusy(false);
  }
  async function line(lineId: string, body: Record<string, unknown>, label: string) {
    setError(null);
    const r = await post(`/api/stock-takes/${id}/lines`, { lineId, ...body });
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save that."));
    setDone((d) => ({ ...d, [lineId]: label }));
    await onChanged();
  }

  return (
    <Modal title="Scan a shelf" onClose={onClose}>
      {!result ? (
        <>
          <p className="mb-3 text-xs text-gray-400">
            Photograph the shelf so the LOB labels (or rating plates) face the camera - 1 to {MAX_SCAN_PHOTOS} photos. Tools it can read are ticked as found; you can undo any of them. {scansLeft} readings left on this stock take.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {photos.map((p, i) => (
              <PhotoPicker key={i} kind="CHECK" label={`Photo ${i + 1}`} photoId={p} onChange={(pid) => setPhotos((ps) => ps.map((x, j) => (j === i ? pid : x)))} />
            ))}
          </div>
          {error && <div className="mt-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="mt-4 flex justify-between">
            <button className={quiet} disabled={photos.length >= MAX_SCAN_PHOTOS} onClick={() => setPhotos((ps) => [...ps, null])}>+ Another photo</button>
            <button className={`${btn} flex items-center gap-1.5`} disabled={busy || !photos.some(Boolean)} onClick={run}>
              {busy && <Loader2 size={13} className="animate-spin" />} {busy ? "Reading…" : "Read the shelf"}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4 text-sm">
          {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
          <p className="text-gray-300">
            Ticked {result.ticked.length} as found{result.ticked.length ? `: ${result.ticked.map((t) => t.tag).join(", ")}` : ""}.
            {result.alreadyFound ? ` ${result.alreadyFound} already ticked.` : ""}
          </p>
          {result.extras.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-400">Here, but the register has them elsewhere</div>
              {result.extras.map((x) => (
                <div key={x.lineId} className="flex items-center justify-between gap-2 py-1 text-xs">
                  <span><span className="font-mono">{x.tag}</span> {x.name} - register says {x.registerPlace ?? "elsewhere"}</span>
                  {done[x.lineId] ? <span className="text-emerald-400">{done[x.lineId]}</span>
                    : <button className={btn} onClick={() => line(x.lineId, { action: "MOVE_TO_YARD" }, "Moved to the yard")}>Move to yard</button>}
                </div>
              ))}
            </div>
          )}
          {result.probably.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-400">Probably (same brand and model - no tag or serial seen)</div>
              {result.probably.map((x) => (
                <div key={x.lineId} className="flex items-center justify-between gap-2 py-1 text-xs">
                  <span><span className="font-mono">{x.tag}</span> {x.name}</span>
                  {done[x.lineId] ? <span className="text-emerald-400">{done[x.lineId]}</span>
                    : <button className={quiet} onClick={() => line(x.lineId, { action: "FOUND" }, "Ticked")}>Tick found</button>}
                </div>
              ))}
            </div>
          )}
          {result.unknown.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold text-gray-400">Not on the register</div>
              {result.unknown.map((u, i) => (
                <div key={i} className="py-0.5 text-xs text-gray-400">{[u.description, u.brand, u.model, u.lobTag, u.serialNumber].filter(Boolean).join(" · ")}{u.possibly.length ? ` (that model is in ${u.possibly.join(", ")})` : ""}</div>
              ))}
              <p className="mt-1 text-xs text-gray-500">Add new tools with <Link className="text-brand-300 underline" href="/tools">Register by photo</Link> on the Tools page.</p>
            </div>
          )}
          {result.notes && <p className="text-xs text-gray-500">{result.notes}</p>}
          <div className="flex justify-between">
            <button className={quiet} onClick={() => { setResult(null); setPhotos([null]); setDone({}); }}>Scan another shelf</button>
            <button className={btn} onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AddFound({ id, onLines, onClose, onChanged }: { id: string; onLines: StockLine[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [tools, setTools] = useState<ToolDTO[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiFetch("/api/tools").then((r) => (r.ok ? r.json() : [])).then(setTools); }, []);
  const onIt = new Set(onLines.map((l) => l.toolId));
  const n = q.trim().toLowerCase();
  const hits = (tools ?? []).filter((t) => !onIt.has(t.id) && t.condition !== "Swapped out" && n.length >= 2 && `${t.tag} ${t.name} ${t.serialNumber ?? ""}`.toLowerCase().includes(n)).slice(0, 8);
  return (
    <Modal title="Found a tool the register has elsewhere" onClose={onClose}>
      <p className="mb-2 text-xs text-gray-400">Search the register. It's added as found here; &quot;Move to yard&quot; then moves it on the register. A tool that isn&apos;t on the register at all: use Register by photo on the Tools page.</p>
      <input className={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tag, name or serial" />
      {error && <div className="mt-2 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      <ul className="mt-2 divide-y divide-edge/60">
        {tools === null && <li className="py-2 text-xs text-gray-500">Loading…</li>}
        {hits.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
            <span><span className="font-mono">{t.tag}</span> {t.name} <span className="text-gray-500">· {t.toolbox?.name ?? "Yard"}</span></span>
            <button className={btn} onClick={async () => {
              const r = await post(`/api/stock-takes/${id}/lines`, { action: "ADD_EXTRA", toolId: t.id });
              if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't add it."));
              await onChanged();
              onClose();
            }}>Found here</button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function Finish({ st, onClose, onDone }: { st: StockTakeDetail; onClose: () => void; onDone: () => void }) {
  const candidates = st.lines.filter(isMissingCandidate);
  const [choice, setChoice] = useState<Record<string, "MISSING" | "LEAVE">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decided = candidates.every((l) => choice[l.id]);
  const s = st.summary;
  const changes = st.lines.filter((l) => (l.result === "FOUND" || l.result === "EXTRA") && l.now && (l.conditionSeen ? l.conditionSeen !== l.now.condition : l.now.condition === "Missing"));

  async function finish() {
    setBusy(true);
    setError(null);
    const missing = candidates.filter((l) => choice[l.id] === "MISSING").map((l) => l.id);
    const leave = candidates.filter((l) => choice[l.id] === "LEAVE").map((l) => l.id);
    const r = await post(`/api/stock-takes/${st.id}`, { action: "FINISH", missing, leave });
    setBusy(false);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't finish."));
    onDone();
  }

  return (
    <Modal title="Finish the stock take" onClose={onClose} wide>
      <div className="mb-3 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
        {[["Found", s.found], ["Need repair", s.needsRepair], ["Not found", s.notFound + s.unchecked], ["From elsewhere", s.extras]].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-edge bg-panel2 px-2 py-2"><div className="text-lg font-bold text-gray-100">{v}</div><div className="text-gray-500">{k}</div></div>
        ))}
      </div>
      {changes.length > 0 && (
        <p className="mb-3 text-xs text-gray-400">
          Finishing updates {changes.length} tool{changes.length === 1 ? "'s" : "s'"} condition: {changes.map((l) => `${l.tag} ${l.now?.condition} → ${l.conditionSeen ?? "Good"}`).join(", ")}.
        </p>
      )}
      {candidates.length > 0 ? (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-300">Not found - confirm each before it's marked Missing, or leave it as the register has it.</p>
            <span className="flex gap-1.5">
              <button className={quiet} onClick={() => setChoice(Object.fromEntries(candidates.map((l) => [l.id, "MISSING" as const])))}>Confirm all missing</button>
              <button className={quiet} onClick={() => setChoice(Object.fromEntries(candidates.map((l) => [l.id, "LEAVE" as const])))}>Leave all</button>
            </span>
          </div>
          <ul className="max-h-72 divide-y divide-edge/60 overflow-y-auto rounded-lg border border-edge">
            {candidates.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                <span className="w-20 font-mono text-gray-400">{l.tag}</span>
                <span className="min-w-0 flex-1 text-gray-200">{l.name} <span className="text-gray-500">· {l.result === "UNCHECKED" ? "never checked" : "not here"}{l.now && !l.now.inYard ? ` · now in ${l.now.place}` : ""}</span></span>
                {(["MISSING", "LEAVE"] as const).map((c) => (
                  <button key={c} onClick={() => setChoice((x) => ({ ...x, [l.id]: c }))}
                    className={`rounded-full px-2.5 py-1 ${choice[l.id] === c ? (c === "MISSING" ? "bg-red-600 text-white" : "bg-gray-600 text-white") : "border border-edge text-gray-400"}`}>
                    {c === "MISSING" ? "Missing" : "Leave as it is"}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : <p className="text-xs text-gray-400">Every tool was found.</p>}
      {error && <div className="mt-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button className={quiet} onClick={onClose}>Keep counting</button>
        <button className={`${btn} flex items-center gap-1.5`} disabled={busy || !decided} onClick={finish}>
          {busy && <Loader2 size={13} className="animate-spin" />} Finish
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`animate-modal-in max-h-full w-full overflow-y-auto rounded-2xl border border-edge bg-panel p-5 shadow-soft-lg ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} className="-mr-1 -mt-1 rounded-md p-1 text-gray-500 hover:bg-panel2 hover:text-gray-200" aria-label="Close"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
