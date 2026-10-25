// Receipts R3 - tip costs (design §Costs): the rate in force, what a docket costs, which dockets a tip
// invoice replaces (docket numbers, else supplier + job + dates), a docket going to one invoice only,
// the 35-day flag, and the docket numbers typed on an invoice. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { docketCost, isUninvoiced, matchAll, matchInvoice, parseDocketNos, rateFor, supplierMatches, type DocketForMatch, type InvoiceForMatch, type Rate } from "./tipCosts";
import { tipMismatchSignals, operationalIsMoneyFree } from "../findings/signals";

const R = (x: Partial<Rate>): Rate => ({ id: "r", tipSite: "Bingo Eastern Creek", wasteType: "", ratePerTonneExGst: 100, validFrom: "2026-01-01", retiredAt: null, ...x });
const RATES = [
  R({ id: "any-old", ratePerTonneExGst: 90, validFrom: "2026-01-01" }),
  R({ id: "any-new", ratePerTonneExGst: 95, validFrom: "2026-10-01" }),
  R({ id: "mixed", wasteType: "Mixed C&D", ratePerTonneExGst: 120, validFrom: "2026-07-01" }),
  R({ id: "mixed-wrong", wasteType: "Mixed C&D", ratePerTonneExGst: 999, validFrom: "2026-10-20", retiredAt: "2026-10-21T00:00:00Z" }),
  R({ id: "other-site", tipSite: "Cleanaway Erskine Park", ratePerTonneExGst: 300, validFrom: "2026-01-01" }),
];

test("the rate in force: that site + waste type on the date, else the site's any-waste rate; retired rates never count", () => {
  assert.equal(rateFor(RATES, "bingo  eastern-creek", "mixed c&d", "2026-10-25")?.id, "mixed", "names compared without case or punctuation; the retired 999 is ignored");
  assert.equal(rateFor(RATES, "Bingo Eastern Creek", "Mixed C&D", "2026-06-30")?.id, "any-old", "before the waste rate started: the site rate in force then");
  assert.equal(rateFor(RATES, "Bingo Eastern Creek", "VENM", "2026-10-25")?.id, "any-new", "another waste type: the latest site-wide rate");
  assert.equal(rateFor(RATES, "Bingo Eastern Creek", null, "2025-12-31"), null, "nothing in force yet");
  assert.equal(rateFor(RATES, "Somewhere Else", "Mixed C&D", "2026-10-25"), null);
  assert.equal(rateFor(RATES, null, "Mixed C&D", "2026-10-25"), null);
});

test("what a docket costs: its printed price ex GST, else tonnes × the rate, else unpriced", () => {
  const d = { tipSite: "Bingo Eastern Creek", wasteType: "Mixed C&D", day: "2026-10-25" };
  assert.deepEqual(docketCost({ ...d, priceExGst: 412.5, tonnes: 6.24 }, RATES), { amount: 412.5, basis: "PRICE", rateId: null });
  assert.deepEqual(docketCost({ ...d, priceExGst: null, tonnes: 6.24 }, RATES), { amount: 748.8, basis: "RATE", rateId: "mixed" });
  assert.deepEqual(docketCost({ ...d, priceExGst: null, tonnes: 6.24, tipSite: "Unknown Tip" }, RATES), { amount: null, basis: "UNPRICED", rateId: null });
  assert.deepEqual(docketCost({ ...d, priceExGst: null, tonnes: null }, RATES), { amount: null, basis: "UNPRICED", rateId: null }, "no weight, no price: unpriced");
});

test("supplier ~ tip site: a shared distinctive word, not the common ones", () => {
  assert.ok(supplierMatches("Bingo Industries Pty Ltd", "Bingo Eastern Creek"));
  assert.ok(supplierMatches("Cleanaway Operations", "CLEANAWAY Erskine Park"));
  assert.ok(!supplierMatches("Veolia Environmental Services", "Bingo Eastern Creek"));
  assert.ok(!supplierMatches("Waste Recycling Group Pty Ltd", "Recycling Waste Centre"), "only common words in common");
  assert.ok(!supplierMatches("", "Bingo"));
});

const dk = (id: string, x: Partial<DocketForMatch> = {}): DocketForMatch => ({ id, projectId: "P1", docketNo: null, tipSite: "Bingo Eastern Creek", day: "2026-10-10", invoicedCostId: null, ...x });
const inv = (id: string, x: Partial<InvoiceForMatch> = {}): InvoiceForMatch => ({ id, projectId: "P1", vendor: "Bingo Industries", weekEnding: "2026-10-31", periodFrom: null, periodTo: null, docketNos: [], ...x });

