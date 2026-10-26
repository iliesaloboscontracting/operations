# Reimbursements from the phone, and plant in the fuel picker

Design note, 27 Oct 2026. Branch `director-reimburse-link`, from main `e038a9b` plus the Directors Production view.

## Ilies's words (27 Oct)

> "these are not reimbursements these tipping dockets and should not be treated as such. add a tab to the site supervisors links and driver links for reimbursements. also in the category of what vehicles the fuel was for add the assesst (plant) eg excavators"

Draft defaults are marked **Draft**.

## 1. Tip dockets are never reimbursement candidates

- **Before:** Accounts → Reimbursements listed every tip docket and fuel receipt from the last 60 days as "could be claimed".
- **Now:** that list takes **only receipts the worker marked "I paid this myself"** (`Receipt.ownMoney`).
  - Ordinary tip dockets and fuel receipts are company costs and no longer appear there at all.
  - Accounts can still enter a manual claim as before.

## 2. "Reimbursement" on supervisor and driver links

There's a new tile on every link that can send receipts (`resolveReceiptLink`: SUPERVISOR and DRIVER), with two parts.

**Claim a reimbursement:**
1. Photograph the receipt (up to 2 photos).
2. Pick what it was for: **Fuel / Tools / Materials / Parking & tolls / Other**, plus a short note (required for Other).
   - **Fuel** also asks which truck or plant it was for (the picker in section 3).
3. Tap **"I paid this myself"**.

**Behind the scenes:**
- **Fuel** becomes an ordinary FUEL receipt with `ownMoney`. It counts in the fuel indicators like any fuel receipt (one photo, not two). Fuel is still never a job cost.
- **Anything else** becomes a receipt of the new kind **PURCHASE** (`purpose`, `note`). It is the accounts' business only: it stays off the Operations Receipts page (Managers).
- **Claude reads it** server-side through the existing receipts pipeline and its kill switch `RECEIPT_READING=off`:
  - fuel uses the fuel reading;
  - a purchase uses a new small reading: supplier, receipt number, date, total and GST.
  - Plain rules decide READ or CHECK, as for fuel.
- **The claim** (`Reimbursement`, source **LINK**) is created automatically when the reading comes back READ, or when the office confirms a reading, so there's an amount.
  - Stage 3's duplicate rules apply: the same receipt, the same photo, or the same number + amount + date is refused.
  - **Draft:** a reading that needs checking (CHECK), or a receipt read while the kill switch is on, isn't claimed automatically. It waits on Accounts → Reimbursements under "Own-money receipts" with the reading shown, and Victoria makes the claim with the existing button (entering the amount if it wasn't read).
- **No amount, price or total ever shows on the link** (`linkSafe` / `assertNoMoney` on every link response).
  - "My reimbursements" (last 60 days) shows what it was for, when it was sent and its status: **Sent → With accounts → Paid on <date>**, or "Not going ahead - ask accounts".
  - Victoria's cancel reason isn't shown, because it could contain a figure.

## 3. Fuel "which vehicle" picker: owned plant added

- The fuel picker (Add receipt → Fuel, and Reimbursement → Fuel) lists **"Trucks & vehicles"** (the Lobos-owned trucks, as before) and **"Plant"**: owned, active Plant-register machines (`type EQUIPMENT`, `ownership OWNED`), e.g. excavators, loaders, bobcats.
- **Draft:**
  - attachments (breakers, buckets) aren't offered, as they have no fuel tank;
  - hired plant isn't offered until Ilies says so.
- The per-asset fuel indicator (Receipts → Indicators, R4) groups the same way.
  - Plant has no odometer, so it shows fuel by week (litres and $), with no km / L-per-100-km.
  - Trucks are unchanged.

## Schema (additive)

`Receipt`:
- `ownMoney Boolean @default(false)`;
- `purpose String?`: FUEL / TOOLS / MATERIALS / PARKING_TOLLS / OTHER;
- `note String?`;
- `supplier String?`, `purchaseTotal Float?`: a PURCHASE reading.

New receipt kind **PURCHASE**. `Reimbursement.source` gets a new value, **LINK**.

## Tests

- **Unit:**
  - parsing a reimbursement from the phone (purpose, note, the fuel asset, photos);
  - the purchase reading's READ / CHECK rules and fields;
  - a receipt's amount for PURCHASE;
  - link-safe status wording.
- **Copy:**
  - tip dockets gone from the claim list;
  - a supervisor and a driver link at phone size: send a fuel (plant) and a tools reimbursement;
  - a simulated reading → the claim appears on Accounts (source LINK) → Victoria pays → the link shows "Paid on …", never a figure;
  - duplicates refused;
  - the fuel indicator lists plant;
  - money-guard scans of every link response; viewer safety.

## 4. Office: "Add another docket from this photo" (Receipts, Manager+)

One photo can hold two dockets. The real case: Carlos's Sell & Parker photo also showed a BM Recycling docket.

- **Where:** on any tip or fuel receipt in the office list that has a photo, "Add another docket from this photo" opens a short form:
  - job;
  - tip site, docket no., date and time;
  - waste type, tonnes, rego;
  - asbestos.
- **What it creates:** a new **TIP** receipt that **shares the photo(s)**.
  - `Receipt.photoFromReceiptId` points at the receipt that owns them; the file isn't copied.
  - It starts **CONFIRMED**, with `reading.added = { by, at, fromReceiptId }`, shown as "Added by <name> from another docket's photo".
  - The sender, link and sent time are the original receipt's.
  - The truck is linked from the rego, as for read dockets.
  - The tip-invoice matching runs again.
- **Duplicate check:** a docket number (normalised as the tip matching does) already in at the same tip site is refused, naming who sent it.
- **Money rules unchanged:** office-only; a link sees at most the docket in "My receipts", never a price.
- **Schema (additive):** `Receipt.photoFromReceiptId String?`.
