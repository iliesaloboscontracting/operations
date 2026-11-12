"use client";

// The Calendar's tiles (Ilies, 12 Nov 2026: "lets just use tiles. where the works stretch through days lets make it one
// continuous tile"). Each project is one continuous, labelled bar (lib/calendarTiles.ts does the maths): a month grid
// of week rows, a single taller week row, a 3-month timeline, and an agenda list for phones. What the board has on a
// day (crew counts, warnings) sits inside the bar on that day, in words as well as colour. Read-only: clicking a day
// of a bar opens the existing job details panel for that project and day. The look (Ilies, 12 Nov 2026: "remove the
// striped lighten the colour inside the bar and darken the boarder line"): a pastel fill per project, a darker outline
// in the same hue, near-black text - no stripes or hatching anywhere.
import type { CSSProperties, ReactNode } from "react";
import { ShiftIcon } from "@/components/ShiftBadge";
import type { CalendarSpanDTO } from "@/lib/calendarSpans";
import { spanDays, spanWords } from "@/lib/calendarSpans";
import { agenda, layoutRows, TILE_PALETTE, type AgendaEntry, type Bar, type DayKind, type DayMark, type Segment, type TileColour } from "@/lib/calendarTiles";
import { addDays, daysBetween, fmtDay, isWeekend, parseISO } from "@/lib/dates";

export interface TileRow {
  key: string;
  name: string;
  jobNo: string | null;
  span?: CalendarSpanDTO;
  bars: Bar[];
  marks: Map<string, DayMark>;
  colour: TileColour;
}

type OnOpen = (key: string, date: string) => void;

const longDay = (iso: string) => fmtDay(iso, { weekday: "short", day: "numeric", month: "short" });
const shortDayYear = (iso: string) => fmtDay(iso, { day: "numeric", month: "short", year: "numeric" });

// The project's identity: its pastel fill and its darker outline in the same hue (lib/calendarTiles.ts TILE_PALETTE).
export const tileBackground = (c: TileColour) => c.fill;

export function tileBorder(c: TileColour, tentative: boolean): CSSProperties {
  return { borderWidth: 2, borderStyle: tentative ? "dashed" : "solid", borderColor: c.border };
}

// Day-by-day: a bridged weekend and a tentative start's planned days are a lighter wash of the same pastel.
const LIGHTER = "rgb(255 255 255 / 0.45)";
function sliceStyle(kind: DayKind, tentative: boolean): CSSProperties | undefined {
  if (kind === "GAP") return { background: LIGHTER }; // a weekend bridged between booked days
  if (kind === "PLAN" && tentative) return { background: "rgb(255 255 255 / 0.35)" }; // start tentative: lighter
  return undefined;
}

// Past the expected finish: an amber outline round those days of the bar (status amber, with the "⚠ past finish" chip).
const AMBER = "#f59e0b";
function OverOutline({ kinds, height }: { kinds: DayKind[]; height?: string }) {
  const i = kinds.indexOf("OVER");
  if (i < 0) return null;
  const n = kinds.lastIndexOf("OVER") - i + 1;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-0 z-[5]"
      style={{ left: `${(i / kinds.length) * 100}%`, width: `${(n / kinds.length) * 100}%`, height: height ?? "100%", border: `2px solid ${AMBER}` }}
    />
  );
}

const PastFinishChip = () => (
  <span className="whitespace-nowrap rounded-sm bg-amber-400 px-1 font-semibold text-gray-950 ring-1 ring-gray-950/30">⚠ past finish</span>
);

const KIND_WORDS: Record<DayKind, string> = {
  PLAN: "planned",
  OVER: "⚠ past expected finish",
  BOOKED: "on the board (outside the planned dates)",
  GAP: "weekend between booked days",
};

function planWords(span: CalendarSpanDTO | undefined) {
  if (!span) return "No planned dates";
  const n = spanDays(span);
  const up = span.upcoming
    ? ` · inactive - ${span.upcoming.kind === "RECOMMENCES" ? "recommences" : "starts"} ${shortDayYear(span.upcoming.date)}`
    : span.status === "INACTIVE"
    ? " · inactive"
    : "";
  return `Planned ${spanWords(span, shortDayYear)}${n ? ` (${n} days)` : ""}${up}`;
}

