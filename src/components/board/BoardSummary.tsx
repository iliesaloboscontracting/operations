"use client";

// Slim board header (Ilies, 27 Nov 2026: "on my [49 inch] screen the proportions are great but when only on my laptop
// it becomes difficult to navigate the app ... can we do something about this"). On a laptop-sized window the board's
// header (the day figures, the starts strip, Pre-starts today and Needs attention) took ~506 px of a 768 px screen and
// left ~200 px for the allocations. On such a window they fold into ONE summary row; each part is a button that opens
// its full card below the row, and "Expand all" / "Collapse all" opens or folds them all. Urgent and critical counts
// always stay in red in the row. Which parts are open is remembered on this computer (localStorage, a convenience).
// On a big window (Ilies's ultrawide) none of this shows - the header is exactly as before.
//
// No data is fetched here: each card keeps loading its own data (as before) and reports a few words for the row
// through this context, so nothing is fetched twice.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";

export type SectionKey = "figures" | "starts" | "prestarts" | "attention";
export const SECTION_ORDER: SectionKey[] = ["figures", "starts", "prestarts", "attention"];
export type SummaryPart = { text: string; tone?: "red" | "amber" | "muted" };
export type SectionSummary = { label?: string; parts: SummaryPart[] };

// Short or narrow windows: under 1000 px tall (every laptop, and a 1080p monitor once the browser's own bars are
// counted) or under 1600 px wide (a 1366 / 1440 / 1536 px laptop). A 49" ultrawide (5120 x 1440) is neither.
export const COMPACT_QUERY = "(max-height: 999px), (max-width: 1599px)";
const OPEN_KEY = "lobos-board-summary-open"; // JSON list of the open parts (this computer only)

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Ctx = {
  compact: boolean;
  report: (key: SectionKey, s: SectionSummary | null) => void;
  collapse: (key: SectionKey) => void;
};
const BoardSummaryContext = createContext<Ctx | null>(null);
export const BoardSummaryProvider = BoardSummaryContext.Provider;

/** For a card on the board: null when the card isn't on the board (e.g. the coordinator's page) - it behaves as before. */
export function useBoardSection(key: SectionKey, summary: SectionSummary | null) {
  const ctx = useContext(BoardSummaryContext);
  const sig = summary ? JSON.stringify(summary) : "";
  useEffect(() => {
    if (!ctx) return;
    ctx.report(key, sig ? (JSON.parse(sig) as SectionSummary) : null);
  }, [ctx, key, sig]);
  useEffect(() => () => ctx?.report(key, null), [ctx, key]);
  return ctx ? { compact: ctx.compact, collapse: () => ctx.collapse(key) } : null;
}

/** The board's own state for the summary row. */
export function useBoardSummary() {
  const [compact, setCompact] = useState(false);
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const [open, setOpen] = useState<SectionKey[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
      if (Array.isArray(saved)) setOpen(saved.filter((k): k is SectionKey => SECTION_ORDER.includes(k)));
    } catch { /* no storage - all folded */ }
  }, []);
  const save = (next: SectionKey[]) => {
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* fine */ }
  };
  const [summaries, setSummaries] = useState<Partial<Record<SectionKey, SectionSummary>>>({});
  const report = useCallback((key: SectionKey, s: SectionSummary | null) => {
    setSummaries((prev) => {
      if (JSON.stringify(prev[key] ?? null) === JSON.stringify(s)) return prev;
      const next = { ...prev };
      if (s) next[key] = s; else delete next[key];
      return next;
    });
  }, []);
  const collapse = useCallback((key: SectionKey) => {
    setOpen((prev) => {
      const next = prev.filter((k) => k !== key);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
  }, []);
  const ctx = useMemo<Ctx>(() => ({ compact, report, collapse }), [compact, report, collapse]);
  const isOpen = (k: SectionKey) => open.includes(k);
  const toggle = (k: SectionKey) => save(isOpen(k) ? open.filter((x) => x !== k) : [...open, k]);
  return { compact, ctx, summaries, isOpen, toggle, save, open };
}

const TONE: Record<NonNullable<SummaryPart["tone"]>, string> = {
  red: "font-semibold text-red-300",
  amber: "text-amber-300",
  muted: "text-gray-500",
};

/** The one slim row: a button per part, then Expand all / Collapse all. */
export function BoardSummaryRow({
  summaries,
  isOpen,
  toggle,
  setAll,
}: {
  summaries: Partial<Record<SectionKey, SectionSummary>>;
  isOpen: (k: SectionKey) => boolean;
  toggle: (k: SectionKey) => void;
  setAll: (keys: SectionKey[]) => void;
}) {
  const shown = SECTION_ORDER.filter((k) => summaries[k]);
  if (!shown.length) return null;
  const allOpen = shown.every(isOpen);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="board-summary" role="group" aria-label="Day summary">
      {shown.map((k) => {
        const s = summaries[k]!;
        const open = isOpen(k);
        return (
          <button
            key={k}
            onClick={() => toggle(k)}
            aria-expanded={open}
            aria-controls={`board-section-${k}`}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left text-xs ${
              open ? "border-brand-500/60 bg-brand-500/10 text-gray-100" : "border-edge bg-panel text-gray-300 hover:bg-panel2"
            }`}
          >
            {open ? <ChevronDown size={13} className="shrink-0 text-gray-500" /> : <ChevronRight size={13} className="shrink-0 text-gray-500" />}
            {s.label && <span className="font-semibold text-gray-100">{s.label}</span>}
            {s.parts.map((p, i) => (
              <span key={i} className={p.tone ? TONE[p.tone] : ""}>
                {(i > 0 || s.label) && <span className="mr-1.5 text-gray-600" aria-hidden>·</span>}
                {p.text}
              </span>
            ))}
          </button>
        );
      })}
      <button
        onClick={() => setAll(allOpen ? [] : shown)}
        className="ml-auto flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-panel2"
      >
        {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
        {allOpen ? "Collapse all" : "Expand all"}
      </button>
    </div>
  );
}
