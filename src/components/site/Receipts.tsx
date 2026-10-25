"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Fuel, Loader2, Truck } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { ReceiptKind, ReceiptLinkDTO } from "@/lib/receipts/rules";
import type { ReceiptOptionsDTO } from "@/lib/receipts/store";

// Receipts on a supervisor's or driver's link (R1, 26 Oct 2026): whoever has the tip docket or fuel
// receipt photographs it when it happens. Tip docket -> photo -> job (prefilled) -> Asbestos yes/no;
// Fuel -> photo -> truck (prefilled). The office reads it; the phone only ever sees the read status,
// never a price.

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";
const choice = (on: boolean) => `flex flex-1 items-center justify-center gap-2 rounded-2xl border px-3 py-5 text-lg font-semibold ${on ? "border-brand-500 bg-brand-600/30 text-brand-100" : "border-edge bg-panel text-gray-200"}`;

type Data = { options: ReceiptOptionsDTO; today: ReceiptLinkDTO[] };

function useReceipts(api: string) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`${api}/receipts`).catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load.") : "Couldn't load - check your signal.");
    setError(null);
    setData(await res.json());
  }, [api]);
  useEffect(() => { load(); }, [load]);
  return { data, error };
}

export function AddReceipt({ api, onDone }: { api: string; onDone: (message: string) => void }) {
  const { data, error } = useReceipts(api);
  const [kind, setKind] = useState<ReceiptKind | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [jobId, setJobId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [asbestos, setAsbestos] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setJobId((j) => j || data.options.prefill.jobId || "");
    setVehicleId((v) => v || data.options.prefill.vehicleId || "");
  }, [data]);

  if (error) return <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-red-300">{error}</p>;
  if (!data) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;

  if (!kind) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-gray-100">Add a receipt</h1>
        <p className="text-sm text-gray-400">Take a photo when it happens - it&apos;s read for you.</p>
        <div className="flex gap-3">
          <button className={choice(false)} onClick={() => setKind("TIP")}><Truck size={22} /> Tip docket</button>
          <button className={choice(false)} onClick={() => setKind("FUEL")}><Fuel size={22} /> Fuel</button>
        </div>
      </div>
    );
  }

  const shot = photos.filter((p): p is string => !!p);
  const ready = shot.length > 0 && (kind === "TIP" ? !!jobId && asbestos !== null : !!vehicleId);
  async function send() {
    setBusy(true);
    setSendError(null);
    const res = await fetch(`${api}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, photoIds: shot, ...(kind === "TIP" ? { jobId, asbestos } : { vehicleId }) }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setSendError(res ? await serverErrorMessage(res, "Couldn't send - try again.") : "Couldn't send - check your signal and try again.");
    onDone((await res.json()).message);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">{kind === "TIP" ? "Tip docket" : "Fuel receipt"}</h1>
      {photos.map((p, i) => (
        <PhotoPicker key={i} big kind="RECEIPT" uploadUrl={`${api}/receipts/photos`} label={i === 0 ? "Photo" : "Second photo (long docket)"}
          hint={i === 0 ? "Flat, in focus, the whole docket in the frame." : undefined} photoId={p}
          onChange={(id) => setPhotos((ps) => ps.map((x, j) => (j === i ? id : x)))} />
      ))}
      {kind === "TIP" && photos.length < 2 && photos[0] && (
        <button className="w-full rounded-xl border border-edge px-4 py-2.5 text-sm text-gray-300" onClick={() => setPhotos((ps) => [...ps, null])}>+ Second photo (long docket)</button>
      )}
      {kind === "TIP" ? (
        <>
          <label className="block">
            <span className="mb-1 block text-sm text-gray-300">Job</span>
            <select className={input} value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Which job?</option>
              {data.options.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}{j.mine ? " (yours today)" : ""}</option>)}
            </select>
          </label>
          {data.options.jobs.length === 0 && <p className="text-sm text-amber-300">No jobs are running today - call the office.</p>}
          <div>
            <div className="mb-1 text-sm text-gray-300">Asbestos?</div>
            <div className="flex gap-3">
              <button className={choice(asbestos === true)} onClick={() => setAsbestos(true)}>Yes</button>
              <button className={choice(asbestos === false)} onClick={() => setAsbestos(false)}>No</button>
            </div>
          </div>
        </>
      ) : (
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Truck</span>
          <select className={input} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Which truck?</option>
            {data.options.trucks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      )}
      {sendError && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{sendError}</div>}
      <button className={primary} disabled={!ready || busy} onClick={send}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Send
      </button>
      <button className="w-full py-2 text-sm text-gray-400" onClick={() => { setKind(null); setPhotos([null]); setAsbestos(null); }}>← Tip docket or fuel</button>
    </div>
  );
}

export function MyReceipts({ api }: { api: string }) {
  const { data, error } = useReceipts(api);
  if (error) return <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-red-300">{error}</p>;
  if (!data) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-100">My receipts</h1>
      <p className="mb-4 text-sm text-gray-500">What you sent today.</p>
      {data.today.length === 0 ? (
        <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">Nothing sent today.</p>
      ) : (
        <ul className="space-y-2">
          {data.today.map((r) => (
            <li key={r.id} className="rounded-2xl border border-edge bg-panel p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base font-semibold text-gray-100">{r.label}</span>
                <span className="text-sm text-gray-500">{r.at}</span>
              </div>
              <div className="text-sm text-gray-400">{r.for}{r.asbestos ? " · asbestos" : ""} · {r.photos} photo{r.photos === 1 ? "" : "s"}</div>
              <div className="mt-1 text-sm text-gray-500">{r.status}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
