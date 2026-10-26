// The Accounts screen, server side (26 Oct 2026, stage 1 of Victoria's list):
// the calendar of due dates and reminders, and "Pending for me" - read from
// what Operations already records (the invoices inbox, questions to accounts,
// sign-ins with no sign-out), never a second copy. Design: the plan approved
// by Ilies 26 Oct 2026 (stage 1).
import { prisma } from "../prisma";
import { todaySydney } from "../today";
import { pushToUsers } from "../push";
import { OPEN_STATUSES } from "../requestTypes";
import { addDays, alertDue, categoryLabel, isCategory, isIsoDate, isRepeat, nextDate, whenOf } from "./calendar";

type Problem = { error: string; status: number };
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ---------- calendar ----------

function parseItem(b: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || "title" in b) {
    const t = text(b.title, 120);
    if (t.length < 2) return { error: "Give it a short name." };
    out.title = t;
  }
  if (!partial || "category" in b) {
    if (!isCategory(b.category)) return { error: "Pick what kind of item it is." };
    out.category = b.category;
  }
  if (!partial || "dueDate" in b) {
    if (!isIsoDate(b.dueDate)) return { error: "Give the date it's due." };
    out.dueDate = b.dueDate;
    out.anchorDay = Number((b.dueDate as string).slice(8, 10));
  }
  if (!partial || "repeat" in b) out.repeat = isRepeat(b.repeat) ? b.repeat : "NONE";
  if ("kind" in b) out.kind = b.kind === "REMINDER" ? "REMINDER" : "DUE";
  if ("amount" in b) {
    const raw = typeof b.amount === "string" ? b.amount.replace(/[$,\s]/g, "") : b.amount;
    if (raw === "" || raw == null) out.amount = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1e8) return { error: "The amount doesn't look right." };
      out.amount = Math.round(n * 100) / 100;
    }
  }
  if ("payee" in b) out.payee = text(b.payee, 80) || null;
  if ("notes" in b) out.notes = text(b.notes, 1000) || null;
  if ("alertDays" in b) {
    const n = Number(b.alertDays);
    out.alertDays = Number.isFinite(n) ? Math.min(30, Math.max(0, Math.round(n))) : 3;
  }
  return { data: out };
}

export async function listItems(opts: { all?: boolean } = {}) {
  const rows = await prisma.accountsItem.findMany({
    where: opts.all ? {} : { status: "OPEN" },
    orderBy: [{ dueDate: "asc" }, { title: "asc" }],
    take: 500,
  });
  const today = todaySydney();
  return rows.map((r) => ({ ...r, categoryLabel: categoryLabel(r.category), when: r.status === "OPEN" ? whenOf(r, today) : null }));
}

export async function createItem(by: string, body: Record<string, unknown>): Promise<{ id: string } | Problem> {
  const p = parseItem(body, false);
  if ("error" in p) return { error: p.error!, status: 400 };
  const row = await prisma.accountsItem.create({ data: { ...(p.data as { title: string; category: string; dueDate: string }), createdBy: by } });
  return { id: row.id };
}

// EDIT fields / DONE (a repeating item moves to its next date) / CANCEL / REOPEN.
export async function actOnItem(by: string, id: string, body: Record<string, unknown>): Promise<{ ok: true; nextDueDate?: string | null } | Problem> {
  const item = await prisma.accountsItem.findUnique({ where: { id } });
  if (!item) return { error: "That item isn't there any more.", status: 404 };
  const action = String(body.action ?? "EDIT").toUpperCase();
  if (action === "DONE") {
    if (item.status !== "OPEN") return { error: "It's already closed.", status: 409 };
    const next = nextDate(item.dueDate, item.repeat, item.anchorDay ?? Number(item.dueDate.slice(8, 10)));
    await prisma.accountsItem.update({
      where: { id },
      data: next
        ? { dueDate: next, alertedFor: null, lastDoneAt: new Date(), lastDoneBy: by }
        : { status: "DONE", lastDoneAt: new Date(), lastDoneBy: by },
    });
    return { ok: true, nextDueDate: next };
  }
  if (action === "CANCEL") {
    await prisma.accountsItem.update({ where: { id }, data: { status: "CANCELLED", lastDoneBy: by, lastDoneAt: new Date() } });
    return { ok: true };
  }
  if (action === "REOPEN") {
    await prisma.accountsItem.update({ where: { id }, data: { status: "OPEN" } });
    return { ok: true };
  }
  const p = parseItem(body, true);
  if ("error" in p) return { error: p.error!, status: 400 };
  const data = p.data as Record<string, unknown>;
  if (data.dueDate && data.dueDate !== item.dueDate) data.alertedFor = null;
  await prisma.accountsItem.update({ where: { id }, data });
  return { ok: true };
}

