"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localISODate } from "@/lib/resource";
import { useAuth } from "./AuthProvider";
import FormModal from "./FormModal";

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

function NavGroup({
  title,
  items,
  path,
  badges = {},
}: {
  title: string;
  items: { href: string; label: string }[];
  path: string;
  badges?: Record<string, number>;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1 px-3 text-[11px] uppercase tracking-widest text-slate-500">
        {title}
      </div>
      {items.map((i) => {
        const active = path === i.href || path.startsWith(i.href + "/");
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`block border-l-2 px-3 py-1.5 text-sm ${
              active
                ? "border-brand bg-white/10 font-medium text-white"
                : "border-transparent text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            {i.label}
            {badges[i.href] > 0 && (
              <span
                className="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black"
                title="Projects starting within a week"
              >
                {badges[i.href]}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export default function Sidebar() {
  const path = usePathname() ?? "";
  const { user, isAdmin, signOut } = useAuth();
  const [changingPw, setChangingPw] = useState(false);
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

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-sidebar py-4">
      <div className="mb-5 px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-dark.png"
          alt="Lobos Contracting"
          width={400}
          height={96}
          className="h-auto w-full"
        />
        <div className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
          Operate
        </div>
      </div>
      <NavGroup
        title="Operations"
        items={OPERATIONS}
        path={path}
        badges={{ "/calendar": startingSoon }}
      />
      <NavGroup title="Registers" items={REGISTERS} path={path} />
      {isAdmin && (
        <NavGroup title="Admin" items={[{ href: "/users", label: "Users" }]} path={path} />
      )}

      {/* Signed-in user */}
      <div className="mt-auto border-t border-white/10 px-3 pt-3">
        {user && (
          <>
            <div className="truncate text-sm font-medium text-white">{user.name}</div>
            <div className="truncate text-[11px] text-slate-400">
              {user.role.charAt(0) + user.role.slice(1).toLowerCase()} · {user.email}
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <button onClick={() => setChangingPw(true)} className="text-slate-400 hover:text-white">
                Change password
              </button>
              <button onClick={signOut} className="text-slate-400 hover:text-red-400">
                Sign out
              </button>
            </div>
          </>
        )}
      </div>

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
