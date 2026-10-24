import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guard } from "@/lib/auth";
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
  const bug = await prisma.bugReport.update({ where: { id: params.id }, data });
  return NextResponse.json(bug);
});

// DELETE /api/bugs/:id -> Managers+ only (e.g. clearing a duplicate/spam report)
export const DELETE = withErrorHandling(async (
  _req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  await prisma.bugReport.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
