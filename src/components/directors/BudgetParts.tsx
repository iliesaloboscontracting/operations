"use client";

// Small pieces shared by the Budgets to approve pages (Task H, 25 Oct 2026).
// Status is always a word, never colour alone.

export const aud = (n: number | null | undefined, cents = false) =>
  n == null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 });

export const hrs = (n: number | null | undefined) => (n == null || n === 0 ? "—" : `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} h`);

const STATUS: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: "Waiting for approval", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  APPROVED: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" },
  REJECTED: { label: "Rejected", cls: "bg-red-500/15 text-red-400 ring-red-500/30" },
  SUPERSEDED: { label: "Replaced by a later revision", cls: "bg-transparent text-gray-500 ring-edge" },
};

export function BudgetStatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-transparent text-gray-400 ring-edge" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.cls}`}>{s.label}</span>;
}

// Submitted price against the calculated build-up, as "+$1,200 (+3%)".
export function adjustmentText(buildUp: number, submitted: number) {
  const diff = submitted - buildUp;
  if (Math.abs(diff) < 0.5) return "Same as the build-up";
  const pct = buildUp > 0 ? Math.round((diff / buildUp) * 1000) / 10 : null;
  return `${diff > 0 ? "+" : "-"}${aud(Math.abs(diff))}${pct === null ? "" : ` (${diff > 0 ? "+" : ""}${pct}%)`} vs the build-up`;
}
