import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardOrYard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { yardView } from "@/lib/siteRequests";
import { YARD_ACTIONS, isYardLogin, mayActOnYard, type YardAction } from "@/lib/yard/rules";
import { applyYardAction, findYardJob, reread } from "@/lib/yard/store";
import { stockLines } from "@/lib/inventory/rules";

// PATCH /api/yard/:id - working the yard's list on /yard (Ilies, 4 Nov 2026). The YARD
// login and Admins only - Managers and the coordinator look, never act.
//   { action: "ON_IT" } | { action: "READY", photo, note? } | { action: "CANT_DO", reason } | { action: "COLLECTED" }
// The status moves are lib/yard/rules.ts yardActionError (READY only from YARD,
// Collected only from READY ...).
export const PATCH = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ id: string }> }) => {
  const params = await paramsP;
  const denied = await guardOrYard("ADMIN");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  if (!mayActOnYard({ via: "LOGIN", role: user.role })) return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  const r = await findYardJob(params.id);
  if (!r) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  if (!YARD_ACTIONS.includes(body.action)) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  // Yard Stage C (Ilies, 4 Nov 2026): READY may carry "Took from stock" lines - OUT movements tied to this job, in the
  // same transaction as the READY move (lib/yard/store.ts). Only with READY.
  const lines = stockLines(body.stock);
  if ("error" in lines) return NextResponse.json({ error: lines.error }, { status: 400 });
  if (lines.lines.length && body.action !== "READY") return NextResponse.json({ error: "Stock is taken when it's marked ready." }, { status: 400 });
  const out = await applyYardAction(r, body.action as YardAction, {
    by: user.name, byUserId: user.id, photo: body.photo, note: body.note, reason: body.reason, fromYard: isYardLogin(user.role), stock: lines.lines,
  });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ job: yardView((await reread(r.id))!) });
});
