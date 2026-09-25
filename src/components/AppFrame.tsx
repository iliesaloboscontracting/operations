"use client";

import { usePathname } from "next/navigation";
import AuthProvider from "./AuthProvider";
import Sidebar from "./Sidebar";

const BARE_PAGES = ["/login", "/setup"];

// App chrome: sidebar + content, except on the sign-in / setup pages.
export default function AppFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const bare = BARE_PAGES.includes(path);

  return (
    <AuthProvider enabled={!bare}>
      {bare ? (
        <main className="h-screen overflow-y-auto">{children}</main>
      ) : (
        <div className="flex h-screen">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
      )}
    </AuthProvider>
  );
}
