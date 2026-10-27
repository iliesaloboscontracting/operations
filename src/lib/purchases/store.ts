// Accounts stage 6 (27 Oct 2026): purchase requests, server side. Alex asks (his OFFICE link or in-app), accounts
// check and price it, a DIRECTOR login approves, accounts order it. The rules are rules.ts; this file loads, saves,
// records an event per step and sends the existing push alerts. Amounts only ever leave here in accountsView().
// Design: docs/accounts/STAGE6-DESIGN.md §3.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { isOwner, OWNER_EMAIL } from "../owner";
import { pushToSiteLinks, pushToUsers, type PushMessage } from "../push";
import { todaySydney } from "../today";
import { addDays, isIsoDate } from "../accounts/calendar";
import { check, linkSafeText, OPEN, parseAmount, purchaseNo, requesterView, STATUS_FOR_REQUESTER, type Action, type Actor, type Status } from "./rules";

type Problem = { error: string; status: number };
const bad = (error: string, status = 400): Problem => ({ error, status });
const NO_MONEY = "Leave prices out - accounts add the amount when they check it.";

// Who is asking / acting. A link is Alex's personal OFFICE link; a login is anyone signed in.
export type Requester = { kind: "LINK"; linkId: string; name: string } | { kind: "APP"; userId: string; name: string };

const withEvents = { events: { orderBy: { at: "asc" as const } }, project: { select: { name: true, jobNo: true } } };
type Row = Prisma.PurchaseRequestGetPayload<{ include: typeof withEvents }>;

const projectName = (r: Row) => (r.project ? [r.project.jobNo, r.project.name].filter(Boolean).join(" ") : null);
const linkView = (r: Row) => ({ ...requesterView(r), projectName: projectName(r) });

