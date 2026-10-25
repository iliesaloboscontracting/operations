import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isOwner } from "@/lib/owner";
import { sendBatch } from "@/lib/infoRequests/store";

// POST /api/info-requests/batch {items: [{draftId} | {toUserId, type, title,
// question, need?, dueDate?}]} -> Ilies sends a reviewed list in one go.
// Owner only. Every item is checked first; nothing is sent unless all are OK.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!isOwner(user.email)) return NextResponse.json({ error: "Only Iliesa sends a batch of questions." }, { status: 403 });
  const r = await sendBatch((await req.json()).items, user);
  if ("error" in r) return NextResponse.json(r, { status: 400 });
  return NextResponse.json(r);
});