function sliceTitle(row: TileRow, d: string, kind: DayKind) {
  const m = row.marks.get(d);
  const what = m ? m.words : kind === "PLAN" ? "nothing on the board yet" : KIND_WORDS[kind];
  const extra = kind === "OVER" ? ` · ${KIND_WORDS.OVER}` : "";
  return `${row.name}${row.jobNo ? ` · ${row.jobNo}` : ""}\n${longDay(d)}: ${what}${extra}\n${planWords(row.span)}\nClick for the day's details`;
}

// The board's marks for one day, inside the bar: ☀2 ☾3, plus "No sup" / "No crew" in words. On a pastel bar the sun /
// moon are near-black like the text (the coloured icons don't read on every pastel); on the dark agenda they keep
// their colours.
function Marks({ m, wide, onPastel = false }: { m: DayMark; wide: boolean; onPastel?: boolean }) {
  if (m.notRunning) return <span className={`line-through ${onPastel ? "text-gray-700" : "text-gray-400"}`}>Not running</span>;
  const parts: ReactNode[] = [];
  for (const [shift, s] of [["DAY", m.day], ["NIGHT", m.night]] as const) {
    if (!s) continue;
    parts.push(
      <span key={shift} className="whitespace-nowrap">
        {onPastel ? <span aria-hidden>{shift === "NIGHT" ? "☾" : "☀"}</span> : <ShiftIcon shift={shift} />}
        {s.crew > 0 ? (wide ? ` ${s.crew} crew` : s.crew) : "–"}
        {wide && s.plant > 0 && ` · ${s.plant}p`}
        {wide && s.hire > 0 && ` · ${s.hire}h`}
      </span>
    );
  }
  if (m.warn === "NO_SUPERVISOR")
    parts.push(
      <span key="w" className="whitespace-nowrap rounded-sm bg-red-600 px-1 font-semibold text-white ring-1 ring-gray-950/30">
        {wide ? "No supervisor" : "No sup"}
      </span>
    );
  else if (m.warn === "NO_CREW")
    parts.push(
      <span key="w" className="whitespace-nowrap rounded-sm bg-amber-400 px-1 font-semibold text-gray-950 ring-1 ring-gray-950/30">
        No crew
      </span>
    );
  return <>{parts}</>;
}

function TileLabel({ row, seg, arrowLeft }: { row: TileRow; seg: Segment; arrowLeft: boolean }) {
  const last = seg.to === seg.bar.to;
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 z-10 truncate px-1.5 text-[11px] font-semibold leading-[17px] text-gray-950">
      {arrowLeft && <span aria-label="continues from earlier">‹ </span>}
      {row.name}
      {row.jobNo && <span className="font-normal text-gray-800"> · {row.jobNo}</span>}
      {last && row.span?.finishTbc && seg.bar.contEnd && <span className="font-normal text-gray-800"> · finish TBC</span>}
    </span>
  );
}

