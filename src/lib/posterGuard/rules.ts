// Site poster guard (Ilies, 11 Nov 2026: "do 1 and 2"). Background: a printed site poster QR never changes, so a phone
// that scanned it once can reopen the page from anywhere - on 11 Nov someone signed in on the Rivkin House poster at
// 8:11pm on a 7am-3:30pm job, location refused, from the same phone as a sign-in the supervisor had rejected that
// morning.
//   1. Flag, don't block: a poster sign-in with no location, or far from where the site's crew usually sign in.
//      Information only - never blocks, never changes hours.
//   2. A time window on POSTER sign-INs only: 1 hour before the job's start to 2 hours after its finish. Sign-out is
//      never blocked; office / yard / truck points, the supervisor's QR, hand-overs and the office never windowed.
// Plain rules, no server imports (npm test and the Sign-ins page use them).
import { jobFinish, parseClock } from "../shiftTimes";
import { jobStartAt, sydneyDay } from "../signinFlags";

export const POSTER_GUARD = {
  /** The window opens this long before the job's start... */
  windowBeforeMinutes: 60,
  /** ...and closes this long after its finish. */
  windowAfterMinutes: 120,
  /** Where the site is: GPS fixes from sign-ins on the project over this many days... */
  siteDays: 30,
  /** ...no less accurate than this... */
  maxFixAccuracyM: 100,
  /** ...and only trusted with at least this many fixes from at least this many different people. */
  minFixes: 3,
  minPeople: 2,
  /** "Far from site": further than this from the site, plus the fix's own accuracy. */
  farMetres: 500,
  /** Phones were first asked for a position at sign-in on 27 Oct 2026 - earlier lines are never "no location". */
  gpsSince: "2026-10-28",
  /** Kill switches (.env): POSTER_WINDOW=off, POSTER_GPS_FLAGS=off. */
  windowSwitch: "POSTER_WINDOW",
  gpsSwitch: "POSTER_GPS_FLAGS",
} as const;

export type PosterGpsFlag = "NO_LOCATION" | "FAR_FROM_SITE";

// ---------- where the site is ----------

export type Point = { lat: number; lng: number };
const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
/** Metres between two points (haversine). */
export function distanceMetres(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * PS-055 (Ilies approved, 11 Nov 2026): which sign-ins may teach us where the site is. Only CONFIRMED lines, and a
 * site poster line only from a Labour-register person - never an unconfirmed poster line (a faked position nobody
 * has checked) and never a free-typed hire name on a poster.
 */
export function learnsSite(r: { status: string; signInMethod: string; resourceId: string | null }): boolean {
  return r.status === "CONFIRMED" && (r.signInMethod !== "POSTER" || r.resourceId != null);
}

/** One sign-in's position on the project. person: resource id, or name|company for hire. */
export type SiteFix = { lat: number; lng: number; accuracyM: number | null; person: string };

/**
 * The site's learned location: the median lat / lng of the fixes good enough to use, leaving out the person being
 * checked. null (unknown) with fewer than 3 fixes or fewer than 2 people.
 */
export function learnSite(fixes: SiteFix[], exceptPerson?: string | null): (Point & { fixes: number; people: number }) | null {
  const use = fixes.filter(
    (f) => f.person !== exceptPerson && Number.isFinite(f.lat) && Number.isFinite(f.lng) && f.accuracyM != null && f.accuracyM <= POSTER_GUARD.maxFixAccuracyM,
  );
  const people = new Set(use.map((f) => f.person)).size;
  if (use.length < POSTER_GUARD.minFixes || people < POSTER_GUARD.minPeople) return null;
  return { lat: median(use.map((f) => f.lat)), lng: median(use.map((f) => f.lng)), fixes: use.length, people };
}

/** "1.8 km" / "650 m" - words and distances only, never a coordinate. */
export function distanceLabel(m: number): string {
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toFixed(1)} km`;
  return `${Math.max(10, Math.round(m / 10) * 10)} m`;
}

// ---------- the flags ----------

export type GpsRow = {
  signInMethod: string;
  status: string;
  date: string;
  gpsStatus: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
};

/**
 * PS-057 (Ilies approved, 11 Nov 2026): the words for a NO_LOCATION line say WHY, so the supervisor can judge - a
 * phone slow to get a fix isn't someone refusing. Still the same flag either way (and "Confirm all" still skips it).
 */
export function noLocationWords(gpsStatus: string | null | undefined): string {
  if (gpsStatus === "DENIED") return "Location refused";
  if (gpsStatus === "TIMEOUT") return "Location timed out";
  if (gpsStatus === "UNAVAILABLE") return "Location unavailable";
  return "No location shared";
}

/** A site poster sign-in's location flag and its words, or null. Rejected lines and other methods: never. */
export function posterGpsFlag(row: GpsRow, site: Point | null): { flag: PosterGpsFlag; note: string } | null {
  if (row.signInMethod !== "POSTER" || row.status === "REJECTED") return null;
  if (row.gpsStatus !== "OK" || row.gpsLat == null || row.gpsLng == null) {
    if (row.date < POSTER_GUARD.gpsSince) return null; // before phones were asked
    return { flag: "NO_LOCATION", note: noLocationWords(row.gpsStatus) };
  }
  if (!site) return null;
  const d = distanceMetres(site, { lat: row.gpsLat, lng: row.gpsLng });
  if (d <= POSTER_GUARD.farMetres + (row.gpsAccuracyM ?? 0)) return null;
  return { flag: "FAR_FROM_SITE", note: `${distanceLabel(d)} from site` };
}

// ---------- the time window (poster sign-in only) ----------

export type WindowJob = { date: string; shift: string; start: string | null; end: string | null };
export type PosterWindow = { opens: Date; closes: Date };

/** From 1 h before the job's start to 2 h after its finish; null (no window) when either time isn't clear. */
export function posterWindow(job: WindowJob): PosterWindow | null {
  if (parseClock(job.start) == null || parseClock(job.end) == null) return null;
  const start = jobStartAt(job.date, job.shift, job.start);
  const finish = jobFinish(job.date, job.shift, job.start, job.end);
  if (!start || !finish || finish <= start) return null;
  return {
    opens: new Date(start.getTime() - POSTER_GUARD.windowBeforeMinutes * 60_000),
    closes: new Date(finish.getTime() + POSTER_GUARD.windowAfterMinutes * 60_000),
  };
}

const syd = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]),
  );
/** 6:00am, 5:30pm, 12:00am. */
export function clockWithMinutes(d: Date): string {
  const p = syd(d);
  const h = Number(p.hour) % 24, m = Number(p.minute);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

export function windowMessage(w: PosterWindow): string {
  const nextDay = sydneyDay(w.closes) > sydneyDay(w.opens) ? " the next morning" : "";
  return `This site's sign-in QR works from ${clockWithMinutes(w.opens)} to ${clockWithMinutes(w.closes)}${nextDay}. If you're on site now, see your supervisor.`;
}

/** The refusal for a sign-in at `now`, or null. */
export function outsideWindow(w: PosterWindow | null, now: Date): string | null {
  if (!w) return null;
  return now < w.opens || now > w.closes ? windowMessage(w) : null;
}

/**
 * Is this action refused by the poster window? Only a site poster's sign-IN, and only outside its window.
 * Sign-out (and STATUS) never; every other way in never; windowOn false (POSTER_WINDOW=off) never.
 */
export function posterRefusal(o: { action: string; method: string; window: PosterWindow | null; now: Date; windowOn: boolean }): string | null {
  if (!o.windowOn || o.action !== "IN" || o.method !== "POSTER") return null;
  return outsideWindow(o.window, o.now);
}
