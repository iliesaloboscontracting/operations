// Shared Day/Night representation: a yellow-orange sun for Day, a purple moon for
// Night. Plain Unicode glyphs (not emoji-presentation) so they take a CSS colour,
// unlike colour emoji which ignore `color`.
export type Shift = "DAY" | "NIGHT";

const SUN = "☀";
const MOON = "☾";

export function shiftIcon(shift: Shift) {
  return shift === "NIGHT" ? MOON : SUN;
}

export function ShiftIcon({ shift, className = "" }: { shift: Shift; className?: string }) {
  return (
    <span
      className={`${shift === "NIGHT" ? "text-purple-500" : "text-amber-500"} ${className}`}
      aria-hidden
    >
      {shiftIcon(shift)}
    </span>
  );
}

// Compact pill used on job rows, cards and filters.
export function ShiftBadge({
  shift,
  label,
  className = "",
}: {
  shift: Shift;
  label?: string;
  className?: string;
}) {
  const isNight = shift === "NIGHT";
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${
        isNight ? "bg-purple-500/15 text-purple-600" : "bg-amber-500/15 text-amber-600"
      } ${className}`}
    >
      <span aria-hidden>{shiftIcon(shift)}</span>
      {label ?? (isNight ? "Night" : "Day")}
    </span>
  );
}
