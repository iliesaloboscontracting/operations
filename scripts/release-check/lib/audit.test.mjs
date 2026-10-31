// node --test scripts/release-check/lib/audit.test.mjs - the audit gate and exception EX-001.
// Fixtures are main 216751d's own `npm audit --json` output (public advisory data only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUDIT_EXCEPTIONS } from "../expected.mjs";
import { judgeAudit } from "./audit.mjs";

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const PROD = load("audit-prod-216751d.json"), ALL = load("audit-all-216751d.json");
const NOW = { today: "2026-10-27", nextVersion: "15.5.28" };
const judge = (j, ctx = NOW) => judgeAudit(j, AUDIT_EXCEPTIONS, ctx);
const clone = (j) => structuredClone(j);

test("main 216751d: every advisory is accepted by EX-001 (production and all dependencies)", () => {
  const p = judge(PROD), a = judge(ALL);
  assert.equal(p.status, "PASS", p.reason);
  assert.equal(p.accepted.length, 5);
  assert.ok(p.accepted.every((x) => x.includes("accepted: EX-001")));
  assert.equal(a.status, "PASS", a.reason);
  assert.equal(a.accepted.length, 6, "postcss-selector-parser too");
});

test("from the expiry date on, EX-001 no longer applies", () => {
  assert.equal(judge(PROD, { ...NOW, today: "2027-01-24" }).status, "PASS");
  const r = judge(PROD, { ...NOW, today: "2027-01-25" });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /EX-001 expired on 2027-01-25/);
});

test("the Next.js 16 upgrade ends EX-001", () => {
  const r = judge(PROD, { ...NOW, nextVersion: "16.0.1" });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /Next\.js 16 upgrade/);
});

test("a new advisory on an accepted package fails", () => {
  const j = clone(PROD);
  j.vulnerabilities.postcss.via.push({ source: 1, name: "postcss", title: "new", url: "https://github.com/advisories/GHSA-zzzz-zzzz-zzzz", severity: "moderate", range: "<9" });
  const r = judge(j);
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /new advisory GHSA-zzzz-zzzz-zzzz/);
});

test("a worse severity fails", () => {
  const j = clone(PROD);
  j.vulnerabilities.uuid.severity = "high";
  assert.equal(judge(j).status, "FAIL");
  const k = clone(PROD);
  k.vulnerabilities.uuid.via[0].severity = "high";
  k.vulnerabilities.uuid.severity = "moderate";
  assert.match(judge(k).reason, /GHSA-w5hq-g745-h8pq is now high/);
});

test("an accepted package reaching somewhere new fails", () => {
  const j = clone(PROD);
  j.vulnerabilities.uuid.effects = ["exceljs", "something-else"];
  assert.match(judge(j).reason, /now also affects something-else/);
  const k = clone(PROD);
  k.vulnerabilities.postcss.nodes.push("node_modules/postcss");
  assert.match(judge(k).reason, /now also installed at node_modules\/postcss/);
  const m = clone(PROD);
  m.vulnerabilities.next.via.push("some-new-dep");
  assert.match(judge(m).reason, /newly affected through some-new-dep/);
});

test("any other moderate-or-worse advisory fails; low ones are listed, not gating", () => {
  const j = clone(PROD);
  j.vulnerabilities.lodash = { name: "lodash", severity: "moderate", via: [{ source: 2, name: "lodash", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "moderate" }], effects: [], nodes: ["node_modules/lodash"] };
  assert.match(judge(j).reason, /lodash\(moderate\) - no exception/);
  const k = clone(PROD);
  k.vulnerabilities.tiny = { name: "tiny", severity: "low", via: [{ source: 3, url: "https://github.com/advisories/GHSA-low1-low1-low1", severity: "low" }], effects: [], nodes: ["node_modules/tiny"] };
  const r = judge(k);
  assert.equal(r.status, "PASS");
  assert.deepEqual(r.minor, ["tiny(low)"]);
});

test("an unreadable audit is BLOCKED, never a pass", () => {
  assert.equal(judge(null).status, "BLOCKED");
  assert.equal(judge({ error: { code: "ENOTFOUND" } }).status, "BLOCKED");
});

// AUD-001 (1 Nov 2026): minimatch < 11.0.1 through exceljs 4.4.0. Fixture: main 2fe2321's `npm audit --omit=dev --json`.
const PROD2 = load("audit-prod-2fe2321.json");
const NOW2 = { today: "2026-11-01", nextVersion: "15.5.28" };

test("AUD-001: main 2fe2321 - exactly the accepted entries pass (minimatch and its exceljs chain included)", () => {
  const r = judge(PROD2, NOW2);
  assert.equal(r.status, "PASS", r.reason);
  assert.equal(r.accepted.length, 12);
  for (const p of ["minimatch", "glob", "readdir-glob", "archiver-utils", "zip-stream", "archiver", "rimraf", "exceljs"]) assert.ok(r.accepted.some((x) => x.startsWith(`${p}(moderate) accepted: EX-001`)), p);
});

test("AUD-001: minimatch reached from a package outside the exceljs chain fails", () => {
  const j = clone(PROD2);
  j.vulnerabilities.minimatch.effects.push("some-other-pkg");
  const r = judge(j, NOW2);
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /minimatch\(moderate\) - not covered by EX-001: now also affects some-other-pkg/);
  const k = clone(PROD2);
  k.vulnerabilities.glob.effects.push("eslint-plugin-x");
  assert.match(judge(k, NOW2).reason, /glob\(moderate\) - not covered by EX-001: now also affects eslint-plugin-x/);
  const m = clone(PROD2);
  m.vulnerabilities.minimatch.nodes.push("node_modules/some-other-pkg/node_modules/minimatch");
  assert.match(judge(m, NOW2).reason, /now also installed at node_modules\/some-other-pkg\/node_modules\/minimatch/);
  const n = clone(PROD2);
  n.vulnerabilities.exceljs.via.push("minimatch");
  assert.match(judge(n, NOW2).reason, /exceljs\(moderate\) - not covered by EX-001: newly affected through minimatch/);
});
