"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/lib/resource";

// Fixed categorical order - a brighter/more modern set than the original
// muted palette (Ilies: "colour palette looks old"), re-validated colorblind-
// safe against the app's real panel surface (#ffffff - Operations runs in light
// mode) via the dataviz skill's validator. Never reorder or cycle these; a
// cost type always gets the same color everywhere in the app. Four slots
// (orange/emerald/amber/cyan) sit under 3:1 contrast on white by design -
// that's why every place these colors appear also carries a text label
// (legend, tooltip, line-item row), never color alone.
export const COST_CATEGORIES = [
  { key: "plant", label: "Plant", color: "#2563eb" },
  { key: "attach", label: "Attachments", color: "#f97316" },
  { key: "trucks", label: "Trucks", color: "#10b981" },
  { key: "hire", label: "Hire", color: "#f59e0b" },
  { key: "labourHire", label: "Labour hire", color: "#ec4899" },
  { key: "tipFees", label: "Tip fees", color: "#06b6d4" },
  { key: "materials", label: "Materials", color: "#8b5cf6" },
  { key: "ownCrew", label: "Own crew", color: "#ef4444" },
] as const;

export type CostCategoryKey = (typeof COST_CATEGORIES)[number]["key"];
export type CostBreakdown = Record<CostCategoryKey, number>;

// Own crew wages are the routine baseline on every project - not something
// that needs to visually dominate a glance-bar/donut the way an unusual
// externally-invoiced cost does. Left transparent (not removed - its value
// still occupies its true proportion of the shape and still shows on hover)
// in the small per-row indicators, so what catches the eye is what's
// actually been invoiced externally, not the expected own-crew bulk. The
// page-level "Cost by category" summary (a deliberate full report, not a
// glance aid) still shows it in full - see tracking/page.tsx.
const CLEAR_CATEGORY: CostCategoryKey = "ownCrew";
function fillFor(key: CostCategoryKey, color: string) {
  return key === CLEAR_CATEGORY ? "transparent" : color;
}

function BreakdownTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as CostBreakdown | undefined;
  if (!row) return null;
  const nonZero = COST_CATEGORIES.filter((c) => row[c.key] > 0);
  if (nonZero.length === 0) return null;
  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white px-3 py-2 text-xs shadow-lg">
      {nonZero.map((c) => (
        <div key={c.key} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: c.color }} />
          <span className="text-gray-500">{c.label}</span>
          <span className="ml-auto pl-3 font-medium text-gray-100">{money(row[c.key])}</span>
        </div>
      ))}
    </div>
  );
}

// A per-category tooltip for the donut - same look as BreakdownTooltip but
// fed a single {name, value, color} slice instead of a full breakdown row.
function DonutTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const slice = payload[0];
  if (!slice) return null;
  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: slice.payload.swatch }} />
        <span className="text-gray-500">{slice.name}</span>
        <span className="ml-auto pl-3 font-medium text-gray-100">{money(slice.value)}</span>
      </div>
    </div>
  );
}

// A small donut per project row - replaces the horizontal stacked bar there
// (Ilies didn't like the bar style for that spot). Fixed pixel size, not
// responsive, since it sits inline in a table row at a known size.
export function CostBreakdownDonut({ breakdown, size = 36 }: { breakdown: CostBreakdown; size?: number }) {
  const slices = COST_CATEGORIES.map((c) => ({ name: c.label, value: breakdown[c.key], fill: fillFor(c.key, c.color), swatch: c.color })).filter((s) => s.value > 0);
  if (slices.length === 0) {
    return <div className="shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <PieChart width={size} height={size}>
      <Tooltip content={<DonutTooltip />} />
      <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={size * 0.3} outerRadius={size * 0.5} stroke="#d9dce1" strokeWidth={1}>
        {slices.map((s, i) => (
          <Cell key={i} fill={s.fill} />
        ))}
      </Pie>
    </PieChart>
  );
}

// A compact horizontal stacked bar for one project's cost split across the
// fixed category palette. Used both small (collapsed project row) and larger
// (expanded detail view) via the `height` prop.
export function CostBreakdownBar({ breakdown, height = 20 }: { breakdown: CostBreakdown; height?: number }) {
  const total = COST_CATEGORIES.reduce((n, c) => n + breakdown[c.key], 0);
  if (total <= 0) return <div className="rounded bg-white/40" style={{ height }} />;
  return (
    // Outline around the whole track, not just the coloured segments - most
    // of this bar is now transparent (own crew, see fillFor above), so
    // without a boundary the blank majority would be indistinguishable from
    // the card background it sits on.
    <div className="overflow-hidden rounded border border-[#d9dce1]" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={[breakdown]} layout="vertical" barCategoryGap={0} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" hide domain={[0, total]} />
          <YAxis type="category" hide dataKey={() => "total"} />
          <Tooltip content={<BreakdownTooltip />} cursor={{ fill: "transparent" }} />
          {COST_CATEGORIES.map((c) => (
            <Bar key={c.key} dataKey={c.key} stackId="cost" fill={fillFor(c.key, c.color)}>
              <Cell />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// The shared legend row - category swatches with labels, shown once per page
// rather than repeated on every bar (keeps dozens of project rows scannable).
export function CostCategoryLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-400">
      {COST_CATEGORIES.map((c) => (
        <div key={c.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: c.color }} />
          {c.label}
        </div>
      ))}
    </div>
  );
}

function RankingTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-xs shadow-soft-lg backdrop-blur-xl">
      <div className="font-medium text-gray-100">{p.name}</div>
      <div className="text-gray-400">{money(p.totalCost)}</div>
    </div>
  );
}

// Page-level ranking chart: every active project by total cost, so the
// expensive jobs are visible without reading a column of numbers.
export function ProjectRankingChart({ data }: { data: { name: string; totalCost: number }[] }) {
  const rowHeight = 28;
  const height = Math.max(data.length * rowHeight, 60);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={160}
          tick={{ fill: "#c3c2b7", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<RankingTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
        <Bar dataKey="totalCost" fill="#0184B8" radius={[0, 4, 4, 0]} maxBarSize={18}>
          {data.map((_, i) => (
            <Cell key={i} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
