// "Waiting on you" (Directors, 10 Nov 2026), server side: reads what's waiting for one director from the existing
// stores - their open questions (lib/findings/queries), contract-value proposals they may approve (lib/changes),
// budgets from Estimating (lib/budgets), active jobs with no contract value (Tracking's own rule), jobs logging hours
// with no approved budget (the daily log's rule), and the Directors screen's "not available yet" list. Nothing is
// copied: each action is the existing flow (answer, approve, propose, office chat). Rules: ./rules.ts.
import { prisma } from "../prisma";
import { hasDirectorAccess, type AuthUser } from "../auth";
import { isOwner, OWNER_EMAIL } from "../owner";
import { queriesForUser, type AssigneeQueryView } from "../findings/queries";
import { listChanges, type ChangeDTO } from "../changes/store";
import { listBudgets } from "../budgets/estimating";
import { cannotDecide, type BudgetListItem } from "../budgets/rules";
import { pickBudget } from "../dailyLog/checks";
import { lacksContractValue } from "../trackingData";
import { startThread } from "../messages/store";
import { canMessage, chatName } from "../messages/rules";
import { pushToUsers } from "../push";
import {
  ASK_STATE, DIRECTORS_SCREEN_START, REMINDER_KIND, askCounts, askIliesText, askKey, countWaiting, directorPeople, groupItems, mondayDecision,
  mondayWindow, notSetUp, reminderKey, reminderOff, reminderPush, waitingOnText, whoCanApprove, whyItMatters,
  type Login, type WaitingItem,
} from "./rules";

// Asking Ilies to set something up is recorded per login, per item, per week (a ShiftReminder row, like the other
// once-only alerts) - so the page can say "Sent to Ilies <when>" and it survives a restart. Never deleted.
export const ASK_KIND = "DIRECTOR_ASK_ILIES";
const askPrefix = (userId: string, key: string) => `${userId}:${key}:`;

type Viewer = Pick<AuthUser, "id" | "email" | "name" | "role" | "directorAccess">;

export type WaitingDTO = {
  asAt: string;
  total: number;
  groups: { id: string; title: string; count: number; items: (WaitingItem & { query?: AssigneeQueryView; change?: ChangeDTO })[] }[];
  canSendToIlies: boolean;
};

async function activeLogins(): Promise<(Login & { email: string })[]> {
  const rows = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true, directorAccess: true, active: true } });
  return rows.map((u) => ({ ...u, directorAccess: hasDirectorAccess(u) }));
}