// The Accounts / Directors shape: everything, amount included.
export function accountsView(r: Row) {
  return {
    ...requesterView(r), projectName: projectName(r), source: r.source, amountExGst: r.amountExGst, accountsNote: r.accountsNote,
    checkedBy: r.checkedBy, checkedAt: r.checkedAt?.toISOString() ?? null, decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote, orderedBy: r.orderedBy, orderedAt: r.orderedAt?.toISOString() ?? null, closedReason: r.closedReason,
    events: r.events.map((e) => ({ action: e.action, status: e.status, by: e.by, at: e.at.toISOString(), note: e.note })),
  };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

function parseNew(b: Record<string, unknown>) {
  const what = text(b.what, 200), why = text(b.why, 600), qty = text(b.qty, 40), supplier = text(b.supplier, 120);
  if (!what || what.length < 3) return { error: "Say what you need." };
  if (![what, why, qty, supplier].every(linkSafeText)) return { error: NO_MONEY };
  const linkUrl = text(b.linkUrl, 500);
  if (linkUrl && !/^https?:\/\/\S+$/i.test(linkUrl)) return { error: "The link should start with http:// or https://." };
  const neededBy = text(b.neededBy, 10);
  if (neededBy && !isIsoDate(neededBy)) return { error: "Pick the date it's needed by." };
  const projectId = text(b.projectId, 40);
  return { data: { what, why, qty, supplier, linkUrl, neededBy, projectId } };
}

async function nextNumber(db: Prisma.TransactionClient) {
  const top = await db.purchaseRequest.aggregate({ _max: { number: true } });
  return (top._max.number ?? 0) + 1;
}

const roleUsers = async (role: string) => (await prisma.user.findMany({ where: { role, active: true }, select: { id: true } })).map((u) => u.id);
const ownerUsers = async () => (await prisma.user.findMany({ where: { email: OWNER_EMAIL, active: true }, select: { id: true } })).map((u) => u.id);
const alert = (p: Promise<unknown>) => p.catch((e) => console.error("purchase alert failed", e));

// Status words only, never an amount (D-money).
async function tellRequester(r: { siteLinkId: string | null; requestedByUserId: string | null; number: number }, status: Status) {
  const msg: PushMessage = { title: `Purchase ${purchaseNo(r.number)}`, body: STATUS_FOR_REQUESTER[status], url: "", tag: `purchase-${r.number}` };
  if (r.siteLinkId) await alert(pushToSiteLinks([r.siteLinkId], { ...msg, url: "?go=purchases" }));
  else if (r.requestedByUserId) await alert(pushToUsers([r.requestedByUserId], { ...msg, url: "/purchases" }));
}

export async function createRequest(who: Requester, b: Record<string, unknown>): Promise<{ id: string; ref: string } | Problem> {
  const p = parseNew(b);
  if ("error" in p) return bad(p.error!);
  if (p.data.projectId && !(await prisma.project.findUnique({ where: { id: p.data.projectId }, select: { id: true } }))) return bad("Pick the job again.");
  for (let attempt = 0; ; attempt++) {
    try {
      const row = await prisma.$transaction(async (tx) => {
        const number = await nextNumber(tx);
        return tx.purchaseRequest.create({
          data: {
            ...p.data, number, requestedBy: who.name, source: who.kind,
            siteLinkId: who.kind === "LINK" ? who.linkId : null, requestedByUserId: who.kind === "APP" ? who.userId : null,
            events: { create: { action: "ASK", status: "REQUESTED", by: who.name } },
          },
        });
      });
      await alert(pushToUsers(await roleUsers("ACCOUNTS"), { title: `Purchase request ${purchaseNo(row.number)}`, body: `${who.name}: ${row.what}`.slice(0, 140), url: "/accounts/purchases", tag: "purchase-new" }));
      return { id: row.id, ref: purchaseNo(row.number) };
    } catch (e) {
      // Two requests at the same moment took the same number - take the next one.
      if (attempt < 3 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

// One step on a request. The route decides who the actor is; ownership of REQUESTER steps is checked here.
export async function actOnRequest(
  id: string, action: Action, actor: Actor, who: { name: string; linkId?: string; userId?: string }, b: Record<string, unknown>,
): Promise<{ ok: true; status: Status } | Problem> {
  const r = await prisma.purchaseRequest.findUnique({ where: { id } });
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
    case "CHECK": {
      const amount = parseAmount(b.amountExGst);
      if (amount == null) return bad("Enter the amount ex GST.");
      note = text(b.accountsNote, 600);
      Object.assign(data, { amountExGst: amount, accountsNote: note, checkedBy: who.name, checkedAt: now });
      break;
    }
    case "ASK_INFO": {
      note = text(b.question, 400);
      if (!note || note.length < 3) return bad("Write the question for them.");
      if (!linkSafeText(note)) return bad("Leave the amount out of the question - they can't see prices.");
      Object.assign(data, { infoQuestion: note, infoAnswer: null });
      break;
    }
    case "ANSWER": {
      note = text(b.answer, 600);
      if (!note) return bad("Write your answer.");
      if (!linkSafeText(note)) return bad(NO_MONEY);
      data.infoAnswer = note;
      break;
    }
    case "CLOSE": {
      note = text(b.reason, 300);
      if (!note || note.length < 3) return bad("Say why it's being closed (not needed, a duplicate ...).");
      data.closedReason = note;
      break;
    }
    case "CANCEL":
      break;
    case "APPROVE":
    case "DECLINE": {
      note = text(b.note, 400);
      if (action === "DECLINE" && (!note || note.length < 3)) return bad("Say why it's declined.");
      if (note && !linkSafeText(note)) return bad("Leave amounts out of the note - the requester sees it.");
      Object.assign(data, { decidedBy: who.name, decidedAt: now, decisionNote: note });
      break;
    }
    case "ORDERED": {
      note = text(b.note, 300);
      Object.assign(data, { orderedBy: who.name, orderedAt: now });
      break;
    }
  }
  // The version in the where makes two people acting at once safe: the second gets "changed" instead of overwriting.
  const done = await prisma.purchaseRequest.updateMany({ where: { id, version: r.version, status: r.status }, data: { ...(data as Prisma.PurchaseRequestUpdateManyMutationInput), version: r.version + 1 } });
  if (!done.count) return bad("Someone else has just changed this - reload and try again.", 409);
  await prisma.purchaseRequestEvent.create({ data: { requestId: id, action, status: ok.to, by: who.name, note } });

  if (ok.to === "CHECKED") await alert(pushToUsers([...await roleUsers("DIRECTOR"), ...await ownerUsers()], { title: `Purchase ${purchaseNo(r.number)} to approve`, body: r.what.slice(0, 140), url: "/directors/purchases", tag: "purchase-approve" }));
  if (ok.to === "REQUESTED") await alert(pushToUsers(await roleUsers("ACCOUNTS"), { title: `Purchase ${purchaseNo(r.number)} answered`, body: `${r.requestedBy} answered your question.`, url: "/accounts/purchases", tag: "purchase-new" }));
  if (ok.to === "APPROVED" || ok.to === "DECLINED") await alert(pushToUsers(await roleUsers("ACCOUNTS"), { title: `Purchase ${purchaseNo(r.number)} ${ok.to === "APPROVED" ? "approved" : "declined"}`, body: r.what.slice(0, 140), url: "/accounts/purchases", tag: "purchase-decided" }));
  if (["NEEDS_INFO", "APPROVED", "DECLINED", "ORDERED", "CLOSED"].includes(ok.to)) await tellRequester(r, ok.to);
  return { ok: true, status: ok.to };
}

const recent = () => new Date(`${addDays(todaySydney(), -90)}T00:00:00Z`);

export async function listForAccounts() {
  const rows = await prisma.purchaseRequest.findMany({
    where: { OR: [{ status: { in: OPEN } }, { updatedAt: { gte: recent() } }] }, include: withEvents, orderBy: { number: "desc" }, take: 400,
  });
  const v = rows.map(accountsView);
  const by = (s: Status) => v.filter((r) => r.status === s);
  return { toCheck: by("REQUESTED"), waitingInfo: by("NEEDS_INFO"), withDirectors: by("CHECKED"), toOrder: by("APPROVED"), history: v.filter((r) => !OPEN.includes(r.status)) };
}

// Directors: the checked ones to decide, and the last 30 days decided. cannotDecide says why this login can't
// (not a DIRECTOR login, or they asked for it) - the page shows it instead of the buttons, as budgets do.
export async function listForDirectors(user: { role: string; name: string; email?: string }) {
  const since = new Date(`${addDays(todaySydney(), -30)}T00:00:00Z`);
  const rows = await prisma.purchaseRequest.findMany({
    where: { OR: [{ status: "CHECKED" }, { decidedAt: { gte: since } }] }, include: withEvents, orderBy: { number: "desc" }, take: 200,
  });
  const actor: Actor = { kind: "DIRECTOR", role: user.role, name: user.name, owner: isOwner(user.email) };
  return rows.map((r) => {
    const c = r.status === "CHECKED" ? check("APPROVE", r, actor) : null;
    return { ...accountsView(r), cannotDecide: c && "error" in c ? c.error : null };
  });
}

// The person's own requests (open, or changed in the last 90 days) - no amounts.
export async function listForRequester(who: Requester) {
  const rows = await prisma.purchaseRequest.findMany({
    where: { ...(who.kind === "LINK" ? { siteLinkId: who.linkId } : { requestedByUserId: who.userId }), OR: [{ status: { in: OPEN } }, { updatedAt: { gte: recent() } }] },
    include: withEvents, orderBy: { number: "desc" }, take: 100,
  });
  return rows.map(linkView);
}

// Accounts To do: requests waiting for accounts (to check, or approved to order).
export const purchasesWaiting = () => prisma.purchaseRequest.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } });

// Jobs a request can be for (the active ones), for the form's picker. Names only.
export const projectChoices = () =>
  prisma.project.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, jobNo: true }, orderBy: { name: "asc" }, take: 300 });
