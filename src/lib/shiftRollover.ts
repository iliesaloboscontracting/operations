// Shift rollover (19 Nov 2026, Ilies): "a night shift that starts on the 19th is the 19th's shift from start to
// finish ... nobody should sign in on the 20th to finish it." Two rules every sign-in on a job goes through:
//   1. Tonight's night shift takes new sign-ins only from 12 noon (lib/signin.ts signInRefusal).
//   2. Signed out of a NIGHT shift in the last 6 hours? A new sign-in asks first, on the screen doing it - "Back on the
//      same shift (counts to <day>)" or "This is a new shift" - never silently. "Same" signs them on that night job again
//      (today's behaviour, hours added); "New" goes ahead on the job picked, which rule 1 still restricts. The answer is
//      kept on the sign-in (SiteAttendance.shiftAnswer).
// Sign-in points (office / yard / truck QR) have no job and aren't asked. Signing OUT is never asked or refused.
import { prisma } from "./prisma";
import { countsTo, SAME_SHIFT_ASK_HOURS, shiftLabel, signInRefusal, sydneyTime } from "./signin";
import { linkLabel } from "./dailyLog/money";

export type ShiftAnswer = "SAME" | "NEW";
export const parseShiftAnswer = (v: unknown): ShiftAnswer | null => (v === "SAME" || v === "NEW" ? v : null);

type JobLike = { id: string; date: Date; shift: string; title: string; project: { id: string; name: string; regional?: boolean } | null };
// Their latest sign-out of a night shift (the job they were on, and when they signed out).
export type PriorShift = { attendanceId: string; signOutAt: Date; job: JobLike };

const HOUR = 3_600_000;
// Signed out within the window (and not in the future).
export const withinAsk = (signOutAt: Date, now = new Date()) => signOutAt.getTime() <= now.getTime() && now.getTime() - signOutAt.getTime() <= SAME_SHIFT_ASK_HOURS * HOUR;

// What the screen shows when it has to ask. Words and times only.
export type ShiftAsk = {
  shift: string; // "Calwell – Night shift Sun 15 → Mon 16 – hours count to Sun 15"
  countsTo: string; // "Sun 15"
  signedOut: string; // "4:51 am"
  sameOffered: boolean; // "Back on the same shift" can be picked here
  newOffered: boolean; // "This is a new shift" can be picked here
  newShift: string; // the job a new shift would be on
  sameNote: string | null; // why "same shift" isn't offered here
  tipRun: boolean; // a regional shift: point to "Start tip run" instead
};
export type Decision =
  | { kind: "GO"; jobId: string; answer: ShiftAnswer | null }
  | { kind: "ASK"; ask: ShiftAsk }
  | { kind: "REFUSE"; error: string };

// Where a new sign-in goes. `allowed` (a supervisor's link): the jobs this screen may sign people on to.
export function decideSignIn(o: { chosen: JobLike; prior: PriorShift | null; answer: unknown; now?: Date; tipRunOn?: boolean; allowed?: string[] }): Decision {
  const now = o.now ?? new Date();
  const chosenRefusal = signInRefusal(o.chosen, now);
  const prior = o.prior && withinAsk(o.prior.signOutAt, now) && o.prior.job.shift === "NIGHT" ? o.prior : null;
  if (!prior) return chosenRefusal ? { kind: "REFUSE", error: chosenRefusal } : { kind: "GO", jobId: o.chosen.id, answer: null };
  const sameJob = prior.job.id === o.chosen.id;
  const sameNote =
    !o.chosen.project || prior.job.project?.id !== o.chosen.project.id ? "That shift was at another site."
    : o.allowed && !o.allowed.includes(prior.job.id) ? "That shift isn't on this link."
    : signInRefusal(prior.job, now) ? "That shift has finished taking sign-ins - the office can add the time."
    : null;
  const sameOffered = !sameNote;
  const newOffered = !sameJob && !chosenRefusal;
  if (!sameOffered && !newOffered) return { kind: "REFUSE", error: chosenRefusal ?? sameNote! };
  const a = parseShiftAnswer(o.answer);
  if (a === "SAME" && sameOffered) return { kind: "GO", jobId: prior.job.id, answer: "SAME" };
  if (a === "NEW" && newOffered) return { kind: "GO", jobId: o.chosen.id, answer: "NEW" };
  return {
    kind: "ASK",
    // Names on a link: any "$" amount taken out (money-guard).
    ask: {
      shift: linkLabel(shiftLabel(prior.job), "Last night's shift"), countsTo: countsTo(prior.job.date), signedOut: sydneyTime(prior.signOutAt) ?? "",
      sameOffered, newOffered, newShift: linkLabel(shiftLabel(o.chosen), "This job"), sameNote,
      tipRun: !!o.tipRunOn && !!prior.job.project?.regional,
    },
  };
}

// The words for "you signed out of a night shift" (the screen builds its two buttons from the ask).
export const askText = (a: ShiftAsk) => `You signed out of ${a.shift} at ${a.signedOut}.`;

// Their latest sign-out of a night shift in the last 6 hours (a staff member, or a hire worker by name and company).
export async function recentNightShift(who: { resourceId: string | null; workerName: string; company: string | null }, now = new Date()): Promise<PriorShift | null> {
  const whoWhere = who.resourceId ? { resourceId: who.resourceId } : { resourceId: null, workerName: who.workerName, company: who.company };
  const row = await prisma.siteAttendance.findFirst({
    where: {
      ...whoWhere, status: { not: "REJECTED" }, removedAt: null, job: { shift: "NIGHT" },
      signOutAt: { gte: new Date(now.getTime() - SAME_SHIFT_ASK_HOURS * HOUR), lte: now },
    },
    orderBy: { signOutAt: "desc" },
    select: { id: true, signOutAt: true, job: { select: { id: true, date: true, shift: true, title: true, project: { select: { id: true, name: true, regional: true } } } } },
  });
  return row?.job && row.signOutAt ? { attendanceId: row.id, signOutAt: row.signOutAt, job: row.job } : null;
}
