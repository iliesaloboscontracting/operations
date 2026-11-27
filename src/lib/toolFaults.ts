// Reporting a tool fault from a supervisor's link with ANY Lobos tool (Ilies, 27 Nov 2026 - "Any tool, plus 'not in
// the list'": "Their toolbox first, then every other Lobos tool, plus 'Not in the list' with a photo; the photo
// reader suggests the tool and the office confirms. Shows the empty-toolbox gap to the office too.").
// Background: Omar couldn't report a damaged Hilti rattle gun - his two toolboxes had no tools on the register, and the
// picker only listed a supervisor's own toolboxes.
//
// Plain rules only - no database, no AI - so `npm test` covers them (toolFaults.test.ts):
//   - what the phone's picker lists for other people's tools (tag + name only: no serial, notes or holder);
//   - what a FAULT submit is about (a tool id, or "Not in the list", which needs a photo);
//   - cleaning what the photo reader saw (untrusted text: plain strings, capped, never instructions);
//   - suggesting likely tools to the office from that reading (tag, then serial, then brand + model, then the name),
//     the same plain-code matching as the toolbox check (lib/toolboxCheck.ts). Nothing is ever assigned
//     automatically - a person in the office picks the tool.
import { normSerial, normTag } from "./toolboxCheck";
import { assertNoMoney } from "./moneyGuard";

// The picker's "Not in the list" choice (the phone sends this instead of a tool id).
export const UNLISTED = "UNLISTED";
export const NOT_IN_A_TOOLBOX = "Not in a toolbox";

// Photo reading for "Not in the list" faults: the existing Claude tool-photo reader, one photo per fault, capped so a
// leaked link can't run it up. Kill switch TOOL_FAULT_READING=off (the fault is still sent - only the reading stops).
export const FAULT_READ_LINK_DAILY_LIMIT = 10; // per link, per Sydney day
export const FAULT_READ_DAILY_LIMIT = 60; // every link together, per Sydney day
export const faultReadingOn = (v: string | undefined = process.env.TOOL_FAULT_READING) => (v ?? "").trim().toLowerCase() !== "off";
export const faultReadLimitReached = (linkToday: number, allToday: number) =>
  linkToday >= FAULT_READ_LINK_DAILY_LIMIT || allToday >= FAULT_READ_DAILY_LIMIT;

// ---- The phone's picker -------------------------------------------------------------------------------------------

export type PickerTool = { id: string; tag: string; name: string };
export type PickerGroup = { name: string; tools: PickerTool[] };
type RegisterTool = { id: string; tag: string; name: string; toolboxId: string | null; toolboxName: string | null; toolboxActive?: boolean };

// Every other Lobos tool, grouped by the toolbox it lives in (A-Z), then "Not in a toolbox" (the yard / unassigned, or
// a switched-off toolbox) last. The link's own toolboxes are left out - they're listed first, as before. Only the tag
// and name go to the phone.
export function pickerGroups(tools: RegisterTool[], ownBoxIds: Iterable<string>): PickerGroup[] {
  const own = new Set(ownBoxIds);
  const groups = new Map<string, PickerTool[]>();
  for (const t of tools) {
    if (t.toolboxId && own.has(t.toolboxId)) continue;
    const name = t.toolboxId && t.toolboxName && t.toolboxActive !== false ? t.toolboxName : NOT_IN_A_TOOLBOX;
    const list = groups.get(name) ?? [];
    list.push({ id: t.id, tag: t.tag, name: t.name });
    groups.set(name, list);
  }
  const byTag = (a: PickerTool, b: PickerTool) => a.tag.localeCompare(b.tag, "en", { numeric: true });
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a === NOT_IN_A_TOOLBOX ? 1 : b === NOT_IN_A_TOOLBOX ? -1 : a.localeCompare(b)))
    .map(([name, list]) => ({ name, tools: list.sort(byTag) }));
}

// The phone's search box: tag or name, any case; "lob 12" finds LOB-0012. Empty search = everything.
export function matchesSearch(t: { tag: string; name: string }, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const tag = normTag(s);
  if (tag && normTag(t.tag) === tag) return true;
  return s.split(/\s+/).every((w) => t.tag.toLowerCase().includes(w) || t.name.toLowerCase().includes(w));
}

export function filterGroups<G extends { tools: { tag: string; name: string }[] }>(groups: G[], q: string): G[] {
  return groups.map((g) => ({ ...g, tools: g.tools.filter((t) => matchesSearch(t, q)) })).filter((g) => g.tools.length > 0);
}

// The picker reply must never carry a dollar figure (tool names are typed by people).
export const linkSafe = (x: unknown) => assertNoMoney(JSON.stringify(x));

// ---- What a FAULT submit is about ---------------------------------------------------------------------------------

export type FaultTarget = { kind: "TOOL"; toolId: string } | { kind: "UNLISTED" } | { kind: "ERROR"; error: string };

export function faultTarget(body: { toolId?: unknown; photoId?: unknown }): FaultTarget {
  if (body.toolId === UNLISTED) {
    if (typeof body.photoId !== "string" || !body.photoId) return { kind: "ERROR", error: "Take a photo of the tool - the office uses it to find it." };
    return { kind: "UNLISTED" };
  }
  if (typeof body.toolId === "string" && body.toolId && body.toolId.length <= 64) return { kind: "TOOL", toolId: body.toolId };
  return { kind: "ERROR", error: "Pick the tool, or 'Not in the list'." };
}

// A tool a fault may be reported on: on the register (not retired, not swapped out). Missing / Needs repair are fine -
// a missing tool can turn up broken.
export const reportable = (t: { retiredAt: Date | null; condition: string } | null | undefined) =>
  !!t && t.retiredAt === null && t.condition !== "Swapped out";

