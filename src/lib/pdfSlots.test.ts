// PS-063: at most two PDFs being made at once. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDF_SLOTS, pdfSlotsBusy, withPdfSlot } from "./pdfSlots";

test("PS-063: two PDFs at once, a third is refused (null) until one finishes; a failure frees its slot", async () => {
  assert.equal(PDF_SLOTS, 2);
  const gates: (() => void)[] = [];
  const slow = () => withPdfSlot(() => new Promise<string>((r) => gates.push(() => r("pdf"))));
  const a = slow(), b = slow();
  assert.equal(pdfSlotsBusy(), 2);
  assert.equal(await withPdfSlot(async () => "third"), null, "the third is refused at once");
  gates.shift()!();
  assert.equal(await a, "pdf");
  assert.equal(await withPdfSlot(async () => "now"), "now", "a slot is free again");
  await assert.rejects(withPdfSlot(async () => { throw new Error("render failed"); }));
  gates.shift()!();
  assert.equal(await b, "pdf");
  assert.equal(pdfSlotsBusy(), 0, "every slot released, even after a failure");
});
