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
  person: { id: string; name: string };
  toolboxes: { id: string; name: string }[];
};

// The live link for a secret: not switched off, and the person still
// supervises at least one active toolbox (links are for supervisors only).
export async function resolveLink(secret: unknown): Promise<ResolvedLink | null> {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(secret)) return null;
  const link = await prisma.siteLink.findUnique({
    where: { tokenHash: hashSecret(secret) },
    select: {
      id: true,
      revokedAt: true,
      resource: {
        select: { id: true, name: true, toolboxes: { where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
      },
    },
  });
  if (!link || link.revokedAt || link.resource.toolboxes.length === 0) return null;
  await prisma.siteLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } });
  return { id: link.id, person: { id: link.resource.id, name: link.resource.name }, toolboxes: link.resource.toolboxes };
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
