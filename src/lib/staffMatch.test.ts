import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeLobos, staffSuggestions } from "./staffMatch";

const staff = [{ id: "r1", name: "Ratu" }, { id: "r2", name: "Muhummet" }, { id: "r3", name: "Sam Marakiwai" }, { id: "r4", name: "Sam Smith" }];

test("company Lobos, any case or spacing", () => {
  for (const c of ["Lobos", "lobos", "LOBOS ", " Lo bos", "Lobos Contracting", "lobos demolition"]) assert.equal(looksLikeLobos(c), true, c);
  for (const c of ["Labourforce", "", null, "Lobo"]) assert.equal(looksLikeLobos(c), false, String(c));
});

test("the week of 26 Oct: Ratu / Lobos, Muhammet / Lobos, Abdelhak / Lobos", () => {
  assert.deepEqual(staffSuggestions({ name: "Ratu", company: "Lobos" }, staff), [{ id: "r1", name: "Ratu", exact: true }]);
  for (const c of ["Lobos Civil", "Lobos Demolition", "Lobos Contracting"]) assert.equal(looksLikeLobos(c), true, c);
  assert.deepEqual(staffSuggestions({ name: "Muhammet", company: "Lobos" }, staff), [], "spelled differently: still flagged by the company, office picks the person");
  assert.deepEqual(staffSuggestions({ name: "Abdelhak", company: "Lobos" }, staff), []);
});

test("a staff member's name with another company is flagged; a real hire worker isn't", () => {
  assert.deepEqual(staffSuggestions({ name: "sam  marakiwai", company: "Labourforce" }, staff), [{ id: "r3", name: "Sam Marakiwai", exact: true }]);
  assert.equal(staffSuggestions({ name: "Sam", company: "Labourforce" }, staff), null, "TF-009: a first name alone from another company is a real hire worker");
  assert.deepEqual(staffSuggestions({ name: "Sam", company: "Lobos" }, staff)?.map((s) => [s.id, s.exact]), [["r3", false], ["r4", false]], "with company Lobos, a first name offers every match - none pre-selected");
  assert.equal(staffSuggestions({ name: "John Citizen", company: "Labourforce" }, staff), null);
  assert.equal(staffSuggestions({ name: "Sam Jones", company: "Labourforce" }, staff), null, "a different surname isn't a match");
});