export async function loadWaiting(me: Viewer, now = new Date()): Promise<WaitingDTO> {
  const items: (WaitingItem & { query?: AssigneeQueryView; change?: ChangeDTO })[] = [];

  // 1. Questions to this login, still to answer (Directors -> My queries). FYI notes are just marked read.
  const queries = (await queriesForUser(me.id)).filter((q) => q.canAnswer || q.canMarkRead);
  for (const q of queries) {
    items.push({
      id: `q:${q.id}`, group: "QUESTIONS", kind: "QUESTION", what: q.title ?? q.question, why: whyItMatters("QUESTION", { questionWhy: q.why }),
      since: q.askedAt, counts: true, action: { type: "ANSWER", queryId: q.id }, query: q,
    });
  }

  // 2a. Contract values this login may approve (the Directors box's COMMERCIAL proposals).
  const commercial = await listChanges(me, { open: true, audience: "COMMERCIAL" });
  const open = commercial.filter((c) => c.status === "PROPOSED" && new Date(c.expiresAt).getTime() > now.getTime());
  for (const c of open.filter((x) => x.canApprove)) {
    items.push({
      id: `c:${c.id}`, group: "APPROVALS", kind: "CHANGE", what: `${c.label} for ${c.recordName}: ${c.before} → ${c.after} (${c.ref})`,
      why: whyItMatters("CHANGE"), since: c.createdAt, counts: true, action: { type: "APPROVE", changeId: c.id }, change: c,
    });
  }

  // 2b. Budgets from Estimating waiting for a DIRECTOR login's decision (Directors -> Budgets to approve).
  const budgets = await listBudgets().catch(() => ({ ok: false as const, status: 0, error: "down" }));
  const rows: BudgetListItem[] | null = budgets.ok ? budgets.data : null;
  if (!rows) {
    items.push({ id: "budgets:down", group: "APPROVALS", kind: "BUDGETS_INFO", what: "Budgets to approve - Estimating can't be reached right now", why: whyItMatters("BUDGETS_INFO"), since: null, counts: false, action: { type: "NONE", text: "Try again later, or ask Ilies." } });
  } else {
    const submitted = rows.filter((b) => b.status === "SUBMITTED");
    const mine = submitted.filter((b) => !cannotDecide(me, b));
    for (const b of mine) {
      items.push({
        id: `b:${b.estimate_id}/${b.revision}`, group: "APPROVALS", kind: "BUDGET", what: `Budget: ${b.estimate_name}${b.jobNo ? ` (${b.jobNo})` : ""} r${b.revision}`,
        why: whyItMatters("BUDGET"), since: b.submitted_at?.instant ?? null, counts: true,
        action: { type: "OPEN", href: `/directors/budgets/${encodeURIComponent(b.estimate_id)}/${b.revision}`, label: "Approve or reject" },
      });
    }
    const others = submitted.length - mine.length;
    if (others > 0) {
      items.push({
        id: "budgets:others", group: "APPROVALS", kind: "BUDGETS_INFO", what: `${others} budget${others === 1 ? "" : "s"} waiting for Nick or Yoel`,
        why: "Budgets are approved from a director login.", since: null, counts: false, action: { type: "NONE", text: cannotDecide(me, submitted.find((b) => cannotDecide(me, b))!) ?? "" },
      });
    }
  }

  // 3a. Active jobs with no contract value (Tracking's own rule; the Yard is overhead). One proposal at a time per job.
  const logins = await activeLogins();
  const [projects, findings, waitingCv] = await Promise.all([
    prisma.project.findMany({ where: { archived: false, status: "ACTIVE" }, select: { id: true, name: true, status: true, jobNo: true, quoteNo: true, contractValue: true, createdAt: true } }),
    prisma.finding.findMany({ where: { ruleCode: "DATA_NO_CONTRACT_VALUE", subjectType: "PROJECT", openKey: { not: null } }, select: { subjectId: true, firstSeenAt: true } }),
    prisma.changeProposal.findMany({ where: { kind: "PROJECT_CONTRACT_VALUE", status: "PROPOSED", expiresAt: { gt: now } }, select: { id: true, number: true, recordId: true, requestedBy: true, requestedByUserId: true, sourcePerson: true } }),
  ]);
  const firstSeen = new Map(findings.map((f) => [f.subjectId, f.firstSeenAt]));
  const proposalFor = new Map(waitingCv.map((p) => [p.recordId, p]));
  for (const p of projects.filter((x) => lacksContractValue(x))) {
    const waiting = proposalFor.get(p.id);
    const mineToApprove = waiting ? open.find((c) => c.id === waiting.id && c.canApprove) : null;
    const base = { id: `cv:${p.id}`, group: "FIGURES" as const, kind: "NO_CONTRACT_VALUE" as const, what: `${p.name}${p.jobNo ? ` (${p.jobNo})` : ""} - no contract value`, why: whyItMatters("NO_CONTRACT_VALUE"), since: (firstSeen.get(p.id) ?? p.createdAt).toISOString() };
    if (!waiting) items.push({ ...base, counts: true, action: { type: "ENTER_VALUE", projectId: p.id } });
    else if (mineToApprove) items.push({ ...base, counts: false, action: { type: "NONE", text: `A value is proposed (P-${String(waiting.number).padStart(4, "0")}) - approve it under Approvals waiting.` } });
    else items.push({ ...base, counts: false, action: { type: "NONE", text: waitingOnText(whoCanApprove(logins, { kind: "PROJECT_CONTRACT_VALUE", requestedBy: waiting.requestedBy, requestedByUserId: waiting.requestedByUserId, sourcePerson: waiting.sourcePerson })) } });
  }

  // 3b. Jobs logging daily-log hours with no approved budget (the daily log's own NO_BUDGET rule). It counts only when
  // a submitted budget for that job is waiting for this login - otherwise there's nothing a director can approve yet.
  const logged = await prisma.dailyLog.groupBy({ by: ["projectId"], where: { projectId: { not: null } }, _min: { createdAt: true } });
  if (logged.length) {
    const logProjects = projects.filter((p) => logged.some((l) => l.projectId === p.id));
    if (!rows) {
      if (logProjects.length) items.push({ id: "nb:down", group: "FIGURES", kind: "NO_BUDGET", what: "Jobs with no approved budget - can't be checked while Estimating is unreachable", why: whyItMatters("NO_BUDGET"), since: null, counts: false, action: { type: "NONE", text: "Try again later." } });
    } else {
      for (const p of logProjects) {
        if (pickBudget(rows, p, "APPROVED")) continue;
        const sub = pickBudget(rows, p, "SUBMITTED");
        const decidable = sub && !cannotDecide(me, sub);
        items.push({
          id: `nb:${p.id}`, group: "FIGURES", kind: "NO_BUDGET", what: `${p.name}${p.jobNo ? ` (${p.jobNo})` : ""} - no approved budget`, why: whyItMatters("NO_BUDGET"),
          since: logged.find((l) => l.projectId === p.id)?._min.createdAt?.toISOString() ?? null, counts: !!decidable,
          action: sub
            ? decidable ? { type: "OPEN", href: `/directors/budgets/${encodeURIComponent(sub.estimate_id)}/${sub.revision}`, label: "Approve or reject" } : { type: "NONE", text: cannotDecide(me, sub) ?? "" }
            : { type: "NONE", text: "No budget submitted from Estimating yet - ask Ilies." },
        });
      }
    }
  }

  // 4. Decisions not made yet: the overview's "Not available yet", one line each; "Send to Ilies" (office chat).
  const asks = (await prisma.shiftReminder.findMany({ where: { kind: ASK_KIND, jobId: { startsWith: `${me.id}:` } }, orderBy: { sentAt: "desc" }, select: { jobId: true, sentAt: true, people: true } }))
    .filter((a) => askCounts(a.people)); // a failed send isn't "sent"
  const owner = isOwner(me.email);
  for (const n of notSetUp()) {
    const last = asks.find((a) => a.jobId.startsWith(askPrefix(me.id, n.key)))?.sentAt ?? null;
    const thisWeek = asks.some((a) => a.jobId === askKey(me.id, n.key, now));
    items.push({
      id: `ns:${n.key}`, group: "DECISIONS", kind: "NOT_SET_UP", what: `${n.name} - what's needed: ${n.needed}`, why: whyItMatters("NOT_SET_UP", { kpiName: n.name }),
      since: new Date(DIRECTORS_SCREEN_START).toISOString(), counts: !owner && !last,
      action: owner ? { type: "NONE", text: "Yours to set up." } : thisWeek ? { type: "NONE", text: "Sent to Ilies this week." } : { type: "SEND_TO_ILIES", key: n.key },
      sentAt: last ? last.toISOString() : null,
    });
  }

  const groups = groupItems(items).map(({ id, title, count, items: rowsIn }) => ({ id, title, count, items: rowsIn as WaitingDTO["groups"][number]["items"] }));
  return { asAt: now.toISOString(), total: countWaiting(items), groups, canSendToIlies: !owner && canMessage(me.role) };
}

