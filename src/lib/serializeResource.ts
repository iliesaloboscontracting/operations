// Strips fields a caller's role isn't allowed to see from a Resource object
// embedded in an API response - the single place that enforces "crew-facing
// views never carry money" at the API layer, not just in the UI. Every route
// that returns a resource, directly or nested under assignments, must run its
// result through one of these before responding.
import type { Role } from "./auth";
import { PAY_RATE_FIELDS } from "./resourceFields";

const RANK: Record<Role, number> = { TIMESHEETS: 0, VIEWER: 1, MANAGER: 2, ADMIN: 3 };

// Pay rate fields (ordinaryRate, nightRate, payRateNotes, ...): ADMIN only.
// dailyRateExGst/rate (plant/vehicle/hire day-rate cost fields): MANAGER or
// ADMIN. Mutates in place and returns the same object for convenience.
export function toPublicResource<T extends Record<string, unknown>>(resource: T, role: Role | null): T {
  const rank = role ? RANK[role] : 0;
  if (rank < RANK.ADMIN) {
    for (const f of PAY_RATE_FIELDS) delete resource[f];
  }
  if (rank < RANK.MANAGER) {
    delete resource.dailyRateExGst;
    delete resource.rate;
    delete resource.hireRate;
    delete resource.hireRateUnit;
    delete resource.hireDeliveryCost;
    delete resource.hireCollectionCost;
  }
  return resource;
}

// For /api/jobs, /api/jobs/[id], /api/jobs/completed: a job (or array of
// jobs) with an `assignments[].resource` shape.
export function sanitizeJobs<T extends { assignments: { resource: Record<string, unknown> }[] }>(
  jobs: T[],
  role: Role | null
): T[] {
  for (const j of jobs) for (const a of j.assignments) toPublicResource(a.resource, role);
  return jobs;
}

// For /api/assignments, /api/assignments/[id]: a single assignment with a
// nested `resource`.
export function sanitizeAssignment<T extends { resource: Record<string, unknown> }>(
  assignment: T,
  role: Role | null
): T {
  toPublicResource(assignment.resource, role);
  return assignment;
}
