// Yard jobs (Ilies, 4 Nov 2026): phone alerts to the yard - the YARD logins that
// turned alerts on (/yard, /api/push) and the phones on the yard's shared link
// (its own PushToggle, /api/site/<link>/push). And to the supervisor who asked,
// on their link, when it's ready. Amount-free: the summary goes through the same
// money check as every link screen. Alert failures never stop anything saving.
import type { SiteRequest } from "@prisma/client";
import { prisma } from "../prisma";
import { pushToSiteLinks, pushToUsers } from "../push";
import { assertNoMoney } from "../moneyGuard";
import { PRIORITY_DOT, requestNo, whenText, type Priority } from "../requestTypes";

const safe = (t: string) => (assertNoMoney(t) ? t : "Details are on the yard list");

async function yardTargets() {
  const [links, users] = await Promise.all([
    // The yard's shared phone link(s): an OFFICE link with no person (lib/yard/rules.ts isYardLink).
    prisma.siteLink.findMany({ where: { kind: "OFFICE", resourceId: null, revokedAt: null }, select: { id: true } }),
    // The YARD login(s) - the role is added by the yard-role branch; none exist before then.
    prisma.user.findMany({ where: { role: "YARD", active: true }, select: { id: true } }),
  ]);
  return { linkIds: links.map((l) => l.id), userIds: users.map((u) => u.id) };
}

// A new job on the yard's list (from a supervisor or an Admin), or a change the yard should
// know about (taken back by the office, cancelled, declined).
export async function notifyYard(r: SiteRequest, what: "NEW" | string): Promise<void> {
  try {
    const p = r.priority as Priority;
    const isNew = what === "NEW";
    const title = isNew ? `${PRIORITY_DOT[p] ?? ""} Yard job ${requestNo(r.number)} - ${r.siteLabel}`.trim() : `${requestNo(r.number)} · ${r.siteLabel}`;
    const body = isNew ? `${safe(r.summary)}\n${r.requestedBy} · needed by ${whenText(r.neededBy)}` : `${safe(what)}\n${safe(r.summary)}`;
    const { linkIds, userIds } = await yardTargets();
    const urgency = isNew && p !== "LOW" ? "high" : "normal";
    const silent = !isNew || p === "LOW";
    await Promise.all([
      pushToSiteLinks(linkIds, { title, body, url: "?go=yard", tag: `yard-${r.number}`, silent, sticky: isNew && p === "URGENT" }, urgency),
      pushToUsers(userIds, { title, body, url: `/yard?open=${r.id}`, tag: `yard-${r.number}`, silent, sticky: isNew && p === "URGENT" }, urgency),
    ]);
  } catch (e) {
    console.error("yard alert", e);
  }
}

// The supervisor who asked: it's ready to collect (their link's phones, if they turned alerts on).
export async function notifySupervisorReady(r: SiteRequest): Promise<void> {
  if (!r.siteLinkId) return;
  try {
    await pushToSiteLinks(
      [r.siteLinkId],
      { title: `${requestNo(r.number)} ready for collection`, body: `${safe(r.summary)} - at the yard`, url: "?go=requests", tag: `req-${r.number}` },
      "high",
    );
  } catch (e) {
    console.error("yard ready alert", e);
  }
}
