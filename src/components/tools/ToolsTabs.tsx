"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/tools", label: "Register" },
  { href: "/tools/toolboxes", label: "Toolboxes" },
  { href: "/tools/faults", label: "Faults & Hilti swaps" },
  { href: "/tools/site", label: "From site" },
];

export default function ToolsTabs() {
  const path = usePathname();
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {TABS.map((t) => (
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
