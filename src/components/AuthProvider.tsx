"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Role = "ADMIN" | "MANAGER" | "VIEWER" | "TIMESHEETS" | "ACCOUNTS";
export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
  directorAccess: boolean;
}

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  canEdit: boolean; // Manager or Admin
  isAdmin: boolean;
  timesheetsOnly: boolean; // review-only timesheets access (Alex) - nothing else
  accountsOnly: boolean; // the invoices inbox (accounts) - nothing else
  isDirector: boolean; // sees the Directors overview (the API checks this too)
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  canEdit: false,
  isAdmin: false,
  timesheetsOnly: false,
  accountsOnly: false,
  isDirector: false,
  signOut: async () => {},
});

export const useAuth = () => useContext(Ctx);

export default function AuthProvider({
  enabled,
  children,
}: {
  enabled: boolean; // false on the login / setup pages
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [enabled]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }, []);

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        canEdit: user?.role === "ADMIN" || user?.role === "MANAGER",
        isAdmin: user?.role === "ADMIN",
        timesheetsOnly: user?.role === "TIMESHEETS",
        accountsOnly: user?.role === "ACCOUNTS",
        isDirector: !!user?.directorAccess,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
