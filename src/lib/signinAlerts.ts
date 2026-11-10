// Sign-in gaps found in the week of 26 Oct (Ilies, 2 Nov 2026: "build fixes 1-5"). Each alert goes out once
// (a ShiftReminder row claims it first, like the sign-out reminder), each has a kill switch in .env, and none of
// them invents a time or changes a sign-in. Run once a minute from instrumentation.ts. Names, sites and times only.
//   2c  7:00am  Admins: "N sign-ins from yesterday with no sign-out" (SIGNOUT_MORNING_ALERT=off)
//   3   3:00pm  Admins: tomorrow's jobs with crew but no way to sign in (SIGNIN_WAY_CHECK=off)
//   5a  start + 1 h  the job's supervisor link(s): "X, Y not signed in at <site>" (NOT_SIGNED_IN_ALERT=off)
import { prisma } from "./prisma";
import { pushToAdmins, pushToSiteLinks } from "./push";
import { effectiveTimes, fromSydneyLocal, parseClock } from "./shiftTimes";
import { todaySydney } from "./today";

const RUNNING = { notIn: ["COMPLETED", "INACTIVE", "STOOD_DOWN", "CANCELLED"] };
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const at = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const sydneyMinutes = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};
const off = (key: string) => (process.env[key] ?? "").trim().toLowerCase() === "off";
const list = (names: string[], n = 5) => names.slice(0, n).join(", ") + (names.length > n ? ` +${names.length - n} more` : "");
// Claim an alert: the unique (jobId, kind) row stops a second send, even if two ticks overlap.
const claim = (key: string, kind: string, people = 0) => prisma.shiftReminder.create({ data: { jobId: key, kind, people } }).catch(() => null);

// ---------- plain rules (npm test) ----------

// Fix 3: can anyone sign this job in? A supervisor link held by someone on it, a hand-over link for it, or a poster
// at its project. Crew on the job but none of those = no way to sign in.
export function noWayToSignIn(job: { id: string; projectId: string | null; crewIds: string[] }, ways: { linkHolders: Set<string>; handoverJobs: Set<string>; posterProjects: Set<string> }) {
  if (!job.crewIds.length) return false;
  if (job.crewIds.some((id) => ways.linkHolders.has(id))) return false;
  if (ways.handoverJobs.has(job.id)) return false;
  return !(job.projectId && ways.posterProjects.has(job.projectId));
}

// Fix 5a: the moment "not signed in yet" is worth a push - an hour after the start - and until when (4 h after).
export function notSignedInWindow(start: Date | null, now = new Date()) {
  if (!start) return false;
  const since = now.getTime() - start.getTime();
  return since >= 60 * 60_000 && since <= 4 * 3_600_000;
}

// ---------- the data ----------

// Fix 3 for one date: the running jobs with crew and no way to sign in (also the board's warning).
export async function jobsWithNoSignInWay(date: string) {
  const jobs = await prisma.job.findMany({
    where: { date: at(date), status: RUNNING, notRunning: false, cancelledAt: null },
    select: { id: true, title: true, projectId: true, project: { select: { name: true } }, assignments: { where: { resource: { type: "PERSONNEL" } }, select: { resourceId: true } } },
  });
  if (!jobs.length) return [];
  const crew = [...new Set(jobs.flatMap((j) => j.assignments.map((a) => a.resourceId)))];
  const [links, handovers, posters] = await Promise.all([
    prisma.siteLink.findMany({ where: { kind: "SUPERVISOR", revokedAt: null, resourceId: { in: crew } }, select: { resourceId: true } }),
    prisma.siteLink.findMany({ where: { kind: "HANDOVER", revokedAt: null, jobId: { in: jobs.map((j) => j.id) } }, select: { jobId: true } }),
    prisma.siteLink.findMany({ where: { kind: "POSTER", revokedAt: null, place: null, projectId: { in: jobs.map((j) => j.projectId).filter((x): x is string => !!x) } }, select: { projectId: true } }),
  ]);
  const ways = {
    linkHolders: new Set(links.map((l) => l.resourceId!).filter(Boolean)),
    handoverJobs: new Set(handovers.map((h) => h.jobId!).filter(Boolean)),
    posterProjects: new Set(posters.map((p) => p.projectId!).filter(Boolean)),
  };
  return jobs.filter((j) => noWayToSignIn({ id: j.id, projectId: j.projectId, crewIds: j.assignments.map((a) => a.resourceId) }, ways))
    .map((j) => ({ jobId: j.id, site: j.project?.name ?? j.title }));
}

