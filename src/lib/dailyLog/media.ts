// Large uploads on the daily site log (Ilies, 10 Nov 2026): full-quality photos and videos up to 2 minutes, straight to
// the media bucket (lib/media/), from a supervisor's or hand-over link - the same "a job this link can log today, not
// once the office has closed the day" rule as the log and its before / after photos.
//   DAILY_LOG    - the day's photos / videos on the log: READY gives the phone "media:<id>", which the log then cites
//                  (store.ts submitLog checks it's this link's, this job's, READY).
//   DELAY        - a delay's photos / videos: the same.
//   BEFORE_AFTER - a before / after photo or video: READY makes the SiteLogPhoto row straight away (like the old route),
//                  up to 10 shown a set with at most 3 videos (LOG_MEDIA).
// A link only ever completes or reads its own uploads. Names and times only - no money.
import { prisma } from "../prisma";
import type { ResolvedLink } from "../siteLinks";
import { LOG_MEDIA, MEDIA_LIMITS, mediaRef, type MediaArea } from "../media/rules";
import type { MediaObject, Party } from "../media/protocol";
import { parsePhase, type Phase } from "./beforeAfter";
import { beforeAfterFor, type BeforeAfterSets } from "./beforeAfterStore";
import { loggableJobs } from "./store";

const LOG_AREAS = ["DAILY_LOG", "DELAY", "BEFORE_AFTER"] as const;
type LogArea = (typeof LOG_AREAS)[number];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayClosed = async (day: string) => (await prisma.dayClose.count({ where: { date: day, status: "CLOSED" } })) > 0;
const CLOSED = { error: "The office has closed that day - tell them instead.", status: 409 };
const busy = new Set<string>(); // "<job>|<phase>" being attached on this server

// A before / after set as it stands: what's shown, its videos, every row it ever had, and uploads still on their way.
async function setCounts(jobId: string, phase: Phase, now: Date) {
  const fresh = { gte: new Date(now.getTime() - MEDIA_LIMITS.pendingFreshMin * 60_000) };
  const [shown, shownVideos, rows, pending, pendingVideos] = await Promise.all([
    prisma.siteLogPhoto.count({ where: { jobId, phase, hiddenAt: null } }),
    prisma.siteLogPhoto.count({ where: { jobId, phase, hiddenAt: null, kind: "VIDEO" } }),
    prisma.siteLogPhoto.count({ where: { jobId, phase } }),
    prisma.mediaObject.count({ where: { area: "BEFORE_AFTER", jobId, phase, state: "PENDING", abortedAt: null, createdAt: fresh } }),
    prisma.mediaObject.count({ where: { area: "BEFORE_AFTER", jobId, phase, state: "PENDING", abortedAt: null, createdAt: fresh, kind: "VIDEO" } }),
  ]);
  return { shown, shownVideos, rows, pending, pendingVideos };
}
const setFull = (n: { items: number; videos: number; rows: number }, video: boolean): string | null => {
  if (n.items >= LOG_MEDIA.setItems) return `That's ${LOG_MEDIA.setItems} already - remove one to add another.`;
  if (video && n.videos >= LOG_MEDIA.setVideos) return `That's ${LOG_MEDIA.setVideos} videos already - remove one to add another.`;
  if (n.rows >= LOG_MEDIA.setRows) return "That's the most for this job today - call the office.";
  return null;
};

