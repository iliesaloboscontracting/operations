// Large uploads on vehicle & plant pre-starts (Ilies, 10 Nov 2026): fault photos at full quality and fault VIDEOS (up
// to 2 minutes) as evidence; the walk-around and hour-meter photos stay photos (camera only) but may also go to the
// bucket at full quality. The same token rules as the photo route (linkContext - a truck sign-in or a plant check
// session, PS-005 / PS-006), and every pre-start rule unchanged: the caps are checked before the upload starts
// (photoPrecheckFor) and again - authoritatively, in the same transaction as the old route - when it's done
// (recordFaultMedia: PS-001 / 009 / 012 / 016, the queue, the slots); a video counts as fault media under those caps,
// 6 a fault, at most 3 videos a sign-in / session. READY makes the AssetFaultMedia row and gives the phone its id - the
// check then attaches it to its fault exactly as before. A refused one is kept REJECTED (with the cap in the reply, so
// PS-010's waiver still works).
import { prisma } from "../prisma";
import { FAULT_MEDIA, mediaRef, type MediaArea } from "../media/rules";
import type { Party } from "../media/protocol";
import type { PhotoRole } from "./rules";
import { photoPrecheckFor, photoRoleFor, recordFaultMedia, type LinkCtx } from "./store";

const AREA_OF: Record<PhotoRole, MediaArea> = { FAULT: "FAULT", WALKAROUND: "WALKAROUND", METER: "HOUR_METER" };
const ROLE_OF: Record<string, PhotoRole> = { FAULT: "FAULT", WALKAROUND: "WALKAROUND", HOUR_METER: "METER" };

export function prestartMediaParty(ctx: LinkCtx, deviceId: unknown): Party {
  const dev = typeof deviceId === "string" && deviceId ? deviceId.slice(0, 64) : ctx.deviceId;
  const done = async () => !!(await prisma.prestartCheck.findFirst({ where: { ...(ctx.sessionId ? { sessionId: ctx.sessionId } : { attendanceId: ctx.attendanceId! }), kind: ctx.kind }, select: { id: true } }));
  return {
    source: { attendanceId: ctx.attendanceId, sessionId: ctx.sessionId, deviceId: dev, takenBy: ctx.person.name },
    owns: (row) => (ctx.sessionId ? row.sessionId === ctx.sessionId : row.attendanceId === ctx.attendanceId) && row.checkKind === ctx.kind && row.resourceId === ctx.machine.id,
    async prepare(body, kind) {
      const role = photoRoleFor(ctx, body.slot ?? null);
      if (!role) return { error: "That photo slot isn't on this check.", status: 400 };
      if (await done()) return { error: "That check is already in - thanks.", status: 409 };
      if (kind === "VIDEO" && role === "FAULT") {
        const videos = await prisma.mediaObject.count({ where: { ...(ctx.sessionId ? { sessionId: ctx.sessionId } : { attendanceId: ctx.attendanceId! }), checkKind: ctx.kind, kind: "VIDEO", state: { not: "REJECTED" } } });
        if (videos >= FAULT_MEDIA.videosPerSignIn) return { error: `That's ${FAULT_MEDIA.videosPerSignIn} videos for this check - send it.`, status: 429 };
      }
      const sha = typeof body.sha256 === "string" && /^[0-9a-f]{64}$/.test(body.sha256) ? body.sha256 : `start:${Date.now()}`;
      const early = await photoPrecheckFor(ctx, role, sha, dev);
      if (early) return early;
      return { area: AREA_OF[role], fields: { resourceId: ctx.machine.id, checkKind: ctx.kind, slot: role === "FAULT" ? null : String(body.slot) } };
    },
    async attach(row) {
      const role = ROLE_OF[row.area];
      if (!role) return { refuse: { error: "That isn't a pre-start upload.", status: 400 }, reason: "AREA" };
      // The phone's own hash when it sent one (the "same photo twice" check, PS-001), else the upload's own name.
      const r = await recordFaultMedia(ctx, {
        role, slot: row.slot, fileName: mediaRef(row.id), mime: row.mime, sha256: row.sha256 ?? mediaRef(row.id),
        kind: row.kind === "VIDEO" ? "VIDEO" : "PHOTO", deviceId: row.deviceId, mediaId: row.id,
      });
      if ("error" in r) {
        const { error, status, capFull, cap } = r;
        return { refuse: { error, status, ...(capFull ? { capFull, cap } : {}) }, reason: capFull ? `CAP_${cap}` : status === 409 ? "DONE" : "CAP" };
      }
      return { linkedId: r.id, reply: { id: r.id } };
    },
    replyFor: async (row) => ({ id: row.linkedId }),
  };
}
