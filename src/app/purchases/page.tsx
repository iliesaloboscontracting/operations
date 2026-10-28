"use client";

import PageShell from "@/components/PageShell";
import MyPurchases from "@/components/purchases/MyPurchases";
import { useAuth } from "@/components/AuthProvider";
import { BUILDING_AGENT_EMAIL } from "@/lib/session";

// In-app purchase requests (Accounts stage 6): ask accounts to buy something and follow it through - checked,
// approved by a director, ordered. No prices here; accounts and the directors see those on their own screens.
export default function PurchasesPage() {
  const { canEdit, accountsOnly, loading, user } = useAuth();
  // PUR-001: the Building Agent login doesn't raise purchase requests (the server refuses it too).
  if (!loading && user?.email.toLowerCase() === BUILDING_AGENT_EMAIL) return <PageShell title="Purchase requests"><p className="text-sm text-gray-400">The Building Agent login can't ask to buy things.</p></PageShell>;
  if (!loading && !canEdit && !accountsOnly) return <PageShell title="Purchase requests"><p className="text-sm text-gray-400">Ask the office to buy it for you.</p></PageShell>;
  return (
    <PageShell title="Purchase requests" subtitle="Ask to buy something. Ilies or a director approves it, accounts order it.">
      <div className="max-w-xl"><MyPurchases base="/api/purchases" /></div>
    </PageShell>
  );
}
