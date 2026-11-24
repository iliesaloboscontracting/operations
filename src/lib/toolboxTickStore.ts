// The database side of the supervisor's toolbox check (POST /api/site/:token/submit TICK_CHECK / CHECK_ACTION), for
// the security follow-ups Ilies approved on 25 Nov 2026:
//   TT-003 - at most TICK_DAILY_LIMIT tick checks a Sydney day per link, counted before anything is written;
//   TT-005 - the ToolboxCheck and its CHECK SiteSubmission are saved together or not at all (one transaction, which
//            also holds the count, so two phones at once can't both slip past the limit);
//   TT-002 - "Mark missing" goes through the tool's change history (updateTracked -> RecordChange): who, which link,
//            which check.
import type { CheckResult } from "./toolboxCheck";
import { prisma } from "./prisma";
import { updateTracked, writeLock } from "./history/store";
import { fromSydneyLocal } from "./shiftTimes";
import { todaySydney } from "./today";
import { markMissingSource, tickLimitReached } from "./toolboxTick";

// Sydney's midnight at the start of today, as an instant.
const sydneyMidnight = () => fromSydneyLocal(`${todaySydney()}T00:00`) ?? new Date(Date.now() - 24 * 3600_000);

// A link's tick checks today: its CHECK submissions with no photos (a photo check always has 1 to 4).
const TICK_SUBMISSION = (linkId: string, since: Date) => ({ siteLinkId: linkId, kind: "CHECK", photoIds: "[]", createdAt: { gte: since } });

export async function saveTickCheck(linkId: string, toolboxId: string, result: CheckResult, by: string): Promise<{ limited: true } | { limited: false; checkId: string }> {
  return prisma.$transaction(async (tx) => {
    await writeLock(tx);
    const today = await tx.siteSubmission.count({ where: TICK_SUBMISSION(linkId, sydneyMidnight()) });
    if (tickLimitReached(today)) return { limited: true as const };
    const check = await tx.toolboxCheck.create({
      data: { toolboxId, photoIds: "[]", result: JSON.stringify(result), checkedBy: by },
    });
    await tx.siteSubmission.create({
      data: { siteLinkId: linkId, kind: "CHECK", photoIds: "[]", toolboxId, checkId: check.id, status: "APPLIED", reviewedBy: by, reviewedAt: new Date() },
    });
    return { limited: false as const, checkId: check.id };
  });
}

// Which check a "Mark missing" came from. The phone sends the id its check reply carried; it must be a check of this
// toolbox sent through this same link (else false - refused). Without one (an older page), the link's latest check of
// the box, or null if it never checked it.
export async function checkIdFor(linkId: string, toolboxId: string, given: unknown): Promise<string | null | false> {
  if (given !== undefined && given !== null && given !== "") {
    if (typeof given !== "string") return false;
    const sub = await prisma.siteSubmission.findFirst({ where: { siteLinkId: linkId, toolboxId, kind: "CHECK", checkId: given }, select: { checkId: true } });
    return sub?.checkId ?? false;
  }
  const latest = await prisma.siteSubmission.findFirst({
    where: { siteLinkId: linkId, toolboxId, kind: "CHECK", checkId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { checkId: true },
  });
  return latest?.checkId ?? null;
}

// The tool is Missing on the register, recorded in its change history with the link's person as who did it.
export function markToolMissing(toolId: string, who: { name: string; linkId: string; checkId: string | null }) {
  return updateTracked("Tool", toolId, { condition: "Missing" }, { by: { id: null, name: who.name }, source: markMissingSource(who.linkId, who.checkId) });
}
