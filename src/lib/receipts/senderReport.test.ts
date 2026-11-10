// PS-026 (Ilies approved, 10 Nov 2026): scripts/receipt-sender-check-report.ts --csv writes names typed on a phone (a
// hire worker's name at a truck sign-in). Its cells go through the app's one formula-safe rule (payroll csvCell,
// SEC-012), so "=HYPERLINK(...)" can never reach a spreadsheet as a live formula. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { csvCell } from "../payroll/rules";

test("PS-026: a cell starting with = + - @ (or a tab / CR) is quoted and prefixed with '; a normal name is unchanged", () => {
  assert.equal(csvCell("=1+1"), `"'=1+1"`);
  assert.equal(csvCell("+x"), `"'+x"`);
  assert.equal(csvCell("-1"), `"'-1"`);
  assert.equal(csvCell("@a"), `"'@a"`);
  assert.equal(csvCell("\tx"), `"'\tx"`);
  assert.equal(csvCell("\rx"), `"'\rx"`);
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell("Arvin Tester"), "Arvin Tester");
  assert.equal(csvCell("Turori + Arvin"), "Turori + Arvin", "a + inside a name is fine");
  assert.equal(csvCell("Smith, Jo"), `"Smith, Jo"`);
});

test("PS-026: the sender report's CSV uses that rule for every cell, header included", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts", "receipt-sender-check-report.ts"), "utf8");
  assert.match(src, /import \{ csvCell \} from "\.\.\/src\/lib\/payroll\/rules";/);
  assert.match(src, /const cell = csvCell;/);
  assert.match(src, /head\.map\(cell\)\.join\(","\)/);
  assert.match(src, /h\.map\(cell\)\.join\(","\)/);
  assert.ok(!/replace\(\/"\/g/.test(src), "no escaping of its own");
});
