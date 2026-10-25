import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { canSeeThisFinding } from "@/lib/findings/actions";
import { screenFor } from "@/lib/findings/config";
import { sortFindings, toFindingDTO } from "@/lib/findings/view";

// GET /api/attention -> the operational findings (Task J, 25 Oct 2026): every
// kind not on the Directors screen (findings/config.ts DIRECTOR_KINDS) - crew,
// supervisors, starts, days not closed, hire, dates, uncosted lines, plant
// not booked. Manager+ (the owner, Admins, Managers); a directors-only login
// never gets them. ?count=1 -> { urgent } for the nav badge (critical + high).
const OPENISH = ["OPEN", "ACKNOWLEDGED", "ACTIONED"];

export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const open = (await prisma.finding.findMany({ where: { status: { in: OPENISH } } }))
    .filter((f) => screenFor(f) === "OPERATIONS" && canSeeThisFinding(user, f));
  if (req.nextUrl.searchParams.get("count")) {
    return NextResponse.json({ urgent: open.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length });
  }
  const [lastSeen, closed] = await Promise.all([
    prisma.finding.aggregate({ _max: { lastSeenAt: true } }),
    prisma.finding.findMany({ where: { status: { in: ["RESOLVED", "VERIFIED"] }, resolvedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, select: { ruleCode: true, audience: true } }),
  ]);
  const findings = sortFindings(open.map(toFindingDTO));
  return NextResponse.json({
    findings,
    meta: {
      open: findings.length,
      bySeverity: findings.reduce<Record<string, number>>((m, f) => { m[f.severity] = (m[f.severity] ?? 0) + 1; return m; }, {}),
      signalCleared: findings.filter((f) => f.signalClearedAt).length,
      closedThisWeek: closed.filter((f) => screenFor(f) === "OPERATIONS").length,
      checkedAt: lastSeen._max.lastSeenAt?.toISOString() ?? null,
    },
  });
});