// One bar's piece inside a row: the project's background, a button per day (marks and the click), the label on top.
function TileSegment({
  row,
  seg,
  tall,
  onOpen,
  style,
}: {
  row: TileRow;
  seg: Segment;
  tall: boolean;
  onOpen: OnOpen;
  style: CSSProperties;
}) {
  const bar = seg.bar;
  const days = Array.from({ length: seg.span }, (_, i) => {
    const d = addDays(seg.from, i);
    return { d, kind: bar.kinds[daysBetween(bar.from, d)] };
  });
  const firstOver = days.find((x) => x.kind === "OVER")?.d;
  const twoLines = tall || days.some((x) => row.marks.has(x.d) || x.d === firstOver);
  const arrowLeft = seg.startsHere && bar.contStart;
  const arrowRight = seg.to === bar.to && bar.contEnd;
  const fade = arrowRight && bar.fadeEnd;
  return (
    <div
      className={`relative grid overflow-hidden ${seg.contLeft ? "-ml-px rounded-l-none border-l-0" : "ml-[3px] rounded-l-[4px]"} ${
        seg.contRight ? "-mr-px rounded-r-none border-r-0" : "mr-[3px] rounded-r-[4px]"
      }`}
      style={{
        ...style,
        ...tileBorder(row.colour, bar.tentative),
        ...(seg.contLeft ? { borderLeftWidth: 0 } : {}),
        ...(seg.contRight ? { borderRightWidth: 0 } : {}),
        background: tileBackground(row.colour),
        gridTemplateColumns: `repeat(${seg.span}, minmax(0, 1fr))`,
        ...(fade ? { maskImage: "linear-gradient(to right, black calc(100% - 56px), transparent)" } : {}),
      }}
    >
      <TileLabel row={row} seg={seg} arrowLeft={arrowLeft} />
      <OverOutline kinds={days.map((x) => x.kind)} />
      {days.map(({ d, kind }) => {
        const m = row.marks.get(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onOpen(row.key, d)}
            title={sliceTitle(row, d, kind)}
            style={sliceStyle(kind, bar.tentative)}
            className={`flex min-w-0 flex-wrap content-start items-center gap-x-1 gap-y-px overflow-hidden px-1 text-left text-[10px] leading-[14px] text-gray-950 hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-950 ${
              twoLines ? (tall ? "min-h-[44px] pt-[18px] pb-0.5" : "min-h-[34px] pt-[17px] pb-0.5") : "h-[19px]"
            }`}
          >
            {d === firstOver && <PastFinishChip />}
            {m && <Marks m={m} wide={tall} onPastel />}
          </button>
        );
      })}
      {arrowRight && !fade && (
        <span aria-label="continues later" className="pointer-events-none absolute right-1 top-0 z-10 text-[11px] font-bold leading-[17px] text-gray-950">
          ›
        </span>
      )}
    </div>
  );
}


