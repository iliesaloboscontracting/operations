import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { linkSafe } from "@/lib/receipts/rules";
import { linkContext, linkView, submitCheck } from "@/lib/prestart/store";

// The pre-start after a truck sign-in, and the post-check after signing out there (8 Nov 2026, Ilies). Rides the
// photos tunnel's existing api/site/.* route - no Cloudflare change. The token from that sign-in / sign-out (2 hours)
// says which sign-in and which check. Words and dates only: no money (linkSafe), the reporter's first name only.
//   GET  (header x-prestart-token) -> { kind, machine, title, checklist, done, openFaults, limits }
//        PS-005 (9 Nov 2026): never in the address - a token in the query string is not read.
//   POST { token, answers: { [itemKey]: OK | FAULT | NA }, faults: [{ itemKey, description, priority, mediaIds }],
//          stillThere: [faultId], deviceId? } -> { ok, message, sent, seen }   (409 once it's in)
const reply = (x: unknown, status = 200) =>
  linkSafe(x) ? NextResponse.json(x, { status }) : NextResponse.json({ error: "Something went wrong - call the office." }, { status: 500 });

export const GET = withErrorHandling(async (req: NextRequest) => {
  const ctx = await linkContext(req.headers.get("x-prestart-token"));
  if ("error" in ctx) return reply({ error: ctx.error }, ctx.status);
  return reply(await linkView(ctx));
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  const ctx = await linkContext(body?.token);
  if ("error" in ctx) return reply({ error: ctx.error }, ctx.status);
  const out = await submitCheck(ctx, body);
  if ("error" in out) return reply({ error: out.error }, out.status);
  return reply(out, 201);
});
