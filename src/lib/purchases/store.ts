// Accounts stage 6 (27 Oct 2026): purchase requests, server side. Alex asks (his OFFICE link or in-app), a DIRECTOR
// login or the owner approves, accounts order it. The rules are rules.ts and quotes.ts; this file loads, saves,
// records an event per step and sends the existing push alerts. accountsView() alone carries accounts' own amount
// and note.
// 2 Nov 2026 (Ilies): a request is a purchase or a hire, its description may carry prices, and it can have several
// suppliers' quotes (price, details, link, file); the approver picks the one to go with. Prices are seen by the
// requester (app or OFFICE link), every Manager / Admin / the coordinator on /purchases, the directors and accounts.
// Phone alerts carry no free text - who asked, the kind and the ref only (D2, PQ-004).
// Design: docs/accounts/STAGE6-DESIGN.md §3.
import { Prisma } from "@prisma/client";
import { BUILDING_AGENT_EMAIL } from "../session";
import { prisma } from "../prisma";
import { isOwner, OWNER_EMAIL } from "../owner";
import { pushToSiteLinks, pushToUsers, type PushMessage } from "../push";
import { todaySydney } from "../today";
import { addDays, isIsoDate } from "../accounts/calendar";
import { approverIds, check, OPEN, parseAmount, purchaseNo, requesterView, STATUS_FOR_REQUESTER, type Action, type Actor, type Status } from "./rules";
import {
  alertBody, canEditOwn, chosenQuote, dailyUploadsError, DESCRIPTION_MAX, fileBudgetError, kindOf, KIND_LABEL, MAX_QUOTES, parseQuote, TOO_MANY, uploaderKey, type QuoteInput,
} from "./quotes";
import { checkQuoteFile, quoteFileName, writeQuoteFile } from "./files";

type Problem = { error: string; status: number };
const bad = (error: string, status = 400): Problem => ({ error, status });

// Who is asking / acting. A link is Alex's personal OFFICE link; a login is anyone signed in.
export type Requester = { kind: "LINK"; linkId: string; name: string } | { kind: "APP"; userId: string; name: string };

const withEvents = {
  events: { orderBy: { at: "asc" as const } }, project: { select: { name: true, jobNo: true } }, quotes: { orderBy: { createdAt: "asc" as const } },
};
type Row = Prisma.PurchaseRequestGetPayload<{ include: typeof withEvents }>;

const projectName = (r: Row) => (r.project ? [r.project.jobNo, r.project.name].filter(Boolean).join(" ") : null);

// One quote as everyone who sees the request sees it - the file by its own name, served by an authorised route.
const quoteView = (q: Row["quotes"][number]) => ({
  id: q.id, supplier: q.supplier, priceExGst: q.priceExGst, details: q.details, linkUrl: q.linkUrl,
  file: q.fileName ? { name: q.fileOriginalName ?? "quote", mime: q.fileMime } : null, createdBy: q.createdBy, createdAt: q.createdAt.toISOString(),
});
const quotesOf = (r: Row) => ({
  kind: kindOf(r.kind), kindLabel: KIND_LABEL[kindOf(r.kind)], quotes: r.quotes.map(quoteView),
  chosenQuoteId: r.chosenQuoteId, chosenBy: r.chosenBy, chosenAt: r.chosenAt?.toISOString() ?? null,
});
// The requester, every Manager / Admin / the coordinator: the request and its quotes - never accounts' own amount or note.
const requesterRow = (r: Row) => ({ ...requesterView(r), projectName: projectName(r), ...quotesOf(r) });

