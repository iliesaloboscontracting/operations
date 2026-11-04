// The Hire register for the COORDINATOR login (2 Nov 2026, Ilies "approve phase 1"): full working access - add, edit,
// extend, off-hire, dates, suppliers, status, the project it's for - and no dollar figure at all. What he receives is
// this narrow shape (no rate, charge, cost or pay field; any amount typed into a free-text field taken out), and a
// write he sends may only touch the fields below: a money field, a non-hire field, another register, or archiving
// the item (active: false - "set its status to Returned instead", Ilies) is refused. Managers and Admins are
// unchanged (api/resources). No server imports; `npm test` (coordinatorHire.test.ts).
import { nameWithoutAmounts, stripMoney } from "./dailyLog/money";
import { assertNoMoney } from "./moneyGuard";
import { PAY_RATE_FIELDS, RESOURCE_FIELDS } from "./resourceFields";
import { SUBCONTRACT_KINDS, SUPPLIER_HIRE_KINDS } from "./hireKinds";

// Every Resource field that is (or holds) a dollar figure.
export const HIRE_MONEY_FIELDS: readonly string[] = [
  "rate", "dailyRateExGst", "hireRate", "hireRateUnit", "hireDeliveryCost", "hireCollectionCost", ...PAY_RATE_FIELDS,
];
// Names (amounts taken out with no tag left) and notes (each amount becomes "(amount not recorded)").
const NAME_FIELDS = ["name", "agency", "role"] as const;
const NOTE_FIELDS = ["hireRef", "hireSource", "hireStart", "hireEnd", "notes"] as const;
const TEXT_FIELDS: readonly string[] = [...NAME_FIELDS, ...NOTE_FIELDS];
// What he may set. type / category / ownership / active only to the values a hire item has (checked below).
export const HIRE_WRITE_FIELDS: readonly string[] = [
  ...TEXT_FIELDS, "type", "category", "ownership", "active", "onHireDate", "offHireDate", "hireProjectId", "hireStatus",
];
export const HIRE_CATEGORIES: readonly string[] = [...SUPPLIER_HIRE_KINDS, ...SUBCONTRACT_KINDS];

export const NO_MONEY_ON_HIRE = "Rates, charges and costs are kept by the office - leave them out.";
export const NO_AMOUNTS_IN_TEXT = "Leave dollar amounts out - rates and costs are kept by the office.";
export const HIDDEN_AMOUNT = "That field has an amount in it that only the office sees - ask the office to change it.";
export const NO_ARCHIVE ="Hire items aren't archived from here - set the status to Returned instead.";

// A text field as he sees it.
export function shownText(field: string, v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v);
  const { text, removed } = stripMoney(v);
  if (!removed && !v.includes("$")) return v; // nothing to take out - exactly as stored
  return (NAME_FIELDS as readonly string[]).includes(field) ? nameWithoutAmounts(v) : text.replace(/\$/g, "");
}

// Every other reply he reads (sign-ins, Day Review, timesheets, the calendar and its project list, tools, the hire
// alerts): the same data a Viewer gets, with any amount typed into free text taken out (a project's notes, a hire
// company someone named "$5 Labour"). Walks arrays and plain objects; numbers, dates and the rest are left alone.
// Office chat is not run through this - amounts are allowed there (Ilies, 27 Oct 2026).
export function withoutAmounts<T>(x: T): T {
  if (typeof x === "string") return shownText("notes", x) as T;
  if (Array.isArray(x)) return x.map((v) => withoutAmounts(v)) as T;
  if (x && typeof x === "object") {
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return x; // a Date, a Buffer...
    return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, withoutAmounts(v)])) as T;
  }
  return x;
}

type Row = Record<string, unknown> & { id: string };
export type CoordinatorHireDTO = {
  id: string; type: string; category: string | null; active: boolean;
  name: string; agency: string | null; role: string | null;
  hireRef: string | null; hireSource: string | null; hireStart: string | null; hireEnd: string | null; notes: string | null;
  onHireDate: string | null; offHireDate: string | null; hireProjectId: string | null; hireStatus: string | null;
  offHiredOn: string | null; offHireRef: string | null; offHiredBy: string | null; // set by the Off-hired button only (5 Nov 2026)
  assignments: { id: string; job: { id: string; title: string; date: unknown; shift: unknown } }[];
};

