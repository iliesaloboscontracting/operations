import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOwner } from "@/lib/owner";
import { assignDraft, discardDraft } from "@/lib/infoRequests/store";

// POST /api/info-requests/drafts/:id {action: "DISCARD"} -> Ilies decides not
// to send a draft (kept as DISCARDED, never deleted); {action: "ASSIGN",
// toUserId} -> he picks who it's for when the drafted name didn't match one
// login. Owner only.
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isOwner(user.email)) return NextResponse.json({ error: "Only Iliesa reviews draft questions." }, { status: 403 });
  const body = await req.json();
  const id = (await params).id;
  const r = body.action === "DISCARD" ? await discardDraft(id, user.name) : body.action === "ASSIGN" ? await assignDraft(id, body.toUserId) : { error: "Unknown action." };
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
});
