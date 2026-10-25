import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOwner } from "@/lib/owner";
import { listDrafts, loadDraftFile } from "@/lib/infoRequests/store";

// GET  /api/info-requests/drafts -> questions drafted for Ilies, not sent yet.
// POST /api/info-requests/drafts {batch, items: [{to, type, title, question,
//      need?, why?}]} -> loads a draft file (the lead's batch-NN.json) as
//      drafts. Owner only. Nothing is sent until he ticks and sends.
async function owner(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!isOwner(user.email)) return { denied: NextResponse.json({ error: "Only Iliesa reviews draft questions." }, { status: 403 }) };
  return { user };
}

export const GET = withErrorHandling(async () => {
  const o = await owner();
  if ("denied" in o) return o.denied;
  return NextResponse.json({ drafts: await listDrafts() });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const o = await owner();
  if ("denied" in o) return o.denied;
  const r = await loadDraftFile(await req.json(), o.user.name);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r, { status: 201 });
});
