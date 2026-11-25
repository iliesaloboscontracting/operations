// Writes one engine run's plan inside a transaction (lib/findings/store.ts passes Prisma's tx). No prisma import, so
// tests pass a stand-in tx. LS-002 (Ilies approved, 25 Nov 2026): an update is written only if the finding still has
// the status the plan was made from (op.fromStatus) - a person's Done / Snooze in the meantime is never overwritten;
// that op's events and evidence are skipped too. Returns the ops actually written.
import type { Op } from "./engine";

type Row = Record<string, unknown>;
export type FindingsTx = {
  finding: {
    create(a: { data: never; select: { id: true } }): Promise<{ id: string }>;
    updateMany(a: { where: { id: string; status?: string }; data: never }): Promise<{ count: number }>;
  };
  findingEvent: { createMany(a: { data: Row[] }): Promise<unknown> };
  findingEvidence: { createMany(a: { data: Row[] }): Promise<unknown> };
};

export async function applyOps(tx: FindingsTx, ops: Op[], now: Date): Promise<Op[]> {
  const written: Op[] = [];
  for (const op of ops) {
    let id: string;
    if (op.type === "create") {
      id = (await tx.finding.create({ data: op.data as never, select: { id: true } })).id;
    } else {
      const r = await tx.finding.updateMany({ where: { id: op.id, ...(op.fromStatus ? { status: op.fromStatus } : {}) }, data: op.data as never });
      if (r.count === 0) continue; // it changed since the plan was made - leave it as the person left it
      id = op.id;
    }
    if (op.events.length) {
      await tx.findingEvent.createMany({ data: op.events.map((e) => ({ findingId: id, action: e.action, by: "System", fromValue: e.fromValue ?? null, toValue: e.toValue ?? null, note: e.note ?? null, at: now })) });
    }
    if (op.evidence.length) {
      await tx.findingEvidence.createMany({ data: op.evidence.map((e) => ({ findingId: id, kind: e.kind, recordType: e.recordType ?? null, recordId: e.recordId ?? null, label: e.label, value: e.value ?? null, asOf: now, capturedAt: now })) });
    }
    written.push(op);
  }
  return written;
}
