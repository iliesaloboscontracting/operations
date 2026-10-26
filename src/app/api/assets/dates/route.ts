import { NextResponse } from "next/server";
import { guard } from "@/lib/auth";
import { withErrorHandling } from "@/lib/apiHandler";
import { assetDatesForManagers } from "@/lib/assets/store";

// GET /api/assets/dates -> { dates: { [resourceId]: [{ kind, label, issuer, reference, expiryDate, state }] } }
// D4 (Ilies, 27 Oct 2026): Managers read rego / insurance / service expiry on the Vehicles and Plant pages. Read only:
// no files, notes or amounts, and Accounts / Admins still edit them on the Accounts screen. Viewers get 403.
export const GET = withErrorHandling(async () => {
  const denied = await guard("MANAGER");
  if (denied) return denied;
  return NextResponse.json({ dates: await assetDatesForManagers() });
});
