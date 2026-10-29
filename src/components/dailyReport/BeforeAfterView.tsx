import type { BeforeAfterDTO } from "@/lib/dailyLog/types";

// Before and after site photos side by side, each with the time it was sent and who sent it (30 Oct 2026). Shared by
// Day Review's site-log panel and the daily site report (the office's and the directors' copies - each passes its
// own photo route). A missing set says so ("No before photos") - information only.
export default function BeforeAfterView({ data, photoUrl, size = "sm" }: { data: BeforeAfterDTO; photoUrl: (id: string) => string; size?: "sm" | "lg" }) {
  const cols: { key: "before" | "after"; title: string; missing: boolean }[] = [
    { key: "before", title: "Before", missing: data.noBefore },
    { key: "after", title: "After", missing: data.noAfter },
  ];
  const img = size === "lg" ? "aspect-[4/3] w-full rounded border border-edge object-cover" : "aspect-square w-full rounded object-cover";
  return (
    <div className="grid grid-cols-2 gap-3">
      {cols.map((c) => {
        const photos = data[c.key];
        return (
          <div key={c.key} className="min-w-0">
            <div className="sr-muted mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{c.title}{photos.length ? ` (${photos.length})` : ""}</div>
            {photos.length === 0 ? (
              <p className={`text-xs ${c.missing ? "text-amber-400" : "text-gray-500"}`}>{c.missing ? `No ${c.title.toLowerCase()} photos` : "None yet"}</p>
            ) : (
              <div className={size === "lg" ? "space-y-2" : "grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6"}>
                {photos.map((p) => (
                  <a key={p.id} href={photoUrl(p.id)} target="_blank" rel="noreferrer" className="block">
                    <img src={photoUrl(p.id)} alt={`${c.title} photo ${p.atLabel}`} className={img} />
                    <span className="sr-muted block truncate text-[10px] text-gray-500">{p.atLabel}{p.takenBy ? ` · ${p.takenBy}` : ""}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
