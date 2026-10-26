// Accounts stage 6 (27 Oct 2026): assets & fleet - the plain rules. Asset date kinds (kept as ComplianceDocuments,
// stage 5), which Accounts-calendar category each reminder uses, an asset's dates at a glance, and which invoices-
// inbox lines can be linked as a service. No server imports; `npm test` (rules.test.ts).
import { expiryState, type ExpiryState } from "../compliance/rules";

export const ASSET_KINDS = [
  ["REGO", "Rego"],
  ["ASSET_INSURANCE", "Insurance"],
  ["SERVICE_DUE", "Service due"],
  ["PLANT_INSPECTION", "Inspection / certificate"],
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number][0];
export const isAssetKind = (k: unknown): k is AssetKind => typeof k === "string" && ASSET_KINDS.some(([x]) => x === k);
export const assetKindLabel = (k: string) => ASSET_KINDS.find(([x]) => x === k)?.[1] ?? k;

// The Accounts calendar category for a document's reminder: the calendar already has REGO and INSURANCE.
export function reminderCategory(kind: string): string {
  if (kind === "REGO") return "REGO";
  if (kind === "ASSET_INSURANCE") return "INSURANCE";
  if (kind === "SERVICE_DUE" || kind === "PLANT_INSPECTION") return "SERVICE";
  return "COMPLIANCE";
}

// Which resources are assets: owned vehicles, plant and attachments (hired items belong to the hire register).
export const ASSET_TYPES = ["VEHICLE", "EQUIPMENT", "ATTACHMENT"] as const;
export const isAssetResource = (r: { type: string; ownership?: string | null }) => (ASSET_TYPES as readonly string[]).includes(r.type) && (r.ownership ?? "OWNED") !== "HIRED";

export type DueLine = { kind: AssetKind; label: string; expiryDate: string | null; state: ExpiryState | "NOT_RECORDED" };
const RANK: Record<DueLine["state"], number> = { EXPIRED: 3, EXPIRING: 2, VALID: 1, NO_EXPIRY: 1, NOT_RECORDED: 0 };

// One line per kind for the list: the soonest-expiring ACTIVE document of that kind (or "not recorded").
// Plant inspections only show when there is one (not every item needs a certificate).
export function dueSummary(docs: { kind: string; status: string; expiryDate: string | null }[], today: string, opts: { vehicle: boolean }) {
  const lines: DueLine[] = [];
  for (const [kind, label] of ASSET_KINDS) {
    const active = docs.filter((d) => d.status === "ACTIVE" && d.kind === kind);
    if (!active.length) {
      if (kind === "PLANT_INSPECTION" || (kind === "REGO" && !opts.vehicle)) continue;
      lines.push({ kind, label, expiryDate: null, state: "NOT_RECORDED" });
      continue;
    }
    const soonest = [...active].sort((a, b) => (a.expiryDate ?? "9999").localeCompare(b.expiryDate ?? "9999"))[0];
    lines.push({ kind, label, expiryDate: soonest.expiryDate, state: expiryState(soonest.expiryDate, today) });
  }
  const worst = lines.reduce<DueLine["state"]>((w, l) => (RANK[l.state] > RANK[w] ? l.state : w), "NOT_RECORDED");
  return { lines, worst: lines.some((l) => l.state !== "NOT_RECORDED") ? worst : ("NOT_RECORDED" as const) };
}

// Inbox lines that can be linked as a service: not already linked, not skipped as a duplicate, and from the last
// 12 months (by invoice date, or upload date when the invoice has none).
export function linkable(d: { status: string; invoiceDate: string | null; createdAt: Date | string }, linkedIds: Set<string>, id: string, today: string) {
  if (linkedIds.has(id) || d.status === "DUPLICATE") return false;
  const date = d.invoiceDate ?? new Date(d.createdAt).toISOString().slice(0, 10);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return date >= yearAgo;
}
