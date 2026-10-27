"use client";

// The list of conversations: the Office room on top, then one-to-ones unread first then newest.
export type ThreadRow = {
  id: string; room: boolean; title: string; subjectType: string; subjectKey: string | null; subjectLabel: string; other: { name: string } | null;
  lastMessageAt: string; last: { by: string; text: string } | null; unread: number;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function ThreadList({ rows, selected, onOpen, big = false }: { rows: ThreadRow[]; selected?: string | null; onOpen: (id: string) => void; big?: boolean }) {
  const sorted = [...rows].sort((a, b) => Number(b.room) - Number(a.room) || (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.lastMessageAt.localeCompare(a.lastMessageAt));
  if (!sorted.length) return <p className="text-sm text-gray-500">No messages yet.</p>;
  return (
    <div className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-panel">
      {sorted.map((t) => (
        <button key={t.id} onClick={() => onOpen(t.id)} className={`block w-full px-3 ${big ? "py-3" : "py-2"} text-left hover:bg-panel2 ${selected === t.id ? "bg-panel2" : ""}`}>
          <span className="flex min-w-0 items-center gap-2">
            <span className={`truncate font-medium ${t.unread ? "text-gray-100" : "text-gray-300"}`}>{t.room ? `# ${t.title}` : t.title}</span>
            {t.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{t.unread}</span>}
            {t.last && <span className="ml-auto shrink-0 text-[11px] text-gray-500">{when(t.lastMessageAt)}</span>}
          </span>
          <span className="block truncate text-xs text-gray-500">{t.subjectLabel}</span>
          {t.last && <span className="block truncate text-xs text-gray-400">{t.last.by}: {t.last.text}</span>}
        </button>
      ))}
    </div>
  );
}
