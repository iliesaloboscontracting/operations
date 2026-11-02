// A JSON POST body, or 413 with plain words when the server can't read it - in practice a body over Next's 10 MB
// request limit, which arrives cut short (2 Nov 2026, option A; lib/uploadLimits.ts). Used by the upload routes (quote
// files, compliance files, the invoices inbox) so an oversize send never gets a misleading validation message.
import { NextResponse } from "next/server";

export async function readJsonBody(req: Request, tooLarge: string): Promise<{ b: Record<string, unknown> } | { denied: NextResponse }> {
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return { denied: NextResponse.json({ error: tooLarge }, { status: 413 }) };
  return { b: body && typeof body === "object" ? (body as Record<string, unknown>) : {} };
}
