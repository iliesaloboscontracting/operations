// Checks & service history on the plant QR (12 Nov 2026): how often the public view and download routes answer. In
// memory, like the login throttle (lib/throttle.ts) and the link routes' one-at-a-time guards - fine for one server; a
// restart clears it. The QR code is the only key, so these keep a leaked code from being used to hammer the server.
//   - per address, every code: 300 views / downloads in 10 minutes; 20 bad or switched-off codes in 10 minutes;
//   - per QR: 60 views in 10 minutes, 20 downloads an hour, one download being made at a time.
export const VIEW_LIMITS = {
  windowMs: 10 * 60_000,
  perIp: 300,
  badPerIp: 20,
  viewsPerQr: 60,
  downloadWindowMs: 60 * 60_000,
  downloadsPerQr: 20,
} as const;

const hits = new Map<string, number[]>();
const busy = new Set<string>();

// One more hit on `key` if under `max` in the last `windowMs` - true = allowed (and counted), false = over (not counted).
export function take(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < VIEW_LIMITS.downloadWindowMs)) hits.delete(k);
  return true;
}
// Has `key` already had `max` in the window? (Read only - for bad codes, counted with `take` after the lookup fails.)
export const full = (key: string, max: number, windowMs: number, now = Date.now()) =>
  (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= max;

export const TOO_MANY = "Too many looks at this QR just now - try again in a few minutes.";
export const ONE_AT_A_TIME = "A download is already being made - wait for it to finish.";

export type Gate = { error: string; status: number } | null;
export function ipGate(ip: string, now = Date.now()): Gate {
  if (full(`bad:${ip}`, VIEW_LIMITS.badPerIp, VIEW_LIMITS.windowMs, now)) return { error: TOO_MANY, status: 429 };
  return take(`ip:${ip}`, VIEW_LIMITS.perIp, VIEW_LIMITS.windowMs, now) ? null : { error: TOO_MANY, status: 429 };
}
export const badCode = (ip: string, now = Date.now()) => { take(`bad:${ip}`, Number.MAX_SAFE_INTEGER, VIEW_LIMITS.windowMs, now); };
export const viewGate = (linkId: string, now = Date.now()): Gate =>
  take(`view:${linkId}`, VIEW_LIMITS.viewsPerQr, VIEW_LIMITS.windowMs, now) ? null : { error: TOO_MANY, status: 429 };
export const downloadGate = (linkId: string, now = Date.now()): Gate =>
  take(`dl:${linkId}`, VIEW_LIMITS.downloadsPerQr, VIEW_LIMITS.downloadWindowMs, now) ? null : { error: TOO_MANY, status: 429 };

// One download at a time per QR: run `fn` holding it, or refuse.
export async function oneDownload<T>(linkId: string, fn: () => Promise<T>): Promise<T | { error: string; status: number }> {
  if (busy.has(linkId)) return { error: ONE_AT_A_TIME, status: 429 };
  busy.add(linkId);
  try { return await fn(); } finally { busy.delete(linkId); }
}

export const resetForTests = () => { hits.clear(); busy.clear(); };
