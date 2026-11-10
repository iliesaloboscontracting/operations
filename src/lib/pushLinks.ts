// Which site links may get a phone alert (PS-023, Ilies, 10 Nov 2026: approved "including the older reminders").
// ONE rule for every push to a site link: the link isn't switched off (revokedAt), hasn't run out (expiresAt - a
// hand-over ends with its day), and if it belongs to a person, that person is still active - an archived supervisor
// whose link was never switched off gets nothing. Links with no person (the yard's shared link) only need the first
// two. pushToSiteLinks (lib/push.ts) applies it to every device it sends to, and the reminders use it to pick their
// links, so an archived lead never "uses up" the choice of who gets told. No server imports.
import type { Prisma } from "@prisma/client";

export function liveLinkWhere(now = new Date()): Prisma.SiteLinkWhereInput {
  return {
    AND: [
      { revokedAt: null },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ resourceId: null }, { resource: { active: true } }] },
    ],
  };
}

// A caller's own conditions, limited to links that may get a push.
export const liveLinks = (where: Prisma.SiteLinkWhereInput, now = new Date()): Prisma.SiteLinkWhereInput => ({ AND: [liveLinkWhere(now), where] });

// The same rule on a link already loaded (for plain code and tests).
export function linkMayGetPush(l: { revokedAt: Date | null; expiresAt: Date | null; resourceId: string | null; resource?: { active: boolean } | null }, now = new Date()) {
  if (l.revokedAt) return false;
  if (l.expiresAt && l.expiresAt.getTime() <= now.getTime()) return false;
  return !l.resourceId || l.resource?.active === true;
}
