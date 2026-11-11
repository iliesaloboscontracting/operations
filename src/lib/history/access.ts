// Who may read a record's change history, and which of its fields (keep forever, Ilies 10 Nov 2026). The same walls as
// the record itself: pay fields Admin only and day / hire rates Manager+ (toPublicResource), a project's contract
// figures and internal notes Manager+ (GET /api/projects/:id), the accounts calendar accounts + Admins (guardAccounts),
// the invoices inbox accounts + Manager+ (guardInvoiceInbox). Everything else is Manager+. No server imports - tested.
import { rankAtLeast } from "../roleRank";
import { toPublicResource } from "../serializeResource";
import type { Role } from "../roles";
import type { HistoryModel } from "./diff";

type Rule = { canRead: (role: string) => boolean; fieldVisible?: (field: string, role: string) => boolean };

const managerUp = (role: string) => rankAtLeast(role, "MANAGER");
const PROJECT_MANAGER_ONLY = new Set(["contractValue", "contractValueNotes", "notes"]);

// A Resource field is shown in its history exactly when toPublicResource would leave it on the record for that role.
export const resourceFieldVisible = (field: string, role: string) => field in toPublicResource({ [field]: 0 } as Record<string, unknown>, role as Role);

export const HISTORY_RULES: Record<HistoryModel, Rule> = {
  Resource: { canRead: (r) => rankAtLeast(r, "VIEWER"), fieldVisible: resourceFieldVisible },
  Project: { canRead: (r) => rankAtLeast(r, "VIEWER"), fieldVisible: (f, r) => managerUp(r) || !PROJECT_MANAGER_ONLY.has(f) },
  Job: { canRead: managerUp },
  Tool: { canRead: managerUp },
  Toolbox: { canRead: managerUp },
  ToolIssue: { canRead: managerUp },
  InvoicedCost: { canRead: managerUp },
  InvoiceDraft: { canRead: (r) => r === "ACCOUNTS" || managerUp(r) },
  ServiceRecord: { canRead: managerUp },
  ProjectContact: { canRead: managerUp },
  SiteAlias: { canRead: managerUp },
  BugReport: { canRead: managerUp },
  AccountsItem: { canRead: (r) => r === "ACCOUNTS" || r === "ADMIN" },
  JobActual: { canRead: managerUp },
  DayClose: { canRead: managerUp },
  TimesheetWeek: { canRead: managerUp },
  LabourHireCompanyAlias: { canRead: managerUp }, // Managers / Admins map them; the coordinator only sees the list on the page
};

export const canReadHistory = (model: HistoryModel, role: string | null | undefined) => !!role && HISTORY_RULES[model].canRead(role);

// The rows a role may see: the record's rule first, then field by field.
export function visibleChanges<T extends { field: string }>(model: HistoryModel, role: string | null | undefined, rows: T[]): T[] {
  if (!canReadHistory(model, role)) return [];
  const f = HISTORY_RULES[model].fieldVisible;
  return f ? rows.filter((r) => f(r.field, role!)) : rows;
}
