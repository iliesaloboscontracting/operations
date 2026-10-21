import { NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { pushPublicKey, pushToUsers } from "@/lib/push";

// POST /api/push/test - a test notification to the caller's phones.
export const POST = withErrorHandling(async () => {
  const denied = await guard("ADMIN");
  if (denied) return denied;
  if (!pushPublicKey()) return NextResponse.json({ error: "Phone alerts aren't set up on the server yet." }, { status: 503 });
  const user = (await getCurrentUser())!;
  const sent = await pushToUsers(
    [user.id],
    { title: "🔴 Test alert - Operations", body: "This is how an Urgent site request will look.", url: "/requests", tag: "test", sticky: false },
    "high",
  );
  if (!sent) return NextResponse.json({ error: "Couldn't reach a phone - turn alerts off and on again on it." }, { status: 502 });
  return NextResponse.json({ sent });
});
