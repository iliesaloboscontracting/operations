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
  { href: "/requests", label: "Requests" },
  { href: "/office-requests", label: "Directors & accounts" },
  { href: "/purchases", label: "Purchases" },
  { href: "/changes", label: "Changes" },
  { href: "/completed", label: "Completed" },
  { href: "/day-review", label: "Day Review" },
  { href: "/receipts", label: "Receipts" },
  { href: "/attendance", label: "Sign-ins" },
  { href: "/timesheets", label: "Timesheets" },
  { href: "/tracking", label: "Project Tracking" },
  { href: "/production", label: "Production" },
  { href: "/invoices", label: "Invoices" },
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
  badgeTitle = "Projects starting within a week",
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
  badgeTitle?: string;
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
          title={badgeTitle}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

const Divider = () => <span className="mx-1.5 h-5 w-px shrink-0 self-center bg-white/10" aria-hidden />;

// The Directors and Accounts screens are separate from Operations (Ilies, 27 Oct 2026: like Estimating, "a full
// separate screen"). A director-only or accounts-only login only ever sees its own screen; an Admin who opens
// one sees exactly those tabs too, plus a way back to Operations.
const DIRECTORS = [
  { href: "/directors", label: "Overview" },
  { href: "/directors/pipeline", label: "Pipeline" },
  { href: "/directors/production", label: "Production" },
  { href: "/directors/budgets", label: "Budgets to approve" },
  { href: "/directors/purchases", label: "Purchases to approve" },
  { href: "/directors/accounts", label: "Accounts data" },
  { href: "/directors/requests", label: "Info requests" },
  { href: "/directors/kpis", label: "How the numbers work" },
  { href: "/directors/queries", label: "My queries" },
  { href: "/directors/lessons", label: "Lessons" },
];
const ACCOUNTS = [
  { href: "/accounts", label: "To do" },
  { href: "/accounts/calendar", label: "Due dates" },
  { href: "/accounts/payroll", label: "Payroll" },
  { href: "/accounts/reimbursements", label: "Reimbursements" },
  { href: "/accounts/labour-cost", label: "Labour cost" },
  { href: "/accounts/invoice-checks", label: "Invoice checks" },
  { href: "/accounts/xero", label: "Accounts data" },
  { href: "/accounts/compliance", label: "Compliance" },
  { href: "/accounts/assets", label: "Assets" },
  { href: "/accounts/purchases", label: "Purchases" },
  { href: "/accounts/tax", label: "Tax estimates" },
  { href: "/invoices", label: "Invoices" },
];
// The invoices inbox is an Operations page as well as an Accounts tab: an Admin who got there from the
// Accounts screen stays on the Accounts screen.
const SCREEN_KEY = "lobos-screen";

