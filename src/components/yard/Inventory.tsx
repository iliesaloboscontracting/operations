"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { History, Loader2, Minus, Plus, Search, X } from "lucide-react";
import FormModal, { type FieldDef } from "@/components/FormModal";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { CATEGORIES, CATEGORY_LABEL, UNIT_SUGGESTIONS, fmtQty, type MoveKind } from "@/lib/inventory/rules";
import type { ItemView } from "@/lib/inventory/store";

// The consumables inventory (Yard Stage C, Ilies 4 Nov 2026): rubble bags, blades, P2 masks, gloves, hi-vis... with a
// unit, a minimum and a location. Stock in, stock out (to a site) and counts, each recorded with who and when; the
// items below their minimum on top, with "Request a purchase" for those who raise them. Quantities only - never a
// price. The list starts empty: the yard and the office add the items.

type Data = { items: ItemView[]; sites: { id: string; name: string }[]; belowMin: number; canWrite: boolean; canRequestPurchase: boolean };
type Move = { id: string; kind: string; change: number; balanceAfter: number; countedQty: number | null; reason: string | null; siteLabel: string | null; request: string | null; by: string; at: string };

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const btn = "rounded-lg border border-edge px-2.5 py-1.5 text-xs text-gray-200 hover:bg-panel2 disabled:opacity-40";
const TONE: Record<string, string> = { BELOW: "bg-red-500/15 text-red-300", OK: "bg-emerald-500/15 text-emerald-300", NOT_SET: "bg-gray-700/50 text-gray-400" };
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const KIND_TEXT: Record<string, string> = { IN: "Stock in", OUT: "Stock out", COUNT: "Count" };
const send = async (url: string, method: string, body: unknown) => {
  const r = await apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await serverErrorMessage(r, "Couldn't save."));
  return r.json();
};

