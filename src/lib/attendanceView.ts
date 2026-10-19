// The office's view of site sign-ins for a date (19 Oct 2026): each job's
// allocated crew next to who actually signed in, the hours that works out
// to, and what needs a look. Times only - never a dollar figure.
import { prisma } from "./prisma";
import { jobLabel, signedHours, sydneyTime } from "./signin";
import { todaySydney } from "./today";

export type AttendanceFlag =
  | "NO_SIGN_IN" // allocated, never signed in
  | "STILL_ON" // signed in today, not out yet
  | "NO_SIGN_OUT" // an earlier day, never signed out
  | "NOT_ALLOCATED" // signed in on a job they weren't allocated to
  | "TO_CONFIRM" // poster sign-in waiting for the supervisor
  | "MOVED" // signed in at another site, so this one was ended
  | "SHARED_PHONE" // one phone signed in more than one person that day
  | "REJECTED"; // supervisor said they weren't there

export async function attendanceForDate(date: string) {
  const today = todaySydney();
  const jobs = await prisma.job.findMany({
    where: { date: new Date(date + "T00:00:00.000Z"), status: { not: "COMPLETED" } },
    orderBy: [{ notRunning: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, title: true, shift: true, status: true, startTime: true, endTime: true,
      project: { select: { id: true, name: true, unpaidBreakMinutes: true } },
      assignments: { where: { resource: { type: "PERSONNEL" } }, select: { resource: { select: { id: true, name: true } } } },
      attendances: { orderBy: { signInAt: "asc" }, include: { edits: { orderBy: { editedAt: "asc" } } } },
    },
  });

  // Phones that signed in more than one person this date.
  const devices = new Map<string, Set<string>>();
  for (const j of jobs) for (const a of j.attendances) {
    if (!a.deviceId) continue;
    const who = a.resourceId ?? `${a.workerName}|${a.company}`;
    devices.set(a.deviceId, (devices.get(a.deviceId) ?? new Set()).add(who));
  }

  return jobs
    .filter((j) => j.status === "ACTIVE" || j.attendances.length > 0)
    .map((j) => {
      const breakMin = j.project?.unpaidBreakMinutes ?? null;
      const rows = j.attendances.map((a) => {
        const flags: AttendanceFlag[] = [];
        if (a.status === "TO_CONFIRM") flags.push("TO_CONFIRM");
        if (a.status === "REJECTED") flags.push("REJECTED");
        // Hire workers fill placeholder slots on the board, so only register
        // people can be "not allocated".
        if (!a.allocated && a.resourceId) flags.push("NOT_ALLOCATED");
        if (!a.signOutAt) flags.push(date < today ? "NO_SIGN_OUT" : "STILL_ON");
        if (a.signOutMethod === "MOVED") flags.push("MOVED");
        if (a.deviceId && (devices.get(a.deviceId)?.size ?? 0) > 1) flags.push("SHARED_PHONE");
        return {
          id: a.id,
          resourceId: a.resourceId,
          name: a.workerName,
          company: a.company,
          signInAt: a.signInAt.toISOString(),
          signOutAt: a.signOutAt?.toISOString() ?? null,
          in: sydneyTime(a.signInAt),
          out: sydneyTime(a.signOutAt),
          signInMethod: a.signInMethod,
          signOutMethod: a.signOutMethod,
          status: a.status,
          confirmedBy: a.confirmedBy,
          runBy: a.runBy,
          hours: a.status === "REJECTED" ? null : signedHours(a.signInAt, a.signOutAt, breakMin),
          flags,
          edits: a.edits.map((e) => ({ field: e.field, before: e.before, after: e.after, reason: e.reason, editedBy: e.editedBy, editedAt: e.editedAt.toISOString() })),
        };
      });
      const signedIn = new Set(j.attendances.filter((a) => a.status !== "REJECTED").map((a) => a.resourceId));
      const noShows = j.status === "ACTIVE" && date <= today
        ? j.assignments.filter((x) => !signedIn.has(x.resource.id)).map((x) => x.resource)
        : [];
      return {
        id: j.id,
        label: jobLabel(j),
        projectId: j.project?.id ?? null,
        shift: j.shift,
        times: j.startTime && j.endTime ? `${j.startTime}-${j.endTime}` : null,
        breakMinutes: breakMin,
        allocated: j.assignments.map((x) => x.resource),
        rows,
        noShows,
      };
    });
}

// Signed-in hours per person on a job (confirmed or waiting; rejected left
// out) - what Day Review shows next to the hours box.
export async function signInHoursForJobs(jobIds: string[]) {
  const rows = await prisma.siteAttendance.findMany({
    where: { jobId: { in: jobIds }, status: { not: "REJECTED" } },
    orderBy: { signInAt: "asc" },
    select: {
      jobId: true, resourceId: true, workerName: true, company: true, signInAt: true, signOutAt: true, status: true,
      job: { select: { project: { select: { unpaidBreakMinutes: true } } } },
    },
  });
  return rows.map((r) => ({
    jobId: r.jobId,
    resourceId: r.resourceId,
    name: r.workerName,
    company: r.company,
    in: sydneyTime(r.signInAt),
    out: sydneyTime(r.signOutAt),
    hours: signedHours(r.signInAt, r.signOutAt, r.job.project?.unpaidBreakMinutes),
    toConfirm: r.status === "TO_CONFIRM",
  }));
}
