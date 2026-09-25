"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localISODate } from "@/lib/resource";
import { useAuth } from "./AuthProvider";
import FormModal from "./FormModal";

// Same nav model as the old left Sidebar - just laid out as a single horizontal row.
const OPERATIONS = [
  { href: "/projects", label: "Projects" },
  { href: "/calendar", label: "Calendar" },
  { href: "/command", label: "Command Centre" },
  { href: "/completed", label: "Completed" },
  { href: "/day-review", label: "Day Review" },
  { href: "/tracking", label: "Project Tracking" },
  { href: "/notes", label: "Notes" },
  { href: "/bugs", label: "Bug Reports" },
];

const REGISTERS = [
  { href: "/plant", label: "Plant & Attachments" },
  { href: "/vehicles", label: "Vehicles" },
  { href: "/labour", label: "Labour" },
  { href: "/hire", label: "Hire" },
  { href: "/tools", label: "Tools" },
];

function NavTab({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-brand font-medium text-white"
          : "border-transparent text-slate-300 hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
      {!!badge && (
        <span
          className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black"
          title="Projects starting within a week"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 self-center bg-white/10" aria-hidden />;

export default function TopNav() {
  const path = usePathname() ?? "";
  const { user, isAdmin, signOut } = useAuth();
  const [changingPw, setChangingPw] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startingSoon, setStartingSoon] = useState(0);

  // Badge on Calendar: projects starting within a week (refreshed on navigation).
  const refreshBadge = useCallback(() => {
    fetch(`/api/alerts?date=${localISODate()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((a: unknown[]) => setStartingSoon(a.length))
      .catch(() => setStartingSoon(0));
  }, []);

  useEffect(refreshBadge, [refreshBadge, path]);
  useAutoRefresh(refreshBadge);

  const isActive = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <nav className="flex h-14 w-full shrink-0 items-center border-b border-white/10 bg-sidebar px-3">
      <Link href="/projects" className="mr-3 flex shrink-0 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Lobos Contracting" width={400} height={96} className="h-8 w-auto" />
      </Link>

      <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {OPERATIONS.map((i) => (
          <NavTab
            key={i.href}
            href={i.href}
            label={i.label}
            active={isActive(i.href)}
            badge={i.href === "/calendar" ? startingSoon : undefined}
          />
        ))}
        <Divider />
        {REGISTERS.map((i) => (
          <NavTab key={i.href} href={i.href} label={i.label} active={isActive(i.href)} />
        ))}
        {isAdmin && (
          <>
            <Divider />
            <NavTab href="/users" label="Users" active={isActive("/users")} />
          </>
        )}
      </div>

      {user && (
        <div className="relative ml-2 shrink-0">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5"
          >
            <div className="min-w-0 text-right">
              <div className="truncate text-xs font-medium text-white">{user.name}</div>
              <div className="truncate text-[10px] text-slate-400">
                {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
              </div>
            </div>
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-white/10 bg-sidebar py-1 shadow-xl"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <div className="truncate border-b border-white/10 px-3 py-2 text-[11px] text-slate-400">
                {user.email}
              </div>
              <button
                onClick={() => {
                  setChangingPw(true);
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
              >
                Change password
              </button>
              <button
                onClick={signOut}
                className="block w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-red-400"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      )}

      {changingPw && (
        <FormModal
          title="Change password"
          fields={[
            { key: "current", label: "Current password", type: "password", required: true, full: true },
            { key: "next", label: "New password (8+ characters)", type: "password", required: true, full: true },
          ]}
          initial={{ current: "", next: "" }}
          onSave={async (v) => {
            const res = await fetch("/api/auth/password", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(v),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(j.error || "Couldn't change password");
          }}
          onClose={() => setChangingPw(false)}
        />
      )}
    </nav>
  );
}
