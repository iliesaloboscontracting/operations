import { redirect } from "next/navigation";

// The Invoices tab (accounts' upload inbox) was removed on 28 Oct 2026 - Ilies: "remove invoices tab ... from all",
// because invoices, registers and documents now live in the shared "Leza & Victoria" folder, which the lead checks
// and applies. Nothing recorded was deleted: invoices already on jobs, Invoice checks and the inbox records stay.
// Accounts' questions are on Accounts -> Questions; old links land on Accounts data.
export default function InvoicesPage() {
  redirect("/accounts/xero");
}
