import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { startConnect } from "@/lib/xero/live/service";
import { STATE_COOKIE, STATE_MAX_AGE_S } from "@/lib/xero/live/secure";
import { backTo } from "@/lib/xero/live/redirect";

// GET /api/directors/xero/connect -> sends the owner's browser to Xero to
// allow read-only access (PKCE + a signed, ten-minute state cookie). Owner
// only. Not set up yet -> back to Accounts data with the reason; no call out.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = startConnect(user, process.env.AUTH_SECRET ?? "");
  if ("error" in r) return backTo(req, `/directors/accounts?xero=error&msg=${encodeURIComponent(r.error)}`);
  const res = NextResponse.redirect(r.redirect);
  res.cookies.set(STATE_COOKIE, r.cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/directors/xero", maxAge: STATE_MAX_AGE_S });
  return res;
});