// Fix 2c: yesterday's sign-ins still open.
export async function openFromYesterday(today = todaySydney()) {
  const rows = await prisma.siteAttendance.findMany({
    where: { date: addDays(today, -1), signOutAt: null, status: { not: "REJECTED" }, removedAt: null },
    select: { id: true, workerName: true, company: true, placeLabel: true, signInAt: true, job: { select: { title: true, project: { select: { name: true } } } } },
    orderBy: { workerName: "asc" },
  });
  return rows.map((r) => ({ id: r.id, name: r.workerName, company: r.company, site: r.job?.project?.name ?? r.job?.title ?? r.placeLabel ?? "Sign-in point" }));
}

// Fix 5a: running jobs an hour past their start with allocated staff not signed in there. Yesterday's jobs too, so a
// job that started late last night (a night shift at 11:30pm) is caught after midnight; the 1-4 h window keeps it
// from ever picking up an old job.
export async function notSignedInToday(now = new Date()) {
  const today = todaySydney();
  const jobs = await prisma.job.findMany({
    where: { date: { in: [at(addDays(today, -1)), at(today)] }, status: RUNNING, notRunning: false, cancelledAt: null },
    select: {
      id: true, date: true, title: true, shift: true, startTime: true, endTime: true,
      project: { select: { name: true, dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } },
      assignments: { where: { resource: { type: "PERSONNEL" } }, select: { resource: { select: { id: true, name: true } } } },
      attendances: { where: { status: { not: "REJECTED" } }, select: { resourceId: true } },
    },
  });
  const out: { jobId: string; site: string; missing: { id: string; name: string }[]; crewIds: string[] }[] = [];
  for (const j of jobs) {
    const t = effectiveTimes(j, j.project);
    const s = parseClock(t.start);
    const start = s == null ? null : fromSydneyLocal(`${j.date.toISOString().slice(0, 10)}T${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
    if (!notSignedInWindow(start, now)) continue;
    const signed = new Set(j.attendances.map((a) => a.resourceId));
    const missing = j.assignments.map((a) => a.resource).filter((r) => !signed.has(r.id));
    if (missing.length) out.push({ jobId: j.id, site: j.project?.name ?? j.title, missing, crewIds: j.assignments.map((a) => a.resource.id) });
  }
  return out;
}

// ---------- the tick ----------

export async function signInAlertsTick(now = new Date()) {
  const today = todaySydney();
  const mins = sydneyMinutes(now);

  // 2c - from 7:00am (until noon, in case the server was down at 7).
  if (!off("SIGNOUT_MORNING_ALERT") && mins >= 7 * 60 && mins < 12 * 60) {
    const open = await openFromYesterday(today);
    if (await claim(`DAY:${today}`, "NO_SIGNOUT_7AM", open.length)) {
      if (open.length) await pushToAdmins({ title: `${open.length} sign-in${open.length === 1 ? "" : "s"} from yesterday with no sign-out`, body: `${list(open.map((o) => o.name))}. They count no hours until the office sets the time.`, url: "/attendance", tag: `no-signout-${today}` }).catch((e) => console.error("no sign-out alert", e));
    }
  }

  // 3 - from 3:00pm (until 10pm), tomorrow's jobs.
  if (!off("SIGNIN_WAY_CHECK") && mins >= 15 * 60 && mins < 22 * 60) {
    const tomorrow = addDays(today, 1);
    const none = await jobsWithNoSignInWay(tomorrow);
    if (await claim(`DAY:${tomorrow}`, "NO_SIGNIN_WAY", none.length)) {
      if (none.length) await pushToAdmins({ title: "No way to sign in tomorrow", body: `${list(none.map((n) => n.site))} - crew on the board but no supervisor link, hand-over or site poster.`, url: `/command?date=${tomorrow}`, tag: `no-signin-way-${tomorrow}` }, "high").catch((e) => console.error("no sign-in way alert", e));
    }
  }

  // 5a - an hour after each job's start.
  if (!off("NOT_SIGNED_IN_ALERT")) {
    for (const j of await notSignedInToday(now)) {
      if (!(await claim(j.jobId, "NOT_SIGNED_IN_1H", j.missing.length))) continue;
      const links = await prisma.siteLink.findMany({
        where: { revokedAt: null, OR: [{ kind: "SUPERVISOR", resourceId: { in: j.crewIds } }, { kind: "HANDOVER", jobId: j.jobId, expiresAt: { gt: new Date() } }] },
        select: { id: true },
      });
      if (links.length) await pushToSiteLinks(links.map((l) => l.id), { title: `Not signed in at ${j.site}`, body: `${list(j.missing.map((m) => m.name))} not signed in yet.`, url: "?go=signin", tag: `not-signed-in-${j.jobId}` }, "high").catch((e) => console.error("not signed in alert", e));
    }
  }
}
