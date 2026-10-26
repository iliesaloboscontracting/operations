"use client";

// Receipts indicators (R4): per job - tip loads, tonnes, tip cost, $/tonne, asbestos loads, a tip
// site the job hadn't used before; per truck - km a day, fuel by day and week, L/100 km against its
// own 8-week average (flagged at more than 25% above), and the tip loads it carried. Office side,
// Manager+. Fuel is per truck only - never a job cost. TruckPanel is also the Vehicles register's.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { JobIndicatorDTO, TruckIndicatorDTO } from "@/lib/receipts/indicatorStore";

const money = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: n >= 1000 ? 0 : 2 }));
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
const th = "px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-gray-500";
const td = "px-3 py-1.5 text-sm tabular-nums";

export default function Indicators() {
  const [data, setData] = useState<{ jobs: JobIndicatorDTO[]; trucks: TruckIndicatorDTO[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch("/api/receipts?indicators=1").then(async (r) => (r.ok ? setData(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load the indicators."))));
  }, []);
  if (!data) return <p className="py-8 text-center text-sm text-gray-500">{error ?? "Loading..."}</p>;
  const trucks = data.trucks.filter((t) => t.lastKm != null || t.fuelByWeek.length || t.tipLoads);
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-1 text-sm font-semibold text-gray-100">Tip loads by job</div>
        <p className="mb-2 text-xs text-gray-500">Read and confirmed dockets. Tip cost is the printed price, or tonnes × the tip rate; $/tonne is over the priced loads.</p>
        {data.jobs.length === 0 ? <p className="text-sm text-gray-500">No tip dockets read yet.</p> : (
          <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
            <table className="w-full min-w-[640px]">
              <thead><tr className="border-b border-edge"><th className={th}>Job</th><th className={th}>Loads</th><th className={th}>Tonnes</th><th className={th}>Tip cost</th><th className={th}>$/t</th><th className={th}>Asbestos</th><th className={th}>Last</th></tr></thead>
              <tbody className="divide-y divide-edge/60">
                {data.jobs.map((j) => (
                  <tr key={j.projectId}>
                    <td className="px-3 py-1.5 text-sm text-gray-200">
                      <Link href={`/tracking/${j.projectId}`} className="hover:underline">{j.projectName}</Link>
                      {j.newSites.length > 0 && <div className="text-[11px] text-sky-300">New tip site: {j.newSites.map((s) => `${s.tipSite} (${day(s.day)})`).join(", ")}</div>}
                    </td>
                    <td className={td}>{j.loads}</td>
                    <td className={td}>{j.tonnes}</td>
                    <td className={td}>{money(j.tipCost)}{j.unpriced > 0 && <span className="ml-1 text-[11px] text-amber-400">+{j.unpriced} unpriced</span>}</td>
                    <td className={td}>{j.perTonne != null ? money(j.perTonne) : "-"}</td>
                    <td className={`${td} ${j.asbestosLoads ? "text-red-300" : "text-gray-500"}`}>{j.asbestosLoads || "-"}</td>
                    <td className={`${td} text-gray-500`}>{j.lastDay ? day(j.lastDay) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <div className="mb-1 text-sm font-semibold text-gray-100">Trucks</div>
        <p className="mb-2 text-xs text-gray-500">From odometer photos at truck sign-in and fuel receipts, last 8 weeks. Fuel is tracked per truck - it&apos;s in the truck&apos;s day rate, not a job cost.</p>
        {trucks.length === 0 ? <p className="text-sm text-gray-500">No odometer readings or fuel receipts read yet.</p> : (
          <div className="grid gap-3 md:grid-cols-2">{trucks.map((t) => <TruckPanel key={t.vehicleId} t={t} titled />)}</div>
        )}
      </section>
    </div>
  );
}

export function TruckPanel({ t, titled }: { t: TruckIndicatorDTO; titled?: boolean }) {
  const week = t.fuelByWeek[0];
  return (
    <div className="rounded-xl border border-edge bg-panel p-3 text-sm">
      {titled && <div className="mb-1 font-semibold text-gray-100">{t.name}</div>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-300">
        <span className="text-gray-500">Odometer</span><span className="tabular-nums">{t.lastKm != null ? `${t.lastKm.toLocaleString("en-AU")} km` : "-"}{t.lastKmAt && <span className="text-[11px] text-gray-500"> · {day(t.lastKmAt)}</span>}</span>
        <span className="text-gray-500">km a day</span><span className="tabular-nums">{t.kmPerDay != null ? t.kmPerDay.toLocaleString("en-AU") : "-"}</span>
        <span className="text-gray-500">L/100 km</span>
        <span className={`tabular-nums ${t.highConsumption ? "font-semibold text-amber-300" : ""}`}>
          {t.latestPer100 != null ? t.latestPer100 : "-"}{t.avgPer100 != null && <span className="text-[11px] text-gray-500"> · 8-wk avg {t.avgPer100}</span>}
        </span>
        <span className="text-gray-500">Fuel this week</span><span className="tabular-nums">{week ? `${week.litres} L · ${money(week.dollars)}` : "-"}</span>
        <span className="text-gray-500">Tip loads (8 wks)</span><span className="tabular-nums">{t.tipLoads ? `${t.tipLoads} · ${t.tipTonnes} t` : "-"}</span>
      </div>
      {t.highConsumption && <p className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-200">Using more than 25% more fuel than its own 8-week average - worth a look (leak, fault, idling, wrong truck on a receipt).</p>}
      {t.fuelByDay.length > 0 && (
        <details className="mt-2 text-xs text-gray-400"><summary>Fuel by day</summary>
          <ul className="mt-1 space-y-0.5">{t.fuelByDay.map((d) => <li key={d.day} className="tabular-nums">{day(d.day)} · {d.litres} L · {money(d.dollars)}</li>)}</ul>
        </details>
      )}
      {t.fuelByWeek.length > 1 && (
        <details className="mt-1 text-xs text-gray-400"><summary>Fuel by week</summary>
          <ul className="mt-1 space-y-0.5">{t.fuelByWeek.map((w) => <li key={w.week} className="tabular-nums">Week of {day(w.week)} · {w.litres} L · {money(w.dollars)}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// The Vehicles register's panel for one truck (Manager+; shows nothing for a Viewer - it has money).
export function TruckIndicatorsPanel({ vehicleId }: { vehicleId: string }) {
  const [t, setT] = useState<TruckIndicatorDTO | null | undefined>(undefined);
  useEffect(() => {
    apiFetch(`/api/receipts?indicators=1&vehicleId=${encodeURIComponent(vehicleId)}`).then(async (r) => setT(r.ok ? ((await r.json()).trucks[0] ?? null) : null));
  }, [vehicleId]);
  if (!t) return null;
  return (
    <div className="mt-4">
      <div className="mb-1 text-sm font-semibold text-gray-100">Odometer and fuel</div>
      <TruckPanel t={t} />
    </div>
  );
}