export function logMediaParty(link: ResolvedLink, now = new Date()): Party {
  const job = async (jobId: unknown) => (typeof jobId === "string" ? (await loggableJobs(link, now)).find((j) => j.id === jobId) ?? null : null);
  const replyFor = async (row: MediaObject): Promise<Record<string, unknown>> => {
    if (row.area !== "BEFORE_AFTER") return { ref: mediaRef(row.id) };
    const sets: BeforeAfterSets = (await beforeAfterFor([row.jobId!], { linkId: link.id })).get(row.jobId!) ?? { before: [], after: [] };
    return { ref: mediaRef(row.id), photos: sets };
  };
  return {
    source: { siteLinkId: link.id, takenBy: link.person.name },
    owns: (row) => row.siteLinkId === link.id && (LOG_AREAS as readonly string[]).includes(row.area),
    async prepare(body, kind) {
      const area = body.area;
      if (!(LOG_AREAS as readonly unknown[]).includes(area)) return { error: "Which part of the log is it for?", status: 400 };
      const j = await job(body.jobId);
      if (!j) return { error: "That job isn't one you can log today.", status: 403 };
      if (await dayClosed(isoDay(j.date))) return CLOSED;
      if (area !== "BEFORE_AFTER") return { area: area as MediaArea, fields: { jobId: j.id } };
      const phase = parsePhase(body.phase);
      if (!phase) return { error: "Before or after?", status: 400 };
      const c = await setCounts(j.id, phase, now);
      const full = setFull({ items: c.shown + c.pending, videos: c.shownVideos + c.pendingVideos, rows: c.rows + c.pending }, kind === "VIDEO");
      if (full) return { error: full, status: 409 };
      return { area: "BEFORE_AFTER", fields: { jobId: j.id, phase } };
    },
    async attach(row) {
      if (row.area !== "BEFORE_AFTER") return { reply: { ref: mediaRef(row.id) } };
      const key = `${row.jobId}|${row.phase}`;
      if (busy.has(key)) return { refuse: { error: "One at a time - wait for the last one to finish.", status: 429 }, reason: "BUSY" };
      busy.add(key);
      try {
        const day = (await prisma.job.findUnique({ where: { id: row.jobId! }, select: { date: true } }))?.date;
        if (!day) return { refuse: { error: "That job isn't there any more.", status: 404 }, reason: "GONE" };
        if (await dayClosed(isoDay(day))) return { refuse: CLOSED, reason: "CLOSED" };
        const c = await setCounts(row.jobId!, row.phase as Phase, now);
        const full = setFull({ items: c.shown, videos: c.shownVideos, rows: c.rows }, row.kind === "VIDEO");
        if (full) return { refuse: { error: full, status: 409 }, reason: "FULL" };
        const p = await prisma.siteLogPhoto.create({
          data: { jobId: row.jobId!, day: isoDay(day), phase: row.phase!, fileName: mediaRef(row.id), kind: row.kind, mediaId: row.id, siteLinkId: link.id, takenBy: link.person.name.slice(0, 80) },
        });
        return { linkedId: p.id, reply: await replyFor(row) };
      } finally {
        busy.delete(key);
      }
    },
    replyFor,
  };
}

// The log's own media check (store.ts submitLog): a "media:<id>" cited on a log or a delay must be this link's, this
// job's, READY, and uploaded for the log (the day's photos or a delay - either place: one resumed after the page was
// opened again goes on the day's photos). -> the kinds, or an error.
export async function usableLogMedia(linkId: string, jobId: string, refs: { area: "DAILY_LOG" | "DELAY"; id: string }[]): Promise<Map<string, "PHOTO" | "VIDEO"> | { error: string }> {
  const out = new Map<string, "PHOTO" | "VIDEO">();
  if (!refs.length) return out;
  const rows = await prisma.mediaObject.findMany({ where: { id: { in: refs.map((r) => r.id) } }, select: { id: true, area: true, siteLinkId: true, jobId: true, state: true, kind: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of refs) {
    const m = byId.get(r.id);
    if (!m || m.siteLinkId !== linkId || m.jobId !== jobId || m.state !== "READY" || (m.area !== "DAILY_LOG" && m.area !== "DELAY")) return { error: "A photo or video in the log couldn't be found - add it again." };
    out.set(r.id, m.kind === "VIDEO" ? "VIDEO" : "PHOTO");
  }
  return out;
}
