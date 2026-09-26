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
