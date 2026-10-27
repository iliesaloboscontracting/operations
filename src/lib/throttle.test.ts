import { test } from "node:test";
import assert from "node:assert/strict";
import { clearFailures, clientIp, isLocked, MAX_PER_EMAIL, recordFailure } from "./throttle";

const hdrs = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

test("SEC-011: the address is cf-connecting-ip, else the LAST forwarded hop, else local", () => {
  assert.equal(clientIp(hdrs({ "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "203.0.113.5");
  assert.equal(clientIp(hdrs({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" })), "10.0.0.1", "a spoofed first hop is ignored");
  assert.equal(clientIp(hdrs({ "x-forwarded-for": "10.0.0.1" })), "10.0.0.1");
  assert.equal(clientIp(hdrs({})), "local");
});

test("SEC-011: the per-email key locks only after the higher limit", () => {
  const k = "email:someone@test.localhost";
  clearFailures(k);
  for (let i = 0; i < MAX_PER_EMAIL - 1; i++) recordFailure(k);
  assert.equal(isLocked(k, MAX_PER_EMAIL), false);
  assert.equal(isLocked(k), true, "the per-address limit (5) is lower");
  recordFailure(k);
  assert.equal(isLocked(k, MAX_PER_EMAIL), true);
  clearFailures(k);
});
