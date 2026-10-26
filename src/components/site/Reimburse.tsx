"use client";

// "Reimbursement" on a supervisor's or driver's link (docs/accounts/REIMBURSE-LINK-DESIGN.md): something the
// worker paid for themselves - photo, what it was for (fuel also: which truck or machine), "I paid this
// myself". Accounts get it as a claim once it's read. The phone only ever sees words and dates - "Sent",
// "With accounts", "Paid on ..." - never an amount.
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import PhotoPicker from "@/components/tools/PhotoPicker";
import { serverErrorMessage } from "@/lib/apiFetch";
import { PURPOSES, PURPOSE_LABEL, type Purpose } from "@/lib/receipts/rules";
import type { ReimburseLinkDTO } from "@/lib/receipts/store";

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2.5 text-base text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-50";
const choice = (on: boolean) => `rounded-2xl border px-3 py-4 text-base font-semibold ${on ? "border-brand-500 bg-brand-600/30 text-brand-100" : "border-edge bg-panel text-gray-200"}`;

type Data = { assets: { id: string; label: string; group: "TRUCK" | "PLANT" }[]; prefillVehicleId: string | null; mine: ReimburseLinkDTO[] };

export function AssetOptions({ assets }: { assets: Data["assets"] }) {
  const trucks = assets.filter((a) => a.group === "TRUCK"), plant = assets.filter((a) => a.group === "PLANT");
  return (
    <>
      {trucks.length > 0 && <optgroup label="Trucks & vehicles">{trucks.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>}
      {plant.length > 0 && <optgroup label="Plant">{plant.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>}
    </>
  );
}

export default function Reimburse({ api, onDone }: { api: string; onDone: (message: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([null]);
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [vehicleId, setVehicleId] = useState("");
  const [note, setNote] = useState("");
  const [paidMyself, setPaidMyself] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${api}/reimbursements`).catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load.") : "Couldn't load - check your signal.");
    setError(null);
    const d: Data = await res.json();
    setData(d);
    setVehicleId((v) => v || d.prefillVehicleId || "");
  }, [api]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-red-300">{error}</p>;
  if (!data) return <div className="py-16 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>;

  const shot = photos.filter((p): p is string => !!p);
  const ready = shot.length > 0 && !!purpose && (purpose !== "FUEL" || !!vehicleId) && (purpose !== "OTHER" || note.trim().length >= 3) && paidMyself;
  async function send() {
    setBusy(true); setSendError(null);
    const res = await fetch(`${api}/reimbursements`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, note, vehicleId: purpose === "FUEL" ? vehicleId : undefined, photoIds: shot, paidMyself }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setSendError(res ? await serverErrorMessage(res, "Couldn't send - try again.") : "Couldn't send - check your signal and try again.");
    onDone((await res.json()).message);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-100">Reimbursement</h1>
      <p className="text-sm text-gray-400">Paid for something for work with your own money? Send the receipt and accounts pay you back. Tip dockets and company fuel go in &ldquo;Add receipt&rdquo; instead.</p>
      {photos.map((p, i) => (
        <PhotoPicker key={i} big kind="RECEIPT" uploadUrl={`${api}/receipts/photos`} label={i === 0 ? "Photo of the receipt" : "Second photo (long receipt)"}
          hint={i === 0 ? "Flat, in focus, the whole receipt in the frame." : undefined} photoId={p}
          onChange={(id) => setPhotos((ps) => ps.map((x, j) => (j === i ? id : x)))} />
      ))}
      {photos.length < 2 && photos[0] && (
        <button className="w-full rounded-xl border border-edge px-4 py-2.5 text-sm text-gray-300" onClick={() => setPhotos((ps) => [...ps, null])}>+ Second photo (long receipt)</button>
      )}
      <div>
        <div className="mb-1 text-sm text-gray-300">What was it for?</div>
        <div className="grid grid-cols-2 gap-2">
          {PURPOSES.map((p) => <button key={p} className={choice(purpose === p)} onClick={() => setPurpose(p)}>{PURPOSE_LABEL[p]}</button>)}
        </div>
      </div>
      {purpose === "FUEL" && (
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">Which truck or machine?</span>
          <select className={input} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Pick one</option>
            <AssetOptions assets={data.assets} />
          </select>
        </label>
      )}
      {purpose && (
        <label className="block">
          <span className="mb-1 block text-sm text-gray-300">{purpose === "OTHER" ? "What was it?" : "Note (optional)"}</span>
          <input className={input} maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} placeholder={purpose === "TOOLS" ? "e.g. drill bits for Myer" : purpose === "PARKING_TOLLS" ? "e.g. parking at Bronte" : "A few words"} />
        </label>
      )}
      <label className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-3 text-base text-gray-200">
        <input type="checkbox" className="h-5 w-5" checked={paidMyself} onChange={(e) => setPaidMyself(e.target.checked)} />
        I paid this myself
      </label>
      {sendError && <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{sendError}</div>}
      <button className={primary} disabled={!ready || busy} onClick={send}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Send to accounts
      </button>

      <section className="pt-2">
        <h2 className="mb-2 text-base font-semibold text-gray-100">My reimbursements</h2>
        {data.mine.length === 0 ? <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">Nothing in the last 60 days.</p> : (
          <ul className="space-y-2">
            {data.mine.map((r) => (
              <li key={r.id} className="rounded-2xl border border-edge bg-panel p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-semibold text-gray-100">{r.purpose}{r.for ? <span className="font-normal text-gray-400"> · {r.for}</span> : null}</span>
                  <span className="text-sm text-gray-500">{r.sentOn}</span>
                </div>
                <div className={`mt-1 text-sm ${r.status.startsWith("Paid") ? "text-emerald-300" : r.status.startsWith("Not going") ? "text-amber-300" : "text-gray-400"}`}>{r.status}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
