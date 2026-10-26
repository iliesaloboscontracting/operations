// The office changing a sign-in (moved here 24 Oct 2026 so one-at-a-time
// and "sign out selected" follow exactly the same rules). Only the office
// changes a time; every change is kept - before, after, why and who - in
// AttendanceEdit; nothing is overwritten without a trace, nothing deleted.
import type { SiteAttendance } from "@prisma/client";
import { prisma } from "./prisma";
import { parseTime } from "./signin";
import { lockedWeekFor } from "./timesheets";

const STATUSES = ["CONFIRMED", "TO_CONFIRM", "REJECTED"];

export type OfficeChange = { signInAt?: unknown; signOutAt?: unknown; status?: unknown };

// Applies one change. Returns an error to show, or { changed }. The caller
// re-syncs Day Review hours for the affected jobs afterwards.
export async function applyOfficeChange(a: SiteAttendance, body: OfficeChange, reason: string, by: string): Promise<{ error: string } | { changed: boolean }> {
  if (await lockedWeekFor(a.date)) return { error: "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its sign-ins can change." };
  const data: Record<string, unknown> = {};
  const edits: { field: string; before: string | null; after: string | null }[] = [];
  if ("signInAt" in body) {
    const t = parseTime(body.signInAt);
    if (!t) return { error: "The sign-in time isn't valid." };
    if (t.getTime() !== a.signInAt.getTime()) {
      data.signInAt = t;
      edits.push({ field: "signInAt", before: a.signInAt.toISOString(), after: t.toISOString() });
    }
  }
  if ("signOutAt" in body) {
    const t = body.signOutAt === null || body.signOutAt === "" ? null : parseTime(body.signOutAt);
    if (body.signOutAt && !t) return { error: "The sign-out time isn't valid." };
    if ((t?.getTime() ?? null) !== (a.signOutAt?.getTime() ?? null)) {
      data.signOutAt = t;
      data.signOutMethod = t ? "OFFICE" : null;
      edits.push({ field: "signOutAt", before: a.signOutAt?.toISOString() ?? null, after: t?.toISOString() ?? null });
    }
  }
  if ("status" in body) {
    if (!STATUSES.includes(String(body.status))) return { error: "Unknown status." };
    if (body.status !== a.status) {
      data.status = body.status;
      data.confirmedBy = `${by} (office)`;
      data.confirmedAt = new Date();
      edits.push({ field: "status", before: a.status, after: String(body.status) });
    }
  }
  const signIn = (data.signInAt as Date | undefined) ?? a.signInAt;
  const signOut = "signOutAt" in data ? (data.signOutAt as Date | null) : a.signOutAt;
  if (signOut && signOut <= signIn) return { error: "Sign-out must be after sign-in." };
  if (edits.length === 0) return { changed: false };
  await prisma.siteAttendance.update({
    where: { id: a.id },
    data: { ...data, edits: { create: edits.map((e) => ({ ...e, reason, editedBy: by })) } },
  });
  return { changed: true };
}

// An Admin removing a sign-in - e.g. someone who signed in twice (27 Oct 2026, Ilies: "a delete button").
// It isn't erased: it goes to REJECTED, so it counts for no hours anywhere (timesheets, payroll, Day Review
// all leave REJECTED out), and it's hidden from the Sign-ins page and the supervisor's crew list. The edit
// log keeps who, when and why. Same lock as any office change.
export async function removeAttendance(a: SiteAttendance, reason: string, by: string): Promise<{ error: string } | { ok: true }> {
  if (a.removedAt) return { error: "That sign-in has already been removed." };
  if (await lockedWeekFor(a.date)) return { error: "That week's timesheet has been approved - an Admin has to reopen it (Timesheets page) before its sign-ins can change." };
  await prisma.siteAttendance.update({
    where: { id: a.id },
    data: {
      status: "REJECTED", removedAt: new Date(), removedBy: by,
      edits: { create: [{ field: "removed", before: a.status, after: "REMOVED", reason, editedBy: by }] },
    },
  });
  return { ok: true };
}
