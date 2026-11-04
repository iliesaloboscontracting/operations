// Yard Stage B - the stock take (Ilies, 4 Nov 2026: "Stage B: start on the stock take"). The yard becomes a place that
// can be counted: start a stock take, tick off each tool by hand or from shelf photos (the toolbox check's photo
// reading), say what condition it's in, then finish - anything not found is listed and a person confirms each one
// before it is marked Missing. New tools are still added with Register by photo.
// The plain rules: who's expected, which ticks are allowed, what a shelf photo does to the lines, and what finishing
// changes on the register. No database code (used in the browser and `npm test` - stockTake.test.ts), no dollar figure.
import type { CheckResult } from "../toolboxCheck";

export const LOCATIONS = ["YARD"] as const; // a toolbox (TOOLBOX + toolboxId) has room in the schema, not in the UI
export type Location = (typeof LOCATIONS)[number];
export const LOCATION_LABEL: Record<string, string> = { YARD: "the yard" };
export const STATUSES = ["OPEN", "FINISHED", "CANCELLED"] as const;
export type Status = (typeof STATUSES)[number];
export const RESULTS = ["UNCHECKED", "FOUND", "NOT_FOUND", "EXTRA"] as const;
export type Result = (typeof RESULTS)[number];
export const CONDITIONS_SEEN = ["Good", "Needs repair"] as const;
export const SCAN_LIMIT = 40; // shelf-photo readings per stock take (each is one Claude call - the toolbox check's)
export const MAX_SCAN_PHOTOS = 4;
export const NOTE_MAX = 500;

// The one-open-per-location key (StockTake.openKey is unique): the location while open, null once closed.
export const openKeyFor = (location: string) => location;
export const ALREADY_OPEN = "A stock take of the yard is already open - finish or cancel it first.";
export const NOT_OPEN = "This stock take is finished - it can only be looked at now.";

// ---------- who is expected at the start ----------
export type RegisterTool = { id: string; tag: string; name: string; serialNumber: string | null; condition: string; toolboxId: string | null };

// The yard = every tool with no home toolbox, except ones swapped out with Hilti (they've left the business).
// Tools already marked Missing ARE expected: if one turns up it's ticked and goes back to Good (or what was seen) -
// otherwise nobody would ever look for them again. Finishing doesn't re-mark a Missing tool that still isn't there.
export function expectedFor(location: string, tools: RegisterTool[]): RegisterTool[] {
  if (location !== "YARD") throw new Error("Only the yard can be counted for now.");
  return tools.filter((t) => t.toolboxId === null && t.condition !== "Swapped out").sort((a, b) => a.tag.localeCompare(b.tag));
}

// ---------- ticking ----------
export type LineState = {
  id: string; toolId: string | null; tag: string; expected: boolean; result: string; conditionSeen: string | null; via: string | null;
  movedAt?: Date | string | null;
};
export type LineAction =
  | { action: "FOUND"; conditionSeen?: string | null }
  | { action: "NOT_FOUND" }
  | { action: "UNTICK" }
  | { action: "CONDITION"; conditionSeen: string | null };
export type LinePatch = { result: Result; conditionSeen: string | null; via: "HAND" | "PHOTO" | null; checked: boolean };

const okCondition = (c: unknown): c is string | null | undefined => c == null || (CONDITIONS_SEEN as readonly unknown[]).includes(c);

