// Fix 1 (Ilies, 2 Nov 2026): a person is never counted at two places at once. Signing in by ANY path - a phone scan,
// a poster, an office / yard / truck point, a supervisor ticking them in, or the office adding one - while they still
// have another sign-in open ends that one at the new sign-in time, with a note kept in AttendanceEdit ("moved").
// (The hours maths also merges any overlap that's left - lib/dayHours.ts.)
import { prisma } from "./prisma";
import { lockedWeekFor } from "./timesheets";

type Who = { resourceId: string | null; workerName: string; company: string | null };
type Here = { jobId: string | null; place?: string | null; vehicleId?: string | null };

const OPEN_WINDOW_MS = 20 * 3_600_000; // same window the phone path always used

export async function endOpenElsewhere(o: { who: Who; at: Date; here: Here; label: string; by: string; siteToConfirm?: boolean }) {
  const whoWhere = o.who.resourceId ? { resourceId: o.who.resourceId } : { resourceId: null, workerName: o.who.workerName, company: o.who.company };
  const rows = await prisma.siteAttendance.findMany({
    where: { ...whoWhere, signOutAt: null, status: { not: "REJECTED" }, removedAt: null, signInAt: { gte: new Date(o.at.getTime() - OPEN_WINDOW_MS), lt: o.at } },
    select: { id: true, jobId: true, date: true, place: true, vehicleId: true },
  });
  // "Here" is left out in code, not in the query: a Prisma NOT on a nullable column (jobId) is SQL NOT (jobId = x),
  // which is NULL - so office / yard / truck lines (no job) were silently never ended when someone moved to a site.
  const isHere = (r: { jobId: string | null; place: string | null; vehicleId: string | null }) =>
    o.here.jobId ? r.jobId === o.here.jobId : r.jobId === null && r.place === (o.here.place ?? null) && r.vehicleId === (o.here.vehicleId ?? null);
  const open = rows.filter((r) => !isHere(r));
  const ended: { id: string; jobId: string | null; date: string }[] = [];
  for (const e of open) {
    if (await lockedWeekFor(e.date)) continue; // an approved week is never changed
    await prisma.siteAttendance.update({
      where: { id: e.id },
      data: {
        signOutAt: o.at, signOutMethod: "MOVED",
        // The phone path has always sent a site line ended this way to its supervisor to confirm.
        ...(o.siteToConfirm && e.jobId ? { status: "TO_CONFIRM" } : {}),
        edits: { create: { field: "signOutAt", before: null, after: o.at.toISOString(), reason: `Signed in at ${o.label} - this one ended then (counted once)`, editedBy: o.by } },
      },
    });
    ended.push(e);
  }
  return ended;
}
