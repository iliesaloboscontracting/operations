import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { saveOnboarding, workerDetail } from "@/lib/compliance/store";

// GET /api/compliance/workers/:id -> the worker's tickets (with files) and onboarding. Accounts + Admins.
// PUT /api/compliance/workers/:id { onboarding fields } -> saves onboarding (TFN / bank details refused).
export const GET = withErrorHandling(async (_req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const d = await workerDetail((await params).id);
  if (!d) return NextResponse.json({ error: "That worker isn't in the Labour register." }, { status: 404 });
  return NextResponse.json(d);
});

export const PUT = withErrorHandling(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const b = body && typeof body === "object" ? body : {};
  const out = await saveOnboarding(g.user.name, (await params).id, b);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
