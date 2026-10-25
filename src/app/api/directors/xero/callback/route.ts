import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { finishConnect } from "@/lib/xero/live/service";
import { STATE_COOKIE } from "@/lib/xero/live/secure";
import { backTo } from "@/lib/xero/live/redirect";

// GET /api/directors/xero/callback -> Xero sends the owner back here after
// they allow access. Checks the signed state and PKCE, stores the encrypted
// refresh token and the organisation, then returns to Accounts data. Owner
// only; the code and tokens never leave the server.
export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const jar = await cookies();
  const r = await finishConnect(user, { code: p.get("code"), state: p.get("state"), error: p.get("error") }, jar.get(STATE_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  const res = backTo(req, r.ok ? `/directors/accounts?xero=connected` : `/directors/accounts?xero=error&msg=${encodeURIComponent(r.error)}`);
  res.cookies.set(STATE_COOKIE, "", { path: "/api/directors/xero", maxAge: 0 });
  return res;
});
