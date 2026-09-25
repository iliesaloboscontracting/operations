"use client";

import { useEffect, useState } from "react";
import AuthCard, { authInput } from "@/components/AuthCard";

export default function SetupPage() {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Setup only exists until the first admin has been created.
  useEffect(() => {
    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((s) => (s.needsSetup ? setReady(true) : window.location.replace("/login")))
      .catch(() => setReady(true));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Setup failed");
      window.location.assign("/command");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!ready) return null;

  return (
    <AuthCard
      title="Welcome — create the admin account"
      subtitle="This one-time setup makes the first administrator. You can add everyone else afterwards."
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
          Your name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={authInput} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
          Password (8+ characters)
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-gray-500">
          Confirm password
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput} />
        </label>
        {error && <div className="text-sm text-red-500">{error}</div>}
        <button
          type="submit"
          disabled={busy || !name || !email || !password}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create admin account"}
        </button>
      </form>
    </AuthCard>
  );
}
