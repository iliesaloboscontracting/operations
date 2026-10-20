import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/session";

// Gatekeeper: every page and API route needs a valid signed session cookie, except the
// sign-in / first-run setup pages and the auth endpoints. Roles (who may edit) are
// checked in the API handlers themselves, against the database.
const PUBLIC = ["/login", "/setup", "/api/auth/login", "/api/auth/setup"];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();
  // The Site photos page and its upload API (supervisors' private links). No
  // session here - every handler under them checks the link's own secret
  // (lib/siteLinks.ts) and can only upload photos; it can't read the app.
  if (pathname.startsWith("/site/") || pathname.startsWith("/api/site/")) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  // Redirect on the address the browser actually used (ops.lobostools.com.mx
  // through the tunnel, localhost on a dev machine). req.nextUrl carries the
  // server's own bind address (localhost:3000) behind the tunnel, which sent
  // people to a blank page after the Cloudflare login (20 Oct 2026).
  const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const base = host ? `${proto}://${host}` : req.nextUrl.origin;
  return NextResponse.redirect(new URL(`/login${next}`, base));
}

export const config = {
  // Skip Next internals and static files (logo, icon).
  matcher: ["/((?!_next/static|_next/image|logo.png|logo-dark.png|icon.svg|favicon.ico).*)"],
};
