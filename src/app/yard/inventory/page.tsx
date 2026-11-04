"use client";

import Link from "next/link";
import PageShell from "@/components/PageShell";
import Inventory from "@/components/yard/Inventory";
import { useAuth } from "@/components/AuthProvider";

// Consumables (Yard Stage C, Ilies 4 Nov 2026: "Stage C: start on the consumables inventory"): rubble bags, blades, P2
// masks, gloves, hi-vis - what's on the shelf, stock in / out / counts with who and when, and what's below its minimum.
// The yard computer, the coordinator and Managers / Admins work it; Viewers look (/api/inventory, Tools access).
// Quantities only - prices live in purchase requests.
export default function InventoryPage() {
  const { canEdit, coordinatorOnly, yardOnly, user, loading } = useAuth();
  if (loading) return <PageShell title="Consumables"><p className="text-sm text-gray-500">Loading…</p></PageShell>;
  if (!user) return <PageShell title="Consumables"><p className="text-sm text-gray-400">Sign in to see the consumables.</p></PageShell>;
  return (
    <PageShell
      title="Consumables"
      subtitle="What's on the yard's shelves - stock in, stock out and counts, each recorded with who and when. Quantities only."
      actions={
        <div className="flex flex-wrap gap-2">
          {(yardOnly || canEdit) && <Link href="/yard" className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Yard jobs</Link>}
          {(yardOnly || coordinatorOnly || canEdit) && <Link href="/yard/stocktake" className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Tool stock take</Link>}
        </div>
      }
    >
      <div className="max-w-6xl"><Inventory /></div>
    </PageShell>
  );
}
