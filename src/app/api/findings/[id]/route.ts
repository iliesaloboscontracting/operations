import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { todaySydney } from "@/lib/today";
import { applyFindingAction, canActOnFindings, canSeeFinding } from "@/lib/findings/actions";
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
  if (!f || !canSeeFinding(user, f.audience)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(detail(f, canActOnFindings(user)));
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canActOnFindings(user)) return NextResponse.json({ error: "Only Iliesa or a director acts on findings." }, { status: 403 });
  const f = await load(params.id);
  if (!f || !canSeeFinding(user, f.audience)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const candidate = body.action === "ASSIGN" && typeof body.ownerUserId === "string"
    ? await prisma.user.findFirst({ where: { id: body.ownerUserId, active: true }, select: { id: true, name: true, email: true, role: true, directorAccess: true } })
    : null;
  // An owner is someone who can act on findings.
  const owner = candidate && canActOnFindings(candidate) ? { id: candidate.id, name: candidate.name } : null;
  const out = applyFindingAction(f, String(body.action ?? ""), body, { actor: user, now: new Date(), today: todaySydney(), owner });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  try {
    await prisma.$transaction([
      ...(Object.keys(out.data).length ? [prisma.finding.update({ where: { id: f.id }, data: out.data })] : []),
      prisma.findingEvent.create({ data: { findingId: f.id, action: out.event.action, by: user.name, byUserId: user.id, fromValue: out.event.fromValue ?? null, toValue: out.event.toValue ?? null, note: out.event.note ?? null } }),
    ]);
  } catch {
    // Reopening onto a key another open finding already holds (the unique openKey).
    return NextResponse.json({ error: "Another open finding already covers this - refresh and look at that one." }, { status: 409 });
  }
  return NextResponse.json(detail((await load(f.id))!, true));
});
