// Site requests: telling Ilies's phone the moment something arrives or
// changes (Web Push - lib/push.ts). Urgent and High alert straight away,
// Low arrives silently; an Urgent one still unopened after 15 minutes
// alerts again (up to 3 times). Alert failures never stop a request saving.
import type { SiteRequest } from "@prisma/client";
import { prisma } from "./prisma";
import { pushToAdmins, pushToSiteLinks, pushToUsers, type PushMessage } from "./push";
import { NEEDS_ILIES, OFFICE_KINDS, PRIORITY_DOT, PRIORITY_LABEL, alertRouteFor, requestHref, requestNo, whenText, type Priority } from "./requestTypes";
import { OWNER_EMAIL } from "./owner";
import { addEvent } from "./siteRequests";

const urlOf = (r: SiteRequest) => requestHref(r);

// Actions and queries (Phase 2): only their assignee, or only the owner -
// never every Admin (requestTypes.ts alertRouteFor). Nothing to do = no push.
async function pushRouted(r: SiteRequest, when: "NEW" | "UPDATE", msg: PushMessage, urgency: "high" | "normal") {
  const route = alertRouteFor(r, when);
  if (route === "ASSIGNEE_USER" && r.assigneeUserId) await pushToUsers([r.assigneeUserId], msg, urgency);
  else if (route === "ASSIGNEE_LINKS" && r.assigneeId) {
    const links = await prisma.siteLink.findMany({ where: { resourceId: r.assigneeId, revokedAt: null }, select: { id: true } });
    await pushToSiteLinks(links.map((l) => l.id), msg, urgency);
  } else if (route === "OWNER") {
    const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } });
    if (owner) await pushToUsers([owner.id], msg, urgency);
  }
}

export async function notifyNewRequest(r: SiteRequest): Promise<void> {
  const p = r.priority as Priority;
  if (alertRouteFor(r, "NEW") !== "ADMINS") {
    await pushRouted(r, "NEW", { title: `${requestNo(r.number)} · ${r.siteLabel}`, body: r.summary, url: urlOf(r), tag: `req-${r.number}` }, p === "LOW" ? "normal" : "high").catch((e) => console.error("request alert", e));
    return;
  }
  await pushToAdmins(
    {
      title: `${PRIORITY_DOT[p]} ${PRIORITY_LABEL[p]} request - ${r.siteLabel}`,
      body: `${r.summary}\n${r.requestedBy} · needed by ${whenText(r.neededBy)}`,
      url: urlOf(r),
      tag: `req-${r.number}`,
      silent: p === "LOW",
      sticky: p === "URGENT",
    },
    p === "LOW" ? "normal" : "high",
  ).catch((e) => console.error("request alert", e));
}

// Changes that need Ilies (an answer, "can't do") alert; the rest (done,
// cancelled) arrive silently.
export async function notifyRequestUpdate(r: SiteRequest, what: string): Promise<void> {
  const needsYou = NEEDS_ILIES.includes(r.status);
  if (alertRouteFor(r, "UPDATE") !== "ADMINS") {
    await pushRouted(r, "UPDATE", { title: `${requestNo(r.number)} · ${r.siteLabel}`, body: `${what}
${r.summary}`, url: urlOf(r), tag: `req-${r.number}`, silent: !needsYou }, needsYou ? "high" : "normal").catch((e) => console.error("request alert", e));
    return;
  }
  await pushToAdmins(
    { title: `${requestNo(r.number)} · ${r.siteLabel}`, body: `${what}\n${r.summary}`, url: urlOf(r), tag: `req-${r.number}`, silent: !needsYou },
    needsYou ? "high" : "normal",
  ).catch((e) => console.error("request alert", e));
}

const REALERT_MINUTES = 15;
const MAX_REALERTS = 3;

// Run every minute (instrumentation.ts): Urgent requests not yet opened.
export async function realertUnopenedUrgent() {
  const due = new Date(Date.now() - REALERT_MINUTES * 60_000);
  const rows = await prisma.siteRequest.findMany({
    // Site requests only - actions and queries never re-alert every Admin.
    where: { priority: "URGENT", status: "SENT", createdAt: { lte: due }, kind: { notIn: OFFICE_KINDS } },
    include: { events: { where: { action: "REALERT" }, orderBy: { at: "desc" } } },
  });
  for (const r of rows) {
    if (r.events.length >= MAX_REALERTS) continue;
    if (r.events[0] && r.events[0].at > due) continue;
    const mins = Math.round((Date.now() - r.createdAt.getTime()) / 60_000);
    await pushToAdmins(
      { title: `🔴 Still not opened (${mins} min) - ${r.siteLabel}`, body: `${r.summary}\n${r.requestedBy} · needed by ${whenText(r.neededBy)}`, url: urlOf(r), tag: `req-${r.number}`, sticky: true },
      "high",
    ).catch((e) => console.error("request re-alert", e));
    await addEvent(r.id, "REALERT", "Operations", `Re-alerted after ${mins} min unopened`);
  }
}
