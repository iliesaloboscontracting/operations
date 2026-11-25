import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { createBatch } from "@/lib/receipts/batch";

// POST /api/receipts/batches { projectId } -> { id, project }: start an office batch of tip-docket photos for one
// project (20 Nov 2026). The photos then go one per request to /api/receipts/batches/:id. Manager+ - not the
// coordinator, who sees and checks tip dockets but doesn't upload them (Ilies approved 25 Nov 2026: "See and check").
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  if (Number(req.headers.get("content-length") ?? 0) > 10_000) return NextResponse.json({ error: "Too large." }, { status: 413 });
  const body = await req.json().catch(() => ({}));
  const out = await createBatch({ id: user.id, name: user.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out, { status: 201 });
});
