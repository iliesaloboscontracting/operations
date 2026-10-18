import { LucideIcon } from "lucide-react";

// One figure in a summary bar (icon, number, label). "warn" turns the icon
// amber when the number is above zero; "labourHire" uses the yellow that
// labour hire tiles have on the board.
export default function StatTile({
  icon: Icon,
  value,
  label,
  tone = "default",
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  tone?: "default" | "warn" | "labourHire";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-3.5 shadow-soft">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          tone === "labourHire"
            ? "border border-yellow-400 bg-yellow-400/20 text-yellow-300"
            : tone === "warn" && value > 0
            ? "bg-amber-500/15 text-amber-600"
            : "bg-brand-500/10 text-brand-600"
        }`}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-semibold leading-tight text-gray-100">{value}</div>
        <div className="text-[11px] leading-tight text-gray-500">{label}</div>
      </div>
    </div>
  );
}
