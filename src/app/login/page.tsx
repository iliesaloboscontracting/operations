"use client";

import { useEffect, useState } from "react";
import AuthCard, { authInput } from "@/components/AuthCard";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // First run: no accounts yet -> go to setup.
  useEffect(() => {
    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((s) => {
        if (s.needsSetup) window.location.replace("/setup");
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't sign in");
      // Only follow same-site relative redirects.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/command");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in" subtitle="Use the account your admin set up for you.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
          Email
          <input
            type="email"
            autoFocus
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInput}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInput}
          />
        </label>
        {error && <div className="text-sm text-red-500">{error}</div>}
        <button
          type="submit"
          disabled={busy || !email || !password}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-center text-xs text-gray-500">Forgot your password? Ask an admin to reset it.</p>
      </form>
    </AuthCard>
  );
}