test("an invoice with docket numbers replaces exactly those dockets on its job", () => {
  const dockets = [dk("a", { docketNo: "A-101" }), dk("b", { docketNo: "A102" }), dk("c", { docketNo: "A103" }), dk("d", { docketNo: "A101", projectId: "P2" })];
  assert.deepEqual(matchInvoice(inv("i", { docketNos: ["a101", "A 102"] }), dockets), ["a", "b"], "numbers normalised; the same number on another job isn't taken");
  assert.deepEqual(matchInvoice(inv("i", { docketNos: ["Z999"], vendor: "Bingo" }), dockets), [], "numbers given but none match: no fallback guessing");
});

test("without docket numbers: same job, supplier ~ tip site, inside the period (or the 35 days up to the invoice date)", () => {
  const dockets = [dk("in"), dk("early", { day: "2026-09-20" }), dk("other-tip", { tipSite: "Cleanaway Erskine Park" }), dk("other-job", { projectId: "P2" }), dk("taken", { invoicedCostId: "x" })];
  assert.deepEqual(matchInvoice(inv("i"), dockets), ["in"], "26 Sep - 31 Oct window; not the 20 Sep one, another tip, another job, or one already on another invoice");
  assert.deepEqual(matchInvoice(inv("i", { periodFrom: "2026-09-15", periodTo: "2026-09-30" }), dockets), ["early"], "an invoice period wins over the 35-day window");
});

test("a docket goes to one invoice only; invoices with docket numbers go first", () => {
  const dockets = [dk("a", { docketNo: "A1" }), dk("b", { docketNo: "A2" })];
  const m = matchAll([inv("vague", { weekEnding: "2026-10-15" }), inv("exact", { weekEnding: "2026-10-31", docketNos: ["A2"] })], dockets);
  assert.equal(m.get("b"), "exact");
  assert.equal(m.get("a"), "vague");
  assert.equal(matchAll([], dockets).size, 0);
  // re-running gives the same answer (links are recomputed, not accumulated)
  assert.deepEqual([...matchAll([inv("vague", { weekEnding: "2026-10-15" }), inv("exact", { weekEnding: "2026-10-31", docketNos: ["A2"] })], dockets.map((d) => ({ ...d, invoicedCostId: m.get(d.id) ?? null })))], [...m]);
});

test("the 35-day flag and the docket numbers typed on an invoice", () => {
  assert.equal(isUninvoiced({ day: "2026-09-20", invoicedCostId: null }, "2026-10-26"), true);
  assert.equal(isUninvoiced({ day: "2026-09-22", invoicedCostId: null }, "2026-10-26"), false, "34 days: not yet");
  assert.equal(isUninvoiced({ day: "2026-09-01", invoicedCostId: "inv" }, "2026-10-26"), false);
  assert.deepEqual(parseDocketNos("A123, A124  A125;A123"), ["A123", "A124", "A125"]);
  assert.deepEqual(parseDocketNos(["1001", " 1002 ", ""]), ["1001", "1002"]);
  assert.deepEqual(parseDocketNos(undefined), []);
});

test("the two findings: Commercial (Manager+), one per docket / invoice, on the Operations side", () => {
  const s = tipMismatchSignals({
    uninvoiced: [{ id: "r1", projectId: "P1", projectName: "Myers", day: "2026-09-01", docketNo: "A1", tipSite: "Bingo", tonnes: 6 }],
    invoicesWithoutDockets: [{ id: "i1", projectId: "P1", projectName: "Myers", vendor: "Cleanaway", invoiceNo: "INV9", weekEnding: "2026-10-20", amountExGst: 812 }],
  });
  assert.deepEqual(s.map((x) => [x.kind, x.audience, x.dedupeKey]), [
    ["TIP_DOCKET_UNINVOICED", "COMMERCIAL", "TIP_DOCKET_UNINVOICED:PROJECT:P1:r1"],
    ["TIP_INVOICE_NO_DOCKET", "COMMERCIAL", "TIP_INVOICE_NO_DOCKET:PROJECT:P1:i1"],
  ]);
  assert.ok(s.every(operationalIsMoneyFree) && s.every((x) => !/\$\d/.test(x.title)), "no dollar figure in the titles");
  assert.deepEqual(tipMismatchSignals(null), []);
});
