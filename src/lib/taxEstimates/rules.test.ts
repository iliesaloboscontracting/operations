// Tax estimates (Accounts stage 7) - made-up numbers and made-up rates only. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountClasses, basDueDate, classifyAccount, daysInFy, fyOfDate, gstForPeriod, matchCalendarItem, payrollTaxDueDate, payrollTaxMonth, payrollTaxYear, periodsOfFy, wagesByMonth, type PnlLine } from "./rules";
import type { RateRow } from "@/lib/oncosts/rules";

const RATE = (x: Partial<RateRow> = {}): RateRow => ({ line: "PAYROLL_TAX", label: "Payroll tax", percent: 5, base: "PAID_PLUS_SUPER", appliesTo: "ALL", thresholdRule: "FLAT", effectiveFrom: "2020-01-01", ...x });

test("financial years and quarters (Q1 = Jul-Sep)", () => {
  assert.deepEqual([fyOfDate("2026-06-30"), fyOfDate("2026-07-01")], [2025, 2026]);
  const q = periodsOfFy(2026, "QUARTERLY");
  assert.deepEqual(q.map((p) => [p.key, p.from, p.to]), [["2026-Q1", "2026-07-01", "2026-09-30"], ["2026-Q2", "2026-10-01", "2026-12-31"], ["2026-Q3", "2027-01-01", "2027-03-31"], ["2026-Q4", "2027-04-01", "2027-06-30"]]);
  assert.equal(periodsOfFy(2027, "MONTHLY")[7].to, "2028-02-29", "leap February");
  assert.deepEqual([daysInFy(2026), daysInFy(2027)], [365, 366]);
});

test("GST: collected (sales less credits) minus paid (bills less credits); voided ignored; missing GST counted", () => {
  const inv = [
    { type: "SALE", status: "AUTHORISED", date: "2026-10-05", gst: 1000 }, { type: "SALE", status: "PAID", date: "2026-11-05", gst: 500 },
    { type: "SALE_CREDIT", status: "AUTHORISED", date: "2026-11-10", gst: 100 }, { type: "SALE", status: "VOIDED", date: "2026-11-10", gst: 9999 },
    { type: "BILL", status: "PAID", date: "2026-10-20", gst: 300 }, { type: "BILL_CREDIT", status: "AUTHORISED", date: "2026-12-01", gst: 50 },
    { type: "SALE", status: "DRAFT", date: "2026-10-01", gst: 9999 }, { type: "BILL", status: "AUTHORISED", date: "2026-12-02", gst: null },
    { type: "SALE", status: "AUTHORISED", date: "2027-01-02", gst: 7777 },
  ];
  assert.deepEqual(gstForPeriod(inv, "2026-10-01", "2026-12-31"), { collected: 1400, paid: 250, net: 1150, sales: 3, bills: 2, noGst: 1 });
  assert.equal(gstForPeriod([{ type: "BILL", status: "PAID", date: "2026-10-01", gst: 80 }], "2026-10-01", "2026-12-31").net, -80, "a refund");
});

test("P&L accounts: wages / super by name, never payroll tax or workers comp; Victoria's choice wins", () => {
  assert.equal(classifyAccount("Wages and Salaries", "Less Operating Expenses"), "WAGES");
  assert.equal(classifyAccount("Superannuation", "Less Operating Expenses"), "SUPER");
  assert.equal(classifyAccount("Payroll Tax", "Less Operating Expenses"), "NONE");
  assert.equal(classifyAccount("Workers Compensation Insurance", "Less Operating Expenses"), "NONE");
  assert.equal(classifyAccount("Sales", "Income"), "NONE");
  assert.equal(classifyAccount("Total Operating Expenses", "Less Operating Expenses"), "NONE");
  const lines: PnlLine[] = [{ month: "2026-07", section: "Less Cost of Sales", account: "Subcontract labour", amount: 1 }, { month: "2026-07", section: "Less Operating Expenses", account: "Wages and Salaries", amount: 1 }];
  const c = accountClasses(lines, { "Subcontract labour": "WAGES" });
  assert.deepEqual(c.map((x) => [x.account, x.class, x.suggested, x.saved]), [["Subcontract labour", "WAGES", "NONE", true], ["Wages and Salaries", "WAGES", "WAGES", false]]);
});

