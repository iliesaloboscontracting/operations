import { BoardColumn, ResourceDTO } from "./types";

// Which Command Centre column a resource belongs in.
// Hired labour goes in Crew; other hired gear goes in Hire; everything owned that isn't a person is Plant.
export function columnFor(r: Pick<ResourceDTO, "type" | "category">): BoardColumn {
  if (r.type === "PERSONNEL" || (r.type === "HIRE" && r.category === "LABOUR"))
    return "crew";
  if (r.type === "HIRE") return "hire";
  return "plant";
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
