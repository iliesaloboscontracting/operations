import { NextRequest, NextResponse } from "next/server";
import { guardAccounts } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { attachDraft, decideAbnCheck, listAbnChecks, setGstRegistered } from "@/lib/abnInvoices/store";
import { hireInvoiceChecks } from "@/lib/hireChecks/store";
import { linkRate, overRateView } from "@/lib/rateSheet/store";
import { reviewFlag } from "@/lib/invoiceFlagReviews";

// Accounts -> Invoice checks (stage 4, docs/accounts/STAGE4-DESIGN.md). The ACCOUNTS login and Admins only.
// GET ?tab=abn | hire | rates
// POST { action: "ATTACH", draftId, resourceId } | { action: "ABN", id, status: APPROVED | QUERY | DETACH, note? }
//      | { action: "GST", resourceId, gstRegistered: true | false | null }
//      | { action: "FLAG", subjectKind: HIRE | RATE, subjectId, flag, status: OK | QUERY, note? }
//      | { action: "LINK_RATE", draftId, lineNo, rateId }
// Flags only: nothing here adds, removes or changes a job cost.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const tab = req.nextUrl.searchParams.get("tab");
  if (tab === "hire") return NextResponse.json(await hireInvoiceChecks());
  if (tab === "rates") return NextResponse.json(await overRateView());
  return NextResponse.json(await listAbnChecks());
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const g = await guardAccounts();
  if ("denied" in g) return g.denied;
  const b = await req.json().catch(() => ({}));
  const body = b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  const who = { id: g.user.id, name: g.user.name };
  const out =
    body.action === "ATTACH" ? await attachDraft(who, body)
    : body.action === "ABN" ? await decideAbnCheck(who, String(body.id ?? ""), body)
    : body.action === "GST" ? await setGstRegistered(body)
    : body.action === "FLAG" ? await reviewFlag(who, body)
    : body.action === "LINK_RATE" ? await linkRate(who.name, body)
    : { error: "Unknown action.", status: 400 };
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json(out);
});
