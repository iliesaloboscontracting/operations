// The /estimating proxy never passes a browser's server-to-server keys on to Estimating (LCI 5b: only
// Operations' own server-side send may carry x-lobos-actuals). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyHeaders } from "./estimatingProxy";

test("a browser's x-lobos-actuals / x-lobos-approval (any case) never reaches Estimating", () => {
  const incoming = new Headers({
    "X-Lobos-Actuals": "stolen-or-guessed-key-0123456789", "x-lobos-approval": "another-key-0123456789",
    "content-type": "application/json", cookie: "operate_session=abc", "x-lobos-user": "Somebody Else", host: "evil.example", authorization: "Bearer x",
  });
  const out = proxyHeaders(incoming, "Ilies");
  assert.deepEqual(out, { host: "127.0.0.1", "x-lobos-user": "Ilies", "content-type": "application/json" });
  assert.ok(!Object.keys(out).some((k) => /actuals|approval|cookie|authorization/i.test(k)));
});

test("who's asking is always the signed-in user, never a header the browser sent", () => {
  assert.equal(proxyHeaders(new Headers({ "x-lobos-user": "Nick" }), "Ilies")["x-lobos-user"], "Ilies");
  assert.deepEqual(proxyHeaders(new Headers(), "Ilies"), { host: "127.0.0.1", "x-lobos-user": "Ilies" });
});
