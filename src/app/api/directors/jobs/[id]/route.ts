import { NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadTracking } from "@/lib/trackingData";
import { loadXeroClaims } from "@/lib/xero/imports";
import { jobClaims } from "@/lib/insights/claimsView";
import { todaySydney } from "@/lib/today";

// GET /api/directors/jobs/:id -> one job's costs for the Directors screen
// (25 Oct 2026). Director access only. The same numbers as Tracking (one
// source, lib/trackingData.ts), project-level labour only - no per-person pay. Since 30 Oct 2026 also what the job
// has been claimed in Xero (F14, F16, F17) with its invoices - this route only, never Tracking.
export const GET = withErrorHandling(async (_req: Request, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const { id } = await paramsP;
  const [{ projects }, xero] = await Promise.all([loadTracking({ withPeople: false }), loadXeroClaims()]);
  const project = projects.find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project, claims: jobClaims(xero, project, projects, todaySydney(), new Date()) });
});
