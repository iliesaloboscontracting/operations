import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, guardOrCoordinator } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { runTidy } from "@/lib/signinMessages/tidy";
import { claudeTidier } from "@/lib/signinMessages/tidyClaude";

// "Tidy it up" (Ilies, 25 Nov 2026: "yes build it, deploy once passes") - the Message at sign-in compose box. The same
// people as writing a message: Managers, Admins and the coordinator (guardOrCoordinator, never by loosening guard()).
// POST { text } -> 200 { text } (the tidied message for the box - nothing is sent or stored); 400 a bad draft, 503
// switched off (MESSAGE_TIDY=off) or no ANTHROPIC_API_KEY, 429 over 40 a day for this login, 422 a reply that fails the
// message rules, 502 Claude didn't answer. Only the draft text goes to Claude - never recipients or ids.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const denied = await guardOrCoordinator("MANAGER");
  if (denied) return denied;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const out = await runTidy(user.id, await req.json().catch(() => ({})), claudeTidier);
  return NextResponse.json(out.body, { status: out.status });
});
