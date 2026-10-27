// Tiny in-memory login throttle: after MAX failures within WINDOW, that key is locked
// until the window passes. Resets when the server restarts (fine for a single-server app).
const MAX = 5;
// SEC-011 (27 Oct 2026): one email, from any number of addresses - a higher limit, so one person's typos never trip it.
export const MAX_PER_EMAIL = 20;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

export function isLocked(key: string, max = MAX) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return a.count >= max;
}

// SEC-011: the caller's address. Cloudflare sets cf-connecting-ip itself; otherwise the LAST X-Forwarded-For hop is the
// one our own proxy added (the first ones are whatever the client claimed).
export function clientIp(h: { get(name: string): string | null }): string {
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? "local";
}

export function recordFailure(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

export function clearFailures(key: string) {
  attempts.delete(key);
}
