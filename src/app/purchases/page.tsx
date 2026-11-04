"use client";

import { useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import MyPurchases, { type PurchasePrefill } from "@/components/purchases/MyPurchases";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { BUILDING_AGENT_EMAIL } from "@/lib/session";

// In-app purchase and hire requests (Accounts stage 6): ask to buy or hire something and follow it through - approved
// by Ilies or a director (who picks the supplier's quote), ordered by accounts. Since 2 Nov 2026 (Ilies) the
// description and the suppliers' quotes carry prices, and Managers, Admins and the coordinator see everyone's requests
// read-only. Accounts' own amount and note stay on the Accounts and Directors screens.
// ?stockItem=<id> (Yard Stage C, 4 Nov 2026): "Request a purchase" on a consumable below its minimum - the form opens
// filled in from /api/inventory/<id>/purchase-prefill; nothing is sent until the person sends it.
export default function PurchasesPage() {
  const { canEdit, accountsOnly, coordinatorOnly, loading, user } = useAuth();
  const [prefill, setPrefill] = useState<PurchasePrefill | null | undefined>(undefined);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("stockItem");
    if (!id) return setPrefill(null);
    window.history.replaceState(null, "", "/purchases");
    apiFetch(`/api/inventory/${encodeURIComponent(id)}/purchase-prefill`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { prefill: PurchasePrefill } | null) => setPrefill(d?.prefill ?? null))
      .catch(() => setPrefill(null));
  }, []);
  // PUR-001: the Building Agent login doesn't raise purchase requests (the server refuses it too).
  if (!loading && user?.email.toLowerCase() === BUILDING_AGENT_EMAIL) return <PageShell title="Purchase requests"><p className="text-sm text-gray-400">The Building Agent login can't ask to buy things.</p></PageShell>;
  if (!loading && !canEdit && !accountsOnly && !coordinatorOnly) return <PageShell title="Purchase requests"><p className="text-sm text-gray-400">Ask the office to buy it for you.</p></PageShell>;
  return (
    <PageShell title="Purchase requests" subtitle="Ask to buy or hire something, with suppliers' quotes and prices. Ilies or a director approves it and picks the supplier, accounts order it. Everyone's requests are below, read-only.">
      {prefill === undefined ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="max-w-2xl"><MyPurchases base="/api/purchases" prefill={prefill ?? undefined} /></div>
      )}
    </PageShell>
  );
}
