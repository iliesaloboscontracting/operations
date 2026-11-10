"use client";

// Directors -> Waiting on you (10 Nov 2026; Ilies: "yes go and deploy once it passes"): everything only this director
// can give - questions, approvals, contract values, decisions not made yet - each with its one action. Plus this
// login's phone alerts for the Monday-morning "N things waiting on you". Director access only (the API checks it too).
import PageShell from "@/components/PageShell";
import PushToggle from "@/components/PushToggle";
import { useAuth } from "@/components/AuthProvider";
import WaitingOnYou from "@/components/directors/WaitingOnYou";

export default function DirectorsWaitingPage() {
  const { isDirector, user, loading } = useAuth();
  if (loading) return null;
  if (!isDirector) {
    return (
      <PageShell title="Waiting on you">
        <div className="rounded-lg border border-dashed border-edge p-10 text-center text-sm text-gray-500">Only directors can see this page.</div>
      </PageShell>
    );
  }
  // Phone alerts: DIRECTOR logins and Admins turn on their own (/api/push).
  const canAlert = user?.role === "DIRECTOR" || user?.role === "ADMIN";
  return (
    <PageShell
      title="Waiting on you"
      subtitle="What only the directors can give - oldest first"
      actions={canAlert ? <div className="flex items-center gap-2 text-xs text-gray-400"><span className="hidden sm:inline">Monday 8am reminder:</span><PushToggle /></div> : undefined}
    >
      <div className="max-w-3xl"><WaitingOnYou /></div>
    </PageShell>
  );
}
