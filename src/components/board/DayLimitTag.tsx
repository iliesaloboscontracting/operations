"use client";

import { distinctDates, limitOf, limitTag, sameWeek } from "@/lib/dayLimit/rules";

// The board's "3 d/wk" tag (12 Nov 2026, lib/dayLimit): a Labour-register person limited to so many days a Mon-Sun week.
// With the board's day and the person's allocations, the hover says how many days they're on that week already.
// Managers and Admins only - the limit is stripped from the record for everyone else, so nothing shows.
export default function DayLimitTag({ limit, dates, day }: { limit?: number | null; dates?: string[]; day?: string }) {
  const max = limitOf(limit);
  if (max == null) return null;
  const used = day && dates ? distinctDates(dates).filter((d) => sameWeek(d, day)).length : null;
  const full = used != null && used >= max;
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${full ? "bg-amber-500/25 text-amber-200" : "bg-sky-500/20 text-sky-200"}`}
      title={used != null ? `${used} of ${max} days this week (Mon–Sun) – limited to ${max} a week` : `Limited to ${max} days a week (Mon–Sun)`}
    >
      {limitTag(max)}
    </span>
  );
}
