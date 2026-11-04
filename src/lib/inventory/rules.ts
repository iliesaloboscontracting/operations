// Consumables inventory (Yard Stage C, Ilies 4 Nov 2026: "Stage C: start on the consumables inventory") - the plain
// rules: what an item needs, the balance maths for stock in / out / counts, never below zero, "below minimum" and its
// one alert, the lines a yard job can take from stock, and the purchase request a low item starts. Quantities only:
// no price, rate or cost anywhere, and any text with a dollar figure is refused - for every login, so nothing stored
// ever carries an amount the coordinator or the yard computer couldn't see. No database code (used in the browser
// and `npm test`). The item list itself is never invented here - it starts empty and people add to it.
import { assertNoMoney } from "../moneyGuard";

export const CATEGORIES = ["CONSUMABLES", "PPE", "MATERIALS", "OTHER"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = { CONSUMABLES: "Consumables", PPE: "PPE", MATERIALS: "Materials", OTHER: "Other" };
// Suggestions on the form only - any short unit can be typed.
export const UNIT_SUGGESTIONS = ["each", "box", "pack", "roll", "pair", "bag", "litre", "metre", "kg", "sheet", "tube", "tin"];

export const NO_AMOUNTS = "Leave dollar amounts out - stock is quantities only (prices live in purchase requests).";
export const MAX_QTY = 1_000_000;
export const MAX_STOCK_LINES = 20;

const round = (n: number) => Math.round(n * 1000) / 1000;
// "3", "2.5" - how a quantity reads.
export const fmtQty = (n: number) => String(round(n));

// A quantity from a form: a number, at most 3 decimals kept, 0..MAX_QTY. `positive` refuses 0.
export function parseQty(x: unknown, positive = true): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_QTY) return null;
  const r = round(n);
  return positive && r <= 0 ? null : r;
}

const text = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
export const hasAmount = (t: string | null | undefined) => !!t && !assertNoMoney(t);

export type ItemInput = { name: string; category: Category; unit: string; minLevel: number | null; location: string | null };
// An item's fields from a form. `partial`: an edit - only what was sent is checked and returned.
export function itemFields(body: Record<string, unknown>, partial = false): { data: Partial<ItemInput> } | { error: string } {
  const data: Partial<ItemInput> = {};
  if (!partial || "name" in body) {
    const name = text(body.name, 80);
    if (name.length < 2) return { error: "Give the item a name." };
    data.name = name;
  }
  if (!partial || "category" in body) {
    const c = String(body.category ?? "CONSUMABLES");
    if (!(CATEGORIES as readonly string[]).includes(c)) return { error: "Pick a category." };
    data.category = c as Category;
  }
  if (!partial || "unit" in body) {
    const unit = text(body.unit, 20) || "each";
    data.unit = unit;
  }
  if (!partial || "minLevel" in body) {
    if (body.minLevel === null || body.minLevel === undefined || body.minLevel === "") data.minLevel = null;
    else {
      const m = parseQty(body.minLevel, false);
      if (m === null) return { error: "The minimum is a number (or leave it blank)." };
      data.minLevel = m;
    }
  }
  if (!partial || "location" in body) data.location = text(body.location, 60) || null;
  for (const v of [data.name, data.unit, data.location]) if (hasAmount(v ?? null)) return { error: NO_AMOUNTS };
  return { data };
}

// ---------- movements ----------

export type MoveKind = "IN" | "OUT" | "COUNT";
export const MOVE_KINDS: MoveKind[] = ["IN", "OUT", "COUNT"];
export const belowZeroError = (onHand: number, unit: string) => `Count it first - the shelf says ${fmtQty(onHand)} ${unit}.`;

// What one movement does to the shelf. IN adds, OUT takes away (never below zero), COUNT sets the shelf to what
// was counted (the change is the difference - it can be 0, which still records that someone counted).
export function planMovement(onHand: number, unit: string, kind: string, qty: unknown):
  { change: number; balanceAfter: number; countedQty: number | null } | { error: string } {
  if (kind === "COUNT") {
    const counted = parseQty(qty, false);
    if (counted === null) return { error: "Enter how many are on the shelf." };
    return { change: round(counted - onHand), balanceAfter: counted, countedQty: counted };
  }
  const q = parseQty(qty);
  if (q === null) return { error: "Enter how many." };
  if (kind === "IN") return { change: q, balanceAfter: round(onHand + q), countedQty: null };
  if (kind === "OUT") {
    if (round(onHand - q) < 0) return { error: belowZeroError(onHand, unit) };
    return { change: -q, balanceAfter: round(onHand - q), countedQty: null };
  }
  return { error: "Stock in, stock out or a count." };
}

// ---------- below minimum ----------

export type StockStatus = "BELOW" | "OK" | "NOT_SET";
export const STATUS_LABEL: Record<StockStatus, string> = { BELOW: "Below minimum", OK: "OK", NOT_SET: "Minimum not set" };
export function stockStatus(i: { onHand: number; minLevel: number | null }): StockStatus {
  if (i.minLevel === null || i.minLevel === undefined) return "NOT_SET";
  return i.onHand < i.minLevel ? "BELOW" : "OK";
}
// The one alert to the Admins: when an item drops below its minimum (and it hasn't been alerted since it was last
// at or above it). Back at or above it clears the mark, so the next drop alerts again. Retired items never alert.
export function belowMinStep(i: { onHand: number; minLevel: number | null; active: boolean; belowMinAlertedAt: Date | string | null }):
  { alert: boolean; clear: boolean } {
  const below = i.active && stockStatus(i) === "BELOW";
  return { alert: below && !i.belowMinAlertedAt, clear: !below && !!i.belowMinAlertedAt };
}

// The purchase request a low item starts (the ordinary in-app form, prefilled - the usual approvers and quotes apply).
// Suggested quantity: enough to get back to twice the minimum, whole units, at least 1.
export function purchasePrefill(i: { name: string; unit: string; onHand: number; minLevel: number | null }) {
  if (i.minLevel === null || i.minLevel === undefined) return null;
  const need = Math.max(1, Math.ceil(round(2 * i.minLevel - i.onHand)));
  return { kind: "PURCHASE" as const, what: i.name, qty: `${need} ${i.unit}`, why: `Stock below minimum - ${i.name}` };
}

// ---------- a yard job taking from stock ----------

// "Took from stock" lines with a yard job's Ready for collection: an item and a quantity each, at most 20, the same
// item twice added together. Empty / missing = no stock taken.
export function stockLines(x: unknown): { lines: { itemId: string; qty: number }[] } | { error: string } {
  if (x === undefined || x === null) return { lines: [] };
  if (!Array.isArray(x)) return { error: "Took from stock: pick the item and how many." };
  const merged = new Map<string, number>();
  for (const l of x) {
    const itemId = typeof l?.itemId === "string" ? l.itemId : "";
    const qty = parseQty(l?.qty);
    if (!itemId || qty === null) return { error: "Took from stock: pick the item and how many." };
    merged.set(itemId, round((merged.get(itemId) ?? 0) + qty));
  }
  if (merged.size > MAX_STOCK_LINES) return { error: `At most ${MAX_STOCK_LINES} items at once.` };
  return { lines: [...merged].map(([itemId, qty]) => ({ itemId, qty })) };
}
