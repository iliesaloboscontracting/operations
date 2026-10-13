import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/session";

// Gatekeeper: every page and API route needs a valid signed session cookie, except the
// sign-in / first-run setup pages and the auth endpoints. Roles (who may edit) are
// checked in the API handlers themselves, against the database.
const PUBLIC = ["/login", "/setup", "/api/auth/login", "/api/auth/setup"];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static files (logo, icon).
  matcher: ["/((?!_next/static|_next/image|logo.png|logo-dark.png|icon.svg|favicon.ico).*)"],
};
