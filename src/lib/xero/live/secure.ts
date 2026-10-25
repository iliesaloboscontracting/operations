// Xero connection secrets (G3, 25 Oct 2026): the refresh token encrypted at
// rest (AES-256-GCM with XERO_TOKEN_KEY), PKCE for the sign-in, and the
// sign-in's state held in a short-lived cookie signed with AUTH_SECRET - so
// no state table and nothing guessable. Node crypto only; `npm test`.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

// base64(iv 12 | tag 16 | ciphertext)
export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

// Throws if the key is wrong or the stored value was altered.
export function decryptToken(stored: string, key: Buffer): string {
  const b = Buffer.from(stored, "base64");
  if (b.length < 29) throw new Error("Stored Xero token is unreadable");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

const b64u = (b: Buffer) => b.toString("base64url");

export function pkcePair() {
  const verifier = b64u(randomBytes(32));
  return { verifier, challenge: b64u(createHash("sha256").update(verifier).digest()) };
}
export const pkceChallenge = (verifier: string) => b64u(createHash("sha256").update(verifier).digest());

export const STATE_COOKIE = "xero_connect";
export const STATE_MAX_AGE_S = 600; // ten minutes to finish signing in at Xero

type StatePayload = { state: string; verifier: string; uid: string; exp: number };

export function signState(p: Omit<StatePayload, "exp">, secret: string, now = Date.now()): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...p, exp: now + STATE_MAX_AGE_S * 1000 })));
  return `${body}.${b64u(createHmac("sha256", secret).update(body).digest())}`;
}

// The payload, or null if the cookie was altered, expired or is missing.
export function readState(cookie: string | undefined, secret: string, now = Date.now()): StatePayload | null {
  if (!cookie) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    return p.exp > now ? p : null;
  } catch {
    return null;
  }
}

export const newState = () => b64u(randomBytes(24));
