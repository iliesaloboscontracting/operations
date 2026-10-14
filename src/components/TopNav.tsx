"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import { localISODate } from "@/lib/resource";
import { useAuth } from "./AuthProvider";
import FormModal from "./FormModal";

// Same nav model as the old left Sidebar - just laid out as a single horizontal row.
const OPERATIONS = [
  { href: "/projects", label: "Projects" },
  { href: "/calendar", label: "Calendar" },
  { href: "/command", label: "Allocations" },
  { href: "/completed", label: "Completed" },
  { href: "/day-review", label: "Day Review" },
  { href: "/tracking", label: "Project Tracking" },
  { href: "/assistant", label: "Assistant" },
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
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm ${
        active
          ? "bg-white/12 font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
          : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {label}
      {!!badge && (
        <span
          className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-black"
          title="Projects starting within a week"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

const Divider = () => <span className="mx-1.5 h-5 w-px shrink-0 self-center bg-white/10" aria-hidden />;

export default function TopNav() {
  const path = usePathname() ?? "";
  const { user, canEdit, isAdmin, signOut } = useAuth();
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
    <nav className="relative z-10 flex h-14 w-full shrink-0 items-center border-b-[3px] border-brand-500 bg-sidebar px-3 shadow-soft">
      <Link href="/projects" className="mr-3 flex shrink-0 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Lobos Contracting" width={400} height={96} className="h-8 w-auto" />
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1.5">
        {OPERATIONS.filter((i) => (i.href !== "/tracking" && i.href !== "/assistant") || canEdit).map((i) => (
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
            className={`flex items-center gap-2 rounded-full py-1.5 pl-3 pr-2 ${
              menuOpen ? "bg-white/10" : "hover:bg-white/5"
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {user.name.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 text-left">
              <div className="truncate text-xs font-medium text-white">{user.name}</div>
              <div className="truncate text-[10px] text-slate-400">
                {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
              </div>
            </div>
            <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="animate-modal-in absolute right-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-sidebar py-1 shadow-soft-lg">
                <div className="truncate border-b border-white/10 px-3 py-2.5 text-[11px] text-slate-400">
                  {user.email}
                </div>
                <button
                  onClick={() => {
                    setChangingPw(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
                >
                  <KeyRound size={14} className="shrink-0 text-slate-500" />
                  Change password
                </button>
                <button
                  onClick={signOut}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-red-500/10 hover:text-red-400"
                >
                  <LogOut size={14} className="shrink-0 text-slate-500" />
                  Sign out
                </button>
              </div>
            </>
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
