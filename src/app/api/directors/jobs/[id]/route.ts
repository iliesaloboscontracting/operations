import { NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadTracking } from "@/lib/trackingData";

// GET /api/directors/jobs/:id -> one job's costs for the Directors screen
// (25 Oct 2026). Director access only. The same numbers as Tracking (one
// source, lib/trackingData.ts), project-level labour only - no per-person pay.
export const GET = withErrorHandling(async (_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const { id } = await paramsP;
  const { projects } = await loadTracking({ withPeople: false });
  const project = projects.find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project });
});