// One hire item for the coordinator: an allow-list, so a field added to Resource later never reaches him by default.
export function toCoordinatorHire(r: Row): CoordinatorHireDTO {
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const assignments = Array.isArray(r.assignments) ? (r.assignments as { id: string; job: { id: string; title: string; date: unknown; shift: unknown } }[]) : [];
  return {
    id: r.id, type: String(r.type), category: s(r.category), active: r.active !== false,
    name: shownText("name", r.name) ?? "", agency: shownText("agency", r.agency), role: shownText("role", r.role),
    hireRef: shownText("hireRef", r.hireRef), hireSource: shownText("hireSource", r.hireSource),
    hireStart: shownText("hireStart", r.hireStart), hireEnd: shownText("hireEnd", r.hireEnd), notes: shownText("notes", r.notes),
    onHireDate: s(r.onHireDate), offHireDate: s(r.offHireDate), hireProjectId: s(r.hireProjectId), hireStatus: s(r.hireStatus),
    offHiredOn: s(r.offHiredOn), offHireRef: shownText("hireRef", r.offHireRef), offHiredBy: s(r.offHiredBy),
    assignments: assignments.map((a) => ({ id: a.id, job: { id: a.job.id, title: shownText("name", a.job.title) ?? "", date: a.job.date, shift: a.job.shift } })),
  };
}

// A body he sent -> the body to hand to the ordinary create / patch rules, or why not. `existing` is the stored row
// for a change (null when adding). A text field sent back exactly as he was shown it is unchanged, so it's dropped -
// saving the form never overwrites a note's amounts with "(amount not recorded)".
export function coordinatorHireWrite(body: Record<string, unknown>, existing: Record<string, unknown> | null): { body: Record<string, unknown> } | { error: string; status: number } {
  if (existing && existing.type !== "HIRE") return { error: "Only hire items can be changed from here.", status: 403 };
  if (HIRE_MONEY_FIELDS.some((f) => f in body)) return { error: NO_MONEY_ON_HIRE, status: 400 };
  const other = (RESOURCE_FIELDS as readonly string[]).filter((f) => f in body && !HIRE_WRITE_FIELDS.includes(f));
  if (other.length) return { error: `Only the hire details can be set from here (not ${other.join(", ")}).`, status: 400 };
  if (!existing && body.type !== "HIRE") return { error: "Only hire items can be added from here.", status: 403 };
  if ("type" in body && body.type !== "HIRE") return { error: "A hire item stays on the Hire register.", status: 400 };
  if ((!existing || "category" in body) && !HIRE_CATEGORIES.includes(String(body.category))) return { error: "Pick which kind of hire it is.", status: 400 };
  if ("ownership" in body && body.ownership !== "HIRED") return { error: "A hire item is always hired.", status: 400 };
  if ("active" in body && body.active !== true && body.active !== "true") return { error: NO_ARCHIVE, status: 403 };

  const out: Record<string, unknown> = {};
  for (const f of HIRE_WRITE_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (TEXT_FIELDS.includes(f)) {
      const w = strippedTextWrite(f, v, existing ? { stored: existing[f] } : null);
      if (w === "unchanged") continue;
      if (w !== "ok") return w;
    }
    out[f] = f === "active" ? true : v;
  }
  return { body: out };
}

// One free-text field sent back by a login that only ever sees it with amounts taken out - the coordinator (Hire above,
// Tools) and the yard computer (Tools, Ilies 4 Nov 2026). `current` is the stored value ({ stored }), or null when the
// record is new. Sent back exactly as shown (spaces at the ends aside) = "unchanged": the caller drops it, so saving
// the form never overwrites a note's amounts with "(amount not recorded)". A different value while the stored one holds
// an amount they can't see = 409 HIDDEN_AMOUNT (it stays the office's to change). New text with an amount = 400.
export function strippedTextWrite(field: string, sent: unknown, current: { stored: unknown } | null): "unchanged" | "ok" | { error: string; status: number } {
  const s = typeof sent === "string" ? sent : sent == null ? null : String(sent);
  if (current && (s ?? "").trim() === (shownText(field, current.stored) ?? "").trim()) return "unchanged";
  if (current && typeof current.stored === "string" && shownText(field, current.stored) !== current.stored) return { error: HIDDEN_AMOUNT, status: 409 };
  // Anything they'd be shown as "(amount not recorded)" isn't saved either ("$450/day", "450 dollars").
  if (s && (!assertNoMoney(s) || stripMoney(s).removed)) return { error: NO_AMOUNTS_IN_TEXT, status: 400 };
  return "ok";
}
