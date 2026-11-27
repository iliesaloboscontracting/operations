"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { TipperLinkOptionsDTO, TipperLinkRowDTO } from "@/lib/bins/tipperRules";

// A tipper load on a driver's link (Ilies, 27 Nov 2026: "this allows the drivers to log waste collected in the tippers
// also"): photo of the load -> which tipper (prefilled from today's truck sign-in) -> job -> client's load / our load ->
// what's in it -> optional note. One event - loaded at the job, off to the tip. Words and dates only - never a price.

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";
const choice = (on: boolean) => `flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-4 text-lg font-semibold ${on ? "border-brand-500 bg-brand-600/30 text-brand-100" : "border-edge bg-panel text-gray-200"}`;
const chip = (on: boolean) => `rounded-xl border px-3 py-3 text-base font-semibold ${on ? "border-brand-500 bg-brand-600/30 text-brand-100" : "border-edge bg-panel text-gray-200"}`;

export function TipperRow({ r }: { r: TipperLinkRowDTO }) {
  return (
    <li className="rounded-2xl border border-edge bg-panel p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-gray-100">{r.tipper}</span>
        <span className="text-sm text-gray-500">{r.status}</span>
      </div>
      <div className="text-sm text-gray-400">{r.project} · {r.use} · {r.contents}</div>
      <div className="text-xs text-gray-500">Loaded {r.at}</div>
    </li>
  );
}

export default function TipperLoad({ api, onDone, onBack }: { api: string; onDone: (message: string) => void; onBack: () => void }) {
  const [data, setData] = useState<TipperLinkOptionsDTO | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [vehicleId, setVehicleId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [use, setUse] = useState("");
  const [contents, setContents] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${api}/tipper-loads`).catch(() => null);
      if (!res?.ok) return setLoadErr(res ? await serverErrorMessage(res, "Couldn't load.") : "Couldn't load - check your signal.");
      const o: TipperLinkOptionsDTO = (await res.json()).options;
      setData(o);
      setVehicleId(o.prefill ?? (o.tippers.length === 1 ? o.tippers[0].id : ""));
      const mine = o.projects.filter((p) => p.mine);
      if (mine.length === 1) setProjectId(mine[0].id);
    })();
  }, [api]);

  if (loadErr) return <div className="space-y-3"><p className="rounded-xl border border-edge bg-panel p-4 text-sm text-red-300">{loadErr}</p><button className="w-full py-2 text-sm text-gray-400" onClick={onBack}>← Bins</button></div>;
  if (!data) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;
  const shot = photos.filter((p): p is string => !!p);
  const ready = shot.length > 0 && !!vehicleId && !!projectId && !!use && !!contents && (contents !== "OTHER" || note.trim().length >= 2);
  const mine = data.projects.filter((p) => p.mine), others = data.projects.filter((p) => !p.mine);

  async function go() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`${api}/tipper-loads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoIds: shot, vehicleId, projectId, use, contents, contentsNote: note }) }).catch(() => null);
    setBusy(false);
    if (!res) return setErr("Couldn't send - check your signal and try again.");
    if (!res.ok) return setErr(await serverErrorMessage(res, "Couldn't send - try again."));
    onDone((await res.json()).message);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Tipper load</h1>
      <p className="text-sm text-gray-400">Waste loaded into our tipper at a job, before you go to the tip.</p>
      {photos.map((p, i) => (
        <PhotoPicker key={i} big kind="BIN" uploadUrl={`${api}/tipper-loads/photos`} label={i === 0 ? "Photo of the load" : "Second photo"}
          hint={i === 0 ? "The load in the tipper, before you drive off." : undefined} photoId={p}
          onChange={(id) => setPhotos((ps) => ps.map((x, j) => (j === i ? id : x)))} />
      ))}
      {photos.length < 2 && photos[0] && (
        <button className="w-full rounded-xl border border-edge px-4 py-2.5 text-sm text-gray-300" onClick={() => setPhotos((ps) => [...ps, null])}>+ Second photo</button>
      )}
      <div>
        <div className="mb-1 text-sm text-gray-300">Which tipper?</div>
        {data.tippers.length === 0 ? (
          <p className="rounded-xl border border-edge bg-panel p-3 text-sm text-amber-300">No tippers on the list - call the office.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {data.tippers.map((t) => <button key={t.id} className={chip(vehicleId === t.id)} onClick={() => setVehicleId(t.id)}>{t.label}</button>)}
          </div>
        )}
        {data.prefill && vehicleId === data.prefill && <p className="mt-1 text-xs text-gray-500">From your truck sign-in today.</p>}
      </div>
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
        <div className="mb-1 text-sm text-gray-300">Whose load?</div>
        <div className="flex gap-3">
          {data.uses.map((u) => (
            <button key={u.key} className={choice(use === u.key)} onClick={() => setUse(u.key)}>
              {u.label}<span className="text-xs font-normal text-gray-400">{u.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-300">What&apos;s in it?</span>
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
      {data.today.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-gray-300">Your loads today</div>
          <ul className="space-y-2">{data.today.map((r) => <TipperRow key={r.id} r={r} />)}</ul>
        </div>
      )}
      <button className="w-full py-2 text-sm text-gray-400" onClick={onBack}>← Bins</button>
    </div>
  );
}
