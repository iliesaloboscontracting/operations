import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { JOB_CANCELLED_SIGN_IN, createSignIn } from "@/lib/signInCreate";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink, siteUrl, type ResolvedLink } from "@/lib/siteLinks";
import { syncPersonDayQuietly, syncSignInActualsQuietly } from "@/lib/signInActuals";
import { endOpenElsewhere } from "@/lib/signinOverlap";
import { fromSydneyLocal } from "@/lib/shiftTimes";
import { todaySydney } from "@/lib/today";
import { createHandover, jobLabel, openJob, openJobsFor, ROTATE_SECONDS, rotatingCode, STILL_ON_HOURS, sydneyTime, takesSignIns } from "@/lib/signin";
import { lockedWeekFor } from "@/lib/timesheets";

// The supervisor's side of crew sign-in, through their own link (or a
// stand-in's one-day hand-over link). Supervisors confirm or reject poster
// sign-ins and tick in crew without a phone - they never change a time; only
// the office does that (Manager+, /attendance).
//
// GET  -> their open jobs, each with the current QR (changes every 30s - the
//         phone polls) and the crew's sign-in state.
// POST { action: "CONFIRM" | "REJECT", attendanceId }
//      { action: "MANUAL_IN", jobId, resourceId }   (time = now)
//      { action: "MANUAL_OUT", attendanceId }       (time = now)
//      { action: "MANUAL_OUT_MANY", attendanceIds } (time = now - several at once, 24 Oct 2026)
//      { action: "MANUAL_OUT_AT", attendanceId, time: "HH:MM" } (fix 2b, 2 Nov 2026: a time earlier today, after
//        they signed in - kept with a note; never a future time, never another day)
//      { action: "HANDOVER", jobId, resourceId }    -> { url } one-day link
async function jobsFor(link: ResolvedLink) {
  if (link.kind === "HANDOVER") {
    const j = link.jobId ? await openJob(link.jobId) : null;
    return j ? [j] : [];
  }
  return link.person.id ? openJobsFor(link.person.id) : [];
}

async function load(req: NextRequest, token: string) {
  const link = await resolveLink(token);
  if (!link) return { ok: false as const, res: NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 }) };
  if (link.kind === "OFFICE") return { ok: false as const, res: NextResponse.json({ error: "Crew sign-in runs from a supervisor's link." }, { status: 403 }) };
  return { ok: true as const, link, jobs: await jobsFor(link) };
}

