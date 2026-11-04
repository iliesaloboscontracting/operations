"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { resizePhoto } from "@/lib/imageResize";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { PRIORITY_DOT, PRIORITY_LABEL, PRIORITY_TONE, STATUS_FOR_SITE, requestNo, typeOf, whenText } from "@/lib/requestTypes";
import { groupYardJobs } from "@/lib/yard/rules";
import type { YardJobView } from "@/lib/siteRequests";

// Yard jobs (Ilies, 4 Nov 2026): the yard's list - on the yard's shared phone link
// and on /yard. Grouped by the day it's needed (Sydney), then site. The yard gets the
// gear ready, takes a photo (required), notes anything missing, and taps "Ready for
// collection"; the supervisor (or the yard) taps "Collected". "Can't do" sends it back
// to the office. Nothing here ever carries a dollar figure (lib/siteRequests.ts yardView).
//   api:  the list (GET), `${api}/:id` (PATCH) and `${api}/:id/photo?which=request|ready`
//   who:  on the shared link, the name typed on this phone (sent with every action)

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";

const TONE: Record<string, string> = {
  YARD: "bg-sky-500/15 text-sky-300",
  READY: "bg-emerald-500/25 text-emerald-200",
  DONE: "bg-gray-700/50 text-gray-300",
};
const STATUS_TEXT: Record<string, string> = { YARD: "To get ready", READY: "Ready - waiting to be collected", DONE: "Collected" };

