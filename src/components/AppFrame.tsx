"use client";

import { usePathname } from "next/navigation";
import AuthProvider from "./AuthProvider";
import TopNav from "./TopNav";

const BARE_PAGES = ["/login", "/setup"];

// App chrome: top nav + content, except on the sign-in / setup pages.
// (Trying the nav as a horizontal top bar instead of the left Sidebar - swap the
// import back to "./Sidebar" and this to a flex-row layout to revert.)
export default function AppFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const bare = BARE_PAGES.includes(path);

  return (
    <AuthProvider enabled={!bare}>
      {bare ? (
        <main className="h-screen overflow-y-auto">{children}</main>
      ) : (
        <div className="flex h-screen flex-col">
          <TopNav />
          <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        </div>
      )}
    </AuthProvider>
  );
}
