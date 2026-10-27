import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { canMessage, chatName } from "@/lib/messages/rules";
import { unreadTotal } from "@/lib/messages/store";

// GET /api/messages/unread -> { unread } for the nav badge (the Office room plus my one-to-ones). 0 for a login that
// doesn't use messages (no error, so the nav can ask for any login).
export const GET = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canMessage(user.role)) return NextResponse.json({ unread: 0 });
  return NextResponse.json({ unread: await unreadTotal({ userId: user.id, role: user.role, email: user.email, name: chatName(user.name, user.email) }) });
});
