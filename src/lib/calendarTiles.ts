// Calendar tiles (Ilies, 12 Nov 2026: "instead of tiles and lines. lets just use tiles. where the works stretch through
// days lets make it one continuous tile" - a Keep&Share-style month calendar). Pure layout maths for /calendar, no
// server imports, so `npm test` (calendarTiles.test.ts) checks exactly what the page draws:
//
//  - bars:    each project becomes ONE continuous bar per run of days - its planned span (lib/calendarSpans.ts: start ->
//             expected finish, or to the edge of the view when the finish is TBC, carried on when past the finish) joined
//             with the days it is on the board. Booked days outside the plan (a project with no dates, like the Yard, or
//             jobs after the finish) are bar days too; back-to-back booked days join into one bar, and a weekend between
//             two booked days is bridged so a Monday-to-Friday job reads as one tile.
//  - rows:    the month grid's week rows (Monday to Sunday - Lobos weeks start Monday);
//  - lanes:   bars stack in lanes. Lanes are given once for the whole view (by start date, a project keeps its previous
//             lane when it is free), then compacted per week row, so a bar keeps its place across the weeks it crosses;
//  - marks:   what the board has on each day (day / night crew counts, no supervisor, gear but no crew, not running),
//             with words, never colour alone;
//  - colours: one stable pastel per project, keyed by project id (never by rank or by what is on screen);
//  - agenda:  the phone list - each day, the projects running, "continuing" when the bar started earlier.
// No money: project keys, dates and crew / plant / hire counts only.
import { addDays, daysBetween, isWeekend, startOfWeek } from "./dates";
import type { CalendarSpanDTO } from "./calendarSpans";

// PLAN = inside the planned span. OVER = past the expected finish (the span's carry-on). BOOKED = on the board outside
// the planned span. GAP = a weekend bridged between two booked / planned days.
export type DayKind = "PLAN" | "OVER" | "BOOKED" | "GAP";

export type SpanForBars = Pick<CalendarSpanDTO, "from" | "to" | "finish" | "finishTbc" | "tentative" | "clippedStart" | "clippedEnd">;

export interface Bar {
  id: string; // `${key}|${from}` - unique in a view
  key: string; // the calendar row key (project id, or `t:<title>` for a job with no project)
  from: string;
  to: string;
  kinds: DayKind[]; // one per day, from .. to
  contStart: boolean; // the planned span carries on before the view
  contEnd: boolean; // ... and after it (a TBC finish always does)
  fadeEnd: boolean; // finish TBC: the bar fades out at its end
  tentative: boolean; // start tentative: the planned days are drawn dashed and lighter
}

const isoRe = /^\d{4}-\d{2}-\d{2}$/;

// The bars of one project inside [from, to].
export function buildBars(key: string, span: SpanForBars | undefined, bookedDays: Iterable<string>, from: string, to: string): Bar[] {
  const kind = new Map<string, DayKind>();
  if (span) {
    const a = span.from < from ? from : span.from;
    const b = span.to > to ? to : span.to;
    for (let d = a; d <= b; d = addDays(d, 1)) kind.set(d, span.finish && d > span.finish ? "OVER" : "PLAN");
  }
  for (const d of bookedDays) if (isoRe.test(d) && d >= from && d <= to && !kind.has(d)) kind.set(d, "BOOKED");
  const dates = [...kind.keys()].sort();
  if (dates.length === 0) return [];

  // Runs of consecutive days; a gap made only of weekend days (Sat / Sun) is bridged.
  const runs: { from: string; to: string }[] = [];
  for (const d of dates) {
    const last = runs[runs.length - 1];
    if (last) {
      const gap = daysBetween(last.to, d) - 1;
      let bridge = gap === 0;
      if (gap > 0 && gap <= 2) {
        bridge = true;
        for (let g = addDays(last.to, 1); g < d; g = addDays(g, 1)) if (!isWeekend(g)) bridge = false;
        if (bridge) for (let g = addDays(last.to, 1); g < d; g = addDays(g, 1)) kind.set(g, "GAP");
      }
      if (bridge) {
        last.to = d;
        continue;
      }
    }
    runs.push({ from: d, to: d });
  }
  return runs.map((r) => {
    const kinds: DayKind[] = [];
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) kinds.push(kind.get(d)!);
    const contStart = !!span && span.clippedStart && r.from === from && kinds[0] !== "BOOKED";
    const contEnd = !!span && span.clippedEnd && r.to === to && kinds[kinds.length - 1] !== "BOOKED";
    return {
      id: `${key}|${r.from}`,
      key,
      from: r.from,
      to: r.to,
      kinds,
      contStart,
      contEnd,
      fadeEnd: contEnd && !!span?.finishTbc,
      tentative: !!span?.tentative,
    };
  });
}