export const GET = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const r = await load(req, params.token);
  if (!r.ok) return r.res;
  const { link, jobs } = r;
  const attendances = await prisma.siteAttendance.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) }, removedAt: null },
    orderBy: { signInAt: "asc" },
  });
  return NextResponse.json({
    person: link.person.name,
    handover: link.kind === "HANDOVER",
    rotateSeconds: ROTATE_SECONDS,
    jobs: jobs.map((j) => {
      const mine = attendances.filter((a) => a.jobId === j.id);
      const row = (a: (typeof mine)[number]) => ({
        id: a.id,
        in: sydneyTime(a.signInAt),
        out: sydneyTime(a.signOutAt),
        method: a.signInMethod,
        outMethod: a.signOutMethod,
        status: a.status,
      });
      // Allocated crew first (with their latest sign-in), then anyone else
      // who signed in: hire / subcontractors, people moved here.
      const crew = j.assignments.map(({ resource }) => {
        const last = mine.filter((a) => a.resourceId === resource.id).at(-1);
        return { resourceId: resource.id, name: resource.name, company: null, allocated: true, attendance: last ? row(last) : null };
      });
      const others = mine
        .filter((a) => !a.resourceId || !j.assignments.some((x) => x.resource.id === a.resourceId))
        .map((a) => ({ resourceId: a.resourceId, name: a.workerName, company: a.company, allocated: false, attendance: row(a) }));
      return {
        id: j.id,
        label: jobLabel(j),
        times: j.startTime && j.endTime ? `${j.startTime}-${j.endTime}` : null,
        qrUrl: siteUrl(`in/${rotatingCode(j.id, link.id)}`, req.nextUrl.origin),
        crew: [...crew, ...others],
        toConfirm: mine.filter((a) => a.status === "TO_CONFIRM").map((a) => ({ ...row(a), name: a.workerName, company: a.company })),
      };
    }),
  });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const r = await load(req, params.token);
  if (!r.ok) return r.res;
  const { link, jobs } = r;
  const body = await req.json().catch(() => ({}));
  const by = `${link.person.name} (site)`;
  const jobIds = jobs.map((j) => j.id);

  const attendance = typeof body.attendanceId === "string"
    ? await prisma.siteAttendance.findFirst({ where: { id: body.attendanceId, jobId: { in: jobIds } } })
    : null;

  switch (body.action) {
    case "CONFIRM":
    case "REJECT": {
      if (!attendance) return bad("That sign-in isn't on your jobs.");
      if (attendance.status !== "TO_CONFIRM") return bad("That one's already been dealt with - the office can change it.");
      await prisma.siteAttendance.update({
        where: { id: attendance.id },
        data: { status: body.action === "CONFIRM" ? "CONFIRMED" : "REJECTED", confirmedBy: by, confirmedAt: new Date() },
      });
      await syncSignInActualsQuietly([attendance.jobId]);
      return NextResponse.json({ ok: true });
    }
    case "MANUAL_IN": {
      const job = jobs.find((j) => j.id === body.jobId);
      if (!job) return bad("Pick one of your jobs.");
      if (!takesSignIns(job)) return bad("That shift has finished - tick them in on today's job.");
      const person = typeof body.resourceId === "string"
        ? await prisma.resource.findUnique({ where: { id: body.resourceId }, select: { id: true, name: true, type: true } })
        : null;
      if (!person || person.type !== "PERSONNEL") return bad("Pick someone from the crew.");
      const open = await prisma.siteAttendance.findFirst({ where: { jobId: job.id, resourceId: person.id, signOutAt: null, status: { not: "REJECTED" } } });
      if (open) return bad(`${person.name} is already signed in since ${sydneyTime(open.signInAt)}.`);
      // Fix 1 (2 Nov 2026): ticking someone in ends any other sign-in they still have open (a truck QR, another site).
      // TF-002: only for this job's own crew - a supervisor can't pull someone off another site by ticking them in;
      // that open line goes to its own supervisor to confirm.
      const now = new Date();
      const allocated = job.assignments.some((a) => a.resource.id === person.id);
      const elsewhere = await prisma.siteAttendance.findFirst({
        where: { resourceId: person.id, signOutAt: null, status: { not: "REJECTED" }, removedAt: null, signInAt: { gte: new Date(now.getTime() - STILL_ON_HOURS * 3_600_000) }, OR: [{ jobId: null }, { jobId: { not: job.id } }] },
        select: { placeLabel: true, job: { select: { title: true, shift: true, project: { select: { name: true } } } } },
      });
      if (elsewhere && !allocated) return bad(`${person.name} is signed in at ${elsewhere.job ? jobLabel(elsewhere.job) : elsewhere.placeLabel ?? "another place"}. They can scan your QR, or ask the office.`);
      const made = await createSignIn({
        jobId: job.id,
        date: job.date.toISOString().slice(0, 10),
        resourceId: person.id,
        workerName: person.name,
        allocated,
        signInAt: now,
        signInMethod: "MANUAL",
        status: "CONFIRMED",
        runBy: link.person.name,
      });
      if (!made) return NextResponse.json({ error: JOB_CANCELLED_SIGN_IN }, { status: 409 }); // PS-031
      // PS-035: only once this sign-in is saved.
      const ended = await endOpenElsewhere({ who: { resourceId: person.id, workerName: person.name, company: null }, at: now, here: { jobId: job.id }, label: jobLabel(job), by, siteToConfirm: true });
      await syncSignInActualsQuietly([job.id, ...ended.map((e) => e.jobId)]);
      await syncPersonDayQuietly(person.id, job.date.toISOString().slice(0, 10));
      return NextResponse.json({ ok: true, ...(ended.length ? { message: `${person.name}'s other open sign-in was ended at ${sydneyTime(now)}.` } : {}) });
    }
    case "MANUAL_OUT_AT": {
      if (!attendance) return bad("That sign-in isn't on your jobs.");
      if (attendance.signOutAt) return bad("Already signed out - the office can change the time.");
      // TF-003: never their own time, never over 16 h, never an old or removed line, never a locked week.
      if (attendance.resourceId && attendance.resourceId === link.person.id) return bad("The office sets your own sign-out time.");
      const at = timeToday(body.time);
      if (!at) return bad("Pick a time earlier today.");
      if (at <= attendance.signInAt) return bad(`That's before they signed in (${sydneyTime(attendance.signInAt)}).`);
      if (at > new Date()) return bad("That time hasn't happened yet.");
      const why = await outRefusal(attendance, at);
      if (why) return bad(why);
      await prisma.siteAttendance.update({
        where: { id: attendance.id },
        data: { signOutAt: at, signOutMethod: "MANUAL", edits: { create: { field: "signOutAt", before: null, after: at.toISOString(), reason: `Sign-out time set by ${link.person.name} on their link`, editedBy: by } } },
      });
      await syncSignInActualsQuietly([attendance.jobId]);
      return NextResponse.json({ ok: true });
    }
    case "MANUAL_OUT": {
      if (!attendance) return bad("That sign-in isn't on your jobs.");
      if (attendance.signOutAt) return bad("Already signed out - the office can change the time.");
      const whyNow = await outRefusal(attendance, new Date()); // TF-003: the same limits as a chosen time
      if (whyNow) return bad(whyNow);
      await prisma.siteAttendance.update({ where: { id: attendance.id }, data: { signOutAt: new Date(), signOutMethod: "MANUAL" } });
      await syncSignInActualsQuietly([attendance.jobId]);
      return NextResponse.json({ ok: true });
    }
    case "MANUAL_OUT_MANY": {
      const ids = Array.isArray(body.attendanceIds) ? body.attendanceIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 100) : [];
      const rows = await prisma.siteAttendance.findMany({ where: { id: { in: ids }, jobId: { in: jobIds }, signOutAt: null, status: { not: "REJECTED" } } });
      if (!rows.length) return bad("Nobody picked is still signed in.");
      // TF-003: anyone over the limits is left for the office (and said so); the rest are signed out now.
      const nowMany = new Date();
      const ok: typeof rows = [], left: string[] = [];
      for (const x of rows) ((await outRefusal(x, nowMany)) ? left.push(x.workerName) : ok.push(x));
      if (!ok.length) return bad(`The office has to set ${left.length === 1 ? "this time" : "these times"} (over 16 hours, or an old sign-in): ${left.join(", ")}.`);
      await prisma.siteAttendance.updateMany({ where: { id: { in: ok.map((x) => x.id) } }, data: { signOutAt: nowMany, signOutMethod: "MANUAL" } });
      await syncSignInActualsQuietly([...new Set(ok.map((x) => x.jobId))]);
      return NextResponse.json({ ok: true, signedOut: ok.length, ...(left.length ? { leftForOffice: left } : {}) });
    }
    case "HANDOVER": {
      if (link.kind !== "SUPERVISOR") return bad("Only the supervisor can hand over.");
      const job = jobs.find((j) => j.id === body.jobId);
      if (!job) return bad("Pick one of your jobs.");
      if (!job.assignments.some((a) => a.resource.id === body.resourceId) || body.resourceId === link.person.id) {
        return bad("Pick someone else from this job's crew.");
      }
      const out = await createHandover(job.id, String(body.resourceId), by);
      if (!out.ok) return bad(out.error);
      return NextResponse.json({ ok: true, name: out.name, url: siteUrl(out.secret, req.nextUrl.origin) }, { status: 201 });
    }
    default:
      return bad("Unknown request.");
  }
});

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
// TF-003: what a supervisor may not do to a sign-out - the office does these (with a reason, on Sign-ins).
const MAX_LINE_HOURS = 16;
async function outRefusal(a: { signInAt: Date; status: string; removedAt: Date | null; date: string }, at: Date): Promise<string | null> {
  if (a.status === "REJECTED" || a.removedAt) return "That sign-in has been removed.";
  if (Date.now() - a.signInAt.getTime() > STILL_ON_HOURS * 3_600_000) return "That sign-in is too old - the office sets the time.";
  if (at.getTime() - a.signInAt.getTime() > MAX_LINE_HOURS * 3_600_000) return `That would be over ${MAX_LINE_HOURS} hours - the office sets this time.`;
  if (await lockedWeekFor(a.date)) return "That week's timesheet has been approved - the office would have to reopen it.";
  return null;
}

// "HH:MM" today, Sydney time -> the moment; null for anything else (fix 2b).
function timeToday(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{1,2}:\d{2}$/.test(v.trim())) return null;
  const [h, m] = v.trim().split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return fromSydneyLocal(`${todaySydney()}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
}
