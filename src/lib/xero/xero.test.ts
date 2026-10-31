// Xero exports (G2, 25 Oct 2026): readers by header text, GST-inclusive or
// exclusive lines, credit notes, refusals; the P&L grid; job matching A/B/D
// and a person's decision; revenue / owed / overdue and the tiles. Made-up
// rows only - never accounts' real figures. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { day, month, num, readInvoiceGrid, readPnlGrid } from "./readers";
import { matchInvoice, matchKey, suggestionOf, type MatchContext } from "./match";
import { cashTile, fyStart, needsReview, pnlSummary, revenueSummary, revenueTile, type SummaryInvoice } from "./summary";

const H = ["ContactName", "InvoiceNumber", "Reference", "InvoiceDate", "DueDate", "Total", "TaxTotal", "InvoiceAmountPaid", "InvoiceAmountDue", "Description", "LineAmount", "TaxAmount", "AccountCode", "TrackingName1", "TrackingOption1", "Type", "Status"];
const row = (o: Record<string, string>) => H.map((h) => o[h] ?? "");

test("parsers: Xero's number and date styles", () => {
  assert.equal(num("(1,234.50)"), -1234.5);
  assert.equal(num("$2,000"), 2000);
  assert.equal(num("-"), null);
  assert.equal(day("25 Oct 2026"), "2026-10-25");
  assert.equal(day("5/7/2026"), "2026-07-05");
  assert.equal(month("Sep 2026"), "2026-09");
  assert.equal(month("Sep-26"), "2026-09");
  assert.equal(month("30 September 2026"), "2026-09");
  assert.equal(month("Total"), null);
});

test("invoice export: grouped by invoice, exclusive and inclusive lines both come out ex GST, credits typed", () => {
  const grid = [
    ["Sales invoices export"],
    H,
    // exclusive: lines 1,000 + 500 = 1,500 = total ex GST
    row({ ContactName: "Builder A", InvoiceNumber: "INV-1", Reference: "26_168 Claim 3", InvoiceDate: "10 Oct 2026", DueDate: "24 Oct 2026", Total: "1650", TaxTotal: "150", InvoiceAmountPaid: "0", InvoiceAmountDue: "1650", Description: "Strip-out L2", LineAmount: "1000", TaxAmount: "100", TrackingName1: "Job", TrackingOption1: "26_168", Type: "Sales invoice", Status: "AUTHORISED" }),
    row({ ContactName: "Builder A", InvoiceNumber: "INV-1", InvoiceDate: "10 Oct 2026", Total: "1650", TaxTotal: "150", Description: "Waste", LineAmount: "500", TaxAmount: "50", Type: "Sales invoice" }),
    // inclusive: line 1,100 = total; ex GST 1,000
    row({ ContactName: "Builder B", InvoiceNumber: "INV-2", InvoiceDate: "2026-09-01", Total: "1100", TaxTotal: "100", Description: "Make good", LineAmount: "1100", TaxAmount: "100", Type: "Sales invoice", Status: "PAID" }),
    row({ ContactName: "Builder A", InvoiceNumber: "CN-1", InvoiceDate: "12 Oct 2026", Total: "220", TaxTotal: "20", Description: "Credit", LineAmount: "200", TaxAmount: "20", Type: "Sales credit note" }),
    ["", "", "", "", "", "3,000.00"], // a totals row - ignored
  ];
  const r = readInvoiceGrid(grid, "INVOICES");
  if ("error" in r) assert.fail(r.error);
  assert.equal(r.invoices.length, 3);
  const i1 = r.invoices.find((i) => i.number === "INV-1")!;
  assert.deepEqual([i1.type, i1.totalExGst, i1.gst, i1.amountDue, i1.dueDate, i1.lines.length], ["SALE", 1500, 150, 1650, "2026-10-24", 2]);
  assert.deepEqual(i1.lines.map((l) => l.amountExGst), [1000, 500]);
  assert.equal(i1.lines[0].tracking1, "Job: 26_168");
  assert.deepEqual(r.invoices.find((i) => i.number === "INV-2")!.lines.map((l) => l.amountExGst), [1000]);
  assert.equal(r.invoices.find((i) => i.number === "CN-1")!.type, "SALE_CREDIT");
  const bills = readInvoiceGrid([H, row({ ContactName: "Kennards", InvoiceNumber: "B1", InvoiceDate: "1/10/2026", Total: "110", TaxTotal: "10", Type: "Bill" })], "BILLS");
  if ("error" in bills) assert.fail(bills.error);
  assert.equal(bills.invoices[0].type, "BILL");
  assert.equal(bills.invoices[0].lines[0].amountExGst, 100); // no line columns -> one line at the total ex GST
});

