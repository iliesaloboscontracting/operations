"use client";

// Company health band (G1, 25 Oct 2026): the six tiles across the top of the
// Directors overview. Each says a status word (never colour alone), its
// source, "as at" and how sure it is; a source that isn't connected says so
// and shows no number. Figures come from lib/insights/health.ts.
import Link from "next/link";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, PlugZap } from "lucide-react";
import type { HealthStatus, HealthTile } from "@/lib/insights/health";
import { ConfidenceBadge, Help } from "@/components/directors/parts";

const STATUS: Record<HealthStatus, { cls: string; Icon: typeof Info }> = {
  ACT: { cls: "bg-red-500/15 text-red-400 ring-red-500/30", Icon: AlertOctagon },
  WATCH: { cls: "bg-amber-500/15 text-amber-400 ring-amber-500/30", Icon: AlertTriangle },
  OK: { cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30", Icon: CheckCircle2 },
  INFO: { cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30", Icon: Info },
  NOT_CONNECTED: { cls: "bg-transparent text-gray-500 ring-edge", Icon: PlugZap },
};

const time = (iso: string) => new Date(iso).toLocaleString("en-AU", { hour: "numeric", minute: "2-digit" });

export default function HealthBand({ tiles }: { tiles: HealthTile[] }) {
  return (
    <section aria-label="Company health" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {tiles.map((t) => <Tile key={t.id} t={t} />)}
    </section>
  );
}

function Tile({ t }: { t: HealthTile }) {
  const s = STATUS[t.status];
  const off = t.status === "NOT_CONNECTED";
  return (
    <div className={`flex min-w-0 flex-col rounded-2xl border p-4 ${off ? "border-dashed border-edge bg-transparent" : "border-edge bg-panel"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {t.href ? <Link href={t.href} className="hover:text-gray-300 hover:underline">{t.title}</Link> : t.title}{t.kpi && <Help id={t.kpi} />}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.cls}`}>
          <s.Icon size={12} aria-hidden /> {t.statusWord}
        </span>
      </div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${off ? "text-gray-600" : "text-gray-100"}`}>{t.headline ?? "—"}</div>
      {t.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[12px] text-gray-400">
          {t.lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
      {off && t.missing && <p className="mt-1 text-[12px] text-gray-500">Needs: {t.missing}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-[10px] text-gray-500">
        <span>{t.source}{t.asAt ? ` · as at ${time(t.asAt)}` : ""}</span>
        {t.confidence && <ConfidenceBadge level={t.confidence} why={t.confidenceWhy} />}
      </div>
    </div>
  );
}
