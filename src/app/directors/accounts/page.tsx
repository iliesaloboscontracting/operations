"use client";

// Directors -> Accounts data (G2 + G3, 25 Oct 2026): the live read-only Xero
// connection (Iliesa connects it; directors can refresh), the Xero exports
// accounts uploads (sales invoices, Profit and Loss, bills), and the
// invoices still to tie to a job. Accounts has the uploads on Invoices ->
// Xero exports.
import { Suspense, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import XeroExports from "@/components/xero/XeroExports";
import XeroConnectionCard from "@/components/xero/XeroConnectionCard";

export default function AccountsDataPage() {
  const { isDirector, loading } = useAuth();
  const [reload, setReload] = useState(0);
  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="Accounts data">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }
  return (
    <PageShell title="Accounts data" subtitle="Xero, read-only - live once connected, or from accounts' exports">
      <Suspense fallback={null}>
        <XeroConnectionCard onSynced={() => setReload((n) => n + 1)} />
      </Suspense>
      <XeroExports key={reload} />
    </PageShell>
  );
}
