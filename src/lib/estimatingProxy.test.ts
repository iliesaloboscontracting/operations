// The /estimating proxy never passes a browser's server-to-server keys on to Estimating (LCI 5b: only
// Operations' own server-side send may carry x-lobos-actuals). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyHeaders } from "./estimatingProxy";
import { whoHeaders } from "./estimatingClient";

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

// IND-002 (18 Nov 2026): the signed-in login's email goes too - from the session only, never a browser's header.
test("x-lobos-user-email comes from the session, never the browser", () => {
  const out = proxyHeaders(new Headers({ "x-lobos-user-email": "nick@example.com" }), "Ilies", "Iliesa@Example.com");
  assert.equal(out["x-lobos-user-email"], "iliesa@example.com");
  assert.equal(proxyHeaders(new Headers({ "x-lobos-user-email": "nick@example.com" }), "Ilies")["x-lobos-user-email"], undefined);
  assert.deepEqual(whoHeaders({ name: "Ilies", email: " A@B.com " }), { "x-lobos-user": "Ilies", "x-lobos-user-email": "a@b.com" });
  assert.deepEqual(whoHeaders("Ilies"), { "x-lobos-user": "Ilies" });
});

// EST2-006 (17 Nov 2026): the Tenders key never passes through; an upload's file name does (capped), nothing else new.
test("a browser's x-lobos-board never reaches Estimating; x-file-name does, capped", () => {
  const out = proxyHeaders(new Headers({ "X-Lobos-Board": "guessed-board-key-0123456789", "x-file-name": "Tender%20pack.pdf", "x-quote-meta": "%7B%7D" }), "Ilies");
  assert.ok(!Object.keys(out).some((k) => /board|quote-meta/i.test(k)));
  assert.equal(out["x-file-name"], "Tender%20pack.pdf");
  assert.equal(proxyHeaders(new Headers({ "x-file-name": "a".repeat(1000) }), "Ilies")["x-file-name"].length, 400);
});
