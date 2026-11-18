import { normaliseSources, PROJECT_FILE_KEYS } from "./projectFile";
import { isProjectStatus } from "./projectLists";

const FIELDS = [
  "name", "client", "jobNo", "quoteNo", "address", "status", "startDate", "dayStart", "dayEnd",
  "nightStart", "nightEnd", "unpaidBreakMinutes", "notes", "archived", "regional",
  "contractValue", "contractValueNotes", "scopeOfWorks",
  "startDateConfidence", "completionConfidence", "completionReviewBy",
  ...PROJECT_FILE_KEYS,
] as const;

const NUMERIC_FIELDS = new Set(["unpaidBreakMinutes", "contractValue"]);

export function pickProject(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const k of FIELDS) {
    if (k in body) {
      const v = body[k];
      if (k === "regional") {
        data[k] = v === true || v === "true"; // Regional (2 Nov 2026): a yes / no
      } else if (NUMERIC_FIELDS.has(k)) {
        data[k] = v === "" || v === null || v === undefined ? null : Number(v);
      } else {
        data[k] = typeof v === "string" && v.trim() === "" && k !== "name" && k !== "status" ? null : v;
      }
    }
  }
  if ("fieldSources" in body) data.fieldSources = normaliseSources(body.fieldSources);
  if (data.status === null || data.status === "") delete data.status;
  return data;
}

// Project status on save (18 Nov 2026): only ACTIVE | INACTIVE (shown as "Stand down") | COMPLETED is stored.
export function projectStatusError(data: Record<string, unknown>): string | null {
  if (!("status" in data) || isProjectStatus(data.status)) return null;
  return "Status must be Active, Stand down or Completed.";
}