export default function TopNav() {
  const path = usePathname() ?? "";
  const { user, loading, canEdit, isAdmin, isDirector, directorOnly, timesheetsOnly, accountsOnly, signOut } = useAuth();
  const onePage = timesheetsOnly ? "/timesheets" : accountsOnly ? "/accounts" : directorOnly ? "/directors" : null;
  const [changingPw, setChangingPw] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startingSoon, setStartingSoon] = useState(0);
  const [offHire, setOffHire] = useState(0);
  const [requests, setRequests] = useState(0);
  const [officeRequests, setOfficeRequests] = useState(0);
  const [changes, setChanges] = useState(0);

  // Badge on Calendar: projects starting within a week (refreshed on navigation).
  const refreshBadge = useCallback(() => {
    if (loading || onePage) return; // not known yet, or a one-page role: no badges
    fetch(`/api/alerts?date=${localISODate()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((a: unknown[]) => setStartingSoon(a.length))
      .catch(() => setStartingSoon(0));
    // Badge on Hire: items overdue / finishing today / within 3 days.
    fetch("/api/hire-alerts")
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d: { alerts: unknown[] }) => setOffHire(d.alerts.length))
      .catch(() => setOffHire(0));
    // Badge on Requests: site requests waiting on Ilies (new, seen, sent back).
    fetch("/api/requests?count=1")
      .then((r) => (r.ok ? r.json() : { waiting: 0 }))
      .then((d: { waiting: number }) => setRequests(d.waiting))
      .catch(() => setRequests(0));
    // Badge on Directors & accounts: their queries and actions waiting on a decision.
    fetch("/api/requests?count=1&scope=office")
      .then((r) => (r.ok ? r.json() : { waiting: 0 }))
      .then((d: { waiting: number }) => setOfficeRequests(d.waiting))
      .catch(() => setOfficeRequests(0));
    // Badge on Changes (LCI phase 4): proposed changes this login could approve.
    if (canEdit) {
      fetch("/api/changes?count=1")
        .then((r) => (r.ok ? r.json() : { count: 0 }))
        .then((d: { count: number }) => setChanges(d.count))
        .catch(() => setChanges(0));
    }
  }, [loading, onePage, canEdit]);

  useEffect(refreshBadge, [refreshBadge, path]);
  // The Requests page says when a decision changes the count.
  useEffect(() => {
    window.addEventListener("requests-changed", refreshBadge);
    return () => window.removeEventListener("requests-changed", refreshBadge);
  }, [refreshBadge]);
  useAutoRefresh(refreshBadge);

  const isActive = (href: string) => path === href || path.startsWith(href + "/");

  // Which screen this page belongs to. Remembered for the tab, so the invoices inbox opened from the
  // Accounts screen keeps the Accounts tabs; any other Operations page puts the Operations tabs back.
  const [fromAccounts, setFromAccounts] = useState(false);
  useEffect(() => {
    try {
      if (path === "/accounts" || path.startsWith("/accounts/")) sessionStorage.setItem(SCREEN_KEY, "accounts");
      else if (path !== "/invoices") sessionStorage.removeItem(SCREEN_KEY);
      setFromAccounts(sessionStorage.getItem(SCREEN_KEY) === "accounts");
    } catch { setFromAccounts(false); }
  }, [path]);
  const screen: "directors" | "accounts" | null = directorOnly ? "directors" : accountsOnly ? "accounts"
    : isDirector && isActive("/directors") ? "directors"
    : isAdmin && (isActive("/accounts") || (path === "/invoices" && fromAccounts)) ? "accounts" : null;
  const screenTabs = screen === "directors" ? DIRECTORS : screen === "accounts" ? ACCOUNTS : [];
  // Overview also covers a job opened from it; every other tab is its own page or below it.
  const tabActive = (href: string) => (href === "/directors" ? path === "/directors" || path.startsWith("/directors/jobs") : href === "/accounts" ? path === "/accounts" : isActive(href));

  return (
    <nav className="relative z-10 flex h-14 w-full shrink-0 items-center border-b-[3px] border-brand-500 bg-sidebar px-3 shadow-soft">
      <Link href={onePage ?? (screen ? `/${screen}` : "/projects")} className="mr-3 flex shrink-0 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.png" alt="Lobos Contracting" width={400} height={96} className="h-8 w-auto" />
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1.5">
        {loading ? null : screen ? (
          <>
            {!onePage && (
              <>
                <NavTab href="/projects" label="← Operations" active={false} />
                <Divider />
              </>
            )}
            {screenTabs.map((i) => <NavTab key={i.href} href={i.href} label={i.label} active={tabActive(i.href)} />)}
          </>
        ) : onePage ? (
          <NavTab href={onePage} label="Timesheets" active={isActive(onePage)} />
        ) : (<>
        {isDirector && (
          <>
            <NavTab href="/directors" label="Directors" active={isActive("/directors")} />
            <Divider />
          </>
        )}
        {isAdmin && (
          <>
            <NavTab href="/accounts" label="Accounts" active={isActive("/accounts")} />
            <Divider />
          </>
        )}
        {OPERATIONS.filter((i) => (i.href !== "/tracking" && i.href !== "/invoices" && i.href !== "/assistant" && i.href !== "/attendance" && i.href !== "/timesheets" && i.href !== "/requests" && i.href !== "/office-requests" && i.href !== "/purchases" && i.href !== "/changes" && i.href !== "/receipts" && i.href !== "/production") || canEdit).map((i) => (
          <NavTab
            key={i.href}
            href={i.href}
            label={i.label}
            active={isActive(i.href)}
            badge={i.href === "/calendar" ? startingSoon : i.href === "/requests" ? requests : i.href === "/office-requests" ? officeRequests : i.href === "/changes" ? changes : undefined}
            badgeTitle={i.href === "/requests" ? "Site requests waiting on a decision, and reminders due" : i.href === "/office-requests" ? "Directors and accounts queries and actions waiting on a decision" : i.href === "/changes" ? "Proposed changes waiting for your approval" : undefined}
          />
        ))}
        <Divider />
        {REGISTERS.map((i) => (
          <NavTab
            key={i.href}
            href={i.href}
            label={i.label}
            active={isActive(i.href)}
            badge={i.href === "/hire" ? offHire : undefined}
            badgeTitle="Hire coming off hire within 3 days, or overdue"
          />
        ))}
        {isAdmin && (
          <>
            <Divider />
            {/* Estimating is its own app behind /estimating (a full page load, not client navigation). */}
            <a href="/estimating" className="flex shrink-0 items-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
              Estimating
            </a>
            <NavTab href="/users" label="Users" active={isActive("/users")} />
          </>
        )}
        </>)}
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
