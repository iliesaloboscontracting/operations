import { NextResponse } from "next/server";
import { guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { loadDirectorOverview } from "@/lib/insights/load";

// GET /api/directors/overview -> the Directors home page in one payload
// (Director Insights, 24 Oct 2026). Director access only (the owner, or the
// director tick on Users) - re-checked against the database on every call.
// Company-wide costs and contract values, but no per-person pay or labour
// lines. Read-only.
export const GET = withErrorHandling(async () => {
  const denied = await guardDirector();
  if (denied) return denied;
  return NextResponse.json(await loadDirectorOverview());
});
