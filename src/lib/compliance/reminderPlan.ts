// Stage 5: what to do with a ticket's / document's linked AccountsItem after the record changed. Plain rules, no
// server imports (`npm test`, reminderPlan.test.ts). The Accounts calendar stays the one reminder system:
// lib/compliance/reminders.ts applies the plan.
import { SOON_DAYS } from "./rules";

export type ReminderSource = { active: boolean; expiryDate: string | null; title: string };
export type LinkedItem = { status: string; dueDate: string; title: string } | null;
export type ReminderPlan =
  | { op: "CREATE"; data: { kind: "DUE"; dueDate: string; title: string; alertDays: number; repeat: "NONE"; anchorDay: number } }
  | { op: "UPDATE"; data: { dueDate?: string; title?: string; status?: "OPEN"; alertedFor?: null; anchorDay?: number } }
  | { op: "CANCEL" }
  | { op: "NONE" };

export function reminderPlan(src: ReminderSource, item: LinkedItem): ReminderPlan {
  const wants = src.active && !!src.expiryDate;
  if (!wants) return item && item.status === "OPEN" ? { op: "CANCEL" } : { op: "NONE" };
  const due = src.expiryDate!;
  const day = Number(due.slice(8, 10));
  if (!item) return { op: "CREATE", data: { kind: "DUE", dueDate: due, title: src.title, alertDays: SOON_DAYS, repeat: "NONE", anchorDay: day } };
  if (item.status === "OPEN") {
    if (item.dueDate === due && item.title === src.title) return { op: "NONE" };
    return { op: "UPDATE", data: { ...(item.dueDate !== due ? { dueDate: due, anchorDay: day, alertedFor: null } : {}), ...(item.title !== src.title ? { title: src.title } : {}) } };
  }
  // Done or cancelled: a new expiry (the card was renewed in place) opens it again; otherwise leave it closed.
  if (item.dueDate !== due) return { op: "UPDATE", data: { status: "OPEN", dueDate: due, anchorDay: day, title: src.title, alertedFor: null } };
  return { op: "NONE" };
}
