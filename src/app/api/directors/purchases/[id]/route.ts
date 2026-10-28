import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardDirector } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { actOnRequest } from "@/lib/purchases/store";
import { isOwner } from "@/lib/owner";

// POST /api/directors/purchases/:id { action: APPROVE (note?) | DECLINE (note) | ASK_INFO (question), version }. The
// rules refuse anyone but the owner or a DIRECTOR login, and the person who asked (any of their logins).
export const POST = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await guardDirector();
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  if (b.action !== "APPROVE" && b.action !== "DECLINE" && b.action !== "ASK_INFO") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const out = await actOnRequest((await params).id, b.action, { kind: "DIRECTOR", role: user.role, name: user.name, userId: user.id, owner: isOwner(user.email) }, { name: user.name, userId: user.id }, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
