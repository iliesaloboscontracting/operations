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
            <TimesheetsOnlyGate path={path}>{children}</TimesheetsOnlyGate>
          </main>
        </div>
      )}
    </AuthProvider>
  );
}

// Review-only timesheets access (Alex): every other page sends him to
// Timesheets. The data routes refuse him anyway - this keeps the screen tidy.
function TimesheetsOnlyGate({ path, children }: { path: string; children: React.ReactNode }) {
  const { timesheetsOnly } = useAuth();
  const router = useRouter();
  const elsewhere = timesheetsOnly && path !== "/timesheets";
  useEffect(() => {
    if (elsewhere) router.replace("/timesheets");
  }, [elsewhere, router]);
  return elsewhere ? null : <>{children}</>;
}
