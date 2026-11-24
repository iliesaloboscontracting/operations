// The small "FT" on a full-timer's tile (22 Nov 2026, lib/fullTime) - so the orange is never the only sign. Screen
// readers hear "Full-time"; a hover shows it too. "relative" keeps the sr-only text inside the mark - without it the
// absolutely-placed text sat at the sidebar's corner and the browser's drag picture grew to a big slice of the sidebar
// (Ilies, 24 Nov 2026: dragging an orange tile showed the whole list).
import { FULL_TIME_LABEL, FULL_TIME_MARK } from "@/lib/fullTime";

export default function FullTimeMark({ className = "" }: { className?: string }) {
  return (
    <span
      title={FULL_TIME_LABEL}
      className={`relative shrink-0 rounded bg-orange-950/70 px-1 text-[9px] font-bold leading-4 tracking-wide text-orange-100 ${className}`}
    >
      <span aria-hidden="true">{FULL_TIME_MARK}</span>
      <span className="sr-only">{FULL_TIME_LABEL}</span>
    </span>
  );
}