export default function YardJobs({ api, who, shared = false, inApp = false, openId }: { api: string; who?: string; shared?: boolean; inApp?: boolean; openId?: string | null }) {
  const [jobs, setJobs] = useState<YardJobView[] | null>(null);
  const [canAct, setCanAct] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCollected, setShowCollected] = useState(false);
  const get = inApp ? apiFetch : fetch;

  const load = useCallback(async () => {
    const res = await get(api).catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load the yard list.") : "Couldn't load - check your signal.");
    const body = (await res.json()) as { jobs: YardJobView[]; canAct: boolean };
    setError(null);
    setJobs(body.jobs);
    setCanAct(body.canAct);
  }, [api, get]);
  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 20_000);

  // A tapped alert opens /yard?open=<id> - scroll to that job.
  useEffect(() => {
    if (!openId || !jobs) return;
    document.getElementById(`yard-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [openId, jobs]);

  const replace = (j: YardJobView) => setJobs((js) => (js ? js.map((x) => (x.id === j.id ? j : x)).filter((x) => x.status === "YARD" || x.status === "READY" || x.status === "DONE") : js));

  if (!jobs) return error ? <p className="text-sm text-red-400">{error}</p> : <div className="py-10 text-center"><Loader2 className="mx-auto animate-spin text-gray-500" /></div>;
  const { groups, collected, open, ready } = groupYardJobs(jobs);
  const needName = shared && canAct && (who ?? "").trim().length < 2;

  return (
    <div>
      <p className="mb-3 text-sm text-gray-500">
        {open ? `${open - ready} to get ready, ${ready} waiting to be collected.` : "Nothing waiting for the yard."} Updates by itself.
      </p>
      {needName && <p className="mb-3 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-300">Put your name in at the top first, so the office knows who did it.</p>}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className={`mb-2 text-sm font-semibold uppercase tracking-wider ${g.overdue ? "text-red-400" : "text-gray-400"}`}>{g.label}</h2>
            <div className="space-y-3">
              {g.sites.map((s) => (
                <div key={s.site}>
                  <div className="mb-1.5 text-sm font-semibold text-gray-200">{s.site}</div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {s.jobs.map((j) => (
                      <Job key={j.id} api={api} j={j} canAct={canAct} who={who} shared={shared} inApp={inApp} highlight={j.id === openId} onSaved={replace} onError={setError} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!!collected.length && (
        <section className="mt-6">
          <button onClick={() => setShowCollected((x) => !x)} className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-400 underline">
            Collected - last 7 days ({collected.length}) {showCollected ? "▲" : "▼"}
          </button>
          {showCollected && (
            <div className="grid gap-3 lg:grid-cols-2">
              {collected.map((j) => <Job key={j.id} api={api} j={j} canAct={false} who={who} shared={shared} inApp={inApp} onSaved={replace} onError={setError} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// "Took from stock" (Yard Stage C, 4 Nov 2026): consumables that went with the job - an item and how many each. They
// come off the stock in the same step as Ready for collection (all or nothing); more than the shelf has is refused.
type StockLine = { itemId: string; qty: string };
type StockItem = { id: string; name: string; unit: string; onHand: number; location: string | null };
function TookFromStock({ lines, onChange }: { lines: StockLine[]; onChange: (l: StockLine[]) => void }) {
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || items) return;
    apiFetch("/api/inventory").then((r) => (r.ok ? r.json() : { items: [] })).then((d: { items: StockItem[] }) => setItems(d.items)).catch(() => setItems([]));
  }, [open, items]);
  if (!open && !lines.length) return <button type="button" onClick={() => { setOpen(true); onChange([{ itemId: "", qty: "" }]); }} className="text-sm text-gray-300 underline">Took consumables from stock?</button>;
  const set = (i: number, l: Partial<StockLine>) => onChange(lines.map((x, k) => (k === i ? { ...x, ...l } : x)));
  return (
    <div className="space-y-1.5 rounded-lg border border-edge p-2">
      <div className="text-sm text-gray-300">Took from stock</div>
      {!items ? <p className="text-xs text-gray-500">Loading the consumables…</p> : !items.length ? <p className="text-xs text-gray-500">Nothing in the inventory yet.</p> : lines.map((l, i) => {
        const it = items.find((x) => x.id === l.itemId);
        return (
          <div key={i} className="flex gap-1.5">
            <select className={`${input} flex-1 text-sm`} value={l.itemId} onChange={(e) => set(i, { itemId: e.target.value })}>
              <option value="">Pick the item</option>
              {items.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.onHand} {x.unit}{x.location ? ` · ${x.location}` : ""})</option>)}
            </select>
            <input className={`${input} w-20 text-sm`} inputMode="decimal" placeholder={it?.unit ?? "qty"} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <button type="button" onClick={() => onChange(lines.filter((_, k) => k !== i))} className="px-1 text-gray-400" aria-label="Remove"><X size={16} /></button>
          </div>
        );
      })}
      {items && items.length > 0 && lines.length < 20 && <button type="button" onClick={() => onChange([...lines, { itemId: "", qty: "" }])} className="text-xs text-brand-300 underline">+ another item</button>}
      {!lines.length && <button type="button" onClick={() => setOpen(false)} className="block text-xs text-gray-500 underline">None</button>}
    </div>
  );
}

function Job({ api, j, canAct, who, shared, inApp, highlight, onSaved, onError }: {
  api: string; j: YardJobView; canAct: boolean; who?: string; shared: boolean; inApp: boolean; highlight?: boolean;
  onSaved: (j: YardJobView) => void; onError: (e: string | null) => void;
}) {
  const [mode, setMode] = useState<"READY" | "CANT_DO" | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [stock, setStock] = useState<StockLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<"request" | "ready" | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const type = typeOf(j.kind);
  const late = j.status !== "DONE" && new Date(j.neededBy).getTime() < Date.now();
  const send = inApp ? apiFetch : fetch;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    onError(null);
    try {
      const res = await send(`${api}/${j.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...(shared ? { who } : {}) }) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save - check your signal and try again."));
      onSaved(((await res.json()) as { job: YardJobView }).job);
      setMode(null);
      setPhoto(null);
      setNote("");
      setStock([]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addPhoto(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try {
      setPhoto(await resizePhoto(f));
    } catch {
      setErr("Couldn't use that photo - try another.");
    } finally {
      if (file.current) file.current.value = "";
    }
  }

  return (
    <div id={`yard-${j.id}`} className={`rounded-xl border bg-panel p-4 ${highlight ? "border-brand-500" : "border-edge"} ${j.status === "DONE" ? "opacity-75" : ""}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{requestNo(j.number)} · {type?.label ?? j.label}</span>
        <span className="flex items-center gap-1.5">
          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_TONE[j.priority]}`}>{PRIORITY_DOT[j.priority]} {PRIORITY_LABEL[j.priority]}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${TONE[j.status] ?? ""}`}>{STATUS_TEXT[j.status] ?? STATUS_FOR_SITE[j.status] ?? j.status}</span>
        </span>
      </div>
      <div className="text-base font-semibold text-gray-100">{j.summary}</div>
      <div className={`text-sm ${late ? "font-semibold text-red-400" : "text-gray-400"}`}>
        {late ? "Overdue - needed " : "Needed by "}{whenText(j.neededBy)} · {j.requestedBy}
      </div>
      <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-2 gap-y-0.5 text-sm">
        {type?.fields.map((f) => (j.details[f.key] ? (
          <Fragment key={f.key}><dt className="text-gray-500">{f.label}</dt><dd className="text-gray-200">{j.details[f.key]}</dd></Fragment>
        ) : null))}
      </dl>
      {j.note && <p className="mt-2 rounded-lg bg-panel2 px-3 py-2 text-sm text-gray-300">Supervisor: “{j.note}”</p>}
      {j.officeNote && <p className="mt-2 text-sm text-brand-200">Office: {j.officeNote}</p>}
      {j.onItBy && j.status === "YARD" && <p className="mt-2 text-sm text-sky-300">{j.onItBy} is on it</p>}
      {j.readyAt && (
        <p className="mt-2 text-sm text-emerald-300">Ready {whenText(j.readyAt)}{j.readyBy ? ` · ${j.readyBy}` : ""}</p>
      )}
      {j.readyNote && <p className="mt-1 text-sm text-amber-300">Missing / to buy elsewhere: {j.readyNote}</p>}
      {j.collectedAt && <p className="mt-1 text-sm text-gray-400">Collected {whenText(j.collectedAt)}{j.collectedBy ? ` · ${j.collectedBy}` : ""}</p>}

      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {j.hasPhoto && <button onClick={() => setShow((s) => (s === "request" ? null : "request"))} className="text-gray-300 underline">{show === "request" ? "Hide photo" : "Supervisor's photo"}</button>}
        {j.hasReadyPhoto && <button onClick={() => setShow((s) => (s === "ready" ? null : "ready"))} className="text-gray-300 underline">{show === "ready" ? "Hide photo" : "Ready photo"}</button>}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {show && <img src={`${api}/${j.id}/photo?which=${show}`} alt="" className="mt-2 max-h-72 w-full rounded-lg object-contain" />}

      {canAct && j.status !== "DONE" && (
        <div className="mt-3">
          {mode === "READY" ? (
            <div className="space-y-2 rounded-lg border border-edge bg-panel2 p-3">
              <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhoto(e.target.files?.[0])} />
              {photo ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt="" className="max-h-56 w-full rounded-lg object-cover" />
                  <button onClick={() => setPhoto(null)} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white" aria-label="Remove photo"><X size={16} /></button>
                </div>
              ) : (
                <button type="button" onClick={() => file.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-edge px-4 py-6 text-sm text-gray-300">
                  <Camera size={18} /> Photo of the gear (required)
                </button>
              )}
              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">Anything missing / needs buying from another supplier? (optional)</span>
                <textarea className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. only 1 of the 2 grinders - the office needs to get another" />
              </label>
              {/* Yard Stage C (4 Nov 2026): consumables that went with it come off the stock - on the yard computer /
                  in the app only, never on the shared phone link. */}
              {inApp && <TookFromStock lines={stock} onChange={setStock} />}
              {err && <p className="text-sm text-red-400">{err}</p>}
              <button className={primary} disabled={busy || !photo || stock.some((l) => !l.itemId || !(Number(l.qty) > 0))}
                onClick={() => act({ action: "READY", photo, note, ...(inApp && stock.length ? { stock: stock.map((l) => ({ itemId: l.itemId, qty: l.qty })) } : {}) })}>
                {busy && <Loader2 size={18} className="animate-spin" />} Ready for collection
              </button>
              <button className="w-full py-1 text-sm text-gray-400" onClick={() => setMode(null)}>Back</button>
            </div>
          ) : mode === "CANT_DO" ? (
            <div className="space-y-2 rounded-lg border border-edge bg-panel2 p-3">
              <label className="block">
                <span className="mb-1 block text-sm text-gray-300">Why can&apos;t the yard do it? It goes back to the office.</span>
                <textarea className={input} rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. none in the yard - all out on site" />
              </label>
              {err && <p className="text-sm text-red-400">{err}</p>}
              <button className={primary} disabled={busy || note.trim().length < 2} onClick={() => act({ action: "CANT_DO", reason: note })}>Send back to the office</button>
              <button className="w-full py-1 text-sm text-gray-400" onClick={() => setMode(null)}>Back</button>
            </div>
          ) : j.status === "YARD" ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode("READY")} className="col-span-2 rounded-lg bg-emerald-600 px-3 py-3 text-sm font-semibold text-white">Ready for collection</button>
              {!j.onItBy && <button disabled={busy} onClick={() => act({ action: "ON_IT" })} className="rounded-lg border border-edge px-3 py-2.5 text-sm text-gray-200">On it</button>}
              <button onClick={() => setMode("CANT_DO")} className={`rounded-lg border border-red-500/40 px-3 py-2.5 text-sm text-red-300 ${j.onItBy ? "col-span-2" : ""}`}>Can&apos;t do</button>
            </div>
          ) : (
            <button disabled={busy} onClick={() => act({ action: "COLLECTED" })} className="w-full rounded-lg bg-brand-600 px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">
              Collected
            </button>
          )}
          {err && !mode && <p className="mt-2 text-sm text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}
