import { NextRequest, NextResponse } from "next/server";
import { guard, getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { editTipRun } from "@/lib/tipRun/store";

// PATCH /api/attendance/tip-runs/:id { startAt?, endAt? (null = clear), reason } - the office corrects a regional tip
// run (19 Nov 2026), like a travel leg: Manager+, a reason, kept in TipRunEdit; a locked (approved) week refuses it,
// and so does a time over one of their sign-ins.
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (reason.length < 3) return NextResponse.json({ error: "Say why it's being changed." }, { status: 400 });
  const out = await editTipRun(params.id, body, reason, user?.name ?? "Office");
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
