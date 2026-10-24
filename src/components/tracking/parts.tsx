"use client";

// Project Tracking building blocks (redesign, 24 Oct 2026). Chart choices
// follow the research report (reports/Job cost tracking page design.md):
// length on a shared scale (bars, a bullet bar against the contract value),
// solid = locked or invoiced, lighter = still an estimate, striped = still to
// come; status always as icon + word, never colour alone; red only for Act.
// Uses the app's theme tokens (panel / edge / gray scale), so it reads in
// both the dark and light themes.
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp, MinusCircle } from "lucide-react";
import type { JobHealth } from "@/lib/types";

export const BLUE = "#3987e5"; // confirmed: locked or invoiced
export const BLUE_LIGHT = "#9ec5f4"; // estimate: open days, hire still out

// Hover labels for the charts: short money + a plain name per series.
export const tooltipStyle = { background: "#20242A", border: "1px solid #2A2F36", borderRadius: 10, fontSize: 12 };
export function moneyTip(names: Record<string, string>) {
  return (v: unknown, k: unknown): [string, string] => {
    const n = Number(v ?? 0);
    const a = Math.abs(n);
    const s = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${Math.round(a)}`;
    return [`${n < 0 ? "-" : ""}${s}`, names[String(k)] ?? String(k)];
  };
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-edge bg-panel p-4 ${className}`}>{children}</div>;
}

export function Tile({ label, value, sub, subTone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; subTone?: "bad" | "good" }) {
  return (
    <Card className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-gray-100">{value}</div>
      {sub && <div className={`mt-0.5 text-[11px] ${subTone === "bad" ? "text-red-400" : subTone === "good" ? "text-emerald-400" : "text-gray-500"}`}>{sub}</div>}
    </Card>
  );
}

export const HEALTH: Record<JobHealth, { label: string; cls: string; Icon: typeof CheckCircle2; rank: number }> = {
  ACT: { label: "Act", cls: "bg-red-500/15 text-red-400 ring-red-500/30", Icon: AlertOctagon, rank: 0 },
  WATCH: { label: "Watch", cls: "bg-amber-500/15 text-amber-400 ring-amber-500/30", Icon: AlertTriangle, rank: 1 },
  CANT_ASSESS: { label: "Can't assess", cls: "bg-transparent text-gray-400 ring-edge", Icon: CircleHelp, rank: 2 },
  ON_TRACK: { label: "On track", cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30", Icon: CheckCircle2, rank: 3 },
  OVERHEAD: { label: "Overhead", cls: "bg-transparent text-gray-500 ring-edge", Icon: MinusCircle, rank: 4 },
  CLOSED: { label: "Not active", cls: "bg-transparent text-gray-500 ring-edge", Icon: MinusCircle, rank: 5 },
};

export function StatusPill({ health, reason }: { health: JobHealth; reason?: string }) {
  const h = HEALTH[health];
  return (
    <span title={reason} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${h.cls}`}>
      <h.Icon size={12} aria-hidden /> {h.label}
    </span>
  );
}

const STRIPES = `repeating-linear-gradient(135deg, ${BLUE_LIGHT} 0 3px, transparent 3px 6px)`;

// Bullet bar: spend against the contract value. Solid = confirmed, light =
// estimate, striped = still to come; the bright tick is the contract value.
export function SpendBar({
  confirmed, estimated, toCome, contract, height = 10,
}: { confirmed: number; estimated: number; toCome: number; contract: number | null; height?: number }) {
  const scale = Math.max(contract ?? 0, confirmed + estimated + toCome, 1) * 1.04;
  const w = (n: number) => `${Math.max(0, (n / scale) * 100)}%`;
  return (
    <div className="relative w-full rounded bg-panel2" style={{ height }} role="img"
      aria-label={`Spent ${Math.round(confirmed + estimated)}${contract != null ? ` of a ${Math.round(contract)} contract value` : ""}`}>
      <div className="absolute inset-y-0 left-0 flex w-full overflow-hidden rounded">
        <div style={{ width: w(confirmed), background: BLUE }} />
        <div style={{ width: w(estimated), background: BLUE_LIGHT }} />
        <div style={{ width: w(toCome), backgroundImage: STRIPES }} />
      </div>
      {contract != null && <div className="absolute -inset-y-1 w-0.5 rounded bg-gray-100" style={{ left: `calc(${w(contract)} - 1px)` }} />}
    </div>
  );
}

export function Legend({ showToCome = true, showContract = true }: { showToCome?: boolean; showContract?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
      <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: BLUE }} />Locked or invoiced</span>
      <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: BLUE_LIGHT }} />Estimate (open days, hire out)</span>
      {showToCome && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px] ring-1 ring-[#9ec5f4]" style={{ backgroundImage: STRIPES }} />Still to come</span>}
      {showContract && <span><span className="mr-1 inline-block h-2.5 w-0.5 bg-gray-100 align-[-1px]" />Contract value</span>}
    </div>
  );
}

// Weekly spend as a tiny line, last point marked.
export function Sparkline({ values, width = 72, height = 22 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i * (width - 4)) / Math.max(values.length - 1, 1) + 2, height - 3 - (v / max) * (height - 6)]);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={BLUE} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {last && <circle cx={last[0]} cy={last[1]} r={2.5} fill={BLUE} />}
    </svg>
  );
}

// Horizontal bars, biggest first, one hue - "what is the cost made of".
export function CategoryBars({ rows, onPick, picked }: { rows: { key: string; label: string; amount: number }[]; onPick?: (k: string) => void; picked?: string | null }) {
  const max = Math.max(...rows.map((r) => r.amount), 1);
  const total = rows.reduce((n, r) => n + r.amount, 0) || 1;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <button
          key={r.key}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(r.key)}
          className={`grid w-full grid-cols-[7.5rem_minmax(0,1fr)_5.5rem_2.5rem] items-center gap-3 rounded-lg px-1.5 py-1 text-left text-sm ${onPick ? "hover:bg-panel2" : ""} ${picked === r.key ? "bg-panel2" : ""}`}
        >
          <span className="truncate text-gray-300">{r.label}</span>
          <span className="h-3 rounded bg-panel2"><span className="block h-3 rounded" style={{ width: `${(r.amount / max) * 100}%`, background: BLUE }} /></span>
          <span className="text-right font-medium tabular-nums text-gray-100">{r.amount.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 })}</span>
          <span className="text-right text-[11px] tabular-nums text-gray-500">{Math.round((r.amount / total) * 100)}%</span>
        </button>
      ))}
    </div>
  );
}
