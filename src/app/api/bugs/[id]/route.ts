import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard, getCurrentUser } from "@/lib/auth";
import { hideTracked, updateTracked } from "@/lib/history/store";
import { withErrorHandling } from "@/lib/apiHandler";

const FIELDS = ["title", "description", "severity", "status", "notes"] as const;

// PATCH /api/bugs/:id -> triage a report (status, notes, severity). Managers+ only.
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  for (const key of FIELDS) {
    if (key in body) {
      const v = body[key];
      data[key] = typeof v === "string" && v.trim() === "" && key === "notes" ? null : v;
    }
  }
  const current = await prisma.bugReport.findUnique({ where: { id: params.id }, select: { removedAt: true } });
  if (!current || current.removedAt) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Every field that changed is kept in the report's history (keep forever, 10 Nov 2026).
  const bug = await updateTracked("BugReport", params.id, data, { by: await getCurrentUser(), source: "Bug report triage" });
  return NextResponse.json(bug);
});

// DELETE /api/bugs/:id { reason? } -> Managers+ only (e.g. clearing a duplicate/spam report). Keep forever (Ilies,
// 10 Nov 2026): hidden (removedAt / By / Reason), never erased.
export const DELETE = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const out = await hideTracked("BugReport", params.id, { by: await getCurrentUser(), reason: typeof body?.reason === "string" ? body.reason : null, source: "Bug report (remove)" });
  if (!out) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
