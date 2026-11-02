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
import { alertBody, canEditOwn, chosenQuote, DESCRIPTION_MAX, kindOf, KIND_LABEL, MAX_QUOTES, parseQuote, type QuoteInput } from "./quotes";
import { checkQuoteFile, saveQuoteFile } from "./files";

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
async function quoteData(q: QuoteIn, by: { name: string; userId?: string | null }) {
  const fileName = q.file ? await saveQuoteFile(q.file) : null;
  return {
    supplier: q.supplier, priceExGst: q.priceExGst, details: q.details, linkUrl: q.linkUrl, createdBy: by.name, createdByUserId: by.userId ?? null,
    ...(q.file ? { fileName, fileMime: q.file.mime, fileOriginalName: q.file.name, fileSize: q.file.bytes.length } : {}),
  };
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
  // One request's files together stay a sensible size (each is capped in files.ts).
  if (quotes.reduce((n, q) => n + (q.file?.bytes.length ?? 0), 0) > 30 * 1024 * 1024) return { error: "The quote files come to more than 30 MB - send the big ones one at a time with Add another supplier." };
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

export async function createRequest(who: Requester, b: Record<string, unknown>): Promise<{ id: string; ref: string } | Problem> {
  // PUR-001 (27 Oct 2026): the Building Agent login never raises a purchase request - on any route.
  if (who.kind === "APP") {
    const u = await prisma.user.findUnique({ where: { id: who.userId }, select: { email: true } });
    if (u?.email.toLowerCase() === BUILDING_AGENT_EMAIL) return bad("The Building Agent login can't ask to buy things.", 403);
  }
  const p = parseNew(b);
  if ("error" in p) return bad(p.error!);
  if (p.data.projectId && !(await prisma.project.findUnique({ where: { id: p.data.projectId }, select: { id: true } }))) return bad("Pick the job again.");
  const by = { name: who.name, userId: who.kind === "APP" ? who.userId : null };
  const quotes: Awaited<ReturnType<typeof quoteData>>[] = [];
  for (const q of p.quotes) quotes.push(await quoteData(q, by));
  for (let attempt = 0; ; attempt++) {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const number = await nextNumber(tx);
        return tx.purchaseRequest.create({
          data: {
            ...p.data, number, requestedBy: who.name, source: who.kind,
            siteLinkId: who.kind === "LINK" ? who.linkId : null, requestedByUserId: who.kind === "APP" ? who.userId : null,
            events: { create: { action: "ASK", status: "REQUESTED", by: who.name } },
            quotes: { create: quotes },
          },
        });
      });
      // Straight to the approvers (28 Oct 2026) - not accounts.
      await alert(pushToUsers(await approversFor(row.requestedByUserId), { title: `${KIND_LABEL[kindOf(row.kind)]} request ${purchaseNo(row.number)} to approve`, body: alertBody(who.name, row.kind, purchaseNo(row.number)), url: "/directors/purchases", tag: "purchase-approve" }));
      return { id: row.id, ref: purchaseNo(row.number) };
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
export async function editOwnRequest(id: string, action: EditAction, who: { name: string; linkId?: string; userId?: string }, b: Record<string, unknown>): Promise<{ ok: true } | Problem> {
  const r = await prisma.purchaseRequest.findUnique({ where: { id }, include: { quotes: true } });
  const mine = r && ((who.linkId && r.siteLinkId === who.linkId) || (who.userId && r.requestedByUserId === who.userId));
  if (!r || !mine) return bad("Not found.", 404);
  if (!canEditOwn(r.status)) return bad(`It's ${STATUS_FOR_REQUESTER[r.status as Status]?.toLowerCase() ?? r.status} - it can't be changed now.`, 409);
  if (b.version !== undefined && Number(b.version) !== r.version) return bad("Someone else has just changed this - reload and try again.", 409);
  const by = { name: who.name, userId: who.userId ?? null };
  let note: string;
  if (action === "EDIT") {
    const data: Prisma.PurchaseRequestUpdateManyMutationInput = {};
    if ("what" in b) { const what = text(b.what, 200); if (!what || what.length < 3) return bad("Say what you need."); data.what = what; }
    if ("why" in b) data.why = text(b.why, DESCRIPTION_MAX);
    if ("qty" in b) data.qty = text(b.qty, 40);
    if ("kind" in b) data.kind = kindOf(b.kind);
    if ("neededBy" in b) { const d = text(b.neededBy, 10); if (d && !isIsoDate(d)) return bad("Pick the date it's needed by."); data.neededBy = d; }
    const done = await prisma.purchaseRequest.updateMany({ where: { id, version: r.version, status: r.status }, data: { ...data, version: r.version + 1 } });
    if (!done.count) return bad("Someone else has just changed this - reload and try again.", 409);
    note = "Description changed";
  } else if (action === "ADD_QUOTE") {
    if (r.quotes.length >= MAX_QUOTES) return bad(`Up to ${MAX_QUOTES} quotes on one request.`);
    const q = quoteIn(b.quote);
    if ("error" in q) return bad(q.error);
    const data = await quoteData(q.quote, by);
    const done = await prisma.purchaseRequest.updateMany({ where: { id, version: r.version, status: r.status }, data: { version: r.version + 1 } });
    if (!done.count) return bad("Someone else has just changed this - reload and try again.", 409);
    await prisma.purchaseQuote.create({ data: { ...data, requestId: id } });
    note = `Quote added: ${q.quote.supplier}`;
  } else {
    const existing = r.quotes.find((x) => x.id === b.quoteId);
    if (!existing) return bad("That quote isn't on this request - reload and try again.", 404);
    const sent = (b.quote && typeof b.quote === "object" ? b.quote : {}) as Record<string, unknown>;
    const q = quoteIn({ supplier: existing.supplier, priceExGst: existing.priceExGst, details: existing.details, linkUrl: existing.linkUrl, ...sent });
    if ("error" in q) return bad(q.error);
    const data = await quoteData(q.quote, by);
    const done = await prisma.purchaseRequest.updateMany({ where: { id, version: r.version, status: r.status }, data: { version: r.version + 1 } });
    if (!done.count) return bad("Someone else has just changed this - reload and try again.", 409);
    // A new file replaces the shown one; the old file stays on disk (nothing is deleted).
    const { createdBy: _c, createdByUserId: _u, ...change } = data;
    await prisma.purchaseQuote.update({ where: { id: existing.id }, data: { ...change, editedBy: by.name, editedAt: new Date() } });
    note = `Quote changed: ${q.quote.supplier}`;
  }
  await prisma.purchaseRequestEvent.create({ data: { requestId: id, action, status: r.status, by: who.name, note } });
  return { ok: true };
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
