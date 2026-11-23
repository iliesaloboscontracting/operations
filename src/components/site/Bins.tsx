"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, Loader2 } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { BinLinkOptionsDTO, BinLinkRowDTO } from "@/lib/bins/rules";

// Bins on a supervisor's or driver's link (Ilies, 23 Nov 2026). Delivered: photo -> job -> client's bin / our bin ->
// size (and which bin, when more than one is free) -> what's going in it. Picked up: the bin from the list of bins on
// site -> photo. Words and dates only - never a price.

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";
const choice = (on: boolean) => `flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-4 text-lg font-semibold ${on ? "border-brand-500 bg-brand-600/30 text-brand-100" : "border-edge bg-panel text-gray-200"}`;
const chip = (on: boolean) => `rounded-xl border px-3 py-3 text-base font-semibold ${on ? "border-brand-500 bg-brand-600/30 text-brand-100" : "border-edge bg-panel text-gray-200"}`;

function useBins(api: string) {
  const [data, setData] = useState<BinLinkOptionsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`${api}/bins`).catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load.") : "Couldn't load - check your signal.");
    setError(null);
    setData((await res.json()).options);
  }, [api]);
  useEffect(() => { load(); }, [load]);
  return { data, error };
}

async function send(api: string, body: Record<string, unknown>): Promise<{ message: string; warning?: string | null } | { error: string }> {
  const res = await fetch(`${api}/bins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return { error: "Couldn't send - check your signal and try again." };
  if (!res.ok) return { error: await serverErrorMessage(res, "Couldn't send - try again.") };
  return res.json();
}

export default function Bins({ api, onDone }: { api: string; onDone: (message: string) => void }) {
  const { data, error } = useBins(api);
  const [step, setStep] = useState<"home" | "deliver" | "pickup">("home");
  if (error) return <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-red-300">{error}</p>;
  if (!data) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;
  if (step === "deliver") return <Deliver api={api} data={data} onDone={onDone} onBack={() => setStep("home")} />;
  if (step === "pickup") return <PickUp api={api} data={data} onDone={onDone} onBack={() => setStep("home")} />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Bins</h1>
      <p className="text-sm text-gray-400">A photo when you drop a bin off, and again when you pick it up.</p>
      <div className="flex gap-3">
        <button className={choice(false)} onClick={() => setStep("deliver")}><ArrowDownToLine size={24} /> Delivered</button>
        <button className={choice(false)} onClick={() => setStep("pickup")} disabled={data.onSite.length === 0}>
          <ArrowUpFromLine size={24} /> Picked up
          <span className="text-xs font-normal text-gray-400">{data.onSite.length ? `${data.onSite.length} on site` : "none on site"}</span>
        </button>
      </div>
      {data.today.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-gray-300">You today</div>
          <ul className="space-y-2">{data.today.map((r) => <Row key={r.id} r={r} />)}</ul>
        </div>
      )}
    </div>
  );
}

function Row({ r }: { r: BinLinkRowDTO }) {
  return (
    <li className="rounded-2xl border border-edge bg-panel p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-100">{r.bin}</span>
        <span className="text-sm text-gray-500">{r.status}</span>
      </div>
      <div className="text-sm text-gray-400">{r.project} · {r.use} · {r.contents}</div>
      <div className="text-xs text-gray-500">Delivered {r.delivered} · {r.days}</div>
    </li>
  );
}

function Deliver({ api, data, onDone, onBack }: { api: string; data: BinLinkOptionsDTO; onDone: (m: string) => void; onBack: () => void }) {
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [projectId, setProjectId] = useState(() => data.projects.filter((p) => p.mine).length === 1 ? data.projects.find((p) => p.mine)!.id : "");
  const [use, setUse] = useState("");
  const [size, setSize] = useState("");
  const [binId, setBinId] = useState("");
  const [contents, setContents] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const free = data.sizes.find((s) => s.key === size)?.free ?? [];
  const shot = photos.filter((p): p is string => !!p);
  const ready = shot.length > 0 && !!projectId && !!use && !!size && (free.length <= 1 || !!binId) && !!contents && (contents !== "OTHER" || note.trim().length >= 2);
  const mine = data.projects.filter((p) => p.mine), others = data.projects.filter((p) => !p.mine);

  async function go() {
    setBusy(true);
    setErr(null);
    const out = await send(api, { action: "deliver", photoIds: shot, projectId, use, size, binId: free.length > 1 ? binId : free[0]?.id ?? null, contents, contentsNote: note });
    setBusy(false);
    if ("error" in out) return setErr(out.error);
    onDone(out.warning ? `${out.message} ${out.warning}` : out.message);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Bin delivered</h1>
      {photos.map((p, i) => (
        <PhotoPicker key={i} big kind="BIN" uploadUrl={`${api}/bins/photos`} label={i === 0 ? "Photo of the bin on site" : "Second photo"}
          hint={i === 0 ? "The bin where it's been dropped." : undefined} photoId={p}
          onChange={(id) => setPhotos((ps) => ps.map((x, j) => (j === i ? id : x)))} />
      ))}
      {photos.length < 2 && photos[0] && (
        <button className="w-full rounded-xl border border-edge px-4 py-2.5 text-sm text-gray-300" onClick={() => setPhotos((ps) => [...ps, null])}>+ Second photo</button>
      )}
      <label className="block">
        <span className="mb-1 block text-sm text-gray-300">Job</span>
        <select className={input} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Which job?</option>
          {mine.length > 0 ? (
            <>
              <optgroup label="Your jobs today">{mine.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
              <optgroup label="Other jobs">{others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
            </>
          ) : others.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <div>
        <div className="mb-1 text-sm text-gray-300">Whose bin?</div>
        <div className="flex gap-3">
          {data.uses.map((u) => (
            <button key={u.key} className={choice(use === u.key)} onClick={() => setUse(u.key)}>
              {u.label}<span className="text-xs font-normal text-gray-400">{u.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-sm text-gray-300">Size</div>
        <div className="grid grid-cols-3 gap-2">
          {data.sizes.map((s) => <button key={s.key} className={chip(size === s.key)} onClick={() => { setSize(s.key); setBinId(""); }}>{s.label}</button>)}
        </div>
      </div>
      {size && free.length > 1 && (
        <div>
          <div className="mb-1 text-sm text-gray-300">Which bin?</div>
          <div className="grid grid-cols-2 gap-2">{free.map((b) => <button key={b.id} className={chip(binId === b.id)} onClick={() => setBinId(b.id)}>{b.label}</button>)}</div>
        </div>
      )}
      {size && free.length === 1 && <p className="text-sm text-gray-400">Bin: {free[0].label}</p>}
      {size && free.length === 0 && <p className="text-sm text-amber-300">No free one of that size on the list - send it anyway, the office will check.</p>}
      <label className="block">
        <span className="mb-1 block text-sm text-gray-300">What&apos;s going in it?</span>
        <select className={input} value={contents} onChange={(e) => setContents(e.target.value)}>
          <option value="">Pick one</option>
          {data.contents.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
      {contents && (
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">{contents === "OTHER" ? "What is it?" : "Note (optional)"}</span>
          <input className={input} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={contents === "OTHER" ? "e.g. timber, green waste" : ""} />
        </label>
      )}
      {err && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{err}</div>}
      <button className={primary} disabled={!ready || busy} onClick={go}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Send</button>
      <button className="w-full py-2 text-sm text-gray-400" onClick={onBack}>← Delivered or picked up</button>
    </div>
  );
}

function PickUp({ api, data, onDone, onBack }: { api: string; data: BinLinkOptionsDTO; onDone: (m: string) => void; onBack: () => void }) {
  const [movementId, setMovementId] = useState("");
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picked = data.onSite.find((r) => r.id === movementId);
  const shot = photos.filter((p): p is string => !!p);
  // Grouped by job, the person's own jobs first (the order the projects list is in).
  const order = new Map(data.projects.map((p, i) => [p.id, i]));
  const groups = [...new Set(data.onSite.map((r) => r.projectId))]
    .sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999))
    .map((pid) => ({ pid, rows: data.onSite.filter((r) => r.projectId === pid) }));

  async function go() {
    setBusy(true);
    setErr(null);
    const out = await send(api, { action: "pickup", movementId, photoIds: shot });
    setBusy(false);
    if ("error" in out) return setErr(out.error);
    onDone(out.message);
  }

  if (!picked) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-100">Bin picked up</h1>
        <p className="text-sm text-gray-400">Which bin?</p>
        {groups.length === 0 && <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">No bins on site.</p>}
        {groups.map((g) => (
          <div key={g.pid}>
            <div className="mb-2 text-sm font-semibold text-gray-300">{g.rows[0].project}</div>
            <div className="space-y-2">
              {g.rows.map((r) => (
                <button key={r.id} onClick={() => setMovementId(r.id)} className="w-full rounded-2xl border border-edge bg-panel p-4 text-left active:scale-[0.99]">
                  <div className="text-base font-semibold text-gray-100">{r.bin}</div>
                  <div className="text-sm text-gray-400">{r.use} · {r.contents}</div>
                  <div className="text-xs text-gray-500">Delivered {r.delivered} · {r.days}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button className="w-full py-2 text-sm text-gray-400" onClick={onBack}>← Delivered or picked up</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Bin picked up</h1>
      <div className="rounded-2xl border border-edge bg-panel p-4">
        <div className="text-base font-semibold text-gray-100">{picked.bin}</div>
        <div className="text-sm text-gray-400">{picked.project} · {picked.use} · {picked.contents}</div>
        <div className="text-xs text-gray-500">Delivered {picked.delivered} · {picked.days}</div>
      </div>
      {photos.map((p, i) => (
        <PhotoPicker key={i} big kind="BIN" uploadUrl={`${api}/bins/photos`} label={i === 0 ? "Photo of the bin on the truck" : "Second photo"}
          hint={i === 0 ? "Loaded, before you drive off." : undefined} photoId={p}
          onChange={(id) => setPhotos((ps) => ps.map((x, j) => (j === i ? id : x)))} />
      ))}
      {photos.length < 2 && photos[0] && (
        <button className="w-full rounded-xl border border-edge px-4 py-2.5 text-sm text-gray-300" onClick={() => setPhotos((ps) => [...ps, null])}>+ Second photo</button>
      )}
      {err && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{err}</div>}
      <button className={primary} disabled={shot.length === 0 || busy} onClick={go}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Send</button>
      <button className="w-full py-2 text-sm text-gray-400" onClick={() => { setMovementId(""); setPhotos([null]); }}>← Pick another bin</button>
    </div>
  );
}
