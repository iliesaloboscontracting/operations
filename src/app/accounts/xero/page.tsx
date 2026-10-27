"use client";

// Accounts -> Accounts data (27 Oct 2026, Ilies: "i need all of this informations and consolidation of these
// invoices to jobs pushed over to accounts (victoria) page"). The same pieces as Directors -> Accounts data,
// not a copy: the live read-only Xero connection (accounts can refresh; connecting stays the owner's), the
// Xero exports, and the sales invoices still to tie to a job - Victoria picks the job or "Not a job", and the
// choice is remembered for every later read (one store; the Directors page shows the same).
import { Suspense, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import XeroExports from "@/components/xero/XeroExports";
import XeroConnectionCard from "@/components/xero/XeroConnectionCard";

export default function AccountsXeroPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [reload, setReload] = useState(0);
  if (loading) return null;
  if (!accountsOnly && !isAdmin) return <PageShell title="Accounts data"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  return (
    <PageShell title="Accounts data" subtitle="Xero, read-only - live once connected, or from your exports. Tie each sales invoice to its job; the directors see the same.">
      <Suspense fallback={null}>
        <XeroConnectionCard base="/api/accounts/xero" onSynced={() => setReload((n) => n + 1)} />
      </Suspense>
      <XeroExports key={reload} />
    </PageShell>
  );
}
