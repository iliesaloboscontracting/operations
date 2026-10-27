import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { canActOnFindings } from "@/lib/findings/actions";
import { OWNER_EMAIL, isOwner } from "@/lib/owner";
import { todaySydney } from "@/lib/today";
import { aiCanAsk, canBeAsked, isOperationsAi, parseInfoItem } from "@/lib/infoRequests/rules";
import { raiseInfoRequest, tracker } from "@/lib/infoRequests/store";

// Information requests (Task I, 25 Oct 2026). Owner + director access - never Managers, accounts or links - and,
// since 27 Oct, Operations AI (the Building Agent login, known by its email; docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md).
// GET  /api/info-requests -> every question to a person (open / answered /
//      closed), who can be asked, and whether this login may batch-send.
//      Operations AI: only the questions it sent, and the wider group it may ask.
// POST /api/info-requests {toUserId, type QUESTION|FYI, title, question,
//      need?, dueDate?} -> one question to one person.
async function allowed(): Promise<{ denied: NextResponse } | { user: AuthUser; ai: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (canActOnFindings(user)) return { user, ai: false };
  if (isOperationsAi(user.email)) return { user, ai: true };
  return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
}

const KIND: Record<string, string> = { ACCOUNTS: "accounts", DIRECTOR: "director login", ADMIN: "office (Admin)", MANAGER: "office (Manager)" };

export const GET = withErrorHandling(async () => {
  const a = await allowed();
  if ("denied" in a) return a.denied;
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, directorAccess: true, active: true }, orderBy: { name: "asc" } });
  if (a.ai) {
    return NextResponse.json({
      requests: await tracker(new Date(), a.user.id),
      people: users.filter((u) => aiCanAsk(u, a.user.id, OWNER_EMAIL)).map((u) => ({ id: u.id, name: u.name, kind: KIND[u.role] ?? u.role })),
      canBatch: false,
    });
  }
  return NextResponse.json({
    requests: await tracker(),
    people: users.filter((u) => canBeAsked(u, OWNER_EMAIL) && u.id !== a.user.id).map((u) => ({ id: u.id, name: u.name, kind: u.role === "ACCOUNTS" ? "accounts" : u.role === "DIRECTOR" ? "director login" : "director access" })),
    canBatch: isOwner(a.user.email),
  });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const a = await allowed();
  if ("denied" in a) return a.denied;
  const body = await req.json();
  const item = parseInfoItem(body, todaySydney());
  if ("error" in item) return NextResponse.json({ error: item.error }, { status: 400 });
  if (typeof body.toUserId !== "string") return NextResponse.json({ error: "Pick who to ask." }, { status: 400 });
  const r = await raiseInfoRequest(item, body.toUserId, a.user);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  return NextResponse.json({ id: r.request.id }, { status: 201 });
});
