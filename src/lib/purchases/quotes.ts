// Purchase and hire requests with suppliers' quotes (2 Nov 2026, Ilies: "remove the $ money restriction from purchase
// requests to the directors ... add a bit more description including pricing for the purchase or hire request ... a
// button that allows us to add another supplier to the same request, this way they can see prices from different
// suppliers"). The plain rules: the kind, the description, one quote, picking the quote to go with, and the ONE
// place a site link may carry a dollar figure. No server imports; `npm test` (quotes.test.ts).
import { parseAmount } from "./rules";

export const KINDS = ["PURCHASE", "HIRE"] as const;
export type Kind = (typeof KINDS)[number];
export const kindOf = (v: unknown): Kind => (v === "HIRE" ? "HIRE" : "PURCHASE");
export const KIND_LABEL: Record<Kind, string> = { PURCHASE: "Purchase", HIRE: "Hire" };

export const DESCRIPTION_MAX = 2000;
export const MAX_QUOTES = 10;

// The money exception (Ilies, 2 Nov 2026), kept narrow on purpose: a dollar figure may reach a site link ONLY on a
// personal OFFICE link's purchase-request screens (/api/site/<token>/purchases...). Every other link kind (SUPERVISOR,
// HANDOVER, DRIVER, POSTER) and every other OFFICE-link screen stays money-free (linkSafe / assertNoMoney).
export const MONEY_ON_LINK_SCREENS = ["PURCHASES"] as const;
export function linkMayCarryMoney(linkKind: string | null | undefined, screen: string): boolean {
  return linkKind === "OFFICE" && (MONEY_ON_LINK_SCREENS as readonly string[]).includes(screen);
}

export type QuoteInput = { supplier: string; priceExGst: number | null; details: string | null; linkUrl: string | null };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

// One supplier's quote as typed: a supplier name, and optionally a price (ex GST), details (prices welcome) and a link.
export function parseQuote(b: unknown): { quote: QuoteInput } | { error: string } {
  const q = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const supplier = text(q.supplier, 120);
  if (!supplier || supplier.length < 2) return { error: "Name the supplier for each quote." };
  let priceExGst: number | null = null;
  if (q.priceExGst !== undefined && q.priceExGst !== null && q.priceExGst !== "") {
    priceExGst = parseAmount(q.priceExGst);
    if (priceExGst == null) return { error: `The price for ${supplier} doesn't look right - leave it blank or enter it ex GST.` };
  }
  const details = text(q.details, DESCRIPTION_MAX);
  const linkUrl = text(q.linkUrl, 500);
  if (linkUrl && !/^https?:\/\/\S+$/i.test(linkUrl)) return { error: "A quote's link should start with http:// or https://." };
  return { quote: { supplier, priceExGst, details, linkUrl } };
}

// Approving (D3, Ilies 2 Nov 2026): a request with quotes needs the one to go with; a single quote is the default;
// an older request with none approves as before.
export function chosenQuote(quotes: { id: string }[], picked: unknown): { id: string | null } | { error: string } {
  if (quotes.length === 0) return { id: null };
  const id = typeof picked === "string" && picked ? picked : quotes.length === 1 ? quotes[0].id : null;
  if (!id) return { error: "Pick which supplier's quote to go with." };
  if (!quotes.some((q) => q.id === id)) return { error: "That quote isn't on this request - reload and pick again." };
  return { id };
}

// Who sees every request on /purchases, quotes and prices included, read-only unless it's theirs (Ilies, 2 Nov 2026:
// "ALL requests, read-only"): every Manager and Admin, and the coordinator. Accounts and the directors have their own
// screens (all requests there too). A quote's file follows the same rule, plus the requester's own.
export const SEES_ALL_REQUESTS: readonly string[] = ["ADMIN", "MANAGER", "COORDINATOR"];
export function maySeeQuoteFile(u: { id: string; role: string; directorAccess: boolean }, r: { requestedByUserId: string | null }): boolean {
  return SEES_ALL_REQUESTS.includes(u.role) || u.role === "ACCOUNTS" || u.directorAccess || (!!r.requestedByUserId && r.requestedByUserId === u.id);
}

// The requester changes their own request (description, quotes) only while it's still with the approvers.
export const EDITABLE: readonly string[] = ["REQUESTED", "NEEDS_INFO"];
export const canEditOwn = (status: string) => EDITABLE.includes(status);
