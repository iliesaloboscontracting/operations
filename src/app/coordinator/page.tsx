"use client";

import Link from "next/link";
import { CalendarDays, ClipboardCheck, Clock, FileSearch, Mail, MessageSquare, ShoppingCart, Truck, UserCheck, Wrench } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";

// The project coordinator's dashboard (Alex, 2 Nov 2026 - Ilies "approve phase 1"): his own screen, like the
// Directors and Accounts screens - one tile per page he uses (lib/roles.ts COORDINATOR_PAGES). Every other
// Operations page and API refuses this login. Outlook (phase 2, Microsoft 365) is a placeholder only - no Microsoft
// code here.
const TILES = [
  { href: "/timesheets", label: "Timesheets", what: "The week's staff hours from sign-ins. View only.", icon: Clock },
  { href: "/timesheets/labour-hire", label: "Labour hire hours", what: "The hire workers' week by company, to send to the labour hire company. View and export.", icon: Clock },
  { href: "/attendance", label: "Sign-ins", what: "Who signed in and out, on each site, the office, yard and trucks. View only.", icon: UserCheck },
  { href: "/day-review", label: "Day Review", what: "Planned vs what happened, the site logs and daily site reports. View only.", icon: ClipboardCheck },
  { href: "/calendar", label: "Calendar", what: "Every job coming up and running. View only.", icon: CalendarDays },
  { href: "/tools", label: "Tools & toolboxes", what: "The tool register, toolboxes, checks by photo, faults and Hilti swaps.", icon: Wrench },
  { href: "/hire", label: "Hire", what: "Add, extend and off-hire - suppliers, dates, status and the project it's for.", icon: Truck },
  { href: "/purchases", label: "Purchase requests", what: "Buy or hire something, with suppliers' quotes - Ilies or a director approves.", icon: ShoppingCart },
  { href: "/messages", label: "Messages", what: "The office chat and your one-to-ones.", icon: MessageSquare },
  { href: "/documents", label: "Documents", what: "Search the site & safety folders - SWMS, scopes, drawings.", icon: FileSearch },
];

export default function CoordinatorPage() {
  const { user, coordinatorOnly, isAdmin, loading } = useAuth();
  if (!loading && !coordinatorOnly && !isAdmin) return <PageShell title="Coordinator"><p className="text-sm text-gray-400">This screen is for the project coordinator.</p></PageShell>;
  return (
    <PageShell title="Coordinator" subtitle={user ? `G'day ${user.name.split(" ")[0]} - everything you work on, in one place.` : undefined}>
      <div className="grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map(({ href, label, what, icon: Icon }) => (
          <Link key={href} href={href} className="group flex gap-3 rounded-xl border border-edge bg-panel p-4 shadow-soft hover:border-brand-500/60 hover:bg-panel2/60">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400"><Icon size={18} /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-gray-100 group-hover:text-white">{label}</span>
              <span className="mt-0.5 block text-xs text-gray-400">{what}</span>
            </span>
          </Link>
        ))}
        <div className="flex gap-3 rounded-xl border border-dashed border-edge bg-panel/40 p-4" aria-disabled>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel2 text-gray-500"><Mail size={18} /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold text-gray-300">
              Outlook <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">Coming soon</span>
            </span>
            <span className="mt-0.5 block text-xs text-gray-500">Your inbox and calendar here, once Microsoft 365 is connected.</span>
          </span>
        </div>
      </div>
    </PageShell>
  );
}
