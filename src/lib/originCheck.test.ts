import { test } from "node:test";
import assert from "node:assert/strict";
import { crossSite } from "./originCheck";

const h = (origin: string | null, host = "localhost:3000", forwardedHost: string | null = null) => ({ origin, host, forwardedHost });

test("SEC-008: another site's POST to the API or /estimating is refused", () => {
  assert.equal(crossSite("POST", "/api/jobs", h("https://evil.example", "ops.lobostools.com.mx")), true);
  assert.equal(crossSite("DELETE", "/api/users/x", h("https://evil.example", "localhost:3000", "ops.lobostools.com.mx")), true);
  assert.equal(crossSite("PUT", "/estimating/api/projects/x", h("https://evil.example")), true);
  assert.equal(crossSite("POST", "/api/site/abc/signin", h("https://evil.example", "photos.lobostools.com.mx")), true, "site links too");
  assert.equal(crossSite("POST", "/api/auth/login", h("https://evil.example")), true, "login too (before the public early return)");
  assert.equal(crossSite("POST", "/api/jobs", h("null")), true);
  assert.equal(crossSite("POST", "/api/jobs", h("https://ops.lobostools.com.mx.evil.example", "localhost:3000")), true);
  assert.equal(crossSite("POST", "/api/jobs", h("http://ops.lobostools.com.mx", "localhost:3000")), true, "plain http to the public name");
});

test("SEC-008: the same site, the public names, dev, safe methods and non-API paths pass", () => {
  assert.equal(crossSite("POST", "/api/jobs", h("https://ops.lobostools.com.mx", "localhost:3000", "ops.lobostools.com.mx")), false);
  assert.equal(crossSite("POST", "/api/jobs", h("https://ops.lobostools.com.mx", "ops.lobostools.com.mx")), false);
  assert.equal(crossSite("POST", "/api/site/abc/photos", h("https://photos.lobostools.com.mx", "localhost:3000")), false, "behind the tunnel with a local Host");
  assert.equal(crossSite("POST", "/api/jobs", h("http://localhost:3002", "localhost:3002")), false);
  assert.equal(crossSite("POST", "/api/jobs", h("http://127.0.0.1:3001", "127.0.0.1:3001")), false);
  assert.equal(crossSite("POST", "/api/jobs", h(null)), false, "no Origin (server-to-server, curl)");
  assert.equal(crossSite("GET", "/api/jobs", h("https://evil.example")), false);
  assert.equal(crossSite("OPTIONS", "/api/jobs", h("https://evil.example")), false);
  assert.equal(crossSite("POST", "/login", h("https://evil.example")), false, "pages aren't in scope");
});
