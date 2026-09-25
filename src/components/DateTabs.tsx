"use client";

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function label(d: Date, i: number) {
  if (i === 0) return "Today";
  if (i === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export default function DateTabs({
  selected,
  onSelect,
  days = 7,
}: {
  selected: string;
  onSelect: (iso: string) => void;
  days?: number;
}) {
  const tabs = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return { iso: isoDate(d), day: d.getDate(), text: label(d, i) };
  });

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tabs.map((t) => {
        const active = t.iso === selected;
        return (
          <button
            key={t.iso}
            onClick={() => onSelect(t.iso)}
            className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-brand-600 text-white"
                : "bg-panel2 text-gray-300 hover:bg-gray-700"
            }`}
          >
            {t.text} <span className="opacity-70">{t.day}</span>
          </button>
        );
      })}
    </div>
  );
}
