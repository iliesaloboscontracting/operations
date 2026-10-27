import { test } from "node:test";
import assert from "node:assert/strict";
import { safeHome, safeNext } from "./safeNext";

const O = "https://ops.lobostools.com.mx";
const go = (n: string | null) => safeNext(n, O, "/command");

test("SEC-006: only same-site paths survive", () => {
  assert.equal(go("/projects?x=1#a"), "/projects?x=1#a");
  assert.equal(go("/command"), "/command");
  for (const bad of ["//evil.example", "/\\evil.example", "/%5Cevil.example", "/%5cevil.example", "/\t/evil.example", "/%09/evil.example", "/%2F/evil.example",
    "/%252F%252Fevil.example", "https://evil.example", "evil.example", "/\nx", "/%0d%0aSet-Cookie:x", "/%E0%A4%A", "", null]) {
    assert.equal(go(bad), "/command", String(bad));
  }
});

test("SEC-006: the login home is one of the four homes", () => {
  assert.equal(safeHome("/accounts"), "/accounts");
  assert.equal(safeHome("/directors"), "/directors");
  assert.equal(safeHome("/timesheets"), "/timesheets");
  assert.equal(safeHome("https://evil.example"), "/command");
});
