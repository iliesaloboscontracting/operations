// Site sign-in / sign-out (19 Oct 2026) - the shared rules.
//
// Two ways a crew member's phone gets to the sign-in page:
//   - the supervisor's QR: a code made from (job, link, 30-second window)
//     and signed with AUTH_SECRET. It changes every 30 seconds, so a photo of
//     it is useless a minute later - scanning it proves they were there.
//   - the site poster's QR: a fixed secret (only its hash is stored, like
//     every other link). Anyone with a photo of it could use it, so those
//     sign-ins wait for the site supervisor to confirm.
// Scanning either gives the phone a short "ticket" (15 minutes) to pick their
// name and sign in or out with - the QR itself has usually changed by then.
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";
import { todaySydney } from "./today";
import { hashSecret, newLinkSecret } from "./siteLinks";

const WINDOW_MS = 30_000;
const TICKET_MS = 15 * 60_000;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is missing or too short.");
  return `${s}:site-signin`;
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const mac = (s: string) => createHmac("sha256", key()).update(s).digest("base64url").slice(0, 22);
function sign(payload: string) {
  return `${b64(payload)}.${mac(payload)}`;
}
function unsign(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const [p, m] = token.split(".");
  if (!p || !m) return null;
  const payload = unb64(p);
  const want = Buffer.from(mac(payload));
  const got = Buffer.from(m);
  return want.length === got.length && timingSafeEqual(want, got) ? payload : null;
}

// --- the supervisor's changing QR --------------------------------------------
export function rotatingCode(jobId: string, linkId: string, now = Date.now()) {
  return sign(`Q|${jobId}|${linkId}|${Math.floor(now / WINDOW_MS)}`);
}
// Accepts this window and the two before it (up to ~90s old), so a scan just
// as the code changes still works.
export function readRotatingCode(code: unknown, now = Date.now()) {
  const p = unsign(code);
  if (!p) return null;
  const [kind, jobId, linkId, w] = p.split("|");
  if (kind !== "Q" || !jobId || !linkId) return null;
  const age = Math.floor(now / WINDOW_MS) - Number(w);
  return age >= 0 && age <= 2 ? { jobId, linkId } : null;
}
export const ROTATE_SECONDS = WINDOW_MS / 1000;

// --- the ticket a scan gives the phone --------------------------------------
export type Method = "SUPERVISOR_QR" | "POSTER";
export type Ticket = { jobIds: string[]; method: Method; linkId: string };
export function makeTicket(t: Ticket, now = Date.now()) {
  return sign(`T|${t.jobIds.join(",")}|${t.method}|${t.linkId}|${now + TICKET_MS}`);
}
export function readTicket(ticket: unknown, now = Date.now()): Ticket | null {
  const p = unsign(ticket);
  if (!p) return null;
  const [kind, jobs, method, linkId, exp] = p.split("|");
  if (kind !== "T" || !jobs || (method !== "SUPERVISOR_QR" && method !== "POSTER") || Number(exp) < now) return null;
  return { jobIds: jobs.split(","), method, linkId };
}

// --- which jobs are open for sign-in -----------------------------------------
// Today's running jobs, plus last night's night shift (crew sign out after
// midnight). Stood-down / inactive / completed jobs don't take sign-ins.
export function signinDates(today = todaySydney()) {
  const d = new Date(today + "T00:00:00.000Z");
  const yesterday = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
  return { today, yesterday };
}
const jobDateWhere = () => {
  const { today, yesterday } = signinDates();
  return {
    status: "ACTIVE",
    OR: [{ date: new Date(today + "T00:00:00.000Z") }, { date: new Date(yesterday + "T00:00:00.000Z"), shift: "NIGHT" }],
  };
};

export const jobSelect = {
  id: true,
  date: true,
  shift: true,
  title: true,
  startTime: true,
  endTime: true,
  project: { select: { id: true, name: true, unpaidBreakMinutes: true } },
  assignments: {
    where: { resource: { type: "PERSONNEL" } },
    select: { resource: { select: { id: true, name: true } } },
    orderBy: { resource: { name: "asc" } },
  },
} as const;