// What one tap does to a line (by hand). An EXTRA (found here, the register says elsewhere) is found by being there -
// it can have a condition, or be dropped (store), never NOT_FOUND.
export function lineChange(line: LineState, act: LineAction): { patch: LinePatch } | { error: string } {
  const extra = line.result === "EXTRA";
  switch (act.action) {
    case "FOUND":
      if (extra) return { error: "It's already counted as found here." };
      if (!okCondition(act.conditionSeen)) return { error: "Condition is Good or Needs repair." };
      return { patch: { result: "FOUND", conditionSeen: act.conditionSeen ?? null, via: "HAND", checked: true } };
    case "NOT_FOUND":
      if (extra) return { error: "This one was found here - drop it instead if it was a mistake." };
      return { patch: { result: "NOT_FOUND", conditionSeen: null, via: "HAND", checked: true } };
    case "UNTICK":
      if (extra) return { error: "Drop it instead." };
      return { patch: { result: "UNCHECKED", conditionSeen: null, via: null, checked: false } };
    case "CONDITION":
      if (line.result !== "FOUND" && !extra) return { error: "Tick it as found first." };
      if (!okCondition(act.conditionSeen)) return { error: "Condition is Good or Needs repair." };
      return { patch: { result: line.result as Result, conditionSeen: act.conditionSeen ?? null, via: (line.via as "HAND" | "PHOTO" | null) ?? "HAND", checked: true } };
    default:
      return { error: "Unknown action." };
  }
}

// Adding a tool the register has somewhere else, found here (by hand or photo).
export function extraError(tool: RegisterTool | null, lines: LineState[]): string | null {
  if (!tool) return "That tool isn't on the register.";
  if (tool.condition === "Swapped out") return "That tool was swapped out with Hilti - register the one that's here.";
  if (lines.some((l) => l.toolId === tool.id)) return "That tool is already on this stock take.";
  return null;
}

// ---------- a shelf photo ----------
// compareToolbox(null, ...) - the toolbox check's plain matching with "the yard" as the box - says what the photos
// show. Identified by LOB tag or serial and expected here -> FOUND via PHOTO (unless a person already ticked it found
// - their tick stands; a "not here" by hand is overruled by the photo). Identified but the register has it in a
// toolbox -> a new EXTRA line ("register says in <toolbox>"). Brand + model only -> a suggestion to tick by hand,
// never ticked. Not on the register -> pointed at Register by photo. Lines are only ever added or ticked - a person
// can undo any of it.
export type ScanPlan = {
  tick: string[]; // line ids -> FOUND via PHOTO
  alreadyFound: string[]; // line ids already found
  extras: { toolId: string; tag: string; name: string; serialNumber: string | null; registerPlace: string | null }[];
  probably: { lineId: string; tag: string; name: string }[];
  unknown: CheckResult["unknown"];
  notes: string;
};
export function planScan(lines: LineState[], result: CheckResult): ScanPlan {
  const byTool = new Map(lines.filter((l) => l.toolId).map((l) => [l.toolId as string, l]));
  const plan: ScanPlan = { tick: [], alreadyFound: [], extras: [], probably: [], unknown: result.unknown, notes: result.notes };
  for (const p of result.present) {
    const l = byTool.get(p.toolId);
    if (!l) { plan.extras.push({ toolId: p.toolId, tag: p.tag, name: p.name, serialNumber: p.serialNumber, registerPlace: null }); continue; }
    if (l.result === "FOUND" || l.result === "EXTRA") plan.alreadyFound.push(l.id);
    else plan.tick.push(l.id);
  }
  for (const f of result.foreign) {
    const l = byTool.get(f.toolId);
    if (l) { if (l.result === "FOUND" || l.result === "EXTRA") plan.alreadyFound.push(l.id); else plan.tick.push(l.id); continue; }
    plan.extras.push({ toolId: f.toolId, tag: f.tag, name: f.name, serialNumber: f.serialNumber, registerPlace: f.belongsTo ?? null });
  }
  for (const u of result.presentUnconfirmed) {
    const l = byTool.get(u.toolId);
    if (l && l.result !== "FOUND" && l.result !== "EXTRA") plan.probably.push({ lineId: l.id, tag: u.tag, name: u.name });
  }
  return plan;
}

// ---------- the summary ----------
export type SummaryLine = { expected: boolean; result: string; conditionSeen: string | null; decision?: string | null };
export type Summary = { expected: number; checked: number; found: number; needsRepair: number; notFound: number; unchecked: number; extras: number; confirmedMissing: number; left: number };
export function summarise(lines: SummaryLine[]): Summary {
  const exp = lines.filter((l) => l.expected);
  return {
    expected: exp.length,
    checked: exp.filter((l) => l.result !== "UNCHECKED").length,
    found: exp.filter((l) => l.result === "FOUND").length,
    needsRepair: lines.filter((l) => (l.result === "FOUND" || l.result === "EXTRA") && l.conditionSeen === "Needs repair").length,
    notFound: exp.filter((l) => l.result === "NOT_FOUND").length,
    unchecked: exp.filter((l) => l.result === "UNCHECKED").length,
    extras: lines.filter((l) => l.result === "EXTRA").length,
    confirmedMissing: lines.filter((l) => l.decision === "MISSING").length,
    left: lines.filter((l) => l.decision === "LEAVE").length,
  };
}

