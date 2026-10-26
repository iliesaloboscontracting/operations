import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { resourceAsset } from "@/lib/assets/store";

// GET /api/accounts/assets/resource/:id -> an owned vehicle / plant item: its dates, service history, faults.
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const out = await resourceAsset((await params).id);
  if (!out) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(out);
});
