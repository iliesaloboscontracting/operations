import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { addToCalendar, saveTaxSetting, taxView, useEstimateAsAmount } from "@/lib/taxEstimates/store";

// Accounts -> Tax estimates (stage 7, docs/accounts/STAGE7-DESIGN.md). The ACCOUNTS login and Admins only.
// Estimates from the Xero mirror and stage 3's payroll tax rate - Xero and the accountant are the record.
// GET ?fy=2026 -> payroll tax by month + FY to date, BAS GST by period, due dates and calendar matches.
// POST { action: "SETTING", key, value } | { action: "CALENDAR", kind: BAS | PAYROLL_TAX, periodKey }
//      | { action: "USE_ESTIMATE", kind, periodKey, itemId }
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  return NextResponse.json(await taxView(req.nextUrl.searchParams.get("fy"), { withComparison: true }));
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const b = await req.json().catch(() => ({}));
  const body = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  const who = { id: g.user.id, name: g.user.name };
  const out =
    body.action === "SETTING" ? await saveTaxSetting(who, body)
    : body.action === "CALENDAR" ? await addToCalendar(who, body)
    : body.action === "USE_ESTIMATE" ? await useEstimateAsAmount(body)
    : { error: "Unknown action.", status: 400 };
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
