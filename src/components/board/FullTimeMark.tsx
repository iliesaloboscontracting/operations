// The small "FT" on a full-timer's tile (22 Nov 2026, lib/fullTime) - so the orange is never the only sign. Screen
// readers hear "Full-time"; a hover shows it too.
import { FULL_TIME_LABEL, FULL_TIME_MARK } from "@/lib/fullTime";

export default function FullTimeMark({ className = "" }: { className?: string }) {
  return (
    <span
      title={FULL_TIME_LABEL}
      className={`shrink-0 rounded bg-orange-950/70 px-1 text-[9px] font-bold leading-4 tracking-wide text-orange-100 ${className}`}
    >
      <span aria-hidden="true">{FULL_TIME_MARK}</span>
      <span className="sr-only">{FULL_TIME_LABEL}</span>
    </span>
  );
}
