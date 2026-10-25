// The supervisors' how-to printout (Task L): the doc reads into the right
// blocks (the office's note left out), the PDF-unsafe characters are swapped,
// and it carries no link or dollar figure. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { parseHowto, pdfSafe, runs } from "./howtoDoc";
import { assertNoMoney } from "./moneyGuard";

const DOC = fs.readFileSync(path.join(process.cwd(), "docs", "lci", "SUPERVISOR-DAILY-LOG-HOWTO.md"), "utf8");

test("bold and italic inside a line", () => {
  assert.deepEqual(runs("tap **Daily log** now, *roughly*"), [{ text: "tap " }, { text: "Daily log", bold: true }, { text: " now, " }, { text: "roughly", italic: true }]);
  assert.deepEqual(runs("plain"), [{ text: "plain" }]);
});

test("lists: steps with continuation lines and nested bullets; the office's note under the title is left out", () => {
  const b = parseHowto("# Title\n\n*Office note,\nover two lines.*\n\n## Every day\n\n1. **Crew:** check it\n   and say what.\n2. Codes:\n   - Rough is fine.\n   - Pick the closest.\n\nA closing line.\n- one\n- two\n");
  assert.deepEqual(b.map((x) => x.kind), ["title", "heading", "steps", "para", "bullets"]);
  const steps = b[2] as Extract<(typeof b)[number], { kind: "steps" }>;
  assert.equal(steps.items.length, 2);
  assert.equal(steps.items[0].runs.map((r) => r.text).join(""), "Crew: check it and say what.");
  assert.deepEqual(steps.items[1].children.map((c) => c.runs[0].text), ["Rough is fine.", "Pick the closest."]);
});

test("the real how-to reads as expected", () => {
  const b = parseHowto(DOC);
  assert.equal(b[0].kind, "title");
  assert.ok(!b.some((x) => x.kind === "para" && x.runs.some((r) => /Hand this over/.test(r.text))), "office note left out");
  assert.deepEqual(b.filter((x) => x.kind === "heading").map((x) => (x as { text: string }).text),
    ["What it is and why", "Every day (about 60 seconds)", "Once a week (Friday)", "Reminders", "Good to know"]);
  const steps = b.find((x) => x.kind === "steps") as Extract<(typeof b)[number], { kind: "steps" }>;
  assert.equal(steps.items.length, 5);
});

test("characters the PDF font lacks are swapped", () => {
  assert.equal(pdfSafe("− / + then Logged ✓ → done"), "- / + then Logged -> done");
});

// (That it fits one A4 page is checked on the test server - @react-pdf only
// loads inside Next, not under this test runner.)
test("the source carries no link and no dollar figure", () => {
  assert.ok(assertNoMoney(DOC));
  assert.ok(!/https?:\/\/|\/site\/[A-Za-z0-9_-]{10,}/.test(DOC), "no link in the doc");
});
