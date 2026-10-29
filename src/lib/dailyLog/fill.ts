// "Fill my log from this" (29 Oct 2026, Ilies: "yes build the fill-everything version too") - the plain rules. A
// recording can suggest the whole log, not just the note and delays: hours by activity code, plant hours and the
// number of tip runs. Claude only ever picks codes from the list it's given and machines by their NUMBER in the job's
// plant list (never an id - the server maps the number back); plain code here keeps what's valid, compares it with the
// crew's signed hours, and says what doesn't add up in "Check this" - it never adjusts a number. The supervisor taps
// to fill, checks every step, and sends as usual. No server imports; `npm test` (fill.test.ts).
import { BY_CODE, CODES, isCode } from "../activityCodes";
import { LIMITS, splitFits } from "./rules";

export type FillActivity = { code: string; hours: number };
export type FillPlant = { index: number; code: string | null; hours: number };
export type Fill = { activity: FillActivity[]; plant: FillPlant[]; tipRuns: number | null };
export const NO_FILL: Fill = { activity: [], plant: [], tipRuns: null };
// What the server knows about this job's log (never from the phone).
export type FillContext = { codes: string[]; plantCount: number; signedHours: number; docketsSent: number };

// Activity hours are the crew's total on a code, as the log keeps them (parseLog: more than 0, up to 500, and the codes
// add up to the signed hours within 0.5 h). A machine's hours are 0-24.
export const ACTIVITY_MAX = 500;
export const PLANT_MAX = 24;
const quarter = (h: number) => Math.round(h * 4) / 4;
const hrs = (n: number) => `${quarter(n)} h`;

// The extra JSON Claude answers with (merged into the clean-up schema).
export const FILL_SCHEMA_PROPS = {
  activity: {
    type: "array",
    description: "Crew hours per activity code, only from what was said (or simple arithmetic from what was said and the signed hours given - then say the working in checkThis). Leave empty if hours weren't said.",
    items: {
      type: "object",
      properties: { code: { type: "string", enum: CODES.map((c) => c.code) }, hours: { type: "number", description: "Total crew hours on this code." } },
      required: ["code", "hours"], additionalProperties: false,
    },
  },
  plant: {
    type: "array",
    description: "Machine hours, only for machines in the numbered plant list and only from what was said. Use the machine's number from the list.",
    items: {
      type: "object",
      properties: {
        plant: { type: "integer", description: "The machine's number in the plant list." },
        code: { type: ["string", "null"], enum: [...CODES.map((c) => c.code), null], description: "The activity code the machine worked on, if said." },
        hours: { type: "number" },
      },
      required: ["plant", "code", "hours"], additionalProperties: false,
    },
  },
  tipRuns: { type: ["integer", "null"], description: "How many tip runs / loads to the tip were said. null if not said." },
} as const;

// Keep what's valid; say what doesn't add up. `noMoney` is the clean-up's own money check (labels carry no amounts,
// but every string that goes back is checked the same way).
export function validateFill(raw: Record<string, unknown>, ctx: FillContext | undefined, noMoney: (s: string) => string): { fill: Fill; checks: string[] } {
  if (!ctx) return { fill: NO_FILL, checks: [] };
  const allowed = new Set(ctx.codes.filter(isCode));
  const byCode = new Map<string, number>();
  for (const a of Array.isArray(raw.activity) ? raw.activity.slice(0, 30) : []) {
    const o = (a ?? {}) as Record<string, unknown>;
    const code = typeof o.code === "string" ? o.code : "";
    const h = typeof o.hours === "number" ? o.hours : NaN;
    if (!allowed.has(code) || !Number.isFinite(h) || h <= 0 || h > ACTIVITY_MAX) continue;
    byCode.set(code, quarter((byCode.get(code) ?? 0) + h));
  }
  const activity = [...byCode].slice(0, LIMITS.codes).filter(([, h]) => h <= ACTIVITY_MAX).map(([code, hours]) => ({ code, hours }));
  const seenPlant = new Set<number>();
  const plant: FillPlant[] = [];
  for (const p of Array.isArray(raw.plant) ? raw.plant.slice(0, 30) : []) {
    const o = (p ?? {}) as Record<string, unknown>;
    const index = typeof o.plant === "number" && Number.isInteger(o.plant) ? o.plant : NaN;
    const h = typeof o.hours === "number" ? o.hours : NaN;
    if (!(index >= 1 && index <= ctx.plantCount) || seenPlant.has(index) || !Number.isFinite(h) || h <= 0 || h > PLANT_MAX) continue;
    seenPlant.add(index);
    plant.push({ index, code: typeof o.code === "string" && allowed.has(o.code) ? o.code : null, hours: quarter(h) });
  }
  const tipRuns = typeof raw.tipRuns === "number" && Number.isInteger(raw.tipRuns) && raw.tipRuns >= 0 && raw.tipRuns <= 200 ? raw.tipRuns : null;

  const checks: string[] = [];
  const total = quarter(activity.reduce((s, a) => s + a.hours, 0));
  if (activity.length && !splitFits(total, ctx.signedHours)) {
    checks.push(activity.length === 1
      ? `You said ${hrs(total)} on ${BY_CODE[activity[0].code]?.name ?? activity[0].code}; the crew signed ${hrs(ctx.signedHours)}.`
      : `You said ${hrs(total)} in total; the crew signed ${hrs(ctx.signedHours)}.`);
  }
  if (tipRuns != null && tipRuns > ctx.docketsSent) {
    checks.push(`You said ${tipRuns} tip run${tipRuns === 1 ? "" : "s"} - ${ctx.docketsSent} docket${ctx.docketsSent === 1 ? "" : "s"} sent so far.`);
  }
  return { fill: { activity, plant, tipRuns }, checks: checks.map(noMoney) };
}

