// The one way Operations' server talks to Lobos Estimating (25 Oct 2026):
// budgets (Task H) and the pipeline / won-tender feeds (G5). Estimating runs
// on the same server bound to 127.0.0.1 (ESTIMATING_URL, as for the
// /estimating proxy) and refuses any Host but localhost. A call that can't
// connect, or takes longer than the timeout, comes back as status 0 so each
// caller can say "Estimating not reachable" instead of hanging a page.
// Server-only.

const TARGET = () => process.env.ESTIMATING_URL || "http://127.0.0.1:4310";

export type Answer<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type EstimatingReply<T> = { status: number; body: (T & { error?: string; code?: string }) | null };

// The acting person: their name (x-lobos-user) and, IND-002 (18 Nov 2026), their login email (x-lobos-user-email) -
// Estimating can match issuers by email, which no other login can share. Always from Operations' own session.
export type Who = string | { name: string; email?: string | null };
export function whoHeaders(who?: Who): Record<string, string> {
  if (!who) return {};
  if (typeof who === "string") return { "x-lobos-user": who };
  return { "x-lobos-user": who.name, ...(who.email ? { "x-lobos-user-email": who.email.trim().toLowerCase() } : {}) };
}

export async function estimatingCall<T>(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit; timeoutMs?: number } = {},
  who?: Who,
): Promise<EstimatingReply<T>> {
  const headers: Record<string, string> = { host: "127.0.0.1", ...whoHeaders(who), ...init.headers };
  let res: Response;
  try {
    res = await fetch(TARGET() + path, {
      method: init.method ?? "GET", headers, body: init.body, cache: "no-store", redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
  } catch {
    return { status: 0, body: null };
  }
  let body: EstimatingReply<T>["body"] = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

// A file from Estimating, passed back as it comes (the Tenders tab's quote files, 17 Nov 2026). null = not reachable.
export async function estimatingRaw(path: string, headers: Record<string, string>, timeoutMs = 20_000): Promise<Response | null> {
  try {
    return await fetch(TARGET() + path, { headers: { host: "127.0.0.1", ...headers }, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
}
