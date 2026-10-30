// Before and after photos from a supervisor's (or hand-over) link (30 Oct 2026). Each photo is saved straight away -
// a Before photo is kept even if the log is never sent. Only for a job the link can log today (the same check as the
// voice route: loggableJobs), never once the office has closed the day. Up to 6 a set (beforeAfter.addRefusal), 40 a link a day and 3 MB a photo (SEC-BA-001);
// "remove" hides a photo with who and when - nothing is deleted. Files go through savePhoto (type and size checked,
// random name, TOOL_PHOTO_DIR - in the nightly and off-site backups). No AI reading, no outside call, no money.
import { prisma } from "../prisma";
import { savePhoto } from "../toolPhotos";
import type { ResolvedLink } from "../siteLinks";
import { BEFORE_AFTER_LIMITS, LINK_DAY_CAP, PHOTO_TOO_BIG, addRefusal, dataUrlBytes, parsePhase } from "./beforeAfter";
import { sydneyDay } from "./checks";
import { fromSydneyLocal } from "../shiftTimes";
import { beforeAfterFor, setCounts, type BeforeAfterSets } from "./beforeAfterStore";
import { loggableJobs } from "./store";

type Problem = { error: string; status: number };
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// One photo at a time per job and set on this server, so two sent at once can't both slip under the limit.
const busy = new Set<string>();

async function loggableJob(link: ResolvedLink, jobId: unknown, now: Date) {
  return typeof jobId === "string" ? (await loggableJobs(link, now)).find((j) => j.id === jobId) ?? null : null;
}
// Every photo this link sent since midnight Sydney - removed ones too, so remove-and-resend can't get round it.
async function sentTodayByLink(linkId: string, now: Date) {
  const since = fromSydneyLocal(`${sydneyDay(now)}T00:00`) ?? new Date(now.getTime() - 24 * 3600_000);
  return prisma.siteLogPhoto.count({ where: { siteLinkId: linkId, createdAt: { gte: since } } });
}
async function dayClosed(day: string) {
  return (await prisma.dayClose.count({ where: { date: day, status: "CLOSED" } })) > 0;
}
const setsFor = async (jobId: string): Promise<BeforeAfterSets> => (await beforeAfterFor([jobId])).get(jobId) ?? { before: [], after: [] };

export async function addLinkPhoto(link: ResolvedLink, body: Record<string, unknown>, now: Date): Promise<Problem | { photos: BeforeAfterSets }> {
  const phase = parsePhase(body.phase);
  if (!phase) return { error: "Before or after?", status: 400 };
  if (dataUrlBytes(body.photo) > BEFORE_AFTER_LIMITS.maxBytes) return { error: PHOTO_TOO_BIG, status: 413 };
  const job = await loggableJob(link, body.jobId, now);
  if (!job) return { error: "That job isn't one you can log today.", status: 403 };
  const day = isoDay(job.date);
  if (await dayClosed(day)) return { error: "The office has closed that day - tell them instead.", status: 409 };
  const key = `${job.id}|${phase}`;
  if (busy.has(key)) return { error: "One photo at a time - wait for the last one to finish.", status: 429 };
  busy.add(key);
  try {
    if ((await sentTodayByLink(link.id, now)) >= BEFORE_AFTER_LIMITS.perLinkPerDay) return { error: LINK_DAY_CAP, status: 429 };
    const c = await setCounts(job.id, phase);
    const refused = addRefusal(c.shown, c.rows);
    if (refused) return { error: refused, status: 409 };
    const saved = await savePhoto(body.photo);
    if ("error" in saved) return { error: saved.error, status: 400 };
    await prisma.siteLogPhoto.create({ data: { jobId: job.id, day, phase, fileName: saved.fileName, siteLinkId: link.id, takenBy: link.person.name.slice(0, 80) } });
  } finally {
    busy.delete(key);
  }
  return { photos: await setsFor(job.id) };
}

export async function hideLinkPhoto(link: ResolvedLink, id: unknown, now: Date): Promise<Problem | { photos: BeforeAfterSets }> {
  const row = typeof id === "string" ? await prisma.siteLogPhoto.findUnique({ where: { id }, select: { id: true, jobId: true, day: true, hiddenAt: true } }) : null;
  if (!row || !(await loggableJob(link, row.jobId, now))) return { error: "That photo isn't one you can change.", status: 404 };
  if (await dayClosed(row.day)) return { error: "The office has closed that day - tell them instead.", status: 409 };
  if (!row.hiddenAt) await prisma.siteLogPhoto.update({ where: { id: row.id }, data: { hiddenAt: now, hiddenBy: link.person.name.slice(0, 80), hiddenLinkId: link.id } });
  return { photos: await setsFor(row.jobId) };
}

// A shown photo for the link's own screen - only on a job it can log today.
export async function linkPhotoFile(link: ResolvedLink, id: string | null, now: Date): Promise<string | null> {
  const row = id ? await prisma.siteLogPhoto.findUnique({ where: { id }, select: { jobId: true, fileName: true, hiddenAt: true } }) : null;
  if (!row || row.hiddenAt || !(await loggableJob(link, row.jobId, now))) return null;
  return row.fileName;
}
