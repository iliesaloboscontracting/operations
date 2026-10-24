"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import AuthProvider, { useAuth } from "./AuthProvider";
import TopNav from "./TopNav";

const BARE_PAGES = ["/login", "/setup"];

// App chrome: top nav + content, except on the sign-in / setup pages.
// (Trying the nav as a horizontal top bar instead of the left Sidebar - swap the
// import back to "./Sidebar" and this to a flex-row layout to revert.)
export default function AppFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  // The Site photos page (supervisors' links) is its own phone page - no app
  // nav and no sign-in check (it has no session; its link is the key).
  const site = path.startsWith("/site/");
  const bare = BARE_PAGES.includes(path) || site;

  return (
    <AuthProvider enabled={!bare}>
      {bare ? (
        <main className="h-screen overflow-y-auto">{children}</main>
      ) : (
        <div className="flex h-screen flex-col">
          <TopNav />
          <main className="min-h-0 flex-1 overflow-hidden">
            <OnePageGate path={path}>{children}</OnePageGate>
          </main>
        </div>
      )}
    </AuthProvider>
  );
}

// The one-page roles: review-only timesheets (Alex) and the invoices inbox
// (accounts). Every other page sends them back to theirs. The data routes
// refuse them anyway - this keeps the screen tidy.
function OnePageGate({ path, children }: { path: string; children: React.ReactNode }) {
  const { timesheetsOnly, accountsOnly } = useAuth();
  const router = useRouter();
  const home = timesheetsOnly ? "/timesheets" : accountsOnly ? "/invoices" : null;
  const elsewhere = !!home && path !== home;
  useEffect(() => {
    if (elsewhere && home) router.replace(home);
  }, [elsewhere, home, router]);
  return elsewhere ? null : <>{children}</>;
}