// The Accounts / Directors shape: everything, accounts' amount and note included.
export function accountsView(r: Row) {
  return {
    ...requesterView(r), projectName: projectName(r), ...quotesOf(r), source: r.source, amountExGst: r.amountExGst, accountsNote: r.accountsNote,
    checkedBy: r.checkedBy, checkedAt: r.checkedAt?.toISOString() ?? null, decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote, orderedBy: r.orderedBy, orderedAt: r.orderedAt?.toISOString() ?? null, closedReason: r.closedReason,
    events: r.events.map((e) => ({ action: e.action, status: e.status, by: e.by, at: e.at.toISOString(), note: e.note })),
  };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

type FileIn = { bytes: Buffer; mime: string; ext: string; name: string };
type QuoteIn = QuoteInput & { file: FileIn | null };
// A quote as sent, with its file (optional) checked - nothing is saved yet.
function quoteIn(b: unknown): { quote: QuoteIn } | { error: string } {
  const p = parseQuote(b);
  if ("error" in p) return p;
  const f = (b as Record<string, unknown>)?.file as Record<string, unknown> | undefined;
  if (!f) return { quote: { ...p.quote, file: null } };
  const c = checkQuoteFile(f.dataUrl, f.name);
  if ("error" in c) return { error: `${p.quote.supplier}: ${c.error}` };
  return { quote: { ...p.quote, file: c } };
}
// The quote's row, with its file's name chosen but nothing written yet (PQ-001): `pending` is written by
// writePending() only after the save it belongs to has gone through.
type Pending = { fileName: string; bytes: Buffer };
function quoteData(q: QuoteIn, by: { name: string; userId?: string | null }) {
  const fileName = q.file ? quoteFileName(q.file.ext) : null;
  const data = {
    supplier: q.supplier, priceExGst: q.priceExGst, details: q.details, linkUrl: q.linkUrl, createdBy: by.name, createdByUserId: by.userId ?? null,
    ...(q.file ? { fileName, fileMime: q.file.mime, fileOriginalName: q.file.name, fileSize: q.file.bytes.length } : {}),
  };
  return { data, pending: q.file && fileName ? ({ fileName, bytes: q.file.bytes } as Pending) : null };
}
// Write the files of a save that went through. False (logged) when the disk refused one - the caller then takes the
// file off its quote so nothing points at a missing file.
async function writePending(files: Pending[]): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) await writeQuoteFile(f.fileName, f.bytes).catch((e) => { console.error("quote file write failed", e); failed.push(f.fileName); });
  return failed;
}
const FILE_NOT_STORED = "Saved, but a quote file couldn't be stored - attach it again with Change.";
const NO_FILE = { fileName: null, fileMime: null, fileOriginalName: null, fileSize: null };

// PQ-001: quote files this link or login has sent today (Sydney), for the 20-a-day cap.
const sydneyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
async function filesSentToday(key: string) {
  const rows = await prisma.purchaseRequestEvent.findMany({ where: { byKey: key, files: { gt: 0 }, at: { gte: new Date(Date.now() - 26 * 3600_000) } }, select: { at: true, files: true } });
  const today = todaySydney();
  return rows.filter((e) => sydneyDay(e.at) === today).reduce((n, e) => n + e.files, 0);
}

function parseNew(b: Record<string, unknown>) {
  // Prices are fine in every field now (D1, Ilies 2 Nov 2026); accounts' own amount is a separate field.
  const what = text(b.what, 200), why = text(b.why, DESCRIPTION_MAX), qty = text(b.qty, 40), supplier = text(b.supplier, 120);
  if (!what || what.length < 3) return { error: "Say what you need." };
  const linkUrl = text(b.linkUrl, 500);
  if (linkUrl && !/^https?:\/\/\S+$/i.test(linkUrl)) return { error: "The link should start with http:// or https://." };
  const neededBy = text(b.neededBy, 10);
  if (neededBy && !isIsoDate(neededBy)) return { error: "Pick the date it's needed by." };
  const projectId = text(b.projectId, 40);
  const sent = Array.isArray(b.quotes) ? b.quotes : [];
  if (sent.length > MAX_QUOTES) return { error: `Up to ${MAX_QUOTES} quotes on one request.` };
  const quotes: QuoteIn[] = [];
  for (const q of sent) {
    const one = quoteIn(q);
    if ("error" in one) return { error: one.error };
    quotes.push(one.quote);
  }
  // PQ-001: one request's files together stay within its 30 MB budget (each is capped in files.ts too).
  const tooLarge = fileBudgetError(0, quotes.reduce((n, q) => n + (q.file?.bytes.length ?? 0), 0));
  if (tooLarge) return { error: tooLarge };
  // An older form's single "supplier" becomes the first quote.
  if (!quotes.length && supplier) quotes.push({ supplier, priceExGst: null, details: null, linkUrl: null, file: null });
  return { data: { what, why, qty, linkUrl, neededBy, projectId, kind: kindOf(b.kind) }, quotes };
}

