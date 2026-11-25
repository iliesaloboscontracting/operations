// The optional photos on an incident report (25 Nov 2026) - through the media bucket exactly as the variation docket's
// photos go (lib/media/protocol.ts: signed addresses, the server checks the object's size and first bytes before
// READY, the per-link day caps). Area INCIDENT, photos only, for a job this link has today. READY gives the phone
// "media:<id>"; the report then cites the id (incidents.ts sendIncident checks it's this link's, this job's, READY).
// Once a report that cites it is sent, the link can't read it back (the route checks photoOnAReport) - only the
// owner and DIRECTOR logins see it. Words and ids only - no money.
import type { ResolvedLink } from "../siteLinks";
import { mediaRef } from "../media/rules";
import type { Party } from "../media/protocol";
import { docJob } from "./store";

export function incidentMediaParty(link: ResolvedLink, now = new Date()): Party {
  return {
    source: { siteLinkId: link.id, takenBy: link.person.name },
    owns: (row) => row.siteLinkId === link.id && row.area === "INCIDENT",
    async prepare(body, kind) {
      if (body.area !== undefined && body.area !== "INCIDENT") return { error: "That upload isn't for an incident report.", status: 400 };
      if (kind !== "PHOTO") return { error: "Only photos here.", status: 400 };
      const job = await docJob(link, body.jobId, now);
      if (!job) return { error: "That job isn't one of yours today.", status: 403 };
      return { area: "INCIDENT", fields: { jobId: job.id } };
    },
    async attach(row) {
      return { reply: { ref: mediaRef(row.id) } };
    },
    async replyFor(row) {
      return { ref: mediaRef(row.id) };
    },
  };
}
