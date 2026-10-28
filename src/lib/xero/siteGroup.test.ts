import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_SITE, siteOf } from "./siteGroup";

test("site is the part of the reference before the claim / month", () => {
  assert.equal(siteOf("Randwick - PC03"), "Randwick");
  assert.equal(siteOf("Randwick Barracks - PC11"), "Randwick Barracks");
  assert.equal(siteOf("Woollahra - Aug 25"), "Woollahra");
  assert.equal(siteOf("Potts Point - Jul-26"), "Potts Point");
  assert.equal(siteOf("Bondi - PC03 - V04 - Sewer"), "Bondi");
  assert.equal(siteOf("Erskine Park - Excavation Works"), "Erskine Park");
});

test("a code first is skipped", () => {
  assert.equal(siteOf("PC07 - Randwick"), "Randwick");
  assert.equal(siteOf("S0003528 - WW Marrickville"), "WW Marrickville");
});

test("no site", () => {
  assert.equal(siteOf(null), NO_SITE);
  assert.equal(siteOf(""), NO_SITE);
  assert.equal(siteOf("INV-0018"), NO_SITE);
  assert.equal(siteOf("HST-6552"), NO_SITE);
});

test("a plain site name stays whole", () => {
  assert.equal(siteOf("Bondi Dental"), "Bondi Dental");
  assert.equal(siteOf("  Bellevue   Hill "), "Bellevue Hill");
});