const PNL: PnlLine[] = [
  { month: "2026-07", section: "Less Operating Expenses", account: "Wages", amount: 100000 }, { month: "2026-07", section: "Less Operating Expenses", account: "Superannuation", amount: 12000 },
  { month: "2026-08", section: "Less Operating Expenses", account: "Wages", amount: 50000 }, { month: "2026-08", section: "Less Operating Expenses", account: "Superannuation", amount: 6000 },
  { month: "2026-08", section: "Less Operating Expenses", account: "Rent", amount: 99999 },
];
const CLASSES = new Map([["Wages", "WAGES" as const], ["Superannuation", "SUPER" as const], ["Rent", "NONE" as const]]);

test("payroll tax FLAT on paid + super (or paid only), from the stage 3 rate; no rate = not set", () => {
  const m = wagesByMonth(PNL, CLASSES);
  assert.deepEqual(m.get("2026-07"), { wages: 100000, super: 12000 });
  assert.equal(payrollTaxMonth("2026-07", 100000, 12000, [RATE()]).tax, 5600); // 5% of 112,000
  assert.equal(payrollTaxMonth("2026-07", 100000, 12000, [RATE({ base: "PAID" })]).tax, 5000);
  assert.equal(payrollTaxMonth("2026-07", 100000, 12000, []).tax, null);
  assert.equal(payrollTaxMonth("2026-07", 100000, 12000, [RATE({ effectiveFrom: "2026-08-01" })]).tax, null, "rate not in force yet");
});

test("payroll tax above a threshold: the month's share (days in month / days in FY); YTD and the reconciliation check", () => {
  const rates = [RATE({ thresholdRule: "ABOVE_THRESHOLD", thresholdAnnual: 365000 })]; // 1,000 a day in a 365-day year
  const jul = payrollTaxMonth("2026-07", 100000, 12000, rates);
  assert.deepEqual([jul.monthlyThreshold, jul.tax], [31000, 4050]); // 5% of (112,000 - 31,000)
  assert.equal(payrollTaxMonth("2026-07", 20000, 0, rates).tax, 0, "under the month's share: nothing");
  const y = payrollTaxYear(2026, wagesByMonth(PNL, CLASSES), rates, "2026-08-31");
  assert.deepEqual(y.rows.map((r) => r.tax), [4050, 1250]); // Aug: 5% of (56,000 - 31,000)
  assert.equal(y.ytdTax, 5300);
  assert.equal(y.reconciliation, 5300); // 5% of (168,000 - 62,000)
  assert.equal(payrollTaxYear(2026, wagesByMonth(PNL, CLASSES), [], "2026-08-31").notSet, true);
});

test("due dates: BAS quarterly (self / agent), monthly; payroll tax 7th, June -> 28 July reconciliation", () => {
  const q = periodsOfFy(2026, "QUARTERLY");
  assert.deepEqual(q.map((p) => basDueDate(p, "QUARTERLY", "SELF")), ["2026-10-28", "2027-02-28", "2027-04-28", "2027-07-28"]);
  assert.equal(basDueDate(q[0], "QUARTERLY", "AGENT"), "2026-11-25");
  assert.equal(basDueDate(periodsOfFy(2026, "MONTHLY")[3], "MONTHLY", "SELF"), "2026-11-21");
  assert.deepEqual(payrollTaxDueDate("2026-10"), { due: "2026-11-07", what: "monthly return" });
  assert.deepEqual(payrollTaxDueDate("2026-12"), { due: "2027-01-07", what: "monthly return" });
  assert.deepEqual(payrollTaxDueDate("2027-06"), { due: "2027-07-28", what: "annual reconciliation" });
});

test("calendar: the linked item first, else Victoria's open item of that kind due near the date - never a second copy", () => {
  const items = [
    { id: "a", category: "BAS", dueDate: "2027-02-25", status: "OPEN", amount: null, sourceType: null, sourceId: null },
    { id: "b", category: "BAS", dueDate: "2026-10-28", status: "DONE", amount: null, sourceType: null, sourceId: null },
    { id: "c", category: "PAYROLL_TAX", dueDate: "2027-02-28", status: "OPEN", amount: null, sourceType: null, sourceId: null },
  ];
  assert.equal(matchCalendarItem(items, "BAS", "BAS:2026-Q2", "2027-02-28")?.id, "a");
  assert.equal(matchCalendarItem(items, "BAS", "BAS:2026-Q1", "2026-10-28"), null, "done items don't count");
  const linked = [...items, { id: "d", category: "BAS", dueDate: "2027-03-15", status: "OPEN", amount: 1, sourceType: "TAX_ESTIMATE", sourceId: "BAS:2026-Q2" }];
  assert.equal(matchCalendarItem(linked, "BAS", "BAS:2026-Q2", "2027-02-28")?.id, "d");
});
