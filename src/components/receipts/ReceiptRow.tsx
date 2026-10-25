"use client";

// One receipt / odometer photo on /receipts (Receipts R2): the photo(s), what Claude read, why it needs
// checking, and the office's actions - correct any field, confirm, set aside (with a reason), read
// again. Office-side only (Manager+): prices show here, never on a link.
import { useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { ReceiptOfficeDTO } from "@/lib/receipts/store";

const STATUS: Record<string, { text: string; tone: string }> = {
  SENT: { text: "Not read yet", tone: "bg-gray-700 text-gray-300" },
  SKIPPED: { text: "No photo (Can't now)", tone: "bg-gray-700 text-gray-400" },
  READ: { text: "Read", tone: "bg-emerald-500/20 text-emerald-300" },
  CHECK: { text: "To check", tone: "bg-amber-500/20 text-amber-300" },
  CONFIRMED: { text: "Confirmed", tone: "bg-emerald-500/20 text-emerald-300" },
  REJECTED: { text: "Set aside", tone: "bg-red-500/20 text-red-300" },
};
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const money = (n: number | null | undefined) => (n == null ? null : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" }));
const dateText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : null);
// "2026-10-26T07:42" in Sydney time, for the date field when correcting.
const localInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};

type Field = { key: string; label: string; kind: "text" | "number" | "datetime" };
const FIELDS: Record<ReceiptOfficeDTO["type"], Field[]> = {
  TIP: [
    { key: "docketNo", label: "Docket no", kind: "text" }, { key: "docketAt", label: "Date", kind: "datetime" }, { key: "tipSite", label: "Tip site", kind: "text" },
    { key: "wasteType", label: "Waste type", kind: "text" }, { key: "tonnes", label: "Tonnes (net)", kind: "number" }, { key: "rego", label: "Rego", kind: "text" },
    { key: "priceExGst", label: "Price ex GST", kind: "number" }, { key: "priceIncGst", label: "Price inc GST", kind: "number" },
  ],
  FUEL: [
    { key: "litres", label: "Litres", kind: "number" }, { key: "pricePerLitre", label: "$ per litre", kind: "number" }, { key: "fuelTotal", label: "Total", kind: "number" },
    { key: "station", label: "Station", kind: "text" }, { key: "docketAt", label: "Date", kind: "datetime" }, { key: "rego", label: "Rego", kind: "text" },
  ],
  ODOMETER: [{ key: "km", label: "Odometer (km)", kind: "number" }],
};
const input = "w-full rounded-md border border-edge bg-panel2 px-2 py-1 text-xs text-gray-200";
const btn = "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

function summary(r: ReceiptOfficeDTO): string[] {
  const x = r.read;
  if (r.type === "TIP") {
    return [x.docketNo && `#${x.docketNo}`, dateText(x.docketAt), x.tipSite, x.wasteType, x.tonnes != null && `${x.tonnes} t`, x.rego,
      x.priceExGst != null ? `${money(x.priceExGst)} ex GST` : x.priceIncGst != null ? `${money(x.priceIncGst)} inc GST` : null].filter(Boolean) as string[];
  }
  if (r.type === "FUEL") {
    return [x.litres != null && `${x.litres} L`, x.pricePerLitre != null && `${money(x.pricePerLitre)}/L`, money(x.fuelTotal), x.station, dateText(x.docketAt), x.rego].filter(Boolean) as string[];
  }
  return x.km != null ? [`${x.km.toLocaleString("en-AU")} km`] : [];
}

