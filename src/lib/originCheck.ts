// SEC-008 (27 Oct 2026): refuse a state-changing request that another website's page sent (cross-site request
// forgery). Runs in the middleware (Edge), before any other early return. Plain function; `npm test`.
//
// What counts as "this site": the Origin's host equals the host the browser used - X-Forwarded-Host, else Host. The
// login redirect already relies on that pair behind cloudflared (middleware.ts, 20 Oct 2026). As a backstop the two
// public hostnames, and localhost / 127.0.0.1 for development, are always accepted.
export const SITE_HOSTS = ["ops.lobostools.com.mx", "photos.lobostools.com.mx"];
const DEV_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

const hostOnly = (h: string | null | undefined) => (h ?? "").split(",")[0].trim().toLowerCase();
const stripPort = (h: string) => h.replace(/:\d+$/, "");

// True = refuse (403).
export function crossSite(method: string, pathname: string, headers: { origin: string | null; host: string | null; forwardedHost: string | null }): boolean {
  if (SAFE_METHODS.includes(method.toUpperCase())) return false;
  if (!pathname.startsWith("/api/") && pathname !== "/estimating" && !pathname.startsWith("/estimating/")) return false;
  const origin = headers.origin;
  if (origin === null) return false; // no Origin: not a browser cross-site request (server-to-server, curl, old forms)
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return true; // "null" or garbage - a sandboxed or privacy-stripped page: refuse
  }
  if (o.protocol !== "https:" && o.protocol !== "http:") return true;
  const originHost = o.host.toLowerCase();
  const seen = [hostOnly(headers.forwardedHost), hostOnly(headers.host)].filter(Boolean);
  if (seen.includes(originHost)) return false;
  if (SITE_HOSTS.includes(stripPort(originHost)) && o.protocol === "https:") return false;
  if (process.env.NODE_ENV !== "production" && DEV_HOSTS.includes(stripPort(originHost))) return false; // dev / copy tests only
  return true;
}
