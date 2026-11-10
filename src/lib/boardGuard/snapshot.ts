// Keep forever (Ilies, 10 Nov 2026): what a board change took off the board, in full. Allocation rows are still
// deleted (cost allocation everywhere reads the live rows), but never without this snapshot in the same transaction:
// every field the Assignment row had, the resource's id / name / type, the job's id / title / date / shift / times,
// and for "Clear board" the day briefs it emptied. Names, roles and times only - never money. Plain, tested.

export type RemovedAllocation = {
  assignmentId: string; jobId: string; resourceId: string; role: string | null; createdAt: string;
  resourceName: string; resourceType: string | null;
  jobTitle: string; jobDate: string; shift: string; startTime: string | null; endTime: string | null; projectId: string | null;
};
export type ClearedBrief = { jobId: string; jobTitle: string; jobDate: string; shift: string; dayBrief: string };
export type CancelledJob = {
  jobId: string; projectId: string | null; title: string; client: string | null; siteCode: string | null; siteAddress: string | null;
  date: string; shift: string; startTime: string | null; endTime: string | null; status: string; dayBrief: string | null;
  colorTag: string; notRunning: boolean; sortOrder: number; dateCheckNote: string | null;
};
export type BoardRemovalSnapshot = {
  v: 1;
  kind: "REMOVE" | "MOVE_DUPLICATE" | "CLEAR" | "JOB_CANCEL";
  allocations: RemovedAllocation[];
  briefs?: ClearedBrief[];
  job?: CancelledJob;
};

type AssignmentRow = {
  id: string; jobId: string; resourceId: string; role: string | null; createdAt: Date;
  resource: { name: string; type?: string | null };
  job: { id?: string; title: string; date: Date; shift: string; startTime?: string | null; endTime?: string | null; projectId?: string | null };
};

const day = (d: Date) => d.toISOString().slice(0, 10);

export function allocationSnapshot(a: AssignmentRow): RemovedAllocation {
  return {
    assignmentId: a.id, jobId: a.jobId, resourceId: a.resourceId, role: a.role ?? null, createdAt: a.createdAt.toISOString(),
    resourceName: a.resource.name, resourceType: a.resource.type ?? null,
    jobTitle: a.job.title, jobDate: day(a.job.date), shift: a.job.shift, startTime: a.job.startTime ?? null, endTime: a.job.endTime ?? null,
    projectId: a.job.projectId ?? null,
  };
}

// The select an Assignment is read with before it is deleted, so the snapshot has everything.
export const ASSIGNMENT_FOR_SNAPSHOT = {
  resource: { select: { name: true, type: true } },
  job: { select: { id: true, title: true, date: true, shift: true, startTime: true, endTime: true, projectId: true } },
} as const;

export function cancelledJobSnapshot(j: {
  id: string; projectId: string | null; title: string; client: string | null; siteCode: string | null; siteAddress: string | null;
  date: Date; shift: string; startTime: string | null; endTime: string | null; status: string; dayBrief: string | null;
  colorTag: string; notRunning: boolean; sortOrder: number; dateCheckNote: string | null;
}): CancelledJob {
  return {
    jobId: j.id, projectId: j.projectId, title: j.title, client: j.client, siteCode: j.siteCode, siteAddress: j.siteAddress,
    date: day(j.date), shift: j.shift, startTime: j.startTime, endTime: j.endTime, status: j.status, dayBrief: j.dayBrief,
    colorTag: j.colorTag, notRunning: j.notRunning, sortOrder: j.sortOrder, dateCheckNote: j.dateCheckNote,
  };
}

export const snapshotText = (s: BoardRemovalSnapshot) => JSON.stringify(s);
