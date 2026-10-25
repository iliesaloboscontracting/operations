"use client";

// Receipts (26 Oct 2026): tip dockets and fuel receipts photographed from phones, and the odometer
// photos taken after a truck sign-in. Claude reads each one (R2); plain rules put it straight in
// (Read) or on "Check these" for a person to confirm, correct or set aside. Tip rates and costs come
// in R3. Managers and Admins (prices show here, never on a link). Design: docs/receipts/RECEIPTS-DESIGN.md.
import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import ReceiptRow from "@/components/receipts/ReceiptRow";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { ReceiptOfficeDTO } from "@/lib/receipts/store";

type Data = { rows: ReceiptOfficeDTO[]; jobs: { id: string; label: string }[]; trucks: { id: string; label: string }[]; people: string[]; toCheck: number };
const FILTERS = ["day", "kind", "jobId", "vehicleId", "person", "asbestos"] as const;
type Filters = Partial<Record<(typeof FILTERS)[number], string>>;
const select = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200";

export default function ReceiptsPage() {
  const { canEdit, loading } = useAuth();
  const [tab, setTab] = useState<"check" | "all">("check");
  const [f, setF] = useState<Filters>({});
  const [data, setData] = useState<Data | null>(null);
  const [moveTo, setMoveTo] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    if (tab === "check") q.set("check", "1");
    apiFetch(`/api/receipts?${q}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the receipts."))));
  }, [f, tab]);
  useEffect(() => { load(); }, [load]);
  // Jobs a tip docket can be moved to when correcting (the last fortnight's).
  useEffect(() => { apiFetch("/api/receipts?jobs=1").then(async (r) => r.ok && setMoveTo((await r.json()).jobs)); }, []);

  if (loading) return <PageShell title="Receipts"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit) return <PageShell title="Receipts"><p className="text-sm text-gray-500">Managers and Admins only.</p></PageShell>;
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value || undefined }));
  const counts = data ? { tip: data.rows.filter((r) => r.type === "TIP").length, fuel: data.rows.filter((r) => r.type === "FUEL").length, odo: data.rows.filter((r) => r.type === "ODOMETER").length, asb: data.rows.filter((r) => r.asbestos).length } : null;
  const tabBtn = (on: boolean) => `rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide ${on ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"}`;
  const jobsForRow = (r: ReceiptOfficeDTO) => (r.jobId && !moveTo.some((j) => j.id === r.jobId) ? [{ id: r.jobId, label: r.for }, ...moveTo] : moveTo);

  return (
    <PageShell title="Receipts" subtitle="Tip dockets and fuel receipts sent from phones, and odometer photos from truck sign-ins. Each one is read for you; anything unclear waits here for a person.">
      <div className="mb-3 flex gap-1">
        <button className={tabBtn(tab === "check")} onClick={() => setTab("check")}>Check these{data?.toCheck ? ` (${data.toCheck})` : ""}</button>
        <button className={tabBtn(tab === "all")} onClick={() => setTab("all")}>All receipts</button>
      </div>
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
      {counts && tab === "all" && <p className="mb-3 text-xs text-gray-500">{f.day ? "That day" : "Last 30 days"}: {counts.tip} tip dockets ({counts.asb} asbestos) · {counts.fuel} fuel · {counts.odo} odometer</p>}
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p>
        : data.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">
            {tab === "check" ? "Nothing to check - everything sent has been read." : `Nothing sent${Object.values(f).some(Boolean) ? " that matches" : " yet"}.`}
          </p>
        ) : (
          <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
            {data.rows.map((r) => <ReceiptRow key={`${r.type}-${r.id}`} r={r} jobs={jobsForRow(r)} trucks={data.trucks} onChanged={(m) => { setFlash(m); load(); }} />)}
          </ul>
        )}
    </PageShell>
  );
}
