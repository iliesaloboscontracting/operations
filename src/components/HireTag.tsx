"use client";

import { offHireAlert, type HireLike } from "@/lib/hireEstimate";
import { fmtDay } from "@/lib/dates";

// "Hire Express · back 23 Oct" on a hired item's board chip / sidebar card
// (21 Oct 2026) - amber within 3 days, red overdue. Names and dates only, no
// money, so it's safe on every view of the board.
export function hireTagText(r: HireLike & { agency?: string | null }, today: string) {
  const parts: string[] = [];
  if (r.agency) parts.push(r.agency);
  if (r.offHireDate) parts.push(`back ${fmtDay(r.offHireDate, { day: "numeric", month: "short" })}`);
  const alert = offHireAlert(r, today);
  return { text: parts.join(" · "), level: alert?.level ?? null };
}

const sydneyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());

export default function HireTag({ resource, className = "" }: { resource: HireLike & { agency?: string | null }; className?: string }) {
  const { text, level } = hireTagText(resource, sydneyToday());
  if (!text) return null;
  const tone = level === "OVERDUE" ? "text-red-400 font-semibold" : level ? "text-amber-400 font-semibold" : "opacity-70";
  return (
    <span className={`truncate text-[10px] ${tone} ${className}`} title={level === "OVERDUE" ? "Overdue - still on hire past its expected finish" : level ? "Due back within 3 days" : undefined}>
      {level === "OVERDUE" ? `overdue · ${text}` : text}
    </span>
  );
}
