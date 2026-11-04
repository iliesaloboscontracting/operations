import { NextResponse } from "next/server";
import { getCurrentUser, guardOrYard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { mayActOnYard } from "@/lib/yard/rules";
import { listYardJobs } from "@/lib/yard/store";

// GET /api/yard - the yard's list for /yard (Ilies, 4 Nov 2026): Managers and up, and
// the YARD login. The same narrow yardView the yard's phone link gets (no dollar
// figure). canAct: the YARD login and Admins work it; Managers only look.
export const GET = withErrorHandling(async () => {
  const denied = await guardOrYard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  return NextResponse.json({ jobs: await listYardJobs(), canAct: mayActOnYard({ via: "LOGIN", role: user.role }) });
});
