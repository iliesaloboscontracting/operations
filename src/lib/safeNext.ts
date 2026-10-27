// SEC-006 (27 Oct 2026): where to go after signing in - only ever a path on this same site. Rejects backslashes and
// control characters (raw or %-encoded, which browsers turn into "//evil" or strip), protocol-relative "//host", and
// anything that resolves to another origin. No server imports: the login page uses it too.
const BAD = /[\\\u0000-\u001f\u007f]/;

function decodedForms(s: string): string[] {
  const out = [s];
  let cur = s;
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(cur);
      if (d === cur) break;
      out.push(d);
      cur = d;
    } catch {
      out.push("\u0000"); // malformed %-encoding: treat as unsafe
      break;
    }
  }
  return out;
}

export function safeNext(next: string | null | undefined, origin: string, fallback: string): string {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  for (const form of decodedForms(next)) if (BAD.test(form) || form.startsWith("//")) return fallback;
  try {
    const u = new URL(next, origin);
    if (u.origin !== new URL(origin).origin) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

// The homes the login route may send someone to (lib/auth.ts homeFor).
export const HOMES = ["/command", "/timesheets", "/accounts", "/directors"] as const;
export const safeHome = (h: unknown) => (HOMES as readonly string[]).includes(String(h)) ? String(h) : "/command";
