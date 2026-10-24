// Hire check (Site Requests stage 3, 24 Oct 2026). A supervisor's link lists
// the hire-register items on their sites ("Hire on my site") and asks:
// still needed / finished - call it off / not on site. It asks when an item
// is due back within 3 days (again each day until it's sorted), and once a
// week otherwise. Answers that need the office become ordinary site requests
// (Ilies decides, Alex actions), so nothing new to learn and nothing lost:
//  - Finished       -> an Off-hire request; the item shows "off-hire requested"
//  - Not on site    -> a "Hire not on site" request (register mismatch)
//  - Still needed on or after its expected finish -> a "Hire still needed"
//                      request, so the off-hire date gets moved
// Names, sites and dates only - no rates or costs reach the site link.
import { prisma } from "./prisma";
import type { ResolvedLink } from "./siteLinks";
import { insertRequest, sitesFor } from "./siteRequests";
import { HIRE_EXTEND_TYPE, HIRE_MISMATCH_TYPE, OFF_HIRE_TYPE, OPEN_STATUSES, type Priority, type RequestType } from "./requestTypes";
import { notifyNewRequest } from "./requestAlerts";
import { todaySydney } from "./today";
import { daysBetween } from "./dates";

export const HIRE_ANSWERS = ["STILL_NEEDED", "FINISHED", "NOT_ON_SITE"] as const;
export type HireAnswer = (typeof HIRE_ANSWERS)[number];
const DUE_SOON_DAYS = 3;
const DAY_MS = 86_400_000;

export type SiteHireItem = {
  id: string;
  name: string;
  supplier: string | null;
  ref: string | null;
  site: string;
  onHireDate: string | null;
  offHireDate: string | null;
  daysLeft: number | null; // to the expected finish; negative = overdue
  offHireAsked: boolean;
  last: { answer: HireAnswer; by: string; at: string } | null;
  askNow: boolean;
};

// The hire-register items on the sites this link is booked on (the last week
// to a week out; a hand-over link: its one job's site). Not office links.
export async function hireForLink(link: ResolvedLink): Promise<SiteHireItem[]> {
  if (link.kind === "OFFICE") return [];
  const { mine } = await sitesFor(link, 7);
  if (!mine.length) return [];
  const today = todaySydney();
  const siteName = new Map(mine.map((m) => [m.id, m.name]));
  const items = await prisma.resource.findMany({
    where: {
      type: "HIRE", active: true, hireProjectId: { in: [...siteName.keys()] },
      // (a "not" filter on its own would also drop blank values)
      AND: [{ OR: [{ category: null }, { category: { not: "LABOUR" } }] }, { OR: [{ hireStatus: null }, { hireStatus: { not: "RETURNED" } }] }],
    },
    select: { id: true, name: true, agency: true, hireRef: true, hireProjectId: true, hireStatus: true, onHireDate: true, offHireDate: true },
    orderBy: { name: "asc" },
  });
  // Only what should be there now - not something booked to arrive later.
  const onSite = items.filter((i) => !i.onHireDate || i.onHireDate <= today);
  const checks = await prisma.hireCheck.findMany({ where: { resourceId: { in: onSite.map((i) => i.id) } }, orderBy: { createdAt: "desc" } });
  const lastOf = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!lastOf.has(c.resourceId)) lastOf.set(c.resourceId, c);

  return onSite
    .map((i) => {
      const last = lastOf.get(i.id);
      const daysLeft = i.offHireDate ? daysBetween(today, i.offHireDate) : null;
      const dueSoon = daysLeft != null && daysLeft <= DUE_SOON_DAYS;
      const age = last ? Date.now() - last.createdAt.getTime() : Infinity;
      const offHireAsked = i.hireStatus === "OFF_HIRE_REQUESTED";
      return {
        id: i.id, name: i.name, supplier: i.agency, ref: i.hireRef, site: siteName.get(i.hireProjectId as string) ?? "",
        onHireDate: i.onHireDate, offHireDate: i.offHireDate, daysLeft, offHireAsked,
        last: last ? { answer: last.answer as HireAnswer, by: last.by, at: last.createdAt.toISOString() } : null,
        askNow: !offHireAsked && age > (dueSoon ? DAY_MS - 3_600_000 : 7 * DAY_MS),
      };
    })
    .sort((a, b) => Number(b.askNow) - Number(a.askNow) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
}