// The tools a person must decide on before finishing: expected here and not found (ticked "not here" or never checked).
export const isMissingCandidate = (l: { expected: boolean; result: string }) => l.expected && (l.result === "NOT_FOUND" || l.result === "UNCHECKED");

// ---------- finishing ----------
// For each line, what finishing does to the register - through the ordinary tool update (lib/toolUpdate.ts), so the
// same rules as the toolbox check's "Mark missing" and the tool form apply. `current` is the tool as it is now
// (null = deleted since). Every not-found tool needs a decision: MISSING (confirmed - "Confirm all" fills these) or
// LEAVE (left as the register has it). Nothing is marked Missing without one.
export type FinishLine = LineState & { decision?: string | null; appliedAt?: Date | string | null };
export type CurrentTool = { condition: string; toolboxId: string | null } | null;
export type FinishStep = { lineId: string; decision: "MISSING" | "LEAVE" | null; condition: string | null; change: string | null; note: string | null };
export type Decisions = { missing: string[]; leave: string[] };

export function planFinish(lines: FinishLine[], current: Map<string, CurrentTool>, d: Decisions): { steps: FinishStep[] } | { error: string; undecided: string[] } {
  const candidates = lines.filter(isMissingCandidate);
  const ids = new Set(candidates.map((l) => l.id));
  const missing = new Set(d.missing), leave = new Set(d.leave);
  const both = [...missing].filter((x) => leave.has(x));
  if (both.length) return { error: "A tool can't be both missing and left as it is.", undecided: both };
  const stray = [...missing, ...leave].filter((x) => !ids.has(x));
  if (stray.length) return { error: "Only tools that weren't found can be marked missing or left.", undecided: stray };
  const undecided = candidates.filter((l) => !missing.has(l.id) && !leave.has(l.id)).map((l) => l.id);
  if (undecided.length) return { error: `${undecided.length} tool${undecided.length === 1 ? " wasn't" : "s weren't"} found - confirm each as missing, or leave it as it is, before finishing.`, undecided };

  const steps: FinishStep[] = [];
  for (const l of lines) {
    const decision = missing.has(l.id) ? "MISSING" : leave.has(l.id) ? "LEAVE" : null;
    const step: FinishStep = { lineId: l.id, decision, condition: null, change: null, note: null };
    steps.push(step);
    if (l.appliedAt) { step.note = "Already applied"; continue; }
    const now = l.toolId ? current.get(l.toolId) ?? null : null;
    if (!now) { if (decision || l.result === "FOUND" || l.result === "EXTRA") step.note = "No longer on the register"; continue; }
    if (l.result === "FOUND" || l.result === "EXTRA") {
      const target = l.conditionSeen ?? (now.condition === "Missing" ? "Good" : null);
      if (target && target !== now.condition) { step.condition = target; step.change = `Condition ${now.condition} -> ${target}`; }
    } else if (decision === "MISSING") {
      if (now.toolboxId !== null) step.note = "Moved to a toolbox since the start - not marked missing";
      else if (now.condition !== "Missing") { step.condition = "Missing"; step.change = `Condition ${now.condition} -> Missing`; }
      else step.note = "Already missing";
    }
  }
  return { steps };
}

// The note on a stock take: plain text, short. (The coordinator / yard's own amount rules are applied in the store.)
export function noteError(note: unknown): string | null {
  if (note == null || note === "") return null;
  if (typeof note !== "string") return "The note must be text.";
  if (note.length > NOTE_MAX) return `Keep the note under ${NOTE_MAX} characters.`;
  return null;
}
