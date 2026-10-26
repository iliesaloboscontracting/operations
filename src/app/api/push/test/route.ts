import { NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { pushPublicKey, pushToUsers } from "@/lib/push";

// POST /api/push/test - a test notification to the caller's phones.
// The accounts login (26 Oct 2026) tests its own due-date alerts.
export const POST = withErrorHandling(async () => {
  const user = await getCurrentUser();
  const accounts = user?.role === "ACCOUNTS";
  if (!accounts) {
    const denied = await guard("ADMIN");
    if (denied) return denied;
  }
  if (!pushPublicKey()) return NextResponse.json({ error: "Phone alerts aren't set up on the server yet." }, { status: 503 });
  const sent = await pushToUsers(
    [user!.id],
    accounts
      ? { title: "Test alert - Accounts", body: "This is how a due date or reminder will look.", url: "/accounts", tag: "test", sticky: false }
      : { title: "🔴 Test alert - Operations", body: "This is how an Urgent site request will look.", url: "/requests", tag: "test", sticky: false },
    "high",
  );
  if (!sent) return NextResponse.json({ error: "Couldn't reach a phone - turn alerts off and on again on it." }, { status: 502 });
  return NextResponse.json({ sent });
});