// An open request this item already raised for the same answer - so a second
// tap doesn't send the office a duplicate.
async function openRequestFor(resourceId: string, answer: HireAnswer) {
  const prev = await prisma.hireCheck.findMany({
    where: { resourceId, answer, requestId: { not: null } },
    orderBy: { createdAt: "desc" }, take: 3, select: { requestId: true },
  });
  if (!prev.length) return null;
  return prisma.siteRequest.findFirst({ where: { id: { in: prev.map((p) => p.requestId as string) }, status: { in: OPEN_STATUSES } } });
}

const clean = (x: unknown, max = 300) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

export async function answerHire(link: ResolvedLink, body: Record<string, unknown>): Promise<{ error: string } | { message: string }> {
  const answer = String(body.answer) as HireAnswer;
  if (!HIRE_ANSWERS.includes(answer)) return { error: "Pick an answer." };
  const item = (await hireForLink(link)).find((i) => i.id === body.itemId);
  if (!item) return { error: "That item isn't on your sites any more - pull down to refresh." };
  const note = clean(body.note, 300) || null;
  const by = link.person.name;
  const resource = await prisma.resource.findUnique({ where: { id: item.id }, select: { hireProjectId: true } });
  const projectId = resource?.hireProjectId ?? null;

  // What the office needs to act on, if anything.
  let raise: { type: RequestType; priority: Priority; neededBy: Date; message: string } | null = null;
  if (answer === "FINISHED" && !item.offHireAsked) {
    raise = { type: OFF_HIRE_TYPE, priority: "HIGH", neededBy: new Date(Date.now() + 2 * 3_600_000), message: "Thanks - the office has been asked to call it off." };
  } else if (answer === "NOT_ON_SITE") {
    raise = { type: HIRE_MISMATCH_TYPE, priority: "HIGH", neededBy: new Date(Date.now() + DAY_MS), message: "Flagged to the office - they'll check the hire register." };
  } else if (answer === "STILL_NEEDED" && item.daysLeft != null && item.daysLeft <= 0) {
    raise = { type: HIRE_EXTEND_TYPE, priority: "LOW", neededBy: new Date(Date.now() + DAY_MS), message: "Noted - the office will move its off-hire date." };
  }

  let requestId: string | null = null;
  let message = answer === "FINISHED" ? "Already being called off - thanks." : "Thanks - noted.";
  if (raise) {
    const existing = await openRequestFor(item.id, answer);
    if (existing) {
      requestId = existing.id;
      message = "Already with the office - thanks.";
    } else if (projectId) {
      const details: Record<string, string> = { item: item.name };
      if (item.supplier) details.supplier = item.supplier;
      if (item.ref) details.ref = item.ref;
      if (item.offHireDate) details.due = item.offHireDate;
      const made = await insertRequest({
        kind: raise.type.kind, priority: raise.priority, neededBy: raise.neededBy,
        project: { id: projectId, name: item.site }, summary: raise.type.summary(details).slice(0, 200),
        details, note: note ? `From the hire check: ${note}` : "From the hire check.", photoFile: null,
        by, byId: link.person.id, siteLinkId: link.id,
      });
      if ("error" in made) return made;
      requestId = made.request.id;
      message = raise.message;
      if (answer === "FINISHED") await prisma.resource.update({ where: { id: item.id }, data: { hireStatus: "OFF_HIRE_REQUESTED" } });
      notifyNewRequest(made.request).catch(() => undefined);
    }
  }
  await prisma.hireCheck.create({ data: { resourceId: item.id, projectId, siteLinkId: link.id, answer, note, by, requestId } });
  return { message };
}

// For the office Hire page: each item's latest answer from site.
export async function latestHireChecks() {
  const rows = await prisma.hireCheck.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  const out: Record<string, { answer: string; by: string; at: string; note: string | null }> = {};
  for (const r of rows) if (!out[r.resourceId]) out[r.resourceId] = { answer: r.answer, by: r.by, at: r.createdAt.toISOString(), note: r.note };
  return out;
}
