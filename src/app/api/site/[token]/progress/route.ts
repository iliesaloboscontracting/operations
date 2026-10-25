import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { isPilotLink, submitProgress } from "@/lib/dailyLog/store";
import { linkSafe } from "@/lib/dailyLog/rules";

// POST /api/site/:token/progress { projectId, lines: [{ packageId?, code, pct, reason? }] }
// -> this week's % complete for a job the pilot supervisor is on (Task K).
// Lines are the approved budget's packages (names and codes only), or the
// codes logged so far; going down needs a reason. A new version each time.
export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveLink((await paramsP).token);
  if (!link || !(await isPilotLink(link))) return NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const out = await submitProgress(link, body && typeof body === "object" ? body : {}, new Date());
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return linkSafe(out) ? NextResponse.json(out, { status: 201 }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });
});
