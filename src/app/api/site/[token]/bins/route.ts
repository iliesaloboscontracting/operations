import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveBinLink } from "@/lib/siteLinks";
import { linkSafe } from "@/lib/bins/rules";
import { binOptions, deliverBin, pickUpBin } from "@/lib/bins/store";

// Bins from a phone (Ilies, 23 Nov 2026) - a supervisor's or a DRIVER link only (resolveBinLink; HANDOVER, OFFICE and
// POSTER links get 404, as with receipts).
// GET  /api/site/:token/bins -> { options: active projects (theirs first), client's / our bin, sizes with the free bins,
//                                 contents, the bins on site, what this person did today }
// POST /api/site/:token/bins { action: "deliver", photoIds, projectId, use, size, binId?, contents, contentsNote? }
//                            { action: "pickup", movementId, photoIds }
// Never a price: every reply goes through the money guard.
const dead = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
const safe = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveBinLink((await paramsP).token);
  if (!link) return dead();
  return safe({ options: await binOptions(link) });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveBinLink((await paramsP).token);
  if (!link) return dead();
  const raw = await req.json().catch(() => ({}));
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = body.action === "deliver" ? await deliverBin(link, body) : body.action === "pickup" ? await pickUpBin(link, body) : { error: "Delivered or picked up?", status: 400 };
  if ("error" in out) return safe({ error: out.error }, out.status);
  return safe(out, 201);
});
