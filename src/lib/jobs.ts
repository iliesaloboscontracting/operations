// A job linked to a project always shows that project's *current* client, job
// number and site address - these aren't a per-job copy, so changing one on
// the Projects page updates every job for that project immediately, instead
// of each job keeping its own stale snapshot from whenever it was created.
// A one-off job (no project) keeps its own values, since there's nothing to
// resolve them from.
export function liveJobFields(job: {
  client: string | null;
  siteCode: string | null;
  siteAddress: string | null;
  project: { client: string | null; jobNo: string | null; address: string | null } | null;
}) {
  return job.project
    ? { client: job.project.client, siteCode: job.project.jobNo, siteAddress: job.project.address }
    : { client: job.client, siteCode: job.siteCode, siteAddress: job.siteAddress };
}
