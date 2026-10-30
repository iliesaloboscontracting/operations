import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveReceiptLink } from "@/lib/siteLinks";
import { linkSafe } from "@/lib/receipts/rules";
import { createReimbursementReceipt, fuelAssets, myReimbursements, receiptOptions } from "@/lib/receipts/store";
import { linkLabel } from "@/lib/dailyLog/money";

// Reimbursements from a phone (docs/accounts/REIMBURSE-LINK-DESIGN.md) - a supervisor's or a DRIVER link.
// GET  /api/site/:token/reimbursements -> { assets: trucks and plant fuel can be for (with today's truck
//                                          prefilled), mine: what this person sent in the last 60 days }
// POST /api/site/:token/reimbursements { purpose, note?, vehicleId (fuel), photoIds, paidMyself: true }
// Never an amount: words and dates only, checked by the money guard.
const dead = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
const safe = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveReceiptLink((await paramsP).token);
  if (!link) return dead();
  const [assets, options, mine] = await Promise.all([fuelAssets(), receiptOptions(link), myReimbursements(link)]);
  // Asset names go through linkLabel (SEC-006): a "$" typed into a truck or machine name can't stop the screen.
  return safe({ assets: assets.map((a) => ({ id: a.id, label: linkLabel(a.label, "a truck"), group: a.group })), prefillVehicleId: options.prefill.vehicleId, mine });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveReceiptLink((await paramsP).token);
  if (!link) return dead();
  const body = await req.json().catch(() => ({}));
  const out = await createReimbursementReceipt(link, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return safe(out, 201);
});