export default function Inventory() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [belowOnly, setBelowOnly] = useState(false);
  const [retired, setRetired] = useState(false);
  const [editing, setEditing] = useState<ItemView | "new" | null>(null);
  const [moving, setMoving] = useState<{ item: ItemView; kind: MoveKind } | null>(null);
  const [history, setHistory] = useState<ItemView | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/inventory${retired ? "?all=1" : ""}`).catch(() => null);
    if (!r?.ok) return setError(r ? await serverErrorMessage(r, "Couldn't load the inventory.") : "Couldn't load the inventory.");
    setError(null);
    setData(await r.json());
  }, [retired]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("below")) setBelowOnly(true); // the "below minimum" alert
  }, []);
  useAutoRefresh(load, 30_000);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.items ?? []).filter((i) =>
      (!cat || i.category === cat) && (!belowOnly || i.status === "BELOW")
      && (!s || i.name.toLowerCase().includes(s) || (i.location ?? "").toLowerCase().includes(s)));
  }, [data, q, cat, belowOnly]);
  const below = (data?.items ?? []).filter((i) => i.active && i.status === "BELOW");

  if (!data) return error ? <p className="text-sm text-red-400">{error}</p> : <p className="text-sm text-gray-500">Loading…</p>;
  const w = data.canWrite;
  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {below.length > 0 && (
        <section className="mb-5 rounded-xl border border-red-500/40 bg-red-500/5 p-3">
          <h2 className="mb-2 text-sm font-semibold text-red-200">Below minimum ({below.length})</h2>
          <ul className="space-y-1.5">
            {below.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-100">{i.name}</span>
                <span className="text-gray-400">{fmtQty(i.onHand)} {i.unit} left · minimum {fmtQty(i.minLevel ?? 0)}{i.location ? ` · ${i.location}` : ""}</span>
                {data.canRequestPurchase && (
                  <Link href={`/purchases?stockItem=${i.id}`} className="ml-auto rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-500">Request a purchase</Link>
                )}
              </li>
            ))}
          </ul>
          {!data.canRequestPurchase && <p className="mt-2 text-xs text-gray-500">The office raises the purchase request - the Admins were alerted when it dropped below.</p>}
        </section>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-500" />
          <input className={`${input} pl-8`} placeholder="Search name or location" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className={`${input} w-auto`} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-gray-300"><input type="checkbox" checked={belowOnly} onChange={(e) => setBelowOnly(e.target.checked)} /> Below minimum only</label>
        <label className="flex items-center gap-1.5 text-xs text-gray-300"><input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} /> Show retired</label>
        {w && <button onClick={() => setEditing("new")} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500"><Plus size={14} className="mr-1 inline" />Add item</button>}
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-gray-500">
          Nothing in the inventory yet.{w ? " Add the first item - its unit, where it lives and (if you know it) the minimum to keep." : ""}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Location</th><th className="px-3 py-2 text-right">On hand</th><th className="px-3 py-2 text-right">Minimum</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={`border-t border-edge/60 ${i.active ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2"><div className="font-medium text-gray-100">{i.name}</div><div className="text-xs text-gray-500">{i.categoryLabel}{i.active ? "" : " · retired"}</div></td>
                  <td className="px-3 py-2 text-gray-300">{i.location ?? <span className="text-gray-600">-</span>}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-100">{fmtQty(i.onHand)} <span className="font-normal text-gray-400">{i.unit}</span></td>
                  <td className="px-3 py-2 text-right text-gray-300">{i.minLevel === null ? <span className="text-gray-600">not set</span> : fmtQty(i.minLevel)}</td>
                  <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${TONE[i.status]}`}>{i.statusLabel}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {w && i.active && (<>
                        <button className={btn} onClick={() => setMoving({ item: i, kind: "IN" })}><Plus size={12} className="inline" /> In</button>
                        <button className={btn} onClick={() => setMoving({ item: i, kind: "OUT" })}><Minus size={12} className="inline" /> Out</button>
                        <button className={btn} onClick={() => setMoving({ item: i, kind: "COUNT" })}>Count</button>
                      </>)}
                      <button className={btn} onClick={() => setHistory(i)}><History size={12} className="inline" /> History</button>
                      {w && <button className={btn} onClick={() => setEditing(i)}>Edit</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-500">Nothing matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ItemForm item={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {moving && <MoveForm item={moving.item} kind={moving.kind} sites={data.sites} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); load(); }} />}
      {history && <HistoryPanel item={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function ItemForm({ item, onClose, onSaved }: { item: ItemView | null; onClose: () => void; onSaved: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const fields: FieldDef[] = [
    { key: "name", label: "Item", required: true, full: true, placeholder: "e.g. Rubble bags (heavy duty)" },
    { key: "category", label: "Category", type: "select", options: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })) },
    { key: "unit", label: "Unit", required: true, placeholder: `e.g. ${UNIT_SUGGESTIONS.slice(0, 5).join(", ")}` },
    { key: "minLevel", label: "Minimum to keep (blank = not set)", type: "number" },
    { key: "location", label: "Where it lives", placeholder: "e.g. Shelf B2" },
    ...(!item ? ([{ key: "openingQty", label: "On the shelf now (optional - recorded as the first count)", type: "number", full: true }] as FieldDef[]) : []),
  ];
  // CI-007 (Ilies approved 4 Nov 2026 - the double-add race is an accepted risk; this is the client-side guard): one
  // save at a time. The button is already disabled while saving; a second click or Enter that slips in before that
  // re-renders just waits for the save already on its way instead of sending another.
  const inFlight = useRef<Promise<void> | null>(null);
  function save(v: Record<string, unknown>) {
    inFlight.current ??= (async () => {
      try {
        await send(item ? `/api/inventory/${item.id}` : "/api/inventory", item ? "PATCH" : "POST", {
          name: v.name, category: v.category, unit: v.unit, minLevel: v.minLevel === "" ? null : v.minLevel, location: v.location,
          ...(!item ? { openingQty: v.openingQty } : {}),
        });
        onSaved();
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }
  async function setActive(active: boolean) {
    if (!item) return;
    if (!active && !confirm(`Retire ${item.name}? It leaves the list; its history is kept and it can be brought back.`)) return;
    try {
      await send(`/api/inventory/${item.id}`, "PATCH", { active });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <FormModal
      title={item ? `Edit ${item.name}` : "Add an item"}
      fields={fields}
      initial={item ? { name: item.name, category: item.category, unit: item.unit, minLevel: item.minLevel ?? "", location: item.location ?? "" } : { category: "CONSUMABLES", unit: "each" }}
      onSave={save}
      onClose={onClose}
      submitLabel={item ? "Save" : "Add"}
      extra={item && (
        <div className="mt-2 text-sm">
          {item.active
            ? <button type="button" onClick={() => setActive(false)} className="text-red-300 underline">Retire this item</button>
            : <button type="button" onClick={() => setActive(true)} className="text-emerald-300 underline">Bring it back</button>}
          {err && <p className="mt-1 text-red-400">{err}</p>}
          <p className="mt-1 text-xs text-gray-500">Quantities change only with stock in, stock out or a count - so every change is recorded.</p>
        </div>
      )}
    />
  );
}

function MoveForm({ item, kind, sites, onClose, onSaved }: { item: ItemView; kind: MoveKind; sites: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/inventory/${item.id}/movements`, "POST", { kind, ...(kind === "COUNT" ? { countedQty: qty } : { qty }), reason, ...(kind === "OUT" && projectId ? { projectId } : {}) });
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form onSubmit={go} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm space-y-3 rounded-xl border border-edge bg-panel p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-gray-500">{KIND_TEXT[kind]}</div>
            <h2 className="text-lg font-semibold text-gray-100">{item.name}</h2>
            <div className="text-xs text-gray-400">On the shelf: {fmtQty(item.onHand)} {item.unit}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-panel2" aria-label="Close"><X size={16} /></button>
        </div>
        <label className="block text-sm text-gray-300">
          {kind === "COUNT" ? `How many ${item.unit} are on the shelf?` : kind === "IN" ? `How many ${item.unit} came in?` : `How many ${item.unit} went out?`}
          <input className={`${input} mt-1`} inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        {kind === "OUT" && (
          <label className="block text-sm text-gray-300">To a site (optional)
            <select className={`${input} mt-1`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Not for a site</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="block text-sm text-gray-300">Note (optional)
          <input className={`${input} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "IN" ? "e.g. delivery from the supplier" : kind === "COUNT" ? "e.g. monthly count" : "e.g. for Sam's crew"} />
        </label>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button disabled={busy || !qty.trim()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} {KIND_TEXT[kind]}
        </button>
      </form>
    </div>
  );
}

function HistoryPanel({ item, onClose }: { item: ItemView; onClose: () => void }) {
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiFetch(`/api/inventory/${item.id}`)
      .then(async (r) => {
        if (!r.ok) return setErr(await serverErrorMessage(r, "Couldn't load the history."));
        const d = (await r.json()) as { movements: Move[]; edits?: Edit[] };
        setMoves(d.movements);
        setEdits(d.edits ?? []);
      })
      .catch(() => setErr("Couldn't load the history."));
  }, [item.id]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto border-l border-edge bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div><div className="text-xs text-gray-500">History</div><h2 className="text-lg font-semibold text-gray-100">{item.name}</h2><div className="text-xs text-gray-400">{fmtQty(item.onHand)} {item.unit} on hand{item.createdBy ? ` · added by ${item.createdBy}` : ""}</div></div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-panel2" aria-label="Close"><X size={18} /></button>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
        {!moves ? <p className="text-sm text-gray-500">Loading…</p> : !moves.length ? <p className="text-sm text-gray-500">No stock movements yet.</p> : (
          <ol className="space-y-2">
            {moves.map((m) => (
              <li key={m.id} className="rounded-lg bg-panel2 px-3 py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-gray-100">{KIND_TEXT[m.kind] ?? m.kind} {m.kind === "COUNT" ? `- counted ${fmtQty(m.countedQty ?? 0)}` : `${m.change > 0 ? "+" : ""}${fmtQty(m.change)}`}</span>
                  <span className="text-gray-400">now {fmtQty(m.balanceAfter)} {item.unit}</span>
                </div>
                <div className="text-xs text-gray-500">
                  {when(m.at)} · {m.by}{m.siteLabel ? ` · ${m.siteLabel}` : ""}{m.request ? ` · ${m.request}` : ""}{m.kind === "COUNT" && m.change !== 0 ? ` · ${m.change > 0 ? "+" : ""}${fmtQty(m.change)} to match` : ""}
                </div>
                {m.reason && <div className="text-xs text-gray-400">{m.reason}</div>}
              </li>
            ))}
          </ol>
        )}
        {/* CI-004 (Ilies approved 4 Nov 2026): every change to the item's details, who and when. */}
        {edits.length > 0 && (
          <>
            <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-widest text-gray-500">Changes to the details</h3>
            <ol className="space-y-1 text-xs text-gray-400">
              {edits.map((e) => (
                <li key={e.id}>
                  <span className="text-gray-500">{when(e.at)}</span> · {e.by} · {EDIT_LABEL[e.field] ?? e.field}: {editValue(e.field, e.before)} → {editValue(e.field, e.after)}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
type Edit = { id: string; field: string; before: string | null; after: string | null; by: string; at: string };
const EDIT_LABEL: Record<string, string> = { name: "Name", category: "Category", unit: "Unit", minLevel: "Minimum", location: "Location", active: "In use" };
const editValue = (field: string, v: string | null) =>
  v === null ? "(blank)" : field === "active" ? (v === "true" ? "yes" : "retired") : field === "category" ? (CATEGORY_LABEL[v as keyof typeof CATEGORY_LABEL] ?? v) : v;
