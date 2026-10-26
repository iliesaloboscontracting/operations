import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createRequest, listForRequester, projectChoices } from "@/lib/purchases/store";

// In-app purchase requests (stage 6): Managers, Admins, Directors and the ACCOUNTS login ask, and see their own
// requests with the status in words. No amounts here - prices are on the Accounts and Directors screens only.
async function asker(): Promise<{ denied: NextResponse } | { user: AuthUser }> {
  const user = await getCurrentUser();
  if (!user) return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  if (!["ADMIN", "MANAGER", "ACCOUNTS", "DIRECTOR"].includes(user.role)) return { denied: NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 }) };
  return { user };
}

export const GET = withErrorHandling(async () => {
  const a = await asker();
  if ("denied" in a) return a.denied;
  const [requests, projects] = await Promise.all([listForRequester({ kind: "APP", userId: a.user.id, name: a.user.name }), projectChoices()]);
  return NextResponse.json({ requests, projects });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const a = await asker();
  if ("denied" in a) return a.denied;
  const body = await req.json().catch(() => ({}));
  const out = await createRequest({ kind: "APP", userId: a.user.id, name: a.user.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
