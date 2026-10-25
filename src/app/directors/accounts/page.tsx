"use client";

// Directors -> Accounts data (G2, 25 Oct 2026): the Xero exports accounts
// uploads (sales invoices, Profit and Loss, bills) and the invoices still to
// tie to a job. The same screen accounts has on Invoices -> Xero exports.
// Manual until the live read-only Xero connection (G3) replaces it.
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import XeroExports from "@/components/xero/XeroExports";

export default function AccountsDataPage() {
  const { isDirector, loading } = useAuth();
  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="Accounts data">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }
  return (
    <PageShell title="Accounts data" subtitle="Xero exports uploaded by accounts - manual until the live Xero connection">
      <XeroExports />
    </PageShell>
  );
}
