import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardTools } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { viewJson } from "@/lib/coordinatorView";
import { coordinatorOr, toolsWorkerOr } from "@/lib/roles";
import { belowMinCount, createItem, inventorySites, listItems } from "@/lib/inventory/store";

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
  const canWrite = toolsWorkerOr(user.role, "MANAGER");
  // Sites for "Stock out to a site" - id and name only. CI-001 option (b) (Ilies approved 4 Nov 2026): only for those who
  // can move stock; the yard computer gets just the sites on the board a week either side of today (lib/inventory/store.ts
  // inventorySites), Managers / Admins / the coordinator every active project.
  const sites = canWrite ? await inventorySites(user.role) : [];
  return viewJson({
    items,
    sites,
    belowMin: items.filter((i) => i.active && i.status === "BELOW").length,
    canWrite,
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
