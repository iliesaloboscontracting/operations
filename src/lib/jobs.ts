// A job linked to a project always shows that project's *current* name,
// client, job number and site address - these aren't a per-job copy, so
// changing one (from either the Projects page or the job's own edit form)
// updates every job for that project immediately, instead of each job
// keeping its own stale snapshot from whenever it was created. A one-off job
// (no project) keeps its own values, since there's nothing to resolve them
// from.
export function liveJobFields(job: {
  title: string;
  client: string | null;
  siteCode: string | null;
  siteAddress: string | null;
  project: { name: string; client: string | null; jobNo: string | null; address: string | null } | null;
}) {
  return job.project
    ? {
        title: job.project.name,
        client: job.project.client,
        siteCode: job.project.jobNo,
        siteAddress: job.project.address,
      }
    : { title: job.title, client: job.client, siteCode: job.siteCode, siteAddress: job.siteAddress };
}

// Keep forever (Ilies, 10 Nov 2026): a job is never deleted - the board's Delete became Cancel (status CANCELLED,
// cancelledAt / By / Reason). Every query that lists, counts or costs jobs adds LIVE_JOB, so a cancelled job is left
// out wherever a deleted one used to be gone from.
export const LIVE_JOB = { cancelledAt: null } as const;
export const isCancelledJob = (j: { cancelledAt?: Date | string | null; status?: string | null }) => !!j.cancelledAt || j.status === "CANCELLED";
// Why a job was cancelled - picked, not typed (house style); "Other" still types one.
export const CANCEL_REASONS = [
  "Added by mistake",
  "Added on the wrong day",
  "Client cancelled",
  "Work not going ahead",
  "Duplicate of another job",
] as const;