// ---- What the photo reader saw ------------------------------------------------------------------------------------

export type FaultPhotoSeen = { toolType: string; brand: string; model: string; lobTag: string; serialNumber: string; damage: string };

// Stored on the SiteSubmission's `reading` (JSON) for a "Not in the list" fault. `unlisted` stays true after the office
// links the tool, so the day's reading count holds.
export type UnlistedReading = {
  unlisted: true;
  status: "WAITING" | "READ" | "NOT_READ";
  reason?: string; // NOT_READ: why, in plain words
  seen?: FaultPhotoSeen;
};

const FIELD_CAP: Record<keyof FaultPhotoSeen, number> = { toolType: 120, brand: 60, model: 80, lobTag: 20, serialNumber: 60, damage: 300 };

// The reading is untrusted text (whatever was printed or written on the tool): plain one-line strings, control
// characters dropped, capped, and any dollar figure removed. It's shown to the office as data, never acted on.
export function cleanSeen(raw: unknown): FaultPhotoSeen {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as FaultPhotoSeen;
  for (const k of Object.keys(FIELD_CAP) as (keyof FaultPhotoSeen)[]) {
    const v = typeof r[k] === "string" ? (r[k] as string) : "";
    out[k] = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\$\s?[\d.,]+/g, "").replace(/\s+/g, " ").trim().slice(0, FIELD_CAP[k]);
  }
  out.lobTag = normTag(out.lobTag) || "";
  return out;
}

export function parseUnlisted(reading: string | null | undefined): UnlistedReading | null {
  if (!reading) return null;
  try {
    const r = JSON.parse(reading);
    if (!r || r.unlisted !== true) return null;
    const status = r.status === "READ" || r.status === "NOT_READ" ? r.status : "WAITING";
    return { unlisted: true, status, ...(typeof r.reason === "string" ? { reason: r.reason.slice(0, 200) } : {}), ...(r.seen ? { seen: cleanSeen(r.seen) } : {}) };
  } catch {
    return null;
  }
}

// ---- Suggesting the tool to the office ----------------------------------------------------------------------------

export type MatchTool = { id: string; tag: string; name: string; brand: string | null; model: string | null; serialNumber: string | null; toolboxName: string | null };
export type Suggestion = { toolId: string; tag: string; name: string; toolboxName: string | null; how: "tag" | "serial" | "model" | "name" };

const normText = (s: string | null | undefined) => (s ?? "").replace(/[\s\-]/g, "").toUpperCase();
// Words too common to say anything about which tool it is.
const COMMON = new Set(["tool", "tools", "cordless", "corded", "electric", "power", "battery", "with", "hilti", "makita", "milwaukee", "dewalt", "bosch"]);
const words = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !COMMON.has(w));

// Likely tools for a "Not in the list" photo, best first, at most `max`:
//   1. its LOB tag read off the sticker - exact;
//   2. its serial number - exact;
//   3. the same model (and brand, when both are known);
//   4. a word of what it is in the tool's name (e.g. "impact" for "Impact wrench").
// A suggestion only - the office confirms or picks another.
export function suggestMatches(seen: FaultPhotoSeen | null | undefined, tools: MatchTool[], max = 5): Suggestion[] {
  if (!seen) return [];
  const out: Suggestion[] = [];
  const taken = new Set<string>();
  const add = (t: MatchTool, how: Suggestion["how"]) => {
    if (taken.has(t.id) || out.length >= max) return;
    taken.add(t.id);
    out.push({ toolId: t.id, tag: t.tag, name: t.name, toolboxName: t.toolboxName, how });
  };
  const tag = normTag(seen.lobTag);
  if (tag) for (const t of tools) if (normTag(t.tag) === tag) add(t, "tag");
  const serial = normSerial(seen.serialNumber);
  if (serial) for (const t of tools) if (normSerial(t.serialNumber) === serial) add(t, "serial");
  const m = normText(seen.model);
  const b = normText(seen.brand);
  if (m) for (const t of tools) if (normText(t.model).includes(m) && (!b || !t.brand || normText(t.brand) === b)) add(t, "model");
  const w = new Set(words(seen.toolType));
  if (w.size) for (const t of tools) if (words(t.name).some((x) => w.has(x))) add(t, "name");
  return out;
}

export const HOW_LABEL: Record<Suggestion["how"], string> = {
  tag: "LOB tag matches",
  serial: "serial number matches",
  model: "same model",
  name: "similar name",
};

// ---- The empty-toolbox gap (office, information only) -------------------------------------------------------------

// Active supervisors with no tools in any toolbox: they can still report a fault (any tool, or "Not in the list"), but
// their own list is empty, so the office can see whose toolbox needs its tools put on the register. A supervisor here =
// an active person with a live SUPERVISOR link or an active toolbox in their name.
export type GapPerson = { id: string; name: string; hasLink: boolean; toolboxes: { name: string; tools: number }[] };
export type GapRow = { id: string; name: string; toolboxes: number; hasLink: boolean };

export function emptyToolboxGap(people: GapPerson[]): GapRow[] {
  return people
    .filter((p) => p.hasLink || p.toolboxes.length > 0)
    .filter((p) => p.toolboxes.every((b) => b.tools === 0))
    .map((p) => ({ id: p.id, name: p.name, toolboxes: p.toolboxes.length, hasLink: p.hasLink }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const gapLine = (r: GapRow) =>
  r.toolboxes === 0 ? `${r.name} - no toolbox` : `${r.name} - ${r.toolboxes} toolbox${r.toolboxes === 1 ? "" : "es"}, no tools`;
