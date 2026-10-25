# Receipts: tip dockets, fuel receipts and truck odometers (design, 25 Oct 2026)

Approved by Ilies in chat, 25 Oct 2026. The lead wrote this; the Directors agent builds it; the lead reviews, tests on
a copy and deploys after Ilies's go.

## Why

Supervisors rarely see tip dockets; the driver has them, at the tip. So the docket step in the daily log is replaced:
whoever has the docket or fuel receipt photographs it when it happens. Claude reads every photo automatically, and the
numbers are consolidated and tracked, so tip costs on Tracking are close to real time. Fuel and odometer readings give
consumption and other truck indicators.

## Ilies's decisions (25 Oct 2026)

- **Who sends receipts:** anyone with a SUPERVISOR link. That already includes the drivers Joao, Carlos, Villi, Rami
  and Pol. Turori and Arvin get a new, simple **DRIVER** link: Add receipt, My receipts. The office creates it on the
  Labour page, like other links.
- **Read by AI automatically:** yes, Claude reads every photo. This is the sixth outbound connection, built the same way
  as `invoiceReading.ts`: suggestions plus plain-code rules, with a kill switch `RECEIPT_READING=off`.
- **Fuel is NOT a job cost.** The truck day rate already includes fuel (Ilies: "yes"), so fuel is tracked per truck only.
- **Odometer:** "a photo of the odometer when they get in along with sign in". When a driver signs in on a truck's QR
  (POSTER link, place VEHICLE), the next screen asks for an odometer photo, with "Can't now" allowed. Claude reads the km.
- **Tip rates:** yes. The office keeps a rate list per tip site and waste type ($/tonne ex GST). A docket with a weight but
  no price is costed from it straight away.

## Capture (phones; no money ever shown on a link)

- **Add receipt:** first **Tip docket** or **Fuel**, then the photo (a second photo is allowed for long dockets).
  - **Tip docket:** the job is prefilled with their job today and can be changed. Then one tap: **Asbestos? Yes / No**.
  - **Fuel:** the truck is prefilled with the truck they're on today (board or vehicle sign-in) and can be changed.
- **My receipts:** what they sent today, with read status only. Never a price. Use narrow DTOs plus `assertNoMoney`.
- **Truck sign-in:** an odometer photo after signing in on a VEHICLE poster.

## Reading (server, background)

- **Tip:** docket no, date/time, tip site, waste type, tonnes (net), truck rego, price ex GST / inc GST if printed.
- **Fuel:** litres, $/L, total, station, date/time, rego.
- **Odometer:** km.
- **Sent to Claude:** the photo, plus only our truck regos and known tip-site names. No rates, no other data.
- **The rules decide** between **READ** (goes in) and **CHECK** (an office person confirms):
  - key fields missing or unclear;
  - a duplicate docket number;
  - the date more than 2 days from when it was sent;
  - a rego that isn't ours;
  - the odometer going backwards or jumping more than 1,500 km in a day;
  - asbestos waste type vs the Yes/No tap disagreeing.
- An office person can correct any field; corrections are kept with who and when.

## Costs (tip only)

- **Before the invoice:** a READ or confirmed tip docket adds an **estimated tip cost** to its job on Tracking. It sits
  in the same estimate layer as hire (category Tip fees). The amount is the docket's price ex GST, else tonnes × the tip
  rate in force on that date. With no rate, it's unpriced and flagged "Add a tip rate".
- **When the invoice arrives:** a tip invoice (`InvoicedCost`, tip category, from the invoices inbox or "Add invoice")
  is matched to dockets by docket numbers on the invoice, or else supplier, job and date range. Matched dockets stop
  counting, and the invoice replaces them, so nothing is counted twice. This is the same principle as `hireEstimate`.
- **Mismatches are flagged both ways:**
  - a docket not invoiced after 35 days;
  - an invoice tip line with no docket.

  These are findings on the Operations side, not on the Directors screen.
- **Never touched:** frozen `AllocationCost` rows and closed days. Estimates are live-only, like hire.

## Indicators

- **Per job:** loads, tonnes, tip cost, $/tonne, asbestos loads.
- **Per truck:**
  - km per day (from odometer readings);
  - litres and fuel $ per day and per week;
  - L/100 km (fuel between two odometer readings);
  - flags: consumption more than 25% above the truck's own 8-week average; a docket from a tip site not used on that
    job before (information only).
- **Shown on:** the new Receipts page, the Vehicles register (per truck), Tracking job pages and Day Review per job.
  Later, the Directors KPIs (tip $/t, fuel $/week); propose these to the lead first.

## Screens

- **`/receipts`** (Manager+): Check these | All receipts (filters: day, job, truck, person, kind, asbestos) | Tip rates.
  - Tip rates are edited by Admins only. They're money: never on a link, and Viewers never see them.
- **Day Review:** each job card shows its dockets for the day (count, tonnes, asbestos flag). Office side only.
- **Daily log:** the docket step is removed. It shows "N dockets sent today" for the job instead.

## Data (all additive; schema needs the lead's OK before db push)

- **Receipt:** kind TIP|FUEL; photo ids; siteLinkId; sentBy; sentAt; jobId/projectId (TIP); vehicleId; asbestos (bool);
  reading JSON; status READ|CHECK|CONFIRMED|REJECTED; extracted fields; correctedBy/At; invoicedCostId (when matched).
- **OdometerReading:** vehicleId; siteAttendanceId; photo; km; status; reading JSON.
- **TipRate:** tipSite; wasteType; ratePerTonneExGst; validFrom; source; createdBy.
- **Files:** in `RECEIPT_FILE_DIR` (server: `/srv/operations/receipt-files`). The lead adds it to the nightly backup.

## Build order (each one tested on a copy, then reported to the lead; never merged or deployed by the builder)

1. **R1 capture:** the DRIVER link kind, Add receipt / My receipts, the truck-sign-in odometer photo, storage, and the
   `/receipts` list (photos only). Also the daily log docket step → count.
2. **R2 reading:** Claude reads + the rules → READ / CHECK, the Check these list, corrections.
3. **R3 costs:** tip rates, estimated tip cost on Tracking, invoice matching, both mismatch flags.
4. **R4 indicators:** per job and per truck, the Vehicles register view, consumption flags.

**Standards:**
- `npx tsc --noEmit` and `npm test` pass, with new unit tests for the rules and the cost maths;
- byte-identical captures of existing pages on a copy, apart from the intended changes;
- the money-guard scan passes on every link response;
- no change to frozen ledgers.
