// Signed session cookie. Uses Web Crypto only, so it works in both the Edge
// middleware and Node route handlers.
//
// Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
// Payload = { uid, exp }  (exp in ms). The role is NOT stored here: it is always
// read from the database so role changes and deactivation apply immediately.

export const SESSION_COOKIE = "operate_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 12; // 12 hours

// The Building Agent (the account Claude applies approved data changes
// through, in the browser pane on this PC) stays signed in for 30 days so it
// isn't logged out between working sessions (Ilies, 18 Oct 2026). Everyone
// else keeps 12 hours. Switching the user off on the Users page still ends
// the session at once, because the account is checked on every request.
export const BUILDING_AGENT_EMAIL = "iliesa+agent@loboscontracting.com.au";
export const AGENT_SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
export function sessionMaxAgeFor(email: string | null | undefined) {
  return email?.toLowerCase() === BUILDING_AGENT_EMAIL ? AGENT_SESSION_MAX_AGE_S : SESSION_MAX_AGE_S;
}

export interface SessionPayload {
  uid: string;
  exp: number;
}

const enc = new TextEncoder();

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET is missing or too short. Set it in .env (see .env.example).");
  }
  return s;
}

function b64u(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64u(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(uid: string, maxAgeS = SESSION_MAX_AGE_S): Promise<string> {
  const payload: SessionPayload = { uid, exp: Date.now() + maxAgeS * 1000 };
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64u(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64u(body))) as SessionPayload;
    if (!payload.uid || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