export const jobLabel = (j: { title: string; shift: string; project: { name: string } | null }) =>
  `${j.project?.name ?? j.title}${j.shift === "NIGHT" ? " (night)" : ""}`;

// Jobs a person (supervisor link) runs sign-in for: the open jobs they're
// allocated to.
export function openJobsFor(resourceId: string) {
  return prisma.job.findMany({
    where: { ...jobDateWhere(), assignments: { some: { resourceId } } },
    select: jobSelect,
    orderBy: [{ date: "desc" }, { shift: "asc" }],
  });
}
export function openJobsAtProject(projectId: string) {
  return prisma.job.findMany({ where: { ...jobDateWhere(), projectId }, select: jobSelect, orderBy: [{ date: "desc" }, { shift: "asc" }] });
}
export function openJob(jobId: string) {
  return prisma.job.findFirst({ where: { ...jobDateWhere(), id: jobId }, select: jobSelect });
}

// The poster link for a secret (not switched off).
export async function resolvePoster(secret: unknown) {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const link = await prisma.siteLink.findUnique({ where: { tokenHash: hashSecret(secret) }, select: { id: true, kind: true, projectId: true, revokedAt: true } });
  if (!link || link.revokedAt || link.kind !== "POSTER" || !link.projectId) return null;
  return { id: link.id, projectId: link.projectId };
}

// --- hours -------------------------------------------------------------------
// Signed-in time less the site's unpaid break (same break costing uses),
// rounded to the nearest quarter hour. Null until they've signed out.
export function signedHours(signInAt: Date, signOutAt: Date | null, breakMinutes: number | null | undefined) {
  if (!signOutAt) return null;
  const gross = (signOutAt.getTime() - signInAt.getTime()) / 3_600_000;
  if (gross <= 0) return 0;
  return Math.max(0, Math.round((gross - (breakMinutes ?? 0) / 60) * 4) / 4);
}

export const sydneyTime = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" }).format(d) : null;

// The one open (not signed out, not rejected) sign-in for a worker on a job.
export function openAttendance(jobId: string, who: { resourceId?: string | null; workerName?: string; company?: string | null }) {
  return prisma.siteAttendance.findFirst({
    where: {
      jobId,
      signOutAt: null,
      status: { not: "REJECTED" },
      ...(who.resourceId ? { resourceId: who.resourceId } : { resourceId: null, workerName: who.workerName, company: who.company ?? null }),
    },
    orderBy: { signInAt: "desc" },
  });
}

// --- handing sign-in over to another lead for a day -------------------------
// A one-day link for the stand-in: it only runs sign-in for that one job and
// stops working at the end of that shift's day. A new hand-over for the same
// job switches the previous one off.
export async function createHandover(jobId: string, resourceId: string, createdBy: string | null) {
  const [job, person] = await Promise.all([
    prisma.job.findUnique({ where: { id: jobId }, select: { id: true, date: true, shift: true } }),
    prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true, type: true, name: true } }),
  ]);
  if (!job) return { ok: false, error: "That job isn't on the board." } as const;
  if (!person || person.type !== "PERSONNEL") return { ok: false, error: "Pick someone from the Personnel register." } as const;
  // job.date is midnight UTC of the job's day. Day shift: until midnight
  // Sydney at the end of that day (13:00 UTC, AEDT). Night shift: until
  // midday Sydney the next day (01:00 UTC the next day). In winter (AEST)
  // both land an hour earlier - 11pm / 11am - which is fine for a hand-over.
  const expiresAt = new Date(job.date.getTime() + (job.shift === "NIGHT" ? 25 : 13) * 3_600_000);
  if (expiresAt < new Date()) return { ok: false, error: "That job's day is over." } as const;
  const secret = newLinkSecret();
  await prisma.$transaction([
    prisma.siteLink.updateMany({ where: { kind: "HANDOVER", jobId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.siteLink.create({ data: { tokenHash: hashSecret(secret), kind: "HANDOVER", resourceId, jobId, expiresAt, createdBy } }),
  ]);
  return { ok: true, secret, name: person.name } as const;
}

// An office-entered time (ISO string from the browser) or null.
export function parseTime(v: unknown) {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
