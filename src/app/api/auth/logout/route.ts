import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";

// POST /api/auth/logout
export const POST = withErrorHandling(async () => {
  endSession();
  return NextResponse.json({ ok: true });
});
