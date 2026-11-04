import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { viewJson } from "@/lib/coordinatorView";
import { coordinatorOr, toolsWorkerOr } from "@/lib/roles";
import { belowMinCount, createItem, listItems } from "@/lib/inventory/store";
import { prisma } from "@/lib/prisma";

// The consumables inventory (Yard Stage C, Ilies 4 Nov 2026). Same access as Tools (lib/auth.ts guardTools): looking -
// Viewers and up, the coordinator, the yard computer; writing - Managers and up, the coordinator, the yard computer.
// Logins only - no site link reaches it. Quantities only, never a price.
// GET            -> { items, sites, belowMin, canWrite, canRequestPurchase }   (?all=1 also lists retired items)
// GET ?count=1   -> { belowMin }                                        (the counter on /yard)
// POST { name, category, unit, minLevel?, location?, openingQty? } -> 201 { item }
export const GET = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardTools("VIEWER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  if (req.nextUrl.searchParams.get("count")) return viewJson({ belowMin: await belowMinCount() });
  const items = await listItems(!!req.nextUrl.searchParams.get("all"));
  // Sites for "Stock out to a site": active projects, names only (the yard computer can't open /api/projects).
  const sites = await prisma.project.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return viewJson({
    items,
    sites,
    belowMin: items.filter((i) => i.active && i.status === "BELOW").length,
    canWrite: toolsWorkerOr(user.role, "MANAGER"),
    // A purchase request is the ordinary in-app one - Managers, Admins and the coordinator raise them; the yard
    // computer only sees the list (not its scope).
    canRequestPurchase: coordinatorOr(user.role, "MANAGER"),
  });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardTools("MANAGER");
  if (denied) return denied;
  const user = (await getCurrentUser())!;
  const out = await createItem(await req.json().catch(() => ({})), { id: user.id, name: user.name });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return viewJson(out, { status: 201 });
});
