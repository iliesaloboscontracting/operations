import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { resolveLink } from "@/lib/siteLinks";
import { answerHire, hireForLink } from "@/lib/hireCheck";

// Hire check from a supervisor's link (or a one-day hand-over link) - 24 Oct 2026.
// GET  -> the hire-register items on their sites (names, sites, dates - no money)
// POST { itemId, answer: STILL_NEEDED | FINISHED | NOT_ON_SITE, note? }
async function linkFor(token: string) {
  const link = await resolveLink(token);
  if (!link) return { res: NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 }) };
  if (link.kind === "OFFICE") return { res: NextResponse.json({ error: "The hire check is on a supervisor's link." }, { status: 403 }) };
  return { link };
}

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const { link, res } = await linkFor(params.token);
  if (!link) return res;
  return NextResponse.json({ items: await hireForLink(link) });
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  const params = await paramsP;
  const { link, res } = await linkFor(params.token);
  if (!link) return res;
  const body = await req.json().catch(() => ({}));
  const out = await answerHire(link, body);
  if ("error" in out) return NextResponse.json(out, { status: 400 });
  return NextResponse.json({ ...out, items: await hireForLink(link) });
});
