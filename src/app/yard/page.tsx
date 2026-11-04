"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "@/components/PageShell";
import PushToggle from "@/components/PushToggle";
import YardJobs from "@/components/yard/YardJobs";
import { useAuth } from "@/components/AuthProvider";
import { isYardLogin } from "@/lib/yard/rules";
import { apiFetch } from "@/lib/apiFetch";

// Yard jobs (Ilies, 4 Nov 2026): the yard's list on a desktop - the YARD login's home,
// and Managers / Admins can look in (/api/yard; the YARD login and Admins work it,
// Managers only look). The same list the yard's shared phone link has. No dollar figures.
export default function YardPage() {
  const { user, isAdmin, canEdit, loading } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) {
      setOpenId(id);
      window.history.replaceState(null, "", "/yard");
    }
  }, []);
  const yardLogin = !!user && isYardLogin(user.role);
  // Yard Stage C (4 Nov 2026): how many consumables are below their minimum - a small counter on the Consumables link.
  const [belowMin, setBelowMin] = useState(0);
  useEffect(() => {
    if (!user) return;
    apiFetch("/api/inventory?count=1").then((r) => (r.ok ? r.json() : null)).then((d) => setBelowMin(d?.belowMin ?? 0)).catch(() => undefined);
  }, [user]);

  if (loading) return <PageShell title="Yard jobs"><p className="text-sm text-gray-500">Loading…</p></PageShell>;
  if (!canEdit && !yardLogin) return <PageShell title="Yard jobs"><p className="text-sm text-gray-400">The yard list is for the yard and managers.</p></PageShell>;
  return (
    <PageShell
      title="Yard jobs"
      subtitle="Tools, materials and deliveries for site - get them ready, photo them, and they're collected from here."
      actions={
        <div className="flex flex-wrap items-start gap-2">
          {(yardLogin || isAdmin) && <PushToggle />}
          {/* Yard Stage B (4 Nov 2026): count the yard against the tool register. */}
          <Link href="/yard/stocktake" className="rounded-lg border border-brand-500 px-3 py-2 text-sm text-brand-300 hover:bg-brand-600/20">Stock take</Link>
          <Link href={belowMin ? "/yard/inventory?below=1" : "/yard/inventory"} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">
            Consumables
            {belowMin > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white" title="Below minimum">{belowMin}</span>}
          </Link>
          {canEdit && <Link href="/requests" className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Requests</Link>}
        </div>
      }
    >
      {canEdit && !isAdmin && <p className="mb-3 text-xs text-gray-500">You can look; the yard and Admins work the list.</p>}
      <div className="max-w-5xl">
        <YardJobs api="/api/yard" inApp openId={openId} />
      </div>
    </PageShell>
  );
}
