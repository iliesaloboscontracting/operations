// The database side of a tool fault reported from a supervisor's link (Ilies, 27 Nov 2026 - "Any tool, plus 'not in
// the list'"). Rules are in ./toolFaults.ts.
//   - A fault on a listed tool is a FAULT SiteSubmission with the tool, as before (now any tool on the register).
//   - "Not in the list" is a FAULT SiteSubmission with NO tool and its required photo. No schema change: toolId was
//     already optional on SiteSubmission. Its `reading` holds { unlisted: true, status, seen } - what the photo reader
//     saw, filled in just after the reply (next/server after()), so the phone never waits on it.
//   - The office (From site, Manager+) links it to a tool when logging it - lib/toolFaultStore.applyFault.
import { prisma } from "./prisma";
import { fromSydneyLocal } from "./shiftTimes";
import { todaySydney } from "./today";
import { readFaultPhoto, VisionNotConfigured } from "./toolVision";
import {
  cleanSeen, faultReadLimitReached, faultReadingOn, reportable, type MatchTool, type UnlistedReading,
} from "./toolFaults";

const sydneyMidnight = () => fromSydneyLocal(`${todaySydney()}T00:00`) ?? new Date(Date.now() - 24 * 3600_000);
// `unlisted: true` stays on the reading after the office links a tool, so the day's count holds.
const UNLISTED_TODAY = (since: Date) => ({ kind: "FAULT", reading: { contains: '"unlisted":true' }, createdAt: { gte: since } });

export async function saveUnlistedFault(linkId: string, description: string, photoId: string) {
  const reading: UnlistedReading = { unlisted: true, status: "WAITING" };
  const sub = await prisma.siteSubmission.create({
    data: { siteLinkId: linkId, kind: "FAULT", photoIds: JSON.stringify([photoId]), toolId: null, toolboxId: null, description, reading: JSON.stringify(reading) },
  });
  return sub.id;
}

// Read the photo of a "Not in the list" fault and keep what was seen. Never throws: whatever goes wrong, the fault stays
// as sent and the office sees why it wasn't read. Off with TOOL_FAULT_READING=off, or with no ANTHROPIC_API_KEY (no
// outbound call at all), and past the daily caps.
export async function readUnlistedFault(subId: string, linkId: string, fileName: string) {
  const done = (r: UnlistedReading) => prisma.siteSubmission.update({ where: { id: subId }, data: { reading: JSON.stringify(r) } }).catch(() => undefined);
  if (!faultReadingOn()) return done({ unlisted: true, status: "NOT_READ", reason: "Photo reading is switched off - pick the tool from the photo." });
  if (!process.env.ANTHROPIC_API_KEY) return done({ unlisted: true, status: "NOT_READ", reason: "Photo reading isn't set up - pick the tool from the photo." });
  const since = sydneyMidnight();
  const [linkToday, allToday] = await Promise.all([
    prisma.siteSubmission.count({ where: { ...UNLISTED_TODAY(since), siteLinkId: linkId, id: { not: subId } } }),
    prisma.siteSubmission.count({ where: { ...UNLISTED_TODAY(since), id: { not: subId } } }),
  ]);
  if (faultReadLimitReached(linkToday, allToday)) return done({ unlisted: true, status: "NOT_READ", reason: "Today's photo reading limit was reached - pick the tool from the photo." });
  try {
    const seen = cleanSeen(await readFaultPhoto(fileName));
    return done({ unlisted: true, status: "READ", seen });
  } catch (e) {
    return done({ unlisted: true, status: "NOT_READ", reason: e instanceof VisionNotConfigured ? "Photo reading isn't set up - pick the tool from the photo." : "The photo couldn't be read - pick the tool from the photo." });
  }
}

// Every tool a fault can be on, for suggestions and the office's picker.
export async function matchTools(): Promise<MatchTool[]> {
  const tools = await prisma.tool.findMany({
    where: { retiredAt: null, condition: { not: "Swapped out" } },
    orderBy: { tag: "asc" },
    select: { id: true, tag: true, name: true, brand: true, model: true, serialNumber: true, toolbox: { select: { name: true } } },
  });
  return tools.map(({ toolbox, ...t }) => ({ ...t, toolboxName: toolbox?.name ?? null }));
}

// The office logs a site fault (From site -> Log fault): the tool's fault (ToolIssue), the photo attached to the tool,
// and "Needs repair" unless they say it still works. A "Not in the list" fault needs the tool the office picked (any
// tool on the register) and records it on the submission. One transaction; the status check is part of the write, so
// two people pressing at once can't log it twice.
export type ApplyResult = { ok: true; issueId: string } | { ok: false; status: number; error: string };

export async function applyFault(subId: string, pickedToolId: unknown, notWorking: boolean, reviewedBy: string | null): Promise<ApplyResult> {
  const sub = await prisma.siteSubmission.findUnique({
    where: { id: subId },
    include: { siteLink: { select: { label: true, resource: { select: { name: true } } } } },
  });
  if (!sub || sub.kind !== "FAULT") return { ok: false, status: 404, error: "not found" };
  if (sub.status !== "PENDING") return { ok: false, status: 409, error: "This has already been dealt with." };
  let toolId = sub.toolId;
  if (!toolId) {
    const picked = typeof pickedToolId === "string" && pickedToolId ? await prisma.tool.findUnique({ where: { id: pickedToolId }, select: { id: true, retiredAt: true, condition: true } }) : null;
    if (!reportable(picked)) return { ok: false, status: 400, error: "Pick the tool this fault is on - or add it to the register first." };
    toolId = picked!.id;
  }
  let photoId: string | null = null;
  try {
    photoId = (JSON.parse(sub.photoIds) as string[])[0] ?? null;
  } catch {
    photoId = null;
  }
  const reportedBy = `${sub.siteLink.resource?.name ?? sub.siteLink.label ?? "Shared link"} (site)`;
  try {
    const issueId = await prisma.$transaction(async (tx) => {
      const claimed = await tx.siteSubmission.updateMany({
        where: { id: sub.id, status: "PENDING" },
        data: { status: "APPLIED", reviewedBy, reviewedAt: new Date(), ...(sub.toolId ? {} : { toolId }) },
      });
      if (claimed.count !== 1) throw new AlreadyDealt();
      const issue = await tx.toolIssue.create({ data: { toolId: toolId!, description: sub.description ?? "", photoId, reportedBy } });
      if (photoId) await tx.toolPhoto.updateMany({ where: { id: photoId }, data: { toolId } });
      if (notWorking) await tx.tool.update({ where: { id: toolId! }, data: { condition: "Needs repair" } });
      await tx.siteSubmission.update({ where: { id: sub.id }, data: { appliedRef: issue.id } });
      return issue.id;
    });
    return { ok: true, issueId };
  } catch (e) {
    if (e instanceof AlreadyDealt) return { ok: false, status: 409, error: "This has already been dealt with." };
    throw e;
  }
}

class AlreadyDealt extends Error {}
