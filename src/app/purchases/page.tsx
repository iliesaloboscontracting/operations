"use client";

import PageShell from "@/components/PageShell";
import MyPurchases from "@/components/purchases/MyPurchases";
import { useAuth } from "@/components/AuthProvider";

// In-app purchase requests (Accounts stage 6): ask accounts to buy something and follow it through - checked,
// approved by a director, ordered. No prices here; accounts and the directors see those on their own screens.
export default function PurchasesPage() {
  const { canEdit, accountsOnly, loading } = useAuth();
  if (!loading && !canEdit && !accountsOnly) return <PageShell title="Purchase requests"><p className="text-sm text-gray-400">Ask the office to buy it for you.</p></PageShell>;
  return (
    <PageShell title="Purchase requests" subtitle="Ask to buy something. Accounts check it, a director approves it, accounts order it.">
      <div className="max-w-xl"><MyPurchases base="/api/purchases" /></div>
    </PageShell>
  );
}