// "Send to Ilies": a one-to-one office-chat message to the owner (the existing chat - he gets its phone alert, can
// reply, and it's kept with its history). Once a week (Monday-Sunday, Sydney) per item per login.
// PS-039: claim first, then send. The claim is a ShiftReminder row keyed (login:item:week, DIRECTOR_ASK_ILIES) - unique
// on (jobId, kind) - so of two requests at once only one makes the row and sends; the other gets 409. A failed send
// marks its claim FAILED (kept) and the next tap takes it again; so does a claim stuck SENDING for over 5 minutes.
const STUCK_MS = 5 * 60_000;
type Send = (me: Viewer, toUserId: string, body: string) => Promise<{ id: string } | { error: string; status: number }>;
const chatSend: Send = (me, toUserId, body) =>
  startThread({ userId: me.id, role: me.role, email: me.email, name: chatName(me.name, me.email, me.role) }, { toUserId, body });

export async function sendToIlies(me: Viewer, key: string, now = new Date(), opts: { send?: Send } = {}): Promise<{ ok: true } | { error: string; status: number }> {
  const item = notSetUp().find((n) => n.key === key);
  if (!item) return { error: "Not found.", status: 404 };
  if (isOwner(me.email)) return { error: "That's you - nothing to send.", status: 400 };
  if (!canMessage(me.role)) return { error: "Your login can't send messages.", status: 403 };
  const ownerLogin = await prisma.user.findFirst({ where: { email: OWNER_EMAIL, active: true }, select: { id: true } });
  if (!ownerLogin) return { error: "Ilies's login isn't active.", status: 409 };

  const jobId = askKey(me.id, key, now);
  let claimed = await prisma.shiftReminder.create({ data: { jobId, kind: ASK_KIND, people: ASK_STATE.SENDING, sentAt: now } }).then(() => true, () => false);
  if (!claimed) {
    // The row is there: take it again only if its send failed (or is stuck) - one conditional update, so one winner.
    claimed = (await prisma.shiftReminder.updateMany({
      where: { jobId, kind: ASK_KIND, OR: [{ people: ASK_STATE.FAILED }, { people: ASK_STATE.SENDING, sentAt: { lt: new Date(now.getTime() - STUCK_MS) } }] },
      data: { people: ASK_STATE.SENDING, sentAt: now },
    })).count === 1;
  }
  if (!claimed) return { error: "Already sent to Ilies this week.", status: 409 };

  const mark = (people: number) => prisma.shiftReminder.updateMany({ where: { jobId, kind: ASK_KIND }, data: { people } }).catch(() => null);
  let sent: Awaited<ReturnType<Send>>;
  try {
    sent = await (opts.send ?? chatSend)(me, ownerLogin.id, askIliesText(item.name, item.needed));
  } catch {
    sent = { error: "Couldn't send it - try again.", status: 502 };
  }
  if ("error" in sent) {
    await mark(ASK_STATE.FAILED);
    return sent;
  }
  await mark(ASK_STATE.SENT);
  return { ok: true };
}

