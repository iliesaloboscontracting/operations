import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { listThreads, startThread } from "@/lib/messages/store";
import { appViewer } from "@/lib/messages/who";

// Office chat (docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 3): Accounts, Directors, Admins and Managers. The Office
// room and my own one-to-ones.
// GET  -> the Office room, then my one-to-ones, newest first, with unread counts
// POST { toUserId, subjectType?, subjectKey?, body } -> a new one-to-one with its first message
// No edit or delete route: messages are kept forever; a correction is a new message.
export const GET = withErrorHandling(async () => {
  const v = await appViewer();
  if ("denied" in v) return v.denied;
  return NextResponse.json({ threads: await listThreads(v.me) });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const v = await appViewer();
  if ("denied" in v) return v.denied;
  const body = await req.json().catch(() => ({}));
  const out = await startThread(v.me, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
