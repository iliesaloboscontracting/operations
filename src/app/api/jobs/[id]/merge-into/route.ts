import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mergeLooseJob } from "@/lib/jobMerge";

// POST /api/jobs/:id/merge-into { targetJobId, reason } -> a job with no project is merged into its project's job for
// the same day and shift (18 Nov 2026, lib/jobMerge.ts): allocations, sign-ins and Day Review rows move, the loose
// job is cancelled (kept, with the reason) - one transaction, nothing deleted. Managers and Admins.
export const POST = withErrorHandling(async (
  req: NextRequest,
  { params: paramsP }: { params: Promise<{ id: string }> }
) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const targetJobId = typeof body?.targetJobId === "string" ? body.targetJobId : "";
  const reason = typeof body?.reason === "string" ? body.reason : "";
  const out = await mergeLooseJob(params.id, targetJobId, { id: user.id, name: user.name }, reason);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
