import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { BinError, changeBin } from "@/lib/bins/store";

// PATCH /api/bins/register/:id - Managers and Admins:
//   { action: "rename", label } | { action: "retire", reason } | { action: "restore" }
// A bin is retired, never deleted (there is no DELETE); every change is in its history (RecordChange).
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const body = await req.json().catch(() => ({}));
  try {
    const row = await changeBin((await paramsP).id, body && typeof body === "object" ? body : {}, user);
    return NextResponse.json({ ok: true, id: row.id, label: row.label, retired: !!row.retiredAt });
  } catch (e) {
    if (e instanceof BinError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
