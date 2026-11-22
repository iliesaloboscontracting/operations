// Full-time crew (Ilies, 22 Nov 2026: "all full times have a orange box. this allows me to easily identify who to
// prioritize when we dont have works"). Resource.fullTime is a tick on the Labour register, set by a Manager or an
// Admin. It isn't a pay field and isn't money, so it shows wherever the board shows people (never on a site link).
// It only changes how a person's tile looks - no sign-in, cost, pay, timesheet or allocation rule reads it.
// Plain, no server imports; `npm test` (fullTime.test.ts).
//
// The colours. On the board, orange already means owned plant (its own column, a dark orange-950 tint) and amber
// means a warning (the conflict ring, day-limit full, fault HIGH, hire due soon, the "sheet went out" banner) - always
// a ring, a small tag or text, never a whole crew tile. A full-timer's tile is a bright orange-500 fill with a solid
// orange-500 border and an "FT" mark, in the Crew column only, so it can't be read as either. Text contrast on the
// dark board (WCAG AA): orange-100 on the orange-500/25 tile ~10:1, black on the solid orange-500 lead tile ~7:1. The\n// build-time light theme (tailwind.config.ts LIGHT) flips orange-100 to orange-900 on a light orange tint; orange-500\n// and black aren't flipped, so the lead tile reads the same in both.
import type { BoardColumn } from "./types";

export const FULL_TIME_LABEL = "Full-time";
export const FULL_TIME_MARK = "FT";

type Person = { type?: string | null; category?: string | null; fullTime?: boolean | null };

// Only Labour-register people are full-time (a hire worker never is, whatever the column says).
export function isFullTime(r: Person): boolean {
  return r.type === "PERSONNEL" && r.fullTime === true;
}

// What a body's fullTime says: true / false, or null when it isn't a yes or a no.
export function fullTimeValue(v: unknown): boolean | null {
  if (v === true || v === "true") return true;
  if (v === false || v === "false" || v === "" || v == null) return false;
  return null;
}

// Why a write's fullTime is refused (null = fine). `type` is the record's type after the write.
export function fullTimeInputError(v: unknown, type: string | null | undefined): string | null {
  const next = fullTimeValue(v);
  if (next === null) return "Full-time is a yes or a no.";
  if (next && type !== "PERSONNEL") return "Full-time is for people on the Labour register only.";
  return null;
}

// A job's assigned chip (AssignedChip).
export type ChipKind = "labourHire" | "fullTimeLead" | "fullTime" | "lead" | "plant" | "hire" | "crew";
export function chipKind(r: Person, o: { column: BoardColumn; supervisorLike: boolean; labourHire: boolean }): ChipKind {
  if (o.labourHire) return "labourHire";
  if (o.column === "crew" && isFullTime(r)) return o.supervisorLike ? "fullTimeLead" : "fullTime";
  if (o.supervisorLike) return "lead";
  if (o.column === "plant") return "plant";
  if (o.column === "hire") return "hire";
  return "crew";
}
// Written out in full so Tailwind finds every class.
export const CHIP_TONE: Record<ChipKind, string> = {
  labourHire: "border border-yellow-400 bg-yellow-400/20 font-medium text-yellow-100",
  fullTimeLead: "bg-orange-500 font-medium text-black",
  fullTime: "border border-orange-500 bg-orange-500/25 font-medium text-orange-100",
  lead: "bg-brand-600 text-white",
  plant: "border border-orange-500/60 bg-orange-950/60 text-orange-200",
  hire: "border border-teal-500/60 bg-teal-950/60 text-teal-200",
  crew: "border border-brand-500/40 bg-brand-950/20 text-gray-200",
};
// The chip's role dropdown text.
export const CHIP_ROLE_TEXT: Record<ChipKind, string> = {
  labourHire: "text-yellow-200",
  fullTimeLead: "text-black",
  fullTime: "text-orange-200",
  lead: "text-white",
  plant: "text-gray-400",
  hire: "text-gray-400",
  crew: "text-gray-400",
};

// A card in the Yard sidebar (ResourceCard). `highlighted` = a Supervisor / Lead role an editor can change.
export type CardKind = "labourHire" | "fullTime" | "lead" | "plain";
export function cardKind(r: Person, o: { labourHire: boolean; highlighted: boolean }): CardKind {
  if (o.labourHire) return "labourHire";
  if (isFullTime(r)) return "fullTime";
  return o.highlighted ? "lead" : "plain";
}
export const CARD_TONE: Record<CardKind, string> = {
  labourHire: "border-yellow-400 bg-yellow-400/20 font-medium text-yellow-100",
  fullTime: "border-orange-500 bg-orange-500/20 font-medium text-orange-100",
  lead: "border-brand-500/50 bg-brand-500/10",
  plain: "border-edge bg-panel2",
};
// The card's role dropdown: a Supervisor / Lead stays a solid pill, orange on a full-timer's card.
export function cardRoleTone(kind: CardKind, highlighted: boolean): string {
  if (!highlighted) return "bg-gray-700 text-gray-300";
  return kind === "fullTime" ? "bg-orange-500 text-black" : "bg-brand-600 text-white";
}

// The tile's tooltip, with "Full-time" added so the colour is never the only sign.
export function withFullTimeTitle(title: string | null | undefined, fullTime: boolean): string | undefined {
  if (!fullTime) return title ?? undefined;
  return title ? `${FULL_TIME_LABEL} · ${title}` : FULL_TIME_LABEL;
}
