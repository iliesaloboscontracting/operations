// Supervisors' private links to the Site photos page. The secret in the link
// is the only thing that lets someone use it, so only its sha256 is stored;
// a lost link is switched off and replaced, never looked up and resent.
import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";

export const newLinkSecret = () => randomBytes(24).toString("base64url");
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

// Most photos one link can send in a day - plenty for real use, and a cap on
// what a leaked link could do before it's switched off.
export const DAILY_PHOTO_LIMIT = 80;

export type ResolvedLink = {
  id: string;
  kind: "SUPERVISOR" | "OFFICE" | "HANDOVER";
  jobId: string | null; // HANDOVER: the one job it runs sign-in for
  person: { id: string | null; name: string }; // shared links: id null, name = label
  shared: boolean;
  // SUPERVISOR: the toolboxes they're in charge of. OFFICE: every active
  // toolbox (an office/yard person can put a tool into any of them, or the yard).
  toolboxes: { id: string; name: string }[];
};

// The live link for a secret: not switched off, and a hand-over link not past
// its day. (Poster links are resolved separately - lib/signin.ts.) Since site
// sign-in (19 Oct 2026) a supervisor's link works without a toolbox - the
// tool buttons just don't show.
export async function resolveLink(secret: unknown): Promise<ResolvedLink | null> {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const link = await prisma.siteLink.findUnique({
    where: { tokenHash: hashSecret(secret) },
    select: {
      id: true,
      kind: true,
      revokedAt: true,
      label: true,
      jobId: true,
      expiresAt: true,
      resource: {
        select: { id: true, name: true, active: true, toolboxes: { where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
      },
    },
  });
  if (!link || link.revokedAt) return null;
  if (link.kind !== "OFFICE" && link.kind !== "SUPERVISOR" && link.kind !== "HANDOVER") return null;
  const kind = link.kind;
  if (kind === "HANDOVER" && (!link.expiresAt || link.expiresAt < new Date() || !link.jobId)) return null;
  // A shared link (no person) can only be an office/yard link.
  if (kind !== "OFFICE" && !link.resource) return null;
  // Someone archived (no longer with us) - their links stop working too (25 Oct 2026).
  if (link.resource && !link.resource.active) return null;
  const toolboxes =
    kind === "OFFICE"
      ? await prisma.toolbox.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : kind === "HANDOVER"
        ? []
        : link.resource!.toolboxes;
  await prisma.siteLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
  const person = link.resource ? { id: link.resource.id, name: link.resource.name } : { id: null, name: link.label ?? "Shared link" };
  return { id: link.id, kind, jobId: link.jobId, person, shared: !link.resource, toolboxes };
}

export async function photosSentToday(linkId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.toolPhoto.count({ where: { siteLinkId: linkId, createdAt: { gte: since } } });
}

// The address a link is sent as: SITE_BASE_URL (the tunnel's public address)
// when set, otherwise wherever the office is looking at Operations from.
export function siteUrl(secret: string, fallbackOrigin: string) {
  const base = (process.env.SITE_BASE_URL || fallbackOrigin).replace(/\/+$/, "");
  return `${base}/site/${secret}`;
}
