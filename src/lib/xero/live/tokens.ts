// Using the Xero connection (G3, 25 Oct 2026). Xero hands out a NEW refresh
// token every time one is used, so the new one is encrypted and saved before
// the access token is used for anything; if saving fails, nothing is read.
// A refresh Xero refuses with invalid_grant means the connection is gone:
// NEEDS_REAUTH (a CRITICAL finding tells Ilies), and the last good data stays.
// The storage and the call are passed in, so the order is testable.
import { decryptToken, encryptToken } from "./secure";
import type { TokenSet, XeroResult } from "./client";

export type TokenDeps = {
  key: Buffer;
  load: () => Promise<{ tenantId: string; refreshTokenEnc: string; status: string } | null>;
  saveRotated: (refreshTokenEnc: string, at: Date) => Promise<void>;
  markReauth: (error: string) => Promise<void>;
  refresh: (refreshToken: string) => Promise<XeroResult<TokenSet>>;
  now?: () => Date;
};

export type UseResult<T> = { ok: true; value: T } | { ok: false; error: string; reauth?: boolean };

export async function withAccessToken<T>(deps: TokenDeps, use: (accessToken: string, tenantId: string) => Promise<T>): Promise<UseResult<T>> {
  const conn = await deps.load();
  if (!conn || conn.status !== "ACTIVE" || !conn.refreshTokenEnc) return { ok: false, error: "Xero isn't connected." };
  let refreshToken: string;
  try {
    refreshToken = decryptToken(conn.refreshTokenEnc, deps.key);
  } catch {
    await deps.markReauth("The stored Xero connection can't be read with this server's key - connect Xero again.");
    return { ok: false, error: "Xero needs connecting again.", reauth: true };
  }
  const r = await deps.refresh(refreshToken);
  if (!r.ok) {
    if (r.invalidGrant) {
      await deps.markReauth("Xero ended the connection (it was disconnected, or unused for too long) - connect Xero again.");
      return { ok: false, error: "Xero needs connecting again.", reauth: true };
    }
    return { ok: false, error: r.error }; // a passing problem - try again later, connection kept
  }
  await deps.saveRotated(encryptToken(r.data.refresh_token, deps.key), (deps.now ?? (() => new Date()))());
  return { ok: true, value: await use(r.data.access_token, conn.tenantId) };
}
