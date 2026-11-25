import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { todaySydney } from "@/lib/today";
import { applyFindingAction, canActOnThisFinding, canSeeThisFinding, coordinatorMayAct } from "@/lib/findings/actions";
import { SNOOZE_MAX_DAYS, screenFor } from "@/lib/findings/config";
import { toFindingDTO } from "@/lib/findings/view";
import { requestNo, STATUS_FOR_OFFICE } from "@/lib/requestTypes";

// GET  /api/findings/:id -> one finding with its history, evidence and queries
// POST /api/findings/:id { action, ... } -> acknowledge / assign / resolve /
//      dismiss / comment / verify (lib/findings/actions.ts). The owner and
//      director-access users only; every action is a FindingEvent.
async function load(id: string) {
  return prisma.finding.findUnique({
    where: { id },
    include: {
      events: { orderBy: { at: "asc" } },
      evidence: { orderBy: { capturedAt: "asc" } },
      requests: { where: { kind: "QUERY" }, orderBy: { createdAt: "asc" } },
    },
  });
}
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

const detail = (f: Loaded, canAct: boolean) => ({
  canAct,
  screen: screenFor(f), // Task J: Directors or Operations (Attention)
  finding: {
    ...toFindingDTO(f),
    dedupeKey: f.dedupeKey, confidence: f.confidence, seenCount: f.seenCount, ownerUserId: f.ownerUserId, dueDate: f.dueDate,
    resolvedAt: f.resolvedAt?.toISOString() ?? null, resolvedBy: f.resolvedBy, resolution: f.resolution, resolvedWhileFiring: f.resolvedWhileFiring,
    dismissKind: f.dismissKind, dismissReason: f.dismissReason, suppressUntil: f.suppressUntil,
    verifiedAt: f.verifiedAt?.toISOString() ?? null, verifiedBy: f.verifiedBy, outcomeResult: f.outcomeResult,
    currentValue: f.currentValue ? (JSON.parse(f.currentValue) as Record<string, unknown>) : null,
  },
  events: f.events.map((e) => ({ action: e.action, by: e.by, fromValue: e.fromValue, toValue: e.toValue, note: e.note, at: e.at.toISOString() })),
  evidence: f.evidence.map((e) => ({ kind: e.kind, recordType: e.recordType, recordId: e.recordId, label: e.label, value: e.value, capturedAt: e.capturedAt.toISOString(), capturedBy: e.capturedBy })),
  queries: f.requests.map((r) => ({
    id: r.id, ref: requestNo(r.number), to: r.assigneeName, question: r.summary, status: r.status, statusLabel: STATUS_FOR_OFFICE[r.status] ?? r.status,
    answer: r.answer, hasFile: !!r.answerFile, outcome: r.outcome, askedAt: r.createdAt.toISOString(),
  })),
});
export type FindingDetail = ReturnType<typeof detail>;

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const f = await load(params.id);
  // Task J: the screen the finding belongs on decides who sees and acts on it.
  if (!f || !canSeeThisFinding(user, f)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(detail(f, canActOnThisFinding(user, f)));
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const f = await load(params.id);
  const body = await req.json().catch(() => ({}));
  // LCI Stage 1: the coordinator's card - Done / Snooze on his own kinds only, and the reply is just "ok" (no detail).
  if (user.role === "COORDINATOR") {
    if (!f || !coordinatorMayAct(user, f)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!coordinatorMayAct(user, f, String(body.action ?? ""), body)) return NextResponse.json({ error: "From your card you can mark it done or snooze it to a date." }, { status: 403 });
    // LS-001: his snooze is at most 14 days.
    const out = applyFindingAction(f, String(body.action), body, { actor: user, now: new Date(), today: todaySydney(), owner: null, maxSnoozeDays: SNOOZE_MAX_DAYS.coordinator });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
    if (!(await writeGuarded(f.id, f.status, out, user))) return NextResponse.json({ error: CHANGED }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (!f || !canSeeThisFinding(user, f)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!canActOnThisFinding(user, f)) return NextResponse.json({ error: screenFor(f) === "OPERATIONS" ? "Only Iliesa, Admins and Managers act on these." : "Only Iliesa or a director acts on findings." }, { status: 403 });
  const candidate = body.action === "ASSIGN" && typeof body.ownerUserId === "string"
    ? await prisma.user.findFirst({ where: { id: body.ownerUserId, active: true }, select: { id: true, name: true, email: true, role: true, directorAccess: true } })
    : null;
  // An owner is someone who can act on this finding.
  const owner = candidate && canActOnThisFinding(candidate, f) ? { id: candidate.id, name: candidate.name } : null;
  const out = applyFindingAction(f, String(body.action ?? ""), body, { actor: user, now: new Date(), today: todaySydney(), owner });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  let written = false;
  try {
    written = await writeGuarded(f.id, f.status, out, user);
  } catch {
    // Reopening onto a key another open finding already holds (the unique openKey).
    return NextResponse.json({ error: "Another open finding already covers this - refresh and look at that one." }, { status: 409 });
  }
  if (!written) return NextResponse.json({ error: CHANGED }, { status: 409 });
  return NextResponse.json(detail((await load(f.id))!, true));
});

// LS-002: write a person's action only if the finding is still in the status they saw (the engine, or someone else,
// may have changed it since) - then its event, in the same transaction. False = it changed: nothing written.
const CHANGED = "This item just changed, refresh and try again";
async function writeGuarded(
  id: string, seenStatus: string,
  out: { data: Record<string, unknown>; event: { action: string; fromValue?: string | null; toValue?: string | null; note?: string | null } },
  user: { id: string; name: string },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if (Object.keys(out.data).length) {
      const r = await tx.finding.updateMany({ where: { id, status: seenStatus }, data: out.data });
      if (r.count === 0) return false;
    }
    await tx.findingEvent.create({ data: { findingId: id, action: out.event.action, by: user.name, byUserId: user.id, fromValue: out.event.fromValue ?? null, toValue: out.event.toValue ?? null, note: out.event.note ?? null } });
    return true;
  });
}
