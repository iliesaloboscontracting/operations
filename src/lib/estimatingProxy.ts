// The headers the /estimating proxy (src/app/estimating/[[...path]]) sends on to Lobos Estimating.
// An allowlist: Estimating's Host check, who's asking, and the body type - nothing else from the
// browser. Above all the server-to-server keys Estimating trusts - x-lobos-actuals (production
// suggestions, LCI 5b) and x-lobos-approval (budget decisions) - never pass through from a browser:
// only Operations' own server-side calls (lib/estimatingClient.ts) may carry them.
export const SERVER_ONLY_HEADERS = ["x-lobos-actuals", "x-lobos-approval"] as const;

export function proxyHeaders(incoming: Headers, userName: string): Record<string, string> {
  const headers: Record<string, string> = { host: "127.0.0.1", "x-lobos-user": userName };
  const ct = incoming.get("content-type");
  if (ct) headers["content-type"] = ct;
  for (const h of SERVER_ONLY_HEADERS) delete headers[h]; // belt and braces: never forwarded, whatever changes above
  return headers;
}
