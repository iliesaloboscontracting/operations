import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readJsonBody } from "@/lib/jsonBody";
import { linkSafe, OFF_MESSAGE, variationsOn } from "@/lib/variations/rules";
import { linkView, resolveVariationLink, sendDocket } from "@/lib/variations/store";

// Variation / day docket from a phone (Ilies approved 25 Nov 2026) - a SUPERVISOR link, or a HANDOVER link on its own
// job (resolveVariationLink; DRIVER, POSTER, OFFICE, the yard's shared link, a switched-off or made-up link -> 404).
// GET  -> the jobs this link can do a docket for now (project details filled in), who signs for Lobos, its own sent
//         dockets (today and the last 7 days, read-only), whether photos can go.
// POST { jobId, ticks[], otherText?, tasks[], items[], note?, photoIds[], customerName, customerPosition?,
//        customerSignature, lobosPosition?, lobosSignature, replaces? } -> 201 { docket } with its number (V-0001...).
// A sent docket can't be changed: there is no PATCH / PUT / DELETE. Never a price: every reply passes the money guard.
// VARIATION_DOCKETS=off -> 503 with plain words.
const dead = () => NextResponse.json({ error: "This link isn't active. Ask the office for a new one." }, { status: 404 });
const off = () => NextResponse.json({ error: OFF_MESSAGE, off: true }, { status: 503 });
const safe = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status, headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (_req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  if (!variationsOn()) return off();
  const link = await resolveVariationLink((await paramsP).token);
  if (!link) return dead();
  return safe(await linkView(link));
});

export const POST = withErrorHandling(async (req: NextRequest, { params: paramsP }: { params: Promise<{ token: string }> }) => {
  if (!variationsOn()) return off();
  const link = await resolveVariationLink((await paramsP).token);
  if (!link) return dead();
  const read = await readJsonBody(req, "This docket is too big to send - try again, or call the office.");
  if ("denied" in read) return read.denied;
  const out = await sendDocket(link, read.b);
  if ("error" in out) return safe({ error: out.error }, out.status);
  return safe(out, 201);
});
