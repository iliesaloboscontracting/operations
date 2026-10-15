import { BoardColumn, ResourceDTO } from "./types";

// Which Command Centre column a resource belongs in.
// Hired labour goes in Crew; other hired gear goes in Hire; everything owned that isn't a person is Plant.
export function columnFor(r: Pick<ResourceDTO, "type" | "category">): BoardColumn {
  if (r.type === "PERSONNEL" || (r.type === "HIRE" && r.category === "LABOUR"))
    return "crew";
  if (r.type === "HIRE") return "hire";
  return "plant";
}

// Agency (labour-hire) personnel: shown yellow in the Yard and on the board so
// they stand apart from Lobos's own crew at a glance.
export function isLabourHire(r: Pick<ResourceDTO, "type" | "category">) {
  return r.type === "HIRE" && r.category === "LABOUR";
}

// The Yard's "Labour hire" box: dragging it onto a job creates a fresh
// "Labour hire N" tile on that job (one per drag). These quick tiles live only
// on the job they were dropped on - they never sit in the Yard - and removing
// one from its job (the x) retires it.
export const NEW_LABOUR_HIRE = "new-labour-hire";
export const QUICK_LABOUR_HIRE_NAME = /^Labour hire (\d+)$/i;
export function isQuickLabourHire(r: Pick<ResourceDTO, "type" | "category" | "name">) {
  return isLabourHire(r) && QUICK_LABOUR_HIRE_NAME.test(r.name);
}

export function money(n: number | null | undefined) {
  if (n === null || n === undefined) return null;
  return n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Job titles a resource is placed on today (for the register "Where" column).
export function whereToday(r: ResourceDTO): string | null {
  const today = localISODate();
  const titles = (r.assignments ?? [])
    .filter((a) => a.job.date.slice(0, 10) === today)
    .map((a) => a.job.title);
  return titles.length ? Array.from(new Set(titles)).join(", ") : null;
}

// DOWN / LEAVE are set by hand; otherwise a resource is ON_SITE if placed today, else AVAILABLE.
export function effectiveStatus(r: ResourceDTO): string {
  if (r.status === "DOWN" || r.status === "LEAVE") return r.status;
  return whereToday(r) ? "ON_SITE" : "AVAILABLE";
}

export const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available" },
  { value: "ON_SITE", label: "On site" },
  { value: "DOWN", label: "Down" },
  { value: "LEAVE", label: "Leave" },
];

export const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  ON_SITE: "On site",
  DOWN: "Down",
  LEAVE: "Leave",
};

// A crew member's default role/trade - shown as an inline dropdown on their Yard
// card, and editable from their full profile on the Labour register too. Order
// is also the on-site hierarchy, top tier first - see roleRank below.
export const CREW_ROLE_OPTIONS = [
  "Supervisor",
  "Lead",
  "Operator",
  "Driver",
  "Skilled labour",
  "Carpenter",
  "Traffic control",
  "General labour",
  "Other",
];

// Office staff (Commercial, Operations, admin) live in the Personnel register
// so a project can link its Lobos office contact to them instead of retyping
// a name and number - but they're never allocated to a site, so this role is
// kept out of the Allocations crew pool and out of CREW_ROLE_OPTIONS (which
// is also the per-assignment role list). Added 2026-10-14 (Project File).
export const OFFICE_ROLE = "Office";
export const REGISTER_ROLE_OPTIONS = [...CREW_ROLE_OPTIONS, OFFICE_ROLE];

export function isOfficeStaff(r: { type: string; role?: string | null }) {
  return r.type === "PERSONNEL" && r.role === OFFICE_ROLE;
}

// Where a crew role sits in the on-site hierarchy - lower number is more senior.
// Used to order a job's crew top tier to bottom once they're assigned. A role
// with no rank (not set, or not one of CREW_ROLE_OPTIONS) sorts last.
export function roleRank(role: string | null | undefined): number {
  if (!role) return CREW_ROLE_OPTIONS.length + 1;
  const i = CREW_ROLE_OPTIONS.indexOf(role);
  return i === -1 ? CREW_ROLE_OPTIONS.length : i;
}
