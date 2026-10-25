"use client";

// Receipts (R1 capture, 26 Oct 2026): tip dockets and fuel receipts photographed from phones, and
// the odometer photos taken after a truck sign-in. R1 shows the photos only - reading them, the
// "Check these" list and tip rates come in R2 / R3. Managers and Admins. Design:
// docs/receipts/RECEIPTS-DESIGN.md.
import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { ReceiptOfficeDTO } from "@/lib/receipts/store";

type Data = { rows: ReceiptOfficeDTO[]; jobs: { id: string; label: string }[]; trucks: { id: string; label: string }[]; people: string[] };
const FILTERS = ["day", "kind", "jobId", "vehicleId", "person", "asbestos"] as const;
type Filters = Partial<Record<(typeof FILTERS)[number], string>>;

const STATUS: Record<string, { text: string; tone: string }> = {
  SENT: { text: "Not read yet", tone: "bg-gray-700 text-gray-300" },
  SKIPPED: { text: "No photo (Can't now)", tone: "bg-gray-700 text-gray-400" },
  READ: { text: "Read", tone: "bg-emerald-500/20 text-emerald-300" },
  CHECK: { text: "Check", tone: "bg-amber-500/20 text-amber-300" },
  CONFIRMED: { text: "Confirmed", tone: "bg-emerald-500/20 text-emerald-300" },
  REJECTED: { text: "Rejected", tone: "bg-red-500/20 text-red-300" },
};
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const select = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200";

export default function ReceiptsPage() {
  const { canEdit, loading } = useAuth();
  const [f, setF] = useState<Filters>({});
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiFetch(`/api/receipts?${q}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the receipts."))));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <PageShell title="Receipts"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit) return <PageShell title="Receipts"><p className="text-sm text-gray-500">Managers and Admins only.</p></PageShell>;
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value || undefined }));
  const counts = data ? { tip: data.rows.filter((r) => r.type === "TIP").length, fuel: data.rows.filter((r) => r.type === "FUEL").length, odo: data.rows.filter((r) => r.type === "ODOMETER").length, asb: data.rows.filter((r) => r.asbestos).length } : null;

  return (
    <PageShell title="Receipts" subtitle="Tip dockets and fuel receipts sent from phones, and odometer photos from truck sign-ins. Photos only for now - reading them comes next.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="date" className={select} value={f.day ?? ""} onChange={set("day")} aria-label="Day" />
        <select className={select} value={f.kind ?? ""} onChange={set("kind")} aria-label="Kind">
          <option value="">All kinds</option><option value="TIP">Tip dockets</option><option value="FUEL">Fuel</option><option value="ODOMETER">Odometer</option>
        </select>
        <select className={select} value={f.jobId ?? ""} onChange={set("jobId")} aria-label="Job">
          <option value="">All jobs</option>{data?.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
        </select>
        <select className={select} value={f.vehicleId ?? ""} onChange={set("vehicleId")} aria-label="Truck">
          <option value="">All trucks</option>{data?.trucks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <select className={select} value={f.person ?? ""} onChange={set("person")} aria-label="Person">
          <option value="">Everyone</option>{data?.people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className={select} value={f.asbestos ?? ""} onChange={set("asbestos")} aria-label="Asbestos">
          <option value="">Asbestos: any</option><option value="yes">Asbestos</option><option value="no">Not asbestos</option>
        </select>
        {Object.values(f).some(Boolean) && <button className="text-xs text-brand-300 hover:underline" onClick={() => setF({})}>Clear</button>}
      </div>
      {counts && <p className="mb-3 text-xs text-gray-500">{f.day ? "That day" : "Last 30 days"}: {counts.tip} tip dockets ({counts.asb} asbestos) · {counts.fuel} fuel · {counts.odo} odometer</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p>
        : data.rows.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">Nothing sent{Object.values(f).some(Boolean) ? " that matches" : " yet"}.</p>
        : (
          <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
            {data.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
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
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[r.status]?.tone ?? "bg-gray-700 text-gray-300"}`}>{STATUS[r.status]?.text ?? r.status}</span>
                  </div>
                  <div className="text-gray-300">{r.for}</div>
                  <div className="text-xs text-gray-500">{r.sentBy} · {when(r.sentAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
    </PageShell>
  );
}
