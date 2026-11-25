"use client";

// "Variations to price" (Ilies, 25 Nov 2026) - the coordinator's dashboard card: how many signed variation / day
// dockets are still To price, and the latest few, each opening the printable docket. No prices. Nothing shows for a
// login the API refuses.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FilePen } from "lucide-react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import type { OfficeRowDTO } from "@/lib/variations/rules";

export default function VariationsCard() {
  const [s, setS] = useState<{ count: number; latest: OfficeRowDTO[] } | null>(null);
  const load = useCallback(() => {
    fetch("/api/variations?summary=1").then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null));
  }, []);
  useEffect(load, [load]);
  useAutoRefresh(load);
  if (!s) return null;
  return (
    <div className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
      <Link href="/variations?status=TO_PRICE" className="mb-2 flex items-center gap-2 font-semibold text-gray-100 hover:text-white">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400"><FilePen size={18} /></span>
        Variations to price
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${s.count ? "bg-amber-500 text-black" : "bg-panel2 text-gray-400"}`}>{s.count}</span>
      </Link>
      {s.latest.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing waiting - signed dockets from site show here.</p>
      ) : (
        <ul className="space-y-1">
          {s.latest.map((r) => (
            <li key={r.id}>
              <Link href={`/variations/${r.id}`} className="flex items-baseline justify-between gap-2 text-sm hover:underline">
                <span className="min-w-0 truncate text-gray-200"><span className="font-mono text-gray-400">{r.number}</span> {r.project}</span>
                <span className="shrink-0 text-xs text-gray-500">{r.supervisor.split(" ")[0]}</span>
              </Link>
            </li>
          ))}
          {s.count > s.latest.length && <li className="text-xs text-gray-500">+ {s.count - s.latest.length} more</li>}
        </ul>
      )}
    </div>
  );
}
