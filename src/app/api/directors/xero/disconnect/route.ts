import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { disconnect } from "@/lib/xero/live/service";

// POST /api/directors/xero/disconnect -> owner only: revokes the connection at
// Xero, wipes the stored token, keeps the row as a record. The data already
// read stays (labelled by its date).
export const POST = withErrorHandling(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = await disconnect(user);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
});
