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

// PQ-001 (Ilies approved, 2 Nov 2026): the disk. A request's quote files over its whole life - those on it now, the
// ones already replaced and the new one - stay within 30 MB; one link or login sends at most 20 quote files a Sydney
// day. Plain words when it's too much.
export const REQUEST_FILE_BUDGET = 30 * 1024 * 1024;
export const DAILY_FILE_UPLOADS = 20;
// A body the server couldn't read - over Next's 10 MB request limit, so cut short (7 MB option A, Ilies 2 Nov 2026).
export const BODY_TOO_LARGE = "Too large: send big quote files one at a time with Add another supplier (7 MB each).";
export const TOO_LARGE ="Too large: this request's quote files would come to more than 30 MB. Leave the big file off, or put a link to the quote instead.";
export const TOO_MANY = "Too many files today: you can attach up to 20 quote files a day. Add the rest tomorrow, or put a link to the quote instead.";
export const fileBudgetError = (usedBytes: number, newBytes: number) => (usedBytes + newBytes > REQUEST_FILE_BUDGET ? TOO_LARGE : null);
export const dailyUploadsError = (sentToday: number, adding: number) => (adding > 0 && sentToday + adding > DAILY_FILE_UPLOADS ? TOO_MANY : null);
// Who is sending, for the daily count: a link or a login.
export const uploaderKey = (who: { linkId?: string | null; userId?: string | null }) => (who.linkId ? `LINK:${who.linkId}` : `USER:${who.userId}`);

// PQ-002 (Ilies approved, 2 Nov 2026): a changed quote's history says what changed - supplier, price, file - before
// and after, in the event's note (no new table). Prices may show here: it's the request's own history.
// PQ-010 (Ilies approved, 2 Nov 2026: "Fix it first"): a replaced file is always recorded by its original AND stored
// name, before -> after - even when the names it was sent with match - and the old details and link text are kept
// (about 200 characters each), so the history always says which file and words were there before.
type QuoteFace = { supplier: string; priceExGst: number | null; details: string | null; linkUrl: string | null; fileOriginalName: string | null; fileName: string | null };
const price = (n: number | null) => (n == null ? "no price" : `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const cut = (s: string | null) => (s == null || s === "" ? "none" : `"${s.replace(/\s+/g, " ").trim().slice(0, 200)}${s.length > 200 ? "..." : ""}"`);
const fileFace = (q: QuoteFace) => (q.fileName ? `${q.fileOriginalName ?? "quote"} (${q.fileName})` : "none");
export function quoteChangeNote(before: QuoteFace, after: QuoteFace, newFile: boolean): string {
  const parts: string[] = [];
  if (before.supplier !== after.supplier) parts.push(`supplier ${before.supplier} -> ${after.supplier}`);
  if (before.priceExGst !== after.priceExGst) parts.push(`price ${price(before.priceExGst)} -> ${price(after.priceExGst)}`);
  if (newFile) parts.push(`file ${fileFace(before)} -> ${fileFace(after)}`);
  if ((before.details ?? "") !== (after.details ?? "")) parts.push(`details ${cut(before.details)} -> ${cut(after.details)}`);
  if ((before.linkUrl ?? "") !== (after.linkUrl ?? "")) parts.push(`link ${cut(before.linkUrl)} -> ${cut(after.linkUrl)}`);
  return `Quote changed (${after.supplier}): ${parts.length ? parts.join("; ") : "nothing visible changed"}`.slice(0, 1500);
}

// PQ-004 (Ilies approved, 2 Nov 2026): a phone alert shows on a lock screen through Apple's / Google's servers, so its
// body carries no free text at all - not what was asked, not a price - only who asked, the kind and the ref.
export const alertBody = (name: string, kind: unknown, ref: string) => `${name} asked for a ${kindOf(kind) === "HIRE" ? "hire" : "purchase"} (${ref})`;

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
