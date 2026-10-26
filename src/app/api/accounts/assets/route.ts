import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { listAssets, type AssetGroup } from "@/lib/assets/store";

// Accounts -> Assets (stage 6, docs/accounts/STAGE6-DESIGN.md §2). The ACCOUNTS login and Admins only.
// GET ?group=VEHICLES|PLANT|TOOLS -> each asset with its rego / insurance / service dates and open faults.
// Dates are added through /api/compliance/documents with holderType ASSET and a resourceId or toolId.
const GROUPS: AssetGroup[] = ["VEHICLES", "PLANT", "TOOLS"];
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams.get("group");
  const group = GROUPS.find((x) => x === q) ?? "VEHICLES";
  return NextResponse.json({ group, assets: await listAssets(group) });
});
