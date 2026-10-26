// Stage 5: keeps one AccountsItem in step with each ticket / document that has an expiry, so the Accounts
// To do, the Due-dates calendar and the phone alert (lib/accounts/store.ts) cover compliance with no second
// reminder system. The decision is reminderPlan(); this file only applies it.
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { reminderPlan, type ReminderSource } from "./reminderPlan";

export type SourceType = "WORKER_TICKET" | "COMPLIANCE_DOC";
const CATEGORY: Record<SourceType, string> = { WORKER_TICKET: "TICKET", COMPLIANCE_DOC: "COMPLIANCE" };

type Db = Prisma.TransactionClient | typeof prisma;

export async function syncReminder(db: Db, sourceType: SourceType, sourceId: string, src: ReminderSource, by: string) {
  // The newest linked item is the live one (an old one stays as history).
  const item = await db.accountsItem.findFirst({ where: { sourceType, sourceId }, orderBy: { createdAt: "desc" } });
  const plan = reminderPlan(src, item);
  switch (plan.op) {
    case "CREATE":
      await db.accountsItem.create({ data: { ...plan.data, category: CATEGORY[sourceType], sourceType, sourceId, createdBy: by } });
      return "CREATED";
    case "UPDATE":
      await db.accountsItem.update({ where: { id: item!.id }, data: plan.data });
      return "UPDATED";
    case "CANCEL":
      await db.accountsItem.update({ where: { id: item!.id }, data: { status: "CANCELLED", lastDoneBy: by, lastDoneAt: new Date() } });
      return "CANCELLED";
    default:
      return "NONE";
  }
}
