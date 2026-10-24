import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { audiencesFor, canActOnFindings } from "@/lib/findings/actions";
import { sortFindings, toFindingDTO } from "@/lib/findings/view";

// GET /api/findings          -> open findings this login may see
// GET /api/findings?closed=1 -> plus those closed in the last 30 days
// Phase 2 (25 Oct 2026). Directors and the owner see all; Managers see
// operational and commercial ones (no acting yet); Viewers operational only;
// Timesheets / Accounts logins none. Read-only - actions are on [id].
export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const audiences = audiencesFor(user);
  if (!audiences.length) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const withClosed = !!req.nextUrl.searchParams.get("closed");
  const rows = await prisma.finding.findMany({
    where: {
      audience: { in: audiences },
      OR: [
        { status: { in: ["OPEN", "ACKNOWLEDGED", "ACTIONED"] } },
        ...(withClosed ? [{ updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] : []),
      ],
    },
  });
  return NextResponse.json({ canAct: canActOnFindings(user), findings: sortFindings(rows.map(toFindingDTO)) });
});
