// A machine's checks & service history (12 Nov 2026) - the database side. Every query is by this one machine's id and
// selects named fields only: a service record's amountExGst / gst / total / invoiceNo / notes, a check's device id and
// any position are never read. The DTOs are built in history.ts (`npm test`).
import { prisma } from "../prisma";
import { buildHistory, MAX_CHECKS, MAX_SERVICES, PUBLIC_DATE_KINDS, type Audience, type HistoryDays, type MachineHistory } from "./history";
import { OPEN_STATUSES } from "./rules";

const DAY_MS = 24 * 60 * 60 * 1000;

// `audience` "public" (the QR - the default) or "office" (the Plant page): the QR gets only the service-due and
// inspection dates (PS-061) and no check ids (PS-064).
export async function machineHistory(machineId: string, days: HistoryDays, audience: Audience = "public", now = new Date()): Promise<MachineHistory | null> {
  const m = await prisma.resource.findUnique({ where: { id: machineId }, select: { id: true, name: true, status: true, serviceDue: true, type: true } });
  if (!m) return null;
  const since = new Date(now.getTime() - days * DAY_MS);
  const [checks, services, docs, faults] = await Promise.all([
    prisma.prestartCheck.findMany({
      where: { resourceId: m.id, createdAt: { gte: since } },
      select: {
        id: true, resourceId: true, kind: true, createdAt: true, personName: true, sessionId: true,
        hourMeter: true, hourMeterFlag: true, hourMeterWrongAt: true, answers: true, walkaround: true, seenCount: true,
        faults: { select: { itemLabel: true, description: true, priority: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_CHECKS + 1,
    }),
    prisma.serviceRecord.findMany({
      where: { resourceId: m.id, removedAt: null },
      select: { resourceId: true, date: true, work: true, mechanic: true, odometer: true, invoiceDraftId: true },
      orderBy: { date: "desc" },
      take: MAX_SERVICES,
    }),
    prisma.complianceDocument.findMany({
      where: { resourceId: m.id, holderType: "ASSET", status: "ACTIVE", ...(audience === "office" ? {} : { kind: { in: PUBLIC_DATE_KINDS } }) },
      select: { resourceId: true, kind: true, status: true, expiryDate: true },
    }),
    prisma.assetFault.findMany({
      where: { resourceId: m.id, status: { in: [...OPEN_STATUSES] } },
      select: { resourceId: true, itemLabel: true, description: true, priority: true, status: true, reportedAt: true },
      take: 100,
    }),
  ]);
  const sessionIds = [...new Set(checks.map((c) => c.sessionId).filter((x): x is string => !!x))];
  const sessions = sessionIds.length
    ? await prisma.plantCheckSession.findMany({ where: { id: { in: sessionIds }, resourceId: m.id }, select: { id: true, company: true } })
    : [];
  return buildHistory({
    machineId: m.id, machineName: m.name, status: m.status, serviceDue: m.serviceDue,
    checks, companies: new Map(sessions.map((s) => [s.id, s.company])), services, docs, faults, days, now, audience,
  });
}

// The Plant page (Managers / Admins): plant and attachments only.
export async function officeMachineHistory(machineId: string, days: HistoryDays) {
  const m = await prisma.resource.findUnique({ where: { id: machineId }, select: { type: true } });
  if (!m || (m.type !== "EQUIPMENT" && m.type !== "ATTACHMENT")) return null;
  return machineHistory(machineId, days, "office");
}
