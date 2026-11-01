"use client";

import PageShell from "@/components/PageShell";
import MyPurchases from "@/components/purchases/MyPurchases";
import { useAuth } from "@/components/AuthProvider";
import { BUILDING_AGENT_EMAIL } from "@/lib/session";

// In-app purchase and hire requests (Accounts stage 6): ask to buy or hire something and follow it through - approved
// by Ilies or a director (who picks the supplier's quote), ordered by accounts. Since 2 Nov 2026 (Ilies) the
// description and the suppliers' quotes carry prices, and Managers, Admins and the coordinator see everyone's requests
// read-only. Accounts' own amount and note stay on the Accounts and Directors screens.
export default function PurchasesPage() {
  const { canEdit, accountsOnly, coordinatorOnly, loading, user } = useAuth();
  // PUR-001: the Building Agent login doesn't raise purchase requests (the server refuses it too).
  if (!loading && user?.email.toLowerCase() === BUILDING_AGENT_EMAIL) return <PageShell title="Purchase requests"><p className="text-sm text-gray-400">The Building Agent login can't ask to buy things.</p></PageShell>;
  if (!loading && !canEdit && !accountsOnly && !coordinatorOnly) return <PageShell title="Purchase requests"><p className="text-sm text-gray-400">Ask the office to buy it for you.</p></PageShell>;
  return (
    <PageShell title="Purchase requests" subtitle="Ask to buy or hire something, with suppliers' quotes and prices. Ilies or a director approves it and picks the supplier, accounts order it. Everyone's requests are below, read-only.">
      <div className="max-w-2xl"><MyPurchases base="/api/purchases" /></div>
    </PageShell>
  );
}
