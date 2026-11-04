import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { pushPublicKey, pushToSiteLinks } from "@/lib/push";
import { isYardLink } from "@/lib/yard/rules";

// POST /api/site/:token/push/test - a test alert to this link's phones.
export const POST = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const link = await resolveLink(params.token);
  const yard = !!link && isYardLink(link); // the yard's shared link (4 Nov 2026)
  if (!link || (link.kind !== "SUPERVISOR" && link.kind !== "HANDOVER" && !yard)) return NextResponse.json({ error: "Alerts are for supervisors' links." }, { status: 404 });
  if (!pushPublicKey()) return NextResponse.json({ error: "Alerts aren't set up on the server yet." }, { status: 503 });
  const msg = yard
    ? { title: "Test alert - Lobos Yard", body: "This is how new yard jobs will look.", url: "?go=yard", tag: "test" }
    : { title: "Test alert - Lobos Site", body: "This is how sign-out reminders will look.", url: "?go=signin", tag: "test" };
  const sent = await pushToSiteLinks([link.id], msg, "high");
  if (!sent) return NextResponse.json({ error: "Couldn't reach this phone - turn alerts off and on again." }, { status: 502 });
  return NextResponse.json({ sent });
});
