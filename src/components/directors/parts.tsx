"use client";

// Directors overview building blocks (Director Insights, 24 Oct 2026). Same
// cards and theme tokens as Project Tracking (components/tracking/parts.tsx);
// these add the director-only bits: priority pills, a confidence badge and
// the "?" that opens a number's KPI-dictionary entry. Status is always a
// word, never colour alone.
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import type { Priority } from "@/lib/insights/kpis";
import { Card } from "@/components/tracking/parts";

export const PRIORITY: Record<Priority, { label: string; cls: string }> = {
  CRITICAL: { label: "Critical", cls: "bg-red-500/15 text-red-400" },
  HIGH: { label: "High", cls: "bg-amber-500/15 text-amber-400" },
  MEDIUM: { label: "Medium", cls: "bg-sky-500/15 text-sky-300" },
  INFO: { label: "Info", cls: "bg-panel2 text-gray-400" },
};

export function PriorityPill({ p }: { p: Priority }) {
  return <span className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY[p].cls}`}>{PRIORITY[p].label}</span>;
}

const CONF = {
  HIGH: { label: "High confidence", cls: "text-emerald-400 ring-emerald-500/30" },
  MEDIUM: { label: "Medium confidence", cls: "text-amber-300 ring-amber-500/30" },
  LOW: { label: "Low confidence", cls: "text-red-300 ring-red-500/30" },
};
export function ConfidenceBadge({ level, why }: { level: keyof typeof CONF; why?: string }) {
  return <span title={why} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${CONF[level].cls}`}>{CONF[level].label}</span>;
}

// "?" -> the number's entry in the KPI dictionary.
export function Help({ id }: { id: string }) {
  return (
    <Link href={`/directors/kpis#${id}`} title="How this is worked out" aria-label="How this is worked out" className="inline-flex text-gray-500 hover:text-gray-300">
      <CircleHelp size={13} />
    </Link>
  );
}

export function Section({ title, kpi, right, children, className = "" }: { title: string; kpi?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-100">{title}{kpi && <Help id={kpi} />}</div>
        {right}
      </div>
      {children}
    </Card>
  );
}

// One figure inside a section: label, big value, a line underneath. A linked
// figure leaves its "?" out (no link inside a link) - its section has one.
export function Figure({ label, value, sub, kpi, tone, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; kpi?: string; tone?: "bad" | "good"; href?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}{kpi && !href && <Help id={kpi} />}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight text-gray-100">{value}</div>
      {sub && <div className={`text-[11px] ${tone === "bad" ? "text-red-400" : tone === "good" ? "text-emerald-400" : "text-gray-500"}`}>{sub}</div>}
    </>
  );
  return href ? <Link href={href} className="block min-w-0 rounded-lg p-1 -m-1 hover:bg-panel2">{body}</Link> : <div className="min-w-0">{body}</div>;
}

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);
