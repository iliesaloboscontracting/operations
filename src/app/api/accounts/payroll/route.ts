import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { isISODate } from "@/lib/dateRules";
import { todaySydney } from "@/lib/today";
import { weekStartOf } from "@/lib/timesheets";
import { payrollWeek, reviewPerson } from "@/lib/payroll/store";

// Accounts -> Payroll (stage 2, docs/accounts/STAGE2-DESIGN.md). The ACCOUNTS login and Admins only.
// GET  ?week=YYYY-MM-DD (any day in it) -> everyone's hours by day (staff, ABN, labour hire), the
//      supervisor's daily approvals, the Manager's lock, Victoria's decisions, the summary, GPS at sign-in.
// POST { week, personKey, status: APPROVED | QUERY, note? } -> Victoria's decision on one person's week.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const q = req.nextUrl.searchParams.get("week");
  return NextResponse.json(await payrollWeek(weekStartOf(q && isISODate(q) ? q : todaySydney())));
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const body = await req.json().catch(() => ({}));
  const out = await reviewPerson({ id: g.user.id, name: g.user.name }, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
