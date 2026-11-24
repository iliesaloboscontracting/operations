// "Check my toolbox" as a tick list (Ilies, 25 Nov 2026: "what this should display is the list of tools
// 'belonging to Pol, Toolbox'" - he chose "List + tick each one"). The supervisor's link shows every active tool in
// their toolbox; each is marked Here or Missing, nothing pre-selected, and the check can only be sent once every tool
// is marked. The saved record is the same ToolboxCheck the photo check writes (lib/toolboxCheckRun.ts): present =
// Here, missing = Missing, no photos, `method: "TICK"` in the result JSON. Plain code, no AI. It changes no tool -
// "Mark missing" afterwards is the same action the photo check offers.
import type { CheckLine, CheckResult } from "./toolboxCheck";
import { assertNoMoney } from "./moneyGuard";

export type TickMark = "HERE" | "MISSING";
export type TickMarks = Record<string, TickMark>;
// What the tick list needs of a tool - the link reply already carries these (GET /api/site/:token).
export type TickTool = { id: string; tag: string; name: string; serialNumber?: string | null };
export type TickBox = { id: string; name: string; tools: TickTool[] };

export const TICK_MARKS: readonly TickMark[] = ["HERE", "MISSING"];
const MAX_MARKS = 500; // far more than any toolbox holds - a body bigger than this is refused unread

export const toolCount = (n: number) => `${n} tool${n === 1 ? "" : "s"}`;

// "Pol Heredia Maya's toolbox – 6 tools" - the toolbox's own name, then how many tools.
export const tickHeading = (box: { name: string; tools: unknown[] }) => `${box.name} – ${toolCount(box.tools.length)}`;

const isMark = (v: unknown): v is TickMark => v === "HERE" || v === "MISSING";

export const markedCount = (tools: TickTool[], marks: Partial<TickMarks>) => tools.filter((t) => isMark(marks[t.id])).length;

// "3 of 6 marked"
export const markedLabel = (tools: TickTool[], marks: Partial<TickMarks>) => `${markedCount(tools, marks)} of ${tools.length} marked`;

// "Check toolbox" stays off until every tool is marked (and there is at least one tool).
export const canSendTick = (tools: TickTool[], marks: Partial<TickMarks>) => tools.length > 0 && markedCount(tools, marks) === tools.length;

// "Mark all here": every row Here - any can then be flipped to Missing.
export const markAllHere = (tools: TickTool[]): TickMarks => Object.fromEntries(tools.map((t) => [t.id, "HERE" as const]));

// What the tick screen shows of a toolbox: its name, the heading and each tool's name and LOB tag. Nothing else.
export function tickListView(box: TickBox) {
  return {
    id: box.id,
    name: box.name,
    heading: tickHeading(box),
    tools: box.tools.map((t) => ({ id: t.id, tag: t.tag, name: t.name })),
  };
}

export const EMPTY_TOOLBOX = "No tools in your toolbox. Ask the office if that's wrong.";

// The server's check of what a phone sent: every key a tool of THIS toolbox (anything else refused), every value Here
// or Missing, every tool marked. Then the CheckResult in the photo check's own format.
export function buildTickResult(
  tools: TickTool[],
  marks: unknown
): { ok: true; result: CheckResult } | { ok: false; error: string } {
  if (!marks || typeof marks !== "object" || Array.isArray(marks)) return { ok: false, error: "Mark each tool Here or Missing." };
  const entries = Object.entries(marks as Record<string, unknown>);
  if (entries.length > MAX_MARKS) return { ok: false, error: "That's not your toolbox's list - go back and try again." };
  const byId = new Map(tools.map((t) => [t.id, t]));
  for (const [id, v] of entries) {
    if (!byId.has(id)) return { ok: false, error: "A tool on that list isn't in your toolbox - go back and try again." };
    if (!isMark(v)) return { ok: false, error: "Mark each tool Here or Missing." };
  }
  if (tools.length === 0) return { ok: false, error: EMPTY_TOOLBOX };
  const m = marks as TickMarks;
  const unmarked = tools.filter((t) => !isMark(m[t.id])).length;
  if (unmarked) return { ok: false, error: `Mark every tool first - ${unmarked} still to go.` };
  const line = (t: TickTool): CheckLine => ({ toolId: t.id, tag: t.tag, name: t.name, serialNumber: t.serialNumber ?? null, how: "tick" });
  return {
    ok: true,
    result: {
      present: tools.filter((t) => m[t.id] === "HERE").map(line),
      presentUnconfirmed: [],
      missing: tools.filter((t) => m[t.id] === "MISSING").map(line),
      foreign: [],
      unknown: [],
      notes: "",
      method: "TICK",
    },
  };
}

// What goes back to the phone after a tick check: the saved result with names and LOB tags only (the stored record keeps
// serial numbers for the office, like a photo check's).
export const tickReply = (r: CheckResult): CheckResult => {
  const strip = (l: CheckLine): CheckLine => ({ toolId: l.toolId, tag: l.tag, name: l.name, serialNumber: null, how: l.how });
  return { ...r, present: r.present.map(strip), presentUnconfirmed: r.presentUnconfirmed.map(strip), missing: r.missing.map(strip), foreign: r.foreign.map(strip) };
};

// No dollar figure in anything a link gets back.
export const linkSafe = (x: unknown) => assertNoMoney(JSON.stringify(x));
