// Site poster guard - the database side (rules in ./rules.ts). Reads only: nothing here writes or changes a sign-in.
import { prisma } from "../prisma";
import { effectiveTimes } from "../shiftTimes";
import { learnSite, POSTER_GUARD, posterGpsFlag, posterWindow, type GpsRow, type PosterGpsFlag, type PosterWindow, type SiteFix } from "./rules";

export const posterWindowOn = () => (process.env[POSTER_GUARD.windowSwitch] ?? "").trim().toLowerCase() !== "off";
export const posterGpsFlagsOn = () => (process.env[POSTER_GUARD.gpsSwitch] ?? "").trim().toLowerCase() !== "off";

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The project's usable fixes over the 30 days to `date`, cached per project per day for a few minutes (the Sign-ins
// page and the supervisor's link poll; new sign-ins during the day still count soon after).
const CACHE_MS = 5 * 60_000;
const g = globalThis as unknown as { __posterSiteFixes?: Map<string, { at: number; fixes: SiteFix[] }> };
const cache = (g.__posterSiteFixes ??= new Map());

export async function siteFixes(projectId: string, date: string): Promise<SiteFix[]> {
  const key = `${projectId}|${date}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.fixes;
  const rows = await prisma.siteAttendance.findMany({
    where: {
      job: { projectId },
      date: { gte: addDays(date, -POSTER_GUARD.siteDays), lte: date },
      gpsStatus: "OK",
      gpsLat: { not: null },
      gpsLng: { not: null },
      gpsAccuracyM: { lte: POSTER_GUARD.maxFixAccuracyM },
      status: { not: "REJECTED" },
      removedAt: null,
    },
    select: { gpsLat: true, gpsLng: true, gpsAccuracyM: true, resourceId: true, workerName: true, company: true },
    take: 2000,
    orderBy: { signInAt: "desc" },
  });
  const fixes = rows.map((r) => ({ lat: r.gpsLat!, lng: r.gpsLng!, accuracyM: r.gpsAccuracyM, person: personKey(r) }));
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), fixes });
  return fixes;
}

export const personKey = (r: { resourceId: string | null; workerName: string; company: string | null }) => r.resourceId ?? `${r.workerName}|${r.company ?? ""}`;

type Row = GpsRow & { id: string; resourceId: string | null; workerName: string; company: string | null };

/** The poster location flags for one project's lines on `date` (row id -> flag + words). Empty when switched off. */
export async function posterGpsFlags(rows: Row[], projectId: string | null, date: string): Promise<Map<string, { flag: PosterGpsFlag; note: string }>> {
  const out = new Map<string, { flag: PosterGpsFlag; note: string }>();
  if (!posterGpsFlagsOn()) return out;
  const poster = rows.filter((r) => r.signInMethod === "POSTER" && r.status !== "REJECTED");
  if (!poster.length) return out;
  const fixes = projectId ? await siteFixes(projectId, date) : [];
  for (const r of poster) {
    const f = posterGpsFlag(r, learnSite(fixes, personKey(r)));
    if (f) out.set(r.id, f);
  }
  return out;
}

type ProjectHours = { dayStart: string | null; dayEnd: string | null; nightStart: string | null; nightEnd: string | null } | null;
/** The poster window for a job (its own times, else the project's usual hours for the shift), or null. */
export function windowForJob(job: { date: Date; shift: string; startTime: string | null; endTime: string | null }, project: ProjectHours): PosterWindow | null {
  const t = effectiveTimes(job, project);
  return posterWindow({ date: job.date.toISOString().slice(0, 10), shift: job.shift, start: t.start, end: t.end });
}

export function projectHours(projectId: string | null | undefined): Promise<ProjectHours> {
  if (!projectId) return Promise.resolve(null);
  return prisma.project.findUnique({ where: { id: projectId }, select: { dayStart: true, dayEnd: true, nightStart: true, nightEnd: true } });
}
