// Completing a project that still has bookings ahead (Ilies, 18 Nov 2026: "when a project is said completed but has
// bookings further ahead, let's prompt it to say, do you mean stand down or inactive for now?").
//
// A project PATCH that sets COMPLETED (from any other status) while the project has live jobs from today on - not
// cancelled, not completed - is answered 409 { code: "has-bookings", bookings } until the body says what to do:
//   bookings: "STAND_DOWN"      -> the project is stood down instead (status INACTIVE); every booking stays.
//   bookings: "CANCEL_BOOKINGS" -> each booking nobody has signed in on (and with no daily log) is cancelled through
//                                  the ordinary cancel (lib/jobCancel.ts - kept forever, reason "project completed"),
//                                  then the project is Completed. Bookings with sign-ins / logs, or on a closed day,
//                                  are left as they are and listed back.
// Changing a project's status never touched its jobs before this; it still doesn't unless "CANCEL_BOOKINGS" is chosen.
import { prisma } from "./prisma";
import { cancelJob } from "./jobCancel";
import { todaySydney } from "./today";
import type { Booking } from "./projectLists";

export const PROJECT_COMPLETED_REASON = "project completed";

export async function bookingsAhead(projectId: string, today = todaySydney()): Promise<Booking[]> {
  const jobs = await prisma.job.findMany({
    where: { projectId, cancelledAt: null, status: { not: "COMPLETED" }, date: { gte: new Date(`${today}T00:00:00.000Z`) } },
    orderBy: [{ date: "asc" }, { shift: "asc" }],
    select: { id: true, date: true, shift: true, _count: { select: { attendances: true, dailyLogs: true } } },
  });
  return jobs.map((j) => ({ id: j.id, date: j.date.toISOString().slice(0, 10), shift: j.shift, signIns: j._count.attendances, dailyLogs: j._count.dailyLogs }));
}

export type BookingsOutcome = { cancelled: Booking[]; kept: (Booking & { why: string })[] };

export async function cancelBookings(bookings: Booking[], who: { id: string; name: string }): Promise<BookingsOutcome> {
  const out: BookingsOutcome = { cancelled: [], kept: [] };
  const closed = new Set(
    (await prisma.dayClose.findMany({ where: { date: { in: [...new Set(bookings.map((b) => b.date))] }, status: "CLOSED" }, select: { date: true } })).map((d) => d.date)
  );
  for (const b of bookings) {
    if (closed.has(b.date)) { out.kept.push({ ...b, why: "the day is closed" }); continue; }
    const r = await cancelJob(b.id, who, PROJECT_COMPLETED_REASON, "Project completed");
    if ("error" in r) out.kept.push({ ...b, why: r.status === 409 ? "people signed in or a daily log is recorded" : r.error });
    else out.cancelled.push(b);
  }
  return out;
}
