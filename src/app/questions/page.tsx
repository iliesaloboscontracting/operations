"use client";

// Questions for me (27 Oct 2026, docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md part 2): Operations AI can now ask the
// office (Admins, Managers) as well as accounts and the directors. Office logins answer here - the same cards as
// Directors -> My queries. Answering never changes any record; Ilies reviews the answers.
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import MyQueries, { useMyQueries } from "@/components/queries/MyQueries";

export default function QuestionsForMePage() {
  const { canEdit, loading } = useAuth();
  const { rows, load, waiting } = useMyQueries();
  if (loading) return null;
  if (!canEdit) return <PageShell title="Questions for me"><p className="text-sm text-gray-400">This page is for the office.</p></PageShell>;
  return (
    <PageShell title="Questions for me" subtitle={waiting ? `${waiting} waiting on you` : "Questions from Operations AI and the directors"}>
      <div className="max-w-2xl space-y-4">
        <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-100">Answers are reviewed by Ilies before anything changes.</p>
        <MyQueries rows={rows} onChange={load} />
      </div>
    </PageShell>
  );
}
