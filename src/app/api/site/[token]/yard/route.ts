import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isYardLink } from "@/lib/yard/rules";
import { listYardJobs } from "@/lib/yard/store";

// GET /api/site/:token/yard - the yard's list (Ilies, 4 Nov 2026), on the yard's
// shared phone link only (an OFFICE link with no person). Open yard jobs, ready
// ones not yet collected, and those collected in the last 7 days - yardView only
// (no dollar figure). Every other link: 404.
export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link || !isYardLink(link)) return NextResponse.json({ error: "No yard list on this link." }, { status: 404 });
  return NextResponse.json({ jobs: await listYardJobs(), canAct: true });
});