test("a file that isn't an invoice export is refused with the missing columns named", () => {
  const r = readInvoiceGrid([["Supplier", "Amount"], ["A", "1"]], "INVOICES");
  assert.ok("error" in r);
  if ("error" in r) assert.match(r.error, /no contact|number|date|total/);
  const alt = readInvoiceGrid([["Customer", "Invoice No", "Invoice Date", "Invoice Total"], ["X", "9", "2026-10-01", "50"]], "INVOICES");
  assert.ok(!("error" in alt), "other header spellings are found by name");
});

test("P&L: month columns, Xero's section headings, summary rows kept apart, brackets negative", () => {
  const grid = [
    ["Profit and Loss"], ["Lobos Contracting"], ["For the 3 months ended 30 September 2026"], [],
    ["", "Sep 2026", "Aug 2026", "Jul 2026"],
    ["Income"],
    ["Sales", "100,000.00", "80,000.00", "90,000.00"],
    ["Total Income", "100,000.00", "80,000.00", "90,000.00"],
    ["Less Cost of Sales"],
    ["Subcontractors", "40,000.00", "30,000.00", "-"],
    ["Gross Profit", "60,000.00", "50,000.00", "90,000.00"],
    ["Less Operating Expenses"],
    ["Rent", "5,000.00", "5,000.00", "5,000.00"],
    ["Net Profit", "55,000.00", "(5,000.00)", "85,000.00"],
  ];
  const r = readPnlGrid(grid);
  if ("error" in r) assert.fail(r.error);
  assert.deepEqual(r.months, ["2026-07", "2026-08", "2026-09"]);
  const sales = r.lines.filter((l) => l.account === "Sales");
  assert.deepEqual([sales.length, sales[0].section], [3, "Income"]);
  assert.equal(r.lines.find((l) => l.account === "Subcontractors" && l.month === "2026-09")!.section, "Less Cost of Sales");
  assert.equal(r.lines.filter((l) => l.account === "Subcontractors").length, 2); // "-" isn't a zero line
  assert.equal(r.lines.find((l) => l.account === "Net Profit" && l.month === "2026-08")!.amount, -5000);
  assert.equal(r.lines.find((l) => l.account === "Gross Profit")!.section, "Summary");
  const s = pnlSummary(r.lines);
  assert.deepEqual([s.latest, s.netProfit?.amount, s.totalIncome?.amount], ["2026-09", 55000, 100000]);
  assert.ok("error" in readPnlGrid([["Name", "Amount"], ["a", "1"]]));
  // a title row that is just a date isn't the header; a one-month report still reads
  const one = readPnlGrid([["30 September 2026"], ["", "Sep 2026"], ["Income"], ["Sales", "10"], ["Net Profit", "4"]]);
  if ("error" in one) assert.fail(one.error);
  assert.deepEqual([one.months, one.lines.length], [["2026-09"], 2]);
});

