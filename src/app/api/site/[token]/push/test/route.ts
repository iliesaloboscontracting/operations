import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { pushPublicKey, pushToSiteLinks } from "@/lib/push";

// POST /api/site/:token/push/test - a test alert to this link's phones.
export const POST = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  if (!link || (link.kind !== "SUPERVISOR" && link.kind !== "HANDOVER")) return NextResponse.json({ error: "Alerts are for supervisors' links." }, { status: 404 });
  if (!pushPublicKey()) return NextResponse.json({ error: "Alerts aren't set up on the server yet." }, { status: 503 });
  const sent = await pushToSiteLinks([link.id], { title: "Test alert - Lobos Site", body: "This is how sign-out reminders will look.", url: "?go=signin", tag: "test" }, "high");
  if (!sent) return NextResponse.json({ error: "Couldn't reach this phone - turn alerts off and on again." }, { status: 502 });
  return NextResponse.json({ sent });
});
