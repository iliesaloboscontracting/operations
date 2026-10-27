// LCI phase 6: the rules for Microsoft Graph (outbound connection #7, read-only) - whether it may run at all, which
// hosts the server may call, and the refusal to run with any permission beyond Sites.Selected. The same pattern as
// Xero (lib/xero/live/setup.ts). Plain functions, no server imports; `npm test` (docsearch.test.ts).
//   - OFF unless GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are all set: no outbound call at all.
//   - Hosts: login.microsoftonline.com (token) and graph.microsoft.com (GET). Plus, for one step only, the tenant's
//     SharePoint host from GRAPH_SITE: Graph answers a file download with a 302 to a short-lived pre-signed URL there
//     (D6-3). That GET carries no Authorization header.
//   - The token's roles must be exactly Sites.Selected. Anything else (Sites.Read.All, any write) stops the run.

export const GRAPH_HOSTS = ["login.microsoftonline.com", "graph.microsoft.com"] as const;
export const DEFAULT_SITE = "lobosdemolition.sharepoint.com:/sites/Management";
export const ALLOWED_ROLES = ["Sites.Selected"] as const;
export const NOT_SET_UP = "Document search isn't connected yet - the Microsoft 365 app's keys haven't been added on the server.";

export type GraphSetup =
  | { ok: true; tenantId: string; clientId: string; clientSecret: string; site: string; siteHost: string }
  | { ok: false; reason: string; missing: string[] };

export function graphSetup(env: Record<string, string | undefined> = process.env): GraphSetup {
  const tenantId = (env.GRAPH_TENANT_ID ?? "").trim(), clientId = (env.GRAPH_CLIENT_ID ?? "").trim(), clientSecret = (env.GRAPH_CLIENT_SECRET ?? "").trim();
  const missing = [!tenantId && "GRAPH_TENANT_ID", !clientId && "GRAPH_CLIENT_ID", !clientSecret && "GRAPH_CLIENT_SECRET"].filter(Boolean) as string[];
  if (missing.length) return { ok: false, reason: NOT_SET_UP, missing };
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) && !/^[a-z0-9-]+\.onmicrosoft\.com$/i.test(tenantId)) return { ok: false, reason: "GRAPH_TENANT_ID isn't a tenant id.", missing: [] };
  const site = (env.GRAPH_SITE ?? "").trim() || DEFAULT_SITE;
  const m = site.match(/^([a-z0-9-]+\.sharepoint\.com):\/sites\/[A-Za-z0-9_-]+$/i);
  if (!m) return { ok: false, reason: "GRAPH_SITE must look like tenant.sharepoint.com:/sites/Name.", missing: [] };
  return { ok: true, tenantId, clientId, clientSecret, site, siteHost: m[1].toLowerCase() };
}

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};
// The server may call Graph and the token endpoint; the SharePoint host only for a pre-signed download.
export const allowedApiHost = (url: string) => (GRAPH_HOSTS as readonly string[]).includes(hostOf(url) ?? "");
export const allowedDownloadHost = (url: string, siteHost: string) => hostOf(url) === siteHost;

// The application permissions in an access token (its "roles" claim). Not verified here - Microsoft issued it to us
// over TLS; we only read what it says the app may do.
export function tokenRoles(accessToken: string): string[] | null {
  const part = accessToken.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { roles?: unknown };
    return Array.isArray(claims.roles) ? claims.roles.map(String) : [];
  } catch {
    return null;
  }
}
// null = fine; otherwise why the run must stop.
export function rolesProblem(roles: string[] | null): string | null {
  if (roles === null) return "Refusing to start: couldn't read the app's permissions from its token.";
  const extra = roles.filter((r) => !(ALLOWED_ROLES as readonly string[]).includes(r));
  if (extra.length) return `Refusing to start: the app has these permissions - ${extra.join(", ")}. It may only have Sites.Selected (read).`;
  if (!roles.includes("Sites.Selected")) return "Refusing to start: the app hasn't been given Sites.Selected.";
  return null;
}

// Text that may reach a log or the screen: never a secret or a token.
export function scrub(text: string, secrets: (string | null | undefined)[] = []): string {
  let t = text;
  for (const s of secrets) if (s && s.length >= 6) t = t.split(s).join("[hidden]");
  return t
    .replace(/("?(access_token|refresh_token|id_token|client_secret|assertion)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, "$1[hidden]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [hidden]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[token]")
    .replace(/([?&](tempauth|sig|token)=)[^&\s]+/gi, "$1[hidden]")
    .slice(0, 300);
}
