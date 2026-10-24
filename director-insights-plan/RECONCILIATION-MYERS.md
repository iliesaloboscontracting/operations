# Reconciliation: Myers, before switch-on

Read-only check, 24 Oct 2026, by the Director Insights agent, on the director test copy (`prisma/test.db`, unzipped from `cloud-dev-20261024-1849.db.gz`, main schema 5aad599). Nothing was written to any database except the additive schema push on that copy.

**Method.** Three views of Myers were compared:
1. the Directors overview (`loadDirectorOverview()`);
2. Tracking (`loadTracking()`, which `/api/tracking` and the Tracking job page `/tracking/[id]` both read; proven byte-identical to the pre-refactor route in Task B);
3. the raw records, totalled independently from the tables: `InvoicedCost`, `LabourCost` backfill, `AllocationCost` frozen ledger for closed days, and the hire register.

Script: `myers.mts` in the director scratchpad. Today = 2026-10-24.

**Myers**: client Streetbuild, job no. 007, active. Contract value **$499,000** ex GST (Quotation 26_263 R04, 10 Jul 2026).

## 1. Totals: every number matches

| Figure | Directors / Tracking | Independent from records | Result |
|---|---|---|---|
| Cost to date | $244,059.97 | Sum of daily costs $244,059.97 = invoices $113,604.87 + own crew $122,335.10 + trucks $600 + hire estimate $7,520 | Match |
| Locked | $112,767.10 | Labour backfill $102,493.10 (285 rows, 12 Aug–26 Sep) + frozen closed days $10,274 (28 & 29 Sep, 23 Oct: labour $9,674, truck $600) | Match |
| Estimated | $17,688.00 | Open-day own crew $10,168 + hire estimate $7,520 | Match |
| Invoiced | $113,604.87 | 36 invoice rows, ex GST | Match |
| Own crew | $122,335.10 | Backfill $102,493.10 + frozen $9,674 + open days $10,168 | Match |
| Still to come | $0 | No board days booked after today, no unbilled labour hire on the board, and no finish date on the hire items (see 3.2) | Match, but understated (see 3) |
| Forecast | $244,059.97 (49% of contract) → On track | $244,059.97 ÷ $499,000 = 48.9% | Match |
| Month so far (Oct) | $19,442.20 ($1,754.20 firm, $17,688 estimated) | Same, from the daily figures | Match |

The company "spent this month so far" on the Directors page ($121,132.41) equals the sum of every project's October figures ($121,132.41). Myers is one of the 7 "On track" jobs in the health counts.

## 2. By category: invoices on record vs Tracking

| Category | Invoices (rows, ex GST) | Tracking category | Result |
|---|---|---|---|
| Labour hire | 16 rows, $89,640.00 | $89,640.00 | Match |
| Plant hire | 7 rows, $21,375.58 | Hired plant $28,895.58 = $21,375.58 invoiced + $7,520 estimate for days not yet invoiced | Match (explained) |
| Materials | 12 rows, $2,235.09 | $2,235.09 | Match |
| Tip fees | 1 row, $354.20 | $354.20 | Match |

GST: every row has ex GST + GST = total. The tip-fee row's GST ($4.96 on $354.20) is low because most tip levies are GST-free. That's normal and doesn't affect ex-GST costs.

**Hire estimates check.** Mega Hire contract C100083:
- **2.5T excavator:** register rate $1,800/week → $360/day (week ÷ 5). On hire since 4 Sep: 36 working days. Invoice 49104 covers 4 Sep–1 Oct (20 days), leaving 16 days × $360 = **$5,760**.
- **3.5T rock breaker:** register rate $550/week → $110/day. Same 16 uninvoiced days = **$1,760**.

Together that's $7,520 = the hire estimate. The Directors alerts "~$5.8k" and "~$1.8k est., 16 working days with no invoice" are these same figures.

## 3. Differences that need a person (none are calculation errors)

1. **AG10539 has two DAY lines.**
   - Six labour-hire invoice numbers appear more than once. Five of them are one invoice split into a DAY line and a NIGHT line, which is legitimate (AG10052, AG10103, AG10169, AG10389, AG10450).
   - **AG10539 (w/e 20 Sep)** has three lines: NIGHT $10,950, DAY $11,261.25 **and a second DAY line of $2,145**. That second line could be a real separate charge, or a double entry. **Check against the Munster invoice.** If it's a duplicate, Myers is overstated by $2,145.
2. **No finish date on the Mega Hire items**, so "still to come" for hire is $0 and the forecast can't see the hire still running.
   - Both items show on Tracking as "no expected finish date" (3 items in total, with the generator).
   - Until an off-hire date is set, Myers' forecast (49%) is the spend so far plus nothing more.
3. **The register rate is lower than the invoiced rate for the excavator.**
   - Invoice 49104 bills the excavator at $7,911.60 for 20 days (about $395.58/day) against the register's $360/day.
   - If that rate continues, the 16-day estimate is low by roughly $570. The register may be missing a delivery charge or a rate rise.
   - The breaker bills about $104.50/day against the register's $110/day, a small over-estimate.
4. **Labour hire after w/e 20 Sep isn't in the cost at all.**
   - Labour hire counts only once invoiced. Myers' last labour-hire invoice is w/e 20 Sep.
   - There are no labour-hire tiles on the Myers board after 3 Oct and no hire-worker sign-ins, so Tracking's "unbilled labour hire" is $0.
   - Either no labour hire worked on Myers since then, or invoices for w/e 27 Sep onwards haven't been entered. Weeks w/e 23 Aug and 30 Aug have no labour-hire invoice either.
   - **Ask accounts.** For scale only (not a forecast): the six invoiced weeks averaged about $14,940 a week.
5. **The labour backfill has gaps.** 41 of the 285 backfill rows (before 26 Sep) have no cost, because the rate was TBC or the hours were missing. They predate the "uncosted" counter, so they don't appear in the 0 uncosted allocations. Own crew before 26 Sep is understated by whatever those rows would cost.
6. **4 allocations are on unconfirmed (TBC) pay rates.** They're costed, but on draft rates.
7. **Generator 20kVA (hire)**: no supplier, dates or rate. It costs nothing in Tracking. Check whether it's still on hire.
8. **Project record:**
   - The new **quote no.** field is blank, although the contract-value note cites "Quotation 26_263 R04".
   - **Job no.** "007" should be checked against the SharePoint project folder number (main e85018b's new rule).
   - Both are data changes, so they'd go through propose-then-apply. I haven't made any.

## 4. Verdict

- **Every Directors figure for Myers equals Tracking's, and every Tracking total reconciles to the records.** That covers invoices by category, the frozen ledger, the labour backfill and the hire estimate arithmetic.
- **The Directors page is fit to switch on.** Its numbers are exactly as reliable as Tracking's, no more and no less.
- Real cost is likely higher than shown, through items 2–5, and possibly $2,145 lower if item 1 is a duplicate. Those are data questions for accounts and the office, not calculation errors.
