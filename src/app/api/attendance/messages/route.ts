import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { todaySydney } from "@/lib/today";
import { parseMessage } from "@/lib/signinMessages/rules";
import { createMessage, officeMessages, pickablePeople } from "@/lib/signinMessages/store";

// Message at sign-in (Ilies, 23 Nov 2026: "yes build it, deploy once passes") - the Sign-ins page's panel. Managers,
// Admins and the coordinator (as "Not in today" - guardOrCoordinator, never by loosening guard()). Refused: Viewer,
// TIMESHEETS, ACCOUNTS, DIRECTOR, YARD and every site link (links only reach /api/site/*). Words only - no money.
//
// GET  -> { messages: the newest 100 with seen / not seen yet, people: active Labour-register names to pick from }
export const GET = withErrorHandling(async () => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const today = todaySydney();
  const [messages, people] = await Promise.all([officeMessages(today), pickablePeople()]);
  return NextResponse.json({ today, messages, people });
});

// POST { text, audience: ALL | PEOPLE, resourceIds?, showUntil? } -> 201 { id }. 30 a day per login (429).
// SM-002 - Ilies, 23 Nov 2026: Alex (COORDINATOR) can send and hide sign-in messages.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  const parsed = parseMessage(await req.json().catch(() => ({})), todaySydney());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const out = await createMessage(parsed.value, user);
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ id: out.id }, { status: 201 });
});