// ---------- filling the log on the phone ----------

export type LogRows = { code: string; hours: number }[];
export type PlantRows = { resourceId: string; code: string; hours: number }[];
export type Kept = { what: "code" | "plant"; key: string; label: string; yours: number; suggested: number; code?: string | null };
// Fill the log from a recording's suggestions. Anything already filled or typed stays as it is - typed entries always
// win; a suggestion for something already there comes back in `kept` for the supervisor to accept with a tap if they
// want it. A machine counts as already filled once it has a code, or its hours aren't the starting default any more
// (SEC-012: typed hours are never overwritten). `defaults`: each machine's starting hours on the screen.
export function mergeFill(
  current: { rows: LogRows; plant: PlantRows },
  fill: { activity: FillActivity[]; plant: { resourceId: string; name: string; code: string | null; hours: number }[] },
  labelOf: (code: string) => string,
  defaults: Map<string, number> = new Map(),
): { rows: LogRows; plant: PlantRows; added: string[]; kept: Kept[] } {
  const rows = current.rows.map((r) => ({ ...r }));
  const plant = current.plant.map((p) => ({ ...p }));
  const added: string[] = [], kept: Kept[] = [];
  for (const a of fill.activity) {
    const there = rows.find((r) => r.code === a.code);
    if (!there) { rows.push({ code: a.code, hours: a.hours }); added.push(`${labelOf(a.code)} ${hrs(a.hours)}`); }
    else if (there.hours !== a.hours) kept.push({ what: "code", key: a.code, label: labelOf(a.code), yours: there.hours, suggested: a.hours });
  }
  for (const s of fill.plant) {
    const there = plant.find((p) => p.resourceId === s.resourceId);
    if (!there) continue; // only machines on the board
    const untouched = !there.code && defaults.has(there.resourceId) && defaults.get(there.resourceId) === there.hours;
    if (untouched) { there.hours = s.hours; there.code = s.code ?? ""; added.push(`${s.name} ${hrs(s.hours)}`); }
    else if (there.hours !== s.hours || (s.code && s.code !== there.code)) kept.push({ what: "plant", key: s.resourceId, label: s.name, yours: there.hours, suggested: s.hours, code: s.code });
  }
  return { rows, plant, added, kept };
}

// Hold-ups from a recording (SEC-012): added straight in only when the supervisor hasn't ticked "no hold-ups" - if they
// have, nothing changes and the hold-ups are offered as taps instead. One of each kind (by code) at most.
export function mergeDelays<T extends { delayCode: string }>(noDelays: boolean, current: T[], suggested: T[]): { delays: T[]; added: T[]; offered: boolean } {
  const fresh = suggested.filter((d) => !current.some((x) => x.delayCode === d.delayCode));
  if (noDelays) return { delays: current, added: [], offered: fresh.length > 0 };
  return { delays: [...current, ...fresh], added: fresh, offered: false };
}
