import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveBinLink } from "@/lib/siteLinks";
import { linkSafe } from "@/lib/bins/rules";
import { tipperLoadsOn } from "@/lib/bins/tipperRules";
import { isDriverLink, logTipperLoad, tipperOptions } from "@/lib/bins/tipperStore";

// Tipper loads from a phone (Ilies, 27 Nov 2026: "for the driver sections a option for the tippers we have within our
// fleet") - a DRIVER link only (resolveBinLink, then kind DRIVER; SUPERVISOR, HANDOVER, OFFICE and POSTER links get 404).
// GET  /api/site/:token/tipper-loads -> { options: our tippers (prefilled from today's truck sign-in), active projects
//                                         (theirs first), client's / our load, what's in it, this link's loads today }
// POST /api/site/:token/tipper-loads { vehicleId, projectId, use, contents, contentsNote?, photoIds }
// Never a price: every reply goes through the money guard. Kill switch TIPPER_LOADS=off (503).
const dead = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
const off = () => NextResponse.json({ error: "Tipper loads are switched off for now - call the office." }, { status: 503 });
const safe = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveBinLink((await paramsP).token);
  if (!isDriverLink(link)) return dead();
  if (!tipperLoadsOn()) return off();
  return safe({ options: await tipperOptions(link) });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const link = await resolveBinLink((await paramsP).token);
  if (!isDriverLink(link)) return dead();
  if (!tipperLoadsOn()) return off();
  const raw = await req.json().catch(() => ({}));
  const out = await logTipperLoad(link, raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
  if ("error" in out) return safe({ error: out.error }, out.status);
  return safe(out, 201);
});