const ctx = (person: Record<string, string | null> = {}): MatchContext => ({
  projects: [
    { id: "p1", name: "Westfield L2", jobNo: "26_168", quoteNo: null, address: "1 Main Street Parramatta" },
    { id: "p2", name: "Myers Sydney", jobNo: "007", quoteNo: "26_099" },
  ],
  aliases: [{ text: "myer city", projectId: "p2" }],
  person: new Map(Object.entries(person)),
});
const inv = (lines: { description?: string; tracking1?: string | null }[], reference: string | null = null, number = "INV-9") => ({
  type: "SALE" as const, number, reference, contact: "Builder", lines: lines.map((l) => ({ description: l.description ?? null, amountExGst: 100, accountCode: null, tracking1: l.tracking1 ?? null, tracking2: null })),
});

test("matching: A tracking, B reference, D only a suggestion, a person's decision wins, mixed lines", () => {
  assert.deepEqual(pick(matchInvoice(inv([{ tracking1: "Job: 26_168" }]), ctx())), ["p1", "TRACKING"]);
  assert.deepEqual(pick(matchInvoice(inv([{ tracking1: "Job: Myers Sydney" }]), ctx())), ["p2", "TRACKING"]); // option = project name
  assert.deepEqual(pick(matchInvoice(inv([{ tracking1: "Region: 26_168" }]), ctx())), [null, "NONE"]); // other category ignored
  assert.deepEqual(pick(matchInvoice(inv([{}], "26_099 Claim 2"), ctx())), ["p2", "REFERENCE"]); // quote number
  const d = matchInvoice(inv([{ description: "Works at Myer City store" }]), ctx());
  assert.deepEqual(pick(d), [null, "SITE_TEXT"]);
  assert.equal(suggestionOf(d.note), "p2");
  const mixed = matchInvoice(inv([{ tracking1: "Job: 26_168" }, { description: "Other" }]), ctx());
  assert.deepEqual(pick(mixed), [null, "MIXED"]);
  assert.deepEqual(mixed.lines.map((l) => l.projectId), ["p1", null]);
  assert.deepEqual(pick(matchInvoice(inv([{ tracking1: "Job: 26_168" }]), ctx({ [matchKey("SALE", "inv-9")]: "p2" }))), ["p2", "PERSON"]);
  const notJob = matchInvoice(inv([{}]), ctx({ "SALE|INV-9": null }));
  assert.deepEqual([notJob.projectId, notJob.method, notJob.note], [null, "PERSON", "Not a job"]);
});
const pick = (m: { projectId: string | null; method: string }) => [m.projectId, m.method];

const si = (x: Partial<SummaryInvoice>): SummaryInvoice => ({
  type: "SALE", status: "AUTHORISED", date: "2026-10-01", dueDate: "2026-10-31", totalExGst: 1000, amountDue: 0, matchMethod: "TRACKING",
  lines: [{ amountExGst: 1000, projectId: "p1", matchMethod: "TRACKING" }], ...x,
});

test("revenue: this financial year, credits off, voided out; owed and overdue from amount due", () => {
  assert.equal(fyStart("2026-10-25"), "2026-07-01");
  assert.equal(fyStart("2026-03-01"), "2025-07-01");
  const s = revenueSummary([
    si({}),
    si({ type: "SALE_CREDIT", totalExGst: 200, lines: [{ amountExGst: 200, projectId: "p1", matchMethod: "TRACKING" }] }),
    si({ status: "VOIDED", totalExGst: 9999 }),
    si({ date: "2026-06-30", totalExGst: 5000 }), // last financial year
    si({ matchMethod: "NONE", totalExGst: 300, amountDue: 330, dueDate: "2026-10-01", lines: [{ amountExGst: 300, projectId: null, matchMethod: "NONE" }] }),
    si({ matchMethod: "PERSON", totalExGst: 50, lines: [{ amountExGst: 50, projectId: null, matchMethod: "PERSON" }] }), // not a job
    si({ type: "BILL", totalExGst: 777, amountDue: 777 }), // a bill is never revenue or owed-to-us
  ], "2026-10-25");
  assert.deepEqual([s.invoiced, s.matched, s.notAJob, s.unmatched, s.reviewCount, s.owed, s.overdue, s.overdueCount], [1150, 800, 50, 300, 1, 330, 330, 1]);
  assert.equal(Math.round(s.matchedShare! * 100), 73);
  assert.equal(needsReview({ type: "BILL", status: "AUTHORISED", matchMethod: "NONE" }), false);
});