async function nextNumber(db: Prisma.TransactionClient) {
  const top = await db.purchaseRequest.aggregate({ _max: { number: true } });
  return (top._max.number ?? 0) + 1;
}

const roleUsers = async (role: string) => (await prisma.user.findMany({ where: { role, active: true }, select: { id: true } })).map((u) => u.id);
// The approvers to alert about a request: DIRECTOR logins and the owner, minus the requester's own logins.
const approversFor = async (requesterUserId: string | null) =>
  approverIds(await prisma.user.findMany({ where: { active: true, OR: [{ role: "DIRECTOR" }, { email: OWNER_EMAIL }] }, select: { id: true, role: true, email: true } }), requesterUserId);
const alert = (p: Promise<unknown>) => p.catch((e) => console.error("purchase alert failed", e));

// Status words only, never an amount (D-money).
async function tellRequester(r: { siteLinkId: string | null; requestedByUserId: string | null; number: number }, status: Status) {
  const msg: PushMessage = { title: `Purchase ${purchaseNo(r.number)}`, body: STATUS_FOR_REQUESTER[status], url: "", tag: `purchase-${r.number}` };
  if (r.siteLinkId) await alert(pushToSiteLinks([r.siteLinkId], { ...msg, url: "?go=purchases" }));
  else if (r.requestedByUserId) await alert(pushToUsers([r.requestedByUserId], { ...msg, url: "/purchases" }));
}