export default function ReceiptRow({ r, jobs, trucks, onChanged }: { r: ReceiptOfficeDTO; jobs: { id: string; label: string }[]; trucks: { id: string; label: string }[]; onChanged: (msg: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = STATUS[r.status] ?? { text: r.status, tone: "bg-gray-700 text-gray-300" };
  const read = summary(r);

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/receipts/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...(r.type === "ODOMETER" ? { type: "ODOMETER" } : {}) }) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save."));
    setEditing(false);
    onChanged(done);
  }
  function startEdit() {
    const f: Record<string, string> = {};
    for (const fl of FIELDS[r.type]) {
      const v = (r.read as Record<string, unknown>)[fl.key];
      f[fl.key] = fl.kind === "datetime" ? localInput(v as string | null) : v == null ? "" : String(v);
    }
    if (r.type === "TIP") { f.jobId = r.jobId ?? ""; f.asbestos = r.asbestos ? "yes" : "no"; }
    if (r.type === "FUEL") f.vehicleId = r.vehicleId ?? "";
    setForm(f);
    setEditing(true);
  }
  function saveEdit(confirm: boolean) {
    const fields: Record<string, unknown> = {};
    for (const fl of FIELDS[r.type]) fields[fl.key] = form[fl.key];
    if (r.type === "TIP") { if (form.jobId) fields.jobId = form.jobId; fields.asbestos = form.asbestos === "yes"; }
    if (r.type === "FUEL" && form.vehicleId) fields.vehicleId = form.vehicleId;
    act({ op: "CORRECT", fields, confirm }, confirm ? "Corrected and confirmed." : "Corrected.");
  }
  const canDecide = r.status === "READ" || r.status === "CHECK";
  const canCorrect = r.status === "READ" || r.status === "CHECK" || r.status === "CONFIRMED" || r.unreadable;

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="flex gap-2">
        {r.photoIds.length ? r.photoIds.map((p) => (
          <a key={p} href={`/api/receipts/photos/${p}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/receipts/photos/${p}`} alt={r.label} className="h-20 w-20 rounded-md border border-edge object-cover" />
          </a>
        )) : <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-edge text-[11px] text-gray-500">No photo</div>}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-100">{r.label}</span>
          {r.asbestos && <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-300">Asbestos</span>}
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${s.tone}`}>{r.unreadable ? "Couldn't be read" : s.text}</span>
          {r.onInvoice && <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] text-sky-300">On a tip invoice</span>}
        </div>
        <div className="text-gray-300">{r.for}</div>
        {read.length > 0 && <div className="text-gray-200">{read.join(" · ")}</div>}
        {r.reasons.length > 0 && r.status !== "CONFIRMED" && r.status !== "REJECTED" && (
          <div className="mt-1 text-xs text-amber-300">
            {r.corrections.length > 0 && <div className="text-gray-500">When it was read (before the corrections):</div>}
            <ul className="list-disc pl-4">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {r.rejected && <div className="mt-1 text-xs text-red-300">Set aside by {r.rejected.by}: {r.rejected.reason}</div>}
        <div className="text-xs text-gray-500">
          {r.sentBy} · {when(r.sentAt)}
          {r.corrections.length > 0 && ` · corrected by ${[...new Set(r.corrections.map((c) => c.by))].join(", ")} (${r.corrections.length} change${r.corrections.length === 1 ? "" : "s"})`}
        </div>

        {editing ? (
          <div className="mt-2 grid gap-2 rounded-lg border border-edge bg-panel2/40 p-2 sm:grid-cols-2">
            {r.type === "TIP" && (
              <label className="sm:col-span-2 text-xs text-gray-400">Job
                <select className={input} value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })}>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                </select>
              </label>
            )}
            {r.type === "FUEL" && (
              <label className="sm:col-span-2 text-xs text-gray-400">Truck
                <select className={input} value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                  {trucks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
            )}
            {FIELDS[r.type].map((fl) => (
              <label key={fl.key} className="text-xs text-gray-400">{fl.label}
                <input className={input} type={fl.kind === "datetime" ? "datetime-local" : "text"} inputMode={fl.kind === "number" ? "decimal" : undefined}
                  value={form[fl.key] ?? ""} onChange={(e) => setForm({ ...form, [fl.key]: e.target.value })} />
              </label>
            ))}
            {r.type === "TIP" && (
              <label className="text-xs text-gray-400">Asbestos
                <select className={input} value={form.asbestos} onChange={(e) => setForm({ ...form, asbestos: e.target.value })}>
                  <option value="no">No</option><option value="yes">Yes</option>
                </select>
              </label>
            )}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className={btn} disabled={busy} onClick={() => saveEdit(true)}>Save and confirm</button>
              <button className={quiet} disabled={busy} onClick={() => saveEdit(false)}>Save</button>
              <button className={quiet} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {canDecide && <button className={btn} disabled={busy} onClick={() => act({ op: "CONFIRM" }, "Confirmed.")}>Confirm</button>}
            {canCorrect && <button className={quiet} disabled={busy} onClick={startEdit}>Correct</button>}
            {(r.status === "SENT" || r.status === "CHECK" || r.status === "READ") && r.corrections.length === 0 && (
              <button className={quiet} disabled={busy} onClick={() => act({ op: "READ_AGAIN" }, "Read again.")}>Read again</button>
            )}
            {r.status !== "REJECTED" && r.status !== "SKIPPED" && (
              <button className={quiet} disabled={busy} onClick={() => { const reason = prompt("Why is it being set aside? (e.g. duplicate photo, not ours)"); if (reason) act({ op: "REJECT", reason }, "Set aside."); }}>Set aside</button>
            )}
          </div>
        )}
        {error && <div className="mt-1 text-xs text-red-400">{error}</div>}
      </div>
    </li>
  );
}
