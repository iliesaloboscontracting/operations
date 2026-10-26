"use client";

// The standard Lobos ABN invoice (Accounts stage 4): a printable sheet of a person's supervisor-approved hours
// for a period. Hours only - the worker fills in their ABN, invoice number, rate, GST and total.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

type T = { name: string; from: string; to: string; days: { date: string; site: string; hours: number }[]; total: number };
const longDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function Sheet() {
  const q = useSearchParams();
  const [t, setT] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qs = `person=${q.get("person") ?? ""}&from=${q.get("from") ?? ""}&to=${q.get("to") ?? ""}`;
  useEffect(() => {
    fetch(`/api/accounts/abn-template?${qs}`).then(async (r) => (r.ok ? setT(await r.json()) : setError((await r.json().catch(() => ({}))).error ?? "Couldn't load.")));
  }, [qs]);
  if (error) return <p className="p-6 text-sm text-red-700">{error}</p>;
  if (!t) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  const blank = "border-b border-gray-400 inline-block w-56 h-5 align-bottom";
  return (
    <div className="mx-auto max-w-2xl bg-white p-8 text-sm text-gray-900 print:p-0">
      <style>{"@media print { nav, header { display: none !important; } body { background: white !important; } }"}</style>
      <div className="mb-4 flex items-start justify-between">
        <div><div className="text-lg font-bold">Tax invoice</div><div className="text-gray-600">Hours worked for Lobos Contracting Pty Ltd</div></div>
        <div className="print:hidden"><button className="rounded border border-gray-400 px-3 py-1" onClick={() => window.print()}>Print / save as PDF</button> <a className="ml-2 text-blue-700 underline" href={`/api/accounts/abn-template?${qs}&format=csv`}>CSV</a></div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-y-2">
        <div>From: <b>{t.name}</b></div><div>ABN: <span className={blank} /></div>
        <div>Period: {longDate(t.from)} to {longDate(t.to)}</div><div>Invoice no.: <span className={blank} /></div>
        <div>To: Lobos Contracting Pty Ltd</div><div>Invoice date: <span className={blank} /></div>
      </div>
      <table className="mb-4 w-full border-collapse">
        <thead><tr className="border-b-2 border-gray-800 text-left"><th className="py-1">Date</th><th>Site</th><th className="text-right">Hours</th></tr></thead>
        <tbody>
          {t.days.map((d) => <tr key={d.date} className="border-b border-gray-200"><td className="py-1">{longDate(d.date)}</td><td>{d.site}</td><td className="text-right tabular-nums">{d.hours}</td></tr>)}
          {t.days.length === 0 && <tr><td colSpan={3} className="py-3 text-gray-500">No supervisor-approved hours in this period.</td></tr>}
          <tr className="font-bold"><td className="py-1">Total hours</td><td /><td className="text-right tabular-nums">{t.total}</td></tr>
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-y-2">
        <div>Rate (per hour): <span className={blank} /></div><div>Amount: <span className={blank} /></div>
        <div>GST (if registered): <span className={blank} /></div><div>Total: <span className={blank} /></div>
      </div>
      <p className="mt-6 text-xs text-gray-500">Hours are those approved by the site supervisor in Lobos Operations. If they don&apos;t match your records, tell accounts before invoicing.</p>
    </div>
  );
}

export default function AbnTemplatePage() {
  return <Suspense fallback={null}><Sheet /></Suspense>;
}