test("tiles: manual upload, LOW, as at the export date; nothing when nothing is uploaded", () => {
  const info = { asAt: "2026-10-24", uploadedBy: "Accounts", createdAt: "2026-10-25T01:00:00.000Z" };
  const s = revenueSummary([si({}), si({ matchMethod: "NONE", amountDue: 550, dueDate: "2026-10-01", lines: [{ amountExGst: 1000, projectId: null, matchMethod: "NONE" }] })], "2026-10-25");
  const r = revenueTile({ info, s }, null)!;
  assert.deepEqual([r.statusWord, r.headline, r.confidence, r.asAt], ["1 not tied to a job", "$2,000", "LOW", "2026-10-24T00:00:00.000Z"]);
  assert.match(r.lines.join(" "), /50% tied to a job/);
  assert.match(r.lines.join(" "), /No Profit and Loss uploaded yet/);
  const c = cashTile({ info, s })!;
  assert.deepEqual([c.statusWord, c.headline], ["1 invoice overdue", "$550"]);
  assert.equal(revenueTile(null, null), undefined);
  assert.equal(cashTile(null), undefined);
  assert.ok(!JSON.stringify([r, c]).match(/margin/i));
});

test("CLM-001: an exported credit note with negative amounts comes out positive and is subtracted once; a negative line keeps its sign", async () => {
  const { claimsByJob } = await import("../insights/claims");
  const grid = [
    H,
    row({ ContactName: "Builder A", InvoiceNumber: "CN-9", InvoiceDate: "12 Oct 2026", Total: "-220", TaxTotal: "-20", Description: "Credit", LineAmount: "-200", TaxAmount: "-20", TrackingName1: "Job", TrackingOption1: "26_168", Type: "Sales credit note" }),
    // exclusive with a retention line: 1,000 - 50 = 950 = total ex GST
    row({ ContactName: "Builder A", InvoiceNumber: "INV-9", InvoiceDate: "10 Oct 2026", Total: "1045", TaxTotal: "95", Description: "Claim 4", LineAmount: "1000", TaxAmount: "100", Type: "Sales invoice" }),
    row({ ContactName: "Builder A", InvoiceNumber: "INV-9", InvoiceDate: "10 Oct 2026", Total: "1045", TaxTotal: "95", Description: "Retention", LineAmount: "-50", TaxAmount: "-5", Type: "Sales invoice" }),
  ];
  const r = readInvoiceGrid(grid, "INVOICES");
  if ("error" in r) assert.fail(r.error);
  const cn = r.invoices.find((i) => i.number === "CN-9")!;
  assert.deepEqual([cn.type, cn.totalExGst, cn.lines.map((l) => l.amountExGst)], ["SALE_CREDIT", 200, [200]]);
  const inv = r.invoices.find((i) => i.number === "INV-9")!;
  assert.deepEqual([inv.totalExGst, inv.lines.map((l) => l.amountExGst)], [950, [1000, -50]]);
  const asClaim = (i: typeof cn, projectId: string) => ({ ...i, status: "AUTHORISED", matchMethod: "TRACKING", lines: i.lines.map((l) => ({ amountExGst: l.amountExGst, projectId, matchMethod: "TRACKING" })) });
  const c = claimsByJob([asClaim(inv, "jobA"), asClaim(cn, "jobA")], "2026-10-30");
  assert.equal(c.byJob.get("jobA")?.claimed, 750, "950 claimed less the 200 credit - once");
});