// ---------- the Monday-morning alert (instrumentation tick) ----------

// Monday 8:00-11:59 Sydney: each director (one per person, active, push alerts on) with something waiting gets one
// phone alert - "N things waiting on you". One per person per week (a ShiftReminder row claims it first). N = 0, no
// phone, or DIRECTOR_WAITING_REMINDER=off -> nothing. `count` is for the release check (N = 0 on real data).
export async function mondayWaitingReminder(now = new Date(), opts: { count?: (u: Viewer) => Promise<number> } = {}): Promise<{ recorded: number; sent: number }> {
  const week = mondayWindow(now);
  if (reminderOff() || !week) return { recorded: 0, sent: 0 };
  const people = directorPeople(await activeLogins());
  let recorded = 0, sent = 0;
  for (const p of people) {
    const key = reminderKey(p.primary.id, week);
    const alreadySent = !!(await prisma.shiftReminder.findUnique({ where: { jobId_kind: { jobId: key, kind: REMINDER_KIND } } }));
    const hasDevice = (await prisma.pushDevice.count({ where: { userId: { in: p.ids } } })) > 0;
    if (alreadySent || !hasDevice) continue;
    const viewer = p.primary as Viewer;
    const n = opts.count ? await opts.count(viewer) : (await loadWaiting(viewer, now)).total;
    const d = mondayDecision({ off: false, week, active: p.primary.active, alreadySent, hasDevice, n });
    if (!d.send) continue;
    const claimed = await prisma.shiftReminder.create({ data: { jobId: key, kind: REMINDER_KIND, people: n } }).catch(() => null);
    if (!claimed) continue;
    recorded++;
    sent += await pushToUsers(p.ids, reminderPush(n), "normal");
  }
  return { recorded, sent };
}

// Called every minute; only looks inside the Monday window, and at most every 10 minutes there.
let lastLook = 0;
export async function mondayWaitingTick(now = new Date()) {
  if (reminderOff() || !mondayWindow(now) || now.getTime() - lastLook < 10 * 60_000) return;
  lastLook = now.getTime();
  await mondayWaitingReminder(now);
}