// From the instrumentation tick: a phone alert to the accounts login(s) once per due date.
export async function alertAccountsDue() {
  const today = todaySydney();
  const open = await prisma.accountsItem.findMany({ where: { status: "OPEN", dueDate: { lte: addDays(today, 30) } } });
  const due = open.filter((i) => alertDue(i, today));
  if (!due.length) return 0;
  const users = (await prisma.user.findMany({ where: { role: "ACCOUNTS", active: true }, select: { id: true } })).map((u) => u.id);
  for (const i of due) {
    const w = whenOf(i, today);
    const lead = w === "OVERDUE" ? "Overdue" : w === "TODAY" ? "Due today" : `Due ${i.dueDate.slice(8, 10)}/${i.dueDate.slice(5, 7)}`;
    if (users.length) {
      await pushToUsers(users, { title: `${lead}: ${i.title}`, body: i.kind === "REMINDER" ? (i.notes ?? "Reminder") : categoryLabel(i.category), url: "/accounts", tag: `acc-${i.id}` }, "normal")
        .catch(() => undefined);
    }
    await prisma.accountsItem.update({ where: { id: i.id }, data: { alertedFor: i.dueDate } });
  }
  return due.length;
}

// ---------- pending for me ----------

export async function pendingForAccounts() {
  const today = todaySydney();
  const weekAgo = addDays(today, -14);
  const [inbox, queries, noSignOut, items, reimbursements, abnToCheck] = await Promise.all([
    prisma.invoiceDraft.count({ where: { status: { in: ["NEEDS_REVIEW", "NO_JOB"] }, upload: { clearedAt: null } } }),
    prisma.siteRequest.findMany({
      where: { kind: "QUERY", assigneeName: "Accounts", answer: null, status: { in: OPEN_STATUSES } },
      select: { id: true, number: true, summary: true, neededBy: true }, orderBy: { createdAt: "asc" }, take: 50,
    }),
    // Payroll: sign-ins in the last fortnight that never signed out (not the ones still on site today).
    prisma.siteAttendance.findMany({
      where: { date: { gte: weekAgo, lt: today }, signOutAt: null, status: { not: "REJECTED" } },
      select: { id: true, date: true, workerName: true, company: true, placeLabel: true, job: { select: { project: { select: { name: true } }, title: true } } },
      orderBy: [{ date: "asc" }, { workerName: "asc" }], take: 200,
    }),
    listItems(),
    prisma.reimbursement.count({ where: { status: "TO_PAY" } }), // stage 3
    prisma.abnInvoice.count({ where: { status: "TO_CHECK" } }), // stage 4
  ]);
  return {
    today,
    inboxWaiting: inbox,
    reimbursementsToPay: reimbursements,
    abnInvoicesToCheck: abnToCheck,
    queries: queries.map((q) => ({ id: q.id, ref: `R-${String(q.number).padStart(4, "0")}`, summary: q.summary, neededBy: q.neededBy })),
    noSignOut: noSignOut.map((a) => ({ id: a.id, date: a.date, name: a.workerName, company: a.company, site: a.job?.project?.name ?? a.job?.title ?? a.placeLabel ?? "Sign-in point" })),
    due: items.filter((i) => i.when !== "LATER"),
    comingUp: items.filter((i) => i.when === "LATER" && i.dueDate <= addDays(today, 14)),
  };
}
