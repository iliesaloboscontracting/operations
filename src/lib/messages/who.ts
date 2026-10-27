// Who is asking, for the chat routes: an office login (rules.canMessage). There's no site-link side - Ilies scrapped
// messaging to workers (27 Oct 2026).
import { NextResponse } from "next/server";
import { getCurrentUser } from "../auth";
import { canMessage, chatName } from "./rules";
import type { Viewer } from "./store";

export async function appViewer(): Promise<{ denied: NextResponse } | { me: Viewer }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!canMessage(user.role)) return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  return { me: { userId: user.id, role: user.role, email: user.email, name: chatName(user.name, user.email, user.role) } };
}
