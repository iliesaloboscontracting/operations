// The duplicate-name check on the Labour register (Ilies, 27 Nov 2026). `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { duplicateNameMessage, nameKey, sameNamePerson } from "./personNames";

test("names match ignoring case, spaces and punctuation", () => {
  assert.equal(nameKey("Chris.L"), nameKey("chris l"));
  assert.equal(nameKey(" CHRIS-L "), "chrisl");
  assert.notEqual(nameKey("Chris L"), nameKey("Chris Lee"));
  assert.equal(nameKey(null), "");
});

test("finds the other active person with that name, never the record itself", () => {
  const people = [{ id: "a1", name: "Chris.L" }, { id: "b2", name: "Joao" }];
  assert.equal(sameNamePerson("chris l", people)?.id, "a1");
  assert.equal(sameNamePerson("Chris.L", people, "a1"), null, "editing Chris.L himself is fine");
  assert.equal(sameNamePerson("Chris Lee", people), null);
  assert.equal(sameNamePerson("", people), null);
  assert.match(duplicateNameMessage("Chris.L"), /already a Chris\.L on the Labour register/);
});

test("both routes refuse a second active person with the same name", () => {
  const post = readFileSync(path.join(__dirname, "..", "app", "api", "resources", "route.ts"), "utf8");
  const patch = readFileSync(path.join(__dirname, "..", "app", "api", "resources", "[id]", "route.ts"), "utf8");
  for (const src of [post, patch]) {
    assert.match(src, /sameNamePerson\(/);
    assert.match(src, /code: "DUPLICATE_NAME"/);
  }
});