// Lanes for the whole view: bars by start date (then the given project order); each takes its project's previous lane
// when that is free, else the lowest free lane. Bars in one lane never overlap.
export function assignLanes(bars: Bar[], order: string[] = []): Map<string, number> {
  const rank = new Map(order.map((k, i) => [k, i]));
  const r = (k: string) => rank.get(k) ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...bars].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : r(a.key) - r(b.key) || a.key.localeCompare(b.key)));
  const laneEnd: string[] = []; // last day used in each lane
  const lastLane = new Map<string, number>();
  const out = new Map<string, number>();
  const free = (l: number, from: string) => laneEnd[l] === undefined || laneEnd[l] < from;
  for (const b of sorted) {
    const prev = lastLane.get(b.key);
    let lane = prev !== undefined && free(prev, b.from) ? prev : -1;
    if (lane < 0) for (lane = 0; !free(lane, b.from); lane++);
    laneEnd[lane] = b.to;
    lastLane.set(b.key, lane);
    out.set(b.id, lane);
  }
  return out;
}

// The month grid's week rows, Monday to Sunday, covering [from, to].
export function weekRows(from: string, to: string): string[][] {
  const rows: string[][] = [];
  for (let s = startOfWeek(from); s <= to; s = addDays(s, 7)) rows.push(Array.from({ length: 7 }, (_, i) => addDays(s, i)));
  return rows;
}

export interface Segment {
  bar: Bar;
  from: string;
  to: string;
  col: number; // first column inside the row (0-based)
  span: number; // columns covered
  lane: number; // lane inside the row, compacted (0-based)
  contLeft: boolean; // the bar carries on before this segment (an earlier row, or before the view): arrow / no left cap
  contRight: boolean; // ... and after it
  startsHere: boolean; // the bar's own first day is in this segment (else the label is a repeat)
}

export interface RowLayout {
  days: string[];
  segments: Segment[];
  lanes: number;
}

// Cut the bars into each row (a week, or the whole range for a timeline) and stack them: the whole-view lanes,
// compacted per row so no row carries an empty lane.
export function layoutRows(bars: Bar[], rows: string[][], order: string[] = []): RowLayout[] {
  const lanes = assignLanes(bars, order);
  return rows.map((days) => {
    const a = days[0];
    const z = days[days.length - 1];
    const segs: Segment[] = [];
    for (const bar of bars) {
      if (bar.to < a || bar.from > z) continue;
      const from = bar.from < a ? a : bar.from;
      const to = bar.to > z ? z : bar.to;
      segs.push({
        bar,
        from,
        to,
        col: daysBetween(a, from),
        span: daysBetween(from, to) + 1,
        lane: lanes.get(bar.id) ?? 0,
        contLeft: from > bar.from || bar.contStart,
        contRight: to < bar.to || bar.contEnd,
        startsHere: from === bar.from,
      });
    }
    const used = [...new Set(segs.map((s) => s.lane))].sort((x, y) => x - y);
    const compact = new Map(used.map((l, i) => [l, i]));
    for (const s of segs) s.lane = compact.get(s.lane)!;
    segs.sort((x, y) => x.lane - y.lane || x.col - y.col);
    return { days, segments: segs, lanes: used.length };
  });
}

