import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

// Lobos Estimating, served inside Operations (25 Oct 2026, Ilies: "yes move
// estimating"). The estimating app runs on this server as its own process,
// bound to 127.0.0.1 only (ESTIMATING_URL), with its own JSON data. This
// route is its only way in: behind Cloudflare Access and the Operations login,
// Admins only (Ilies, Nick's ops login). Supplier rates live in that app and
// never reach a site link. The page is given a <base href="/estimating/"> so
// its relative links and API calls come back through here.
const TARGET = process.env.ESTIMATING_URL || "http://127.0.0.1:4310";
const PREFIX = "/estimating";

async function proxy(req: NextRequest, { params: paramsP }: { params: Promise<{ path?: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });

  const { path = [] } = await paramsP;
  if (path.some((s) => s === ".." || s.includes("\\"))) return NextResponse.json({ error: "Bad path" }, { status: 400 });
  const sub = "/" + path.map(encodeURIComponent).join("/");
  const url = TARGET + sub + req.nextUrl.search;

  const headers: Record<string, string> = { host: "127.0.0.1", "x-lobos-user": user.name };
  const ct = req.headers.get("content-type");
  if (ct) headers["content-type"] = ct;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  let res: Response;
  try {
    res = await fetch(url, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, cache: "no-store", redirect: "manual" });
  } catch {
    return NextResponse.json({ error: "Estimating isn't running on the server right now." }, { status: 502 });
  }

  const type = res.headers.get("content-type") ?? "application/octet-stream";
  const out = new Headers({ "content-type": type, "cache-control": "no-store" });
  if (type.startsWith("text/html")) {
    const html = (await res.text()).replace(/<head>/i, `<head><base href="${PREFIX}/">`);
    return new NextResponse(html, { status: res.status, headers: out });
  }
  return new NextResponse(res.body, { status: res.status, headers: out });
}

export const GET = proxy;
export const PUT = proxy;
export const POST = proxy;
export const DELETE = proxy;
