// The live read-only Xero connection (G3, 25 Oct 2026) - the rules that
// decide whether it may run at all. Outbound connection #5 (Xero, read-only).
//   - OFF unless XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_TOKEN_KEY are all
//     set (the key must be 32 bytes, base64). OFF means "not set up yet" and
//     no outbound call is ever made.
//   - Read-only scopes only: refuses to start if any configured scope could
//     write.
//   - The server talks to exactly two Xero hosts (identity + API). The
//     browser is sent to Xero's login page for the owner to consent.
// Plain functions, no server imports; `npm test` (live.test.ts).

// Scopes requested (granular, read-only; apps created after 2 Mar 2026 must
// use granular scopes). Check against Xero's Scopes page when the app is made.
export const XERO_SCOPES = [
  "openid", "profile", "email", "offline_access",
  "accounting.invoices.read", "accounting.payments.read", "accounting.contacts.read", "accounting.settings.read",
  "accounting.reports.profitandloss.read", "accounting.reports.aged.read",
] as const;

const IDENTITY_SCOPES = new Set(["openid", "profile", "email", "offline_access"]);

// A scope is allowed only if it's an identity scope or ends in ".read".
export function writeScopes(scopes: readonly string[]): string[] {
  return scopes.filter((s) => !IDENTITY_SCOPES.has(s) && !/\.read$/.test(s));
}

// The only hosts the server may call. Anything else is refused before fetch.
export const XERO_SERVER_HOSTS = ["identity.xero.com", "api.xero.com"] as const;
export const XERO_URLS = {
  authorize: "https://login.xero.com/identity/connect/authorize", // the owner's browser goes here, not the server
  token: "https://identity.xero.com/connect/token",
  revoke: "https://identity.xero.com/connect/revocation",
  connections: "https://api.xero.com/connections",
  accounting: "https://api.xero.com/api.xro/2.0",
};
export function allowedHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (XERO_SERVER_HOSTS as readonly string[]).includes(u.hostname) && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

export const DEFAULT_REDIRECT = "https://ops.lobostools.com.mx/api/directors/xero/callback";

export const NOT_SET_UP ="Xero isn't set up yet - the app's Xero keys haven't been added on the server.";

export type XeroSetup =
  | { ok: true; clientId: string; clientSecret: string; key: Buffer; redirectUri: string; scopes: readonly string[] }
  | { ok: false; reason: string; missing: string[] };

// Reads the settings. Nothing here calls out; a missing or bad setting is OFF.
export function xeroSetup(env: Record<string, string | undefined> = process.env, scopes: readonly string[] = XERO_SCOPES): XeroSetup {
  const missing: string[] = [];
  const clientId = (env.XERO_CLIENT_ID ?? "").trim();
  const clientSecret = (env.XERO_CLIENT_SECRET ?? "").trim();
  const keyText = (env.XERO_TOKEN_KEY ?? "").trim();
  if (!clientId) missing.push("XERO_CLIENT_ID");
  if (!clientSecret) missing.push("XERO_CLIENT_SECRET");
  let key: Buffer | null = null;
  if (!keyText) missing.push("XERO_TOKEN_KEY");
  else {
    const b = Buffer.from(keyText, "base64");
    if (b.length !== 32) missing.push("XERO_TOKEN_KEY (must be 32 bytes, base64)");
    else key = b;
  }
  if (missing.length || !key) return { ok: false, reason: NOT_SET_UP, missing };
  const bad = writeScopes(scopes);
  if (bad.length) return { ok: false, reason: `Refusing to start: these scopes could write to Xero - ${bad.join(", ")}.`, missing: [] };
  // Must equal the redirect URI registered on the Xero app (XERO-SETUP-CHECKLIST.md).
  const redirectUri = (env.XERO_REDIRECT_URI ?? "").trim() || DEFAULT_REDIRECT;
  return { ok: true, clientId, clientSecret, key, redirectUri, scopes };
}

// Text that may reach a log or the screen: never a token, code or secret.
export function scrub(text: string, secrets: (string | null | undefined)[] = []): string {
  let t = text;
  for (const s of secrets) if (s && s.length >= 6) t = t.split(s).join("[hidden]");
  return t
    .replace(/("?(access_token|refresh_token|id_token|client_secret|code|code_verifier)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, "$1[hidden]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [hidden]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [hidden]")
    .slice(0, 300);
}
