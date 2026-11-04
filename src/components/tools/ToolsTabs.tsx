"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { coordinatorHref, yardHref } from "@/lib/roles";

const TABS = [
  { href: "/tools", label: "Register" },
  { href: "/tools/toolboxes", label: "Toolboxes" },
  { href: "/tools/faults", label: "Faults & Hilti swaps" },
  { href: "/tools/site", label: "From site" },
  { href: "/yard/stocktake", label: "Yard stock take" }, // Yard Stage B (4 Nov 2026)
];

export default function ToolsTabs() {
  const path = usePathname();
  // The coordinator's tabs are the ones he may open (lib/roles.ts) - "From site" (site links) isn't one. The same for
  // the yard computer (4 Nov 2026).
  const { coordinatorOnly, yardOnly } = useAuth();
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {TABS.filter((t) => coordinatorHref(t.href, coordinatorOnly) && yardHref(t.href, yardOnly)).map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            path === t.href ? "bg-brand-600 text-white" : "border border-edge bg-panel text-gray-400 hover:text-gray-200"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