export async function createRequest(who: Requester, b: Record<string, unknown>): Promise<{ id: string; ref: string; warning?: string } | Problem> {
  // PUR-001 (27 Oct 2026): the Building Agent login never raises a purchase request - on any route.
  if (who.kind === "APP") {
    const u = await prisma.user.findUnique({ where: { id: who.userId }, select: { email: true } });
    if (u?.email.toLowerCase() === BUILDING_AGENT_EMAIL) return bad("The Building Agent login can't ask to buy things.", 403);
  }
  const p = parseNew(b);
  if ("error" in p) return bad(p.error!);
  if (p.data.projectId && !(await prisma.project.findUnique({ where: { id: p.data.projectId }, select: { id: true } }))) return bad("Pick the job again.");
  const by = { name: who.name, userId: who.kind === "APP" ? who.userId : null };
  const key = uploaderKey(who.kind === "LINK" ? { linkId: who.linkId } : { userId: who.userId });
  const files = p.quotes.filter((q) => q.file).length;
  const tooMany = files ? dailyUploadsError(await filesSentToday(key), files) : null;
  if (tooMany) return bad(tooMany, 429);
  const built = p.quotes.map((q) => quoteData(q, by));
  const fileBytes = p.quotes.reduce((n, q) => n + (q.file?.bytes.length ?? 0), 0);
  for (let attempt = 0; ; attempt++) {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const number = await nextNumber(tx);
        return tx.purchaseRequest.create({
          data: {
            ...p.data, number, requestedBy: who.name, source: who.kind, fileBytes,
            siteLinkId: who.kind === "LINK" ? who.linkId : null, requestedByUserId: who.kind === "APP" ? who.userId : null,
            events: { create: { action: "ASK", status: "REQUESTED", by: who.name, byKey: key, files } },
            quotes: { create: built.map((x) => x.data) },
          },
        });
      });
      // PQ-001: the files only now the request is saved; one the disk refused comes off its quote.
      const failed = await writePending(built.flatMap((x) => (x.pending ? [x.pending] : [])));
      if (failed.length) await prisma.purchaseQuote.updateMany({ where: { requestId: row.id, fileName: { in: failed } }, data: NO_FILE });
      // Straight to the approvers (28 Oct 2026) - not accounts.
      await alert(pushToUsers(await approversFor(row.requestedByUserId), { title: `${KIND_LABEL[kindOf(row.kind)]} request ${purchaseNo(row.number)} to approve`, body: alertBody(who.name, row.kind, purchaseNo(row.number)), url: "/directors/purchases", tag: "purchase-approve" }));
      return { id: row.id, ref: purchaseNo(row.number), ...(failed.length ? { warning: FILE_NOT_STORED } : {}) };
    } catch (e) {
      // Two requests at the same moment took the same number - take the next one.
      if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

// The requester's own changes while it's with the approvers (Ilies, 2 Nov 2026): the description and details, another
// supplier's quote, or a correction to one of the quotes. Nothing is deleted; each change is an event.
export type EditAction = "EDIT" | "ADD_QUOTE" | "EDIT_QUOTE";
export const isEditAction = (a: unknown): a is EditAction => a === "EDIT" || a === "ADD_QUOTE" || a === "EDIT_QUOTE";
export async function editOwnRequest(id: string, action: EditAction, who: { name: string; linkId?: string; userId?: string }, b: Record<string, unknown>): Promise<{ ok: true; warning?: string } | Problem> {
  const r = await prisma.purchaseRequest.findUnique({ where: { id }, include: { quotes: true } });
  const mine = r && ((who.linkId && r.siteLinkId === who.linkId) || (who.userId && r.requestedByUserId === who.userId));
  if (!r || !mine) return bad("Not found.", 404);
  if (!canEditOwn(r.status)) return bad(`It's ${STATUS_FOR_REQUESTER[r.status as Status]?.toLowerCase() ?? r.status} - it can't be changed now.`, 409);
  if (b.version !== undefined && Number(b.version) !== r.version) return bad("Someone else has just changed this - reload and try again.", 409);
  const by = { name: who.name, userId: who.userId ?? null };
  const key = uploaderKey(who);
  // PQ-003 (Ilies approved, 2 Nov 2026): the version bump, the quote and the event are one transaction - the request
  // never shows a new version without its change, nor a change under the old version an approver already saw.
  const STALE = "stale";
  const commit = (tx: Prisma.TransactionClient, data: Prisma.PurchaseRequestUpdateManyMutationInput = {}) =>
    tx.purchaseRequest.updateMany({ where: { id, version: r.version, status: r.status }, data: { ...data, version: r.version + 1 } }).then((d) => { if (!d.count) throw new Error(STALE); });
  const event = (tx: Prisma.TransactionClient, note: string, files = 0) => tx.purchaseRequestEvent.create({ data: { requestId: id, action, status: r.status, by: who.name, note, byKey: key, files } });
  // PQ-001: a new file must fit the request's lifetime budget (every file it has ever had) and today's 20.
  const fileLimits = async (q: QuoteIn) => {
    if (!q.file) return null;
    return fileBudgetError(r.fileBytes, q.file.bytes.length) ?? dailyUploadsError(await filesSentToday(key), 1);
  };
  let warning: string | undefined;
  try {
    if (action === "EDIT") {
      const data: Prisma.PurchaseRequestUpdateManyMutationInput = {};
      if ("what" in b) { const what = text(b.what, 200); if (!what || what.length < 3) return bad("Say what you need."); data.what = what; }
      if ("why" in b) data.why = text(b.why, DESCRIPTION_MAX);
      if ("qty" in b) data.qty = text(b.qty, 40);
      if ("kind" in b) data.kind = kindOf(b.kind);
      if ("neededBy" in b) { const d = text(b.neededBy, 10); if (d && !isIsoDate(d)) return bad("Pick the date it's needed by."); data.neededBy = d; }
      await prisma.$transaction(async (tx) => { await commit(tx, data); await event(tx, "Description changed"); });
    } else if (action === "ADD_QUOTE") {
      if (r.quotes.length >= MAX_QUOTES) return bad(`Up to ${MAX_QUOTES} quotes on one request.`);
      const q = quoteIn(b.quote);
      if ("error" in q) return bad(q.error);
      const limit = await fileLimits(q.quote);
      if (limit) return bad(limit, limit === TOO_MANY ? 429 : 400);
      const { data, pending } = quoteData(q.quote, by);
      const quote = await prisma.$transaction(async (tx) => {
        await commit(tx, { fileBytes: { increment: q.quote.file?.bytes.length ?? 0 } });
        const made = await tx.purchaseQuote.create({ data: { ...data, requestId: id } });
        await event(tx, `Quote added: ${q.quote.supplier}`, pending ? 1 : 0);
        return made;
      });
      // PQ-001: the file only now the save went through; if the disk refuses it, it comes off the quote.
      if (pending && (await writePending([pending])).length) {
        await prisma.purchaseQuote.update({ where: { id: quote.id }, data: NO_FILE });
        warning = FILE_NOT_STORED;
      }
    } else {
      const existing = r.quotes.find((x) => x.id === b.quoteId);
      if (!existing) return bad("That quote isn't on this request - reload and try again.", 404);
      const sent = (b.quote && typeof b.quote === "object" ? b.quote : {}) as Record<string, unknown>;
      const q = quoteIn({ supplier: existing.supplier, priceExGst: existing.priceExGst, details: existing.details, linkUrl: existing.linkUrl, ...sent });
      if ("error" in q) return bad(q.error);
      const limit = await fileLimits(q.quote);
      if (limit) return bad(limit, limit === TOO_MANY ? 429 : 400);
      const { data, pending } = quoteData(q.quote, by);
      // A new file replaces the shown one; the old file stays on disk (nothing is deleted) and stays in the budget.
      const { createdBy: _c, createdByUserId: _u, ...change } = data;
      await prisma.$transaction(async (tx) => {
        await commit(tx, { fileBytes: { increment: q.quote.file?.bytes.length ?? 0 } });
        await tx.purchaseQuote.update({ where: { id: existing.id }, data: { ...change, editedBy: by.name, editedAt: new Date() } });
        await event(tx, `Quote changed: ${q.quote.supplier}`, pending ? 1 : 0);
      });
      // If the disk refuses the new file, the quote keeps the file it had.
      if (pending && (await writePending([pending])).length) {
        await prisma.purchaseQuote.update({
          where: { id: existing.id }, data: { fileName: existing.fileName, fileMime: existing.fileMime, fileOriginalName: existing.fileOriginalName, fileSize: existing.fileSize },
        });
        warning = FILE_NOT_STORED;
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message === STALE) return bad("Someone else has just changed this - reload and try again.", 409);
    throw e;
  }
  return { ok: true, ...(warning ? { warning } : {}) };
}

// One step on a request. The route decides who the actor is; ownership of REQUESTER steps is checked here.
export async function actOnRequest(
  id: string, action: Action, actor: Actor, who: { name: string; linkId?: string; userId?: string }, b: Record<string, unknown>,
): Promise<{ ok: true; status: Status } | Problem> {
  const r = await prisma.purchaseRequest.findUnique({ where: { id }, include: { quotes: { select: { id: true, supplier: true } } } });
  if (!r) return bad("Not found.", 404);
  if (actor.kind === "REQUESTER") {
    const mine = (who.linkId && r.siteLinkId === who.linkId) || (who.userId && r.requestedByUserId === who.userId);
    if (!mine) return bad("Not found.", 404);
  }
  const ok = check(action, r, actor);
  if ("error" in ok) return bad(ok.error, actor.kind === "DIRECTOR" ? 403 : 409);
  // PQ-003 (Ilies approved, 2 Nov 2026): an approver decides on exactly the request they saw - approving, declining or
  // asking without its version is refused, so a change made since (another quote, a new price) can't slip through.
  if (actor.kind === "DIRECTOR" && (b.version === undefined || b.version === null || b.version === "")) return bad("Reload the page and try again - this request has changed or the page is out of date.", 400);
  if (b.version !== undefined && Number(b.version) !== r.version) return bad("Someone else has just changed this - reload and try again.", 409);

  const data: Prisma.PurchaseRequestUpdateInput = { status: ok.to, version: { increment: 1 } };
  let note: string | null = null;
  const now = new Date();
  switch (action) {
    case "ASK_INFO": {
      note = text(b.question, 400);
      if (!note || note.length < 3) return bad("Write the question for them.");
      Object.assign(data, { infoQuestion: note, infoAnswer: null });
      break;
    }
    case "ANSWER": {
      note = text(b.answer, 600);
      if (!note) return bad("Write your answer.");
      data.infoAnswer = note;
      break;
    }
    case "CANCEL":
      break;
    case "APPROVE":
    case "DECLINE": {
      note = text(b.note, 400);
      if (action === "DECLINE" && (!note || note.length < 3)) return bad("Say why it's declined.");
      Object.assign(data, { decidedBy: who.name, decidedAt: now, decisionNote: note });
      if (action === "APPROVE") {
        // D3 (Ilies, 2 Nov 2026): the approver picks the supplier's quote to go with; accounts order from that one.
        const pick = chosenQuote(r.quotes, b.chosenQuoteId);
        if ("error" in pick) return bad(pick.error);
        if (pick.id) {
          Object.assign(data, { chosenQuoteId: pick.id, chosenBy: who.name, chosenAt: now });
          const s = r.quotes.find((q) => q.id === pick.id)?.supplier;
          note = [note, s && `Going with ${s}`].filter(Boolean).join(" - ");
        }
      }
      break;
    }
    case "ORDERED": {
      note = text(b.note, 300);
      // Accounts may note the price when they order it (optional; accounts / directors only - never on a link).
      if (b.amountExGst !== undefined && b.amountExGst !== "" && b.amountExGst !== null) {
        const amount = parseAmount(b.amountExGst);
        if (amount == null) return bad("That amount doesn't look right - leave it blank or enter it ex GST.");
        data.amountExGst = amount;
      }
      Object.assign(data, { orderedBy: who.name, orderedAt: now });
      break;
    }
  }
  // The version in the where makes two people acting at once safe: the second gets "changed" instead of overwriting.
  const done = await prisma.purchaseRequest.updateMany({ where: { id, version: r.version, status: r.status }, data: { ...(data as Prisma.PurchaseRequestUpdateManyMutationInput), version: r.version + 1 } });
  if (!done.count) return bad("Someone else has just changed this - reload and try again.", 409);
  await prisma.purchaseRequestEvent.create({ data: { requestId: id, action, status: ok.to, by: who.name, note } });

  // 28 Oct 2026: an answered question goes back to the approvers; approved goes to accounts to order; the requester
  // hears about a question, approved, declined and ordered. No amount in any alert (D2).
  if (ok.to === "REQUESTED") await alert(pushToUsers(await approversFor(r.requestedByUserId), { title: `Purchase ${purchaseNo(r.number)} answered`, body: `${r.requestedBy} answered the question.`, url: "/directors/purchases", tag: "purchase-approve" }));
  if (ok.to === "APPROVED") await alert(pushToUsers(await roleUsers("ACCOUNTS"), { title: `Purchase ${purchaseNo(r.number)} approved - to order`, body: alertBody(r.requestedBy, r.kind, purchaseNo(r.number)), url: "/accounts/purchases", tag: "purchase-decided" }));
  if (["NEEDS_INFO", "APPROVED", "DECLINED", "ORDERED"].includes(ok.to)) await tellRequester(r, ok.to);
  return { ok: true, status: ok.to };
}

const recent = () => new Date(`${addDays(todaySydney(), -90)}T00:00:00Z`);

export async function listForAccounts() {
  const rows = await prisma.purchaseRequest.findMany({
    where: { OR: [{ status: { in: OPEN } }, { updatedAt: { gte: recent() } }] }, include: withEvents, orderBy: { number: "desc" }, take: 400,
  });
  const v = rows.map(accountsView);
  // 28 Oct 2026: accounts see what's approved (to order) and the history - approving is the directors'.
  return { toOrder: v.filter((r) => r.status === "APPROVED"), history: v.filter((r) => !OPEN.includes(r.status)) };
}

// Directors and the owner: requests waiting for a decision (new, waiting on an answer, or older checked ones), and
// the last 30 days decided. cannotDecide says why this login can't (not an approver, or they asked for it) - the page
// shows it instead of the buttons, as budgets do.
export async function listForDirectors(user: { id: string; role: string; name: string; email?: string }) {
  const since = new Date(`${addDays(todaySydney(), -30)}T00:00:00Z`);
  const rows = await prisma.purchaseRequest.findMany({
    where: { OR: [{ status: { in: ["REQUESTED", "NEEDS_INFO", "CHECKED"] } }, { decidedAt: { gte: since } }] }, include: withEvents, orderBy: { number: "desc" }, take: 200,
  });
  const actor: Actor = { kind: "DIRECTOR", role: user.role, name: user.name, userId: user.id, owner: isOwner(user.email) };
  return rows.map((r) => {
    const c = r.status === "REQUESTED" || r.status === "CHECKED" || r.status === "NEEDS_INFO" ? check("APPROVE", { ...r, status: "REQUESTED" }, actor) : null;
    return { ...accountsView(r), cannotDecide: c && "error" in c ? c.error : null };
  });
}

// The person's own requests (open, or changed in the last 90 days) - with their quotes and prices, never accounts'
// amount. `canEdit` = still with the approvers, so the description and quotes can change.
export async function listForRequester(who: Requester) {
  const rows = await prisma.purchaseRequest.findMany({
    where: { ...(who.kind === "LINK" ? { siteLinkId: who.linkId } : { requestedByUserId: who.userId }), OR: [{ status: { in: OPEN } }, { updatedAt: { gte: recent() } }] },
    include: withEvents, orderBy: { number: "desc" }, take: 100,
  });
  return rows.map((r) => ({ ...requesterRow(r), canEdit: canEditOwn(r.status) }));
}

// Everyone else's requests, read-only (Ilies, 2 Nov 2026: "ALL requests, read-only") - for every Manager, Admin and the
// coordinator on /purchases. Quotes and prices included; accounts' own amount and note are not.
export async function listOthers(userId: string) {
  const rows = await prisma.purchaseRequest.findMany({
    // A request from a link has no login id - it's someone else's too (SQL's NOT alone would drop those nulls).
    where: { AND: [{ OR: [{ requestedByUserId: null }, { NOT: { requestedByUserId: userId } }] }, { OR: [{ status: { in: OPEN } }, { updatedAt: { gte: recent() } }] }] },
    include: withEvents, orderBy: { number: "desc" }, take: 200,
  });
  return rows.map((r) => ({ ...requesterRow(r), canEdit: false }));
}

// A quote's file, for a route that has already decided the caller may see that request.
export async function quoteFile(quoteId: string) {
  return prisma.purchaseQuote.findUnique({
    where: { id: quoteId }, select: { fileName: true, fileMime: true, fileOriginalName: true, request: { select: { siteLinkId: true, requestedByUserId: true } } },
  });
}

// Accounts To do: approved requests waiting to be ordered.
export const purchasesWaiting = () => prisma.purchaseRequest.count({ where: { status: "APPROVED" } });

// Jobs a request can be for (the active ones), for the form's picker. Names only.
export const projectChoices = () =>
  prisma.project.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, jobNo: true }, orderBy: { name: "asc" }, take: 300 });
