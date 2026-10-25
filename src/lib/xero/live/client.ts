// The only code that calls Xero (G3, 25 Oct 2026). Every call goes through
// xeroCall(): the URL must be on the allowlist (identity.xero.com /
// api.xero.com, https), it times out, and whatever goes wrong comes back as
// a plain message with every token, code and secret scrubbed - never thrown
// with the request attached, never logged raw. The fetch is passed in, so
// tests run against a mock and never reach Xero. Read-only: GETs to the
// accounting API; POSTs only to the identity server's token / revoke.
import { XERO_URLS, allowedHost, scrub, type XeroSetup } from "./setup";

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text: () => Promise<string> }>;
type Ok = Extract<XeroSetup, { ok: true }>;
export type XeroResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; invalidGrant?: boolean };

const TIMEOUT_MS = 20_000;

export async function xeroCall<T>(
  fetchImpl: Fetch,
  url: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string },
  secrets: (string | null | undefined)[],
): Promise<XeroResult<T>> {
  if (!allowedHost(url)) return { ok: false, status: 0, error: "Refused: not a Xero address this app may call." };
  if (init.method === "POST" && !url.startsWith("https://identity.xero.com/connect/")) return { ok: false, status: 0, error: "Refused: the app only reads from Xero." };
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await fetchImpl(url, { method: init.method, headers: { Accept: "application/json", ...init.headers }, body: init.body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, status: 0, error: scrub(`Xero didn't answer (${(e as Error).name === "TimeoutError" ? "timed out" : "no connection"}).`, secrets) };
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (res.status >= 200 && res.status < 300) return { ok: true, data: json as T };
  const err = (json as { error?: string; Message?: string; Detail?: string } | null) ?? null;
  const invalidGrant = err?.error === "invalid_grant";
  const why = err?.error || err?.Message || err?.Detail || `HTTP ${res.status}`;
  return { ok: false, status: res.status, error: scrub(`Xero said: ${why}`, secrets), invalidGrant };
}

const basic = (s: Ok) => `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

export type TokenSet = { access_token: string; refresh_token: string; expires_in: number; scope?: string };

// The owner's browser goes here; nothing is fetched by the server.
export function authorizeUrl(s: Ok, state: string, challenge: string) {
  const q = new URLSearchParams({
    response_type: "code", client_id: s.clientId, redirect_uri: s.redirectUri, scope: s.scopes.join(" "),
    state, code_challenge: challenge, code_challenge_method: "S256",
  });
  return `${XERO_URLS.authorize}?${q.toString()}`;
}

export function exchangeCode(f: Fetch, s: Ok, code: string, verifier: string) {
  return xeroCall<TokenSet>(f, XERO_URLS.token, {
    method: "POST",
    headers: { Authorization: basic(s), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "authorization_code", code, redirect_uri: s.redirectUri, code_verifier: verifier }),
  }, [s.clientSecret, code, verifier]);
}

export function refreshTokens(f: Fetch, s: Ok, refreshToken: string) {
  return xeroCall<TokenSet>(f, XERO_URLS.token, {
    method: "POST",
    headers: { Authorization: basic(s), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "refresh_token", refresh_token: refreshToken }),
  }, [s.clientSecret, refreshToken]);
}

export function revokeToken(f: Fetch, s: Ok, refreshToken: string) {
  return xeroCall<unknown>(f, XERO_URLS.revoke, {
    method: "POST",
    headers: { Authorization: basic(s), "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ token: refreshToken }),
  }, [s.clientSecret, refreshToken]);
}

export type XeroTenant = { tenantId: string; tenantName: string; tenantType: string; updatedDateUtc?: string };
export function listConnections(f: Fetch, accessToken: string) {
  return xeroCall<XeroTenant[]>(f, XERO_URLS.connections, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } }, [accessToken]);
}

// One read from the accounting API, e.g. "Invoices?page=1".
export function accountingGet<T>(f: Fetch, accessToken: string, tenantId: string, path: string) {
  return xeroCall<T>(f, `${XERO_URLS.accounting}/${path}`, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, "xero-tenant-id": tenantId } }, [accessToken]);
}

// Real fetch, adapted to the Fetch shape (used only when the setup is complete).
export const realFetch: Fetch = (url, init) => fetch(url, { ...init, cache: "no-store", redirect: "error" });
