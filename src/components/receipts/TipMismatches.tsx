"use client";

// Tip dockets vs tip invoices on /receipts (Receipts R3), both ways: dockets sent from site that are
// on no tip invoice 35 days after their date, and tip invoices that bill no docket from site. Each is
// also a finding (Operations side). Fixing it: add the missing invoice (or its docket numbers) on the
// job's Tracking page, correct the docket's job, or set the docket aside.
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { TipMismatches as Data } from "@/lib/receipts/tipStore";

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

export default function TipMismatches() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch("/api/receipts?mismatches=1").then(async (r) => (r.ok ? setData(await r.json()) : setError(await serverErrorMessage(r, "Couldn't load."))));
  }, []);
  if (!data) return <p className="py-8 text-center text-sm text-gray-500">{error ?? "Loading..."}</p>;
  return (
    <div className="space-y-4">
      <section>
        <div className="mb-1 text-sm font-semibold text-gray-100">Dockets on no tip invoice after 35 days <span className="font-normal text-gray-500">· {data.uninvoiced.length}</span></div>
        <p className="mb-2 text-xs text-gray-500">Still counted as an estimate on the job. Check the tip invoice wasn&apos;t lost or put on another job.</p>
        {data.uninvoiced.length === 0 ? <p className="text-sm text-emerald-400">None.</p> : (
          <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
            {data.uninvoiced.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm">
                <span className="w-14 text-xs text-gray-500">{day(d.day)}</span>
                <span className="min-w-0 flex-1 text-gray-200">{d.tipSite ?? "Tip"}{d.docketNo && <span className="text-gray-500"> #{d.docketNo}</span>}{d.tonnes != null && <span className="text-gray-500"> · {d.tonnes} t</span>}</span>
                <Link href={`/tracking/${d.projectId}`} className="text-xs text-brand-300 hover:underline">{d.projectName}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="mb-1 text-sm font-semibold text-gray-100">Tip invoices with no docket from site <span className="font-normal text-gray-500">· {data.invoicesWithoutDockets.length}</span></div>
        <p className="mb-2 text-xs text-gray-500">A load nobody photographed, the wrong job, or the docket numbers aren&apos;t on the invoice in Operations yet.</p>
        {data.invoicesWithoutDockets.length === 0 ? <p className="text-sm text-emerald-400">None.</p> : (
          <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
            {data.invoicesWithoutDockets.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm">
                <span className="w-14 text-xs text-gray-500">{day(i.weekEnding)}</span>
                <span className="min-w-0 flex-1 text-gray-200">{i.vendor}{i.invoiceNo && <span className="text-gray-500"> #{i.invoiceNo}</span>}</span>
                <span className="tabular-nums text-gray-100">{money(i.amountExGst)}</span>
                <Link href={`/tracking/${i.projectId}`} className="text-xs text-brand-300 hover:underline">{i.projectName}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
