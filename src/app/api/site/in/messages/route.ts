import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/apiHandler";
import { readMessageToken } from "@/lib/signin";
import { assertNoMoney } from "@/lib/moneyGuard";
import { crewMessages, markSeen, whoSignedIn } from "@/lib/signinMessages/store";

// Message at sign-in (23 Nov 2026) - the phone, after its sign-in was saved. The sign-in's reply carried a token tied
// to that sign-in (lib/signin.ts makeMessageToken); only the person on that sign-in is answered: their own messages and
// the "everyone" ones - never anyone else's, never who else a message went to. The token travels in a header / the
// body, never the address. Rides the photos tunnel's existing api/site/ route.
//
// GET  (x-message-token) -> { messages: [{ id, text, sent }] }
export const GET = withErrorHandling(async (req: NextRequest) => {
  const who = await signedIn(req.headers.get("x-message-token"));
  if (!who) return NextResponse.json({ error: "That sign-in has finished - your messages show at your next sign-in." }, { status: 401 });
  const messages = await crewMessages(who.who);
  const body = { messages };
  if (!assertNoMoney(JSON.stringify(body))) return NextResponse.json({ messages: [] });
  return NextResponse.json(body);
});

// POST { token, messageId, deviceId? } -> "Got it": seen once, and it doesn't show again (here or on their link).
export const POST = withErrorHandling(async (req: NextRequest) => {
  const b = await req.json().catch(() => ({}));
  const who = await signedIn(b?.token);
  if (!who) return NextResponse.json({ error: "That sign-in has finished - your messages show at your next sign-in." }, { status: 401 });
  if (typeof b.messageId !== "string" || !b.messageId) return NextResponse.json({ error: "Which message?" }, { status: 400 });
  const out = await markSeen(b.messageId, who.who, { deviceId: typeof b.deviceId === "string" ? b.deviceId : null, where: "QR", attendanceId: who.attendanceId });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
});

async function signedIn(token: unknown) {
  const attendanceId = readMessageToken(token);
  return attendanceId ? whoSignedIn(attendanceId) : null;
}