// What the board has for a project on a day. Only jobs with something allocated count (the calendar's long-standing
// rule: nothing allocated = nothing shown).
export interface MarkJob {
  date: string;
  shift: "DAY" | "NIGHT" | string;
  crew: number;
  plant: number;
  hire: number;
  hasSupervisor: boolean;
  notRunning: boolean;
}

export interface ShiftMark {
  crew: number;
  plant: number;
  hire: number;
  noCrew: boolean; // gear allocated, nobody on it (amber)
  noSupervisor: boolean; // crew but no supervisor (red)
}

export interface DayMark {
  day: ShiftMark | null;
  night: ShiftMark | null;
  notRunning: boolean; // only not-running jobs that day
  booked: boolean; // a running job with something allocated
  warn: "NO_CREW" | "NO_SUPERVISOR" | null; // the worst warning that day (red beats amber)
  words: string; // "Day 2 crew, 1 plant · Night 3 crew - no supervisor"
}

export function dayMarks(jobs: MarkJob[]): Map<string, DayMark> {
  const byDay = new Map<string, MarkJob[]>();
  for (const j of jobs) {
    if (j.crew + j.plant + j.hire <= 0) continue;
    if (!byDay.has(j.date)) byDay.set(j.date, []);
    byDay.get(j.date)!.push(j);
  }
  const out = new Map<string, DayMark>();
  for (const [date, list] of byDay) {
    const running = list.filter((j) => !j.notRunning);
    const shift = (s: string): ShiftMark | null => {
      const js = running.filter((j) => (s === "NIGHT" ? j.shift === "NIGHT" : j.shift !== "NIGHT"));
      if (js.length === 0) return null;
      const m = { crew: 0, plant: 0, hire: 0, noCrew: false, noSupervisor: false };
      for (const j of js) {
        m.crew += j.crew;
        m.plant += j.plant;
        m.hire += j.hire;
        if (j.crew === 0) m.noCrew = true;
        else if (!j.hasSupervisor) m.noSupervisor = true;
      }
      return m;
    };
    const day = shift("DAY");
    const night = shift("NIGHT");
    const noSup = !!(day?.noSupervisor || night?.noSupervisor);
    const noCrew = !!(day?.noCrew || night?.noCrew);
    out.set(date, {
      day,
      night,
      notRunning: running.length === 0,
      booked: running.length > 0,
      warn: noSup ? "NO_SUPERVISOR" : noCrew ? "NO_CREW" : null,
      words: markWords(day, night, running.length === 0),
    });
  }
  return out;
}

function shiftWords(label: string, m: ShiftMark) {
  const bits = [m.crew > 0 ? `${m.crew} crew` : "no crew"];
  if (m.plant > 0) bits.push(`${m.plant} plant`);
  if (m.hire > 0) bits.push(`${m.hire} hire`);
  const warn = m.noSupervisor ? " - no supervisor" : m.noCrew ? " - gear but no crew" : "";
  return `${label} ${bits.join(", ")}${warn}`;
}

function markWords(day: ShiftMark | null, night: ShiftMark | null, notRunning: boolean) {
  if (notRunning) return "Not running";
  return [day && shiftWords("Day", day), night && shiftWords("Night", night)].filter(Boolean).join(" · ");
}

