// SEC-013 (27 Oct 2026): a phone alert subscription may only point at a real browser push service - never at another
// server the app would then send requests to. Checked when a phone registers (api/push, api/site/[token]/push) and
// again in lib/push.ts before anything is sent. No server imports; `npm test` (pushHost.test.ts).
const EXACT = ["fcm.googleapis.com"]; // Chrome / Edge on Android, Chrome desktop
const SUFFIX = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"]; // Safari / iOS, Firefox, Windows (incl. wns2-*)

export function isPushHost(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const h = u.hostname.toLowerCase();
  return EXACT.includes(h) || SUFFIX.some((s) => h.endsWith(s) && h.length > s.length);
}
