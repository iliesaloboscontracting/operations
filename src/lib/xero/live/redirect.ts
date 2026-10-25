import { NextRequest, NextResponse } from "next/server";

// A redirect on the address the browser actually used (ops.lobostools.com.mx
// through the tunnel), as the middleware does - req.nextUrl carries the
// server's own bind address behind the tunnel.
export function backTo(req: NextRequest, path: string) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return NextResponse.redirect(new URL(path, host ? `${proto}://${host}` : req.nextUrl.origin));
}