// Month (several week rows) and week (one tall row): a calendar grid with a box per day and the bars across them.
export function TileGrid({
  weeks,
  from,
  to,
  today,
  rows,
  order,
  tall,
  onOpen,
}: {
  weeks: string[][];
  from: string;
  to: string;
  today: string;
  rows: TileRow[];
  order: string[];
  tall: boolean;
  onOpen: OnOpen;
}) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const layout = layoutRows(
    rows.flatMap((r) => r.bars),
    weeks,
    order
  );
  return (
    <div className="overflow-hidden rounded-lg border border-edge">
      <div className="grid grid-cols-7 bg-panel">
        {weeks[0].map((d) => (
          <div key={d} className="border-l border-edge px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 first:border-l-0">
            {fmtDay(d, { weekday: "short" })}
          </div>
        ))}
      </div>
      {layout.map((w) => {
        const lanes = w.lanes;
        const allRows = lanes + 2;
        return (
          <div
            key={w.days[0]}
            className="relative grid grid-cols-7 gap-y-[2px] border-t border-edge"
            style={{ gridTemplateRows: `22px repeat(${lanes}, auto) ${tall ? "28px" : "10px"}` }}
          >
            {w.days.map((d, i) => {
              const inRange = d >= from && d <= to;
              return (
                <div
                  key={`bg${d}`}
                  data-today={d === today ? "" : undefined}
                  className={`border-l border-edge first:border-l-0 ${
                    d === today ? "bg-blue-900/25" : !inRange ? "bg-canvas" : isWeekend(d) ? "bg-panel2/70" : "bg-panel"
                  }`}
                  style={{ gridColumn: i + 1, gridRow: `1 / span ${allRows}` }}
                />
              );
            })}
            {w.days.map((d, i) => {
              const inRange = d >= from && d <= to;
              const first = d.slice(8) === "01" || i === 0;
              return (
                <div key={`n${d}`} className="flex items-center gap-1 px-2 text-[11px]" style={{ gridColumn: i + 1, gridRow: 1 }}>
                  {d === today ? (
                    <span className="rounded-full bg-brand-600 px-1.5 font-bold text-white">{Number(d.slice(8))}</span>
                  ) : (
                    <span className={`font-semibold ${inRange ? "text-gray-300" : "text-gray-600"}`}>{Number(d.slice(8))}</span>
                  )}
                  {first && <span className={`${inRange ? "text-gray-500" : "text-gray-700"}`}>{fmtDay(d, { month: "short" })}</span>}
                  {d === today && <span className="text-[10px] font-semibold uppercase text-blue-300">Today</span>}
                </div>
              );
            })}
            {w.segments.map((s) => {
              const row = byKey.get(s.bar.key);
              if (!row) return null;
              return (
                <TileSegment
                  key={`${s.bar.id}@${s.from}`}
                  row={row}
                  seg={s}
                  tall={tall}
                  onOpen={onOpen}
                  style={{ gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 2, zIndex: 1 }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// The 3-month timeline: one row per project, a thick labelled tile, a narrow column per day.
const COL = 16;
export function TileTimeline({
  days,
  today,
  rows,
  onOpen,
  nameCell,
  scrollerRef,
}: {
  days: string[];
  today: string;
  rows: TileRow[];
  onOpen: OnOpen;
  nameCell: (row: TileRow) => ReactNode;
  scrollerRef?: React.Ref<HTMLDivElement>;
}) {
  const months: { key: string; days: number }[] = [];
  for (const d of days) {
    const k = d.slice(0, 7);
    if (months.length && months[months.length - 1].key === k) months[months.length - 1].days++;
    else months.push({ key: k, days: 1 });
  }
  const cols = `repeat(${days.length}, ${COL}px)`;
  const nameW = "w-[150px] min-w-[150px] sm:w-[190px] sm:min-w-[190px]";
  return (
    <div ref={scrollerRef} className="overflow-x-auto rounded-lg border border-edge">
      <div style={{ width: "max-content" }}>
        <div className="flex border-b border-edge bg-panel">
          <div data-name-col className={`sticky left-0 z-20 ${nameW} border-r border-edge bg-panel px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500`}>
            Project
          </div>
          <div className="grid" style={{ gridTemplateColumns: cols }}>
            {months.map((m) => (
              <div key={m.key} className="border-l border-edge px-1 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400" style={{ gridColumn: `span ${m.days}` }}>
                {fmtDay(`${m.key}-01`, { month: "long", year: "numeric" })}
              </div>
            ))}
            {days.map((d) => (
              <div
                key={d}
                data-today={d === today ? "" : undefined}
                title={fmtDay(d, { weekday: "short", day: "numeric", month: "short" })}
                className={`py-0.5 text-center text-[9px] leading-none ${parseISO(d).getDay() === 1 ? "border-l border-gray-500" : ""} ${
                  d === today ? "bg-brand-600 font-bold text-white" : isWeekend(d) ? "text-gray-600" : "text-gray-500"
                }`}
              >
                {parseISO(d).getDay() === 1 || d === today ? Number(d.slice(8)) : " "}
              </div>
            ))}
          </div>
        </div>
        {rows.map((row) => {
          const [lay] = layoutRows(row.bars, [days]);
          return (
            <div key={row.key} className="flex border-b border-edge last:border-b-0">
              <div className={`sticky left-0 z-20 ${nameW} border-r border-edge bg-canvas px-2 py-1 sm:px-3`}>{nameCell(row)}</div>
              <div className="grid items-center" style={{ gridTemplateColumns: cols, gridTemplateRows: "minmax(36px, auto)" }}>
                {days.map((d, i) => (
                  <div
                    key={d}
                    className={`h-full ${parseISO(d).getDay() === 1 ? "border-l border-edge" : ""} ${
                      d === today ? "bg-blue-900/30" : isWeekend(d) ? "bg-panel2/70" : "bg-panel"
                    }`}
                    style={{ gridColumn: i + 1, gridRow: 1 }}
                  />
                ))}
                {lay.segments.map((s) => (
                  <TimelineTile key={s.bar.id} row={row} seg={s} onOpen={onOpen} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineTile({ row, seg, onOpen }: { row: TileRow; seg: Segment; onOpen: OnOpen }) {
  const bar = seg.bar;
  const arrowLeft = bar.contStart;
  const arrowRight = bar.contEnd;
  const fade = arrowRight && bar.fadeEnd;
  return (
    <div
      className={`relative z-[1] grid h-[30px] self-center overflow-hidden ${arrowLeft ? "rounded-l-none" : "ml-[2px] rounded-l-[4px]"} ${
        arrowRight ? "rounded-r-none" : "mr-[2px] rounded-r-[4px]"
      }`}
      style={{
        gridColumn: `${seg.col + 1} / span ${seg.span}`,
        gridRow: 1,
        ...tileBorder(row.colour, bar.tentative),
        background: tileBackground(row.colour),
        gridTemplateColumns: `repeat(${seg.span}, minmax(0, 1fr))`,
        ...(fade ? { maskImage: "linear-gradient(to right, black calc(100% - 56px), transparent)" } : {}),
      }}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 z-10 truncate px-1 text-[11px] font-semibold leading-[16px] text-gray-950">
        {arrowLeft && "‹ "}
        {row.name}
        {row.jobNo && <span className="font-normal text-gray-800"> · {row.jobNo}</span>}
      </span>
      <OverOutline kinds={Array.from({ length: seg.span }, (_, i) => bar.kinds[daysBetween(bar.from, addDays(seg.from, i))])} />
      {Array.from({ length: seg.span }, (_, i) => {
        const d = addDays(seg.from, i);
        const kind = bar.kinds[daysBetween(bar.from, d)];
        const m = row.marks.get(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onOpen(row.key, d)}
            title={sliceTitle(row, d, kind)}
            style={sliceStyle(kind, bar.tentative)}
            className="flex h-full items-end justify-center pb-px text-[9px] font-bold leading-none hover:bg-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-950"
          >
            {m && <TinyMark m={m} />}
          </button>
        );
      })}
      {arrowRight && !fade && <span className="pointer-events-none absolute right-0.5 top-0 z-10 text-[11px] font-bold leading-[16px] text-gray-950">›</span>}
    </div>
  );
}

// A day in a 16px column: a glyph, the words on hover (the button's title). "!" red = no supervisor, "–" amber = gear
// but no crew, "×" grey = not running, "•" = crew booked.
function TinyMark({ m }: { m: DayMark }) {
  if (m.notRunning) return <span className="text-gray-700">×</span>;
  if (m.warn === "NO_SUPERVISOR") return <span className="rounded-sm bg-red-600 px-[2px] text-white ring-1 ring-gray-950/40">!</span>;
  if (m.warn === "NO_CREW") return <span className="rounded-sm bg-amber-400 px-[2px] text-gray-950 ring-1 ring-gray-950/40">–</span>;
  return <span className="text-gray-950">•</span>;
}

function Swatch({ row, tentative, small = false }: { row: TileRow; tentative: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`${small ? "h-3 w-3" : "mt-0.5 h-4 w-4"} shrink-0 rounded-[3px]`}
      style={{ background: tileBackground(row.colour), ...tileBorder(row.colour, tentative) }}
    />
  );
}

// Phones (< 640px): a list by day. Each day: the projects running, their counts and marks; "continuing" when the bar
// started on an earlier day.
export function TileAgenda({
  days,
  today,
  rows,
  order,
  onOpen,
}: {
  days: string[];
  today: string;
  rows: TileRow[];
  order: string[];
  onOpen: OnOpen;
}) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  // A full line: something on the board that day, its first or last day, outside the plan or past the expected finish.
  const isFull = (e: AgendaEntry, date: string) =>
    e.kind !== "PLAN" || !e.continuing || e.lastDay || !!byKey.get(e.key)?.marks.has(date);
  const list = agenda(
    rows.flatMap((r) => r.bars),
    days,
    order
  ).filter((x) => x.entries.length > 0);
  if (list.length === 0) return <div className="py-10 text-center text-sm text-gray-600">Nothing scheduled in this period.</div>;
  return (
    <div className="space-y-3">
      {list.map(({ date, entries }) => (
        <section key={date} className="rounded-lg border border-edge bg-panel">
          <h3 className={`flex items-center gap-2 border-b border-edge px-3 py-1.5 text-xs font-semibold ${date === today ? "text-blue-200" : "text-gray-300"}`}>
            {fmtDay(date, { weekday: "long", day: "numeric", month: "short" })}
            {date === today && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] uppercase text-white">Today</span>}
            {isWeekend(date) && <span className="text-[10px] font-normal text-gray-500">weekend</span>}
          </h3>
          <ul>
            {entries.filter((e) => isFull(e, date)).map((e) => {
              const row = byKey.get(e.key);
              if (!row) return null;
              const m = row.marks.get(date);
              const notes: string[] = [];
              if (e.continuing) notes.push("continuing");
              if (e.lastDay && e.kind !== "BOOKED") notes.push("last planned day");
              if (e.kind === "PLAN" && e.bar.tentative && !e.continuing) notes.push("start tentative");
              if (e.lastDay === false && e.bar.contEnd && row.span?.finishTbc) notes.push("finish TBC");
              return (
                <li key={e.key} className="border-b border-edge last:border-b-0">
                  <button type="button" onClick={() => onOpen(e.key, date)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-panel2">
                    <Swatch row={row} tentative={e.bar.tentative} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-100">
                        {row.name}
                        {row.jobNo && <span className="font-normal text-gray-500"> · {row.jobNo}</span>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-300">
                        {m ? (
                          <Marks m={m} wide />
                        ) : (
                          <span className="text-gray-500">{e.kind === "BOOKED" ? KIND_WORDS.BOOKED : e.continuing ? "Nothing on the board" : "Starts - nothing on the board yet"}</span>
                        )}
                        {e.kind === "OVER" && <span className="font-semibold text-amber-300">⚠ Past expected finish</span>}
                        {notes.length > 0 && <span className="text-gray-500">{notes.join(" · ")}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {(() => {
            // Planned and carrying on, nothing on the board that day: one line, so the list stays short.
            const quiet = entries.filter((e) => !isFull(e, date));
            if (quiet.length === 0) return null;
            return (
              <div className="border-t border-edge px-3 py-2 text-[11px] text-gray-500">
                <div className="mb-1">Also continuing, nothing on the board ({quiet.length}):</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {quiet.map((e) => {
                    const row = byKey.get(e.key);
                    if (!row) return null;
                    return (
                      <button key={e.key} type="button" onClick={() => onOpen(e.key, date)} className="flex min-w-0 max-w-full items-center gap-1 text-gray-300 hover:underline">
                        <Swatch row={row} tentative={e.bar.tentative} small />
                        <span className="truncate">{row.name}</span>
                        {row.span?.finishTbc && e.bar.contEnd && <span className="text-gray-500">(finish TBC)</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </section>
      ))}
    </div>
  );
}

// The legend: each mark drawn as it is on the tiles, then the projects on screen with their colours.
export function TileLegend({ rows }: { rows: TileRow[] }) {
  const demo: TileColour = { slot: 2, fill: TILE_PALETTE[2].fill, border: TILE_PALETTE[2].border };
  const chip = (style: CSSProperties, extra = "") => <span aria-hidden className={`inline-block h-3 w-7 rounded-[3px] ${extra}`} style={style} />;
  return (
    <div className="mb-3 space-y-1.5 text-[11px] text-gray-400">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">{chip({ background: tileBackground(demo), ...tileBorder(demo, false) })} planned / on the board</span>
        <span className="flex items-center gap-1.5">
          {chip({ background: `linear-gradient(rgb(255 255 255 / 0.35), rgb(255 255 255 / 0.35)), ${tileBackground(demo)}`, ...tileBorder(demo, true) })} start tentative
        </span>
        <span className="flex items-center gap-1.5">
          {chip({ background: tileBackground(demo), ...tileBorder(demo, false), maskImage: "linear-gradient(to right, black 30%, transparent)" })} finish TBC
        </span>
        <span className="flex items-center gap-1.5">
          {chip({ background: tileBackground(demo), borderWidth: 2, borderStyle: "solid", borderColor: AMBER })}
          <span className="rounded-sm bg-amber-400 px-1 font-semibold text-gray-950">⚠ past finish</span> past expected finish
        </span>
        <span>‹ › runs on past the view</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span><ShiftIcon shift="DAY" />2 day crew</span>
        <span><ShiftIcon shift="NIGHT" />3 night crew</span>
        <span><span className="rounded-sm bg-red-600 px-1 font-semibold text-white">No sup</span> no supervisor</span>
        <span><span className="rounded-sm bg-amber-400 px-1 font-semibold text-gray-950">No crew</span> gear but no crew</span>
        <span>Nothing allocated = no count</span>
        <span>Hover a day for the words · click for its details</span>
      </div>
      {rows.length > 0 && (
        // Phones: the agenda shows each project's swatch beside its name, so the key is left out there.
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge pt-1.5 sm:flex">
          <span className="font-semibold uppercase tracking-wide text-gray-500">Projects</span>
          {rows.map((r) => (
            <span key={r.key} className="flex min-w-0 items-center gap-1">
              <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-[3px]" style={{ background: tileBackground(r.colour), ...tileBorder(r.colour, false) }} />
              <span className="max-w-[16rem] truncate text-gray-300">{r.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