// One pastel per project (Ilies, 12 Nov 2026: "lets remove the striped lighten the colour inside the bar and darken the
// boarder line" - Keep&Share-style pastel bars, a darker outline in the same hue, near-black text). Twelve hues in a
// fixed order, red / rose / amber / orange / yellow left out so they stay the warnings' colours. Fill = Tailwind 200-400
// (the shade per hue chosen to keep the twelve as far apart as possible for normal vision), border = the same hue's 800.
// Checked with the dataviz validate_palette.js (12 Nov 2026): adjacent slots PASS CVD (worst 10.0) and the
// normal-vision floor (worst 16.7). All-pairs cannot hold at twelve hues (worst normal 8.0, sky / blue; CVD fails) -
// every bar carries its name, so identity is never colour alone. Near-black text (#030712) on every fill >= 6.7:1.
// The fills sit outside the palette's mark lightness band on purpose: they are backgrounds under dark text, not thin
// marks. Past twelve projects: a labelled neutral (stone).
export const TILE_PALETTE = [
  { name: "teal", fill: "#2dd4bf", border: "#115e59" },
  { name: "purple", fill: "#c084fc", border: "#6b21a8" },
  { name: "blue", fill: "#93c5fd", border: "#1e40af" },
  { name: "pink", fill: "#f472b6", border: "#9d174d" },
  { name: "emerald", fill: "#a7f3d0", border: "#065f46" },
  { name: "sky", fill: "#38bdf8", border: "#075985" },
  { name: "violet", fill: "#ddd6fe", border: "#5b21b6" },
  { name: "lime", fill: "#d9f99d", border: "#3f6212" },
  { name: "cyan", fill: "#67e8f9", border: "#155e75" },
  { name: "indigo", fill: "#818cf8", border: "#3730a3" },
  { name: "fuchsia", fill: "#f0abfc", border: "#86198f" },
  { name: "green", fill: "#4ade80", border: "#166534" },
] as const;
export const TILE_SLOTS = TILE_PALETTE.length;
export const TILE_TEXT = "#030712"; // near-black, on every fill

export interface TileColour {
  slot: number | null; // null = neutral (more projects than slots)
  fill: string;
  border: string;
}
export const NEUTRAL_TILE: TileColour = { slot: null, fill: "#e7e5e4", border: "#57534e" };

// FNV-1a, so a project's preferred slot depends on its id alone.
export function hashKey(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// `tiers` = the projects on the calendar around today (the page passes the planned spans from a month back to four
// months ahead - active first, then inactive), fetched for that fixed window, so a filter or a different month never
// repaints a project. Each tier is taken in id order (ids grow with time, so an older project keeps its slot when a new
// one arrives): each takes its hashed slot, or the next free one; past the slot count, neutral. `extra` keys (on
// screen but not in the tiers - a project with no dates like the Yard, a job with no project) go last.
export function assignColours(tiers: string[][], extra: string[] = []): Map<string, TileColour> {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const group of [...tiers, extra])
    for (const id of [...new Set(group)].sort())
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
  const taken = new Set<number>();
  const out = new Map<string, TileColour>();
  for (const id of ordered) {
    let slot: number | null = null;
    const start = hashKey(id) % TILE_SLOTS;
    for (let i = 0; i < TILE_SLOTS; i++) {
      const s = (start + i) % TILE_SLOTS;
      if (!taken.has(s)) {
        slot = s;
        break;
      }
    }
    if (slot === null) out.set(id, NEUTRAL_TILE);
    else {
      taken.add(slot);
      out.set(id, { slot, fill: TILE_PALETTE[slot].fill, border: TILE_PALETTE[slot].border });
    }
  }
  return out;
}

// The phone agenda: each day, the bars running that day (not a bridged weekend), in the given project order.
export interface AgendaEntry {
  key: string;
  bar: Bar;
  kind: DayKind;
  continuing: boolean; // started on an earlier day (or before the view)
  lastDay: boolean; // the bar's last day (and it doesn't run on past the view)
}

export function agenda(bars: Bar[], days: string[], order: string[] = []): { date: string; entries: AgendaEntry[] }[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  const r = (k: string) => rank.get(k) ?? Number.MAX_SAFE_INTEGER;
  return days.map((date) => {
    const entries: AgendaEntry[] = [];
    for (const bar of bars) {
      if (date < bar.from || date > bar.to) continue;
      const kind = bar.kinds[daysBetween(bar.from, date)];
      if (kind === "GAP") continue; // a bridged weekend isn't a working day on the list
      entries.push({
        key: bar.key,
        bar,
        kind,
        continuing: date > bar.from || bar.contStart,
        lastDay: date === bar.to && !bar.contEnd,
      });
    }
    entries.sort((a, b) => r(a.key) - r(b.key) || a.key.localeCompare(b.key));
    return { date, entries };
  });
}
