// The optional photos on a variation docket (25 Nov 2026) - through the media bucket exactly as the daily log's photos
// go (lib/media/protocol.ts: signed addresses, the server checks the object's size and first bytes before READY, the
// per-link day caps). Area VARIATION, photos only, for a job this link can do a docket for now. READY gives the phone
// "media:<id>"; the docket then cites the id (store.ts sendDocket checks it's this link's, this job's, READY). A link
// only completes or reads its own uploads. Words and ids only - no money.
import type { ResolvedLink } from "../siteLinks";
import { mediaRef } from "../media/rules";
import type { Party } from "../media/protocol";
import { variationJobs } from "./store";

export function variationMediaParty(link: ResolvedLink, now = new Date()): Party {
  return {
    source: { siteLinkId: link.id, takenBy: link.person.name },
    owns: (row) => row.siteLinkId === link.id && row.area === "VARIATION",
    async prepare(body, kind) {
      if (body.area !== undefined && body.area !== "VARIATION") return { error: "That upload isn't for a docket.", status: 400 };
      if (kind !== "PHOTO") return { error: "Only photos here.", status: 400 };
      const jobId = typeof body.jobId === "string" ? body.jobId : null;
      const job = jobId ? (await variationJobs(link, now)).find((j) => j.id === jobId) : null;
      if (!job) return { error: "That job isn't one you can do a docket for today.", status: 403 };
      return { area: "VARIATION", fields: { jobId: job.id } };
    },
    async attach(row) {
      return { reply: { ref: mediaRef(row.id) } };
    },
    async replyFor(row) {
      return { ref: mediaRef(row.id) };
    },
  };
}
