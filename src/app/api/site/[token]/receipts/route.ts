import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveReceiptLink } from "@/lib/siteLinks";
import { linkSafe } from "@/lib/receipts/rules";
import { createReceipt, myReceiptsToday, receiptOptions } from "@/lib/receipts/store";

// Receipts from a phone (R1, 26 Oct 2026) - a supervisor's or a DRIVER link.
// GET  /api/site/:token/receipts -> { options: today's jobs and the Lobos trucks, with their job /
//                                     truck today prefilled; today: what this link sent today }
// POST /api/site/:token/receipts { kind: TIP|FUEL, photoIds, jobId + asbestos (TIP) | vehicleId (FUEL) }
// Never a price: read status only, checked by the money guard.
const dead = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
const safe = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveReceiptLink((await paramsP).token);
  if (!link) return dead();
  const [options, today] = await Promise.all([receiptOptions(link), myReceiptsToday(link)]);
  return safe({ options, today });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveReceiptLink((await paramsP).token);
  if (!link) return dead();
  const body = await req.json().catch(() => ({}));
  const out = await createReceipt(link, body && typeof body === "object" ? body : {});
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return safe(out, 201);
});
